/**
 * A chunk's fields with a margin borrowed from its neighbours: what the
 * terrain builder reads for normals (±1 u), the tint kernel (±2 u) and the
 * water field (its outer ring and the sea's ±2 u search), so
 * both sides of a chunk edge compute the same values from the same samples.
 * Loaded neighbours win (an edge sample is the east or south chunk's); a
 * missing one falls back to the chunk's own edge and apron. Filling allocates
 * nothing.
 */
import { apronHeight, CHUNK_SIDE, CHUNK_SIZE, type StreamChunk } from './types.ts';

/** 3: the tint reads ±2 u, the water field's outer ring ±1 then ±2 more (water.ts). */
export const WINDOW_MARGIN = 3;
export const WINDOW_SIDE = CHUNK_SIDE + 2 * WINDOW_MARGIN;

export interface FieldWindow {
	/** World position of sample (0, 0): the chunk's (x0, z0) minus the margin. */
	x0: number;
	z0: number;
	/** WINDOW_SIDE² samples, row-major. */
	heights: Float32Array;
	flags: Uint8Array;
	zones: Uint8Array;
}

export function createWindow(): FieldWindow {
	const n = WINDOW_SIDE * WINDOW_SIDE;
	return { x0: 0, z0: 0, heights: new Float32Array(n), flags: new Uint8Array(n), zones: new Uint8Array(n) };
}

/** The loaded chunk at (cx, cz), or null/undefined. */
export type ChunkLookup = (cx: number, cz: number) => StreamChunk | null | undefined;

const near: (StreamChunk | null)[] = new Array(9).fill(null);

/** Fills `out` for `chunk` from it and its eight neighbours. */
export function fillWindow(out: FieldWindow, chunk: StreamChunk, lookup: ChunkLookup): FieldWindow {
	const m = WINDOW_MARGIN;
	out.x0 = chunk.x0 - m;
	out.z0 = chunk.z0 - m;
	for (let dz = -1; dz <= 1; dz++)
		for (let dx = -1; dx <= 1; dx++)
			near[(dz + 1) * 3 + dx + 1] =
				dx === 0 && dz === 0 ? chunk : (lookup(chunk.cx + dx, chunk.cz + dz) ?? null);
	for (let j = 0; j < WINDOW_SIDE; j++) {
		const v = j - m;
		// A sample on a shared edge belongs to the east or south chunk (its local 0), whichever chunk
		// is the centre: heights agree there anyway, flags and zones may not (each zone paints its own).
		const nz = v < 0 ? -1 : v >= CHUNK_SIZE ? 1 : 0;
		const lj = v - nz * CHUNK_SIZE;
		for (let i = 0; i < WINDOW_SIDE; i++) {
			const u = i - m;
			const nx = u < 0 ? -1 : u >= CHUNK_SIZE ? 1 : 0;
			const li = u - nx * CHUNK_SIZE;
			const w = j * WINDOW_SIDE + i;
			const source = near[(nz + 1) * 3 + nx + 1];
			if (source) {
				const s = lj * CHUNK_SIDE + li;
				out.heights[w] = source.heights[s];
				out.flags[w] = source.flags[s];
				out.zones[w] = source.zones[s];
			} else {
				out.heights[w] = apronHeight(
					chunk,
					Math.max(-1, Math.min(u, CHUNK_SIDE)),
					Math.max(-1, Math.min(v, CHUNK_SIDE))
				);
				const s = Math.max(0, Math.min(v, CHUNK_SIZE)) * CHUNK_SIDE + Math.max(0, Math.min(u, CHUNK_SIZE));
				out.flags[w] = chunk.flags[s];
				out.zones[w] = chunk.zones[s];
			}
		}
	}
	return out;
}
