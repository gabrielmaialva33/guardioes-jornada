import { Color } from 'three';
import { expect, it } from 'vitest';
import { gradeColor, LOOK } from './look.ts';

it('compresses HDR monotonically, keeps a colored shadow floor and never emits NaN', () => {
	let previous = -1;
	for (const value of [0, 0.001, 0.01, 0.05, 0.18, 0.5, 1, 2, 4, 16, 100]) {
		const color = gradeColor(new Color(value, value, value));
		for (const c of [color.r, color.g, color.b]) {
			expect(Number.isFinite(c)).toBe(true);
			expect(c).toBeGreaterThanOrEqual(0);
			expect(c).toBeLessThanOrEqual(1);
		}
		expect(color.g).toBeGreaterThanOrEqual(previous);
		previous = color.g;
	}
	const dark = gradeColor(new Color(0, 0, 0));
	expect(dark.b).toBeGreaterThan(dark.r);
	expect(dark.g).toBeGreaterThan(0.005);
	expect(LOOK.exposure).toBeGreaterThan(0);
});
it('preserves hue families and reuses a supplied output for the night/reference path', () => {
	const out = new Color(),
		green = gradeColor(new Color(0.05, 0.25, 0.08), out);
	expect(green).toBe(out);
	expect(green.g).toBeGreaterThan(green.r);
	expect(green.g).toBeGreaterThan(green.b);
	const blue = gradeColor(new Color(0.03, 0.2, 0.45));
	expect(blue.b).toBeGreaterThan(blue.r);
	const day = gradeColor(new Color(0.04, 0.07, 0.1)),
		night = gradeColor(new Color(0.04, 0.07, 0.1), new Color(), true);
	expect(night.g).toBeLessThan(day.g);
});
