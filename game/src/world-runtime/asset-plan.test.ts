import { expect, it } from 'vitest';
import { buildStoryWorld } from '../level/build.ts';
import { geometryRanges, renderAssetPlan } from './asset-plan.ts';

it('selects native decor without changing world placement/collision arrays, and keeps the ledges clear', () => {
	const { world, level } = buildStoryWorld(),
		old = world.decorations.kind.slice(),
		plan = renderAssetPlan(world, level);
	expect(world.decorations.kind).toEqual(old);
	expect(plan.trees).toBe(world.trees);
	expect(plan.cover.count).toBeGreaterThan(world.decorations.count);
	expect(world.decorations.kind).toEqual(old);
	expect(plan.cover.kinds.some((k) => k.includes('fern'))).toBe(true);
	expect(plan.rocks.kinds.some((k) => k.includes('polyone'))).toBe(true);
	expect(plan.scenery.kinds).toContain('ground-waterfall');
	expect(plan.scenery.kinds).toContain('bromelia-red');
	let epiphytes = 0;
	for (let i = 0; i < plan.scenery.count; i++)
		if (plan.scenery.kinds[plan.scenery.kind[i]] === 'bromelia-red') {
			for (let j = 0; j < world.trees.count; j++)
				if (
					Math.hypot(plan.scenery.x[i] - world.trees.x[j], plan.scenery.z[i] - world.trees.z[j]) <
						world.trees.scale[j] * 0.8 + 0.3 &&
					plan.scenery.y[i] - world.trees.y[j] > 1.4
				) {
					epiphytes++;
					break;
				}
		}
	expect(epiphytes).toBeGreaterThan(0);
	for (let i = 0; i < plan.scenery.count; i++)
		if (plan.scenery.kinds[plan.scenery.kind[i]].startsWith('rock-'))
			for (const o of level.obbies)
				for (const p of o.pieces)
					expect(Math.hypot(p.x - plan.scenery.x[i], p.z - plan.scenery.z[i])).toBeGreaterThan(p.radius + 4);
	expect(geometryRanges('low', 'tree').near).toBeLessThan(geometryRanges('low', 'tree').far);
});
