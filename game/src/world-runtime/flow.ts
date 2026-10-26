import { type MeshLambertMaterial, ShaderChunk, Vector4 } from 'three';
import { lighting, type ShaderSource } from '../render/stylized.ts';
export const WATERFALL_RECT = [0.25390625, 0.75390625, 0.2421875, 0.2421875] as const;
export function patchFlow(shader: ShaderSource) {
	shader.uniforms.uFlowTime = lighting.uVisualTime;
	shader.uniforms.uFlowRect = { value: new Vector4(...WATERFALL_RECT) };
	shader.fragmentShader = shader.fragmentShader.replace(
		'#include <common>',
		'#include <common>\nuniform float uFlowTime;uniform vec4 uFlowRect;'
	);
	shader.fragmentShader = shader.fragmentShader.replace(
		'#include <map_fragment>',
		ShaderChunk.map_fragment.replace(
			'vec4 sampledDiffuseColor = texture2D( map, vMapUv );',
			`vec2 localFlow=(vMapUv-uFlowRect.xy)/uFlowRect.zw;
localFlow.y=fract(localFlow.y+uFlowTime*.2);
vec2 flowUv=uFlowRect.xy+localFlow*uFlowRect.zw;
vec4 sampledDiffuseColor=texture2D(map,flowUv);`
		)
	);
}
export function applyFlow(material: MeshLambertMaterial) {
	if (material.userData.waterfallFlow) return;
	material.userData.waterfallFlow = true;
	const previous = material.onBeforeCompile.bind(material),
		key = material.customProgramCacheKey();
	material.onBeforeCompile = (s, r) => {
		previous(s, r);
		patchFlow(s);
	};
	material.customProgramCacheKey = () => `${key}|waterfall-cell-v1`;
}
