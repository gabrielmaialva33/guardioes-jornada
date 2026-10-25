import { Box3, BoxGeometry, CylinderGeometry, Group, Mesh, MeshLambertMaterial } from 'three';
import araucaria from '../assets/models/custom-araucaria.glb?url';
import embauba from '../assets/models/custom-embauba.glb?url';
import ipeAmarelo from '../assets/models/custom-ipe-amarelo.glb?url';
import ipeRosa from '../assets/models/custom-ipe-rosa.glb?url';
import jequitiba from '../assets/models/custom-jequitiba-rosa.glb?url';
import jucara from '../assets/models/custom-palmeira-jucara.glb?url';
import xaxim from '../assets/models/custom-xaxim.glb?url';
import flora from '../assets/models/kit-flora.glb?url';
import {
	addPlacements,
	type BlockGrid,
	createPoolsFromScene,
	type LodCategory,
	lodProfilesFor,
	type Quality
} from '../render/index.ts';
import { disposeModel, loadModel } from '../scene/avatar.ts';
import { RAMPS } from '../style/palette.ts';
import type { SurvivalWorld } from '../survival/types.ts';

const treeFiles: Record<string, string> = {
	araucaria,
	embauba,
	'ipe-amarelo': ipeAmarelo,
	'ipe-rosa': ipeRosa,
	jequitiba,
	jucara,
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
	bromelia: 'crops_leafsStageA',
	'beach-grass': 'grass_leafsLarge'
};
/** One pool per species/kind, shared across all sixteen blocks; capacity follows the actual world. */
export async function loadWorldPlacements(
	grid: BlockGrid,
	quality: Quality,
	world: SurvivalWorld,
	signal: AbortSignal
) {
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
			['cover', world.decorations, 'cover']
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
					if (family === 'tree' && treeFiles[kind]) model = await loadModel(treeFiles[kind], signal);
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
		const profiles = lodProfilesFor(quality);
		const pools = createPoolsFromScene(source, names, {
			grid,
			capacity,
			lod: Object.fromEntries(names.map((n) => [n, profiles[categories[n]]])),
			material: 'house'
		});
		try {
			for (const [family, placements] of [
				['tree', world.trees],
				['rock', world.rocks],
				['cover', world.decorations]
			] as const)
				addPlacements(placements, (kind) => pools.get(`${family}:${kind}`), {
					scaleFor: (kind) => scales[`${family}:${kind}`]
				});
		} catch (error) {
			pools.dispose();
			throw error;
		}
		return {
			pools,
			setQuality(q: Quality) {
				const p = lodProfilesFor(q);
				for (const [name, pool] of pools.pools) pool.lod = p[categories[name]];
			},
			dispose() {
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
