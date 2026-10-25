import { expect, it } from 'vitest';
import { GRAVITY, JUMP_SPEED, STUD } from '../engine/constants.ts';
import {
	AvatarAnimator,
	type AvatarInput,
	createAvatarInput,
	LAYERS,
	readCharacter
} from './avatar-animator.ts';
import { RUN_STRIDE, WALK_STRIDE } from './avatar-poses.ts';
import { AVATAR_LAYOUT } from './joints.ts';
import { JOINT_STRIDE } from './skeleton.ts';

const DEG = Math.PI / 180;
const at = (joint: keyof typeof AVATAR_LAYOUT.index, channel: number) =>
	AVATAR_LAYOUT.index[joint] * JOINT_STRIDE + channel;

function input(overrides: Partial<AvatarInput> = {}): AvatarInput {
	return Object.assign(createAvatarInput(), overrides);
}

function run(
	animator: AvatarAnimator,
	seconds: number,
	next: AvatarInput | ((time: number) => AvatarInput),
	dt = 1 / 60,
	each?: (time: number) => void
) {
	const steps = Math.round(seconds / dt);
	for (let i = 1; i <= steps; i++) {
		animator.update(dt, typeof next === 'function' ? next(i * dt) : next);
		each?.(i * dt);
	}
}

it('does not advance the cycle with full stick input but no distance', () => {
	const animator = new AvatarAnimator();
	let steps = 0;
	run(animator, 2, input({ intent: 1, speed: 0 }), 1 / 60, () => {
		if (animator.footstep) steps++;
	});
	expect(animator.phase).toBe(0);
	expect(animator.state).toBe('idle');
	expect(steps).toBe(0);
});

it('advances the cycle in proportion to the distance covered', () => {
	const distance = (studs: number, seconds: number) => {
		const animator = new AvatarAnimator();
		run(animator, seconds, input({ speed: studs * STUD, intent: 1 }), 0.01);
		return animator.phase;
	};
	// Run alone from 12.8 studs/s: one cycle per RUN_STRIDE studs, at any speed.
	expect(distance(16, 0.1)).toBeCloseTo((16 * 0.1) / RUN_STRIDE, 9);
	expect(distance(16, 0.2)).toBeCloseTo((16 * 0.2) / RUN_STRIDE, 9);
	expect(distance(12.8, 0.25)).toBeCloseTo(distance(16, 0.2), 9);
	// Walk alone up to 6.4 studs/s.
	expect(distance(4, 0.3)).toBeCloseTo((4 * 0.3) / WALK_STRIDE, 9);
	expect(distance(2, 0.6)).toBeCloseTo(distance(4, 0.3), 9);
});

it.each([
	[6.4, 1],
	[12.8, 1],
	[16, 1.25]
])('plays the cycle at Animate’s timewarp: %s studs/s → %s×', (studs, rate) => {
	const animator = new AvatarAnimator();
	run(animator, 0.5, input({ speed: studs * STUD, intent: 1 }));
	expect(animator.playbackRate).toBeCloseTo(rate, 9);
});

it('runs 2.5 cycles (5 steps) per second at 16 studs/s, feet alternating', () => {
	const animator = new AvatarAnimator();
	const feet: string[] = [];
	run(animator, 2, input({ speed: 16 * STUD, intent: 1 }), 1 / 60, () => {
		if (animator.footstep) feet.push(animator.footstep);
	});
	expect(animator.cadence).toBeCloseTo(2.5, 9);
	expect(feet.length).toBeGreaterThanOrEqual(9);
	expect(feet.length).toBeLessThanOrEqual(10);
	feet.forEach((foot, i) => {
		if (i > 0) expect(foot).not.toBe(feet[i - 1]);
	});
});

/** Idle, a sprint with a turn, a jump with its landing, then idle again: every layer gets a reason to move. */
function workout(reducedMotion: boolean) {
	const animator = new AvatarAnimator({ seed: 7 });
	const log = { lean: 0, bank: 0, squash: 0, scale: 0, breathing: 0 };
	const track = () => {
		log.lean = Math.max(log.lean, Math.abs(animator.lean.value));
		log.bank = Math.max(log.bank, Math.abs(animator.bank.value));
		log.squash = Math.max(log.squash, Math.abs(animator.squash.value));
		log.scale = Math.max(log.scale, Math.abs(animator.pose.scaleY - 1), Math.abs(animator.pose.scaleXZ - 1));
		log.breathing = Math.max(log.breathing, Math.abs(animator.breathing));
	};
	run(animator, 2, input({ reducedMotion }), 1 / 60, track);
	run(
		animator,
		1,
		(time) => input({ reducedMotion, speed: 16 * STUD, intent: 1, yaw: time * 3 }),
		1 / 60,
		track
	);
	const airtime = (2 * JUMP_SPEED) / GRAVITY;
	run(
		animator,
		airtime,
		(time) =>
			input({
				reducedMotion,
				grounded: false,
				jumped: time <= 1 / 60,
				airTime: time,
				verticalSpeed: JUMP_SPEED - GRAVITY * time
			}),
		1 / 60,
		track
	);
	run(animator, 2, input({ reducedMotion }), 1 / 60, track);
	return log;
}

it('drives lean, bank, squash and breathing in full motion', () => {
	const log = workout(false);
	expect(log.lean).toBeGreaterThan(3 * DEG);
	expect(log.bank).toBeGreaterThan(2 * DEG);
	expect(log.squash).toBeGreaterThan(0.05);
	expect(log.squash).toBeLessThanOrEqual(LAYERS.landSquash * 1.01);
	expect(log.scale).toBeGreaterThan(0.03);
	expect(log.breathing).toBeGreaterThan(LAYERS.breathPitch * 0.9);
});

it('removes squash, lean, bank and breathing with reduced motion', () => {
	expect(workout(true)).toEqual({ lean: 0, bank: 0, squash: 0, scale: 0, breathing: 0 });
});

it('halves the head turn with reduced motion and lets go of targets behind', () => {
	// Head yaw (torso share included) relative to the same idle without a target; eyes at 0.85 H.
	const headYaw = (reducedMotion: boolean, target: AvatarInput['lookTarget']) => {
		const animator = new AvatarAnimator();
		run(animator, 2, input({ reducedMotion, lookTarget: target }));
		const pose = animator.pose.data;
		return (pose[at('torso', 1)] + pose[at('head', 1)]) / DEG;
	};
	const lookAt = (reducedMotion: boolean, x: number, z: number) =>
		headYaw(reducedMotion, { x, y: 2.55, z }) - headYaw(reducedMotion, null);
	expect(lookAt(false, 10, 3)).toBeCloseTo(60, 3);
	expect(lookAt(true, 10, 3)).toBeCloseTo(30, 3);
	expect(lookAt(false, 1, 1)).toBeCloseTo(45, 3);
	expect(lookAt(false, -1, 1)).toBeCloseTo(-45, 3);
	expect(lookAt(false, 0, -10)).toBeCloseTo(0, 3);
});

it('raises both arms about 160° in the jump', () => {
	const animator = new AvatarAnimator();
	run(animator, 0.2, (time) =>
		input({
			grounded: false,
			jumped: time <= 1 / 60,
			airTime: time,
			verticalSpeed: JUMP_SPEED - GRAVITY * time
		})
	);
	const pose = animator.pose.data;
	for (const arm of ['armL', 'armR'] as const) {
		const shoulder = -pose[at(arm, 0)] / DEG;
		expect(shoulder).toBeGreaterThan(150);
		expect(shoulder).toBeLessThan(170);
	}
});

it('waves the right arm only while still', () => {
	const animator = new AvatarAnimator();
	run(animator, 0.5, input());
	expect(animator.playEmote('wave')).toBe(true);
	run(animator, 0.5, input());
	expect(animator.pose.data[at('armR', 2)]).toBeLessThan(-120 * DEG);
	run(animator, 0.3, input({ speed: 8 * STUD, intent: 1 }));
	expect(animator.state).toBe('walk');
	expect(animator.states.weight('emote')).toBe(0);
});

it('stays finite with dt 0, 200 ms hitches and garbage input', () => {
	const animator = new AvatarAnimator();
	const steps = [0, 0.2, 1 / 60, 0, Number.NaN, -1, 0.2, 5, Number.POSITIVE_INFINITY];
	const inputs: AvatarInput[] = [
		input(),
		input({ speed: 16 * STUD, intent: 1, yaw: 2 }),
		input({ grounded: false, jumped: true, verticalSpeed: JUMP_SPEED, airTime: 0.1 }),
		input({ grounded: false, verticalSpeed: -40, airTime: 1 }),
		input({ climbing: true, verticalSpeed: 5 }),
		input({ swimming: true, speed: 6 }),
		input({ sitting: true }),
		input({ lookTarget: { x: 0, y: 2.55, z: 0 } }),
		input({ speed: Number.NaN, verticalSpeed: Number.NaN, yaw: Number.NaN, intent: Number.NaN }),
		input({ speed: Number.POSITIVE_INFINITY, lookTarget: { x: Number.NaN, y: 0, z: 1 } })
	];
	animator.playEmote('cheer');
	for (let round = 0; round < 3; round++)
		for (const next of inputs)
			for (const dt of steps) {
				const pose = animator.update(dt, next);
				for (const value of pose.data) expect(Number.isFinite(value)).toBe(true);
				expect(Number.isFinite(pose.scaleY) && Number.isFinite(pose.scaleXZ)).toBe(true);
				expect(Number.isFinite(animator.phase) && animator.phase >= 0 && animator.phase < 1).toBe(true);
				const sum = animator.states.weights.reduce((total, weight) => total + weight, 0);
				expect(sum).toBeCloseTo(1, 9);
			}
});

it('reads the engine character, accumulating air time', () => {
	const character = {
		position: { x: 1, y: 2, z: 3 },
		velocity: { x: 0, y: -4, z: 0 },
		planarSpeed: 5,
		grounded: false,
		yaw: 0.5,
		events: { jumped: false }
	};
	const target = createAvatarInput();
	readCharacter(target, character, 0.1);
	readCharacter(target, character, 0.1);
	expect(target).toMatchObject({ speed: 5, verticalSpeed: -4, grounded: false, yaw: 0.5, x: 1, y: 2, z: 3 });
	expect(target.airTime).toBeCloseTo(0.2, 12);
	readCharacter(target, { ...character, grounded: true }, 0.1);
	expect(target.airTime).toBe(0);
});

it('replays idle fidgets identically for a seed, and keeps them rare', () => {
	const trace = (seed: number, seconds: number) => {
		const animator = new AvatarAnimator({ seed });
		const values: number[] = [];
		run(animator, seconds, input(), 1 / 30, () => values.push(Math.abs(animator.pose.data[at('head', 1)])));
		return values;
	};
	expect(trace(7, 60)).toEqual(trace(7, 60));
	expect(Math.max(...trace(7, 60))).toBeGreaterThan(20 * DEG);
	// The look-around is 1 roll in 10 (Roblox R6's 9 : 1), so the head is turned far only now and then.
	const long = trace(7, 600);
	const share = long.filter((yaw) => yaw > 20 * DEG).length / long.length;
	expect(share).toBeGreaterThan(0.01);
	expect(share).toBeLessThan(0.15);
});
