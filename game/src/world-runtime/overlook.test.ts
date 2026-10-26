import { Box3, Ray, Vector3 } from 'three';
import { expect, it } from 'vitest';
import { CollisionWorld } from '../engine/world.ts';
import { propGeometry } from './collision.ts';
import { overlookColliders, overlookGeometry } from './overlook.ts';

it('keeps the approved deck flush at 15 and the west zipline gap clear', () => {
	const parts = overlookColliders(),
		geometries = parts.map(propGeometry),
		world = new CollisionWorld(geometries.map((geometry) => ({ geometry })));
	const down = new Ray(new Vector3(129, 20, 84), new Vector3(0, -1, 0));
	expect(world.raycast(down, 10)).toBeCloseTo(5, 5);
	const west = new Ray(new Vector3(127, 15.6, 84), new Vector3(1, 0, 0));
	expect(world.raycast(west, 2)).toBeNull();
	west.origin.z = 82;
	expect(world.raycast(west, 2)).not.toBeNull();
	// Ledge arrival and portal spur remain outside every added support/rail.
	for (const [x, z] of [
		[128.6, 78],
		[134, 72],
		[158, 70]
	]) {
		down.origin.set(x, 20, z);
		expect(world.raycast(down, 10)).toBeNull();
	}
	for (const g of geometries) g.dispose();
	world.dispose();
});
it('batches the deck into the existing trail material with native wood colours and no trail-edge fade', () => {
	const g = overlookGeometry();
	g.computeBoundingBox();
	const b = g.boundingBox ?? new Box3();
	expect(b.min.x).toBeGreaterThanOrEqual(127.9);
	expect(b.max.x).toBeLessThanOrEqual(134.1);
	expect(g.getAttribute('color').count).toBe(g.getAttribute('position').count);
	const positions = g.getAttribute('position');
	for (let i = 0; i < 240; i++) expect(positions.getY(i)).toBeLessThanOrEqual(15);
	const trail = g.getAttribute('trail');
	expect(trail.count).toBe(g.getAttribute('position').count);
	for (let i = 0; i < trail.count; i++) expect(trail.getY(i)).toBe(0);
	g.dispose();
});
