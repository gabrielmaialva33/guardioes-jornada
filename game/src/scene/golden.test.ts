import { expect, it } from 'vitest';
import { readGolden } from './golden.ts';

it('is disabled in a public production build and validates free camera, avatar, tier and fixed clock', () => {
	expect(readGolden('?golden=1', false).enabled).toBe(false);
	const g = readGolden('?golden=1&tier=low&t=10&seed=42&cam=1,2,3,4,5,6,50&avatar=44,42,0&time=night', true);
	expect(g.enabled).toBe(true);
	expect(g.tier).toBe('low');
	expect(g.camera).toEqual([1, 2, 3, 4, 5, 6, 50]);
	expect(g.avatar).toEqual([44, 42, 0]);
	expect(g.time).toBe(10);
	expect(g.night).toBe(true);
	expect(readGolden('?golden=1&t=-4&cam=NaN,2,3', true).camera).toBeNull();
	expect(readGolden('?golden=1&t=-4', true).time).toBe(0);
});
