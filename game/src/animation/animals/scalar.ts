/**
 * Small scalar helpers and a seeded random generator for the animal module.
 * Hot-path code calls these with values it already holds; V8 inlines them, so
 * they add no allocation (see p3-animation.md, "Two V8 rules").
 */

export const DEG = Math.PI / 180;
export const TAU = Math.PI * 2;

/** Longest update the module integrates; longer frames (a hitch, a resumed tab) are clamped. */
export const MAX_DT = 0.25;

export const finite = (value: number) => (Number.isFinite(value) ? value : 0);

/** A frame time made safe: NaN, negative and infinite become 0, long frames are clamped. */
export const safeDt = (dt: number) => (dt > 0 ? Math.min(dt, MAX_DT) : 0);

export const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

export const wrap01 = (value: number) => value - Math.floor(value);

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export const smoothstep = (t: number) => {
	const x = clamp01(t);
	return x * x * (3 - 2 * x);
};

/** easeInOutSine, the pose-to-pose easing animacoes.md §5.1 asks for (sloth limbs). */
export const easeInOutSine = (t: number) => 0.5 - 0.5 * Math.cos(Math.PI * clamp01(t));

/** Wraps an angle to (-π, π]. */
export function wrapAngle(angle: number): number {
	const wrapped = (((angle + Math.PI) % TAU) + TAU) % TAU;
	return wrapped === 0 ? Math.PI : wrapped - Math.PI;
}

/** Moves `from` toward `to` by at most `step`. */
export const approach = (from: number, to: number, step: number) =>
	from < to ? Math.min(to, from + step) : Math.max(to, from - step);

/** Turns `from` toward `to` along the shorter arc by at most `step` radians. */
export const approachAngle = (from: number, to: number, step: number) => {
	const delta = wrapAngle(to - from);
	return wrapAngle(from + clamp(delta, -step, step));
};

/**
 * Seeded mulberry32. The state lives in a Uint32Array: a uint32 above 2^30 stored
 * in a plain field would be a heap number, and every store would allocate.
 * Behaviours draw from it only when they decide, never per frame, so a replay
 * with the same seed is the same at any frame rate.
 */
export class Rng {
	readonly #state = new Uint32Array(1);

	constructor(seed = 0x5eed) {
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

	/** True with probability p. */
	chance(p: number): boolean {
		return this.next() < p;
	}
}
