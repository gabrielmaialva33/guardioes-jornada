import { expect, it } from 'vitest';
import { buildStoryWorld } from '../level/build.ts';
import { cliffDressing } from './cliff.ts';

it('batches visual cliff relief without changing heights or entering the authored jump supports', () => {
	const { world, level } = buildStoryWorld(),
		heights = world.heights.slice();
	let triangles = 0;
	for (const block of world.blocks) {
		const g = cliffDressing(world, block, level);
		if (!g) continue;
		const p = g.getAttribute('position');
		triangles += (g.index?.count ?? 0) / 3;
		for (const attribute of ['normal', 'color', 'shore'])
			expect(g.getAttribute(attribute).count).toBe(p.count);
		for (let i = 0; i < p.count; i++)
			for (const o of level.obbies)
				for (const ledge of o.pieces)
					expect(Math.hypot(p.getX(i) - ledge.x, p.getZ(i) - ledge.z)).toBeGreaterThan(ledge.radius + 1);
		g.dispose();
	}
	expect(triangles).toBeGreaterThan(100);
	expect(triangles).toBeLessThan(2000);
	expect(world.heights).toEqual(heights);
});
