/**
 * Seeded randomness and hashing for the survival generator.
 *
 * Determinism rules for every generator file under survival/ (enforced by
 * determinism.test.ts), so a seed plus GENERATOR_VERSION always rebuilds the
 * same map, in any browser and after any browser update:
 * - only +, −, ×, ÷, %, comparisons, bit operations, Math.imul, Math.sqrt,
 *   Math.abs, Math.min and Math.max. ECMA-262 defines these exactly (sqrt is
 *   correctly rounded), while Math.sin, cos, tan, exp, log, pow (and **),
 *   atan2 and hypot are "implementation-approximated" and were measured to
 *   differ in the last bit between Node 26, Chromium 151 and Firefox 157
 *   (sobrevivencia-procedural.md §3.6). Math.floor is exact by the spec too,
 *   but the research did not measure it, so noise.ts rounds with `| 0`;
 * - no Math.random, clock or locale inside generation: every random number
 *   comes from a seed, and seedOfTheDay only reads UTC date parts;
 * - each layer draws from its own subSeed(seed, k), so changing one layer
 *   never reshuffles the others;
 * - sorts always have a total order (ties broken by index).
 */

/** The murmur3 finalizer: avalanches 32 bits, returns an unsigned integer. */
export function mix32(value: number): number {
	let h = value | 0;
	h ^= h >>> 16;
	h = Math.imul(h, 0x85ebca6b);
	h ^= h >>> 13;
	h = Math.imul(h, 0xc2b2ae35);
	return (h ^ (h >>> 16)) >>> 0;
}

/** Stream k of a seed, independent of the other streams. */
export function subSeed(seed: number, k: number): number {
	return mix32(Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(k + 1, 0xc2b2ae35));
}

/** 32-bit FNV-1a of a string's UTF-16 code units. */
export function fnv1a(text: string): number {
	let h = 0x811c9dc5;
	for (let k = 0; k < text.length; k++) h = Math.imul(h ^ text.charCodeAt(k), 0x01000193);
	return h >>> 0;
}

/** mulberry32 (the POC's generator, physics.ts) with a few helpers. */
export class Rng {
	#state: number;

	constructor(seed: number) {
		this.#state = seed >>> 0;
	}

	/** Uniform in [0, 1). */
	next(): number {
		this.#state = (this.#state + 0x6d2b79f5) >>> 0;
		let t = this.#state;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	}

	range(min: number, max: number): number {
		return min + (max - min) * this.next();
	}

	/** Integer in [0, n), n < 2³¹. */
	int(n: number): number {
		return (this.next() * n) | 0;
	}

	/** Index drawn from relative weights (at least one positive). */
	weighted(weights: readonly number[]): number {
		let total = 0;
		for (const w of weights) total += w;
		let roll = this.next() * total;
		for (let k = 0; k < weights.length; k++) {
			roll -= weights[k];
			if (roll < 0) return k;
		}
		return weights.length - 1;
	}

	/**
	 * A uniformly random heading as a unit vector (cos, sin), from a point in
	 * the unit disk: no angle, so no trigonometry.
	 */
	heading(): [number, number] {
		for (;;) {
			const c = this.next() * 2 - 1;
			const s = this.next() * 2 - 1;
			const d2 = c * c + s * s;
			if (d2 > 0.01 && d2 <= 1) {
				const inv = 1 / Math.sqrt(d2);
				return [c * inv, s * inv];
			}
		}
	}
}

/** Brasília time is UTC−3 all year since 2019: pass it to make the day turn at local midnight. */
export const BRASILIA_UTC_OFFSET_MINUTES = -180;

/**
 * "YYYY-MM-DD" of the calendar day of `date` in UTC shifted by a fixed offset.
 * It reads UTC date parts only, so the device's time zone never matters.
 */
export function dayKey(date: Date, utcOffsetMinutes = 0): string {
	const shifted = new Date(date.getTime() + utcOffsetMinutes * 60_000);
	const pad = (n: number) => (n < 10 ? `0${n}` : `${n}`);
	return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`;
}

/**
 * The map of the day: the same seed for everyone on the same UTC day (or the
 * same day at a fixed offset), offline and without asking the device's zone.
 * A changed device clock only gives another map, which is harmless.
 */
export function seedOfTheDay(date: Date, utcOffsetMinutes = 0): number {
	return mix32(fnv1a(`trilha-secreta:${dayKey(date, utcOffsetMinutes)}`));
}
