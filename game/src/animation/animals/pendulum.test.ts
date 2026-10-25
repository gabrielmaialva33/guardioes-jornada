import { describe, expect, it } from 'vitest';
import { createAnimal } from './animal.ts';
import { holds } from './fixtures.test-helper.ts';
import { createAnimalWorld } from './motion.ts';
import { MURIQUI, PENDULUM_STEP } from './muriqui.ts';

/** Brachiates across 9 holds 1.4 u apart at frame times from `dt` and returns the hand-switch times. */
function switchTimes(dt: (frame: number) => number) {
	const muriqui = createAnimal('muriqui', { seed: 21, route: holds(12, 1.4, 8) });
	const behaviour = muriqui.behaviour;
	behaviour.brachiate(9);
	const world = createAnimalWorld();
	const times: number[] = [];
	let switches = behaviour.switches;
	for (let frame = 0; frame < 4000 && times.length < 9; frame++) {
		muriqui.update(dt(frame), world);
		if (behaviour.switches !== switches) {
			switches = behaviour.switches;
			times.push(behaviour.lastSwitchTime);
		}
	}
	return times;
}

const intervals = (times: number[]) => times.slice(1).map((t, i) => t - times[i]);

describe('muriqui brachiation pendulum', () => {
	const reference = intervals(switchTimes(() => 1 / 60));

	it('switches hands on every forward swing across the holds', () => {
		expect(reference.length).toBe(8);
	});

	it('keeps the swing period at any frame rate, steady or jittery', () => {
		const rates = [
			() => 1 / 30,
			() => 1 / 144,
			() => 1 / 240,
			(frame: number) => [1 / 30, 1 / 144, 1 / 60, 1 / 90, 1 / 45][frame % 5],
			// LOD-like: one update every third frame.
			() => 3 / 60
		];
		for (const rate of rates) {
			const got = intervals(switchTimes(rate));
			expect(got.length).toBe(reference.length);
			got.forEach((interval, i) => expect(interval).toBeCloseTo(reference[i], 9));
		}
	});

	it('has a stable rhythm close to half the natural period', () => {
		const steady = reference.slice(1);
		const mean = steady.reduce((a, b) => a + b, 0) / steady.length;
		for (const interval of steady) expect(Math.abs(interval - mean)).toBeLessThan(2 * PENDULUM_STEP);
		// Half a period at this amplitude (~60°) is a little longer than at small swings.
		expect(mean).toBeGreaterThan(MURIQUI.period / 2);
		expect(mean).toBeLessThan(MURIQUI.period * 0.65);
	});
});
