/**
 * Messages between the page and the streaming Worker: zone cuts (a park zone
 * built once, cut into chunks) and chunk builds (terrain attributes and the
 * collision BVH). Every typed array of a response travels in the transfer
 * list; requests are copied (the ring reuses its buffers).
 */
import type { ZoneId } from '../../level/zones/spec.ts';
import type { CollisionData, CollisionInput } from './chunk-collision.ts';
import type { TerrainAttributes, TerrainInput } from './terrain-mesh.ts';
import type { RibbonPiece } from './trails.ts';
import type { StreamChunk } from './types.ts';
import type { WaterAttributes } from './water.ts';
import type { ZoneCut } from './zone-cut.ts';

export interface BuildRequest {
	job: number;
	/** Lower runs first. */
	priority: number;
	cx: number;
	cz: number;
	terrain: TerrainInput | null;
	collision: CollisionInput | null;
}

export interface BuildResult {
	job: number;
	cx: number;
	cz: number;
	terrain: TerrainAttributes | null;
	/** The chunk's water mesh, with the terrain (null or absent when no cell holds water). */
	water?: WaterAttributes | null;
	/** The chunk's share of its zone's trail ribbons, with the terrain (null or absent where none). */
	ribbon?: RibbonPiece | null;
	collision: CollisionData | null;
	/** Worker time. */
	ms: number;
}

/** Page → Worker. */
export type StreamRequest =
	| { type: 'zone'; job: number; id: ZoneId; seed: number; priority: number }
	| { type: 'build'; request: BuildRequest }
	/** A new priority for a queued job. */
	| { type: 'rank'; job: number; priority: number }
	/** Forget queued jobs (a running one still answers; the page ignores it). */
	| { type: 'cancel'; jobs: readonly number[] };

/** Worker → page. */
export type StreamResponse =
	| { type: 'zone'; job: number; cut: ZoneCut; ms: number; queued: number }
	| { type: 'built'; result: BuildResult; queued: number }
	| { type: 'error'; job: number; message: string };

function placementBuffers(chunk: StreamChunk, out: ArrayBuffer[]) {
	for (const p of [chunk.trees, chunk.rocks, chunk.decorations, chunk.scenery]) {
		if (!p) continue;
		out.push(
			p.kind.buffer as ArrayBuffer,
			p.block.buffer as ArrayBuffer,
			p.x.buffer as ArrayBuffer,
			p.y.buffer as ArrayBuffer,
			p.z.buffer as ArrayBuffer,
			p.scale.buffer as ArrayBuffer,
			p.yawC.buffer as ArrayBuffer,
			p.yawS.buffer as ArrayBuffer
		);
	}
}

/** Transfer list of a zone cut: every chunk array, each on its own buffer. */
export function cutTransferables(cut: ZoneCut): ArrayBuffer[] {
	const out: ArrayBuffer[] = [];
	for (const c of cut.chunks) {
		out.push(
			c.heights.buffer as ArrayBuffer,
			c.apron.buffer as ArrayBuffer,
			c.flags.buffer as ArrayBuffer,
			c.zones.buffer as ArrayBuffer,
			c.rivers.buffer as ArrayBuffer,
			c.riverFlags.buffer as ArrayBuffer,
			c.collision.heights.buffer as ArrayBuffer,
			c.collision.cylinders.buffer as ArrayBuffer,
			c.collision.boxes.buffer as ArrayBuffer,
			c.collision.decks.buffer as ArrayBuffer
		);
		if (c.pools) out.push(c.pools.buffer as ArrayBuffer);
		if (c.basins) out.push(c.basins.buffer as ArrayBuffer);
		if (c.ribbon)
			out.push(
				c.ribbon.position.buffer as ArrayBuffer,
				c.ribbon.color.buffer as ArrayBuffer,
				c.ribbon.trail.buffer as ArrayBuffer,
				c.ribbon.normal.buffer as ArrayBuffer
			);
		placementBuffers(c, out);
	}
	return out;
}

/** Transfer list of a build result. */
export function resultTransferables(result: BuildResult): ArrayBuffer[] {
	const out: ArrayBuffer[] = [];
	const t = result.terrain;
	if (t)
		out.push(
			t.position.buffer as ArrayBuffer,
			t.color.buffer as ArrayBuffer,
			t.normal.buffer as ArrayBuffer,
			t.shore.buffer as ArrayBuffer
		);
	const w = result.water;
	if (w)
		out.push(
			w.position.buffer as ArrayBuffer,
			w.color.buffer as ArrayBuffer,
			w.water.buffer as ArrayBuffer,
			w.normal.buffer as ArrayBuffer,
			w.index.buffer as ArrayBuffer
		);
	const r = result.ribbon;
	if (r)
		out.push(
			r.position.buffer as ArrayBuffer,
			r.color.buffer as ArrayBuffer,
			r.trail.buffer as ArrayBuffer,
			r.normal.buffer as ArrayBuffer
		);
	const c = result.collision;
	if (c) out.push(c.position.buffer as ArrayBuffer, c.index.buffer as ArrayBuffer, ...c.roots);
	return out;
}
