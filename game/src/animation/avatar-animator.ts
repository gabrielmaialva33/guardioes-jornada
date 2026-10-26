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
 * - idle breathing;
 * - contextual locomotion (P10): narrow footing, wading, slopes and teetering
 *   at an edge, from the optional MotionInput fields;
 * - the scene-dependent part of the gestures: the bow and the right hand
 *   aimed at the picked item or the petted animal;
 * - the hair accessory's swing (hair-sway.ts), from the head's acceleration.
 * With reduced motion the lean, bank, squash, breathing, wobble, teeter swing
 * and hair swing are off, the look-at turns half as far and the contextual
 * postures (arms out, high knees, slope lean, teeter stance) are halved.
 *
 * Walk, run, climb and swim advance by the distance actually covered after
 * collision, never by stick input, so the avatar does not walk in place
 * against a wall (the POC's phase came from the stick).
 */
import { AVATAR_HEIGHT, JUMP_SPEED, STUD, WALK_SPEED } from '../engine/constants.ts';
import { ANIMATE } from './animate-timings.ts';
import {
	CLIMB,
	CLIMB_STRIDE,
	EMOTES,
	type EmoteId,
	FALL,
	IDLE_VARIANTS,
	JUMP,
	REACH,
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
import { HairSway } from './hair-sway.ts';
import { AVATAR_LAYOUT, BLOCKY_RIG } from './joints.ts';
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

/** Tuning of the contextual locomotion layer (P10) [engine]. */
export const CONTEXT = {
	/** Rate (1/s) at which the narrow, water and teeter weights follow their context. */
	rate: 6,
	/** Narrow footing: stride × narrowStride, leg swing cut by narrowLegs, arm swing by narrowSwing. */
	narrowStride: 0.7,
	narrowLegs: 0.4,
	narrowSwing: 0.7,
	/** Arms raised sideways for balance. */
	narrowArms: 60 * DEG,
	/** A slow wobble: root roll, the torso's counter-roll and the arms' balancing. */
	wobbleHz: 0.8,
	wobbleRoll: 3 * DEG,
	wobbleArms: 6 * DEG,
	/** Wading: stride × waterStride (a slower cycle), forward leg swing × (1 + waterKnees). */
	waterStride: 1.3,
	waterKnees: 0.4,
	waterArms: 18 * DEG,
	waterArmsUp: 15 * DEG,
	/** Wading keeps the trunk this upright at most: the high knees come from the legs alone. */
	waterMaxLean: 10 * DEG,
	/** Torso pitch per radian of slope: into an uphill, back against a downhill (bracing). */
	slopeLean: 0.5,
	slopeBrace: 0.4,
	slopeMax: 14 * DEG,
	/** Downhill bracing also bends the arms forward and out, per radian of slope. */
	braceArms: 0.6,
	slopeOmega: 8,
	/** Teeter when a drop is this close ahead; running past it teeters less. */
	teeterEdge: 0.4,
	teeterHz: 1.6,
	/** Arms windmill around the forward-horizontal pose, out to the sides. */
	teeterSwing: 70 * DEG,
	teeterArmsOut: 25 * DEG,
	/** Torso leans back from the drop and rocks. */
	teeterBack: 6 * DEG,
	teeterRock: 6 * DEG
} as const;

/** Tuning of the gesture layer (P10). */
export const GESTURE = {
	/** Arm from the shoulder pivot to the palm, rig units (BLOCKY_RIG: the arm block ends 1 below the pivot). */
	armReach: 0.9,
	/** Shoulder pivot in the torso's frame and the torso's pivot above the feet, rig units (joints.ts). */
	shoulder: [-0.4, 1.1, -0.1],
	waist: 0.7,
	/** Bow limits, radians; a pickup bows at most pickupBow and leans sideways at most pickupLean. */
	minBow: 0.2,
	maxBow: 1.15,
	pickupBow: 40 * DEG,
	pickupLean: 18 * DEG,
	/** Shoulder height above the arm's reach (rig units) at which the pickup lean is full. */
	leanRange: 0.15,
	/** How far (rig units) a pickup steps the body toward an item beyond the arm. */
	pickupStep: 0.45,
	/** Where the hand goes without a target: ahead of the feet (u) and up from them (u). */
	pickupAhead: 0.85,
	pickupUp: 0.25,
	petAhead: 1,
	petUp: 0.4,
	/** The pet's strokes: per second and amplitude of the arm's swing. */
	strokeHz: 1.4,
	stroke: 0.22
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
	/** A dialogue is open: the looping `talk` gesture plays whenever the avatar stands still. */
	talking: boolean;
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
		reducedMotion: false,
		talking: false,
		surface: 'ground',
		slope: 0,
		edgeAhead: Number.POSITIVE_INFINITY
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
	input.airTime = character.grounded ? 0 : input.airTime + Math.max(0, Number.isFinite(dt) ? dt : 0);
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
const LEG_L = AVATAR_LAYOUT.index.legL * JOINT_STRIDE;
const LEG_R = AVATAR_LAYOUT.index.legR * JOINT_STRIDE;
/** Rig units per height: the native Kenney rig (2.7), whose pivots GESTURE and the head point use. */
const RIG_HEIGHT = BLOCKY_RIG.height ?? 2.7;
/** A head that moves farther than this in one update was teleported: the hair forgets its speed. */
const TELEPORT = 3;

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
	/** Weights in [0, 1] of the contextual layers in the last update. */
	narrow = 0;
	water = 0;
	teeter = 0;
	/** Torso pitch of the slope layer, radians (into an uphill > 0). */
	readonly slopeLean = new Spring(CONTEXT.slopeOmega);
	/** The hair accessory's swing; pick the style with `hairStyle`. */
	readonly hair = new HairSway();
	readonly lean = new Spring(LAYERS.leanOmega);
	readonly bank = new Spring(LAYERS.bankOmega);
	/** Squash (< 0) or stretch (> 0) of the root's height. */
	readonly squash = new Spring(LAYERS.squashOmega);
	readonly lookYaw = new Spring(LAYERS.lookOmega);
	readonly lookPitch = new Spring(LAYERS.lookOmega);
	readonly #stud: number;
	readonly #height: number;
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
	#wobble = 0;
	#teeterTime = 0;
	#hasReach = false;
	#reachX = 0;
	#reachY = 0;
	#reachZ = 0;
	#headX = 0;
	#headY = 0;
	#headZ = 0;
	#headVX = 0;
	#headVY = 0;
	#headVZ = 0;
	#headAX = 0;
	#headAY = 0;
	#headAZ = 0;
	/** 0: no head sample yet, 1: a position, 2: a velocity too. */
	#headSamples = 0;
	#hairStyle: string | null = null;

	constructor(options: AvatarAnimatorOptions = {}) {
		this.states = new AvatarStateMachine(options);
		this.#stud = options.stud ?? STUD;
		this.#height = options.height ?? AVATAR_HEIGHT;
		this.#eyeHeight = this.#height * LAYERS.eyeHeight;
		this.#seed = options.seed ?? 0x5eed;
		this.reset();
	}

	get state() {
		return this.states.state;
	}

	/** See AvatarStateMachine.playEmote: only while standing still. */
	playEmote(id: EmoteId): boolean {
		return this.playGesture(id);
	}

	/**
	 * An emote or a story gesture, through the same path (only while standing
	 * still). `target` is the world point the right hand reaches for in
	 * `pickup` and `pet` (the item, the animal); without it the hand goes to a
	 * spot just ahead of the feet. Mission complete is `cheer`; dialogues use
	 * AvatarInput.talking instead of `talk`.
	 */
	playGesture(id: EmoteId, target: Vec3Like | null = null): boolean {
		if (!this.states.playEmote(id)) return false;
		this.#hasReach = target !== null && Number.isFinite(target.x + target.y + target.z);
		if (this.#hasReach && target !== null) {
			this.#reachX = target.x;
			this.#reachY = target.y;
			this.#reachZ = target.z;
		}
		return true;
	}

	/** The hair style id of avatar-regions.json v2 (rabo, trancas, coque swing). */
	get hairStyle(): string | null {
		return this.#hairStyle;
	}

	set hairStyle(id: string | null) {
		this.#hairStyle = id;
		this.hair.setStyle(id);
		this.#headSamples = 0;
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
		this.slopeLean.reset();
		this.hair.reset();
		this.narrow = this.water = this.teeter = 0;
		this.#wobble = this.#teeterTime = 0;
		this.#hasReach = false;
		this.#headSamples = 0;
		this.#headAX = this.#headAY = this.#headAZ = 0;
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
		// A dialogue holds the talk loop: asked again each update until the avatar stands still.
		if (input.talking === true) {
			if (!states.emoting) states.playEmote('talk');
		} else if (states.emoting && states.emote === 'talk') states.stopEmote();
		states.update(rawDt, input);
		const dt = rawDt > 0 ? Math.min(rawDt, MAX_DT) : 0;
		const weights = states.weights;
		const speed = Math.max(0, Number.isFinite(input.speed) ? input.speed : 0);
		const verticalSpeed = Number.isFinite(input.verticalSpeed) ? input.verticalSpeed : 0;
		const onFoot = input.grounded && !input.climbing && !input.swimming && !input.sitting;
		const stud = this.#stud;
		this.#dt = dt;
		this.#speed = speed;
		this.#followContext(input, onFoot);

		// Distance-driven cycles: shorter steps on narrow footing, slower ones wading.
		this.footstep = null;
		const strideScale = 1 + (CONTEXT.narrowStride - 1) * this.narrow + (CONTEXT.waterStride - 1) * this.water;
		const stride = (WALK_STRIDE + (RUN_STRIDE - WALK_STRIDE) * states.runWeight) * stud * strideScale;
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
				this.swimPhase +
					(Math.sqrt(speed * speed + verticalSpeed * verticalSpeed) * dt) / (SWIM_STRIDE * stud)
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
			const track = EMOTES[states.emote];
			head.time = track.loop ? states.emoteTime / track.period : states.emoteTime;
			head.weight = weights[EMOTING];
			track.sampleInto(out, head);
		}

		this.#applyContext(input);
		this.#applyGesture(input);
		this.#applyLayers(input, onFoot);
		// Styles with nothing dangling (and no style) skip the head tracking.
		if (this.hair.style !== null) this.#swayHair(input);
		return pose;
	}

	/** Moves the narrow, water and teeter weights toward this update's context. */
	#followContext(input: AvatarInput, onFoot: boolean) {
		const dt = this.#dt;
		const k = 1 - Math.exp(-CONTEXT.rate * dt);
		const surface = input.surface;
		const narrow = onFoot && surface === 'narrow' ? 1 : 0;
		const water = onFoot && surface === 'water' ? 1 : 0;
		const edge = input.edgeAhead;
		// Standing at the edge teeters fully; running past it hardly at all.
		const teeter =
			onFoot && !this.states.emoting && typeof edge === 'number' && edge < CONTEXT.teeterEdge
				? 1 - Math.min(1, Math.max(0, this.#speed / WALK_SPEED))
				: 0;
		this.narrow += (narrow - this.narrow) * k;
		this.water += (water - this.water) * k;
		this.teeter += (teeter - this.teeter) * k;
		this.#wobble = (this.#wobble + dt * CONTEXT.wobbleHz) % 1;
		this.#teeterTime = this.teeter > 0.001 ? (this.#teeterTime + dt * CONTEXT.teeterHz) % 1 : 0;
	}

	/** Narrow footing, wading, slopes and the teeter, on top of the blended cycles. */
	#applyContext(input: AvatarInput) {
		const out = this.pose.data;
		const dt = this.#dt;
		const reduced = input.reducedMotion;
		const posture = reduced ? 0.5 : 1;
		const swing = reduced ? 0 : 1;
		const walking = this.states.weights[WALKING];

		const narrow = this.narrow;
		if (narrow > 0.0005) {
			const legs = 1 - CONTEXT.narrowLegs * narrow * walking;
			out[LEG_L] *= legs;
			out[LEG_R] *= legs;
			const arms = 1 - CONTEXT.narrowSwing * narrow * walking;
			out[ARM_L] *= arms;
			out[ARM_R] *= arms;
			const wobble = Math.sin(this.#wobble * TAU) * swing * narrow;
			out[ARM_L + 2] += narrow * posture * CONTEXT.narrowArms + wobble * CONTEXT.wobbleArms;
			out[ARM_R + 2] -= narrow * posture * CONTEXT.narrowArms - wobble * CONTEXT.wobbleArms;
			out[ROOT + 2] += wobble * CONTEXT.wobbleRoll;
			out[TORSO + 2] -= wobble * CONTEXT.wobbleRoll * 0.7;
		}

		const water = this.water;
		if (water > 0.0005) {
			// High knees: only the forward half of the swing grows.
			const knees = 1 + CONTEXT.waterKnees * water * posture * walking;
			if (out[LEG_L] < 0) out[LEG_L] *= knees;
			if (out[LEG_R] < 0) out[LEG_R] *= knees;
			out[ARM_L + 2] += water * posture * CONTEXT.waterArms;
			out[ARM_R + 2] -= water * posture * CONTEXT.waterArms;
			out[ARM_L] -= water * posture * CONTEXT.waterArmsUp;
			out[ARM_R] -= water * posture * CONTEXT.waterArmsUp;
		}

		// Slope: lean into an uphill, brace (lean back, arms forward and out) going down.
		const slope = input.slope;
		const onFoot = input.grounded && !input.climbing && !input.swimming && !input.sitting;
		let slopeTarget = 0;
		let brace = 0;
		if (onFoot && typeof slope === 'number' && Number.isFinite(slope)) {
			slopeTarget =
				slope >= 0
					? Math.min(CONTEXT.slopeMax, slope * CONTEXT.slopeLean)
					: Math.max(-CONTEXT.slopeMax, slope * CONTEXT.slopeBrace);
			slopeTarget *= posture;
		}
		const slopeLean = this.slopeLean;
		slopeLean.target = slopeTarget;
		slopeLean.dt = dt;
		slopeLean.update();
		const lean = slopeLean.value;
		// The uphill lean replaces the speed lean in #applyLayers (the larger wins), never adds to it.
		if (lean < 0) out[TORSO] += lean;
		if (lean < 0) brace = (-lean / CONTEXT.slopeBrace) * CONTEXT.braceArms;
		if (brace > 0) {
			out[ARM_L] -= brace;
			out[ARM_R] -= brace;
			out[ARM_L + 2] += brace * 0.6;
			out[ARM_R + 2] -= brace * 0.6;
		}

		// Teeter: arms windmill around forward-horizontal, the torso leans back from the drop and rocks.
		const teeter = this.teeter * posture;
		if (teeter > 0.0005) {
			const phase = this.#teeterTime * TAU;
			const keep = 1 - teeter;
			const base = -Math.PI / 2;
			out[ARM_L] = out[ARM_L] * keep + (base + swing * CONTEXT.teeterSwing * Math.sin(phase)) * teeter;
			out[ARM_R] = out[ARM_R] * keep + (base - swing * CONTEXT.teeterSwing * Math.sin(phase)) * teeter;
			out[ARM_L + 2] = out[ARM_L + 2] * keep + CONTEXT.teeterArmsOut * teeter;
			out[ARM_R + 2] = out[ARM_R + 2] * keep - CONTEXT.teeterArmsOut * teeter;
			out[TORSO] -= teeter * (CONTEXT.teeterBack + swing * CONTEXT.teeterRock * Math.sin(phase + 0.5));
		}
	}

	/** The bow and the hand of `pickup` and `pet` on the point's side, aimed at it. */
	#applyGesture(input: AvatarInput) {
		const states = this.states;
		const id = states.emote;
		if (id === null) return;
		const timing = REACH[id];
		const weight = states.weights[EMOTING];
		if (timing === undefined || !(weight > 0)) return;
		const t = states.emoteTime;
		// Smoothsteps in and out, inlined (a helper's float return would be boxed).
		const riseT = Math.min(1, Math.max(0, (t - timing.in) / (timing.hold - timing.in)));
		const rise = riseT * riseT * (3 - 2 * riseT);
		const fallT = Math.min(1, Math.max(0, (t - timing.out) / (timing.end - timing.out)));
		const fall = fallT * fallT * (3 - 2 * fallT);
		const envelope = rise * (1 - fall) * weight;
		if (!(envelope > 0)) return;
		const out = this.pose.data;
		const pickup = id === 'pickup';

		// The point in the body's frame, rig units: +z ahead, +x to the left, y up from the feet.
		const scale = RIG_HEIGHT / this.#height;
		let lx = 0;
		let ly = (pickup ? GESTURE.pickupUp : GESTURE.petUp) * scale;
		let lz = (pickup ? GESTURE.pickupAhead : GESTURE.petAhead) * scale;
		if (this.#hasReach) {
			const yaw = Number.isFinite(input.yaw) ? input.yaw : 0;
			const dx = this.#reachX - (Number.isFinite(input.x) ? input.x : 0);
			const dz = this.#reachZ - (Number.isFinite(input.z) ? input.z : 0);
			const cos = Math.cos(yaw);
			const sin = Math.sin(yaw);
			lx = (cos * dx - sin * dz) * scale;
			lz = (sin * dx + cos * dz) * scale;
			ly = (this.#reachY - (Number.isFinite(input.y) ? input.y : 0)) * scale;
		}

		// The torso's pivot, lowered by the gesture's keys.
		const waistY = GESTURE.waist + out[ROOT + 4] * RIG_HEIGHT;
		const waistZ = out[ROOT + 5] * RIG_HEIGHT;
		// The hand on the point's side reaches; the shoulders mirror across x.
		const left = lx > 0;
		const arm = left ? ARM_L : ARM_R;
		const shoulderX = left ? -GESTURE.shoulder[0] : GESTURE.shoulder[0];
		const shoulderY = GESTURE.shoulder[1];
		const shoulderZ = GESTURE.shoulder[2];
		// Bow until the shoulder sits about an arm above the point (never less than the
		// keys' bow); a pickup bows at most pickupBow and lets the lunge and the arm do the rest.
		const wanted = (ly + 0.8 * GESTURE.armReach - waistY) / shoulderY;
		const needed = Math.min(
			pickup ? GESTURE.pickupBow : GESTURE.maxBow,
			Math.max(GESTURE.minBow, Math.acos(Math.min(1, Math.max(-1, wanted))))
		);
		out[TORSO] += Math.max(0, needed - out[TORSO]) * envelope;
		const bow = out[TORSO];
		const cos = Math.cos(bow);
		const sin = Math.sin(bow);
		// A pickup the bow cannot reach leans the torso to the hand's side (lowering that
		// shoulder; YXZ: roll, then the bow) and steps the body toward the item: the root
		// slides over the lunge, so the hand stays under the shoulder.
		let roll0 = out[TORSO + 2];
		let waistX = out[ROOT + 3] * RIG_HEIGHT;
		let waistZStep = waistZ;
		if (pickup) {
			const side = left ? -1 : 1;
			const plainY = waistY + shoulderY * cos - shoulderZ * sin;
			const shortfall = plainY - ly - GESTURE.armReach;
			const share = Math.min(1, Math.max(0, shortfall / GESTURE.leanRange));
			out[TORSO + 2] += side * GESTURE.pickupLean * share * envelope;
			roll0 = out[TORSO + 2];
			const rc = Math.cos(roll0);
			const rs = Math.sin(roll0);
			const y1 = shoulderX * rs + shoulderY * rc;
			const hx = lx - (waistX + shoulderX * rc - shoulderY * rs);
			const hz = lz - (waistZ + y1 * sin + shoulderZ * cos);
			const gap = waistY + y1 * cos - shoulderZ * sin - ly;
			const horizontal = Math.sqrt(hx * hx + hz * hz);
			const allowed = Math.sqrt(Math.max(0, GESTURE.armReach * GESTURE.armReach - gap * gap));
			if (horizontal > allowed && horizontal > 1e-6) {
				const step = (Math.min(GESTURE.pickupStep, horizontal - allowed) / horizontal) * envelope;
				out[ROOT + 3] += (hx * step) / RIG_HEIGHT;
				out[ROOT + 5] += (hz * step) / RIG_HEIGHT;
				waistX += hx * step;
				waistZStep += hz * step;
			}
		}
		const rollCos = Math.cos(roll0);
		const rollSin = Math.sin(roll0);
		// Shoulder in the body's frame, then the point relative to it in the torso's frame.
		const s1y = shoulderX * rollSin + shoulderY * rollCos;
		const sx = waistX + shoulderX * rollCos - shoulderY * rollSin;
		const sy = waistY + s1y * cos - shoulderZ * sin;
		const sz = waistZStep + s1y * sin + shoulderZ * cos;
		const vx = lx - sx;
		const vy = ly - sy;
		const vz = lz - sz;
		const by = vy * cos + vz * sin;
		const tz = -vy * sin + vz * cos;
		const tx = vx * rollCos + by * rollSin;
		const ty = -vx * rollSin + by * rollCos;
		const length = Math.sqrt(tx * tx + ty * ty + tz * tz);
		if (!(length > 1e-6)) return;
		// The arm hangs along −y; YXZ Euler (roll first, then pitch) takes it to (tx, ty, tz).
		let pitch = Math.atan2(-tz / length, -ty / length);
		const roll = Math.asin(Math.min(1, Math.max(-1, tx / length)));
		if (!pickup && !input.reducedMotion)
			pitch += GESTURE.stroke * Math.sin((t - timing.hold) * GESTURE.strokeHz * TAU) * rise;
		out[arm] += (pitch - out[arm]) * envelope;
		out[arm + 1] -= out[arm + 1] * envelope;
		out[arm + 2] += (roll - out[arm + 2]) * envelope;
	}

	/** Feeds the hair swing with the head's acceleration, from the pose and the feet. */
	#swayHair(input: AvatarInput) {
		const hair = this.hair;
		const dt = this.#dt;
		const out = this.pose.data;
		const height = this.#height;
		const scale = height / RIG_HEIGHT;
		const pitch = out[ROOT] + out[TORSO];
		const yaw = (Number.isFinite(input.yaw) ? input.yaw : 0) + out[TORSO + 1];
		const up = out[ROOT + 4] * height + (GESTURE.waist + 1.2 * Math.cos(pitch)) * scale * this.pose.scaleY;
		const ahead = out[ROOT + 5] * height + 1.2 * Math.sin(pitch) * scale;
		const sin = Math.sin(yaw);
		const cos = Math.cos(yaw);
		const x = (Number.isFinite(input.x) ? input.x : 0) + sin * ahead;
		const y = (Number.isFinite(input.y) ? input.y : 0) + up;
		const z = (Number.isFinite(input.z) ? input.z : 0) + cos * ahead;
		if (dt > 0) {
			const dx = x - this.#headX;
			const dy = y - this.#headY;
			const dz = z - this.#headZ;
			if (this.#headSamples === 0 || dx * dx + dy * dy + dz * dz > TELEPORT * TELEPORT) {
				this.#headSamples = 1;
				this.#headAX = this.#headAY = this.#headAZ = 0;
			} else {
				const vx = dx / dt;
				const vy = dy / dt;
				const vz = dz / dt;
				if (this.#headSamples === 2) {
					// Finite differences are noisy at uneven frame times: low-pass the acceleration.
					const k = 1 - Math.exp(-30 * dt);
					this.#headAX += ((vx - this.#headVX) / dt - this.#headAX) * k;
					this.#headAY += ((vy - this.#headVY) / dt - this.#headAY) * k;
					this.#headAZ += ((vz - this.#headVZ) / dt - this.#headAZ) * k;
				}
				this.#headVX = vx;
				this.#headVY = vy;
				this.#headVZ = vz;
				this.#headSamples = 2;
			}
			this.#headX = x;
			this.#headY = y;
			this.#headZ = z;
		}
		const ax = this.#headAX;
		const az = this.#headAZ;
		hair.accelForward = ax * sin + az * cos;
		hair.accelLeft = ax * cos - az * sin;
		hair.accelUp = this.#headAY;
		hair.headPitch = pitch + out[HEAD];
		hair.reduced = input.reducedMotion;
		hair.dt = dt;
		hair.update();
	}

	#applyLayers(input: AvatarInput, onFoot: boolean) {
		const pose = this.pose;
		const out = pose.data;
		const states = this.states;
		const weights = states.weights;
		const dt = this.#dt;
		const speed = this.#speed;
		const reduced = input.reducedMotion;
		const yaw = Number.isFinite(input.yaw) ? input.yaw : 0;

		// Lean and bank. Roblox accelerates instantly, so the lean comes from the gap
		// between the speed and a lagging copy of it, then a spring smooths it.
		this.#laggingSpeed += (speed - this.#laggingSpeed) * (1 - Math.exp(-LAYERS.accelRate * dt));
		let leanTarget = 0;
		let bankTarget = 0;
		if (!reduced && onFoot) {
			const gap = Math.min(1, Math.max(-1, (speed - this.#laggingSpeed) / WALK_SPEED));
			leanTarget = Math.min(
				LAYERS.maxLean,
				Math.max(-LAYERS.maxLean, LAYERS.speedLean * Math.min(1, speed / WALK_SPEED) + LAYERS.accelLean * gap)
			);
			const yawRate =
				dt > 0 && this.#hasYaw ? (((((yaw - this.#lastYaw + Math.PI) % TAU) + TAU) % TAU) - Math.PI) / dt : 0;
			bankTarget = Math.min(LAYERS.maxBank, Math.max(-LAYERS.maxBank, -yawRate * speed * LAYERS.bankGain));
		}
		this.#lastYaw = yaw;
		this.#hasYaw = true;
		const lean = this.lean;
		lean.target = leanTarget;
		lean.dt = dt;
		lean.update();
		const uphill = this.slopeLean.value;
		out[TORSO] += Math.max(uphill, lean.value);
		// Wading: the trunk stays nearly upright whatever the clip and the leans add.
		const water = this.water;
		if (water > 0.0005 && out[TORSO] > CONTEXT.waterMaxLean)
			out[TORSO] -= (out[TORSO] - CONTEXT.waterMaxLean) * water;
		const bank = this.bank;
		bank.target = bankTarget;
		bank.dt = dt;
		bank.update();
		out[ROOT + 2] += bank.value;

		// Squash and stretch: the spring sits at 0, take-off and landing kick it.
		if (!reduced) {
			if (states.landed)
				this.squash.kick(-LAYERS.landSquash * Math.min(1, Math.max(0, states.landingSpeed / JUMP_SPEED)));
			if (states.jumped) this.squash.kick(LAYERS.jumpStretch);
		}
		const squashSpring = this.squash;
		squashSpring.target = 0;
		squashSpring.dt = dt;
		squashSpring.update();
		const squash = Math.min(0.3, Math.max(-0.3, squashSpring.value));
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
			const toTarget = ((((Math.atan2(dx, dz) - yaw + Math.PI) % TAU) + TAU) % TAU) - Math.PI;
			const yawLimit = reduced ? LAYERS.lookYaw / 2 : LAYERS.lookYaw;
			const pitchLimit = reduced ? LAYERS.lookPitch / 2 : LAYERS.lookPitch;
			if (Number.isFinite(toTarget) && Math.abs(toTarget) <= LAYERS.lookYaw + LAYERS.lookBehind) {
				yawGoal = Math.min(yawLimit, Math.max(-yawLimit, toTarget));
				const pitch = Math.atan2(dy, Math.sqrt(dx * dx + dz * dz));
				pitchGoal = Number.isFinite(pitch) ? Math.min(pitchLimit, Math.max(-pitchLimit, pitch)) : 0;
			}
		}
		const emote = states.emote;
		const lookable = emote !== 'pickup' && emote !== 'binoculars' && emote !== 'pet';
		const attention = weights[IDLE] + weights[WALKING] + weights[SITTING] + (lookable ? weights[EMOTING] : 0);
		const yawSpring = this.lookYaw;
		yawSpring.target = yawGoal;
		yawSpring.dt = dt;
		yawSpring.update();
		const pitchSpring = this.lookPitch;
		pitchSpring.target = pitchGoal;
		pitchSpring.dt = dt;
		pitchSpring.update();
		const lookYaw = yawSpring.value * attention;
		const lookPitch = pitchSpring.value * attention;
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
