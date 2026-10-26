import { expect, it } from 'vitest';
import { buildStoryWorld } from '../level/build.ts';
import { geometryRanges, renderAssetPlan } from './asset-plan.ts';

it('selects native decor without changing world placement/collision arrays, and keeps the ledges clear', () => {
	const { world, level } = buildStoryWorld(),
		old = world.decorations.kind.slice(),
		plan = renderAssetPlan(world, level);
	expect(world.decorations.kind).toEqual(old);
	expect(plan.trees).toBe(world.trees);
	expect(plan.cover.x).toBe(world.decorations.x);
	expect(plan.cover.kinds.some((k) => k.includes('fern'))).toBe(true);
	expect(plan.rocks.kinds.some((k) => k.includes('polyone'))).toBe(true);
	expect(plan.scenery.kinds).toContain('ground-waterfall');
	for (let i = 0; i < plan.scenery.count; i++)
		if (plan.scenery.kinds[plan.scenery.kind[i]].startsWith('rock-'))
			for (const o of level.obbies)
				for (const p of o.pieces)
					expect(Math.hypot(p.x - plan.scenery.x[i], p.z - plan.scenery.z[i])).toBeGreaterThan(p.radius + 4);
	expect(geometryRanges('low', 'tree').near).toBeLessThan(geometryRanges('low', 'tree').far);
});
