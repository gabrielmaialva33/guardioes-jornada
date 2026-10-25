import { Box3, Mesh, Vector3 } from 'three';
import { expect, it } from 'vitest';
import { createGraybox, proxyGeometry } from '../engine/graybox.ts';
import { forestLayout } from './forest-layout.ts';
import { createGrayboxVisual } from './graybox-visual.ts';

it('merges proxies into four materials without changing triangle count or world bounds', () => {
	const level = createGraybox();
	const bounds = new Box3();
	let triangles = 0;
	for (const proxy of level.proxies) {
		const geometry = proxyGeometry(proxy);
		geometry.computeBoundingBox();
		if (geometry.boundingBox) bounds.union(geometry.boundingBox);
		triangles += (geometry.index?.count ?? geometry.getAttribute('position').count) / 3;
		geometry.dispose();
	}
	const visual = createGrayboxVisual(level);
	expect(visual.object.children).toHaveLength(4);
	let actualTriangles = 0;
	visual.object.traverse((object) => {
		if (object instanceof Mesh) actualTriangles += object.geometry.index.count / 3;
	});
	expect(actualTriangles).toBe(triangles);
	const actual = new Box3().setFromObject(visual.object);
	expect(actual.min.distanceTo(bounds.min)).toBeLessThan(1e-5);
	expect(actual.max.distanceTo(bounds.max)).toBeLessThan(1e-5);
	visual.dispose();
});
it('keeps forest trunks collidable and outside the spawn/obby lane, without drawing proxy boxes', () => {
	const forest = forestLayout();
	expect(forest.placements.count).toBe(21);
	for (let i = 0; i < forest.placements.count; i++) {
		const p = new Vector3(forest.placements.x[i], 0, forest.placements.z[i]);
		expect(Math.abs(p.x) >= 12 || p.z < -20).toBe(true);
		expect(forest.placements.scale[i]).toBe(1);
		expect(forest.colliders[i].name.startsWith('forest-trunk-')).toBe(true);
	}
	const level = createGraybox();
	level.proxies.push(...forest.colliders);
	const visual = createGrayboxVisual(level);
	expect(visual.object.children).toHaveLength(4);
	visual.dispose();
});
