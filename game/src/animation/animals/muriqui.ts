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
 */
import { SPRING } from '../../style/motion.ts';
import { Behaviour, type BehaviourOptions } from './behaviour.ts';
import { DampedSpring } from './damped-spring.ts';
import type { AnimalWorld } from './motion.ts';
import { MODELS } from './rigs.ts';
import type { Route } from './route.ts';
import { clamp01, DEG, smoothstep, TAU, wrapAngle } from './scalar.ts';

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
	hangFade: 0.6
} as const;

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
	/** Arm length in world units (the stretched Cube Pets front leg). */
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

	constructor(options: MuriquiOptions) {
		super('muriqui', 'idle', options);
		this.anchors = options.anchors;
		this.anchor = Math.min(Math.max(options.start ?? 0, 0), this.anchors.count - 1);
		this.arm = MODELS.monkey.legLength * this.species.limbScale.front * this.species.scale;
		this.tilt = new DampedSpring(SPRING.body, this.species.tempo);
		this.#faceAlong();
		this.motion.yaw = this.targetYaw;
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
		const h = this.h;
		this.#accumulator += h;
		while (this.#accumulator >= PENDULUM_STEP) {
			this.#accumulator -= PENDULUM_STEP;
			this.#previousTheta = this.theta;
			this.#pendulumStep();
		}
		const decay = Math.exp(-TAU * SPRING.body.hz * this.species.tempo * h);
		this.#snapForward *= decay;
		this.#snapUp *= decay;
		this.tilt.step(this.theta * MURIQUI.tiltFollow, h);
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
			if (this.omega > 0)
				motion.reach = smoothstep((this.theta + 0.2 * this.#maxSwing) / (0.9 * this.#maxSwing));
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
		if (this.state === 'move' && omega > 0 && next <= 0 && this.theta > 0.05) this.#atApex();
	}

	/** Forward apex: switch hands if the next hold is in reach, else swing higher. */
	#atApex() {
		const next = this.anchor + this.direction;
		if (next < 0 || next >= this.anchors.count) {
			this.#stop();
			return;
		}
		const point = this.#point;
		this.#read(this.anchor, point);
		const ax = point[0];
		const ay = point[1];
		const az = point[2];
		this.#read(next, point);
		const nx = point[0];
		const ny = point[1];
		const nz = point[2];
		let ex = nx - ax;
		let ez = nz - az;
		const span = Math.sqrt(ex * ex + ez * ez) || 1;
		ex /= span;
		ez /= span;
		const arm = this.arm;
		// Shoulder position, relative to the next hold.
		const sx = ax + ex * arm * Math.sin(this.theta) - nx;
		const sy = ay - arm * Math.cos(this.theta) - ny;
		const sz = az + ez * arm * Math.sin(this.theta) - nz;
		// Measured along the direction past the next hold (the same one at a straight run).
		const after = next + this.direction;
		let fx = ex;
		let fz = ez;
		if (after >= 0 && after < this.anchors.count) {
			this.#read(after, point);
			const gx = point[0] - nx;
			const gz = point[2] - nz;
			const g = Math.sqrt(gx * gx + gz * gz);
			if (g > 1e-6) {
				fx = gx / g;
				fz = gz / g;
			}
		}
		const along = sx * fx + sz * fz;
		const reach = Math.sqrt(along * along + sy * sy);
		if (reach > arm * MURIQUI.reachSlack) {
			this.energyTarget *= 1.15;
			return;
		}
		const theta = Math.atan2(along, -sy);
		this.#snapForward = along - arm * Math.sin(theta);
		this.#snapUp = sy + arm * Math.cos(theta);
		this.theta = this.#previousTheta = theta;
		this.omega = 0;
		this.anchor = next;
		this.grip = -this.grip;
		this.switches++;
		this.lastSwitchTime = this.pendulumTime;
		this.targetYaw = Math.atan2(fx, fz);
		this.#handholdsLeft--;
		if (this.#handholdsLeft <= 0 || after < 0 || after >= this.anchors.count) this.#stop();
		else this.#aimFor(after);
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
		this.enter('move', 1e9);
		this.#faceAlong();
		this.#aimFor(next);
		if (Math.abs(this.omega) < 0.1) this.omega += MURIQUI.startKick;
	}

	#stop() {
		this.enter('idle', this.rng.range(MURIQUI.idle[0], MURIQUI.idle[1]));
		this.#setIdleEnergy();
	}

	/** Energy target whose amplitude reaches handhold `next` from the current one. */
	#aimFor(next: number) {
		const point = this.#point;
		this.#read(this.anchor, point);
		const ax = point[0];
		const az = point[2];
		this.#read(next, point);
		const span = Math.hypot(point[0] - ax, point[2] - az);
		const sine = Math.min(0.97, span / (2 * this.arm));
		const amplitude = Math.min(80 * DEG, Math.asin(sine) + MURIQUI.margin);
		this.#maxSwing = amplitude;
		const w0 = TAU / MURIQUI.period;
		this.energyTarget = w0 * w0 * (1 - Math.cos(amplitude));
	}

	#setIdleEnergy() {
		const w0 = TAU / MURIQUI.period;
		const sway = this.reducedMotion ? 0 : MURIQUI.idleSway;
		this.energyTarget = w0 * w0 * (1 - Math.cos(sway));
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
		if (dx !== 0 || dz !== 0) this.targetYaw = wrapAngle(Math.atan2(dx, dz));
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
