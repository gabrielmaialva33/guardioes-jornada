import { MeshDepthMaterial, type MeshLambertMaterial, RGBADepthPacking } from 'three';
import { applyWind, type WindOptions } from '../life/index.ts';
import { patchTreeVisibility } from '../render/stylized.ts';
/** Same cut-out map, side, sway and canopy visibility as the colour pass. */
export function treeDepth(material: MeshLambertMaterial, base: number, wind: WindOptions) {
	const depth = new MeshDepthMaterial({
		map: material.map,
		alphaTest: material.alphaTest,
		side: material.side,
		depthPacking: RGBADepthPacking
	});
	applyWind(depth, wind);
	const previous = depth.onBeforeCompile.bind(depth),
		key = depth.customProgramCacheKey();
	depth.onBeforeCompile = (shader, renderer) => {
		previous(shader, renderer);
		patchTreeVisibility(shader, base);
	};
	depth.customProgramCacheKey = () => `${key}|canopy-depth-v1`;
	return depth;
}
