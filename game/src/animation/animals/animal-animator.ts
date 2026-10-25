/**
 * The generic rigid-node animal animator: one AnimalMotion in, one reused Pose
 * out (8 slots, rigs.ts), which ../rig.ts applyToRig writes onto the Cube Pets
 * nodes. No allocation per update.
 *
 * Order of one update:
 * 1. posture crossfade (linear weights that always sum to 1, AnimationTrack-style);
 * 2. gait phase, advanced by the distance the behaviour actually covered, never
 *    by time (ART.md §7);
 * 3. weighted blend of the posture keys, two of them rebuilt every update
 *    (brachiation, sloth limbs);
 * 4. additive layers: gait, wingbeat, feeding, howl, crouch;
 * 5. springs from the shared presets (src/style/motion.ts), scaled by the
 *    species tempo: look-at, tail, lean and bank, squash;
 * 6. the root offset that puts the blended pivot on the blended anchor.
 *
 * Reduced motion (ART.md §7) zeroes the decorative layers: squash, lean, bank,
 * bob, the bound's body arc, idle and tail sway, the crouch and the tail's
 * secondary lag; look-at turns half as far and crossfades shorten to 120 ms.
 * Gait legs, wingbeats, brachiation and feeding stay, since they are what the
 * animal is doing.
 */
import { DURATION, LIMITS, REDUCED_MOTION_DURATION, SPRING } from '../../style/motion.ts';
import { JOINT_STRIDE, Pose } from '../skeleton.ts';
import { DampedSpring } from './damped-spring.ts';
import type { AnimalMotion } from './motion.ts';
import {
	buildPostures,
	POSTURE_COUNT,
	POSTURE_INDEX,
	POSTURES,
	type PostureSet,
	WING_FOLDED,
	WING_SPREAD
} from './postures.ts';
import {
	BODY,
	HEAD,
	isBird,
	JOINT_COUNT,
	LIMB_BL,
	LIMB_BR,
	LIMB_FL,
	LIMB_FR,
	MODELS,
	type ModelMeasures,
	ROOT,
	TAIL
} from './rigs.ts';
import { clamp01, DEG, safeDt, TAU } from './scalar.ts';
import { type GaitParams, SPECIES, type SpeciesId, type SpeciesParams } from './species.ts';

const STAND = POSTURE_INDEX.stand;
const SIT = POSTURE_INDEX.sit;
const HANG_ARM = POSTURE_INDEX['hang-arm'];
const HANG_TAIL = POSTURE_INDEX['hang-tail'];
const FEED_HANG = POSTURE_INDEX['feed-hang'];
const HANG_UNDER = POSTURE_INDEX['hang-under'];
const HANG_CURL = POSTURE_INDEX['hang-curl'];
const HOWL = POSTURE_INDEX.howl;
const FLY = POSTURE_INDEX.fly;

const R = ROOT * JOINT_STRIDE;
const B = BODY * JOINT_STRIDE;
const H = HEAD * JOINT_STRIDE;
const T = TAIL * JOINT_STRIDE;
const KEY_WIDTH = JOINT_COUNT * JOINT_STRIDE;

/** Tuning of the layers that are not species data [engine]. */
export const ANIMAL_LAYERS = {
	/** Below this speed (u/s) the gait fades out. */
	moveThreshold: 0.05,
	/** Lean per u/s² of acceleration and bank per (rad/s × u/s), radians, and their caps. */
	leanGain: 0.012,
	maxLean: 6 * DEG,
	bankGain: 0.02,
	maxBank: 8 * DEG,
	/** Wingbeat about the 'fly' key: mean offset and amplitude, radians (down 39°, up 51°). */
	flapBias: 6 * DEG,
	flapAmplitude: 45 * DEG,
	/** Feeding: hand-to-mouth cycles per second and swing, radians. */
	eatRate: 0.7,
	eatSwing: 25 * DEG,
	/** Howl pulses per second (breath groups of the roar) and head pump, radians. */
	howlRate: 1.4,
	howlPump: 6 * DEG,
	/** Crouch depth (model units) and pitch at full anticipation. */
	crouchDepth: 0.08,
	crouchPitch: 6 * DEG,
	/** The released hand of a brachiator returns to rest over this long, seconds. */
	releaseTime: 0.3,
	/**
	 * How upright a brachiator hangs: 1 would be vertical, but the Cube Pets head is
	 * part of the body block, so a vertical trunk would point the face at the sky.
	 * At 0.35 the trunk is pitched 32° and the face looks ahead to the next hold.
	 */
	hangUpright: 0.35,
	/** A free arm at rest, radians from straight down (a little forward). */
	freeArmRest: -15 * DEG,
	/** Share of the swing the dangling legs lag behind. */
	legTrail: 0.4,
	/** Limb unhook while a sloth limb moves: offset toward the body (model units) and sideways roll. */
	limbLift: 0.08,
	limbLiftRoll: 15 * DEG
} as const;

export interface AnimalAnimatorOptions {
	/**
	 * Whether the model has its own head node. The Cube Pets do not (bindAnimal
	 * reports it); without one, look-at turns the body by the species' bodyLook.
	 */
	hasHead?: boolean;
}

export class AnimalAnimator {
	readonly species: SpeciesParams;
	readonly model: ModelMeasures;
	readonly postures: PostureSet;
	/** The final pose of the last update. */
	readonly pose = new Pose(JOINT_COUNT);
	/** Posture weights in POSTURES order; they always sum to 1. */
	readonly weights = new Float64Array(POSTURE_COUNT);
	hasHead: boolean;
	/** Set by the caller (Animal reads it from the world) before update. */
	reducedMotion = false;

	/** Gait cycle phase in [0, 1); moves only with distance. */
	phase = 0;
	/** Strides per second and stride length (u) in the last update. */
	cadence = 0;
	stride = 0;
	/** Share of the gait layer and of the run gait in it, 0..1. */
	gaitWeight = 0;
	runWeight = 0;
	/** Limb slot (4–7) that touched down during the last update, or -1: for dust and footstep sounds. */
	footfall = -1;
	/** Animation clock, seconds (time-driven layers only: wingbeat, sway, feeding, howl). */
	time = 0;
	wingPhase = 0;

	readonly lookYaw: DampedSpring;
	readonly lookPitch: DampedSpring;
	readonly tailYaw: DampedSpring;
	readonly tailPitch: DampedSpring;
	readonly lean: DampedSpring;
	readonly bank: DampedSpring;
	readonly squash: DampedSpring;

	readonly #bird: boolean;
	readonly #fallback: number;
	readonly #from = new Float64Array(POSTURE_COUNT);
	readonly #dynamic = new Float64Array(KEY_WIDTH);
	readonly #pivot = new Float64Array(3);
	readonly #anchor = new Float64Array(3);
	readonly #dynamicPivot = new Float64Array(3);
	readonly #dynamicAnchor = new Float64Array(3);
	#target = -1;
	#fade = 0;
	#fadeElapsed = 0;
	#dt = 0;
	#arc = 0;
	#gaitShare = 0;
	readonly #stateFade: number = DURATION.state;
	readonly #reducedFade: number = REDUCED_MOTION_DURATION;
	#howlPhase = 0;
	#eatPhase = 0;
	#gripSide = 1;
	#gripAngle = -Math.PI / 2;
	#releaseFrom = 0;
	#releaseElapsed = 1;

	constructor(species: SpeciesId | SpeciesParams, options: AnimalAnimatorOptions = {}) {
		this.species = typeof species === 'string' ? SPECIES[species] : species;
		this.model = MODELS[this.species.model];
		this.postures = buildPostures(this.species.id);
		this.hasHead = options.hasHead ?? false;
		this.#bird = isBird(this.species.model);
		this.#fallback = Math.max(
			0,
			this.postures.keys.findIndex((key) => key !== null)
		);
		const tempo = this.species.tempo;
		this.lookYaw = new DampedSpring(this.species.lookPreset, tempo);
		this.lookPitch = new DampedSpring(this.species.lookPreset, tempo);
		this.tailYaw = new DampedSpring(SPRING.appendage, tempo);
		this.tailPitch = new DampedSpring(SPRING.appendage, tempo);
		this.lean = new DampedSpring(SPRING.body, tempo);
		this.bank = new DampedSpring(SPRING.body, tempo);
		this.squash = new DampedSpring(SPRING.pop, tempo);
		this.reset();
	}

	/** Back to the species' first posture at rest, springs settled (spawn, teleport). */
	reset() {
		this.pose.reset();
		this.weights.fill(0);
		this.weights[this.#fallback] = 1;
		this.#target = this.#fallback;
		this.#fadeElapsed = this.#fade = 0;
		this.phase = this.cadence = this.stride = this.gaitWeight = this.runWeight = 0;
		this.time = this.wingPhase = this.#howlPhase = this.#eatPhase = this.#arc = 0;
		this.footfall = -1;
		this.#gripSide = 1;
		this.#gripAngle = -Math.PI / 2;
		this.#releaseElapsed = 1;
		this.lookYaw.reset();
		this.lookPitch.reset();
		this.tailYaw.reset();
		this.tailPitch.reset();
		this.lean.reset();
		this.bank.reset();
		this.squash.reset();
	}

	/** Index of the posture actually used for a request (the species' first one if it lacks it). */
	postureIndex(motion: AnimalMotion): number {
		const index = POSTURE_INDEX[motion.posture];
		return index !== undefined && this.postures.keys[index] !== null ? index : this.#fallback;
	}

	/** Advances by `dt` seconds (pass the frame or LOD time through) and returns the reused pose. */
	update(rawDt: number, motion: AnimalMotion) {
		this.#dt = safeDt(rawDt);
		return this.#update(motion);
	}

	/** The same, reading dt from an object field (no boxed argument on the per-frame path). */
	updateFrom(time: { readonly dt: number }, motion: AnimalMotion) {
		this.#dt = safeDt(time.dt);
		return this.#update(motion);
	}

	#update(motion: AnimalMotion) {
		this.time += this.#dt;
		this.#crossfade(motion);
		this.#advanceGait(motion);

		const out = this.pose.reset().data;
		const pivot = this.#pivot.fill(0);
		const anchor = this.#anchor.fill(0);
		const keys = this.postures.keys;
		const pivots = this.postures.pivots;
		const anchors = this.postures.anchors;
		for (let i = 0; i < POSTURE_COUNT; i++) {
			const w = this.weights[i];
			if (!(w > 0)) continue;
			let key = keys[i];
			if (key === null) continue;
			let p = pivots;
			let a = anchors;
			let at = i * 3;
			if (i === HANG_ARM) {
				this.#brachiate(motion, key);
				key = this.#dynamic;
				p = this.#dynamicPivot;
				a = this.#dynamicAnchor;
				at = 0;
			}
			for (let k = 0; k < KEY_WIDTH; k++) out[k] += w * key[k];
			for (let k = 0; k < 3; k++) {
				pivot[k] += w * p[at + k];
				anchor[k] += w * a[at + k];
			}
		}

		this.#gaitLayer(out);
		this.#limbLayer(motion, out);
		this.#wingLayer(motion, out);
		this.#feedingLayer(motion, out);
		this.#crouchLayer(motion, out);
		this.#lookLayer(motion, out);
		this.#tailLayer(motion, out);
		this.#leanLayer(motion, out);
		this.#rootOffset(out);
		this.#squashLayer(motion);
		return this.pose;
	}

	#crossfade(motion: AnimalMotion) {
		const target = this.postureIndex(motion);
		const weights = this.weights;
		if (target !== this.#target) {
			this.#from.set(weights);
			this.#target = target;
			const fade = Number.isFinite(motion.fade) && motion.fade > 0 ? motion.fade : 0;
			this.#fade = this.reducedMotion ? Math.min(fade, REDUCED_MOTION_DURATION) : fade;
			this.#fadeElapsed = 0;
		}
		this.#fadeElapsed += this.#dt;
		const s = this.#fade > 0 ? Math.min(1, this.#fadeElapsed / this.#fade) : 1;
		const from = this.#from;
		for (let i = 0; i < POSTURE_COUNT; i++) weights[i] = from[i] + ((i === target ? 1 : 0) - from[i]) * s;
	}

	#advanceGait(motion: AnimalMotion) {
		const species = this.species;
		this.footfall = -1;
		if (species.walk === null) {
			this.gaitWeight = this.cadence = 0;
			return;
		}
		const speed = Number.isFinite(motion.speed) ? Math.max(0, motion.speed) : 0;
		const distance = motion.distance > 0 && Number.isFinite(motion.distance) ? motion.distance : 0;
		// Turning on the spot covers foot travel at no speed: it steps too.
		const moving = (speed > ANIMAL_LAYERS.moveThreshold || distance > 0) && this.#target === STAND;
		// Copies in fields: a ternary between an imported binding and an imported
		// object's property made TurboFan box the result every update (measured).
		const fade = this.reducedMotion ? this.#reducedFade : this.#stateFade;
		const step = this.#dt / fade;
		this.gaitWeight = moving ? Math.min(1, this.gaitWeight + step) : Math.max(0, this.gaitWeight - step);
		// strideAt and smoothstep, written out: helpers that take and return numbers
		// box them whenever V8 does not inline the call (p3-animation.md).
		let run = species.run === null ? 0 : (speed - species.runFrom) / (species.runTo - species.runFrom);
		run = Math.min(1, Math.max(0, run));
		this.runWeight = run * run * (3 - 2 * run);
		const strides = species.stride;
		const share = Math.min(
			1,
			Math.max(0, (speed - strides.slowSpeed) / (strides.fastSpeed - strides.slowSpeed))
		);
		const stride = strides.slowStride + (strides.fastStride - strides.slowStride) * share;
		this.stride = stride;
		this.cadence = speed / stride;
		if (distance === 0) return;
		const before = this.phase;
		const cycles = motion.cycles;
		const advance = cycles >= 0 && Number.isFinite(cycles) ? cycles : distance / stride;
		const next = before + advance;
		this.phase = next - Math.floor(next);
		if (this.gaitWeight < 0.5) return;
		// Footfalls crossed during this update (the last one wins), for dust and sounds.
		const gait = this.runWeight > 0.5 && species.run !== null ? species.run : species.walk;
		if (advance >= 1) {
			this.footfall = LIMB_FL;
			return;
		}
		for (let leg = 0; leg < 4; leg++) {
			const a = before - gait.touchdown[leg];
			const b = a + advance;
			if (a - Math.floor(a) > b - Math.floor(b)) this.footfall = LIMB_FL + leg;
		}
	}

	#gaitLayer(out: Float64Array) {
		const species = this.species;
		const base = this.gaitWeight * this.weights[STAND];
		this.#arc = 0;
		if (!(base > 0) || species.walk === null) return;
		const run = this.runWeight;
		// The weight travels in a field: a computed number argument is boxed when
		// V8 does not inline the call (p3-animation.md, V8 rule 1).
		this.#gaitShare = base * (1 - run);
		this.#addGait(out, species.walk);
		if (species.run !== null && run > 0) {
			this.#gaitShare = base * run;
			this.#addGait(out, species.run);
		}
	}

	/** Adds one gait at weight #gaitShare. */
	#addGait(out: Float64Array, gait: GaitParams) {
		const weight = this.#gaitShare;
		if (!(weight > 0)) return;
		const model = this.model;
		const height = model.height;
		const scale = this.species.scale;
		const strideModel = this.stride / scale;
		const phase = this.phase;
		const decorative = this.reducedMotion ? 0 : 1;
		for (let leg = 0; leg < 4; leg++) {
			const slot = LIMB_FL + leg;
			const front = leg < 2;
			const length = model.legLength * (front ? this.species.limbScale.front : this.species.limbScale.hind);
			const duty = gait.duty[leg];
			// Swing that covers the stance sweep without sliding, capped (rigid stubby legs).
			const sweep = (strideModel * duty) / (2 * length);
			const amplitude = Math.min(gait.maxSwing, Math.asin(Math.min(1, sweep)));
			const shifted = phase - gait.touchdown[leg];
			const u = shifted - Math.floor(shifted);
			let forward: number;
			let lift: number;
			if (u < duty) {
				forward = 1 - (2 * u) / duty;
				lift = 0;
			} else {
				const v = (u - duty) / (1 - duty);
				forward = -Math.cos(Math.PI * v);
				lift = Math.sin(Math.PI * v);
			}
			const at = slot * JOINT_STRIDE;
			out[at] -= forward * amplitude * weight;
			out[at + 4] += ((lift * gait.lift) / height) * weight;
		}
		out[B + 4] += ((gait.bob * Math.cos(TAU * gait.bobsPerStride * phase)) / height) * weight * decorative;
		out[B] -= gait.pitch * Math.cos(TAU * phase) * weight;
		out[B + 2] += gait.roll * Math.sin(TAU * phase) * weight;
		if (gait.arc > 0 && phase >= gait.arcStart && phase < gait.arcEnd) {
			const t = (phase - gait.arcStart) / (gait.arcEnd - gait.arcStart);
			// The arc grows with speed: a slow bound barely leaves the branch.
			const speedShare = Math.min(1, Math.max(0, this.cadence * this.stride * 0.1));
			this.#arc += ((gait.arc * Math.sin(Math.PI * t)) / height) * weight * speedShare * decorative;
		}
	}

	/**
	 * Hanging sloth: each foot hooks the branch at its own hold. The hang posture
	 * pitches the root to level the long forelimbs with the hindlimbs, so in the
	 * root frame the branch runs along (0, −sin p, cos p) and "toward the branch"
	 * is (0, −cos p, −sin p). Each leg aims at hip + L·toward + reach·along and
	 * slides along its own axis by the length difference, so the foot lands on
	 * the hold exactly; a moving limb unhooks toward the body.
	 */
	#limbLayer(motion: AnimalMotion, out: Float64Array) {
		const weight = this.weights[HANG_UNDER] + this.weights[HANG_CURL];
		if (!(weight > 0)) return;
		const model = this.model;
		const height = model.height;
		const lifts = motion.limbLift;
		const reaches = motion.limbReach;
		const pitch = out[R] / weight;
		const cp = Math.cos(pitch);
		const sp = Math.sin(pitch);
		for (let leg = 0; leg < 4; leg++) {
			const length = model.legLength * (leg < 2 ? this.species.limbScale.front : this.species.limbScale.hind);
			const raw = Number.isFinite(reaches[leg]) ? reaches[leg] : 0;
			const reach = Math.min(1.5 * length, Math.max(-1.5 * length, raw));
			const lift = Math.min(1, Math.max(0, lifts[leg] || 0));
			const at = (LIMB_FL + leg) * JOINT_STRIDE;
			// The rest leg points along −y; the pitched branch-ward direction is p away from it.
			const vy = -length * cp - reach * sp;
			const vz = -length * sp + reach * cp;
			const span = Math.sqrt(vy * vy + vz * vz);
			const angle = Math.atan2(-vz, -vy);
			const slide = 1 - length / span;
			const side = leg % 2 === 0 ? 1 : -1;
			out[at] += angle * weight;
			out[at + 2] += side * lift * ANIMAL_LAYERS.limbLiftRoll * weight;
			const unhook = lift * ANIMAL_LAYERS.limbLift;
			out[at + 4] += ((vy * slide + unhook * cp) / height) * weight;
			out[at + 5] += ((vz * slide + unhook * sp) / height) * weight;
		}
	}

	#wingLayer(motion: AnimalMotion, out: Float64Array) {
		if (!this.#bird) return;
		const rate = motion.flapRate > 0 && Number.isFinite(motion.flapRate) ? motion.flapRate : 0;
		const wing = this.wingPhase + rate * this.#dt;
		this.wingPhase = wing - Math.floor(wing);
		const weight = this.weights[FLY];
		if (!(weight > 0)) return;
		const flap = Math.min(1, Math.max(0, motion.flap || 0));
		const closed = Math.min(1, Math.max(0, motion.wingsClosed || 0));
		const beat = ANIMAL_LAYERS.flapBias + ANIMAL_LAYERS.flapAmplitude * Math.sin(TAU * this.wingPhase);
		const angle = (closed * (WING_FOLDED - WING_SPREAD) * DEG + flap * (1 - closed) * beat) * weight;
		out[LIMB_FL * JOINT_STRIDE + 2] += angle;
		out[LIMB_FR * JOINT_STRIDE + 2] -= angle;
		// Body heaves against the downstroke; decorative.
		if (!this.reducedMotion)
			out[B + 4] -=
				((0.03 * flap * (1 - closed) * Math.sin(TAU * this.wingPhase)) / this.model.height) * weight;
	}

	#feedingLayer(motion: AnimalMotion, out: Float64Array) {
		const layers = ANIMAL_LAYERS;
		const eatPhase = this.#eatPhase + layers.eatRate * this.#dt;
		this.#eatPhase = eatPhase - Math.floor(eatPhase);
		const howlPhase = this.#howlPhase + layers.howlRate * this.#dt;
		this.#howlPhase = howlPhase - Math.floor(howlPhase);
		const eat =
			Math.min(1, Math.max(0, motion.eat || 0)) *
			(this.weights[FEED_HANG] + this.weights[HANG_TAIL] + this.weights[SIT]);
		if (eat > 0 && !this.#bird) {
			const swing = layers.eatSwing * eat;
			out[LIMB_FL * JOINT_STRIDE] -= swing * (0.5 + 0.5 * Math.sin(TAU * this.#eatPhase));
			out[LIMB_FR * JOINT_STRIDE] -= swing * (0.5 - 0.5 * Math.sin(TAU * this.#eatPhase));
		}
		const howl = Math.min(1, Math.max(0, motion.howl || 0)) * this.weights[HOWL];
		// Each breath group of the roar pumps the head; the posture itself stays with reduced motion.
		if (howl > 0 && !this.reducedMotion)
			out[B] -= layers.howlPump * howl * (0.5 + 0.5 * Math.sin(TAU * this.#howlPhase));
	}

	#crouchLayer(motion: AnimalMotion, out: Float64Array) {
		const crouch = this.reducedMotion ? 0 : Math.min(1, Math.max(0, motion.crouch || 0));
		if (!(crouch > 0)) return;
		out[B + 4] -= (ANIMAL_LAYERS.crouchDepth * crouch) / this.model.height;
		out[B] += ANIMAL_LAYERS.crouchPitch * crouch;
	}

	#lookLayer(motion: AnimalMotion, out: Float64Array) {
		const species = this.species;
		const share = this.reducedMotion ? 0.5 : 1;
		let look = Number.isFinite(motion.lookYaw) ? motion.lookYaw : 0;
		look -= TAU * Math.round(look / TAU);
		const tilt = Number.isFinite(motion.lookPitch) ? motion.lookPitch : 0;
		const yawSpring = this.lookYaw;
		yawSpring.target = Math.min(species.lookYaw, Math.max(-species.lookYaw, look)) * share;
		yawSpring.dt = this.#dt;
		yawSpring.update();
		const pitchSpring = this.lookPitch;
		pitchSpring.target = Math.min(species.lookPitch, Math.max(-species.lookPitch, tilt)) * share;
		pitchSpring.dt = this.#dt;
		pitchSpring.update();
		const yaw = yawSpring.value;
		const pitch = pitchSpring.value;
		const at = this.hasHead ? H : B;
		const gain = this.hasHead ? 1 : species.bodyLook;
		// Hanging by the tail (a child of the body), turning the body would pull the
		// tail tip off the branch: turn the whole animal about its pivot instead.
		const anchored = this.hasHead ? 0 : Math.min(1, this.weights[HANG_TAIL] + this.weights[FEED_HANG]);
		const free = 1 - anchored;
		out[at + 1] += yaw * gain * free;
		out[at] -= pitch * gain * free;
		out[at + 2] -= yaw * gain * species.headTilt * free;
		out[R + 1] += yaw * gain * anchored;
	}

	#tailLayer(motion: AnimalMotion, out: Float64Array) {
		const species = this.species;
		let yawTarget = 0;
		let pitchTarget = 0;
		if (!this.reducedMotion) {
			const idle = 1 - 0.7 * this.gaitWeight;
			const sway =
				species.tailSway * idle * Math.sin((TAU * this.time) / Math.max(0.1, species.tailSwayPeriod));
			// The tail lags the body: it swings out of a turn and drops when the body accelerates.
			const turn = -(motion.turnRate || 0) * species.tailTurn;
			const accel = -(motion.accel || 0) * species.tailAccel;
			yawTarget = Math.min(0.5, Math.max(-0.5, turn)) + sway;
			pitchTarget = Math.min(0.4, Math.max(-0.4, accel));
		}
		// A tail holding the branch does not sway.
		const free = 1 - Math.min(1, this.weights[HANG_TAIL] + this.weights[FEED_HANG]);
		const yaw = this.tailYaw;
		yaw.target = yawTarget * free;
		yaw.dt = this.#dt;
		yaw.update();
		const pitch = this.tailPitch;
		pitch.target = pitchTarget * free;
		pitch.dt = this.#dt;
		pitch.update();
		out[T + 1] += yaw.value * free;
		out[T] += pitch.value * free;
	}

	#leanLayer(motion: AnimalMotion, out: Float64Array) {
		const layers = ANIMAL_LAYERS;
		const ground = this.weights[STAND];
		let lean = 0;
		let bank = 0;
		if (!this.reducedMotion) {
			const accel = (motion.accel || 0) * layers.leanGain;
			const turn = (motion.turnRate || 0) * (motion.speed || 0) * layers.bankGain;
			lean = Math.min(layers.maxLean, Math.max(-layers.maxLean, accel)) * ground;
			bank = Math.min(layers.maxBank, Math.max(-layers.maxBank, turn)) * ground;
		}
		const leanSpring = this.lean;
		leanSpring.target = lean;
		leanSpring.dt = this.#dt;
		leanSpring.update();
		const bankSpring = this.bank;
		bankSpring.target = bank;
		bankSpring.dt = this.#dt;
		bankSpring.update();
		out[B] += leanSpring.value;
		out[B + 2] += bankSpring.value;
		// Flight attitude: the path pitch is essential (the bird points where it goes), the bank decorative.
		const flight = this.weights[FLY];
		if (flight > 0) {
			out[R] += Math.min(0.8, Math.max(-0.8, motion.pitch || 0)) * flight;
			if (!this.reducedMotion) out[R + 2] += Math.min(0.6, Math.max(-0.6, motion.bank || 0)) * flight;
		}
	}

	/** offset = anchor − R(root rotation) · pivot, all in fractions of the rig height. */
	#rootOffset(out: Float64Array) {
		const pivot = this.#pivot;
		const anchor = this.#anchor;
		const rx = out[R];
		const ry = out[R + 1];
		const rz = out[R + 2];
		// three's 'YXZ' Euler: v' = Ry · Rx · Rz · v.
		const cz = Math.cos(rz);
		const sz = Math.sin(rz);
		const x1 = pivot[0] * cz - pivot[1] * sz;
		const y1 = pivot[0] * sz + pivot[1] * cz;
		const z1 = pivot[2];
		const cx = Math.cos(rx);
		const sx = Math.sin(rx);
		const y2 = y1 * cx - z1 * sx;
		const z2 = y1 * sx + z1 * cx;
		const cy = Math.cos(ry);
		const sy = Math.sin(ry);
		const x3 = x1 * cy + z2 * sy;
		const z3 = -x1 * sy + z2 * cy;
		out[R + 3] = anchor[0] - x3;
		out[R + 4] = anchor[1] - y2 + this.#arc;
		out[R + 5] = anchor[2] - z3;
	}

	#squashLayer(motion: AnimalMotion) {
		const pose = this.pose;
		if (this.reducedMotion) {
			this.squash.reset();
			pose.scaleY = pose.scaleXZ = 1;
			return;
		}
		const limit = LIMITS.squash;
		if (motion.landing > 0) this.squash.kick(-limit * 0.8 * clamp01(motion.landing));
		if (motion.takeoff > 0) this.squash.kick(limit * 0.6 * clamp01(motion.takeoff));
		const squash = this.squash;
		squash.target = 0;
		squash.dt = this.#dt;
		squash.update();
		const value = Math.min(limit, Math.max(-limit, squash.value));
		pose.scaleY = 1 + value;
		pose.scaleXZ = 1 / Math.sqrt(1 + value);
	}

	/**
	 * The brachiation key, rebuilt from the pendulum each update (muriqui). In the
	 * swing plane (model y-z): the shoulder hangs `arm` below the gripping hand at
	 * angle θ; the trunk is pitched up by α = −hangUpright·π/2 − φ (φ: how far it
	 * follows the swing); the gripping arm points from the shoulder back to the
	 * hand, β = π − α − θ; the free arm and the legs dangle toward the ground
	 * (β = −α), and the free arm reaches for the next handhold near the apex. The
	 * pivot is the gripping hand's tip, so the root offset puts that hand exactly
	 * on the anchor.
	 */
	#brachiate(motion: AnimalMotion, base: Float64Array) {
		const key = this.#dynamic;
		key.set(base);
		const model = this.model;
		const height = model.height;
		const arm = model.legLength * this.species.limbScale.front;
		const theta = Number.isFinite(motion.swing) ? motion.swing : 0;
		const tilt = Number.isFinite(motion.tilt) ? motion.tilt : 0;
		const side = motion.grip < 0 ? -1 : 1;
		const alpha = (-ANIMAL_LAYERS.hangUpright * Math.PI) / 2 - tilt;
		// Helpers taking and returning numbers are written out on this per-frame path.
		const grip = Math.PI - alpha - theta;
		const gripAngle = grip - TAU * Math.round(grip / TAU);
		if (side !== this.#gripSide) {
			// Hand switch: the old gripping arm lets go and eases back to rest.
			this.#releaseFrom = this.#gripAngle;
			this.#releaseElapsed = 0;
			this.#gripSide = side;
		}
		this.#gripAngle = gripAngle;
		this.#releaseElapsed += this.#dt;

		const gripSlot = side > 0 ? LIMB_FL : LIMB_FR;
		const freeSlot = side > 0 ? LIMB_FR : LIMB_FL;
		// The shoulder: the hip plus the posture's offset for this arm (model units).
		const g = gripSlot * JOINT_STRIDE;
		const shoulderX = side * model.hipX + key[g + 3] * height;
		const shoulderY = model.hipY + key[g + 4] * height;
		const shoulderZ = model.hipZFront + key[g + 5] * height;

		// Free arm: from rest toward the next handhold as the swing nears its apex.
		const shoulderUp = -arm * Math.cos(theta);
		const shoulderForward = arm * Math.sin(theta);
		const dUp = (motion.reachUp || 0) - shoulderUp;
		const dForward = (motion.reachForward || 0) - shoulderForward;
		const ca = Math.cos(alpha);
		const sa = Math.sin(alpha);
		const my = dUp * ca + dForward * sa;
		const mz = -dUp * sa + dForward * ca;
		const reachAngle = Math.atan2(-mz, -my);
		const rest = ANIMAL_LAYERS.freeArmRest - alpha;
		const toward = reachAngle - rest;
		const reach = Math.min(1, Math.max(0, motion.reach || 0));
		let free = rest + (toward - TAU * Math.round(toward / TAU)) * reach;
		if (this.#releaseElapsed < ANIMAL_LAYERS.releaseTime) {
			const t = Math.min(1, this.#releaseElapsed / ANIMAL_LAYERS.releaseTime);
			const back = free - this.#releaseFrom;
			free = this.#releaseFrom + (back - TAU * Math.round(back / TAU)) * t * t * (3 - 2 * t);
		}

		key[R] = alpha;
		key[gripSlot * JOINT_STRIDE] = gripAngle;
		key[freeSlot * JOINT_STRIDE] = free;
		// Legs dangle toward the ground, trailing the swing a little.
		const dangle = -alpha + ANIMAL_LAYERS.legTrail * (tilt - theta);
		key[LIMB_BL * JOINT_STRIDE] += dangle;
		key[LIMB_BR * JOINT_STRIDE] += dangle;

		const pivot = this.#dynamicPivot;
		pivot[0] = shoulderX / height;
		pivot[1] = (shoulderY - arm * Math.cos(gripAngle)) / height;
		pivot[2] = (shoulderZ - arm * Math.sin(gripAngle)) / height;
		const anchor = this.#dynamicAnchor;
		anchor[0] = 0;
		anchor[1] = (motion.snapUp || 0) / height;
		anchor[2] = (motion.snapForward || 0) / height;
	}
}

/** Every posture an animator's species can take, for tests and debug panels. */
export const availablePostures = (animator: AnimalAnimator) =>
	POSTURES.filter((_, i) => animator.postures.keys[i] !== null);
