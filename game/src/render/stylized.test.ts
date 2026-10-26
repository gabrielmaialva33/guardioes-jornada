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
it('receives canopy shade on terrain and ground cover but not on the tree canopy itself', () => {
	const source = () => ({
		vertexShader: ShaderLib.lambert.vertexShader,
		fragmentShader: ShaderLib.lambert.fragmentShader,
		uniforms: {} as Record<string, { value: unknown }>
	});
	const ground = source(),
		tree = source(),
		cover = source();
	patchStylizedShader(ground, { vegetation: true, terrain: true });
	patchStylizedShader(tree, { vegetation: true });
	patchStylizedShader(cover, { vegetation: true, cover: true });
	expect(ground.uniforms.uShadeReceiver.value).toBe(1);
	expect(cover.uniforms.uShadeReceiver.value).toBe(1);
	expect(tree.uniforms.uShadeReceiver.value).toBe(0);
});
it('keeps another shader extension in the program cache key', () => {
	const material = new MeshLambertMaterial();
	material.customProgramCacheKey = () => 'wind-version-1';
	material.onBeforeCompile = (shader) => {
		shader.vertexShader += '\n// wind-extension';
	};
	stylize(material, { vegetation: true });
	expect(material.customProgramCacheKey()).toContain('wind-version-1');
	material.dispose();
});

it('lets native understorey receive canopy shade while preserving its volume normals', () => {
	const shader = {
		vertexShader: ShaderLib.lambert.vertexShader,
		fragmentShader: ShaderLib.lambert.fragmentShader,
		uniforms: {}
	};
	patchStylizedShader(shader, { vegetation: true, cover: false, shadeReceiver: true });
	expect((shader.uniforms as Record<string, { value: unknown }>).uShadeReceiver.value).toBe(1);
	expect(shader.vertexShader).not.toContain('objectNormal = vec3(0.,1.,0.);');
});
