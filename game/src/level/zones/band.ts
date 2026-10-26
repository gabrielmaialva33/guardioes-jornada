/**
 * Zone ↔ zone stitching (PARK.md §2, WORLD.md §3, f-mundo-infinito.md §4.5):
 * the F1 east band (world-gen's former stitch.ts), generalised to any sides of
 * a zone. The neighbour (`fixed`) keeps its heights; this zone's band blends
 * towards them, so the seam has no step anywhere.
 *
 * Per vertex within BAND of a seam:
 * 1. Target: the neighbour's edge profile at the nearest point, box-filtered
 *    (±8 u) away from the crossings, plus the edge's own detail fading out
 *    within 8 u of the seam, so cliffs and noise never leak in.
 * 2. Several sides blend by inverse squared distance, and the band's weight is
 *    the largest side weight, w = 1 − smoothstep(0, 40, distance): continuous
 *    everywhere, exact on each seam.
 * 3. Slope limit: every band vertex ends within 0.89 u of its four
 *    neighbours (1.25 u diagonally), by exact envelopes (see below). Seam
 *    vertices constrain it only inside a crossing; elsewhere the seam is a
 *    closed edge (a soft wall), and nobody walks across it.
 *
 * Deterministic and order-free: one pass over the whole zone grid.
 */
import { clamp } from '../../survival/noise.ts';
import { smooth } from '../../world-gen/math.ts';
import type { Seam } from './spec.ts';

/** Band width, box filter half width and edge-detail fade (the F1 recipe's). */
export const BAND = 40;
const BOX = 8;
const DETAIL_FADE = 8;
/** Step limits: just under WALK_SLOPE (0.9 per unit) and its diagonal 0.9 · √2. */
export const BAND_SLOPE = 0.89;
const BAND_SLOPE_DIAGONAL = 1.25;
/** Cap on the raster rounds of an envelope (each settles in a handful). */
const MAX_ROUNDS = 64;

const FIXED = 1;
const FREE = 2;
/** On a seam: fixed to the neighbour; a walking constraint only inside a crossing. */
const SEAM = 3;
const SEAM_CROSSING = 4;

/** One stitched side: a seam and the neighbour's heights along it, one per unit from `seam.from`. */
export interface BandSide {
	seam: Seam;
	profile: ArrayLike<number>;
}

export interface BandResult {
	/** 1 for vertices fixed to a neighbour's seam (later passes leave them alone). */
	seam: Uint8Array;
	/** Band vertices whose bounds conflict (fixed cliffs closer than the step limits allow), and the moves it took. */
	unresolved: number;
	updates: number;
	/** The first few unresolved vertices (world x, z), for diagnosis. */
	where: [number, number][];
}

const inCrossing = (seam: Seam, along: number) =>
	seam.crossings.some(([lo, hi]) => along >= lo && along <= hi);

/** The seam's profile, box-filtered except inside its crossings (kept exact so the crossing's floor carries on). */
function smoothProfile(side: BandSide): Float64Array {
	const { seam, profile } = side;
	const last = profile.length - 1;
	const out = new Float64Array(profile.length);
	for (let k = 0; k <= last; k++) {
		if (inCrossing(seam, seam.from + k)) {
			out[k] = profile[k];
			continue;
		}
		let sum = 0;
		for (let b = -BOX; b <= BOX; b++) sum += profile[clamp(k + b, 0, last)];
		out[k] = sum / (2 * BOX + 1);
	}
	return out;
}

/**
 * Stitches the zone grid `heights` (world vertex (x0 + i, z0 + j) at
 * j · (width + 1) + i, the zone's own skeleton on entry) to its neighbours,
 * in place.
 */
export function stitchBands(
	heights: Float64Array,
	x0: number,
	z0: number,
	width: number,
	depth: number,
	sides: readonly BandSide[]
): BandResult {
	const side = width + 1;
	const n = side * (depth + 1);
	const state = new Uint8Array(n).fill(FIXED);
	const seamMask = new Uint8Array(n);
	const smoothed = sides.map(smoothProfile);
	for (let j = 0; j <= depth; j++)
		for (let i = 0; i <= width; i++) {
			const q = j * side + i;
			const x = x0 + i;
			const z = z0 + j;
			let target = 0;
			let alphas = 0;
			let weight = 0;
			let pinned = false;
			for (let s = 0; s < sides.length && !pinned; s++) {
				const { seam, profile } = sides[s];
				const vertical = seam.side === 'west' || seam.side === 'east';
				const across = vertical ? x - seam.at : z - seam.at;
				const alongRaw = vertical ? z : x;
				const along = clamp(alongRaw, seam.from, seam.to);
				const over = alongRaw - along;
				const d = Math.sqrt(across * across + over * over);
				if (d >= BAND) continue;
				const k = along - seam.from;
				if (d === 0) {
					// On the seam: exactly the neighbour's height.
					heights[q] = profile[k];
					state[q] = inCrossing(seam, along) ? SEAM_CROSSING : SEAM;
					seamMask[q] = 1;
					pinned = true;
					break;
				}
				const w = 1 - smooth(0, BAND, d);
				const near = 1 - smooth(0, DETAIL_FADE, d);
				const t = smoothed[s][k] + (profile[k] - smoothed[s][k]) * near;
				const alpha = w / (d * d);
				target += alpha * t;
				alphas += alpha;
				if (w > weight) weight = w;
			}
			if (pinned || weight === 0) continue;
			heights[q] += (target / alphas - heights[q]) * weight;
			state[q] = FREE;
		}

	// Slope limit over the band. Constraint vertices (C: the ring past the band, w = 0, and the seam
	// inside crossings) bound every band vertex from below and above through the step limits (a
	// max-plus and a min-plus envelope); the band is clamped into those bounds, then lowered to its
	// largest surface within the step limits (a chamfer envelope). Exact, in a few raster passes, and
	// no constraint vertex ever moves.
	const constraint = (q: number) => state[q] === FIXED || state[q] === SEAM_CROSSING;
	const readable = (q: number) => state[q] !== SEAM;
	const back: [number, number, number][] = [
		[-1, -1, BAND_SLOPE_DIAGONAL],
		[0, -1, BAND_SLOPE],
		[1, -1, BAND_SLOPE_DIAGONAL],
		[-1, 0, BAND_SLOPE]
	];
	const ahead = back.map(([di, dj, w]) => [-di, -dj, w] as [number, number, number]);
	/** Raster passes forward and back until stable: values[v] = pick(values[v], values[n] ± w) over updatable v. */
	const envelope = (values: Float64Array, update: (q: number) => boolean, lower: boolean) => {
		let moves = 0;
		for (let round = 0; round < MAX_ROUNDS; round++) {
			let moved = 0;
			for (const [mask, forward] of [
				[back, true],
				[ahead, false]
			] as const)
				for (let k = 0; k < n; k++) {
					const q = forward ? k : n - 1 - k;
					if (!update(q)) continue;
					const i = q % side;
					const j = (q - i) / side;
					let v = values[q];
					for (const [di, dj, w] of mask) {
						const a = i + di;
						const b = j + dj;
						if (a < 0 || b < 0 || a > width || b > depth) continue;
						const o = b * side + a;
						if (!readable(o)) continue;
						const via = lower ? values[o] + w : values[o] - w;
						if (lower ? via < v : via > v) v = via;
					}
					if (v !== values[q]) {
						values[q] = v;
						moved++;
					}
				}
			moves += moved;
			if (moved === 0) break;
		}
		return moves;
	};
	const free = (q: number) => state[q] === FREE;
	const floorOf = new Float64Array(n).fill(Number.NEGATIVE_INFINITY);
	const ceilOf = new Float64Array(n).fill(Number.POSITIVE_INFINITY);
	for (let q = 0; q < n; q++)
		if (constraint(q)) {
			floorOf[q] = heights[q];
			ceilOf[q] = heights[q];
		}
	let updates = envelope(floorOf, free, false) + envelope(ceilOf, free, true);
	let unresolved = 0;
	const where: [number, number][] = [];
	for (let q = 0; q < n; q++) {
		if (!free(q)) continue;
		const lo = floorOf[q];
		const hi = ceilOf[q];
		if (lo <= hi) heights[q] = clamp(heights[q], lo, hi);
		else {
			heights[q] = (lo + hi) / 2;
			unresolved++;
			if (where.length < 12) where.push([x0 + (q % side), z0 + (q - (q % side)) / side]);
		}
	}
	updates += envelope(heights, free, true);
	return { seam: seamMask, unresolved, updates, where };
}
