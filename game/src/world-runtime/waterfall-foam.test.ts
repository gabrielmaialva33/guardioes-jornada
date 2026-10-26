import { InstancedMesh, PerspectiveCamera, ShaderMaterial } from 'three';
import { expect, it, vi } from 'vitest';
import { buildStoryWorld } from '../level/build.ts';
import { windUniforms } from '../life/wind.ts';
import { createWaterfallFoam } from './waterfall-foam.ts';

it('owns one texture-free batch, shares the reduced-motion strength and releases it once', () => {
	const { level } = buildStoryWorld(),
		foam = createWaterfallFoam(level),
		mesh = foam.object.children[0];
	if (!(mesh instanceof InstancedMesh) || !(mesh.material instanceof ShaderMaterial))
		throw new Error('foam batch');
	expect(mesh.count).toBe(24);
	expect(mesh.material.uniforms.uMotion).toBe(windUniforms.uWindStrength);
	expect(mesh.material.depthWrite).toBe(false);
	const camera = new PerspectiveCamera();
	camera.position.set(132, 8, 30);
	foam.update(camera);
	expect(foam.object.visible).toBe(true);
	camera.position.set(400, 8, 400);
	foam.update(camera);
	expect(foam.object.visible).toBe(false);
	const geometry = vi.spyOn(mesh.geometry, 'dispose'),
		material = vi.spyOn(mesh.material, 'dispose');
	foam.dispose();
	foam.dispose();
	expect(geometry).toHaveBeenCalledOnce();
	expect(material).toHaveBeenCalledOnce();
	expect(foam.object.children).toHaveLength(0);
});
