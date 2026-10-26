import { DoubleSide, MeshLambertMaterial } from 'three';
import { stylize, visualStep } from '../render/stylized.ts';
import { ACCENT, RAMPS } from '../style/palette.ts';

/** Shared stylized Lambert lighting; geometry, physics and gameplay never depend on it. */
export function createMapMaterials() {
	const make = (color: string) =>
		stylize(new MeshLambertMaterial({ color, vertexColors: true, flatShading: true }));
	const materials = {
		ground: stylize(new MeshLambertMaterial({ color: '#ffffff', vertexColors: true, flatShading: true }), {
			vegetation: true,
			terrain: visualStep() >= 2
		}),
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
