import { expect, it } from 'vitest';
import { buildStoryWorld } from '../level/build.ts';
import { pathRibbon, terrainHeight } from './paths.ts';

const { world, level } = buildStoryWorld();
it('puts a bounded, irregular soil ribbon on the actual 1u terrain, without moving collision data', () => {
	const heights = world.heights.slice(),
		g = pathRibbon(world, level.trails),
		p = g.getAttribute('position');
	expect(p.count).toBeGreaterThan(100);
	expect((g.index?.count ?? 0) / 3).toBeLessThan(6000);
	for (let i = 0; i < p.count; i++)
		expect(p.getY(i) - terrainHeight(world, p.getX(i), p.getZ(i))).toBeCloseTo(0.035, 4);
	const normal = g.getAttribute('normal');
	for (let i = 0; i < normal.count; i++) expect(normal.getY(i)).toBeGreaterThan(0);
	expect(world.heights).toEqual(heights);
	g.dispose();
});
