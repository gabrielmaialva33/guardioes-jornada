/**
 * The streaming core's shared shapes (game/WORLD.md §2, PARK.md §8): one chunk
 * shape for both sources, the hand-made park zones cut into 40 u chunks and
 * the endless world's generated chunks, plus packed integer keys so the ring
 * manager never builds a string per frame.
 *
 * World coordinates throughout: x grows east, z grows south, chunk (cx, cz)
 * spans [cx · 40, cx · 40 + 40] × [cz · 40, cz · 40 + 40].
 */
import type { ZoneId } from '../../level/zones/spec.ts';
import type { ZoneLevel } from '../../level/zones/zone.ts';
import type {
	CollisionBlock,
	DecorationKind,
	Placements,
	RockKind,
	TreeSpecies
} from '../../survival/types.ts';
import type { WorldChunk } from '../../world-gen/chunk.ts';
import type { RibbonPiece } from './trails.ts';
import type { StreamWaterfall } from './waterfalls.ts';

/** Chunk side in units: world-gen's CHUNK_SIZE and survival's BLOCK_SIZE. */
export const CHUNK_SIZE = 40;
/** Samples per chunk side. */
export const CHUNK_SIDE = CHUNK_SIZE + 1;
export const CHUNK_VERTICES = CHUNK_SIDE * CHUNK_SIDE;
/** world-gen APRON_LENGTH: north and south rows of 43, west and east columns of 41. */
export const APRON_LENGTH = 4 * CHUNK_SIDE + 4;
/** world-gen RIVER_STRIDE: [ax, az, aWater, bx, bz, bWater, halfWidth, depth]. */
export const RIVER_STRIDE = 8;
/** A chunk's still pools: [key, x, z, water, axisX, axisZ, halfLength, halfWidth] (level/types.ts Pool). */
export const POOL_STRIDE = 8;
/** A chunk's basins: [key, ax, az, bx, bz, radius, water] (zone content Basin). */
export const BASIN_KEYED_STRIDE = 7;

/** Chunk coordinates fit in ±32 767 (±1 300 km); the key is an exact integer below 2³². */
const KEY_BIAS = 32768;

/** A chunk's packed key: no string, no allocation. */
export const chunkId = (cx: number, cz: number) => (cx + KEY_BIAS) * 65536 + (cz + KEY_BIAS);
export const chunkIdX = (id: number) => Math.floor(id / 65536) - KEY_BIAS;
export const chunkIdZ = (id: number) => (id % 65536) - KEY_BIAS;

/** The chunk holding world (x, z). */
export const chunkOf = (v: number) => Math.floor(v / CHUNK_SIZE);

export type ChunkOrigin = 'generated' | 'zone';

/**
 * What a zone chunk knows of its zone's story: the level is the zone's own
 * (zone-local coordinates, shared by every chunk of the zone, never copied);
 * add (offsetX, offsetZ) to reach world coordinates.
 */
export interface StoryRef {
	zone: ZoneId;
	offsetX: number;
	offsetZ: number;
	/** The chunk's collision block in the zone world (bz · blocksX + bx): its placements' `block` there. */
	block: number;
	level: ZoneLevel;
}

/**
 * One 40 u chunk, from either source. Arrays are row-major, index j · 41 + i
 * for vertex (x0 + i, z0 + j). Placements, rivers and collision are in world
 * coordinates; placements' `block` is 0 (the ring gives each chunk its slot).
 */
export interface StreamChunk {
	/** chunkId(cx, cz). */
	key: number;
	cx: number;
	cz: number;
	x0: number;
	z0: number;
	origin: ChunkOrigin;
	/** The park zone it belongs to, or null in the generated world. */
	zone: ZoneId | null;
	waterLevel: number;
	/** 41² ground heights; edges equal the neighbours'. */
	heights: Float32Array;
	/**
	 * APRON_LENGTH heights one unit around the grid (world-gen's layout; read
	 * them with apronHeight). A fallback only: the ring takes the neighbours'
	 * own heights when they are loaded, which the data ring guarantees for every
	 * rendered chunk.
	 */
	apron: Float32Array;
	/** 41² survival FLAG bits. */
	flags: Uint8Array;
	/** 41² survival ZONE values. */
	zones: Uint8Array;
	/** River segments whose water reaches the chunk, RIVER_STRIDE floats each. */
	rivers: Float32Array;
	/** world-gen RIVER_FLAG bits per segment (0 for the park's rivers). */
	riverFlags: Uint8Array;
	/**
	 * Still pools and basins whose water reaches the chunk, world coordinates,
	 * each with a key that orders it the same way in every chunk around it.
	 */
	pools?: Float32Array;
	basins?: Float32Array;
	trees: Placements<TreeSpecies>;
	rocks: Placements<RockKind>;
	decorations: Placements<DecorationKind>;
	/** survival's CollisionBlock with bx = cx, bz = cz, index 0. */
	collision: CollisionBlock;
	/**
	 * A trail ribbon carried by the chunk itself (trails.ts). Park chunks leave
	 * it out: the Worker sends their share with the terrain build instead, so
	 * zone cuts stay small.
	 */
	ribbon?: RibbonPiece | null;
	/** Waterfalls whose lip lies in the chunk (waterfalls.ts), and their models as placements. */
	waterfalls?: StreamWaterfall[];
	scenery?: Placements<'waterfall'>;
	/** Zone chunks only. */
	story: StoryRef | null;
	/** Ground height range over the grid. */
	minY: number;
	maxY: number;
	/** Bytes held by the chunk's own typed arrays (the ring's byte cap counts them). */
	bytes: number;
	/** The generator's chunk (biome weights and the rest), generated chunks only. */
	generated: WorldChunk | null;
}

/** A request given up before its chunk arrived. */
export class StreamCancelled extends Error {
	readonly cx: number;
	readonly cz: number;

	constructor(cx: number, cz: number) {
		super(`chunk ${cx},${cz} cancelled`);
		this.name = 'StreamCancelled';
		this.cx = cx;
		this.cz = cz;
	}
}

/**
 * Where chunks come from. Both sources (and the park router over them) answer
 * with the same StreamChunk; null means nothing exists there (outside a
 * zone-only map), which the ring treats as void.
 */
export interface ChunkSource {
	/** The chunk at (cx, cz); lower priority runs first. Rejects with a cancellation when given up. */
	request(cx: number, cz: number, priority: number): Promise<StreamChunk | null>;
	/** Gives up a pending request. */
	cancel(cx: number, cz: number): void;
	/** The ring no longer holds (cx, cz): the source may drop what it keeps for it. */
	release(cx: number, cz: number): void;
	/** The player's position, for the order of work the source does on its own. */
	focus(x: number, z: number): void;
	/** Bytes the source itself keeps (caches, zone cuts). */
	readonly bytes: number;
	dispose(): void;
}

/** No placements of a kind set (generated chunks' scenery, say). */
export function emptyPlacements<K extends string>(kinds: readonly K[]): Placements<K> {
	return {
		kinds,
		count: 0,
		kind: new Uint8Array(0),
		block: new Uint8Array(0),
		x: new Float32Array(0),
		y: new Float32Array(0),
		z: new Float32Array(0),
		scale: new Float32Array(0),
		yawC: new Float32Array(0),
		yawS: new Float32Array(0)
	};
}

/** Bytes of a set of placements' arrays. */
export function placementBytes(p: Placements<string>): number {
	return (
		p.kind.byteLength +
		p.block.byteLength +
		p.x.byteLength +
		p.y.byteLength +
		p.z.byteLength +
		p.scale.byteLength +
		p.yawC.byteLength +
		p.yawS.byteLength
	);
}

/** Bytes held by a chunk's typed arrays. */
export function streamChunkBytes(c: Omit<StreamChunk, 'bytes'>): number {
	const k = c.collision;
	return (
		c.heights.byteLength +
		c.apron.byteLength +
		c.flags.byteLength +
		c.zones.byteLength +
		c.rivers.byteLength +
		c.riverFlags.byteLength +
		(c.pools?.byteLength ?? 0) +
		(c.basins?.byteLength ?? 0) +
		(c.ribbon
			? c.ribbon.position.byteLength +
				c.ribbon.color.byteLength +
				c.ribbon.trail.byteLength +
				c.ribbon.normal.byteLength
			: 0) +
		(c.scenery ? placementBytes(c.scenery) : 0) +
		placementBytes(c.trees) +
		placementBytes(c.rocks) +
		placementBytes(c.decorations) +
		k.heights.byteLength +
		k.cylinders.byteLength +
		k.boxes.byteLength +
		k.decks.byteLength +
		(c.generated ? c.generated.biome.byteLength + c.generated.biomeWeights.byteLength : 0)
	);
}

/** Height of vertex (i, j), i and j in −1..41: the grid inside, the apron on the ring (world-gen heightWithApron). */
export function apronHeight(chunk: Pick<StreamChunk, 'heights' | 'apron'>, i: number, j: number): number {
	const side = CHUNK_SIDE;
	if (i >= 0 && i < side && j >= 0 && j < side) return chunk.heights[j * side + i];
	if (j === -1) return chunk.apron[i + 1];
	if (j === side) return chunk.apron[side + 2 + i + 1];
	if (i === -1) return chunk.apron[2 * (side + 2) + j];
	return chunk.apron[2 * (side + 2) + side + j];
}

/** Ground height range of a 41² grid. */
export function heightRange(heights: Float32Array): [number, number] {
	let lo = Number.POSITIVE_INFINITY;
	let hi = Number.NEGATIVE_INFINITY;
	for (let k = 0; k < heights.length; k++) {
		const h = heights[k];
		if (h < lo) lo = h;
		if (h > hi) hi = h;
	}
	return [lo, hi];
}
