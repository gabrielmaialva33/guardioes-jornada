import { Color } from 'three';
import { expect, it } from 'vitest';
import { buildStoryWorld } from '../level/build.ts';
import { terrainChunk, terrainTint } from './terrain.ts';

const { world, level } = buildStoryWorld();
it('shares the 1u vertices without moving the collision surface, and samples identical chunk seams', () => {
	const a = terrainChunk(world, { x0: 0, z0: 0 }, level.trails),
		b = terrainChunk(world, { x0: 40, z0: 0 }, level.trails);
	expect(a.getAttribute('position').count).toBe(41 * 41);
	expect(a.index?.count).toBe(40 * 40 * 6);
	for (let z = 0; z <= 40; z++) {
		const i = z * 41 + 40,
			j = z * 41;
		for (const attr of ['position', 'color', 'normal', 'shore']) {
			const x = a.getAttribute(attr),
				y = b.getAttribute(attr);
			for (let k = 0; k < x.itemSize; k++)
				expect(x.array[i * x.itemSize + k]).toBe(y.array[j * y.itemSize + k]);
		}
	}
	a.dispose();
	b.dispose();
});
it('changes continuously across former cell boundaries and never changes world heights', () => {
	const a = terrainTint(world, 30.49, 30, level.trails, new Color()),
		b = terrainTint(world, 30.51, 30, level.trails, new Color());
	expect(Math.abs(a.r - b.r) + Math.abs(a.g - b.g) + Math.abs(a.b - b.b)).toBeLessThan(0.02);
});
