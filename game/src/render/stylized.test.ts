import { MeshLambertMaterial, ShaderLib } from 'three';
import { expect, it } from 'vitest';
import { patchStylizedShader, stylize } from './stylized.ts';

it('patches direct sun, hemisphere tint, instanced world positions and height fog without replacing shadow accumulation', () => {
	const shader = {
		vertexShader: ShaderLib.lambert.vertexShader,
		fragmentShader: ShaderLib.lambert.fragmentShader,
		uniforms: {}
	};
	patchStylizedShader(shader, { rim: true });
	expect(shader.fragmentShader).toContain('smoothstep( -0.15, 0.55');
	expect(shader.fragmentShader).toContain('uShadeMap');
	expect(shader.fragmentShader).toContain('uHemisphereGround');
	expect(shader.fragmentShader).toContain('#include <lights_fragment_begin>');
	expect(shader.fragmentShader).toContain('heightMist');
	expect(shader.vertexShader).toContain('instanceMatrix * stylizedWorld');
});
it('keeps props flat but accepts vegetation volume normals and composes previous hooks', () => {
	const prop = stylize(new MeshLambertMaterial());
	const foliage = stylize(new MeshLambertMaterial(), { vegetation: true });
	expect(prop.flatShading).toBe(true);
	expect(foliage.flatShading).toBe(false);
	expect(prop.customProgramCacheKey()).not.toBe(foliage.customProgramCacheKey());
	prop.dispose();
	foliage.dispose();
});
