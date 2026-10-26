import { Box3, Group, Mesh } from 'three';
import araucaria from '../assets/models/custom-araucaria.glb?url';
import embauba from '../assets/models/custom-embauba.glb?url';
import ipeAmarelo from '../assets/models/custom-ipe-amarelo.glb?url';
import ipeRosa from '../assets/models/custom-ipe-rosa.glb?url';
import jequitiba from '../assets/models/custom-jequitiba-rosa.glb?url';
import jucara from '../assets/models/custom-palmeira-jucara.glb?url';
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
import { SharedModelTextures } from './shared-textures.ts';

export async function loadForest(
	grid: BlockGrid,
	quality: Quality,
	placements: PlacementArrays<ForestKind>,
	signal: AbortSignal
) {
	const source = new Group();
	// Custom Atlantic Forest models are the main trees; the Kenney kit is reserved for props.
	const customFiles: Record<ForestKind, string> = {
		embauba,
		'jequitiba-rosa': jequitiba,
		'ipe-amarelo': ipeAmarelo,
		'ipe-rosa': ipeRosa,
		'palmeira-jucara': jucara,
		araucaria
	};

	try {
		const textures = new SharedModelTextures();
		const loads = await Promise.allSettled(
			FOREST_KINDS.map(async (name) => {
				const model = await loadModel(customFiles[name], signal);
				textures.adopt(model);
				model.traverse((node) => {
					if (node instanceof Mesh)
						for (const m of Array.isArray(node.material) ? node.material : [node.material])
							m.userData.vegetation = true;
				});
				model.name = name;
				source.add(model);
			})
		);
		for (const load of loads) if (load.status === 'rejected') throw load.reason;
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
