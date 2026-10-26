/**
 * Seeded mulberry32 for the living-world layer: spawn points, branch angles,
 * particle draws and the howl chorus clock. No Math.random anywhere in life/,
 * so a fixed seed replays the same world (golden frames, tests).
 *
 * The state lives in a Uint32Array: a uint32 above 2^30 kept in a plain field
 * would be a heap number, and every store would allocate.
 */
export class LifeRng {
	readonly #state = new Uint32Array(1);

	constructor(seed = 0x11fe) {
		this.reset(seed);
	}

	reset(seed: number) {
		this.#state[0] = seed >>> 0 || 0x9e3779b9;
	}

	/** Uniform in [0, 1). */
	next(): number {
		const state = this.#state;
		state[0] = (state[0] + 0x6d2b79f5) >>> 0;
		let t = state[0];
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	}

	/** Uniform in [min, max). */
	range(min: number, max: number): number {
		return min + (max - min) * this.next();
	}

	/** Integer in [0, n). */
	int(n: number): number {
		return Math.min(n - 1, Math.floor(this.next() * n));
	}
}

/** A sub-seed for one consumer, so adding a consumer never shifts another's sequence. */
export function subSeed(seed: number, salt: number): number {
	let h = (seed ^ Math.imul(salt + 0x9e3779b9, 0x85ebca6b)) >>> 0;
	h = Math.imul(h ^ (h >>> 16), 0x7feb352d) >>> 0;
	h = Math.imul(h ^ (h >>> 15), 0x846ca68b) >>> 0;
	return (h ^ (h >>> 16)) >>> 0;
}
