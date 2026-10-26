import { expect, it } from 'vitest';
import { buildStoryWorld } from '../level/build.ts';
import { buildZone } from '../level/zones/park.ts';
import { pathRibbon, terrainHeight } from './paths.ts';

const { world, level } = buildStoryWorld();
it('keeps rectangular coastal-zone ribbons finite without square padding', () => {
	for (const id of ['praia', 'manguezal'] as const) {
		const zone = buildZone(id),
			geometry = pathRibbon(zone.world, zone.level.trails);
		const p = geometry.getAttribute('position');
		for (let i = 0; i < p.count; i++) {
			expect(Number.isFinite(p.getY(i))).toBe(true);
			expect(p.getZ(i)).toBeLessThanOrEqual(zone.depth + 0.001);
		}
		expect(Number.isFinite(terrainHeight(zone.world, 100, 200))).toBe(true);
		geometry.dispose();
	}
});
it('puts a bounded, irregular soil ribbon on the actual 1u terrain, without moving collision data', () => {
	const heights = world.heights.slice(),
		g = pathRibbon(world, level.trails),
		p = g.getAttribute('position');
	expect(p.count).toBeGreaterThan(100);
	expect((g.index?.count ?? 0) / 3).toBeLessThan(30000);
	for (let i = 0; i < p.count; i++)
		expect(p.getY(i) - terrainHeight(world, p.getX(i), p.getZ(i))).toBeCloseTo(0.035, 3);
	const normal = g.getAttribute('normal');
	for (let i = 0; i < normal.count; i++) expect(normal.getY(i)).toBeGreaterThan(0);
	const indices = g.index;
	if (!indices) throw new Error('indexed ribbon');
	for (let i = 0; i < indices.count; i += 3) {
		const a = indices.getX(i),
			b = indices.getX(i + 1),
			c = indices.getX(i + 2),
			x = (p.getX(a) + p.getX(b) + p.getX(c)) / 3,
			z = (p.getZ(a) + p.getZ(b) + p.getZ(c)) / 3,
			y = (p.getY(a) + p.getY(b) + p.getY(c)) / 3;
		expect(y - terrainHeight(world, x, z)).toBeCloseTo(0.035, 3);
	}
	expect(world.heights).toEqual(heights);
	g.dispose();
});
