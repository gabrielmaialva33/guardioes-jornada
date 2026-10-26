/**
 * The east side of the stitch band (WORLD.md §3, f-mundo-infinito.md §4.5),
 * ahead of F2 for F1's east portal: procedural ground meets the Reserva's
 * x = 160 edge with no step and stays walkable across the 40 u band. North,
 * south and west stay closed until F2.
 *
 * The recipe, per vertex outside the Reserva within STITCH_BAND of its east
 * edge (the segment x = 160, z 0..160; the band rounds its two corners):
 * 1. Target: the Reserva's edge height at the clamped z, as a box-filtered
 *    profile (±8 u) plus the edge's own detail fading out within 8 u of the
 *    seam, so cliffs and noise never leak out (§4.5 step 3). The portal's
 *    opening (RESERVA_EAST_GAP) keeps its own height unfiltered, so the
 *    mirante's causeway carries on east as a ridge.
 * 2. Blend: procedural + (target − procedural) · w, with
 *    w = 1 − smoothstep(0, 40, distance to the edge).
 * 3. Slope limit (§4.5 step 4, survival's "thermal" as a filter): a FIFO
 *    worklist in a fixed order clamps every free vertex to within BAND_SLOPE
 *    of its four neighbours (1.25 u diagonally), with the seam (the Reserva's
 *    own heights) and the band's outer ring (pure procedural, w = 0) fixed.
 *    Only the seam inside the portal's opening constrains it: elsewhere the
 *    Reserva's edge rail stands at x = 160 and nobody walks across.
 *
 * Step 3 reads neighbours, so the band is computed once per seed as a whole
 * table, independent of which chunk asks first: still a pure function of
 * position and seed, the same bits in any chunk, any order, any Worker.
 */
import { clamp } from '../survival/noise.ts';
import { RESERVE, STITCH_BAND } from './constants.ts';
import { coastX, macroFields, newMacroPoint, samplePoint, serraFoot } from './macro.ts';
import { smooth } from './math.ts';
import { RESERVA_EAST_COLUMNS, RESERVA_EAST_GAP } from './reserva-edge.ts';
import { CARVE_FAR, carve, newRiverSample, riverLattice } from './rivers.ts';

const EDGE_X = RESERVE.x1;
/** Half width of the box filter along the edge, and how far the edge's own detail reaches into the band. */
const BOX = 8;
const DETAIL_FADE = 8;
/**
 * Step limits of the relaxation: just under WALK_SLOPE (0.9 per unit) and its
 * diagonal 0.9 · √2 ≈ 1.27, the reachability pass's rules. Not lower: the
 * macro's own serra foot climbs 0.875 per unit where the band meets it.
 */
export const BAND_SLOPE = 0.89;
const BAND_SLOPE_DIAGONAL = 1.25;
/** Relaxation work cap, in vertex updates per free vertex. */
const MAX_UPDATES = 64;
/** The table: every vertex within STITCH_BAND of the east edge, plus the fixed ring around them. */
const X0 = EDGE_X - STITCH_BAND;
const Z0 = RESERVE.z0 - STITCH_BAND;
const COLS = 2 * STITCH_BAND + 1;
const ROWS = RESERVE.z1 - RESERVE.z0 + 2 * STITCH_BAND + 1;
const ABSENT = 0;
const FIXED = 1;
const FREE = 2;
/** A seam vertex behind the edge rail: fixed to the Reserva's height, but no walking constraint. */
const FENCED = 3;

/** z of the seam inside the portal's opening. */
const inGap = (z: number) => z >= RESERVA_EAST_GAP.z0 && z <= RESERVA_EAST_GAP.z1;

/** Strictly inside the Reserva's square: hand-made, never generated. */
export const insideReserva = (x: number, z: number) =>
	x > RESERVE.x0 && x < RESERVE.x1 && z > RESERVE.z0 && z < RESERVE.z1;

/** Table vertex k is on the seam: x = 160, z 0..160, the Reserva's own heights. */
function isSeam(k: number): boolean {
	const a = k % COLS;
	const z = Z0 + (k - a) / COLS;
	return X0 + a === EDGE_X && z >= RESERVE.z0 && z <= RESERVE.z1;
}

/** Distance from a point outside the Reserva to its east edge segment. */
export function eastEdgeDistance(x: number, z: number): number {
	const dx = x - EDGE_X;
	const dz = z < RESERVE.z0 ? RESERVE.z0 - z : z > RESERVE.z1 ? z - RESERVE.z1 : 0;
	return Math.sqrt(dx * dx + dz * dz);
}

/** The band's blend weight: 1 on the edge, 0 from STITCH_BAND out. */
export const eastWeight = (x: number, z: number) => 1 - smooth(0, STITCH_BAND, eastEdgeDistance(x, z));

export class EastStitch {
	/** Final heights over the table, row-major from (X0, Z0). */
	readonly #h: Float64Array;
	readonly #state: Uint8Array;
	/** Vertex updates the relaxation took, and free vertices it could not bring within the limits of all neighbours. */
	readonly updates: number;
	readonly unresolved: number;

	constructor(seed: number) {
		const edge = RESERVA_EAST_COLUMNS[160];
		const last = edge.length - 1;
		const smoothed = new Float64Array(edge.length);
		for (let z = 0; z <= last; z++) {
			if (inGap(z + RESERVE.z0)) {
				smoothed[z] = edge[z];
				continue;
			}
			let sum = 0;
			for (let k = -BOX; k <= BOX; k++) sum += edge[clamp(z + k, 0, last)];
			smoothed[z] = sum / (2 * BOX + 1);
		}

		const n = COLS * ROWS;
		const h = new Float64Array(n);
		const state = new Uint8Array(n);
		const weight = new Float64Array(n);
		for (let b = 0; b < ROWS; b++)
			for (let a = 0; a < COLS; a++) {
				const x = X0 + a;
				const z = Z0 + b;
				const k = b * COLS + a;
				if (insideReserva(x, z)) state[k] = ABSENT;
				else if (x === EDGE_X && z >= RESERVE.z0 && z <= RESERVE.z1) {
					state[k] = inGap(z) ? FIXED : FENCED;
					h[k] = edge[z - RESERVE.z0];
				} else {
					weight[k] = eastWeight(x, z);
					state[k] = weight[k] > 0 ? FREE : FIXED;
				}
			}

		// Procedural ground where the band needs it: its free vertices and their fixed outer neighbours.
		const needs = new Uint8Array(n);
		for (let k = 0; k < n; k++) {
			if (state[k] !== FREE) continue;
			for (let db = -1; db <= 1; db++)
				for (let da = -1; da <= 1; da++) {
					const o = k + db * COLS + da;
					if (state[o] === FREE || (state[o] === FIXED && weight[o] === 0 && !isSeam(o))) needs[o] = 1;
				}
		}
		const fields = macroFields(seed);
		const segments = riverLattice(seed).segmentsNear(X0, Z0, X0 + COLS - 1, Z0 + ROWS - 1, CARVE_FAR + 1);
		const p = newMacroPoint();
		const r = newRiverSample();
		for (let b = 0; b < ROWS; b++) {
			const z = Z0 + b;
			let coast = 0;
			let foot = 0;
			let row = false;
			for (let a = 0; a < COLS; a++) {
				const k = b * COLS + a;
				if (!needs[k]) continue;
				if (!row) {
					coast = coastX(z, fields.layers);
					foot = serraFoot(z, fields.layers);
					row = true;
				}
				const x = X0 + a;
				samplePoint(x, z, coast, foot, fields, p);
				const ground = carve(x, z, p.ground, segments, r).height;
				if (state[k] === FIXED) {
					h[k] = ground;
					continue;
				}
				const zc = clamp(z, RESERVE.z0, RESERVE.z1) - RESERVE.z0;
				const near = 1 - smooth(0, DETAIL_FADE, x > EDGE_X ? x - EDGE_X : 0);
				const target = smoothed[zc] + (edge[zc] - smoothed[zc]) * near;
				h[k] = ground + (target - ground) * weight[k];
			}
		}

		// Slope limit: a FIFO worklist seeded in row-major order; a vertex that moves requeues its free neighbours.
		const offsets = [-COLS - 1, -COLS, -COLS + 1, -1, 1, COLS - 1, COLS, COLS + 1];
		const limits = [
			BAND_SLOPE_DIAGONAL,
			BAND_SLOPE,
			BAND_SLOPE_DIAGONAL,
			BAND_SLOPE,
			BAND_SLOPE,
			BAND_SLOPE_DIAGONAL,
			BAND_SLOPE,
			BAND_SLOPE_DIAGONAL
		];
		const queue = new Int32Array(n);
		const queued = new Uint8Array(n);
		let head = 0;
		let size = 0;
		const push = (k: number) => {
			queue[(head + size) % n] = k;
			size++;
			queued[k] = 1;
		};
		let free = 0;
		for (let k = 0; k < n; k++)
			if (state[k] === FREE) {
				push(k);
				free++;
			}
		const bounds = (k: number): [number, number] => {
			let lo = Number.NEGATIVE_INFINITY;
			let hi = Number.POSITIVE_INFINITY;
			for (let t = 0; t < 8; t++) {
				const o = k + offsets[t];
				if (state[o] === ABSENT || state[o] === FENCED) continue;
				lo = Math.max(lo, h[o] - limits[t]);
				hi = Math.min(hi, h[o] + limits[t]);
			}
			return [lo, hi];
		};
		let updates = 0;
		for (; size > 0 && updates < MAX_UPDATES * free; updates++) {
			const k = queue[head];
			head = (head + 1) % n;
			size--;
			queued[k] = 0;
			const [lo, hi] = bounds(k);
			const v = h[k];
			const next = lo <= hi ? clamp(v, lo, hi) : (lo + hi) / 2;
			if (next === v) continue;
			h[k] = next;
			if (Math.abs(next - v) <= 1e-9) continue;
			for (const offset of offsets) {
				const o = k + offset;
				if (state[o] === FREE && !queued[o]) push(o);
			}
		}
		let unresolved = 0;
		for (let k = 0; k < n; k++)
			if (state[k] === FREE) {
				const [lo, hi] = bounds(k);
				if (lo > hi) unresolved++;
			}
		this.#h = h;
		this.#state = state;
		this.updates = updates;
		this.unresolved = unresolved;
	}

	/**
	 * The stitched height of vertex (x, z) (integers), or NaN where the band
	 * does not decide it (outside it, or inside the Reserva but its x = 159
	 * column, which is the level's and serves the aprons of chunks (4, 0..3)).
	 */
	height(x: number, z: number): number {
		if (x === EDGE_X - 1 && z > RESERVE.z0 && z < RESERVE.z1)
			return RESERVA_EAST_COLUMNS[159][z - RESERVE.z0];
		const a = x - X0;
		const b = z - Z0;
		if (a < 0 || b < 0 || a >= COLS || b >= ROWS) return Number.NaN;
		const k = b * COLS + a;
		const s = this.#state[k];
		if (s === FREE || s === FENCED || (s === FIXED && x === EDGE_X && z >= RESERVE.z0 && z <= RESERVE.z1))
			return this.#h[k];
		return Number.NaN;
	}
}

const stitches = new Map<number, EastStitch>();

/** The band of a seed, built on first use (a few ms) and shared by every chunk. */
export function eastStitch(seed: number): EastStitch {
	let stitch = stitches.get(seed);
	if (!stitch) {
		if (stitches.size > 8) stitches.clear();
		stitch = new EastStitch(seed);
		stitches.set(seed, stitch);
	}
	return stitch;
}

/** Whether chunk-space work can skip the band: true when the rectangle cannot touch it. */
export function touchesEastBand(x0: number, z0: number, x1: number, z1: number): boolean {
	return x1 >= X0 && x0 <= X0 + COLS - 1 && z1 >= Z0 && z0 <= Z0 + ROWS - 1;
}

export function clearStitchCaches() {
	stitches.clear();
}
