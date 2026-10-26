import { expect, it, vi } from 'vitest';
import { buildStoryWorld } from '../level/build.ts';
import { bakeGroundField } from './ground-field.ts';

it('encodes trail edges in a bounded R8 field without touching the authored world', () => {
	const { world, level } = buildStoryWorld(),
		heights = world.heights.slice();
	const field = bakeGroundField(world, level.trails),
		trail = level.trails[0],
		p = trail.points[1];
	expect(field.sample(p[0], p[1])).toBeLessThan(0.5);
	expect(field.sample(-2, -2)).toBe(6);
	expect(field.texture.image.width).toBe(128);
	expect(field.pixels.byteLength).toBe(16384);
	expect(world.heights).toEqual(heights);
	const dispose = vi.spyOn(field.texture, 'dispose');
	field.dispose();
	field.dispose();
	expect(dispose).toHaveBeenCalledOnce();
});
