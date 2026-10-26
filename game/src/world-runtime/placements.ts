import { Box3, BoxGeometry, CylinderGeometry, Group, Mesh, MeshLambertMaterial } from 'three';
import araucaria from '../assets/models/custom-araucaria.glb?url';
import bromelia from '../assets/models/custom-bromelia.glb?url';
import bromeliaRed from '../assets/models/custom-bromelia-centro-vermelho.glb?url';
import embauba from '../assets/models/custom-embauba.glb?url';
import ipeAmarelo from '../assets/models/custom-ipe-amarelo.glb?url';
import ipeRosa from '../assets/models/custom-ipe-rosa.glb?url';
import jequitiba from '../assets/models/custom-jequitiba-rosa.glb?url';
import jeriva from '../assets/models/custom-jeriva.glb?url';
import mangueVermelho from '../assets/models/custom-mangue-vermelho.glb?url';
import jucara from '../assets/models/custom-palmeira-jucara.glb?url';
import pauBrasil from '../assets/models/custom-pau-brasil.glb?url';
import xaxim from '../assets/models/custom-xaxim.glb?url';
import flora from '../assets/models/kit-flora.glb?url';
import type { Trail } from '../level/types.ts';
import { CanopyVisibility, type CanopyVolume } from '../render/canopy-visibility.ts';
import {
	addPlacements,
	type BlockGrid,
	createPoolsFromScene,
	type LodCategory,
	lodProfilesFor,
	type Quality
} from '../render/index.ts';
import { visualStep } from '../render/stylized.ts';
import { disposeModel, loadModel } from '../scene/avatar.ts';
import { RAMPS } from '../style/palette.ts';
import type { Placements, SurvivalWorld } from '../survival/types.ts';
import { detailDistances } from './far-field.ts';
import { terrainTint } from './terrain.ts';
import { createTreeImpostors, type TreePrototype } from './tree-impostors.ts';

const treeFiles: Record<string, string> = {
	araucaria,
	embauba,
	'ipe-amarelo': ipeAmarelo,
	'ipe-rosa': ipeRosa,
	jequitiba,
	jeriva,
	jucara,
	'mangue-vermelho': mangueVermelho,
	'pau-brasil': pauBrasil,
	xaxim
};
const props: Record<string, string> = {
	boulder: 'rock_largeA',
	stone: 'rock_largeA',
	log: 'log_large',
	grass: 'grass_leafsLarge',
	flower: 'flower_yellowA',
	bush: 'plant_bushLarge',
	fern: 'grass_leafsLarge',

	'beach-grass': 'grass_leafsLarge'
};
/** One pool per species/kind, shared across all sixteen blocks; capacity follows the actual world. */
export async function loadWorldPlacements(
	grid: BlockGrid,
	quality: Quality,
	world: SurvivalWorld,
	signal: AbortSignal,
	trails: readonly Trail[] = []
) {
	const decorations = {
		...world.decorations,
		kinds: [...world.decorations.kinds, 'bromelia-red'],
		kind: world.decorations.kind.slice()
	};
	for (let i = 0; i < decorations.count; i++)
		if (decorations.kinds[decorations.kind[i]] === 'bromelia' && i % 3 === 0)
			decorations.kind[i] = decorations.kinds.length - 1;
	const grassy = (kind: string) => ['grass', 'fern', 'beach-grass'].includes(kind);
	const prototypes: TreePrototype[] = [];
	const canopyBounds: Record<string, Box3> = {};
	const source = new Group(),
		categories: Record<string, LodCategory> = {},
		scales: Record<string, number> = {},
		capacity: Record<string, number> = {};
	try {
		const kit = await loadModel(flora, signal);
		source.add(kit);
		kit.visible = false;
		const names: string[] = [];
		for (const [family, placements, category] of [
			['tree', world.trees, 'tree'],
			['rock', world.rocks, 'rock'],
			['cover', decorations, 'cover']
		] as const) {
			const counts = new Map<string, number>();
			for (let i = 0; i < placements.count; i++) {
				const k = placements.kinds[placements.kind[i]];
				counts.set(k, (counts.get(k) ?? 0) + 1);
			}
			const loads = await Promise.allSettled(
				[...counts].map(async ([kind, count]) => {
					const name = `${family}:${kind}`;
					let model: Group | Mesh;
					if (family === 'cover' && kind.startsWith('bromelia'))
						model = await loadModel(kind === 'bromelia-red' ? bromeliaRed : bromelia, signal);
					else if (family === 'tree' && treeFiles[kind]) model = await loadModel(treeFiles[kind], signal);
					else if (family !== 'tree' && kit.getObjectByName(props[kind])) {
						const node = kit.getObjectByName(props[kind]);
						if (!node) throw new Error('flora-node');
						// Shared GLTF resources are owned once by source; the pool bakes its own geometry.
						model = new Group();
						model.add(node.clone(true));
					} else {
						const geometry =
							family === 'tree'
								? new CylinderGeometry(1.3, 0.6, 8, 5).translate(0, 4, 0)
								: new BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
						model = new Mesh(geometry, new MeshLambertMaterial({ color: RAMPS.rock[2] }));
					}
					const modelBounds = new Box3().setFromObject(model);
					if (family === 'tree') {
						canopyBounds[name] = modelBounds;
						prototypes.push({ kind, model, bounds: modelBounds });
					}
					if (family !== 'rock')
						model.traverse((node) => {
							if (node instanceof Mesh) {
								const convert = (m: import('three').Material) => {
									const copy = m.clone();
									copy.userData = {
										...copy.userData,
										vegetation: true,
										canopyBase:
											family === 'tree'
												? modelBounds.min.y + (modelBounds.max.y - modelBounds.min.y) * 0.45
												: undefined,
										cover: family === 'cover',
										groundTint: family === 'cover' && grassy(kind)
									};
									m.dispose();
									return copy;
								};
								node.material = Array.isArray(node.material)
									? node.material.map(convert)
									: convert(node.material);
							}
						});
					model.name = name;
					source.add(model);
					names.push(name);
					categories[name] = category;
					capacity[name] = count;
					const bounds = new Box3().setFromObject(model);
					const height = bounds.max.y - bounds.min.y;
					const target =
						kind === 'boulder'
							? 1.1
							: kind === 'log'
								? 0.6
								: kind === 'stone'
									? 0.25
									: kind === 'bush'
										? 1.3
										: 0.7;
					scales[name] = family === 'tree' ? 1 : target / Math.max(0.01, height);
				})
			);
			for (const load of loads) if (load.status === 'rejected') throw load.reason;
		}
		signal.throwIfAborted();
		// Hide the kit container only; cloned nodes are visible and use the house material.
		const profilesFor = (q: Quality) => {
			const r = detailDistances(q);
			return {
				tree: [{ until: r.trees + 8, keep: 1 }],
				rock: [
					{ until: r.terrain * 0.5, keep: 1 },
					{ until: r.terrain, keep: 0.5 }
				],
				cover: [
					{ until: q === 'low' ? 24 : 32, keep: 1 },
					{ until: q === 'low' ? 36 : 48, keep: 0.5 }
				],
				gameplay: lodProfilesFor(q).gameplay
			};
		};
		const profiles = profilesFor(quality);
		const pools = createPoolsFromScene(source, names, {
			grid,
			capacity,
			lod: Object.fromEntries(names.map((n) => [n, profiles[categories[n]]])),
			colors: true,
			fades: true,
			material: 'house'
		});
		const crowns: CanopyVolume[] = [];
		try {
			for (const [family, placements] of [
				['tree', world.trees],
				['rock', world.rocks],
				['cover', decorations]
			] as const) {
				const ids = addPlacements(placements, (kind) => pools.get(`${family}:${kind}`), {
					colorFor: (kind, i) =>
						family === 'cover' && grassy(kind) && visualStep() >= 1
							? terrainTint(world, placements.x[i], placements.z[i], trails)
							: null,
					scaleFor: (kind) => scales[`${family}:${kind}`]
				});
				if (family === 'tree')
					for (let i = 0; i < placements.count; i++) {
						const kind = placements.kinds[placements.kind[i]],
							name = `tree:${kind}`,
							bounds = canopyBounds[name],
							pool = pools.get(name),
							id = ids[i];
						if (!bounds || !pool || id < 0) continue;
						const k = placements.scale[i] * scales[name],
							bottom = bounds.min.y + (bounds.max.y - bounds.min.y) * 0.45;
						crowns.push({
							x: placements.x[i],
							z: placements.z[i],
							y: placements.y[i] + (bottom + bounds.max.y) * 0.5 * k,
							rx: Math.max(0.3, bounds.max.x - bounds.min.x, bounds.max.z - bounds.min.z) * 0.5 * k,
							rz: Math.max(0.3, bounds.max.x - bounds.min.x, bounds.max.z - bounds.min.z) * 0.5 * k,
							ry: Math.max(0.3, (bounds.max.y - bottom) * 0.5 * k),
							id,
							setFade: pool.setFade.bind(pool)
						});
					}
			}
		} catch (error) {
			pools.dispose();
			throw error;
		}
		const impostors = createTreeImpostors(prototypes, world.trees, quality);
		pools.object.add(impostors.object);
		return {
			pools,
			canopies: new CanopyVisibility(crowns),
			setQuality(q: Quality) {
				const p = profilesFor(q);
				impostors.setQuality(q);
				for (const [name, pool] of pools.pools) pool.lod = p[categories[name]];
			},
			dispose() {
				impostors.dispose();
				pools.object.removeFromParent();
				pools.dispose();
				disposeModel(source);
			}
		};
	} catch (error) {
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
