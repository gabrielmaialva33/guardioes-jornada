import { Box3 } from 'three';
import kitUrl from '../assets/models/kit-flora.glb?url';
import {
	addPlacements,
	type BlockGrid,
	createPoolsFromScene,
	lodProfilesFor,
	type PlacementArrays,
	type Quality
} from '../render/index.ts';
import { disposeModel, loadModel } from './avatar.ts';
import { FOREST_KINDS, type ForestKind } from './forest-layout.ts';

export async function loadForest(
	grid: BlockGrid,
	quality: Quality,
	placements: PlacementArrays<ForestKind>,
	signal: AbortSignal
) {
	const source = await loadModel(kitUrl, signal);
	try {
		const scale = new Map<ForestKind, number>();
		for (const name of FOREST_KINDS) {
			const node = source.getObjectByName(name);
			if (!node) throw new Error('forest-node-missing');
			const bounds = new Box3().setFromObject(node);
			const height = bounds.max.y - bounds.min.y;
			if (!(height > 0)) throw new Error('forest-size-invalid');
			// Canopy target 10.8 u, usually about ×9 for the Kenney kit. Uniform only.
			scale.set(name, 10.8 / height);
		}
		const pools = createPoolsFromScene(source, FOREST_KINDS, {
			grid,
			capacity: 32,
			lod: lodProfilesFor(quality).tree,
			colors: true,
			material: 'house'
		});
		try {
			addPlacements(placements, (kind) => pools.get(kind), { scaleFor: (kind) => scale.get(kind) ?? 9 });
		} catch (error) {
			pools.dispose();
			throw error;
		}
		return {
			pools,
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
