/**
 * The generated world meets the hand-made park with no step (PARK.md §2,
 * WORLD.md §3, f-mundo-infinito.md §4.5): every generated vertex within
 * STITCH_BAND of the park's outer boundary blends towards the zones' edge
 * heights (park-edges.ts), the band recipe of level/zones/band.ts without
 * its slope limit. The outer edges have no crossing yet: they stay closed
 * (a soft wall) until F2, so a smooth seam is all they need, and the blend
 * stays a pure function of the vertex, cheap and order-free.
 *
 * Per vertex: for each boundary edge within the band, the target is the
 * edge's profile at the nearest point, box-filtered (±8 u) with the edge's own
 * detail fading out within 8 u; edges combine by inverse squared distance and
 * the weight is the largest edge weight, w = 1 − smoothstep(0, 40, d). On the
 * boundary itself the vertex takes the zone's height exactly (where two edges
 * meet, both hold the same zone vertex).
 */
import { clamp } from '../survival/noise.ts';
import { STITCH_BAND } from './constants.ts';
import { smooth } from './math.ts';
import { nearPark, PARK_BOUNDARY } from './park.ts';
import { PARK_EDGE_HEIGHTS } from './park-edges.ts';

const BOX = 8;
const DETAIL_FADE = 8;

/** Each edge's profile box-filtered along it. */
const SMOOTHED: readonly Float64Array[] = PARK_EDGE_HEIGHTS.map((raw) => {
	const last = raw.length - 1;
	const out = new Float64Array(raw.length);
	for (let k = 0; k <= last; k++) {
		let sum = 0;
		for (let b = -BOX; b <= BOX; b++) sum += raw[clamp(k + b, 0, last)];
		out[k] = sum / (2 * BOX + 1);
	}
	return out;
});

/** Whether a rectangle can hold any vertex the park stitch changes. */
export const touchesParkBand = (x0: number, z0: number, x1: number, z1: number) =>
	nearPark(x0, z0, x1, z1, STITCH_BAND);

/**
 * The generated ground `ground` at vertex (x, z), blended into the park.
 * Vertices inside a zone (only aprons ask) blend the same way; the zone's own
 * data is what the runtime shows there.
 */
export function parkStitch(x: number, z: number, ground: number): number {
	let target = 0;
	let alphas = 0;
	let weight = 0;
	for (let e = 0; e < PARK_BOUNDARY.length; e++) {
		const edge = PARK_BOUNDARY[e];
		const vertical = edge.side === 'west' || edge.side === 'east';
		const across = vertical ? x - edge.at : z - edge.at;
		if (across >= STITCH_BAND || across <= -STITCH_BAND) continue;
		const alongRaw = vertical ? z : x;
		const along = clamp(alongRaw, edge.from, edge.to);
		const over = alongRaw - along;
		const d = Math.sqrt(across * across + over * over);
		if (d >= STITCH_BAND) continue;
		const k = along - edge.from;
		const raw = PARK_EDGE_HEIGHTS[e][k];
		if (d === 0) return raw;
		const near = 1 - smooth(0, DETAIL_FADE, d);
		const t = SMOOTHED[e][k] + (raw - SMOOTHED[e][k]) * near;
		const w = 1 - smooth(0, STITCH_BAND, d);
		const alpha = w / (d * d);
		target += alpha * t;
		alphas += alpha;
		if (w > weight) weight = w;
	}
	if (weight === 0) return ground;
	return ground + (target / alphas - ground) * weight;
}
