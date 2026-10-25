import { DoubleSide, MeshLambertMaterial } from 'three';
import { ACCENT, RAMPS } from '../style/palette.ts';

/** Temporary look, isolated from geometry, physics and gameplay for the visual-v2 replacement. */
export function createMapMaterials() {
	const make = (color: string) => new MeshLambertMaterial({ color, vertexColors: true, flatShading: true });
	const materials = {
		ground: make('#ffffff'),
		rock: make(RAMPS.rock[2]),
		wood: make(RAMPS.wood[2]),
		proxy: make(RAMPS.rock[1]),
		checkpoint: make(ACCENT.gold),
		water: make(RAMPS.water[1]),
		arrow: make(ACCENT.gold)
	};
	materials.water.side = DoubleSide;
	materials.arrow.depthTest = false;
	materials.arrow.depthWrite = false;
	return {
		...materials,
		dispose() {
			for (const material of Object.values(materials)) material.dispose();
		}
	};
}
