import { expect, it } from 'vitest';
import { IDLE_VARIANTS, RUN, WALK } from './avatar-poses.ts';
import { AVATAR_LAYOUT } from './joints.ts';
import { compileKey, defineLayout, JOINT_STRIDE, mirrorKey } from './skeleton.ts';
import { Track } from './track.ts';

const DEG = Math.PI / 180;
const width = AVATAR_LAYOUT.joints.length * JOINT_STRIDE;
const sample = (track: Track, time: number, weight = 1) => {
	const out = new Float64Array(width);
	track.sampleInto(out, time, weight);
	return out;
};
/** Element-wise toBeCloseTo. */
const expectClose = (actual: ArrayLike<number>, expected: ArrayLike<number>, digits: number) => {
	expect(actual.length).toBe(expected.length);
	for (let i = 0; i < actual.length; i++) expect(actual[i]).toBeCloseTo(expected[i], digits);
};
const armL = AVATAR_LAYOUT.index.armL * JOINT_STRIDE;
const armR = AVATAR_LAYOUT.index.armR * JOINT_STRIDE;
const legL = AVATAR_LAYOUT.index.legL * JOINT_STRIDE;

it('passes through every key and loops without a seam', () => {
	const a = compileKey(AVATAR_LAYOUT, { legL: { r: [-30, 0, 0] } });
	const b = compileKey(AVATAR_LAYOUT, { legL: { r: [30, 0, 0] } });
	const loop = new Track(AVATAR_LAYOUT, [a, b], [0, 0.5], { loop: true, interpolation: 'cubic', period: 1 });
	expect(sample(loop, 0)[legL]).toBeCloseTo(-30 * DEG, 12);
	expect(sample(loop, 0.5)[legL]).toBeCloseTo(30 * DEG, 12);
	expect(sample(loop, 1)[legL]).toBeCloseTo(-30 * DEG, 12);
	expect(sample(loop, -0.5)[legL]).toBeCloseTo(30 * DEG, 12);
	for (const track of [WALK, RUN, ...IDLE_VARIANTS]) {
		expectClose(sample(track, 1 - 1e-7), sample(track, 0), 4);
	}
});

it('holds a one-shot track at its ends and still between equal keys', () => {
	const rest = compileKey(AVATAR_LAYOUT, {});
	const up = compileKey(AVATAR_LAYOUT, { armR: { r: [-90, 0, 0] } });
	const gesture = new Track(AVATAR_LAYOUT, [rest, up, up, rest], [0, 0.2, 0.8, 1], {
		loop: false,
		interpolation: 'smooth',
		period: 1
	});
	expect(sample(gesture, -1)[armR]).toBe(0);
	expect(sample(gesture, 0.5)[armR]).toBeCloseTo(-90 * DEG, 12);
	expect(sample(gesture, 0.7)[armR]).toBeCloseTo(-90 * DEG, 12);
	expect(sample(gesture, 0.1)[armR]).toBeCloseTo(-45 * DEG, 12);
	expect(sample(gesture, 5)[armR]).toBe(0);
});

it('adds weighted samples so blends are plain sums', () => {
	const blended = new Float64Array(width);
	WALK.sampleInto(blended, 0.3, 0.25);
	RUN.sampleInto(blended, 0.3, 0.75);
	const walk = sample(WALK, 0.3);
	const run = sample(RUN, 0.3);
	expectClose(
		blended,
		walk.map((value, i) => value * 0.25 + run[i] * 0.75),
		12
	);
	const untouched = new Float64Array(width);
	WALK.sampleInto(untouched, 0.3, 0);
	expect(untouched.every((value) => value === 0)).toBe(true);
});

it('mirrors left and right, flipping yaw, roll and sideways offset', () => {
	const key = compileKey(AVATAR_LAYOUT, {
		root: { r: [5, 10, 15], p: [0.1, 0.2, 0.3] },
		armL: { r: [-40, 3, 20] }
	});
	const mirrored = mirrorKey(AVATAR_LAYOUT, key);
	expectClose(mirrored.subarray(0, 6), [5 * DEG, -10 * DEG, -15 * DEG, -0.1, 0.2, 0.3], 12);
	expect(mirrored[armR]).toBeCloseTo(-40 * DEG, 12);
	expect(mirrored[armR + 1]).toBeCloseTo(-3 * DEG, 12);
	expect(mirrored[armR + 2]).toBeCloseTo(-20 * DEG, 12);
	expect(mirrored[armL]).toBe(0);
	// Half a walk cycle later is the mirror image.
	const half = mirrorKey(AVATAR_LAYOUT, sample(WALK, 0.1));
	expectClose(sample(WALK, 0.6), half, 12);
});

it('works for any layout, not just the avatar', () => {
	const dog = defineLayout(['root', 'body', 'tail', 'legFL', 'legFR'], [['legFL', 'legFR']]);
	expect(dog.mirror[dog.index.legFL]).toBe(dog.index.legFR);
	expect(dog.mirror[dog.index.tail]).toBe(dog.index.tail);
	const wag = new Track(
		dog,
		[compileKey(dog, { tail: { r: [0, 30, 0] } }), compileKey(dog, { tail: { r: [0, -30, 0] } })],
		[0, 0.5],
		{ loop: true, interpolation: 'cubic', period: 0.4 }
	);
	const out = new Float64Array(dog.joints.length * JOINT_STRIDE);
	wag.sampleInto(out, 0.25, 1);
	expect(out[dog.index.tail * JOINT_STRIDE + 1]).toBeCloseTo(0, 12);
});

it('rejects malformed tracks at load time', () => {
	const key = compileKey(AVATAR_LAYOUT, {});
	const options = { loop: true, interpolation: 'cubic', period: 1 } as const;
	expect(() => new Track(AVATAR_LAYOUT, [key, key], [0, 0], options)).toThrow();
	expect(() => new Track(AVATAR_LAYOUT, [key], [0.5], options)).toThrow();
	expect(() => new Track(AVATAR_LAYOUT, [new Float64Array(3)], [0], options)).toThrow();
});
