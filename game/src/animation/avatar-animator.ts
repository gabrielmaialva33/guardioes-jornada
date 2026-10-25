/**
 * The avatar's whole animation for one update: the Animate state machine, the
 * key-pose cycles and the procedural layers, written into one reused Pose that
 * applyToRig (rig.ts) copies onto the model. No allocation per update.
 *
 * Order: states → cycle phases → weighted blend of every slot with weight →
 * procedural layers on top:
 * - lean into acceleration and bank into turns, while grounded;
 * - squash and stretch on take-off and landing, one critically damped spring
 *   that also dips the torso on landing (there is no landing clip);
 * - head look-at with yaw and pitch limits;
 * - idle breathing.
 * With reduced motion the lean, bank, squash and breathing are off and the
 * look-at turns half as far.
 *
 * Walk, run, climb and swim advance by the distance actually covered after
 * collision, never by stick input, so the avatar does not walk in place
 * against a wall (the POC's phase came from the stick).
 */
import { AVATAR_HEIGHT, JUMP_SPEED, STUD, WALK_SPEED } from '../engine/constants.ts';
import { clamp, damp, wrapAngle } from '../engine/math.ts';
import { ANIMATE } from './animate-timings.ts';
import {
	CLIMB,
	CLIMB_STRIDE,
	EMOTES,
	type EmoteId,
	FALL,
	IDLE_VARIANTS,
	JUMP,
	RUN,
	RUN_STRIDE,
	SIT,
	SWIM,
	SWIM_IDLE,
	SWIM_STRIDE,
	WALK,
	WALK_STRIDE
} from './avatar-poses.ts';
import {
	AvatarStateMachine,
	MAX_DT,
	type MotionInput,
	SLOT_INDEX,
	type StateMachineOptions
} from './avatar-states.ts';
import { AVATAR_LAYOUT } from './joints.ts';
import { JOINT_STRIDE, Pose } from './skeleton.ts';
import { Spring } from './spring.ts';
import { Playhead } from './track.ts';

const DEG = Math.PI / 180;
const TAU = Math.PI * 2;

/** Tuning of the procedural layers [engine], after the POC's Player.svelte and animacoes.md §2.3, §3.3. */
export const LAYERS = {
	/** Forward lean at full walk speed, radians (the run keys already lean 10°). */
	speedLean: 3 * DEG,
	/** Extra lean per WALK_SPEED of speed gap between the speed and its lagging copy. */
	accelLean: 10 * DEG,
	maxLean: 14 * DEG,
	/** Rate (1/s) at which the lagging speed follows; the gap is the acceleration lean. */
	accelRate: 6,
	leanOmega: 14,
	/** Roll into turns per (rad/s of yaw × u/s), capped. */
	bankGain: 0.004,
	maxBank: 8 * DEG,
	bankOmega: 12,
	/** Peak stretch on take-off and peak squash on a full-height landing (≤ 15%, animacoes.md §2.3). */
	jumpStretch: 0.1,
	landSquash: 0.14,
	squashOmega: 16,
	/** Torso dip and arm flare per unit of squash. */
	landDip: 0.8,
	landFlare: 0.6,
	/** Breathing period (s), torso pitch, arm roll and torso lift (fraction of the height). */
	breathPeriod: 3.4,
	breathPitch: 1.5 * DEG,
	breathArms: 1.2 * DEG,
	breathLift: 0.004,
	/** Head turn limits (animacoes.md §3.3) and smoothing; targets this far beyond the yaw limit are ignored. */
	lookYaw: 60 * DEG,
	lookPitch: 30 * DEG,
	lookBehind: 30 * DEG,
	lookOmega: 10,
	/** Share of the look yaw taken by the torso. */
	lookTorso: 0.2,
	/** Eye height as a fraction of the avatar height. */
	eyeHeight: 0.85
} as const;

export interface Vec3Like {
	x: number;
	y: number;
	z: number;
}

/** Everything the animator reads each update. Create once with createAvatarInput() and refill it. */
export interface AvatarInput extends MotionInput {
	/** Body yaw in radians, 0 facing +z (Character.yaw). */
	yaw: number;
	/** Feet position in world units; only the look-at uses it. */
	x: number;
	y: number;
	z: number;
	/** World point to look at, or null. */
	lookTarget: Vec3Like | null;
	/** prefers-reduced-motion or the in-game toggle. */
	reducedMotion: boolean;
}

export function createAvatarInput(): AvatarInput {
	return {
		speed: 0,
		intent: 0,
		grounded: true,
		verticalSpeed: 0,
		airTime: 0,
		jumped: false,
		climbing: false,
		swimming: false,
		sitting: false,
		yaw: 0,
		x: 0,
		y: 0,
		z: 0,
		lookTarget: null,
		reducedMotion: false
	};
}

/** What readCharacter needs from the engine's Character, structurally. */
export interface CharacterLike {
	readonly position: Readonly<Vec3Like>;
	readonly velocity: Readonly<Vec3Like>;
	readonly planarSpeed: number;
	readonly grounded: boolean;
	readonly yaw: number;
	readonly events: { readonly jumped: boolean };
}

/**
 * Fills the motion fields from the engine's Character after the frame's ticks;
 * `dt` is the frame time, for airTime. Intent, climbing, swimming, sitting,
 * lookTarget and reducedMotion stay with the caller.
 */
export function readCharacter(input: AvatarInput, character: CharacterLike, dt: number): AvatarInput {
	input.speed = character.planarSpeed;
	input.grounded = character.grounded;
	input.verticalSpeed = character.velocity.y;
	input.airTime = character.grounded ? 0 : input.airTime + Math.max(0, finite(dt));
	input.jumped = character.events.jumped;
	input.yaw = character.yaw;
	input.x = character.position.x;
	input.y = character.position.y;
	input.z = character.position.z;
	return input;
}

export interface AvatarAnimatorOptions extends StateMachineOptions {
	/** Avatar height in world units; the look-at aims from eye height. */
	height?: number;
	/** Seeds the idle variant rolls, for deterministic tests and replays. */
	seed?: number;
}

export type Foot = 'left' | 'right';

const IDLE = SLOT_INDEX.idle;
const WALKING = SLOT_INDEX.walk;
const JUMPING = SLOT_INDEX.jump;
const FALLING = SLOT_INDEX.fall;
const CLIMBING = SLOT_INDEX.climb;
const SWIMMING = SLOT_INDEX.swim;
const SITTING = SLOT_INDEX.sit;
const EMOTING = SLOT_INDEX.emote;

const ROOT = AVATAR_LAYOUT.index.root * JOINT_STRIDE;
const TORSO = AVATAR_LAYOUT.index.torso * JOINT_STRIDE;
const HEAD = AVATAR_LAYOUT.index.head * JOINT_STRIDE;
const ARM_L = AVATAR_LAYOUT.index.armL * JOINT_STRIDE;
const ARM_R = AVATAR_LAYOUT.index.armR * JOINT_STRIDE;

const finite = (value: number) => (Number.isFinite(value) ? value : 0);
const wrap01 = (value: number) => value - Math.floor(value);
const IDLE_WEIGHT_TOTAL = ANIMATE.idleWeights.reduce((sum, weight) => sum + weight, 0);

export class AvatarAnimator {
	readonly states: AvatarStateMachine;
	/** The final pose of the last update. */
	readonly pose = new Pose(AVATAR_LAYOUT.joints.length);
	/** Walk/run cycle phase in [0, 1): 0 is the left foot planted ahead, 0.5 the right. */
	phase = 0;
	/** Walk/run cycles per second in the last update. */
	cadence = 0;
	/** Walk/run speed relative to the clips' native speed, Animate's timewarp (1.25 at 16 studs/s). */
	playbackRate = 0;
	/** Foot that touched down during the last update, for step dust and sounds. */
	footstep: Foot | null = null;
	climbPhase = 0;
	swimPhase = 0;
	/** Torso pitch the breathing layer added in the last update, radians. */
	breathing = 0;
	readonly lean = new Spring(LAYERS.leanOmega);
	readonly bank = new Spring(LAYERS.bankOmega);
	/** Squash (< 0) or stretch (> 0) of the root's height. */
	readonly squash = new Spring(LAYERS.squashOmega);
	readonly lookYaw = new Spring(LAYERS.lookOmega);
	readonly lookPitch = new Spring(LAYERS.lookOmega);
	readonly #stud: number;
	readonly #eyeHeight: number;
	readonly #seed: number;
	readonly #head = new Playhead();
	/** This update's clamped dt and speed, read by the private steps (see update). */
	#dt = 0;
	#speed = 0;
	#random = 0;
	#idleVariant = 0;
	#idleTime = 0;
	#previousIdle = 0;
	#previousIdleTime = 0;
	#idleFadeLeft = 0;
	#fallTime = 0;
	#treadTime = 0;
	#breath = 0;
	#laggingSpeed = 0;
	#lastYaw = 0;
	#hasYaw = false;

	constructor(options: AvatarAnimatorOptions = {}) {
		this.states = new AvatarStateMachine(options);
		this.#stud = options.stud ?? STUD;
		this.#eyeHeight = (options.height ?? AVATAR_HEIGHT) * LAYERS.eyeHeight;
		this.#seed = options.seed ?? 0x5eed;
		this.reset();
	}

	get state() {
		return this.states.state;
	}

	/** See AvatarStateMachine.playEmote: only while standing still. */
	playEmote(id: EmoteId): boolean {
		return this.states.playEmote(id);
	}

	stopEmote() {
		this.states.stopEmote();
	}

	/** Back to idle at rest, springs settled (spawn, respawn, teleport). */
	reset() {
		this.states.reset();
		this.pose.reset();
		this.phase = this.cadence = this.playbackRate = this.climbPhase = this.swimPhase = this.breathing = 0;
		this.footstep = null;
		this.lean.reset();
		this.bank.reset();
		this.squash.reset();
		this.lookYaw.reset();
		this.lookPitch.reset();
		this.#random = this.#seed;
		this.#idleVariant = this.#previousIdle = 0;
		this.#idleTime = this.#previousIdleTime = this.#idleFadeLeft = 0;
		this.#fallTime = this.#treadTime = this.#breath = this.#laggingSpeed = 0;
		this.#hasYaw = false;
	}

	/** Advances by `dt` seconds (the frame time) and returns the reused pose. */
	update(rawDt: number, input: AvatarInput): Pose {
		// rawDt goes on as received: a fractional number computed here and passed to a
		// function V8 does not inline would be boxed (see Playhead); fields are not.
		const states = this.states;
		states.update(rawDt, input);
		const dt = rawDt > 0 ? Math.min(rawDt, MAX_DT) : 0;
		const weights = states.weights;
		const speed = Math.max(0, finite(input.speed));
		const verticalSpeed = finite(input.verticalSpeed);
		const onFoot = input.grounded && !input.climbing && !input.swimming && !input.sitting;
		const stud = this.#stud;
		this.#dt = dt;
		this.#speed = speed;

		// Distance-driven cycles.
		this.footstep = null;
		const stride = (WALK_STRIDE + (RUN_STRIDE - WALK_STRIDE) * states.runWeight) * stud;
		this.cadence = onFoot ? speed / stride : 0;
		this.playbackRate = this.cadence * (states.walkWeight * WALK.period + states.runWeight * RUN.period);
		if (onFoot) {
			const next = this.phase + this.cadence * dt;
			if (states.state === 'walk') {
				if (next >= 1) this.footstep = 'left';
				else if (this.phase < 0.5 && next >= 0.5) this.footstep = 'right';
			}
			this.phase = wrap01(next);
		}
		if (input.climbing)
			this.climbPhase = wrap01(this.climbPhase + (verticalSpeed * dt) / (CLIMB_STRIDE * stud));
		if (input.swimming)
			this.swimPhase = wrap01(
				this.swimPhase + (Math.hypot(speed, verticalSpeed) * dt) / (SWIM_STRIDE * stud)
			);

		// Blend every slot that has weight.
		const pose = this.pose.reset();
		const out = pose.data;
		const head = this.#head;
		if (weights[IDLE] > 0) this.#sampleIdle(out);
		head.time = this.phase;
		head.weight = weights[WALKING] * states.walkWeight;
		WALK.sampleInto(out, head);
		head.weight = weights[WALKING] * states.runWeight;
		RUN.sampleInto(out, head);
		head.time = 0;
		head.weight = weights[JUMPING];
		JUMP.sampleInto(out, head);
		head.weight = weights[SITTING];
		SIT.sampleInto(out, head);
		if (weights[FALLING] > 0) {
			this.#fallTime = (this.#fallTime + dt) % FALL.period;
			head.time = this.#fallTime / FALL.period;
			head.weight = weights[FALLING];
			FALL.sampleInto(out, head);
		}
		head.time = this.climbPhase;
		head.weight = weights[CLIMBING];
		CLIMB.sampleInto(out, head);
		if (weights[SWIMMING] > 0) {
			this.#treadTime = (this.#treadTime + dt) % SWIM_IDLE.period;
			head.time = this.swimPhase;
			head.weight = weights[SWIMMING] * states.swimMoveWeight;
			SWIM.sampleInto(out, head);
			head.time = this.#treadTime / SWIM_IDLE.period;
			head.weight = weights[SWIMMING] * (1 - states.swimMoveWeight);
			SWIM_IDLE.sampleInto(out, head);
		}
		if (states.emote !== null) {
			head.time = states.emoteTime;
			head.weight = weights[EMOTING];
			EMOTES[states.emote].sampleInto(out, head);
		}

		this.#applyLayers(input, onFoot);
		return pose;
	}

	#applyLayers(input: AvatarInput, onFoot: boolean) {
		const pose = this.pose;
		const out = pose.data;
		const states = this.states;
		const weights = states.weights;
		const dt = this.#dt;
		const speed = this.#speed;
		const reduced = input.reducedMotion;
		const yaw = finite(input.yaw);

		// Lean and bank. Roblox accelerates instantly, so the lean comes from the gap
		// between the speed and a lagging copy of it, then a spring smooths it.
		this.#laggingSpeed += (speed - this.#laggingSpeed) * damp(LAYERS.accelRate, dt);
		let leanTarget = 0;
		let bankTarget = 0;
		if (!reduced && onFoot) {
			const gap = clamp((speed - this.#laggingSpeed) / WALK_SPEED, -1, 1);
			leanTarget = clamp(
				LAYERS.speedLean * Math.min(1, speed / WALK_SPEED) + LAYERS.accelLean * gap,
				-LAYERS.maxLean,
				LAYERS.maxLean
			);
			const yawRate = dt > 0 && this.#hasYaw ? wrapAngle(yaw - this.#lastYaw) / dt : 0;
			bankTarget = clamp(-yawRate * speed * LAYERS.bankGain, -LAYERS.maxBank, LAYERS.maxBank);
		}
		this.#lastYaw = yaw;
		this.#hasYaw = true;
		out[TORSO] += this.lean.step(leanTarget, dt);
		out[ROOT + 2] += this.bank.step(bankTarget, dt);

		// Squash and stretch: the spring sits at 0, take-off and landing kick it.
		if (!reduced) {
			if (states.landed) this.squash.kick(-LAYERS.landSquash * clamp(states.landingSpeed / JUMP_SPEED, 0, 1));
			if (states.jumped) this.squash.kick(LAYERS.jumpStretch);
		}
		const squash = clamp(this.squash.step(0, dt), -0.3, 0.3);
		pose.scaleY = 1 + squash;
		pose.scaleXZ = 1 / Math.sqrt(1 + squash);
		if (squash < 0) {
			out[TORSO] -= squash * LAYERS.landDip;
			out[ARM_L + 2] -= squash * LAYERS.landFlare;
			out[ARM_R + 2] += squash * LAYERS.landFlare;
		}

		// Breathing, while idle or seated.
		this.#breath = (this.#breath + dt / LAYERS.breathPeriod) % 1;
		const breathe = reduced ? 0 : (weights[IDLE] + weights[SITTING]) * Math.sin(this.#breath * TAU);
		this.breathing = -breathe * LAYERS.breathPitch;
		out[TORSO] += this.breathing;
		out[TORSO + 4] += breathe * LAYERS.breathLift;
		out[ARM_L + 2] += breathe * LAYERS.breathArms;
		out[ARM_R + 2] -= breathe * LAYERS.breathArms;

		// Look-at, relative to the body; a target behind the shoulder is let go.
		let yawGoal = 0;
		let pitchGoal = 0;
		const target = input.lookTarget;
		if (target !== null) {
			const dx = target.x - input.x;
			const dy = target.y - (input.y + this.#eyeHeight);
			const dz = target.z - input.z;
			const toTarget = wrapAngle(Math.atan2(dx, dz) - yaw);
			const yawLimit = reduced ? LAYERS.lookYaw / 2 : LAYERS.lookYaw;
			const pitchLimit = reduced ? LAYERS.lookPitch / 2 : LAYERS.lookPitch;
			if (Number.isFinite(toTarget) && Math.abs(toTarget) <= LAYERS.lookYaw + LAYERS.lookBehind) {
				yawGoal = clamp(toTarget, -yawLimit, yawLimit);
				pitchGoal = clamp(finite(Math.atan2(dy, Math.hypot(dx, dz))), -pitchLimit, pitchLimit);
			}
		}
		const attention = weights[IDLE] + weights[WALKING] + weights[SITTING] + weights[EMOTING];
		const lookYaw = this.lookYaw.step(yawGoal, dt) * attention;
		const lookPitch = this.lookPitch.step(pitchGoal, dt) * attention;
		out[TORSO + 1] += lookYaw * LAYERS.lookTorso;
		out[HEAD + 1] += lookYaw * (1 - LAYERS.lookTorso);
		out[HEAD] -= lookPitch;
	}

	/** Idle loops one variant and re-rolls at each loop end, crossfading over ANIMATE.loopFade. */
	#sampleIdle(out: Float64Array) {
		const dt = this.#dt;
		const weight = this.states.weights[IDLE];
		const head = this.#head;
		let period = IDLE_VARIANTS[this.#idleVariant].period;
		this.#idleTime += dt;
		this.#previousIdleTime += dt;
		if (this.#idleFadeLeft > 0) this.#idleFadeLeft -= dt;
		if (this.#idleTime >= period) {
			this.#idleTime %= period;
			const next = this.#rollIdle();
			if (next !== this.#idleVariant) {
				this.#previousIdle = this.#idleVariant;
				this.#previousIdleTime = this.#idleTime;
				this.#idleFadeLeft = ANIMATE.loopFade - this.#idleTime;
				this.#idleVariant = next;
				period = IDLE_VARIANTS[next].period;
			}
		}
		const fresh = this.#idleFadeLeft > 0 ? 1 - this.#idleFadeLeft / ANIMATE.loopFade : 1;
		head.time = this.#idleTime / period;
		head.weight = weight * fresh;
		IDLE_VARIANTS[this.#idleVariant].sampleInto(out, head);
		if (fresh < 1) {
			const previous = IDLE_VARIANTS[this.#previousIdle];
			head.time = this.#previousIdleTime / previous.period;
			head.weight = weight * (1 - fresh);
			previous.sampleInto(out, head);
		}
	}

	#rollIdle(): number {
		let pick = this.#nextRandom() * IDLE_WEIGHT_TOTAL;
		for (let i = 0; i < ANIMATE.idleWeights.length; i++) {
			pick -= ANIMATE.idleWeights[i];
			if (pick < 0) return i;
		}
		return 0;
	}

	/** mulberry32: a small seeded generator, so idle fidgets replay identically. */
	#nextRandom(): number {
		this.#random = (this.#random + 0x6d2b79f5) | 0;
		let t = this.#random;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	}
}
