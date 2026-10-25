/**
 * Base of the species behaviours: a small state machine that moves the animal
 * in the world and fills an AnimalMotion for the animator.
 *
 * Time is consumed in substeps of at most 1/30 s, and a substep never crosses a
 * scheduled decision: when the state's timer runs out mid-frame, the rest of
 * the frame runs in the next state. Decisions draw from a seeded generator, and
 * only when they happen. So one 0.1 s update and six 1/60 s updates end in the
 * same state with the same draws, which is what lets the LOD skip frames
 * (lod.ts) without changing what the animal does.
 *
 * Subclasses keep the substep in `this.h` and read it from there: a fractional
 * number passed as an argument to a call V8 does not inline is boxed
 * (p3-animation.md, V8 rule 1).
 */
import { AnimalMotion, type AnimalWorld } from './motion.ts';
import { approachAngle, MAX_DT, Rng, safeDt, wrapAngle } from './scalar.ts';
import { SPECIES, type SpeciesId, type SpeciesParams, strideAt } from './species.ts';

/** Longest substep, seconds. */
export const MAX_SUBSTEP = 1 / 30;

/** Anything carrying a frame time in a number field (AnimationLod, a StepTime). */
export interface TimeSource {
	readonly dt: number;
}

export interface BehaviourOptions {
	/** Seeds the decisions, for replays and tests. */
	seed?: number;
}

export abstract class Behaviour<S extends string = string> {
	readonly species: SpeciesParams;
	readonly motion = new AnimalMotion();
	/** Every state this species can be in. */
	abstract readonly states: readonly S[];
	state: S;
	/** Seconds since the state was entered. */
	stateTime = 0;
	/** Seconds until the next scheduled decision. */
	timer = 0;
	/** Total time stepped, seconds. */
	clock = 0;
	/** Decisions only: drawn at exact event times, so replays match at any frame rate. */
	readonly rng: Rng;
	/**
	 * Cosmetic draws (glances) tick at substep granularity; a separate stream keeps
	 * them from shifting the decisions' sequence when the frame rate changes.
	 */
	readonly cosmetic: Rng;
	/** Copied from the world at each step; behaviours drop decorative extras with it. */
	reducedMotion = false;
	/** The current substep, seconds (see the module comment). */
	protected h = 0;
	/** The whole step's dt, seconds, for sense() and finish(). */
	protected frameDt = 0;
	/** Yaw the body turns toward at the species' turn rate. */
	protected targetYaw = 0;
	/** Radius the feet travel on when the body turns on the spot, u (about the hip spread). */
	protected footRadius = 0;
	/** Travel speed along the route (u/s), the speed it ramps toward and the ramp (u/s²); see ramp(). */
	protected speed = 0;
	protected cruise = 0;
	protected rampRate = 1;
	/** Distance covered in the last ramp() substep, u. */
	protected travel = 0;
	readonly #seed: number;

	constructor(species: SpeciesId, initial: S, options: BehaviourOptions = {}) {
		this.species = SPECIES[species];
		this.state = initial;
		this.footRadius = this.species.size * 0.3;
		this.#seed = options.seed ?? 0x5eed;
		this.rng = new Rng(this.#seed);
		this.cosmetic = new Rng(this.#seed ^ 0x9e3779b9);
	}

	/** Advances by `dt` seconds of world time. */
	step(rawDt: number, world: AnimalWorld) {
		this.frameDt = safeDt(rawDt);
		this.#run(world);
	}

	/** The same, reading dt from an object field (no boxed argument on the per-frame path). */
	stepFrom(time: TimeSource, world: AnimalWorld) {
		this.frameDt = safeDt(time.dt);
		this.#run(world);
	}

	#run(world: AnimalWorld) {
		this.reducedMotion = world.reducedMotion;
		const motion = this.motion;
		motion.beginUpdate();
		motion.cycles = 0;
		this.sense(world);
		let left = Math.min(this.frameDt, MAX_DT);
		for (let guard = 0; left > 1e-9 && guard < 64; guard++) {
			let h = Math.min(left, MAX_SUBSTEP);
			if (this.timer > 1e-9 && this.timer < h) h = this.timer;
			this.h = h;
			const distance = motion.distance;
			const speed = motion.speed;
			this.advance(world);
			// Gait cycles at this substep's mean speed: the phase then does not depend
			// on how the frame was cut (one LOD update or three frames).
			const covered = motion.distance - distance;
			if (covered > 0) motion.cycles += covered / strideAt(this.species, 0.5 * (speed + motion.speed));
			this.stateTime += h;
			this.timer -= h;
			this.clock += h;
			left -= h;
			if (this.timer <= 1e-9) this.decide(world);
		}
		this.finish(world);
	}

	/** Restarts the state machine and the random stream (respawn, teleport). */
	reset() {
		this.rng.reset(this.#seed);
		this.cosmetic.reset(this.#seed ^ 0x9e3779b9);
		this.stateTime = this.timer = this.clock = 0;
	}

	/** Called once per step before the substeps: read per-frame events here. */
	protected sense(_world: AnimalWorld) {}

	/** Integrates one substep of `this.h` seconds in the current state. */
	protected abstract advance(world: AnimalWorld): void;

	/** Called when the timer runs out: pick the next state with `enter`. */
	protected abstract decide(world: AnimalWorld): void;

	/** Called once per step after the substeps: final motion fields. */
	protected finish(_world: AnimalWorld) {}

	/** Switches state and schedules the next decision `duration` seconds from now. */
	protected enter(state: S, duration: number) {
		this.state = state;
		this.stateTime = 0;
		this.timer = Number.isFinite(duration) ? Math.max(duration, 1e-3) : 1e-3;
	}

	/**
	 * Ramps `speed` toward `cruise` at `rampRate` over this substep and sets
	 * `travel`, the exact distance covered, splitting the substep where the ramp
	 * reaches the cruise speed (a plain trapezoid would overshoot by a different
	 * amount at each substep size, and the gait would drift between frame rates).
	 */
	protected ramp() {
		const h = this.h;
		const before = this.speed;
		const target = this.cruise;
		const gap = target - before;
		const reach = Math.abs(gap) / this.rampRate;
		if (reach >= h) {
			this.speed = before + Math.sign(gap) * this.rampRate * h;
			this.travel = 0.5 * (before + this.speed) * h;
		} else {
			this.speed = target;
			this.travel = 0.5 * (before + target) * reach + target * (h - reach);
		}
		this.motion.accel = h > 0 ? (this.speed - before) / h : 0;
	}

	/**
	 * Turns the placement yaw toward targetYaw at the species' turn rate during
	 * this substep and adds the foot travel the turn needs to motion.distance:
	 * an animal turning on the spot steps, so its gait moves with it.
	 */
	protected turn() {
		const motion = this.motion;
		const before = motion.yaw;
		motion.yaw = approachAngle(before, this.targetYaw, this.species.turnRate * this.h);
		const turned = wrapAngle(motion.yaw - before);
		motion.turnRate = this.h > 0 ? turned / this.h : 0;
		motion.distance += Math.abs(turned) * this.footRadius;
	}
}
