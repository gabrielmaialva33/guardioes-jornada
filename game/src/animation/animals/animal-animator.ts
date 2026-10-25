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
	LIMB_FL,
	LIMB_FR,
	MODELS,
	type ModelMeasures,
	ROOT,
	TAIL
} from './rigs.ts';
import { SPECIES, type GaitParams, type SpeciesId, type SpeciesParams } from './species.ts';
import { clamp, clamp01, DEG, safeDt, smoothstep, TAU, wrap01, wrapAngle } from './scalar.ts';

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
	/** Relaxed angle of a free brachiating arm, radians (down along the body, a little forward). */
	freeArmRest: 60 * DEG,
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
		const dt = safeDt(rawDt);
		this.#dt = dt;
		this.time += dt;
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
		const speed = motion.speed > 0 ? motion.speed : 0;
		const moving = speed > ANIMAL_LAYERS.moveThreshold && this.#target === STAND;
		const fade = this.reducedMotion ? REDUCED_MOTION_DURATION : DURATION.state;
		const step = this.#dt / fade;
		this.gaitWeight = moving ? Math.min(1, this.gaitWeight + step) : Math.max(0, this.gaitWeight - step);
		this.runWeight =
			species.run === null ? 0 : smoothstep((speed - species.runFrom) / (species.runTo - species.runFrom));

		const { slowSpeed, slowStride, fastSpeed, fastStride } = species.stride;
		const t = clamp01((speed - slowSpeed) / (fastSpeed - slowSpeed));
		const stride = slowStride + (fastStride - slowStride) * t;
		this.stride = stride;
		this.cadence = speed / stride;
		const distance = motion.distance > 0 && Number.isFinite(motion.distance) ? motion.distance : 0;
		if (distance === 0) return;
		const before = this.phase;
		const advance = distance / stride;
		this.phase = wrap01(before + advance);
		if (this.gaitWeight < 0.5) return;
		// Footfalls crossed during this update (the last one wins), for dust and sounds.
		const gait = this.runWeight > 0.5 && species.run !== null ? species.run : species.walk;
		if (advance >= 1) {
			this.footfall = LIMB_FL;
			return;
		}
		for (let leg = 0; leg < 4; leg++) {
			const td = gait.touchdown[leg];
			if (wrap01(before - td) > wrap01(before + advance - td)) this.footfall = LIMB_FL + leg;
		}
	}

	#gaitLayer(out: Float64Array) {
		const species = this.species;
		const base = this.gaitWeight * this.weights[STAND];
		this.#arc = 0;
		if (!(base > 0) || species.walk === null) return;
		const run = this.runWeight;
		this.#addGait(out, species.walk, base * (1 - run));
		if (species.run !== null && run > 0) this.#addGait(out, species.run, base * run);
	}

	#addGait(out: Float64Array, gait: GaitParams, weight: number) {
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
			const u = wrap01(phase - gait.touchdown[leg]);
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
			const speedShare = clamp01(this.cadence * this.stride * 0.1);
			this.#arc += ((gait.arc * Math.sin(Math.PI * t)) / height) * weight * speedShare * decorative;
		}
	}

	/** Hanging sloth: each leg points at its own anchor on the branch; a moving limb unhooks. */
	#limbLayer(motion: AnimalMotion, out: Float64Array) {
		const weight = this.weights[HANG_UNDER] + this.weights[HANG_CURL];
		if (!(weight > 0)) return;
		const model = this.model;
		const height = model.height;
		const lifts = motion.limbLift;
		const reaches = motion.limbReach;
		for (let leg = 0; leg < 4; leg++) {
			const length = model.legLength * (leg < 2 ? this.species.limbScale.front : this.species.limbScale.hind);
			const ratio = clamp(reaches[leg] / length, -0.9, 0.9);
			const angle = -Math.asin(ratio);
			const lift = clamp01(lifts[leg]);
			const at = (LIMB_FL + leg) * JOINT_STRIDE;
			const side = leg % 2 === 0 ? 1 : -1;
			out[at] += angle * weight;
			out[at + 2] += side * lift * ANIMAL_LAYERS.limbLiftRoll * weight;
			// Keep the foot on the branch as the leg tilts, then unhook it toward the body.
			const drop = length * (1 - Math.cos(angle));
			out[at + 4] += ((-drop + lift * ANIMAL_LAYERS.limbLift) / height) * weight;
		}
	}

	#wingLayer(motion: AnimalMotion, out: Float64Array) {
		if (!this.#bird) return;
		const rate = motion.flapRate > 0 && Number.isFinite(motion.flapRate) ? motion.flapRate : 0;
		this.wingPhase = wrap01(this.wingPhase + rate * this.#dt);
		const weight = this.weights[FLY];
		if (!(weight > 0)) return;
		const flap = clamp01(motion.flap);
		const closed = clamp01(motion.wingsClosed);
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
		this.#eatPhase = wrap01(this.#eatPhase + layers.eatRate * this.#dt);
		this.#howlPhase = wrap01(this.#howlPhase + layers.howlRate * this.#dt);
		const eat = clamp01(motion.eat) * (this.weights[FEED_HANG] + this.weights[HANG_TAIL] + this.weights[SIT]);
		if (eat > 0 && !this.#bird) {
			const swing = layers.eatSwing * eat;
			out[LIMB_FL * JOINT_STRIDE] -= swing * (0.5 + 0.5 * Math.sin(TAU * this.#eatPhase));
			out[LIMB_FR * JOINT_STRIDE] -= swing * (0.5 - 0.5 * Math.sin(TAU * this.#eatPhase));
		}
		const howl = clamp01(motion.howl) * this.weights[HOWL];
		// Each breath group of the roar pumps the head; the posture itself stays with reduced motion.
		if (howl > 0 && !this.reducedMotion)
			out[B] -= layers.howlPump * howl * (0.5 + 0.5 * Math.sin(TAU * this.#howlPhase));
	}

	#crouchLayer(motion: AnimalMotion, out: Float64Array) {
		const crouch = this.reducedMotion ? 0 : clamp01(motion.crouch);
		if (!(crouch > 0)) return;
		out[B + 4] -= (ANIMAL_LAYERS.crouchDepth * crouch) / this.model.height;
		out[B] += ANIMAL_LAYERS.crouchPitch * crouch;
	}

	#lookLayer(motion: AnimalMotion, out: Float64Array) {
		const species = this.species;
		const share = this.reducedMotion ? 0.5 : 1;
		const yawTarget = clamp(wrapAngle(motion.lookYaw || 0), -species.lookYaw, species.lookYaw) * share;
		const pitchTarget = clamp(motion.lookPitch || 0, -species.lookPitch, species.lookPitch) * share;
		const yaw = this.lookYaw.step(yawTarget, this.#dt);
		const pitch = this.lookPitch.step(pitchTarget, this.#dt);
		const at = this.hasHead ? H : B;
		const gain = this.hasHead ? 1 : species.bodyLook;
		out[at + 1] += yaw * gain;
		out[at] -= pitch * gain;
		out[at + 2] -= yaw * gain * species.headTilt;
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
			yawTarget = clamp(-(motion.turnRate || 0) * species.tailTurn, -0.5, 0.5) + sway;
			pitchTarget = clamp(-(motion.accel || 0) * species.tailAccel, -0.4, 0.4);
		}
		out[T + 1] += this.tailYaw.step(yawTarget, this.#dt);
		out[T] += this.tailPitch.step(pitchTarget, this.#dt);
	}

	#leanLayer(motion: AnimalMotion, out: Float64Array) {
		const layers = ANIMAL_LAYERS;
		const ground = this.weights[STAND];
		let lean = 0;
		let bank = 0;
		if (!this.reducedMotion) {
			lean = clamp((motion.accel || 0) * layers.leanGain, -layers.maxLean, layers.maxLean) * ground;
			bank =
				clamp(
					(motion.turnRate || 0) * (motion.speed || 0) * layers.bankGain,
					-layers.maxBank,
					layers.maxBank
				) * ground;
		}
		out[B] += this.lean.step(lean, this.#dt);
		out[B + 2] += this.bank.step(bank, this.#dt);
		// Flight attitude: the path pitch is essential (the bird points where it goes), the bank decorative.
		const flight = this.weights[FLY];
		if (flight > 0) {
			out[R] += clamp(motion.pitch || 0, -0.8, 0.8) * flight;
			if (!this.reducedMotion) out[R + 2] += clamp(motion.bank || 0, -0.6, 0.6) * flight;
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
		const value = clamp(this.squash.step(0, this.#dt), -limit, limit);
		pose.scaleY = 1 + value;
		pose.scaleXZ = 1 / Math.sqrt(1 + value);
	}

	/**
	 * The brachiation key, rebuilt from the pendulum each update (muriqui). In the
	 * swing plane (model y-z): the shoulder hangs `arm` from the gripping hand at
	 * angle θ; the trunk is pitched upright and tilted by φ; the gripping arm
	 * points from the shoulder back to the hand: β = −π/2 + φ − θ; the free arm
	 * reaches for the next handhold. The pivot is the gripping hand's tip, so the
	 * root offset puts that hand exactly on the anchor.
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
		const alpha = -Math.PI / 2 - tilt;
		const gripAngle = -Math.PI / 2 + tilt - theta;
		if (side !== this.#gripSide) {
			// Hand switch: the old gripping arm lets go and eases back to rest.
			this.#releaseFrom = this.#gripAngle;
			this.#releaseElapsed = 0;
			this.#gripSide = side;
		}
		this.#gripAngle = gripAngle;
		this.#releaseElapsed += this.#dt;

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
		const rest = ANIMAL_LAYERS.freeArmRest;
		let free = rest + wrapAngle(reachAngle - rest) * clamp01(motion.reach);
		if (this.#releaseElapsed < ANIMAL_LAYERS.releaseTime) {
			const s = smoothstep(this.#releaseElapsed / ANIMAL_LAYERS.releaseTime);
			free = this.#releaseFrom + wrapAngle(free - this.#releaseFrom) * s;
		}

		const gripSlot = side > 0 ? LIMB_FL : LIMB_FR;
		const freeSlot = side > 0 ? LIMB_FR : LIMB_FL;
		key[R] = alpha;
		key[gripSlot * JOINT_STRIDE] = gripAngle;
		key[freeSlot * JOINT_STRIDE] = free;

		const pivot = this.#dynamicPivot;
		pivot[0] = (side * model.hipX) / height;
		pivot[1] = (model.hipY - arm * Math.cos(gripAngle)) / height;
		pivot[2] = (model.hipZFront - arm * Math.sin(gripAngle)) / height;
		const anchor = this.#dynamicAnchor;
		anchor[0] = 0;
		anchor[1] = (motion.snapUp || 0) / height;
		anchor[2] = (motion.snapForward || 0) / height;
	}
}

/** Every posture an animator's species can take, for tests and debug panels. */
export const availablePostures = (animator: AnimalAnimator) =>
	POSTURES.filter((_, i) => animator.postures.keys[i] !== null);
