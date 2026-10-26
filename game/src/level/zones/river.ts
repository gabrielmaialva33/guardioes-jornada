/**
 * The park river (spec.ts PARK_RIVER) carved into a zone's grid with the
 * Reserva's own cross-section (level/build.ts carveWater: a flat bed at the
 * depth, banks rising 0.8 per unit, the river's half width at the water's
 * edge), so a channel leaving one zone carries on in the next. Banks stop
 * BANK_RISE above the water: past that the ground keeps its own height, so
 * the Cachoeira Grande's wall stands beside its pool.
 *
 * A station may steepen its banks (`bankSlope`, a gorge's walls), and a fall's
 * lip may carry a `face`: the line through the lip across that normal splits
 * the carve near it, so ground above the fall is carved only by the river
 * above it and ground below only by the river below. Without it the plunge
 * pool's round end would cut a notch into the cliff behind the fall.
 */
import { clamp } from '../../survival/noise.ts';
import { PARK_RIVER } from './spec.ts';

/** The Reserva's bank slope, every station's unless it says otherwise. */
export const BANK_SLOPE = 0.8;
const BANK_RISE = 4;
/** No bank reaches farther than this from a centre line. */
export const RIVER_REACH = 8 + BANK_RISE / BANK_SLOPE;
/** A fall's face splits the carve within this distance of its lip. */
const FACE_REACH = 16;

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
	as: number;
	bs: number;
	/** Order along the river, for ties and for the faces. */
	k: number;
}

interface Face {
	x: number;
	z: number;
	nx: number;
	nz: number;
	/** Index of the lip station: segments from it on are below the fall. */
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
		as: a.bankSlope ?? BANK_SLOPE,
		bs: b.bankSlope ?? BANK_SLOPE,
		k
	};
});

const FACES: readonly Face[] = PARK_RIVER.flatMap((s, k) =>
	s.face ? [{ x: s.x, z: s.z, nx: s.face[0], nz: s.face[1], k }] : []
);

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

/** The carve's result per vertex: the water surface of the nearest channel, how far inside its width, and wet. */
export interface RiverCarve {
	water: Float64Array;
	inside: Float64Array;
	wet: Uint8Array;
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
): RiverCarve {
	const side = width + 1;
	const segments = segmentsNear(x0, z0, x0 + width, z0 + depth);
	const water = new Float64Array(heights.length).fill(Number.NaN);
	const inside = new Float64Array(heights.length).fill(Number.NEGATIVE_INFINITY);
	const wet = new Uint8Array(heights.length);
	if (segments.length === 0) return { water, inside, wet };
	for (let j = 0; j <= depth; j++)
		for (let i = 0; i <= width; i++) {
			const q = j * side + i;
			const here = riverAt(x0 + i, z0 + j, heights[q], segments);
			if (!keep[q]) heights[q] = here.height;
			water[q] = here.water;
			inside[q] = here.inside;
			wet[q] = here.wet ? 1 : 0;
		}
	return { water, inside, wet };
}

/** Whether a fall's face keeps segment `k` away from (x, z): the two lie on opposite sides of a lip nearby. */
function behindFace(x: number, z: number, k: number): boolean {
	for (const f of FACES) {
		const ex = x - f.x;
		const ez = z - f.z;
		if (ex * ex + ez * ez > FACE_REACH * FACE_REACH) continue;
		const below = ex * f.nx + ez * f.nz >= 0;
		if (below !== k >= f.k) return true;
	}
	return false;
}

function riverAt(x: number, z: number, ground: number, segments: readonly Segment[]): RiverHere {
	let height = ground;
	let water = Number.NaN;
	let inside = Number.NEGATIVE_INFINITY;
	let order = Number.POSITIVE_INFINITY;
	for (const g of segments) {
		if (FACES.length > 0 && behindFace(x, z, g.k)) continue;
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
		const bank = Math.max(bed, surface + (g.as + (g.bs - g.as) * t) * (d - half));
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

/** How far inside the nearest channel's water width (x, z) lies (> 0 in the water), faces aside: for tests and placement. */
export function riverInside(x: number, z: number): number {
	let inside = Number.NEGATIVE_INFINITY;
	for (const g of SEGMENTS) {
		const px = x - g.ax;
		const pz = z - g.az;
		const t = clamp((px * g.dx + pz * g.dz) / g.len2, 0, 1);
		const ex = px - t * g.dx;
		const ez = pz - t * g.dz;
		const w = g.ah + (g.bh - g.ah) * t - Math.sqrt(ex * ex + ez * ez);
		if (w > inside) inside = w;
	}
	return inside;
}
