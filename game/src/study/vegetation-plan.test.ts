import { describe, expect, it } from 'vitest';
import { buildStoryWorld } from '../level/build.ts';
import { polylineDistance } from '../level/geometry.ts';
import type { StoryLevel } from '../level/types.ts';
import { FLAG, ZONE } from '../survival/types.ts';
import { planStudyVegetation, vegetationClearance, vegetationVisible } from './vegetation-plan.ts';

function fixture() {
	const { world } = buildStoryWorld();
	world.flags.fill(FLAG.walkable | FLAG.forest);
	world.zones.fill(ZONE.lowland);
	world.heights.fill(2);
	return world;
}

describe('layered vegetation plan', () => {
	it('places fallen log replacements and ivy only on existing rock supports', () => {
		const { world, level } = buildStoryWorld(),
			plan = planStudyVegetation(world, level);
		const logs = Array.from(world.rocks.kind).filter((k) => world.rocks.kinds[k] === 'log').length;
		expect(plan.placements.filter((p) => p.replaces === 'rock:log')).toHaveLength(logs);
		expect(plan.placements.some((p) => p.role === 'rock-ivy')).toBe(true);
		for (const p of plan.placements.filter((p) => p.role === 'rock-ivy'))
			expect(
				Array.from(world.rocks.x).some((x, i) => Math.hypot(x - p.x, world.rocks.z[i] - p.z) < 0.01)
			).toBe(true);
	});

	it('replaces every native trunk of a selected family, including background slopes', () => {
		const { world, level } = buildStoryWorld(),
			plan = planStudyVegetation(world, level);
		for (const kind of ['pau-brasil', 'jequitiba']) {
			const native = Array.from(world.trees.kind).filter((k) => world.trees.kinds[k] === kind).length;
			expect(plan.placements.filter((p) => p.replaces === `tree:${kind}`)).toHaveLength(native);
		}
	});

	it('is deterministic, bounded and does not alter the authoritative world', () => {
		const world = fixture();
		const before = structuredClone(world);
		const a = planStudyVegetation(world);
		expect(a.placements.length).toBeGreaterThan(100);
		expect(a.placements.length).toBeLessThanOrEqual(2200 + world.trees.count);
		expect(a.placements.some((p) => p.height < 0.6)).toBe(true);
		expect(a.placements.some((p) => p.role === 'understorey' && p.height > 1)).toBe(true);
		expect(planStudyVegetation(world)).toEqual(a);
		expect(world).toEqual(before);
		for (const p of a.placements) {
			expect([p.x, p.y, p.z, p.height, p.yaw, p.rank, p.variant].every(Number.isFinite)).toBe(true);
			expect(p.height).toBeGreaterThan(0);
		}
	});

	it('preserves trails, mission access, river, camp and steep surfaces', () => {
		const { world, level } = buildStoryWorld();
		const plan = planStudyVegetation(world, level);
		expect(plan.placements.filter((p) => !p.replaces).length).toBeGreaterThan(20);
		for (const p of plan.placements.filter((p) => !p.replaces)) {
			const k = Math.round(p.z) * world.grid + Math.round(p.x);
			expect(world.flags[k] & (FLAG.river | FLAG.base | FLAG.crossing | FLAG.corridor)).toBe(0);
			expect(world.zones[k]).not.toBe(ZONE.highland);
			for (const trail of level.trails)
				expect(polylineDistance(trail.points, p.x, p.z)).toBeGreaterThan(trail.halfWidth + 1);
			for (const spot of [...level.collectibles, ...level.planting, ...level.checkpoints.map((c) => c.spawn)])
				expect(Math.hypot(spot.x - p.x, spot.z - p.z)).toBeGreaterThan(2);
		}
	});

	it('reserves isolated trail points and never grows plants underwater', () => {
		const world = fixture();
		const level = {
			...buildStoryWorld().level,
			trails: [{ id: 'stub', halfWidth: 2, points: [[80, 80]] }]
		} as StoryLevel;
		expect(vegetationClearance(world, level, 80, 80, 1)).toBe(false);
		expect(vegetationClearance(world, level, 82, 80, 1)).toBe(false);
		world.flags.fill(FLAG.river);
		expect(planStudyVegetation(world).placements).toEqual([]);
	});

	it('uses nested quality density without replanting the world', () => {
		const plan = planStudyVegetation(fixture());
		const low = plan.placements.filter((p) => vegetationVisible(p, 'low'));
		const medium = plan.placements.filter((p) => vegetationVisible(p, 'medium'));
		const high = plan.placements.filter((p) => vegetationVisible(p, 'high'));
		expect(low.length).toBeGreaterThan(20);
		expect(low.length).toBeLessThan(medium.length);
		expect(medium.length).toBeLessThan(high.length);
		for (const p of low) expect(medium).toContain(p);
		for (const p of medium) expect(high).toContain(p);
	});
});
