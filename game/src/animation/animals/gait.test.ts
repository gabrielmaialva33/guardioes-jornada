import { describe, expect, it } from 'vitest';
import { AnimalAnimator } from './animal-animator.ts';
import { AnimalMotion } from './motion.ts';
import { LIMB_BL, LIMB_BR, LIMB_FL, LIMB_FR } from './rigs.ts';
import type { SpeciesId } from './species.ts';

function walker(species: SpeciesId) {
	const animator = new AnimalAnimator(species);
	const motion = new AnimalMotion();
	motion.posture = 'stand';
	return { animator, motion };
}

/** Steps at `hz` for `seconds` with a constant speed, covering speed × dt per frame unless `distance` says otherwise. */
function drive(
	animator: AnimalAnimator,
	motion: AnimalMotion,
	speed: number,
	seconds: number,
	hz: number,
	distance = (dt: number) => speed * dt
) {
	const dt = 1 / hz;
	for (let i = 0; i < Math.round(seconds * hz); i++) {
		motion.beginUpdate();
		motion.speed = speed;
		motion.distance = distance(dt);
		animator.update(dt, motion);
	}
}

describe('gait phase', () => {
	it('does not move with time or intent, only with distance', () => {
		const { animator, motion } = walker('onca-pintada');
		// Pushing against a wall: full speed requested, no ground covered.
		drive(animator, motion, 2.2, 3, 60, () => 0);
		expect(animator.phase).toBe(0);
		expect(animator.footfall).toBe(-1);
		drive(animator, motion, 2.2, 0.5, 60);
		expect(animator.phase).toBeGreaterThan(0);
		const before = animator.phase;
		drive(animator, motion, 0, 2, 60, () => 0);
		expect(animator.phase).toBe(before);
	});

	it('is the same for the same distance at any frame rate', () => {
		const phases = [30, 60, 144].map((hz) => {
			const { animator, motion } = walker('bugio-ruivo');
			drive(animator, motion, 0.7, 2, hz);
			return animator.phase;
		});
		expect(phases[1]).toBeCloseTo(phases[0], 9);
		expect(phases[2]).toBeCloseTo(phases[0], 9);
	});

	it('advances in proportion to distance at a given speed', () => {
		const a = walker('mico-leao-dourado');
		const b = walker('mico-leao-dourado');
		drive(a.animator, a.motion, 1.2, 0.25, 60);
		drive(b.animator, b.motion, 1.2, 0.5, 60);
		// Phases wrap at 1: compare twice the short run with the long one, modulo 1.
		const gap = (2 * a.animator.phase - b.animator.phase + 1) % 1;
		expect(Math.min(gap, 1 - gap)).toBeLessThan(1e-9);
		expect(a.animator.cadence).toBeCloseTo(1.2 / a.animator.stride, 9);
	});

	it('takes longer strides when faster (mico: walk into bound)', () => {
		const slow = walker('mico-leao-dourado');
		const fast = walker('mico-leao-dourado');
		drive(slow.animator, slow.motion, 1, 1, 60);
		drive(fast.animator, fast.motion, 9.6, 1, 60);
		expect(fast.animator.stride).toBeGreaterThan(3 * slow.animator.stride);
		expect(slow.animator.runWeight).toBe(0);
		expect(fast.animator.runWeight).toBe(1);
	});
});

/** Order in which the limbs touch down over two strides. */
function footfalls(species: SpeciesId, speed: number) {
	const { animator, motion } = walker(species);
	drive(animator, motion, speed, 1, 240);
	const order: number[] = [];
	const dt = 1 / 240;
	for (let i = 0; i < 2400 && order.length < 8; i++) {
		motion.beginUpdate();
		motion.speed = speed;
		motion.distance = speed * dt;
		animator.update(dt, motion);
		if (animator.footfall >= 0) order.push(animator.footfall);
	}
	return order;
}

/** Rotates a cyclic sequence to start at `first`. */
const from = (sequence: number[], first: number) => {
	const at = sequence.indexOf(first);
	return [...sequence.slice(at), ...sequence.slice(0, at)].slice(0, 4);
};

describe('footfall sequences', () => {
	it('primates walk with a diagonal sequence: LH, RF, RH, LF (Hildebrand 1967)', () => {
		expect(from(footfalls('bugio-ruivo', 0.7), LIMB_BL)).toEqual([LIMB_BL, LIMB_FR, LIMB_BR, LIMB_FL]);
		expect(from(footfalls('mico-leao-dourado', 1), LIMB_BL)).toEqual([LIMB_BL, LIMB_FR, LIMB_BR, LIMB_FL]);
	});

	it('the jaguar walks with a lateral sequence: LH, LF, RH, RF', () => {
		expect(from(footfalls('onca-pintada', 2.2), LIMB_BL)).toEqual([LIMB_BL, LIMB_FL, LIMB_BR, LIMB_FR]);
	});

	it('the bounding mico lands forelimbs first, then the overstriding hindlimbs', () => {
		expect(from(footfalls('mico-leao-dourado', 9.6), LIMB_FL)).toEqual([LIMB_FL, LIMB_FR, LIMB_BL, LIMB_BR]);
	});
});
