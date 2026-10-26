import { expect, it } from 'vitest';
import { AvatarAnimator, createAvatarInput } from './avatar-animator.ts';
import { AVATAR_LAYOUT } from './joints.ts';
import { JOINT_STRIDE } from './skeleton.ts';

const at = (joint: keyof typeof AVATAR_LAYOUT.index, c = 0) => AVATAR_LAYOUT.index[joint] * JOINT_STRIDE + c;
it('prioritizes attached hang/row states, cancels emotes and normalizes all fade weights', () => {
	const a = new AvatarAnimator(),
		i = createAvatarInput();
	a.playEmote('wave');
	a.update(0.1, i);
	i.hanging = true;
	i.grounded = false;
	i.jumped = true;
	i.climbing = true;
	i.sitting = true;
	for (let n = 0; n < 30; n++) a.update(1 / 60, i);
	expect(a.state).toBe('hang');
	expect(a.states.emoting).toBe(false);
	expect(a.states.weight('hang')).toBe(1);
	i.hanging = false;
	i.climbing = false;
	i.rowing = true;
	for (let n = 0; n < 30; n++) a.update(1 / 60, i);
	expect(a.state).toBe('row');
	expect(a.states.weights.reduce((x, y) => x + y, 0)).toBeCloseTo(1);
});
it('keeps the hang grip within 2.4..3 u, lags acceleration and removes swing immediately when reduced', () => {
	const a = new AvatarAnimator(),
		i = createAvatarInput();
	Object.assign(i, { hanging: true, grounded: false, ziplineSpeed: 0 });
	for (let n = 0; n < 60; n++) a.update(1 / 60, i);
	expect(a.pose.data[at('armL')]).toBeLessThan(-2.3);
	i.ziplineSpeed = 11;
	for (let n = 0; n < 8; n++) a.update(1 / 60, i);
	expect(a.hangSwing.value).toBeGreaterThan(0);
	expect(a.hangSwing.value).toBeLessThan(0.15);
	i.reducedMotion = true;
	a.update(1 / 60, i);
	expect(a.hangSwing.value).toBe(0);
	expect(a.pose.data[at('root')]).toBe(0);
	expect(a.pose.data[at('root', 4)]).toBe(0);
});
it('locks the ladder cycle to two rung spacings, stops on hold and reverses with descent', () => {
	const a = new AvatarAnimator(),
		i = createAvatarInput();
	Object.assign(i, { climbing: true, grounded: false, ladderRungSpacing: 0.45, verticalSpeed: 0.45 });
	a.update(0.25, i);
	a.update(0.25, i);
	expect(a.climbPhase).toBeCloseTo(0.25);
	i.verticalSpeed = 0;
	a.update(0.25, i);
	expect(a.climbPhase).toBeCloseTo(0.25);
	i.verticalSpeed = -0.9;
	a.update(0.25, i);
	expect(a.climbPhase).toBeCloseTo(0);
	i.ladderDistance = 2.25;
	a.update(0, i);
	expect(a.climbPhase).toBeCloseTo(0.5);
});
it('uses canoe stroke radians, mirrors the paddle side and does not row from current drift alone', () => {
	const a = new AvatarAnimator(),
		i = createAvatarInput();
	Object.assign(i, {
		rowing: true,
		sitting: true,
		grounded: false,
		canoeStroke: Math.PI / 2,
		canoeSpeed: 4,
		paddleSide: 1
	});
	for (let n = 0; n < 60; n++) a.update(1 / 60, i);
	expect(a.rowPhase).toBeCloseTo(0.25);
	const left = a.pose.data[at('armL', 2)],
		right = a.pose.data[at('armR', 2)];
	i.paddleSide = -1;
	a.update(0, i);
	expect(a.pose.data[at('armR', 2)]).toBeCloseTo(-left);
	expect(a.pose.data[at('armL', 2)]).toBeCloseTo(-right);
	i.canoeSpeed = 0;
	a.update(0, i);
	const still = Array.from(a.pose.data);
	i.canoeStroke = (i.canoeStroke ?? 0) + 2;
	a.update(0, i);
	expect(Array.from(a.pose.data)).toEqual(still);
});
it('keeps rowing hands active but removes all row bob with reduced motion', () => {
	const a = new AvatarAnimator(),
		i = createAvatarInput();
	Object.assign(i, { rowing: true, sitting: true, grounded: false, canoeSpeed: 4, reducedMotion: true });
	for (let n = 0; n < 60; n++) a.update(1 / 60, i);
	const y = a.pose.data[at('root', 4)],
		hand = a.pose.data[at('armL')];
	i.canoeStroke = Math.PI / 2;
	a.update(1 / 60, i);
	expect(a.pose.data[at('root', 4)]).toBeCloseTo(y);
	expect(a.pose.data[at('armL')]).not.toBeCloseTo(hand);
});
it('reuses the pose and keeps malformed traversal inputs finite through transitions', () => {
	const a = new AvatarAnimator(),
		i = createAvatarInput(),
		p = a.pose,
		d = p.data;
	Object.assign(i, {
		hanging: true,
		ziplineSpeed: Infinity,
		ladderRungSpacing: NaN,
		canoeStroke: NaN,
		canoeSpeed: NaN
	});
	for (const mode of ['hang', 'row', 'climb', 'idle']) {
		i.hanging = mode === 'hang';
		i.rowing = mode === 'row';
		i.climbing = mode === 'climb';
		for (const dt of [0, 0.016, 0.2, 5, NaN]) {
			expect(a.update(dt, i)).toBe(p);
			expect(a.pose.data).toBe(d);
			expect([...d].every(Number.isFinite)).toBe(true);
		}
	}
});

it('separates alternating hands by the authored rung spacing, including nondefault ladders', () => {
	for (const spacing of [0.3, 0.45, 0.6]) {
		const a = new AvatarAnimator(),
			i = createAvatarInput();
		Object.assign(i, { climbing: true, grounded: false, ladderRungSpacing: spacing, ladderDistance: 0 });
		for (let n = 0; n < 60; n++) a.update(1 / 60, i);
		const left = 2 - Math.cos(a.pose.data[at('armL')]);
		const right = 2 - Math.cos(a.pose.data[at('armR')]);
		expect(left - right).toBeCloseTo(spacing, 8);
		i.ladderDistance = spacing;
		a.update(0, i);
		expect(2 - Math.cos(a.pose.data[at('armL')])).toBeCloseTo(right, 8);
		expect(2 - Math.cos(a.pose.data[at('armR')])).toBeCloseTo(left, 8);
	}
});
it('holds the planted hand at one rung height while the feet climb to the next rung', () => {
	const a = new AvatarAnimator(),
		i = createAvatarInput();
	Object.assign(i, { climbing: true, grounded: false, ladderRungSpacing: 0.45, ladderDistance: 0 });
	for (let n = 0; n < 60; n++) a.update(1 / 60, i);
	const planted = 2 - Math.cos(a.pose.data[at('armL')]);
	for (const distance of [0.05, 0.1, 0.2, 0.3, 0.4]) {
		i.ladderDistance = distance;
		a.update(0, i);
		expect(distance + 2 - Math.cos(a.pose.data[at('armL')])).toBeCloseTo(planted, 8);
	}
});
