import { describe, expect, it } from 'vitest';
import { createAnimal } from './animal.ts';
import { holds } from './fixtures.test-helper.ts';
import { createAnimalWorld } from './motion.ts';
import { MURIQUI, MURIQUI_HOLDS, PENDULUM_STEP } from './muriqui.ts';

/** Brachiates across 9 holds `spacing` u apart at frame times from `dt` and returns the hand-switch times. */
function switchTimes(dt: (frame: number) => number, spacing = 1.15) {
	const muriqui = createAnimal('muriqui', { seed: 21, route: holds(12, spacing, 8) });
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
			for (let i = 0; i < got.length; i++) expect(got[i]).toBeCloseTo(reference[i], 9);
		}
	});

	it('has a stable rhythm close to half the natural period', () => {
		const steady = reference.slice(1);
		const mean = steady.reduce((a, b) => a + b, 0) / steady.length;
		for (const interval of steady) expect(Math.abs(interval - mean)).toBeLessThan(2 * PENDULUM_STEP);
		// Half a period at this amplitude (~52°) is a little longer than at small swings.
		expect(mean).toBeGreaterThan(MURIQUI.period / 2);
		expect(mean).toBeLessThan(MURIQUI.period * 0.65);
	});

	it('reaches every hold across the documented spacings, up to the widest', () => {
		for (const spacing of [
			MURIQUI_HOLDS.min,
			MURIQUI_HOLDS.max,
			MURIQUI_HOLDS.reach,
			MURIQUI_HOLDS.limit * 0.99
		])
			expect(switchTimes(() => 1 / 60, spacing).length).toBe(9);
	});

	it('gives up on a hold out of reach and turns back, never swinging over the top', () => {
		const muriqui = createAnimal('muriqui', {
			seed: 21,
			route: holds(4, MURIQUI_HOLDS.limit * 1.1, 8),
			start: 1
		});
		const behaviour = muriqui.behaviour;
		const direction = behaviour.direction;
		behaviour.brachiate(2);
		const world = createAnimalWorld();
		let peak = 0;
		for (let frame = 0; frame < 60 * 30 && behaviour.state === 'move'; frame++) {
			muriqui.update(1 / 60, world);
			peak = Math.max(peak, Math.abs(behaviour.theta));
		}
		expect(behaviour.state).not.toBe('move');
		expect(behaviour.switches).toBe(0);
		expect(behaviour.anchor).toBe(1);
		expect(behaviour.direction).toBe(-direction);
		expect(peak).toBeLessThan(MURIQUI.swingCap + 2 * (Math.PI / 180));
	});
});
