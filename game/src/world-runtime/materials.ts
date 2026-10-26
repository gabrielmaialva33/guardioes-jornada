import { DoubleSide, MeshLambertMaterial } from 'three';
import type { Trail } from '../level/types.ts';
import { stylize, visualStep } from '../render/stylized.ts';
import { ACCENT, RAMPS } from '../style/palette.ts';
import type { SurvivalWorld } from '../survival/types.ts';
import { createSurfaces } from './surfaces.ts';

/** Shared stylized Lambert lighting; geometry, physics and gameplay never depend on it. */
export function createMapMaterials(world?: SurvivalWorld, trails: readonly Trail[] = []) {
	const surfaces = createSurfaces(world, trails);
	const make = (color: string) =>
		stylize(new MeshLambertMaterial({ color, vertexColors: true, flatShading: true }));
	const materials = {
		ground: stylize(new MeshLambertMaterial({ color: '#ffffff', vertexColors: true, flatShading: true }), {
			vegetation: true,
			terrain: visualStep() >= 2
		}),
		path: make('#ffffff'),
		rock: make(RAMPS.rock[2]),
		wood: make(RAMPS.wood[2]),
		proxy: make(RAMPS.rock[1]),
		checkpoint: make(ACCENT.gold),
		water: make('#ffffff'),
		arrow: make(ACCENT.gold)
	};
	for (const [key, kind] of visualStep() >= 1
		? ([
				['ground', 'ground'],
				['path', 'trail'],
				['water', 'water']
			] as const)
		: []) {
		const material = materials[key],
			previous = material.onBeforeCompile.bind(material),
			cacheKey = material.customProgramCacheKey();
		material.onBeforeCompile = (shader, renderer) => {
			previous(shader, renderer);
			surfaces.patch(shader, kind);
		};
		material.customProgramCacheKey = () => `${cacheKey}|surface-v2:${kind}`;
	}
	materials.water.side = DoubleSide;
	materials.path.polygonOffset = true;
	materials.path.polygonOffsetFactor = -1;
	materials.path.polygonOffsetUnits = -2;
	materials.arrow.depthTest = false;
	materials.arrow.depthWrite = false;
	return {
		...materials,
		textures: surfaces.textures,
		field: surfaces.field,
		setField: surfaces.setField,
		load: (signal: AbortSignal) => (visualStep() >= 1 ? surfaces.load(signal) : Promise.resolve()),
		dispose() {
			surfaces.dispose();
			for (const material of Object.values(materials)) material.dispose();
		}
	};
}
