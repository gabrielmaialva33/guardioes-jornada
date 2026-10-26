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
it('preserves a bromelia flower atlas while tinting only grass from the terrain', async () => {
	const { houseMaterial } = await import('./materials.ts');
	const { DataTexture } = await import('three');
	const texture = new DataTexture(new Uint8Array([255, 90, 90, 255]), 1, 1),
		source = new MeshLambertMaterial({ map: texture });
	source.userData = { vegetation: true, cover: true };
	const flower = houseMaterial(source);
	expect(flower.map).toBe(texture);
	expect(flower.flatShading).toBe(false);
	source.userData.groundTint = true;
	const grass = houseMaterial(source);
	expect(grass.map).toBeNull();
	source.dispose();
	flower.dispose();
	grass.dispose();
	texture.dispose();
});
