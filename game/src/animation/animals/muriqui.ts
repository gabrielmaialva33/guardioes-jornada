/**
 * Muriqui (Brachyteles), the largest primate in the Americas: it travels below
 * the branches by brachiation, arm over arm, and its prehensile tail is a fifth
 * hand: it can hang by the tail alone and feed with both hands (Strier 1992;
 * Wisconsin NPRC factsheet; ICMBio PAN Muriquis).
 *
 * Brachiation is faked as a pendulum (animacoes.md §5.3): the shoulder swings
 * about the gripping hand, θ'' = −ω0² sin θ − c θ' + k (E* − E) θ'. The last
 * term pumps energy toward a target E* = ω0² (1 − cos θmax), the single knob
 * that sets the rhythm; gibbon studies show brachiation is this pendular
 * exchange of energy (Bertram et al. 1999, J. Exp. Biol. 202:2609–2617). At the
 * forward apex, if the free hand reaches the next handhold, the grip switches
 * and the swing continues about the new hand.
 *
 * The pendulum runs in fixed 1/240 s steps with its own accumulator, so its
 * trajectory and its swing period do not depend on the frame rate or on LOD
 * skipping; the render interpolates between the last two steps.
 *
 * Handholds: everything above is scale-free in arm lengths (the period is the
 * real animal's), so the spacing a level can use follows the arm in world
 * units; see MURIQUI_HOLDS.
 */
import { SPRING } from '../../style/motion.ts';
import { Behaviour, type BehaviourOptions } from './behaviour.ts';
import { DampedSpring } from './damped-spring.ts';
import type { AnimalWorld } from './motion.ts';
import { MODELS } from './rigs.ts';
import type { Route } from './route.ts';
import { clamp01, DEG, TAU, wrapAngle } from './scalar.ts';
import { SPECIES } from './species.ts';

export const MURIQUI_STATES = ['idle', 'move', 'rest', 'tail-hang'] as const;
export type MuriquiState = (typeof MURIQUI_STATES)[number];

/** Fixed pendulum step, seconds. */
export const PENDULUM_STEP = 1 / 240;

export const MURIQUI = {
	/**
	 * Natural period of the hanging body, seconds: a pendulum of ~0.6 m from hand
	 * to centre of mass (2π√(0.6 / 9.81) ≈ 1.55 s), the real animal's, not the
	 * ×1.5 model's.
	 */
	period: 1.6,
	/** Passive damping, 1/s, and the energy pump gain. */
	damping: 0.4,
	pump: 0.3,
	/** Extra amplitude over the minimum that reaches the next handhold. */
	margin: 4 * DEG,
	/** The free hand can stretch this much past the arm length to grasp. */
	reachSlack: 1.12,
	/** Share of the swing the trunk follows. */
	tiltFollow: 0.8,
	/** Idle sway amplitude (decorative: 0 with reduced motion). */
	idleSway: 3 * DEG,
	/** Push from the legs when a swing starts from still, rad/s. */
	startKick: 0.8,
	idle: [3, 8],
	rest: [8, 20],
	tailHang: [6, 14],
	handholds: [2, 6],
	moveChance: 0.55,
	tailChance: 0.25,
	glance: [1.2, 3],
	glanceYaw: 50 * DEG,
	/** Crossfade between the arm hang and the tail hang. */
	hangFade: 0.6,
	/**
	 * Highest swing the pump raises its target to when a hold is short of reach
	 * (horizontal), and the apexes it swings there before giving up on that hold
	 * and turning back. Without a cap the target grew 15% per apex until the
	 * body went over the top and spun around the hand.
	 */
	swingCap: 90 * DEG,
	giveUp: 4
} as const;

/** Arm length in world units: the stretched Cube Pets front leg at the species scale. */
const ARM = MODELS.monkey.legLength * SPECIES.muriqui.limbScale.front * SPECIES.muriqui.scale;

/**
 * Handhold spacing for level design, world units (holds below a branch, in a
 * row). Measured with the behaviour's pendulum over spacings in arm lengths
 * (p3-animals-height.md): 1.3–1.63 arms swing 43–60° and take 0.83–0.85 s per
 * hold; 1.73 arms (a 68° swing) is the widest that still reads as arm-over-arm
 * brachiation; past ~2.08 arms no swing below horizontal reaches, and the
 * muriqui gives up and turns back. At the ART.md 1.7 u height the arm is
 * 0.77 u: space holds 1.0–1.25 u apart, never more than 1.33 u.
 */
export const MURIQUI_HOLDS = {
	arm: ARM,
	min: 1.3 * ARM,
	max: 1.63 * ARM,
	reach: 1.73 * ARM,
	limit: 2.08 * ARM
} as const;

/**
 * The pump settles where k (E* − E) = c, so the swing would run c/k short of
 * its target: targets are raised by that much, and the first apex reaches the
 * next hold on time.
 */
const PUMP_OFFSET = MURIQUI.damping / MURIQUI.pump;

export interface MuriquiOptions extends BehaviourOptions {
	/** Handholds below a branch, in order (world points the hand grips). At least one. */
	anchors: Route;
	/** Handhold to start on. */
	start?: number;
}

export class MuriquiBehaviour extends Behaviour<MuriquiState> {
	readonly states = MURIQUI_STATES;
	readonly anchors: Route;
	/** Handhold the hand grips, and the way along the handholds. */
	anchor = 0;
	direction = 1;
	/** Pendulum angle and angular velocity of the shoulder about the gripping hand. */
	theta = 0;
	omega = 0;
	/** Pendulum clock (fixed steps only) and energy target. */
	pendulumTime = 0;
	energyTarget = 0;
	/** Hand switches so far and the pendulum time of the last one. */
	switches = 0;
	lastSwitchTime = 0;
	/** Gripping hand: 1 left, -1 right. */
	grip = 1;
	/** Arm length in world units (the stretched Cube Pets front leg; MURIQUI_HOLDS.arm). */
	readonly arm: number;
	readonly tilt: DampedSpring;
	#previousTheta = 0;
	#accumulator = 0;
	#handholdsLeft = 0;
	#snapForward = 0;
	#snapUp = 0;
	#maxSwing = 0;
	#glance = 0;
	#lookYaw = 0;
	readonly #point = new Float64Array(3);
	/** Per segment i (hold i to i + 1): swing amplitude and energy that reach across, and yaw. */
	readonly #amplitudes: Float64Array;
	readonly #energies: Float64Array;
	readonly #yaws: Float64Array;
	readonly #reachLimit: number;
	#probeReach = 0;
	#probeTheta = 0;
	#probeSnapForward = 0;
	#probeSnapUp = 0;
	/** Energy of a MURIQUI.swingCap swing (with the pump offset), and apexes spent there short of the hold. */
	readonly #maxEnergy: number;
	#misses = 0;

	constructor(options: MuriquiOptions) {
		super('muriqui', 'idle', options);
		this.anchors = options.anchors;
		this.anchor = Math.min(Math.max(options.start ?? 0, 0), this.anchors.count - 1);
		this.arm = MODELS.monkey.legLength * this.species.limbScale.front * this.species.scale;
		this.#reachLimit = this.arm * MURIQUI.reachSlack;
		const w = TAU / MURIQUI.period;
		this.#maxEnergy = w * w * (1 - Math.cos(MURIQUI.swingCap)) + PUMP_OFFSET;
		const segments = Math.max(1, this.anchors.count - 1);
		this.#amplitudes = new Float64Array(segments);
		this.#energies = new Float64Array(segments);
		this.#yaws = new Float64Array(segments);
		const w0 = TAU / MURIQUI.period;
		const p = this.anchors.points;
		for (let i = 0; i + 1 < this.anchors.count; i++) {
			const dx = p[i * 3 + 3] - p[i * 3];
			const dz = p[i * 3 + 5] - p[i * 3 + 2];
			const sine = Math.min(0.97, Math.sqrt(dx * dx + dz * dz) / (2 * this.arm));
			const amplitude = Math.min(80 * DEG, Math.asin(sine) + MURIQUI.margin);
			this.#amplitudes[i] = amplitude;
			this.#energies[i] = w0 * w0 * (1 - Math.cos(amplitude)) + PUMP_OFFSET;
			this.#yaws[i] = Math.atan2(dx, dz);
		}
		this.tilt = new DampedSpring(SPRING.body, this.species.tempo);
		this.#faceAlong();
		this.motion.yaw = this.drive.targetYaw;
		this.#placeAtAnchor();
		this.enter('idle', MURIQUI.idle[0]);
		this.#setIdleEnergy();
	}

	/** Starts brachiating now across `handholds` holds (the scene can call it, e.g. as the player nears). */
	brachiate(handholds = 4) {
		this.#startMove(Math.max(1, Math.floor(handholds)));
	}

	/** Hangs by the tail to feed. */
	feed(duration: number = MURIQUI.tailHang[0]) {
		this.energyTarget = 0;
		this.enter('tail-hang', duration);
	}

	protected advance(_world: AnimalWorld) {
		const h = this.clock.h;
		this.#accumulator += h;
		while (this.#accumulator >= PENDULUM_STEP) {
			this.#accumulator -= PENDULUM_STEP;
			this.#previousTheta = this.theta;
			this.#pendulumStep();
		}
		const decay = Math.exp(-TAU * SPRING.body.hz * this.species.tempo * h);
		this.#snapForward *= decay;
		this.#snapUp *= decay;
		const tilt = this.tilt;
		tilt.target = this.theta * MURIQUI.tiltFollow;
		tilt.dt = h;
		tilt.update();
		this.turn();
		if (this.state === 'idle') {
			this.#glance -= h;
			if (this.#glance <= 0) {
				this.#glance = this.cosmetic.range(MURIQUI.glance[0], MURIQUI.glance[1]);
				this.#lookYaw = this.cosmetic.range(-MURIQUI.glanceYaw, MURIQUI.glanceYaw);
			}
		} else this.#lookYaw = 0;
	}

	protected decide(_world: AnimalWorld) {
		const rng = this.rng;
		switch (this.state) {
			case 'idle': {
				const roll = rng.next();
				if (roll < MURIQUI.moveChance)
					this.#startMove(Math.floor(rng.range(MURIQUI.handholds[0], MURIQUI.handholds[1] + 1)));
				else if (roll < MURIQUI.moveChance + MURIQUI.tailChance)
					this.feed(rng.range(MURIQUI.tailHang[0], MURIQUI.tailHang[1]));
				else {
					this.energyTarget = 0;
					this.enter('rest', rng.range(MURIQUI.rest[0], MURIQUI.rest[1]));
				}
				break;
			}
			default:
				this.enter('idle', rng.range(MURIQUI.idle[0], MURIQUI.idle[1]));
				this.#setIdleEnergy();
		}
	}

	protected finish(_world: AnimalWorld) {
		const motion = this.motion;
		const scale = this.species.scale;
		const alpha = this.#accumulator / PENDULUM_STEP;
		motion.posture = this.state === 'tail-hang' ? 'hang-tail' : 'hang-arm';
		motion.fade = MURIQUI.hangFade;
		motion.swing = this.#previousTheta + (this.theta - this.#previousTheta) * alpha;
		motion.tilt = this.tilt.value;
		motion.grip = this.grip;
		motion.snapForward = this.#snapForward / scale;
		motion.snapUp = this.#snapUp / scale;
		motion.feeding = this.state === 'tail-hang';
		motion.eat = motion.feeding ? 1 : 0;
		motion.lookYaw = this.#lookYaw;
		motion.lookPitch = 0;
		motion.speed = 0;
		motion.accel = 0;
		// The free hand reaches for the next hold through the forward half of the swing.
		const next = this.anchor + this.direction;
		motion.reach = 0;
		if (this.state === 'move' && next >= 0 && next < this.anchors.count && this.#maxSwing > 0) {
			const point = this.#point;
			this.#read(this.anchor, point);
			const ax = point[0];
			const ay = point[1];
			const az = point[2];
			this.#read(next, point);
			const fx = point[0] - ax;
			const fz = point[2] - az;
			const forward = Math.sqrt(fx * fx + fz * fz);
			motion.reachForward = forward / scale;
			motion.reachUp = (point[1] - ay) / scale;
			if (this.omega > 0) {
				// smoothstep written out (a call taking and returning numbers boxes them when not inlined).
				const r = Math.min(1, Math.max(0, (this.theta + 0.2 * this.#maxSwing) / (0.9 * this.#maxSwing)));
				motion.reach = r * r * (3 - 2 * r);
			}
		}
		this.#placeAtAnchor();
	}

	#pendulumStep() {
		const w0 = TAU / MURIQUI.period;
		const theta = this.theta;
		const omega = this.omega;
		const energy = 0.5 * omega * omega + w0 * w0 * (1 - Math.cos(theta));
		const pump = MURIQUI.pump * (this.energyTarget - energy) * omega;
		const accel = -w0 * w0 * Math.sin(theta) - MURIQUI.damping * omega + pump;
		const next = omega + accel * PENDULUM_STEP;
		this.omega = next;
		this.theta = theta + next * PENDULUM_STEP;
		this.pendulumTime += PENDULUM_STEP;
		if (this.state !== 'move' || !(omega > 0)) return;
		// Every forward step keeps #probe hot, so V8 optimizes it (see #atApex).
		this.#probe();
		if (next <= 0 && this.theta > 0.05) this.#atApex();
	}

	/**
	 * Forward apex: switch hands if the next hold is in reach, else swing higher.
	 * This runs about once a second, too rarely for V8 to optimize it, and the
	 * interpreter boxes every number it computes; so the geometry is done by
	 * #probe (optimized, it runs every step) and the per-segment numbers are
	 * precomputed. What is left here is copying and counting.
	 */
	#atApex() {
		const next = this.anchor + this.direction;
		if (next < 0 || next >= this.anchors.count) {
			this.#stop();
			return;
		}
		this.#probe();
		if (this.#probeReach > this.#reachLimit) {
			// Swing higher, up to horizontal; a hold still out of reach there is given up.
			if (this.energyTarget < this.#maxEnergy)
				this.energyTarget = Math.min(this.#maxEnergy, this.energyTarget * 1.15);
			else if (++this.#misses >= MURIQUI.giveUp) {
				this.direction = -this.direction;
				this.#stop();
			}
			return;
		}
		this.#misses = 0;
		this.#snapForward = this.#probeSnapForward;
		this.#snapUp = this.#probeSnapUp;
		this.theta = this.#probeTheta;
		this.#previousTheta = this.#probeTheta;
		this.omega = 0;
		this.anchor = next;
		this.grip = -this.grip;
		this.switches++;
		this.lastSwitchTime = this.pendulumTime;
		this.#handholdsLeft--;
		const after = next + this.direction;
		if (after >= 0 && after < this.anchors.count) this.drive.targetYaw = this.#segmentYaw(next, after);
		if (this.#handholdsLeft <= 0 || after < 0 || after >= this.anchors.count) this.#stop();
		else this.#aimFor(after);
	}

	/**
	 * Where the shoulder is relative to the next hold, measured along the way past
	 * it, and what the swing would look like about that hold: θ′ and the shoulder
	 * correction. Called every pendulum step while swinging forward.
	 */
	#probe() {
		const next = this.anchor + this.direction;
		if (next < 0 || next >= this.anchors.count) return;
		const p = this.anchors.points;
		const a = this.anchor * 3;
		const n = next * 3;
		const arm = this.arm;
		const sin = Math.sin(this.theta);
		let ex = p[n] - p[a];
		let ez = p[n + 2] - p[a + 2];
		const span = Math.sqrt(ex * ex + ez * ez) || 1;
		ex /= span;
		ez /= span;
		const sx = p[a] + ex * arm * sin - p[n];
		const sy = p[a + 1] - arm * Math.cos(this.theta) - p[n + 1];
		const sz = p[a + 2] + ez * arm * sin - p[n + 2];
		const after = next + this.direction;
		let fx = ex;
		let fz = ez;
		if (after >= 0 && after < this.anchors.count) {
			const g = after * 3;
			const gx = p[g] - p[n];
			const gz = p[g + 2] - p[n + 2];
			const length = Math.sqrt(gx * gx + gz * gz);
			if (length > 1e-6) {
				fx = gx / length;
				fz = gz / length;
			}
		}
		const along = sx * fx + sz * fz;
		const theta = Math.atan2(along, -sy);
		this.#probeReach = Math.sqrt(along * along + sy * sy);
		this.#probeTheta = theta;
		this.#probeSnapForward = along - arm * Math.sin(theta);
		this.#probeSnapUp = sy + arm * Math.cos(theta);
	}

	#startMove(handholds: number) {
		let next = this.anchor + this.direction;
		if (next < 0 || next >= this.anchors.count) {
			this.direction = -this.direction;
			next = this.anchor + this.direction;
		}
		if (next < 0 || next >= this.anchors.count) {
			this.enter('idle', MURIQUI.idle[0]);
			return;
		}
		this.#handholdsLeft = handholds;
		this.#misses = 0;
		this.enter('move', 1e9);
		this.#faceAlong();
		this.#aimFor(next);
		if (Math.abs(this.omega) < 0.1) this.omega += MURIQUI.startKick;
	}

	#stop() {
		this.enter('idle', this.rng.range(MURIQUI.idle[0], MURIQUI.idle[1]));
		this.#setIdleEnergy();
	}

	/** Energy target whose amplitude reaches handhold `next` from the current one (precomputed per segment). */
	#aimFor(next: number) {
		const segment = Math.min(this.anchor, next);
		this.#maxSwing = this.#amplitudes[segment];
		this.energyTarget = this.#energies[segment];
	}

	/** Yaw from hold `from` to hold `to` (adjacent; precomputed per segment). */
	#segmentYaw(from: number, to: number): number {
		const yaw = this.#yaws[Math.min(from, to)];
		return to > from ? yaw : yaw - Math.PI * Math.sign(yaw || 1);
	}

	#setIdleEnergy() {
		const w0 = TAU / MURIQUI.period;
		const sway = this.reducedMotion ? 0 : MURIQUI.idleSway;
		// With no sway the target stays 0: the pump then only adds damping and the body comes to rest.
		this.energyTarget = sway > 0 ? w0 * w0 * (1 - Math.cos(sway)) + PUMP_OFFSET : 0;
		this.#maxSwing = 0;
	}

	#faceAlong() {
		const next = this.anchor + this.direction;
		const from = this.#point;
		if (next < 0 || next >= this.anchors.count) return;
		this.#read(this.anchor, from);
		const ax = from[0];
		const az = from[2];
		this.#read(next, from);
		const dx = from[0] - ax;
		const dz = from[2] - az;
		if (dx !== 0 || dz !== 0) this.drive.targetYaw = wrapAngle(Math.atan2(dx, dz));
	}

	#placeAtAnchor() {
		const point = this.#point;
		this.#read(this.anchor, point);
		this.motion.x = point[0];
		this.motion.y = point[1];
		this.motion.z = point[2];
	}

	#read(index: number, out: Float64Array) {
		const p = this.anchors.points;
		out[0] = p[index * 3];
		out[1] = p[index * 3 + 1];
		out[2] = p[index * 3 + 2];
	}
}

/** Swing amplitude whose energy is `energy` for the muriqui's pendulum, radians (debug and tests). */
export function amplitudeOf(energy: number): number {
	const w0 = TAU / MURIQUI.period;
	return Math.acos(Math.max(-1, 1 - clamp01(energy / (2 * w0 * w0)) * 2));
}
