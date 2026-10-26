import { expect, it } from 'vitest';
import { buildStoryWorld } from '../level/index.ts';
import { poolShoreScale } from './paths.ts';
import { waterField, waterSurface } from './shore.ts';

const { world, level } = buildStoryWorld();
it('uses one signed shoreline for river and pool, without a foam seam through their overlap', () => {
	const p = level.pool,
		center = waterField(world, p, p.x, p.z);
	expect(center.distance).toBeLessThan(-1);
	const angle = 0.73,
		r = poolShoreScale(angle),
		along = Math.cos(angle) * p.halfLength * r,
		across = Math.sin(angle) * p.halfWidth * r;
	const x = p.x + along * p.axisX - across * p.axisZ,
		z = p.z + along * p.axisZ + across * p.axisX;
	const a = waterField(world, p, x, z),
		b = waterField(world, p, x + 0.001, z + 0.001);
	expect(Math.abs(a.distance - b.distance)).toBeLessThan(0.01);
	expect(Number.isFinite(a.height)).toBe(true);
	const river = world.river.points[Math.floor(world.river.points.length / 2)];
	expect(waterField(world, p, river.x, river.z).distance).toBeLessThan(0);
});
it('builds one shared water mesh with signed distance/depth and leaves collision heights untouched', () => {
	const heights = world.heights.slice(),
		g = waterSurface(world, level.pool),
		p = g.getAttribute('position'),
		shore = g.getAttribute('water');
	expect(p.count).toBeGreaterThan(100);
	expect((g.index?.count ?? 0) / 3).toBeLessThan(7000);
	expect(shore.count).toBe(p.count);
	for (let i = 0; i < p.count; i++) expect(Number.isFinite(p.getY(i))).toBe(true);
	expect(world.heights).toEqual(heights);
	g.dispose();
});
