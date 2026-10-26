import {
	Box3,
	BoxGeometry,
	CylinderGeometry,
	Group,
	type Material,
	Mesh,
	MeshLambertMaterial,
	type Object3D,
	Vector3
} from 'three';
import flora from '../assets/models/kit-flora.glb?url';
import type { StoryLevel, Trail } from '../level/types.ts';
import { applyWind, CROWNS, WIND, type WindOptions } from '../life/index.ts';
import { CanopyVisibility, type CanopyVolume } from '../render/canopy-visibility.ts';
import {
	addPlacements,
	type BlockGrid,
	createPoolsFromScene,
	type PoolSet,
	type Quality
} from '../render/index.ts';
import { disposeModel, loadModel } from '../scene/avatar.ts';
import { SharedModelTextures } from '../scene/shared-textures.ts';
import type { StudyVegetation } from '../study/vegetation.ts';
import { RAMPS } from '../style/palette.ts';
import { type Placements, type SurvivalWorld, TREE_SPECIES } from '../survival/types.ts';
import { geometryRanges, renderAssetPlan } from './asset-plan.ts';
import { applyFlow } from './flow.ts';
import { coverScale, MODEL_FILES, TREE_MODELS, TREE_NODES } from './model-catalog.ts';
import {
	createPlacementRoute,
	modelCapacity,
	type PlacementModel,
	STREAM_COVER_KINDS,
	STREAM_ROCK_KINDS
} from './streaming/placement-route.ts';
import { treeDepth } from './tree-depth.ts';
import { createTreeImpostors, type TreePrototype } from './tree-impostors.ts';

type LoadedModel = PlacementModel;
/** One instanced pool per geometry/material/LOD; each stable placement uses exactly one geometry band. */
export async function loadWorldPlacements(
	grid: BlockGrid,
	quality: Quality,
	world: SurvivalWorld,
	signal: AbortSignal,
	_trails: readonly Trail[] = [],
	level?: StoryLevel,
	streaming?: { radius: number }
) {
	const plan = renderAssetPlan(world, level),
		source = new Group(),
		textures = new SharedModelTextures({
			'foliage-atlas': 256,
			'trees-atlas': 448,
			...(streaming ? { 'decor-atlas': 432 } : {})
		}),
		models: LoadedModel[] = [],
		prototypes: TreePrototype[] = [];
	let pools: PoolSet | undefined, impostors: ReturnType<typeof createTreeImpostors> | undefined;
	let study: StudyVegetation | null = null;
	let bank: ReturnType<typeof createPlacementRoute> | undefined;
	try {
		if (streaming) {
			// Preserve the source kind indices; append the catalog needed by chunks beyond the initial map.
			plan.trees = {
				...plan.trees,
				kinds: [...world.trees.kinds, ...TREE_SPECIES.filter((k) => !world.trees.kinds.includes(k))]
			};
			plan.rocks = {
				...plan.rocks,
				kinds: [...plan.rocks.kinds, ...STREAM_ROCK_KINDS.filter((k) => !plan.rocks.kinds.includes(k))]
			};
			plan.cover = {
				...plan.cover,
				kinds: [...plan.cover.kinds, ...STREAM_COVER_KINDS.filter((k) => !plan.cover.kinds.includes(k))]
			};
			if (!plan.scenery.kinds.includes('ground-waterfall'))
				plan.scenery = { ...plan.scenery, kinds: [...plan.scenery.kinds, 'ground-waterfall'] };
		}
		const batches = [
			['tree', plan.trees],
			['rock', plan.rocks],
			['cover', plan.cover],
			['scenery', plan.scenery]
		] as const;
		const kit = plan.rocks.kinds.includes('log') ? await loadModel(flora, signal) : undefined;
		if (kit) source.add(kit);
		for (const [family, placements] of batches) {
			const counts = new Map<string, number>(streaming ? placements.kinds.map((k) => [k, 0]) : []);
			for (let i = 0; i < placements.count; i++) {
				const k = placements.kinds[placements.kind[i]];
				counts.set(k, (counts.get(k) ?? 0) + 1);
			}
			const loads = await Promise.allSettled(
				[...counts].map(async ([kind, count]) => {
					const prefix = family === 'tree' ? TREE_NODES[kind] : kind,
						url = family === 'tree' ? (MODEL_FILES[prefix] ?? TREE_MODELS[kind]) : MODEL_FILES[kind];
					let raw: Group;
					if (url) raw = await loadModel(url, signal);
					else if (kind === 'log' && kit) {
						raw = new Group();
						const node = kit.getObjectByName('log_large');
						if (node) raw.add(node.clone(true));
					} else {
						raw = new Group();
						raw.add(
							new Mesh(
								family === 'tree'
									? new CylinderGeometry(1.3, 0.6, 8, 5).translate(0, 4, 0)
									: new BoxGeometry(1, 1, 1).translate(0, 0.5, 0),
								new MeshLambertMaterial({ color: RAMPS.rock[2] })
							)
						);
					}
					// Own the entire decoded scene, including the inactive LOD, before conversion can throw.
					raw.name = `source:${family}:${kind}`;
					source.add(raw);
					textures.adopt(raw);
					const petals = raw.getObjectByName('flores-caidas');
					if (petals instanceof Mesh) {
						petals.removeFromParent();
						petals.geometry.dispose();
					}
					const near: Object3D = raw.getObjectByName(`${prefix}-lod0`) ?? raw,
						far = raw.getObjectByName(`${prefix}-lod1`);
					const name = `${family}:${kind}`;
					near.name = name;
					if (far) far.name = `${name}:lod1`;
					const bounds = new Box3().setFromObject(near),
						height = bounds.max.y - bounds.min.y;
					const canopyBase = family === 'tree' ? bounds.min.y + height * 0.45 : undefined;
					let trunkRadius = 0.15;
					if (family === 'tree') {
						const point = new Vector3();
						near.traverse((node) => {
							if (!(node instanceof Mesh)) return;
							const positions = node.geometry.getAttribute('position');
							for (let i = 0; i < positions.count; i++) {
								point.fromBufferAttribute(positions, i).applyMatrix4(node.matrixWorld);
								if (point.y > bounds.min.y + height * 0.08 && point.y < bounds.min.y + height * 0.3)
									trunkRadius = Math.max(trunkRadius, Math.min(height * 0.09, Math.hypot(point.x, point.z)));
							}
						});
					}
					const converted = new Map<Material, Material>();
					raw.traverse((node) => {
						if (!(node instanceof Mesh)) return;
						const convert = (m: Material) => {
							const saved = converted.get(m);
							if (saved) return saved;
							const copy = m.clone();
							copy.userData = {
								...m.userData,
								vegetation: family === 'tree' || family === 'cover',
								shadeReceiver: family !== 'tree',
								cover: false,
								canopyBase
							};
							converted.set(m, copy);
							m.dispose();
							return copy;
						};
						node.material = Array.isArray(node.material)
							? node.material.map(convert)
							: convert(node.material);
					});
					const native = family === 'tree' || family === 'scenery',
						target =
							kind === 'log'
								? 0.6
								: kind.startsWith('ground-shore')
									? 1.1
									: kind.includes('polyone-01') || kind.includes('polyone-02') || kind.includes('polyone-06')
										? 0.3
										: 1.1;
					const scale = native ? 1 : family === 'cover' ? coverScale(kind) : target / Math.max(0.01, height);
					const crown = Object.entries(CROWNS).find(([key]) => key === kind)?.[1];
					const wind: WindOptions | undefined =
						family === 'tree'
							? {
									amplitude: WIND.canopySway,
									from: crown?.model ? crown.base : (canopyBase ?? 0),
									to: crown?.model ? crown.top : bounds.max.y,
									sample: 'origin'
								}
							: family === 'cover' && !kind.startsWith('bromelia')
								? {
										amplitude: Math.min(WIND.grassSway, height * 0.1),
										from: kind.startsWith('ground-sand') ? 0.25 : bounds.min.y,
										to: bounds.max.y,
										sample: 'vertex'
									}
								: undefined;
					models.push({
						family,
						kind,
						near: name,
						far: far?.name,
						bounds,
						scale,
						count: streaming ? Math.max(count, modelCapacity(family, kind, streaming.radius)) : count,
						wind,
						canopyBase,
						trunkRadius
					});
					if (family === 'tree') prototypes.push({ kind, model: near, bounds });
				})
			);
			for (const load of loads) if (load.status === 'rejected') throw load.reason;
		}
		signal.throwIfAborted();
		const names = models.flatMap((m) => (m.far ? [m.near, m.far] : [m.near])),
			capacity = Object.fromEntries(
				models.flatMap((m) =>
					m.far
						? [
								[m.near, m.count],
								[m.far, m.count]
							]
						: [[m.near, m.count]]
				)
			);
		pools = createPoolsFromScene(source, names, {
			grid,
			capacity,
			colors: true,
			fades: true,
			material: 'house'
		});
		const ownedPools = pools;
		const applyBands = (q: Quality) => {
			for (const m of models) {
				const ranges = geometryRanges(q, m.family);
				ownedPools.get(m.near).distanceBand = { min: 0, max: m.far ? ranges.near : ranges.far };
				if (m.far) ownedPools.get(m.far).distanceBand = { min: ranges.near, max: ranges.far };
			}
		};
		applyBands(quality);
		for (const m of models)
			for (const name of m.far ? [m.near, m.far] : [m.near]) {
				const pool = pools.get(name);
				for (const mesh of pool.meshes) {
					const material = mesh.material;
					if (!(material instanceof MeshLambertMaterial)) continue;
					if (m.wind && !material.userData.lifeWind) applyWind(material, m.wind);
					if (m.kind === 'ground-waterfall') applyFlow(material);
					if (m.canopyBase !== undefined && m.wind)
						mesh.customDepthMaterial = treeDepth(material, m.canopyBase, m.wind);
				}
			}
		if (streaming) {
			prototypes.sort((a, b) => a.kind.localeCompare(b.kind));
			impostors = createTreeImpostors(prototypes, { ...world.trees, count: 0 }, quality, {
				capacity: TREE_SPECIES.reduce((n, kind) => n + modelCapacity('tree', kind, streaming.radius), 0)
			});
			ownedPools.object.add(impostors.object);
			const ownedImpostors = impostors;
			bank = createPlacementRoute(ownedPools, models, quality, {
				impostors: ownedImpostors,
				scenery: plan.scenery
			});
			const ownedBank = bank;
			return {
				pools: ownedPools,
				stream: ownedBank,
				canopies: ownedBank.canopies,
				stats() {
					let near = 0,
						far = 0;
					for (const m of models) {
						near += ownedPools.get(m.near).count;
						if (m.far) far += ownedPools.get(m.far).count;
					}
					return { near, far, overlap: 0, atlasTextures: textures.count };
				},
				setQuality(q: Quality) {
					ownedBank.setQuality(q);
				},
				dispose() {
					ownedBank.dispose();
					ownedImpostors.dispose();
					ownedPools.object.removeFromParent();
					ownedPools.dispose();
					disposeModel(source);
				}
			};
		}
		const crowns: CanopyVolume[] = [];
		for (const [family, placements] of batches) {
			const byKind = new Map(models.filter((m) => m.family === family).map((m) => [m.kind, m]));
			const scaleFor = (kind: string) => byKind.get(kind)?.scale ?? 1;
			const ids = addPlacements(
				placements,
				(k) => {
					const m = byKind.get(k);
					return m ? pools?.get(m.near) : undefined;
				},
				{ scaleFor }
			);
			addPlacements(
				placements,
				(k) => {
					const m = byKind.get(k);
					return m?.far ? pools?.get(m.far) : undefined;
				},
				{ scaleFor }
			);
			if (family === 'tree')
				for (let i = 0; i < placements.count; i++) {
					const m = byKind.get(placements.kinds[placements.kind[i]]),
						id = ids[i];
					if (!m || id < 0) continue;
					const near = pools.get(m.near),
						far = m.far ? pools.get(m.far) : undefined,
						k = placements.scale[i] * m.scale,
						b = m.bounds,
						bottom = m.canopyBase ?? b.min.y,
						r = Math.max(b.max.x - b.min.x, b.max.z - b.min.z) * 0.5 * k;
					crowns.push({
						x:
							placements.x[i] +
							((b.min.x + b.max.x) * 0.5 * placements.yawC[i] +
								(b.min.z + b.max.z) * 0.5 * placements.yawS[i]) *
								k,
						z:
							placements.z[i] +
							(-(b.min.x + b.max.x) * 0.5 * placements.yawS[i] +
								(b.min.z + b.max.z) * 0.5 * placements.yawC[i]) *
								k,
						y: placements.y[i] + (bottom + b.max.y) * 0.5 * k,
						rx: r,
						rz: r,
						ry: Math.max(0.3, (b.max.y - bottom) * 0.5 * k),
						id,
						trunk: {
							x: placements.x[i],
							z: placements.z[i],
							bottom: placements.y[i] + b.min.y * k,
							top: placements.y[i] + bottom * k,
							radius: m.trunkRadius * k + 0.1
						},
						setFade: (id, opacity) => {
							near.setFade(id, opacity);
							return far ? far.setFade(id, opacity) : true;
						}
					});
				}
		}
		// A stable atlas layout avoids mip/filter differences caused by async decode completion order.
		prototypes.sort((a, b) => a.kind.localeCompare(b.kind));
		impostors = createTreeImpostors(prototypes, world.trees, quality);
		pools.object.add(impostors.object);
		const ownedImpostors = impostors;
		if (import.meta.env.DEV) {
			const { studyEnabled } = await import('../study/gate.ts');
			if (studyEnabled()) {
				const { loadStudyVegetation } = await import('../study/vegetation.ts');
				study = await loadStudyVegetation({ grid, quality, world, signal, level, existingPools: ownedPools });
				if (study) ownedPools.object.add(study.object);
			}
		}
		signal.throwIfAborted();
		return {
			pools,
			canopies: new CanopyVisibility(crowns),
			stats() {
				let near = 0,
					far = 0,
					overlap = 0;
				for (const m of models) {
					const a = ownedPools.get(m.near);
					near += a.count;
					if (!m.far) continue;
					const b = ownedPools.get(m.far);
					far += b.count;
					const ids = new Set<number>();
					for (let i = 0; i < a.count; i++) ids.add(a.idAt(i));
					for (let i = 0; i < b.count; i++) if (ids.has(b.idAt(i))) overlap++;
				}
				return { near, far, overlap, atlasTextures: textures.count, study: study?.debug() };
			},
			setQuality(q: Quality) {
				applyBands(q);
				ownedImpostors.setQuality(q);
				study?.setQuality(q);
			},
			dispose() {
				study?.dispose();
				ownedImpostors.dispose();
				ownedPools.object.removeFromParent();
				ownedPools.dispose();
				disposeModel(source);
			}
		};
	} catch (error) {
		bank?.dispose();
		study?.dispose();
		impostors?.dispose();
		pools?.dispose();
		disposeModel(source);
		throw error;
	}
}
/** Render-only filtering: the authoritative collision description is never changed. */
export function withoutPlacement<K extends string>(source: Placements<K>, index: number): Placements<K> {
	if (index < 0) return source;
	const keep = Array.from({ length: source.count }, (_, i) => i).filter((i) => i !== index);
	const floats = (key: 'x' | 'y' | 'z' | 'scale' | 'yawC' | 'yawS') =>
		Float32Array.from(keep.map((i) => source[key][i]));
	return {
		kinds: source.kinds,
		count: keep.length,
		kind: Uint8Array.from(keep.map((i) => source.kind[i])),
		block: Uint8Array.from(keep.map((i) => source.block[i])),
		x: floats('x'),
		y: floats('y'),
		z: floats('z'),
		scale: floats('scale'),
		yawC: floats('yawC'),
		yawS: floats('yawS')
	};
}
