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
it('keeps the western sea at world water height when the mirante camera rises, never over the lowland', () => {
	const a = createAtmosphere(160, 1.5),
		camera = new PerspectiveCamera();
	camera.position.set(155, 44, 80);
	a.update(camera, 10, 'low', 'day');
	a.object.updateMatrixWorld(true);
	const sea = a.object.getObjectByName('sea-west');
	expect(sea).toBeInstanceOf(Mesh);
	if (!(sea instanceof Mesh)) throw new Error('sea fixture');
	sea.geometry.computeBoundingBox();
	expect(sea.geometry.boundingBox?.max.x).toBe(0);
	expect(sea.geometry.boundingBox?.min.y).toBe(1.5);
	expect(sea.parent).toBe(a.object);
	expect(sea.matrixWorld.elements[13]).toBe(0);
	a.dispose();
});
