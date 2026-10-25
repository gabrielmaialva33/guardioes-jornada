import { expect, it } from 'vitest';
import { FixedTimestep } from './timestep.ts';

it.each([30, 60, 90, 120, 144])('runs exactly 60 ticks for one second rendered at %i Hz', (hz) => {
	const clock = new FixedTimestep(60, 4);
	let ticks = 0;
	for (let frame = 0; frame < hz; frame++) clock.advance(1 / hz, () => ticks++);
	expect(ticks).toBe(60);
	expect(clock.alpha).toBeGreaterThanOrEqual(0);
	expect(clock.alpha).toBeLessThan(1);
});

it('runs at most four ticks on a 200 ms frame and drops the rest', () => {
	const clock = new FixedTimestep(60, 4);
	expect(clock.advance(0.2, () => {})).toBe(4);
	expect(clock.dropped).toBeCloseTo(0.2 - 4 / 60, 9);
	expect(clock.alpha).toBeLessThan(1);
	expect(clock.advance(1 / 60, () => {})).toBe(1);
});

it('does not replay 30 s of physics when the page comes back', () => {
	const resumed = new FixedTimestep();
	resumed.advance(1 / 60, () => {});
	resumed.reset();
	expect(resumed.advance(30, () => {})).toBe(0);
	expect(resumed.advance(1 / 60, () => {})).toBe(1);

	// Even without reset, the cap keeps it to four ticks.
	const forgotten = new FixedTimestep();
	expect(forgotten.advance(30, () => {})).toBe(4);
	expect(forgotten.advance(1 / 60, () => {})).toBe(1);
});

it('ignores negative, zero and NaN frame times', () => {
	const clock = new FixedTimestep();
	for (const seconds of [-1, 0, Number.NaN, Number.POSITIVE_INFINITY])
		expect(clock.advance(seconds, () => {})).toBe(0);
	expect(clock.alpha).toBe(0);
});
