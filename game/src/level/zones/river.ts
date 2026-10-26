/**
 * The park river (spec.ts PARK_RIVER) carved into a zone's grid with the
 * Reserva's own cross-section (level/build.ts carveWater: a flat bed at the
 * depth, banks rising 0.8 per unit, the river's half width at the water's
 * edge), so a channel leaving one zone carries on in the next. Banks stop
 * BANK_RISE above the water: past that the ground keeps its own height, so
 * the Cachoeira Grande's wall stands beside its pool.
 */
import { clamp } from '../../survival/noise.ts';
import { PARK_RIVER } from './spec.ts';

const BANK_SLOPE = 0.8;
const BANK_RISE = 4;
/** No bank reaches farther than this from a centre line. */
export const RIVER_REACH = 8 + BANK_RISE / BANK_SLOPE;

interface Segment {
	ax: number;
	az: number;
	dx: number;
	dz: number;
	len2: number;
	aw: number;
	bw: number;
	ah: number;
	bh: number;
	ad: number;
	bd: number;
	/** Order along the river, for ties. */
	k: number;
}

const SEGMENTS: readonly Segment[] = PARK_RIVER.slice(1).map((b, k) => {
	const a = PARK_RIVER[k];
	const dx = b.x - a.x;
	const dz = b.z - a.z;
	return {
		ax: a.x,
		az: a.z,
		dx,
		dz,
		len2: dx * dx + dz * dz,
		aw: a.water,
		bw: b.water,
		ah: a.halfWidth,
		bh: b.halfWidth,
		ad: a.depth,
		bd: b.depth,
		k
	};
});

/** River segments that can touch the rectangle. */
function segmentsNear(x0: number, z0: number, x1: number, z1: number): Segment[] {
	return SEGMENTS.filter(
		(g) =>
			Math.min(g.ax, g.ax + g.dx) - RIVER_REACH <= x1 &&
			Math.max(g.ax, g.ax + g.dx) + RIVER_REACH >= x0 &&
			Math.min(g.az, g.az + g.dz) - RIVER_REACH <= z1 &&
			Math.max(g.az, g.az + g.dz) + RIVER_REACH >= z0
	);
}

/** What the river does at one vertex. */
export interface RiverHere {
	/** Ground after carving. */
	height: number;
	/** Water surface of the nearest channel, and whether the vertex is under it. */
	water: number;
	wet: boolean;
	/** Half width minus distance of the nearest channel (> 0 inside its water's width). */
	inside: number;
}

/**
 * Carves `heights` (world vertex (x0 + i, z0 + j) at j · (width + 1) + i) in
 * place, leaving the vertices `keep` marks alone (seams fixed to a
 * neighbour), and returns the water surface and wetness per vertex.
 */
export function carveRiver(
	heights: Float64Array,
	x0: number,
	z0: number,
	width: number,
	depth: number,
	keep: Uint8Array
): { water: Float64Array; wet: Uint8Array } {
	const side = width + 1;
	const segments = segmentsNear(x0, z0, x0 + width, z0 + depth);
	const water = new Float64Array(heights.length).fill(Number.NaN);
	const wet = new Uint8Array(heights.length);
	if (segments.length === 0) return { water, wet };
	for (let j = 0; j <= depth; j++)
		for (let i = 0; i <= width; i++) {
			const q = j * side + i;
			const here = riverAt(x0 + i, z0 + j, heights[q], segments);
			if (!keep[q]) heights[q] = here.height;
			water[q] = here.water;
			wet[q] = here.wet ? 1 : 0;
		}
	return { water, wet };
}

function riverAt(x: number, z: number, ground: number, segments: readonly Segment[]): RiverHere {
	let height = ground;
	let water = Number.NaN;
	let inside = Number.NEGATIVE_INFINITY;
	let order = Number.POSITIVE_INFINITY;
	for (const g of segments) {
		const px = x - g.ax;
		const pz = z - g.az;
		const t = clamp((px * g.dx + pz * g.dz) / g.len2, 0, 1);
		const ex = px - t * g.dx;
		const ez = pz - t * g.dz;
		const d = Math.sqrt(ex * ex + ez * ez);
		const half = g.ah + (g.bh - g.ah) * t;
		if (d > half + RIVER_REACH) continue;
		const surface = g.aw + (g.bw - g.aw) * t;
		const bed = surface - (g.ad + (g.bd - g.ad) * t);
		const bank = Math.max(bed, surface + BANK_SLOPE * (d - half));
		if (bank < surface + BANK_RISE && bank < height) height = bank;
		const w = half - d;
		if (w > inside || (w === inside && g.k < order)) {
			inside = w;
			order = g.k;
			water = surface;
		}
	}
	return { height, water, inside, wet: inside > 0 && height < water };
}

/** The river's stations (world coordinates) that lie in a rectangle, for a zone's River record. */
export function stationsIn(x0: number, z0: number, x1: number, z1: number) {
	return PARK_RIVER.filter((s) => s.x >= x0 && s.x <= x1 && s.z >= z0 && s.z <= z1);
}
