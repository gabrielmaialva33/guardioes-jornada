/**
 * The endless world as a ChunkSource: the existing WorldGenClient (its Worker,
 * priorities, cancellation and byte-capped LRU) behind the streaming shape.
 * No copy: the StreamChunk references the WorldChunk's arrays.
 */

import type { WorldChunk } from '../../world-gen/chunk.ts';
import { ChunkCancelled, type WorldGenClient } from '../../world-gen/client.ts';
import { chunkBytes } from '../../world-gen/protocol.ts';
import { type ChunkSource, chunkId, emptyPlacements, StreamCancelled, type StreamChunk } from './types.ts';

const SCENERY_KINDS = ['waterfall'] as const;

/** The streaming shape of a generated chunk (null for the park's hand-made chunks, which hold nothing). */
export function fromWorldChunk(chunk: WorldChunk): StreamChunk | null {
	if (chunk.handMade) return null;
	let minY = Number.POSITIVE_INFINITY;
	let maxY = Number.NEGATIVE_INFINITY;
	for (let k = 0; k < chunk.heights.length; k++) {
		const h = chunk.heights[k];
		if (h < minY) minY = h;
		if (h > maxY) maxY = h;
	}
	return {
		key: chunkId(chunk.cx, chunk.cz),
		cx: chunk.cx,
		cz: chunk.cz,
		x0: chunk.x0,
		z0: chunk.z0,
		origin: 'generated',
		zone: null,
		waterLevel: chunk.waterLevel,
		heights: chunk.heights,
		apron: chunk.apron,
		flags: chunk.flags,
		zones: chunk.zones,
		rivers: chunk.rivers,
		riverFlags: chunk.riverFlags,
		trees: chunk.trees,
		rocks: chunk.rocks,
		decorations: chunk.decorations,
		collision: chunk.collision,
		pools: new Float32Array(0),
		basins: new Float32Array(0),
		ribbon: null,
		waterfalls: [],
		scenery: emptyPlacements(SCENERY_KINDS),
		story: null,
		minY,
		maxY,
		bytes: chunkBytes(chunk),
		generated: chunk
	};
}

export class GeneratedSource implements ChunkSource {
	readonly client: WorldGenClient;

	constructor(client: WorldGenClient) {
		this.client = client;
	}

	get bytes(): number {
		return this.client.cache.bytes;
	}

	request(cx: number, cz: number, priority: number): Promise<StreamChunk | null> {
		return this.client.request(cx, cz, priority).then(fromWorldChunk, (error: unknown) => {
			throw error instanceof ChunkCancelled ? new StreamCancelled(cx, cz) : error;
		});
	}

	cancel(cx: number, cz: number) {
		this.client.cancel(cx, cz);
	}

	/** The client's LRU keeps released chunks for a walk back, within its byte cap. */
	release(_cx: number, _cz: number) {}

	focus(x: number, z: number) {
		this.client.focus(x, z);
	}

	dispose() {
		this.client.dispose();
	}
}
