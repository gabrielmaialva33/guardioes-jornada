import { BufferGeometry, Float32BufferAttribute, Mesh, MeshLambertMaterial, PerspectiveCamera } from 'three';
import { expect, it, vi } from 'vitest';
import { SurfaceBatch } from './surface-batch.ts';

it('packs only visible chunks into one bounded surface draw and borrows its material', () => {
	const material = new MeshLambertMaterial(),
		dispose = vi.spyOn(material, 'dispose');
	const batch = new SurfaceBatch(material, 'water', 24);
	const geometry = new BufferGeometry();
	geometry.setAttribute('position', new Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 0, 1], 3));
	geometry.setAttribute('color', new Float32BufferAttribute(new Float32Array(9).fill(1), 3));
	geometry.setAttribute('normal', new Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
	geometry.setAttribute('water', new Float32BufferAttribute([-0.5, 1, -0.5, 1, -0.5, 1], 2));
	geometry.computeBoundingSphere();
	const a = new Mesh(geometry, material),
		b = new Mesh(geometry, material);
	b.position.x = 2;
	batch.add(a);
	batch.add(b);
	const camera = new PerspectiveCamera(70, 1, 0.1, 20);
	camera.position.set(1, 5, 5);
	camera.lookAt(1, 0, 0);
	camera.updateMatrixWorld();
	batch.sync(camera);
	expect(batch.object.geometry.drawRange.count).toBe(6);
	expect(a.visible).toBe(false);
	expect(b.visible).toBe(false);
	expect(batch.object.geometry.getAttribute('position').getX(3)).toBe(2);
	b.position.x = 100;
	batch.sync(camera);
	expect(batch.object.geometry.drawRange.count).toBe(3);
	batch.remove(a);
	batch.sync(camera);
	expect(batch.object.visible).toBe(false);
	batch.dispose();
	expect(dispose).not.toHaveBeenCalled();
	geometry.dispose();
	material.dispose();
});
