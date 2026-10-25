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
import { SPECIES, type SpeciesId, type SpeciesParams } from './species.ts';

/** Longest substep, seconds. */
export const MAX_SUBSTEP = 1 / 30;

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
	readonly rng: Rng;
	/** Copied from the world at each step; behaviours drop decorative extras with it. */
	reducedMotion = false;
	/** The current substep, seconds (see the module comment). */
	protected h = 0;
	/** Yaw the body turns toward at the species' turn rate. */
	protected targetYaw = 0;
	/** Radius the feet travel on when the body turns on the spot, u (about the hip spread). */
	protected footRadius = 0;
	readonly #seed: number;

	constructor(species: SpeciesId, initial: S, options: BehaviourOptions = {}) {
		this.species = SPECIES[species];
		this.state = initial;
		this.footRadius = this.species.size * 0.3;
		this.#seed = options.seed ?? 0x5eed;
		this.rng = new Rng(this.#seed);
	}

	/** Advances by `dt` seconds of world time. */
	step(rawDt: number, world: AnimalWorld) {
		const dt = safeDt(rawDt);
		this.reducedMotion = world.reducedMotion;
		this.motion.beginUpdate();
		this.sense(world);
		let left = Math.min(dt, MAX_DT);
		for (let guard = 0; left > 1e-9 && guard < 64; guard++) {
			let h = left < MAX_SUBSTEP ? left : MAX_SUBSTEP;
			if (this.timer > 1e-9 && this.timer < h) h = this.timer;
			this.h = h;
			this.advance(world);
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
		this.timer = duration > 1e-3 ? duration : 1e-3;
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
