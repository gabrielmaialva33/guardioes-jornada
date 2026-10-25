import { expect, it } from 'vitest';
import { GRAVITY, JUMP_SPEED, STUD } from '../engine/constants.ts';
import { ANIMATE } from './animate-timings.ts';
import { EMOTES } from './avatar-poses.ts';
import { type AvatarState, AvatarStateMachine, type MotionInput } from './avatar-states.ts';

const standing: MotionInput = {
	speed: 0,
	intent: 0,
	grounded: true,
	verticalSpeed: 0,
	airTime: 0,
	jumped: false,
	climbing: false,
	swimming: false,
	sitting: false
};
const atStuds = (studs: number): MotionInput => ({ ...standing, speed: studs * STUD, intent: 1 });

/** Updates `seconds` worth of fixed `dt` steps; `input` may depend on the elapsed time. */
function run(
	machine: AvatarStateMachine,
	seconds: number,
	input: MotionInput | ((time: number) => MotionInput),
	dt = 0.01,
	each?: (time: number) => void
) {
	const steps = Math.round(seconds / dt);
	for (let i = 1; i <= steps; i++) {
		machine.update(dt, typeof input === 'function' ? input(i * dt) : input);
		each?.(i * dt);
	}
}

it.each<[number, AvatarState, number, number]>([
	[0, 'idle', 1, 0],
	[0.5, 'idle', 1, 0],
	[6.4, 'walk', 1, 0],
	[9.6, 'walk', 0.5, 0.5],
	[12.8, 'walk', 0, 1],
	[16, 'walk', 0, 1]
])('settles at %s studs/s into %s with walk %s and run %s', (studs, state, walk, run_) => {
	const machine = new AvatarStateMachine();
	run(machine, 1, atStuds(studs));
	expect(machine.state).toBe(state);
	expect(machine.weight(state)).toBe(1);
	if (state === 'walk') {
		expect(machine.walkWeight).toBeCloseTo(walk, 12);
		expect(machine.runWeight).toBeCloseTo(run_, 12);
	}
});

it('walks only above the 0.75 studs/s threshold', () => {
	const machine = new AvatarStateMachine();
	machine.update(0.01, atStuds(0.75));
	expect(machine.state).toBe('idle');
	machine.update(0.01, atStuds(0.76));
	expect(machine.state).toBe('walk');
});

it.each([6.4, 12.8, 16])('fades idle → walk and back over 0.2 s at %s studs/s', (studs) => {
	const machine = new AvatarStateMachine();
	run(machine, 0.1, atStuds(studs));
	expect(machine.weight('walk')).toBeCloseTo(0.5, 9);
	expect(machine.weight('idle')).toBeCloseTo(0.5, 9);
	run(machine, 0.1, atStuds(studs));
	expect(machine.weight('walk')).toBeCloseTo(1, 9);
	run(machine, 0.05, standing);
	expect(machine.state).toBe('idle');
	expect(machine.weight('idle')).toBeCloseTo(0.25, 9);
	run(machine, 0.15, standing);
	expect(machine.weight('idle')).toBeCloseTo(1, 9);
});

it('keeps the walk/run shares while stopping, like Animate', () => {
	const machine = new AvatarStateMachine();
	run(machine, 0.5, atStuds(16));
	run(machine, 0.05, standing);
	expect(machine.runWeight).toBe(1);
});

it('keeps every crossfade normalized', () => {
	const machine = new AvatarStateMachine();
	const script = (time: number): MotionInput =>
		time < 0.15
			? atStuds(16)
			: time < 0.25
				? standing
				: time < 0.3
					? { ...standing, sitting: true }
					: { ...standing, grounded: false, airTime: time - 0.3, verticalSpeed: -5 };
	run(machine, 0.6, script, 0.01, () => {
		const sum = machine.weights.reduce((total, weight) => total + weight, 0);
		expect(sum).toBeCloseTo(1, 12);
		for (const weight of machine.weights) expect(weight).toBeGreaterThanOrEqual(0);
	});
});

/** A jump from the ground at t = 0 under the engine's gravity, sampled every dt. */
function jumpArc(dt: number) {
	const machine = new AvatarStateMachine();
	run(machine, 0.5, standing);
	const log: { time: number; state: AvatarState; jump: number; fall: number }[] = [];
	run(
		machine,
		0.7,
		(time) => ({
			...standing,
			grounded: false,
			jumped: time <= dt,
			airTime: time,
			verticalSpeed: JUMP_SPEED - GRAVITY * time
		}),
		dt,
		(time) =>
			log.push({ time, state: machine.state, jump: machine.weight('jump'), fall: machine.weight('fall') })
	);
	return log;
}

it.each([1 / 30, 1 / 60, 1 / 144])('holds the jump 0.31 s, then fades into fall over 0.2 s (dt %s)', (dt) => {
	for (const { time, state, jump, fall } of jumpArc(dt)) {
		const held = time < ANIMATE.jumpDuration - 1e-9;
		expect(state).toBe(held ? 'jump' : 'fall');
		if (time <= ANIMATE.jumpDuration) expect(jump).toBeCloseTo(Math.min(1, time / ANIMATE.jumpFade), 9);
		const expected = Math.min(1, Math.max(0, (time - ANIMATE.jumpDuration) / ANIMATE.fallFade));
		expect(fall).toBeCloseTo(expected, 9);
	}
});

it('falls off a ledge after the coyote delay, without the jump pose', () => {
	const machine = new AvatarStateMachine({ fallDelay: 0.08 });
	run(machine, 0.5, atStuds(16));
	let sawJump = false;
	run(
		machine,
		0.5,
		(time) => ({ ...atStuds(16), grounded: false, airTime: time, verticalSpeed: -GRAVITY * time }),
		0.01,
		(time) => {
			sawJump ||= machine.weight('jump') > 0;
			expect(machine.state).toBe(time < 0.08 - 1e-9 ? 'walk' : 'fall');
			if (time >= 0.08) expect(machine.weight('fall')).toBeCloseTo(Math.min(1, (time - 0.08) / 0.2), 9);
		}
	);
	expect(sawJump).toBe(false);
});

it('lands straight into walk or idle over 0.2 s and reports the landing speed', () => {
	const machine = new AvatarStateMachine();
	run(machine, 0.6, { ...standing, grounded: false, airTime: 1, verticalSpeed: -20 });
	expect(machine.state).toBe('fall');
	machine.update(0.1, atStuds(16));
	expect(machine.landed).toBe(true);
	expect(machine.landingSpeed).toBe(20);
	expect(machine.state).toBe('walk');
	expect(machine.weight('walk')).toBeCloseTo(0.5, 9);
	machine.update(0.1, atStuds(16));
	expect(machine.landed).toBe(false);
	expect(machine.weight('walk')).toBeCloseTo(1, 9);
});

it('detects a jump from the upward impulse when the event flag is missed', () => {
	const machine = new AvatarStateMachine();
	run(machine, 0.1, standing);
	machine.update(1 / 30, { ...standing, grounded: false, verticalSpeed: JUMP_SPEED - 2 });
	expect(machine.jumped).toBe(true);
	expect(machine.state).toBe('jump');
});

it.each<[keyof MotionInput, AvatarState, number]>([
	['climbing', 'climb', ANIMATE.climbFade],
	['swimming', 'swim', ANIMATE.swimFade],
	['sitting', 'sit', ANIMATE.sitFade]
])('fades into %s over its Animate time', (flag, state, fade) => {
	const machine = new AvatarStateMachine();
	run(machine, fade / 2, { ...standing, [flag]: true });
	expect(machine.state).toBe(state);
	expect(machine.weight(state)).toBeCloseTo(0.5, 9);
	run(machine, fade / 2, { ...standing, [flag]: true });
	expect(machine.weight(state)).toBeCloseTo(1, 9);
});

it('swims or treads by speed with hysteresis', () => {
	const machine = new AvatarStateMachine();
	const swim = (studs: number): MotionInput => ({ ...standing, swimming: true, speed: studs * STUD });
	run(machine, 1, swim(0.5));
	expect(machine.swimMoveWeight).toBe(0);
	run(machine, 1, swim(1));
	expect(machine.swimMoveWeight).toBe(0);
	run(machine, 1, swim(5));
	expect(machine.swimMoveWeight).toBe(1);
	run(machine, 1, swim(1));
	expect(machine.swimMoveWeight).toBe(1);
	run(machine, 0.2, swim(0));
	expect(machine.swimMoveWeight).toBeCloseTo(0.5, 9);
});

it('plays an emote only while standing still', () => {
	const machine = new AvatarStateMachine();
	run(machine, 0.5, atStuds(16));
	expect(machine.playEmote('wave')).toBe(false);
	run(machine, 0.5, { ...standing, grounded: false, airTime: 0.5, verticalSpeed: -10 });
	expect(machine.playEmote('wave')).toBe(false);
	run(machine, 0.5, standing);
	expect(machine.playEmote('wave')).toBe(true);
	run(machine, ANIMATE.emoteFade, standing);
	expect(machine.state).toBe('emote');
	expect(machine.emote).toBe('wave');
	expect(machine.weight('emote')).toBeCloseTo(1, 9);
	expect(machine.playEmote('cheer')).toBe(false);
});

it('cancels an emote when movement starts', () => {
	const machine = new AvatarStateMachine();
	machine.playEmote('cheer');
	run(machine, 0.3, standing);
	expect(machine.emoting).toBe(true);
	machine.update(0.01, atStuds(8));
	expect(machine.emoting).toBe(false);
	expect(machine.state).toBe('walk');

	// Pushing the stick against a wall cancels it too, back to idle.
	machine.reset();
	machine.playEmote('point');
	run(machine, 0.3, standing);
	machine.update(0.01, { ...standing, intent: 1 });
	expect(machine.emoting).toBe(false);
	expect(machine.state).toBe('idle');
});

it('drops an emote whose character moved before it started', () => {
	const machine = new AvatarStateMachine();
	expect(machine.playEmote('wave')).toBe(true);
	machine.update(0.01, atStuds(8));
	expect(machine.emote).toBe(null);
	expect(machine.state).toBe('walk');
});

it('returns to idle over 0.15 s when a one-shot emote ends', () => {
	const machine = new AvatarStateMachine();
	machine.playEmote('point');
	const end = EMOTES.point.period;
	run(machine, end + ANIMATE.loopFade / 2, standing, 1 / 60, (time) => {
		if (time < end - 1e-9) expect(machine.state).toBe('emote');
		else expect(machine.weight('idle')).toBeCloseTo((time - end) / ANIMATE.loopFade, 9);
	});
	expect(machine.state).toBe('idle');
	expect(machine.emoting).toBe(false);
	run(machine, ANIMATE.loopFade / 2, standing);
	expect(machine.weight('idle')).toBeCloseTo(1, 9);
});
