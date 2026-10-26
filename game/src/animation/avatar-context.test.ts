import { getHeapStatistics } from 'node:v8';
import { Object3D, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { AVATAR_HEIGHT, STUD, WALK_SPEED } from '../engine/constants.ts';
import { AvatarAnimator, type AvatarInput, CONTEXT, createAvatarInput, GESTURE } from './avatar-animator.ts';
import { EMOTES } from './avatar-poses.ts';
import { HAIR_SWAY } from './hair-sway.ts';
import { AVATAR_LAYOUT, BLOCKY_RIG } from './joints.ts';
import { type LookCandidate, pickLookTarget } from './look-target.ts';
import { applyToRig, bindRig } from './rig.ts';
import { JOINT_STRIDE } from './skeleton.ts';

const DEG = Math.PI / 180;
/** Bytes V8 allocated so far, or null where Node does not report it (@types/node's HeapInfo lacks the field). */
function allocated(): number | null {
	const stats: object = getHeapStatistics();
	return 'total_allocated_bytes' in stats && typeof stats.total_allocated_bytes === 'number'
		? stats.total_allocated_bytes
		: null;
}
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

/** Min and max of one pose channel over `seconds`. */
function range(animator: AvatarAnimator, seconds: number, next: AvatarInput, channel: number) {
	let min = Number.POSITIVE_INFINITY;
	let max = Number.NEGATIVE_INFINITY;
	run(animator, seconds, next, 1 / 60, () => {
		const value = animator.pose.data[channel];
		min = Math.min(min, value);
		max = Math.max(max, value);
	});
	return { min, max, swing: max - min };
}

describe('contextual locomotion', () => {
	const walk = (overrides: Partial<AvatarInput> = {}) => input({ speed: 4 * STUD, intent: 1, ...overrides });

	it('takes shorter steps with the arms out and a wobble on narrow footing', () => {
		const ground = new AvatarAnimator();
		const narrow = new AvatarAnimator();
		run(ground, 2, walk());
		run(narrow, 2, walk({ surface: 'narrow' }));
		expect(narrow.narrow).toBeGreaterThan(0.99);
		expect(narrow.cadence).toBeCloseTo(ground.cadence / CONTEXT.narrowStride, 2);
		const legs = range(narrow, 2, walk({ surface: 'narrow' }), at('legL', 0)).swing;
		const groundLegs = range(ground, 2, walk(), at('legL', 0)).swing;
		expect(legs).toBeLessThan(groundLegs * 0.7);
		expect(narrow.pose.data[at('armL', 2)]).toBeGreaterThan(45 * DEG);
		expect(narrow.pose.data[at('armR', 2)]).toBeLessThan(-45 * DEG);
		// Standing on a stone: the wobble rolls the body.
		expect(range(narrow, 2, input({ surface: 'narrow' }), at('root', 2)).swing).toBeGreaterThan(4 * DEG);
	});

	it('wades with high knees and a slower cycle', () => {
		const ground = new AvatarAnimator();
		const water = new AvatarAnimator();
		run(ground, 2, walk());
		run(water, 2, walk({ surface: 'water' }));
		expect(water.cadence).toBeCloseTo(ground.cadence / CONTEXT.waterStride, 2);
		const knee = range(water, 2, walk({ surface: 'water' }), at('legL', 0)).min;
		const groundKnee = range(ground, 2, walk(), at('legL', 0)).min;
		expect(knee).toBeLessThan(groundKnee * (1 + CONTEXT.waterKnees * 0.7));
		// The back swing does not grow.
		expect(range(water, 2, walk({ surface: 'water' }), at('legL', 0)).max).toBeCloseTo(
			range(ground, 2, walk(), at('legL', 0)).max,
			2
		);
	});

	it('leans into an uphill and braces going down', () => {
		const torso = (slope: number) => {
			const animator = new AvatarAnimator();
			run(animator, 1.5, walk({ slope }));
			return { torso: animator.pose.data[at('torso', 0)], arm: animator.pose.data[at('armL', 0)] };
		};
		const flat = torso(0);
		const up = torso(20 * DEG);
		const down = torso(-20 * DEG);
		expect(up.torso - flat.torso).toBeCloseTo(20 * DEG * CONTEXT.slopeLean, 2);
		expect(down.torso - flat.torso).toBeCloseTo(-20 * DEG * CONTEXT.slopeBrace, 2);
		expect(torso(80 * DEG).torso - flat.torso).toBeCloseTo(CONTEXT.slopeMax, 2);
		expect(down.arm).toBeLessThan(flat.arm - 5 * DEG);
	});

	it('teeters at an edge ahead, windmilling the arms, and stops away from it', () => {
		const animator = new AvatarAnimator();
		run(animator, 1, input({ edgeAhead: 0.3 }));
		expect(animator.teeter).toBeGreaterThan(0.99);
		const arm = range(animator, 2, input({ edgeAhead: 0.3 }), at('armL', 0));
		expect((arm.min + arm.max) / 2).toBeCloseTo(-90 * DEG, 1);
		expect(arm.swing).toBeGreaterThan(100 * DEG);
		run(animator, 1, input({ edgeAhead: 0.6 }));
		expect(animator.teeter).toBeLessThan(0.01);
		// Running past an edge barely teeters.
		const runner = new AvatarAnimator();
		run(runner, 1, input({ edgeAhead: 0.2, speed: WALK_SPEED, intent: 1 }));
		expect(runner.teeter).toBeLessThan(0.01);
	});

	it('keeps the reduced-motion rules: swings off, postures halved', () => {
		const full = new AvatarAnimator();
		const reduced = new AvatarAnimator();
		run(full, 2, input({ surface: 'narrow' }));
		run(reduced, 2, input({ surface: 'narrow', reducedMotion: true }));
		expect(range(reduced, 2, input({ surface: 'narrow', reducedMotion: true }), at('root', 2)).swing).toBe(0);
		const out = (animator: AvatarAnimator) => animator.pose.data[at('armL', 2)];
		const rest = new AvatarAnimator();
		run(rest, 2, input({ reducedMotion: true }));
		expect(out(reduced) - out(rest)).toBeCloseTo(CONTEXT.narrowArms / 2, 1);
		expect(out(full) - out(rest)).toBeGreaterThan(CONTEXT.narrowArms * 0.8);
		// No windmill: the arm moves no more than the reduced idle's own breathing.
		const teeter = new AvatarAnimator();
		run(teeter, 1, input({ edgeAhead: 0.3, reducedMotion: true }));
		expect(teeter.teeter).toBeGreaterThan(0.99);
		const idleSwing = range(rest, 2, input({ reducedMotion: true }), at('armL', 0)).swing;
		expect(
			range(teeter, 2, input({ edgeAhead: 0.3, reducedMotion: true }), at('armL', 0)).swing
		).toBeLessThanOrEqual(idleSwing + 1e-6);
		const slope = (reducedMotion: boolean) => {
			const animator = new AvatarAnimator();
			run(animator, 1.5, input({ slope: 20 * DEG, reducedMotion }));
			return animator.slopeLean.value;
		};
		expect(slope(true)).toBeCloseTo(slope(false) / 2, 3);
	});
});

/** The avatar.glb hierarchy (joints.ts), scaled to the 3 u avatar and placed like the runtime does. */
function rigAt(x: number, y: number, z: number, yaw: number) {
	const model = new Object3D();
	const root = new Object3D();
	root.name = 'root';
	const node = (name: string, parent: Object3D, px: number, py: number, pz: number) => {
		const child = new Object3D();
		child.name = name;
		child.position.set(px, py, pz);
		parent.add(child);
		return child;
	};
	model.add(root);
	node('leg-left', root, 0.2, 1, 0);
	node('leg-right', root, -0.2, 1, 0);
	const torso = node('torso', root, 0, 0.7, 0);
	const armLeft = node('arm-left', torso, 0.4, 1.1, -0.1);
	const armRight = node('arm-right', torso, -0.4, 1.1, -0.1);
	node('head', torso, 0, 1.2, 0);
	model.position.set(x, y, z);
	model.rotation.y = yaw;
	model.scale.setScalar(AVATAR_HEIGHT / 2.7);
	const rig = bindRig(model, AVATAR_LAYOUT, BLOCKY_RIG);
	return {
		/** How far the nearer hand is from the point. */
		reach(animator: AvatarAnimator, point: { x: number; y: number; z: number }) {
			applyToRig(animator.pose, rig);
			model.updateMatrixWorld(true);
			const target = new Vector3(point.x, point.y, point.z);
			const hand = new Vector3(0, -GESTURE.armReach, 0);
			return Math.min(
				armLeft.localToWorld(hand.clone()).distanceTo(target),
				armRight.localToWorld(hand.clone()).distanceTo(target)
			);
		}
	};
}

describe('gestures', () => {
	it.each([
		{ feet: [0, 0, 0], yaw: 0, target: [0, 0.3, 0.9] },
		{ feet: [10, 2, -4], yaw: 1.2, target: [10.75, 2.25, -3.7] },
		{ feet: [-3, 1, 5], yaw: -2.4, target: [-3.9, 1.6, 4.5] },
		{ feet: [0, 0, 0], yaw: 0, target: [0.4, 0.2, 0.8] }
	])('picks up: the hand on its side reaches the point ($target)', ({ feet, yaw, target }) => {
		const animator = new AvatarAnimator();
		const still = input({ x: feet[0], y: feet[1], z: feet[2], yaw });
		run(animator, 0.5, still);
		const point = { x: target[0], y: target[1], z: target[2] };
		expect(animator.playGesture('pickup', point)).toBe(true);
		const rig = rigAt(feet[0], feet[1], feet[2], yaw);
		let closest = Number.POSITIVE_INFINITY;
		run(animator, 0.6, still, 1 / 60, () => {
			closest = Math.min(closest, rig.reach(animator, point));
		});
		expect(closest).toBeLessThan(0.25);
		run(animator, 0.3, still);
		expect(animator.state).toBe('idle');
	});

	it('picks up without a target just ahead of the feet, in about 0.6 s', () => {
		const animator = new AvatarAnimator();
		run(animator, 0.5, input());
		expect(animator.playGesture('pickup')).toBe(true);
		const rig = rigAt(0, 0, 0, 0);
		let closest = Number.POSITIVE_INFINITY;
		run(animator, 0.6, input(), 1 / 60, () => {
			closest = Math.min(closest, rig.reach(animator, { x: 0, y: GESTURE.pickupUp, z: GESTURE.pickupAhead }));
		});
		expect(closest).toBeLessThan(0.25);
		expect(EMOTES.pickup.period).toBeCloseTo(0.6, 9);
	});

	it('pets the animal: crouched, hand on it, stroking', () => {
		const animator = new AvatarAnimator();
		run(animator, 0.5, input());
		const mico = { x: 0.1, y: 0.45, z: 1.05 };
		expect(animator.playGesture('pet', mico)).toBe(true);
		const rig = rigAt(0, 0, 0, 0);
		const distances: number[] = [];
		run(animator, 2.6, input(), 1 / 60, (time) => {
			if (time > 0.8 && time < 1.8) distances.push(rig.reach(animator, mico));
		});
		expect(Math.min(...distances)).toBeLessThan(0.2);
		// Strokes move the hand back and forth over the animal.
		expect(Math.max(...distances) - Math.min(...distances)).toBeGreaterThan(0.1);
	});

	it('raises the binoculars to the eyes and scans', () => {
		const animator = new AvatarAnimator();
		run(animator, 0.5, input());
		expect(animator.playGesture('binoculars')).toBe(true);
		run(animator, 0.6, input());
		expect(animator.pose.data[at('armL', 0)]).toBeLessThan(-120 * DEG);
		expect(animator.pose.data[at('armR', 0)]).toBeLessThan(-120 * DEG);
		const scan = range(animator, 2, input(), at('torso', 1));
		expect(scan.swing).toBeGreaterThan(25 * DEG);
		run(animator, 1.5, input());
		expect(animator.state).toBe('idle');
	});

	it('talks while a dialogue is open, looking at the speaker, and stops when it closes', () => {
		const animator = new AvatarAnimator();
		const iara = { x: 2, y: 2.4, z: 4 };
		run(animator, 0.4, input({ speed: 6, intent: 1, talking: true }));
		expect(animator.states.emote).toBeNull();
		run(animator, 10, input({ talking: true, lookTarget: iara }));
		expect(animator.state).toBe('emote');
		expect(animator.states.emote).toBe('talk');
		const gesture = range(animator, 3.6, input({ talking: true, lookTarget: iara }), at('armR', 0));
		expect(gesture.swing).toBeGreaterThan(30 * DEG);
		expect(animator.lookYaw.value).toBeGreaterThan(10 * DEG);
		run(animator, 0.5, input({ talking: false }));
		expect(animator.state).toBe('idle');
	});

	it('cheers at mission complete and refuses gestures on the move', () => {
		const animator = new AvatarAnimator();
		run(animator, 0.5, input({ speed: 8, intent: 1 }));
		for (const id of ['pickup', 'pet', 'binoculars', 'cheer'] as const)
			expect(animator.playGesture(id)).toBe(false);
		run(animator, 0.5, input());
		expect(animator.playGesture('cheer')).toBe(true);
	});
});

describe('hair swing', () => {
	/** Feet accelerating forward from rest to a walk, holding it, then stopping. */
	function startStop(style: string, reducedMotion = false) {
		const animator = new AvatarAnimator();
		animator.hairStyle = style;
		const log: number[] = [];
		let z = 0;
		let speed = 0;
		run(
			animator,
			4,
			(time) => {
				const target = time > 0.5 && time < 2 ? WALK_SPEED : 0;
				speed += (target - speed) * 0.15;
				z += speed / 60;
				return input({ speed, intent: target > 0 ? 1 : 0, z, reducedMotion });
			},
			1 / 60,
			() => log.push(animator.hair.pitch)
		);
		return log;
	}

	it('swings the ponytail back on a start and forward on a stop, overshooting', () => {
		const log = startStop('rabo');
		const start = log.slice(30, 90);
		const stop = log.slice(120, 200);
		expect(Math.max(...start)).toBeGreaterThan(5 * DEG);
		expect(Math.min(...stop)).toBeLessThan(-5 * DEG);
		expect(Math.max(...log.map(Math.abs))).toBeLessThanOrEqual(HAIR_SWAY.rabo?.maxPitch ?? 0);
	});

	it('keeps the cap and short hair still, the bun stiff, and everything still with reduced motion', () => {
		for (const style of ['bone', 'curto', 'longo', 'black-power', 'nao-existe'])
			expect(Math.max(...startStop(style).map(Math.abs))).toBe(0);
		expect(Math.max(...startStop('coque').map(Math.abs))).toBeLessThan(
			Math.max(...startStop('rabo').map(Math.abs))
		);
		expect(Math.max(...startStop('trancas', true).map(Math.abs))).toBe(0);
	});

	it('forgets the speed on a teleport', () => {
		const animator = new AvatarAnimator();
		animator.hairStyle = 'rabo';
		run(animator, 1, input());
		run(animator, 1 / 60, input({ x: 200, z: -50 }));
		run(animator, 0.5, input({ x: 200, z: -50 }));
		expect(Math.abs(animator.hair.pitch)).toBeLessThan(1 * DEG);
	});
});

describe('pickLookTarget', () => {
	const avatar = { x: 0, z: 0, yaw: 0 };
	const at3 = (id: number, kind: LookCandidate['kind'], x: number, z: number): LookCandidate => ({
		id,
		kind,
		x,
		y: 1.5,
		z
	});

	it('prefers Iara, then animals, then collectibles, nearest first, inside the cone and range', () => {
		const coin = at3(1, 'collectible', 0, 3);
		const mico = at3(2, 'animal', 1, 8);
		const bird = at3(3, 'animal', -1, 5);
		const iara = at3(4, 'iara', 3, 6);
		expect(pickLookTarget([coin], avatar)).toBe(coin);
		expect(pickLookTarget([coin, mico, bird], avatar)).toBe(bird);
		expect(pickLookTarget([coin, mico, bird, iara], avatar)).toBe(iara);
		expect(pickLookTarget([at3(5, 'iara', 0, -5)], avatar)).toBeNull();
		expect(pickLookTarget([at3(6, 'collectible', 0, 7)], avatar)).toBeNull();
		expect(pickLookTarget([at3(7, 'animal', 0, 0.2)], avatar)).toBeNull();
		expect(pickLookTarget([], avatar)).toBeNull();
	});

	it('keeps the current target in a wider cone and range: no snapping', () => {
		const a = at3(1, 'animal', 0, 6);
		const b = at3(2, 'animal', 0.5, 3);
		expect(pickLookTarget([a, b], avatar, 1)).toBe(a);
		// a drifts to 70° off the facing: out of the pick cone, inside the keep cone.
		const drifted = at3(1, 'animal', 6 * Math.sin(70 * DEG), 6 * Math.cos(70 * DEG));
		expect(pickLookTarget([drifted], avatar, null)).toBeNull();
		expect(pickLookTarget([drifted], avatar, 1)).toBe(drifted);
		expect(pickLookTarget([at3(1, 'animal', 0, 17)], avatar, 1)).toBeTruthy();
		expect(pickLookTarget([at3(1, 'animal', 0, 19)], avatar, 1)).toBeNull();
		// A higher kind takes over at once.
		const iara = at3(9, 'iara', -1, 4);
		expect(pickLookTarget([a, iara], avatar, 1)).toBe(iara);
		// Turning away lets go and picks again.
		expect(pickLookTarget([a, b], { x: 0, z: 0, yaw: Math.PI }, 1)).toBeNull();
	});

	it('does not flicker as a target wobbles across the cone edge', () => {
		let current: number | null = null;
		let switches = 0;
		for (let i = 0; i < 600; i++) {
			const angle = (60 + 8 * Math.sin(i * 0.3)) * DEG;
			const c = at3(1, 'animal', 5 * Math.sin(angle), 5 * Math.cos(angle));
			const picked = pickLookTarget([c], avatar, current);
			const id = picked?.id ?? null;
			if (id !== current) switches++;
			current = id;
		}
		expect(switches).toBeLessThanOrEqual(1);
	});
});

describe('cost', () => {
	it.skipIf(allocated() === null)('allocates nothing per update, with every layer busy', () => {
		const animator = new AvatarAnimator({ seed: 3 });
		animator.hairStyle = 'rabo';
		const target = { x: 1, y: 2, z: 5 };
		const candidates: LookCandidate[] = [
			{ id: 1, kind: 'animal', x: 1, y: 1, z: 5 },
			{ id: 2, kind: 'iara', x: -2, y: 2.4, z: 6 }
		];
		const surfaces = ['ground', 'narrow', 'water'] as const;
		// A 12 s loop of inputs built up front, so the loop itself stores no numbers
		// (V8 would box them and blur the measurement).
		const inputs = Array.from({ length: 720 }, (_, frame) => {
			const s = frame / 60;
			return input({
				speed: s < 6 ? 5 + 3 * Math.sin(s) : 0,
				intent: s < 6 ? 1 : 0,
				surface: surfaces[((frame / 240) | 0) % 3],
				slope: 0.3 * Math.sin(s),
				edgeAhead: s > 8 && s < 9 ? 0.2 : Number.POSITIVE_INFINITY,
				talking: s > 9 && s < 11,
				yaw: 0.2 * s,
				z: frame * 0.05
			});
		});
		let lookId: number | null = null;
		const run = (updates: number) => {
			for (let frame = 0; frame < updates; frame++) {
				const next = inputs[frame % 720];
				const picked = pickLookTarget(candidates, next, lookId);
				lookId = picked === null ? null : picked.id;
				next.lookTarget = picked === null ? target : picked;
				if (frame % 720 === 690) animator.playGesture('pickup', target);
				animator.update(1 / 60, next);
			}
		};
		// Until every function is optimized V8 boxes numbers, so warm up first; the
		// best of a few long runs keeps out the compiler's own allocations.
		run(200000);
		let perUpdate = Number.POSITIVE_INFINITY;
		for (let attempt = 0; attempt < 5; attempt++) {
			const before = allocated() ?? 0;
			run(100000);
			perUpdate = Math.min(perUpdate, ((allocated() ?? 0) - before) / 100000);
		}
		// One boxed number is 12 to 16 B: under 4 B means none in the steady state.
		expect(perUpdate).toBeLessThan(4);
	});

	it('stays finite with garbage context', () => {
		const animator = new AvatarAnimator();
		animator.hairStyle = 'trancas';
		animator.playGesture('pickup', { x: Number.NaN, y: 0, z: 1 });
		for (const dt of [0, 1 / 60, 0.25, Number.NaN, 5])
			for (const overrides of [
				{ slope: Number.NaN, edgeAhead: Number.NaN },
				{ slope: Number.POSITIVE_INFINITY, edgeAhead: -1, surface: 'narrow' as const },
				{ x: Number.NaN, yaw: Number.POSITIVE_INFINITY, surface: 'water' as const, speed: 4 },
				{ talking: true }
			]) {
				const pose = animator.update(dt, input(overrides));
				for (const value of pose.data) expect(Number.isFinite(value)).toBe(true);
				expect(Number.isFinite(animator.hair.pitch) && Number.isFinite(animator.hair.roll)).toBe(true);
			}
	});
});
