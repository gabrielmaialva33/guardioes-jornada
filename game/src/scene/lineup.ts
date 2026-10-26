/** Deterministic WebGL lineup, available only through the gated golden hook. */
import { BoxGeometry, Group, Mesh } from 'three';
import { CollisionWorld } from '../engine/world.ts';
import { BlockGrid, createPoolsFromScene, houseMaterial } from '../render/index.ts';
import { lighting } from '../render/stylized.ts';
import { disposeModel, loadModel } from './avatar.ts';
import type { SceneEnvironment } from './environment.ts';
import { ensureVertexColors, paletteMaterial } from './materials.ts';

const files = import.meta.glob<string>(
	[
		'../assets/models/custom-araucaria.glb',
		'../assets/models/custom-embauba.glb',
		'../assets/models/custom-jequitiba-rosa.glb',
		'../assets/models/custom-palmeira-jucara.glb',
		'../assets/models/custom-ipe-amarelo.glb',
		'../assets/models/custom-ipe-rosa.glb',
		'../assets/models/custom-xaxim.glb',
		'../assets/models/custom-bromelia.glb',
		'../assets/models/custom-viveiro.glb',
		'../assets/models/custom-muda-etapa-3.glb'
	],
	{ eager: true, query: '?url', import: 'default' }
);
export function createLineupEnvironment(): SceneEnvironment {
	const g = new BoxGeometry(100, 0.2, 60).translate(40, -0.1, 20),
		collision = new CollisionWorld([{ geometry: g }]);
	g.dispose();
	const grid = BlockGrid.covering(-20, -20, 100, 80),
		spawn = { x: 2, y: 0, z: 25 };
	const start = { id: 'lineup', spawn, yaw: 0, min: { x: 0, y: -1, z: 23 }, max: { x: 4, y: 4, z: 27 } };
	return {
		kind: 'graybox',
		start,
		checkpoints: [],
		collision,
		grid,
		placements: Object.keys(files).length,
		target: { ...spawn, name: 'Escala de 3 unidades' },
		nextTarget() {},
		createVisual() {
			lighting.uShadeEnabled.value = 0;
			const object = new Group(),
				geometry = new BoxGeometry(100, 0.2, 60).translate(40, -0.1, 20),
				material = paletteMaterial('#8e9b92');
			ensureVertexColors(geometry);
			object.add(new Mesh(geometry, material));
			const bar = new BoxGeometry(0.15, 3, 0.15).translate(4, 1.5, 25),
				barMaterial = paletteMaterial('#5e4330');
			ensureVertexColors(bar);
			object.add(new Mesh(bar, barMaterial));
			return {
				object,
				dispose() {
					for (const g of [geometry, bar]) g.dispose();
					for (const m of [material, barMaterial]) {
						m.map?.dispose();
						m.dispose();
					}
					object.clear();
					object.removeFromParent();
				}
			};
		},
		async loadPlacements(_quality, signal) {
			const source = new Group(),
				names: string[] = [];
			try {
				for (const [i, [path, url]] of Object.entries(files).entries()) {
					const model = await loadModel(url, signal);
					model.name = `lineup-${i}`;
					source.add(model);
					names.push(model.name);
					model.traverse((n) => {
						if (n instanceof Mesh)
							for (const m of Array.isArray(n.material) ? n.material : [n.material])
								m.userData.vegetation = !path.includes('viveiro');
					});
				}
				const pools = createPoolsFromScene(source, names, {
					grid,
					capacity: 1,
					material: (s) => houseMaterial(s, { vegetation: s.userData.vegetation === true })
				});
				for (const [i, name] of names.entries()) pools.get(name)?.addPlaced(9 + i * 6, 0, 20, 1, 0, 1);
				return {
					pools,
					dispose() {
						pools.dispose();
						disposeModel(source);
					}
				};
			} catch (e) {
				disposeModel(source);
				throw e;
			}
		}
	};
}
