/**
 * Messages between the page and the world-gen Worker (f-mundo-infinito.md
 * §4.3), and the helpers both sides share. Light on purpose: the page imports
 * this and client.ts only, never the generator.
 */
import type { WorldChunk } from './chunk.ts';
import { CHUNK_SIZE } from './constants.ts';

/** Page → Worker. */
export type WorkerRequest =
	/** Generate (cx, cz); a repeated key only updates the job's priority. Lower priority runs first. */
	| { type: 'want'; key: string; cx: number; cz: number; seed: number; priority?: number }
	/** Forget queued jobs (a job already running still answers; the page ignores it). */
	| { type: 'cancel'; keys: readonly string[] }
	/**
	 * Jobs without an explicit priority run nearest to (x, z) first; with
	 * `dropBeyond`, queued jobs whose chunk centre is farther are dropped.
	 */
	| { type: 'focus'; x: number; z: number; dropBeyond?: number };

/** Worker → page. Every typed array of `chunk` arrives in the transfer list. */
export type WorkerResponse =
	| { type: 'chunk'; key: string; chunk: WorldChunk; ms: number; queued: number }
	| { type: 'dropped'; keys: string[] }
	| { type: 'error'; key: string; message: string };

export const chunkKey = (cx: number, cz: number) => `${cx},${cz}`;

/** Squared distance from (x, z) to the centre of chunk (cx, cz). */
export function chunkDistance2(cx: number, cz: number, x: number, z: number): number {
	const dx = (cx + 0.5) * CHUNK_SIZE - x;
	const dz = (cz + 0.5) * CHUNK_SIZE - z;
	return dx * dx + dz * dz;
}

/** Every typed array of a chunk; each has its own buffer. */
export function chunkArrays(chunk: WorldChunk): ArrayBufferView[] {
	const sets = [chunk.trees, chunk.rocks, chunk.decorations].flatMap((p) => [
		p.kind,
		p.block,
		p.x,
		p.y,
		p.z,
		p.scale,
		p.yawC,
		p.yawS
	]);
	const c = chunk.collision;
	return [
		chunk.heights,
		chunk.zones,
		chunk.flags,
		chunk.biome,
		chunk.biomeWeights,
		chunk.rivers,
		chunk.riverIds,
		chunk.riverFlags,
		...sets,
		c.heights,
		c.cylinders,
		c.boxes,
		c.decks
	];
}

/** The transfer list for postMessage: zero copies, the sender's arrays become empty. */
export function chunkTransferables(chunk: WorldChunk): ArrayBuffer[] {
	return chunkArrays(chunk).map((a) => a.buffer as ArrayBuffer);
}

/** Bytes held by a chunk's typed arrays (what the cache counts). */
export function chunkBytes(chunk: WorldChunk): number {
	let bytes = 0;
	for (const a of chunkArrays(chunk)) bytes += a.byteLength;
	return bytes;
}
