/**
 * Iara's life: a small NPC behaviour on top of her avatar animation (the
 * Blocky rig of game/src/animation, driven the same way: rigid nodes, poses as
 * Euler offsets, applyToRig). It does three things:
 * - idle variations every 4–9 s: she looks around, checks the radio at her
 *   side, or points down the trail (seeded, so golden frames repeat);
 * - she turns to face the player inside 8 u (let go at 10 u) and looks at them,
 *   and turns back to her post a few seconds after they leave;
 * - a talk gesture (hand beats and small nods) while her dialogue is open.
 *
 * It adds onto a base pose (the AvatarAnimator's idle, with its breathing and
 * the wave emote), so it never replaces what the avatar animation already does;
 * while the base is busy (an emote), the gestures fade out. With reduced motion
 * the idle variations and the talk beats stop (ART.md §7); turning to face the
 * player stays, because it says she is listening.
 *
 *   const life = new IaraLife({ x, y, z, yaw: actor.rotation.y, trail: { x: 42, z: 70 } });
 *   // per frame: fill life.frame, then
 *   actor.rotation.y = life.yaw; input.yaw = life.yaw;
 *   applyToRig(life.update(animator.update(dt, input)), rig);
 */
import { AVATAR_LAYOUT } from '../animation/joints.ts';
import { compileKey, JOINT_STRIDE, Pose } from '../animation/skeleton.ts';
import { LifeRng } from './rng.ts';

const DEG = Math.PI / 180;
const TAU = Math.PI * 2;

/** Tuning [design]. */
export const IARA = {
	/** Turns to the player inside noticeRadius, lets go beyond releaseRadius, u. */
	noticeRadius: 8,
	releaseRadius: 10,
	/** Seconds before she turns back to her post after the player leaves. */
	homeDelay: 3,
	/** Body turn: a critically damped spring, rad/s (Roblox-like: about 0.5 s for a half turn). */
	turnOmega: 7,
	/** Head look spring and limits. */
	lookOmega: 9,
	lookYaw: 60 * DEG,
	lookPitch: 25 * DEG,
	/** Eye heights, u (the avatar is 3 u tall; ART.md §3). */
	eyes: 2.6,
	/** Seconds between idle variations, and each one's length. */
	idleGap: [4, 9],
	lookAround: 3.4,
	radio: 3.2,
	point: 2.8,
	/** Fades in and out, seconds. */
	fadeIn: 0.35,
	fadeOut: 0.45,
	/** Talk beat period, seconds. */
	talkPeriod: 1.15
} as const;

export type IaraGesture = 'none' | 'look-around' | 'radio' | 'point';

const J = AVATAR_LAYOUT.index;
const TORSO = J.torso * JOINT_STRIDE;
const HEAD = J.head * JOINT_STRIDE;
const ARM_L = J.armL * JOINT_STRIDE;
const ARM_R = J.armR * JOINT_STRIDE;

/**
 * The radio held up at her left shoulder, head turned to it (rig signs in
 * joints.ts: x < 0 swings an arm forward and up, z < 0 brings the left arm in).
 */
const RADIO = compileKey(AVATAR_LAYOUT, {
	torso: { r: [3, 6, 0] },
	head: { r: [10, 16, 4] },
	armL: { r: [-118, 0, -26] }
});

/** The numbers update() reads, refilled by the caller each frame. */
export class IaraFrame {
	dt = 0;
	playerX = 0;
	playerY = 0;
	playerZ = 0;
	/** Her dialogue is open. */
	talking = false;
	/** The base animation is playing something of its own (an emote): gestures fade out. */
	busy = false;
	reducedMotion = false;
}

export interface IaraOptions {
	x: number;
	y: number;
	z: number;
	/** Her post's facing, radians (0 = +z). */
	yaw: number;
	/** Where she points (the trail); default 12 u ahead of her post. */
	trail?: { x: number; z: number };
	seed?: number;
}

export class IaraLife {
	readonly pose = new Pose(AVATAR_LAYOUT.joints.length);
	readonly frame = new IaraFrame();
	readonly x: number;
	readonly y: number;
	readonly z: number;
	readonly homeYaw: number;
	/** Body yaw now: copy it to the actor (rotation.y) and to the avatar input. */
	yaw: number;
	gesture: IaraGesture = 'none';
	/** Seconds into the gesture, its weight 0..1, and the talk weight 0..1. */
	gestureTime = 0;
	gestureWeight = 0;
	talkWeight = 0;
	/** The player is inside the notice radius (with hysteresis). */
	engaged = false;
	/** Idle variations so far (tests, debug). */
	variations = 0;
	#trailX: number;
	#trailZ: number;
	#yawVelocity = 0;
	#lookYaw = 0;
	#lookYawV = 0;
	#lookPitch = 0;
	#lookPitchV = 0;
	#awayFor = 0;
	#nextIdle: number;
	#talkTime = 0;
	readonly #rng: LifeRng;

	constructor(options: IaraOptions) {
		this.x = options.x;
		this.y = options.y;
		this.z = options.z;
		this.homeYaw = this.yaw = options.yaw;
		this.#trailX = options.trail?.x ?? options.x + Math.sin(options.yaw) * 12;
		this.#trailZ = options.trail?.z ?? options.z + Math.cos(options.yaw) * 12;
		this.#rng = new LifeRng(options.seed ?? 0x1a7a);
		this.#nextIdle = this.#rng.range(IARA.idleGap[0], IARA.idleGap[1]);
	}

	/** Where she points from now on (the trail, or the current mission). */
	pointAt(x: number, z: number) {
		this.#trailX = x;
		this.#trailZ = z;
	}

	/** One frame: reads this.frame, writes this.yaw and returns this.pose (base + her layers). Allocates nothing. */
	update(base?: Pose | null): Pose {
		const frame = this.frame;
		const dt = frame.dt > 0 ? Math.min(frame.dt, 0.25) : 0;
		const reduced = frame.reducedMotion;
		const dx = frame.playerX - this.x;
		const dz = frame.playerZ - this.z;
		const rawDistance = Math.sqrt(dx * dx + dz * dz);
		// No usable player (NaN from a bad frame): treat them as far away.
		const known = rawDistance < Number.POSITIVE_INFINITY && Number.isFinite(frame.playerY);
		const distance = known ? rawDistance : Number.POSITIVE_INFINITY;
		if (this.engaged) {
			if (distance > IARA.releaseRadius && !frame.talking) this.engaged = false;
		} else if (distance < IARA.noticeRadius || frame.talking) this.engaged = true;
		this.#awayFor = this.engaged ? 0 : this.#awayFor + dt;

		// --- Facing: the player while engaged, her post a little after they leave.
		const bearing = known && distance > 1e-3 ? Math.atan2(dx, dz) : this.yaw;
		let target = this.yaw;
		if (this.engaged) target = bearing;
		else if (this.#awayFor > IARA.homeDelay) target = this.homeYaw;
		let error = target - this.yaw;
		error -= TAU * Math.round(error / TAU);
		// Exact critically damped step toward the target (offset form, any dt).
		{
			const w = IARA.turnOmega;
			const y0 = -error;
			const slope = this.#yawVelocity + w * y0;
			const decay = Math.exp(-w * dt);
			const y1 = (y0 + slope * dt) * decay;
			this.#yawVelocity = (this.#yawVelocity - w * slope * dt) * decay;
			this.yaw += y1 - y0;
			this.yaw -= TAU * Math.round(this.yaw / TAU);
		}

		// --- Gestures.
		const free = !frame.talking && !frame.busy && !reduced;
		if (this.gesture === 'none') {
			if (free) {
				this.#nextIdle -= dt;
				if (this.#nextIdle <= 0) {
					const roll = this.#rng.next();
					// Facing the player she does not look around: she checks the radio or shows the trail.
					if (this.engaged) this.gesture = roll < 0.35 ? 'radio' : 'point';
					else this.gesture = roll < 0.4 ? 'look-around' : roll < 0.7 ? 'radio' : 'point';
					this.gestureTime = 0;
					this.variations++;
				}
			}
		} else {
			this.gestureTime += dt;
			const length =
				this.gesture === 'look-around' ? IARA.lookAround : this.gesture === 'radio' ? IARA.radio : IARA.point;
			if (this.gestureTime >= length || (!free && this.gestureWeight <= 0)) {
				this.gesture = 'none';
				this.gestureTime = 0;
				this.#nextIdle = this.#rng.range(IARA.idleGap[0], IARA.idleGap[1]);
			}
		}
		const length =
			this.gesture === 'look-around' ? IARA.lookAround : this.gesture === 'radio' ? IARA.radio : IARA.point;
		let weight = 0;
		if (this.gesture !== 'none') {
			const t = this.gestureTime;
			weight = t < IARA.fadeIn ? t / IARA.fadeIn : 1;
			const left = length - t;
			if (left < IARA.fadeOut) weight = Math.min(weight, left / IARA.fadeOut);
		}
		// Interrupted (talk, emote, reduced motion): fade out from where it is.
		if (!free) weight = Math.min(weight, this.gestureWeight - dt / IARA.fadeOut);
		this.gestureWeight = Math.max(weight, 0);
		const talkTarget = frame.talking && !frame.busy && !reduced ? 1 : 0;
		const talkStep = dt / (talkTarget > this.talkWeight ? IARA.fadeIn : IARA.fadeOut);
		this.talkWeight =
			talkTarget > this.talkWeight
				? Math.min(talkTarget, this.talkWeight + talkStep)
				: Math.max(talkTarget, this.talkWeight - talkStep);
		this.#talkTime = this.talkWeight > 0 ? this.#talkTime + dt : 0;

		// --- Head look at the player (not while she looks at the radio or around).
		let lookYaw = 0;
		let lookPitch = 0;
		if (this.engaged && known) {
			let rel = bearing - this.yaw;
			rel -= TAU * Math.round(rel / TAU);
			lookYaw = rel > IARA.lookYaw ? IARA.lookYaw : Math.max(rel, -IARA.lookYaw);
			const rise = Math.atan2(frame.playerY + IARA.eyes - (this.y + IARA.eyes), Math.max(distance, 0.5));
			lookPitch = rise > IARA.lookPitch ? IARA.lookPitch : Math.max(rise, -IARA.lookPitch);
			const share = this.gesture === 'point' ? 0 : 1 - this.gestureWeight;
			lookYaw *= share;
			lookPitch *= share;
		}
		if (reduced) {
			lookYaw *= 0.5;
			lookPitch *= 0.5;
		}
		{
			const w = IARA.lookOmega;
			const decay = Math.exp(-w * dt);
			let y0 = this.#lookYaw - lookYaw;
			let slope = this.#lookYawV + w * y0;
			this.#lookYaw = lookYaw + (y0 + slope * dt) * decay;
			this.#lookYawV = (this.#lookYawV - w * slope * dt) * decay;
			y0 = this.#lookPitch - lookPitch;
			slope = this.#lookPitchV + w * y0;
			this.#lookPitch = lookPitch + (y0 + slope * dt) * decay;
			this.#lookPitchV = (this.#lookPitchV - w * slope * dt) * decay;
		}

		// --- Compose: base, then her layers as offsets.
		const out = this.pose;
		if (base) out.copy(base);
		else out.reset();
		const d = out.data;
		d[HEAD + 1] += this.#lookYaw;
		// Pitch up is x < 0 on the head (x > 0 pitches forward).
		d[HEAD] -= this.#lookPitch;
		const w = this.gestureWeight;
		if (w > 0) {
			if (this.gesture === 'radio') {
				for (let i = 0; i < RADIO.length; i++) d[i] += RADIO[i] * w;
			} else if (this.gesture === 'look-around') {
				const u = this.gestureTime / IARA.lookAround;
				const sweep = Math.sin(u * TAU);
				d[HEAD + 1] += 38 * DEG * sweep * w;
				d[HEAD] += -4 * DEG * w;
				d[TORSO + 1] += 8 * DEG * sweep * w;
			} else {
				// Point down the trail: the torso and head turn toward it and the right arm rises forward.
				let rel = Math.atan2(this.#trailX - this.x, this.#trailZ - this.z) - this.yaw;
				rel -= TAU * Math.round(rel / TAU);
				const turn = rel > 70 * DEG ? 70 * DEG : Math.max(rel, -70 * DEG);
				d[TORSO + 1] += turn * 0.3 * w;
				d[HEAD + 1] += turn * 0.5 * w;
				d[ARM_R] += -86 * DEG * w;
				d[ARM_R + 1] += turn * 0.6 * w;
				d[ARM_R + 2] += -6 * DEG * w;
			}
		}
		const talk = this.talkWeight;
		if (talk > 0) {
			const beat = Math.sin((this.#talkTime / IARA.talkPeriod) * TAU);
			const nod = Math.sin((this.#talkTime / (IARA.talkPeriod * 0.5)) * TAU);
			d[ARM_R] += (-30 - 14 * beat) * DEG * talk;
			d[ARM_R + 2] += (-10 - 4 * beat) * DEG * talk;
			d[ARM_L] += (-16 + 9 * beat) * DEG * talk;
			d[ARM_L + 2] += (8 + 3 * beat) * DEG * talk;
			d[HEAD] += 3 * DEG * nod * talk;
			d[TORSO] += 1.5 * DEG * talk;
		}
		// The root joint stays: she turns as a whole through `yaw`.
		return out;
	}
}
