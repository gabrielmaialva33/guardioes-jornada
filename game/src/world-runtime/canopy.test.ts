import { expect, it, vi } from 'vitest';
import { buildStoryWorld } from '../level/build.ts';
import { bakeCanopy } from './canopy.ts';

it('bakes deterministic bounded R8 shade, shades under trees and releases its owned texture', () => {
	const { world } = buildStoryWorld();
	const a = bakeCanopy(world),
		b = bakeCanopy(world);
	expect(a.pixels.length).toBe(320 * 320);
	expect(a.pixels).toEqual(b.pixels);
	expect(Math.min(...a.pixels)).toBeLessThan(140);
	expect(Math.max(...a.pixels)).toBe(255);
	expect(a.sample(-1, -1)).toBe(1);
	const dispose = vi.spyOn(a.texture, 'dispose');
	a.dispose();
	a.dispose();
	expect(dispose).toHaveBeenCalledOnce();
	b.dispose();
});
