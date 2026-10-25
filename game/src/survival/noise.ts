/**
 * Scalar helpers, value noise and fBm built from integer hashing and plain
 * arithmetic only (rules in random.ts). The noise is the POC's value noise
 * (terrain.ts) with a seed instead of a fixed lattice.
 */
import { mix32 } from './random.ts';

/** Rounds toward −∞ for |x| < 2³¹, without Math.floor. */
export function floor(x: number): number {
	const i = x | 0;
	return x < i ? i - 1 : i;
}

export const clamp = (value: number, min: number, max: number) =>
	value < min ? min : value > max ? max : value;

export function smoothstep(edge0: number, edge1: number, x: number): number {
	const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
	return t * t * (3 - 2 * t);
}

/** Lattice value in [0, 1). */
function lattice(i: number, j: number, seed: number): number {
	return mix32((Math.imul(i, 374761393) + Math.imul(j, 668265263) + seed) | 0) / 4294967296;
}

/** Value noise in [−1, 1], one lattice cell per unit. */
export function valueNoise(x: number, z: number, seed: number): number {
	const i = floor(x);
	const j = floor(z);
	const fx = x - i;
	const fz = z - j;
	const sx = fx * fx * (3 - 2 * fx);
	const sz = fz * fz * (3 - 2 * fz);
	const a = lattice(i, j, seed);
	const b = lattice(i + 1, j, seed);
	const c = lattice(i, j + 1, seed);
	const d = lattice(i + 1, j + 1, seed);
	return ((a + (b - a) * sx) * (1 - sz) + (c + (d - c) * sx) * sz) * 2 - 1;
}

/** Fractal sum of `octaves` value noises, normalized back to [−1, 1]. */
export function fbm(x: number, z: number, seed: number, octaves: number): number {
	let sum = 0;
	let amp = 1;
	let freq = 1;
	let norm = 0;
	for (let o = 0; o < octaves; o++) {
		sum += valueNoise(x * freq, z * freq, seed + o) * amp;
		norm += amp;
		amp *= 0.5;
		// Not exactly 2, so the octaves' lattices never line up.
		freq *= 2.03;
	}
	return sum / norm;
}
