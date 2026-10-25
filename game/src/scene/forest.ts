import { Box3 } from 'three';
import araucaria from '../assets/models/custom-araucaria.glb?url';
import embauba from '../assets/models/custom-embauba.glb?url';
import ipeAmarelo from '../assets/models/custom-ipe-amarelo.glb?url';
import ipeRosa from '../assets/models/custom-ipe-rosa.glb?url';
import jequitiba from '../assets/models/custom-jequitiba-rosa.glb?url';
import jucara from '../assets/models/custom-palmeira-jucara.glb?url';
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
	// Assets are produced concurrently: prefer the merged kit, with the same native GLBs as fallback.
	const customFiles: Record<ForestKind, string> = {
		embauba,
		'jequitiba-rosa': jequitiba,
		'ipe-amarelo': ipeAmarelo,
		'ipe-rosa': ipeRosa,
		'palmeira-jucara': jucara,
		araucaria
	};

	try {
		await Promise.all(
			FOREST_KINDS.map(async (name) => {
				if (source.getObjectByName(name)) return;
				const model = await loadModel(customFiles[name], signal);
				model.name = name;
				source.add(model);
			})
		);
		signal.throwIfAborted();
		const scale = new Map<ForestKind, number>();
		for (const name of FOREST_KINDS) {
			const node = source.getObjectByName(name);
			if (!node) throw new Error('forest-node-missing');
			const bounds = new Box3().setFromObject(node);
			const height = bounds.max.y - bounds.min.y;
			if (!(height > 0)) throw new Error('forest-size-invalid');
			// Native models already carry the ART scale. Never stretch individual axes.
			scale.set(name, 1);
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
