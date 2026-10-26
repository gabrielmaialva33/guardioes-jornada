/** Local study vegetation. Import dynamically inside DEV; source data stays in the served catalog. */
import {
	Box3,
	DoubleSide,
	Group,
	type Material,
	Mesh,
	type MeshStandardMaterial,
	Texture,
	Vector3
} from 'three';
import type { StoryLevel } from '../level/types.ts';
import { applyWind, WIND } from '../life/wind.ts';
import {
	type BlockGrid,
	collectTextures,
	createPoolsFromScene,
	type InstancePool,
	type PoolSet,
	type Quality,
	textureBytes
} from '../render/index.ts';
import { loadModel } from '../scene/avatar.ts';
import type { SurvivalWorld } from '../survival/types.ts';
import { loadStudyCatalog, type StudyAssetPlant } from './data.ts';
import { type StudyLook, studyEnabled, studyLook, studyUrl } from './gate.ts';
import { type StylizedModel, stylizeModel } from './stylize.ts';
import {
	planStudyVegetation,
	VEGETATION_QUALITY,
	type VegetationPlacement,
	type VegetationRole,
	vegetationVisible
} from './vegetation-plan.ts';

export interface StudyVegetationHost {
	grid: BlockGrid;
	quality: Quality;
	world: SurvivalWorld;
	signal: AbortSignal;
	level?: StoryLevel;
	look?: StudyLook;
	/** Optional native pools: enables same-location tree swaps; never adds a second trunk. */
	existingPools?: PoolSet;
}
export interface StudyVegetationDebug {
	look: StudyLook;
	quality: Quality;
	assets: number;
	failed: string[];
	planned: number;
	instances: number;
	visible: number;
	draws: number;
	triangles: number;
	textureBytes: number;
	eligibleArea: number;
	byRole: Partial<Record<VegetationRole, number>>;
}
export interface StudyVegetation {
	readonly object: Group;
	readonly pools: PoolSet;
	readonly replaces: readonly string[];
	setQuality(quality: Quality): void;
	debug(): StudyVegetationDebug;
	dispose(): void;
}

/** Remove explicit duplicate shadow geometry; a real vine may itself use a caster-named material. */
export function prepareVegetationModel(model: Group): number {
	const meshes: Mesh[] = [];
	model.traverse((o) => {
		if (o instanceof Mesh) meshes.push(o);
	});
	const shadowOnly = (mesh: Mesh) =>
		(Array.isArray(mesh.material) ? mesh.material : [mesh.material]).every((m) => /caster/i.test(m.name));
	const hasMain = meshes.some((mesh) => !shadowOnly(mesh));
	for (const mesh of meshes)
		if (
			/(?:_caster|shadow.?caster|lod[_ -]?[1-9]\d*)(?:\.\d+)?$/i.test(mesh.name) ||
			(hasMain && shadowOnly(mesh))
		)
			mesh.removeFromParent();
	model.updateMatrixWorld(true);
	const bounds = new Box3().setFromObject(model);
	const height = bounds.max.y - bounds.min.y;
	if (
		!Number.isFinite(height) ||
		height <= 1e-8 ||
		!Number.isFinite(bounds.min.x + bounds.max.x + bounds.min.z + bounds.max.z)
	)
		throw new Error('study vegetation: invalid model bounds');
	const point = new Vector3();
	let footX = 0,
		footZ = 0,
		points = 0;
	model.traverse((o) => {
		if (!(o instanceof Mesh)) return;
		const positions = o.geometry.getAttribute('position');
		for (let i = 0; i < positions.count; i++) {
			point.fromBufferAttribute(positions, i).applyMatrix4(o.matrixWorld);
			if (point.y > bounds.min.y + height * 0.04) continue;
			footX += point.x;
			footZ += point.z;
			points++;
		}
	});
	model.position.x -= points ? footX / points : (bounds.min.x + bounds.max.x) * 0.5;
	model.position.y -= bounds.min.y;
	model.position.z -= points ? footZ / points : (bounds.min.z + bounds.max.z) * 0.5;
	const wrapper = new Group();
	// Bake through a parent so the scene root's source transforms remain correct.
	wrapper.scale.setScalar(1 / height);
	wrapper.add(model);
	wrapper.updateMatrixWorld(true);
	return height;
}

interface Resources {
	geometries: Set<Mesh['geometry']>;
	materials: Set<Material>;
	textures: Set<Texture>;
}
function resources(model: Group): Resources {
	const owned: Resources = { geometries: new Set(), materials: new Set(), textures: new Set() };
	model.traverse((o) => {
		if (!(o instanceof Mesh)) return;
		owned.geometries.add(o.geometry);
		for (const material of Array.isArray(o.material) ? o.material : [o.material]) {
			owned.materials.add(material);
			for (const value of Object.values(material)) if (value instanceof Texture) owned.textures.add(value);
		}
	});
	return owned;
}
function freeResources(owned: Resources) {
	for (const geometry of owned.geometries) geometry.dispose();
	for (const material of owned.materials) material.dispose();
	for (const texture of owned.textures) {
		texture.dispose();
		const image = texture.image as { close?: () => void } | undefined;
		image?.close?.();
	}
	owned.geometries.clear();
	owned.materials.clear();
	owned.textures.clear();
}

/** Shared foliage correction: atlases use cutouts; FBX's default metal/blend settings do not apply. */
export function prepareFoliageMaterials(model: Group) {
	model.traverse((o) => {
		if (!(o instanceof Mesh)) return;
		for (const material of Array.isArray(o.material) ? o.material : [o.material]) {
			const m = material as MeshStandardMaterial;
			m.transparent = false;
			m.opacity = 1;
			m.depthWrite = true;
			m.side = DoubleSide;
			const bark = /bark|trunk|wood/i.test(`${m.name} ${m.map?.name ?? ''}`);
			m.alphaTest = m.map && !bark ? 0.5 : 0;
			if ('metalness' in m) m.metalness = 0;
			if ('roughness' in m) m.roughness = 0.9;
			// Source normal maps are Unity-packed; the local painted study uses geometric normals.
			if ('normalMap' in m) m.normalMap = null;
			m.userData.vegetation = true;
			m.needsUpdate = true;
		}
	});
}

function textureUploadState(t: Texture) {
	return [
		t.flipY,
		t.colorSpace,
		t.wrapS,
		t.wrapT,
		t.magFilter,
		t.minFilter,
		t.anisotropy,
		t.format,
		t.internalFormat,
		t.type,
		t.generateMipmaps,
		t.premultiplyAlpha,
		t.unpackAlignment
	];
}
function residentTextureBytes(object: Group) {
	const uploads = new Map<string, Texture>();
	for (const texture of collectTextures(object))
		uploads.set(`${texture.source.uuid}:${JSON.stringify(textureUploadState(texture))}`, texture);
	return textureBytes(uploads.values());
}

/** Exact-pixel sharing prevents every plant variant uploading the same painted atlas. */
export function shareVegetationTextures(model: Group, cache: Map<string, Texture>) {
	const read = (texture: Texture): ArrayLike<number> | null => {
		const image = texture.image as
			| {
					data?: ArrayLike<number>;
					width: number;
					height: number;
					getContext?: (name: string) => CanvasRenderingContext2D | null;
			  }
			| undefined;
		return (
			image?.data ?? image?.getContext?.('2d')?.getImageData(0, 0, image.width, image.height).data ?? null
		);
	};
	model.traverse((o) => {
		if (!(o instanceof Mesh)) return;
		for (const material of Array.isArray(o.material) ? o.material : [o.material]) {
			const m = material as MeshStandardMaterial,
				t = m.map;
			if (!t) continue;
			const pixels = read(t);
			if (!pixels) continue;
			let hash = 2166136261;
			for (let i = 0; i < pixels.length; i++) hash = Math.imul(hash ^ pixels[i], 16777619);
			const image = t.image as { width: number; height: number };
			const key = JSON.stringify([t.name, image.width, image.height, hash, ...textureUploadState(t)]);
			const existing = cache.get(key),
				other = existing ? read(existing) : null;
			if (existing && other && other.length === pixels.length) {
				let same = true;
				for (let i = 0; i < pixels.length; i++)
					if (pixels[i] !== other[i]) {
						same = false;
						break;
					}
				if (same) {
					t.source = existing.source;
					if (
						JSON.stringify([
							t.offset.toArray(),
							t.repeat.toArray(),
							t.center.toArray(),
							t.rotation,
							t.channel
						]) ===
						JSON.stringify([
							existing.offset.toArray(),
							existing.repeat.toArray(),
							existing.center.toArray(),
							existing.rotation,
							existing.channel
						])
					)
						m.map = existing;
				}
			} else cache.set(key, t);
		}
	});
}

const ROLES: readonly VegetationRole[] = [
	'groundcover',
	'understorey',
	'flowers',
	'liana',
	'tree',
	'log',
	'rock-ivy',
	'litter'
];
interface AssetPool {
	pool: InstancePool;
	placements: VegetationPlacement[];
	ids: number[];
	role: VegetationRole;
}

/** Resolves curated roles only; all file paths, sizes and geometry inventories come from tmp/. */
export async function loadStudyVegetation(host: StudyVegetationHost): Promise<StudyVegetation | null> {
	if (!import.meta.env.DEV || !studyEnabled()) return null;
	host.signal.throwIfAborted();
	const catalog = await loadStudyCatalog(host.signal);
	host.signal.throwIfAborted();
	const look = host.look ?? studyLook(),
		plan = planStudyVegetation(host.world, host.level);
	const available = catalog.plants.filter(
		(a) => (a.fit === 'pick' || a.fit === 'existing') && ROLES.includes(a.role as VegetationRole)
	);
	const groups = new Map<string, { asset: StudyAssetPlant; placements: VegetationPlacement[] }>();
	const variantCursor = new Map<VegetationRole, number>();
	for (const p of plan.placements) {
		if (p.replaces && !host.existingPools) continue;
		const candidates = available.filter((a) => a.role === p.role).sort((a, b) => a.id.localeCompare(b.id));
		if (!candidates.length) continue;
		const cursor = variantCursor.get(p.role) ?? 0;
		variantCursor.set(p.role, cursor + 1);
		const asset = candidates[(cursor + (host.world.worldSeed >>> 0)) % candidates.length];
		const group = groups.get(asset.id) ?? { asset, placements: [] };
		group.placements.push(p);
		groups.set(asset.id, group);
	}
	const source = new Group(),
		names: string[] = [],
		capacity: Record<string, number> = {},
		assetGroups = new Map<string, VegetationPlacement[]>();
	const atlasCache = new Map<string, Texture>();
	const originals: Resources[] = [],
		styled: StylizedModel[] = [],
		failed: string[] = [];
	let pools: PoolSet | undefined,
		disposed = false;
	const hidden = new Map<Group, boolean>();
	const clean = () => {
		if (disposed) return;
		disposed = true;
		for (const [object, visible] of hidden) object.visible = visible;
		hidden.clear();
		pools?.object.removeFromParent();
		pools?.dispose();
		for (const style of styled) style.dispose();
		for (const owned of originals) freeResources(owned);
		source.clear();
	};
	try {
		const jobs = [...groups.values()];
		let next = 0;
		const worker = async () => {
			while (next < jobs.length) {
				host.signal.throwIfAborted();
				const { asset, placements } = jobs[next++];
				let owned: Resources | undefined, style: StylizedModel | undefined;
				try {
					const model = await loadModel(studyUrl(asset.path), host.signal);
					owned = resources(model);
					host.signal.throwIfAborted();
					prepareVegetationModel(model);
					const normalized = model.parent as Group;
					prepareFoliageMaterials(model);
					style = stylizeModel(model, look, {
						vegetation: true,
						opaque: true,
						outline: false,
						maxSize: VEGETATION_QUALITY[host.quality].atlas,
						contour: 0.12,
						snap: 0.45
					});
					if (look === 'painted') shareVegetationTextures(model, atlasCache);
					const name = `study-plant:${asset.id}`;
					normalized.name = name;
					source.add(normalized);
					originals.push(owned);
					styled.push(style);
					names.push(name);
					capacity[name] = placements.length;
					assetGroups.set(name, placements);
					owned = undefined;
					style = undefined;
				} catch (error) {
					style?.dispose();
					if (owned) freeResources(owned);
					if (host.signal.aborted) throw error;
					failed.push(asset.id);
				}
			}
		};
		// A decode can outlive cancellation; settle both workers before releasing shared ownership.
		const loading = await Promise.allSettled([worker(), worker()]);
		const error = loading.find((r) => r.status === 'rejected');
		if (error?.status === 'rejected') throw error.reason;
		host.signal.throwIfAborted();
		names.sort();
		pools = createPoolsFromScene(source, names, {
			grid: host.grid,
			capacity,
			material: 'source',
			castShadow: false,
			receiveShadow: true
		});
		pools.object.name = 'study-vegetation';
		const builtPools = pools;
		const records: AssetPool[] = names.map((name) => {
			const placements = assetGroups.get(name);
			if (!placements?.length) throw new Error('study vegetation: missing placements');
			return { pool: builtPools.get(name), placements, ids: [], role: placements[0].role };
		});
		// Only hide a native pool when every planned replacement of that kind loaded successfully.
		const expected = new Map<string, number>(),
			ready = new Map<string, number>();
		for (let i = 0; i < host.world.trees.count; i++) {
			const kind = host.world.trees.kinds[host.world.trees.kind[i]];
			if (kind !== 'jequitiba' && kind !== 'pau-brasil') continue;
			const key = `tree:${kind}`;
			expected.set(key, (expected.get(key) ?? 0) + 1);
		}
		for (let i = 0; i < host.world.rocks.count; i++)
			if (host.world.rocks.kinds[host.world.rocks.kind[i]] === 'log')
				expected.set('rock:log', (expected.get('rock:log') ?? 0) + 1);
		for (const r of records)
			for (const p of r.placements) if (p.replaces) ready.set(p.replaces, (ready.get(p.replaces) ?? 0) + 1);
		const replaces = [...expected]
			.filter(([key, n]) => ready.get(key) === n && host.existingPools?.pools.has(key))
			.map(([key]) => key);
		for (const key of replaces) {
			const pool = host.existingPools?.pools.get(key);
			if (!pool) continue;
			hidden.set(pool.object, pool.object.visible);
			pool.object.visible = false;
		}
		// Drop incomplete tree swaps completely: the original family remains intact.
		for (const r of records)
			r.placements = r.placements.filter((p) => !p.replaces || replaces.includes(p.replaces));
		for (const r of records)
			for (const mesh of r.pool.meshes) {
				for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material])
					if (!m.userData.lifeWind && !['log', 'rock-ivy', 'litter'].includes(r.role))
						applyWind(m, {
							amplitude: r.role === 'tree' ? WIND.canopySway : WIND.grassSway,
							from: r.role === 'tree' ? 0.6 : 0,
							to: 1,
							sample: r.role === 'tree' ? 'origin' : 'vertex'
						});
			}
		// Merged geometries now own their copies. Painted source images are no longer needed.
		for (const owned of originals) {
			for (const geometry of owned.geometries) geometry.dispose();
			owned.geometries.clear();
			if (look === 'painted') freeResources(owned);
		}
		source.clear();
		let quality = host.quality;
		const setQuality = (q: Quality) => {
			if (disposed) return;
			quality = q;
			const settings = VEGETATION_QUALITY[q];
			for (const r of records) {
				for (const id of r.ids) r.pool.remove(id);
				r.ids.length = 0;
				for (const p of r.placements)
					if (vegetationVisible(p, q)) {
						const id = r.pool.addPlaced(p.x, p.y, p.z, Math.cos(p.yaw), Math.sin(p.yaw), p.height);
						if (id >= 0) r.ids.push(id);
					}
				const far =
					r.role === 'tree'
						? { low: 26, medium: 34, high: 42 }[q]
						: r.role === 'liana'
							? settings.tallFar
							: settings.far;
				r.pool.distanceBand = { min: 0, max: far };
				r.pool.lod = [
					{ until: settings.near, keep: 1 },
					{ until: far, keep: 0.4 }
				];
			}
		};
		setQuality(quality);
		const onAbort = () => clean();
		host.signal.addEventListener('abort', onAbort, { once: true });
		const ownedPools = pools;
		return {
			object: pools.object,
			pools,
			replaces,
			setQuality,
			debug() {
				const byRole: Partial<Record<VegetationRole, number>> = {};
				let instances = 0,
					visible = 0;
				for (const r of records) {
					instances += r.ids.length;
					visible += r.pool.count;
					byRole[r.role] = (byRole[r.role] ?? 0) + r.ids.length;
				}
				return {
					look,
					quality,
					assets: names.length,
					failed: [...failed].sort(),
					planned: plan.placements.length,
					instances,
					visible,
					draws: ownedPools.drawCalls,
					triangles: ownedPools.triangles,
					textureBytes: residentTextureBytes(ownedPools.object),
					eligibleArea: plan.eligibleArea,
					byRole
				};
			},
			dispose() {
				host.signal.removeEventListener('abort', onAbort);
				clean();
			}
		};
	} catch (error) {
		clean();
		throw error;
	}
}
