import { InstancedMesh, Mesh, PerspectiveCamera } from 'three';
import { expect, it, vi } from 'vitest';
import { createAtmosphere } from './atmosphere.ts';

it('keeps its fog-free horizon inside each tier far plane without changing gameplay camera position', () => {
	const a = createAtmosphere(160),
		camera = new PerspectiveCamera(70, 20 / 9, 0.1, 70);
	camera.position.set(80, 5, 80);
	a.update(camera, 10, 'low', 'day');
	expect(a.sky.position.toArray()).toEqual(camera.position.toArray());
	let draws = 0,
		tri = 0;
	a.object.traverse((node) => {
		if (node instanceof Mesh) {
			draws++;
			tri += (node.geometry.index?.count ?? node.geometry.getAttribute('position').count) / 3;
		}
	});
	expect(draws).toBeLessThanOrEqual(8);
	expect(tri).toBeLessThan(5000);
	expect(camera.position.toArray()).toEqual([80, 5, 80]);
	const cloud = a.sky.children.find((n) => n instanceof InstancedMesh);
	if (!cloud) throw new Error('cloud fixture');
	const cloudDispose = vi.spyOn(cloud, 'dispose');
	const dispose = vi.spyOn(a.cloudTexture, 'dispose');
	a.dispose();
	a.dispose();
	expect(dispose).toHaveBeenCalledOnce();
	expect(cloudDispose).toHaveBeenCalledOnce();
});
