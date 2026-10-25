/**
 * Fixed-step clock ("Fix Your Timestep!", Fiedler 2004). The simulation always
 * advances in 1/PHYSICS_HZ ticks, so the jump feels the same at 30, 60 or 120 Hz.
 * At most MAX_STEPS_PER_FRAME ticks run per frame and the excess is dropped, so
 * a 200 ms hitch or a tab resumed after 30 s never replays seconds of physics.
 *
 * This is the engine's only clock: the character's collision substeps are
 * spatial (anti-tunnelling) and never catch up on time.
 */
import { MAX_STEPS_PER_FRAME, PHYSICS_HZ } from './constants.ts';

/** Absorbs float error so 60 frames of 1/60 s run exactly 60 ticks. */
const EPSILON = 1e-7;

export class FixedTimestep {
	readonly dt: number;
	readonly maxSteps: number;
	/** How far the frame is between the previous and the current tick, in [0, 1]. */
	alpha = 0;
	/** Ticks run since creation. */
	ticks = 0;
	/** Simulated seconds dropped because a frame needed more than maxSteps ticks. */
	dropped = 0;
	#accumulator = 0;
	#skipNext = false;

	constructor(hz = PHYSICS_HZ, maxSteps = MAX_STEPS_PER_FRAME) {
		this.dt = 1 / hz;
		this.maxSteps = maxSteps;
	}

	/**
	 * Adds a frame's duration and runs the ticks it owes, oldest first.
	 * Returns how many ticks ran.
	 */
	advance(frameSeconds: number, step: (dt: number) => void): number {
		if (this.#skipNext) this.#skipNext = false;
		else if (Number.isFinite(frameSeconds) && frameSeconds > 0) this.#accumulator += frameSeconds;
		let steps = 0;
		while (this.#accumulator + EPSILON >= this.dt && steps < this.maxSteps) {
			step(this.dt);
			this.#accumulator -= this.dt;
			steps++;
		}
		if (this.#accumulator + EPSILON >= this.dt) {
			const kept = this.#accumulator % this.dt;
			this.dropped += this.#accumulator - kept;
			this.#accumulator = kept;
		}
		if (this.#accumulator < 0) this.#accumulator = 0;
		this.ticks += steps;
		this.alpha = Math.min(1, this.#accumulator / this.dt);
		return steps;
	}

	/**
	 * Forgets pending time and ignores the next frame's duration, which still
	 * spans the pause. Call when the page becomes visible again, a modal closes
	 * or the game resumes.
	 */
	reset() {
		this.#accumulator = 0;
		this.alpha = 0;
		this.#skipNext = true;
	}
}
