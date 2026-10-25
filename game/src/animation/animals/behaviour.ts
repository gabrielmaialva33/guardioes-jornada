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
 * Subclasses read the substep from `this.clock.h` instead of taking it as an
 * argument: a fractional number passed to a call V8 does not inline is boxed
 * (p3-animation.md, V8 rule 1).
 */
import { AnimalMotion, type AnimalWorld } from './motion.ts';
import { MAX_DT, Rng, safeDt, TAU } from './scalar.ts';
import { SPECIES, type SpeciesId, type SpeciesParams } from './species.ts';

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

/**
 * The base class's per-frame numbers live in these two small classes rather than
 * on the behaviour itself. Base methods (step, turn, ramp) run for six behaviour
 * classes, so `this.h` there would be a megamorphic access, and V8 boxes every
 * number loaded or stored through a megamorphic access (16 B each, measured).
 * `this.clock.h` is one megamorphic load of an object, then a monomorphic one.
 */
export class BehaviourClock {
	/** The whole step's dt, seconds, for sense() and finish(). */
	dt = 0;
	/** The current substep, seconds. */
	h = 0;
	/** Seconds since the state was entered. */
	inState = 0;
	/** Seconds until the next scheduled decision. */
	timer = 0;
	/** Total time stepped, seconds. */
	total = 0;
}

/** Turning and speed ramps along a route (see Behaviour.turn and Behaviour.ramp). */
export class BehaviourDrive {
	/** Yaw the body turns toward at the species' turn rate. */
	targetYaw = 0;
	/** Radius the feet travel on when the body turns on the spot, u (about the hip spread). */
	footRadius = 0;
	/** Travel speed (u/s), the speed it ramps toward and the ramp (u/s²). */
	speed = 0;
	cruise = 0;
	rampRate = 1;
	/** Distance covered in the last ramp() substep, u. */
	travel = 0;
}

export abstract class Behaviour<S extends string = string> {
	readonly species: SpeciesParams;
	readonly motion = new AnimalMotion();
	readonly clock = new BehaviourClock();
	protected readonly drive = new BehaviourDrive();
	/** Every state this species can be in. */
	abstract readonly states: readonly S[];
	state: S;
	/** Decisions only: drawn at exact event times, so replays match at any frame rate. */
	readonly rng: Rng;
	/**
	 * Cosmetic draws (glances) tick at substep granularity; a separate stream keeps
	 * them from shifting the decisions' sequence when the frame rate changes.
	 */
	readonly cosmetic: Rng;
	/** Copied from the world at each step; behaviours drop decorative extras with it. */
	reducedMotion = false;
	readonly #seed: number;

	constructor(species: SpeciesId, initial: S, options: BehaviourOptions = {}) {
		this.species = SPECIES[species];
		this.state = initial;
		this.drive.footRadius = this.species.size * 0.3;
		this.#seed = options.seed ?? 0x5eed;
		this.rng = new Rng(this.#seed);
		this.cosmetic = new Rng(this.#seed ^ 0x9e3779b9);
	}

	/** Seconds since the state was entered (debug and tests). */
	get stateTime(): number {
		return this.clock.inState;
	}

	/** Seconds until the next scheduled decision (debug and tests). */
	get timer(): number {
		return this.clock.timer;
	}

	/** Advances by `dt` seconds of world time. */
	step(rawDt: number, world: AnimalWorld) {
		this.clock.dt = safeDt(rawDt);
		this.#run(world);
	}

	/** The same, reading dt from an object field (no boxed argument on the per-frame path). */
	stepFrom(time: TimeSource, world: AnimalWorld) {
		this.clock.dt = safeDt(time.dt);
		this.#run(world);
	}

	#run(world: AnimalWorld) {
		this.reducedMotion = world.reducedMotion;
		const motion = this.motion;
		const clock = this.clock;
		const strides = this.species.stride;
		motion.beginUpdate();
		motion.cycles = 0;
		this.sense(world);
		let left = Math.min(clock.dt, MAX_DT);
		for (let guard = 0; left > 1e-9 && guard < 64; guard++) {
			let h = Math.min(left, MAX_SUBSTEP);
			if (clock.timer > 1e-9 && clock.timer < h) h = clock.timer;
			clock.h = h;
			const distance = motion.distance;
			const speed = motion.speed;
			this.advance(world);
			// Gait cycles at this substep's mean speed: the phase then does not depend
			// on how the frame was cut (one LOD update or three frames). This is
			// strideAt written out (see turn()).
			const covered = motion.distance - distance;
			if (covered > 0) {
				const mean = 0.5 * (speed + motion.speed);
				const t = (mean - strides.slowSpeed) / (strides.fastSpeed - strides.slowSpeed);
				const share = Math.min(1, Math.max(0, t));
				motion.cycles += covered / (strides.slowStride + (strides.fastStride - strides.slowStride) * share);
			}
			clock.inState += h;
			clock.timer -= h;
			clock.total += h;
			left -= h;
			if (clock.timer <= 1e-9) this.decide(world);
		}
		this.finish(world);
	}

	/** Restarts the state machine and the random stream (respawn, teleport). */
	reset() {
		this.rng.reset(this.#seed);
		this.cosmetic.reset(this.#seed ^ 0x9e3779b9);
		this.clock.inState = this.clock.timer = this.clock.total = 0;
	}

	/** Called once per step before the substeps: read per-frame events here. */
	protected sense(_world: AnimalWorld) {}

	/** Integrates one substep of `this.clock.h` seconds in the current state. */
	protected abstract advance(world: AnimalWorld): void;

	/** Called when the timer runs out: pick the next state with `enter`. */
	protected abstract decide(world: AnimalWorld): void;

	/** Called once per step after the substeps: final motion fields. */
	protected finish(_world: AnimalWorld) {}

	/** Switches state and schedules the next decision `duration` seconds from now. */
	protected enter(state: S, duration: number) {
		this.state = state;
		this.clock.inState = 0;
		this.clock.timer = Number.isFinite(duration) ? Math.max(duration, 1e-3) : 1e-3;
	}

	/**
	 * Ramps drive.speed toward drive.cruise at drive.rampRate over this substep
	 * and sets drive.travel, the exact distance covered, splitting the substep
	 * where the ramp reaches the cruise speed (a plain trapezoid would overshoot
	 * by a different amount at each substep size, and the gait would drift
	 * between frame rates).
	 */
	protected ramp() {
		const drive = this.drive;
		const h = this.clock.h;
		const before = drive.speed;
		const target = drive.cruise;
		const gap = target - before;
		const reach = Math.abs(gap) / drive.rampRate;
		if (reach >= h) {
			drive.speed = before + Math.sign(gap) * drive.rampRate * h;
			drive.travel = 0.5 * (before + drive.speed) * h;
		} else {
			drive.speed = target;
			drive.travel = 0.5 * (before + target) * reach + target * (h - reach);
		}
		this.motion.accel = h > 0 ? (drive.speed - before) / h : 0;
	}

	/**
	 * Turns the placement yaw toward drive.targetYaw at the species' turn rate
	 * during this substep and adds the foot travel the turn needs to
	 * motion.distance: an animal turning on the spot steps, so its gait moves.
	 */
	protected turn() {
		// approachAngle written out: helpers that take and return numbers box them
		// whenever V8 does not inline the call (p3-animation.md, V8 rule 1).
		const motion = this.motion;
		const drive = this.drive;
		const h = this.clock.h;
		const before = motion.yaw;
		let delta = drive.targetYaw - before;
		delta -= TAU * Math.round(delta / TAU);
		const most = this.species.turnRate * h;
		const turned = Math.min(most, Math.max(-most, Number.isFinite(delta) ? delta : 0));
		let yaw = before + turned;
		yaw -= TAU * Math.round(yaw / TAU);
		motion.yaw = yaw;
		motion.turnRate = h > 0 ? turned / h : 0;
		motion.distance += Math.abs(turned) * drive.footRadius;
	}
}
