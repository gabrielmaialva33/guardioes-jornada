/**
 * Placement slots: a toroidal BlockGrid so the existing instance pools
 * (render/instancing.ts) serve a moving ring of chunks. Chunk (cx, cz) owns
 * block slot (cx mod S) + (cz mod S) · S, S = 2 · (render radius + 1) + 1, so
 * every chunk the render ring can hold (its slack ring included) has its own
 * block, and a pool's per-block culling, LOD and draw ranges work unchanged.
 * When a chunk leaves, its instances are removed by id and its block's bounds
 * emptied before the next chunk takes the slot.
 */
import { BlockGrid, type InstancePool } from '../../render/index.ts';
import type { Placements } from '../../survival/types.ts';
import { CHUNK_SIZE, type StreamChunk } from './types.ts';

const mod = (a: number, n: number) => ((a % n) + n) % n;

export class ToroidalBlockGrid extends BlockGrid {
	/** Slots per axis. */
	readonly side: number;

	constructor(side: number) {
		super({ minX: 0, minZ: 0, columns: side, rows: side, blockSize: CHUNK_SIZE });
		this.side = side;
	}

	/** The block slot of chunk (cx, cz). */
	slotOf(cx: number, cz: number): number {
		return mod(cx, this.side) + mod(cz, this.side) * this.side;
	}

	/** Pools ask with an instance's origin: the slot of the chunk holding it. */
	override blockOf(x: number, z: number): number {
		return this.slotOf(Math.floor(x / CHUNK_SIZE), Math.floor(z / CHUNK_SIZE));
	}

	/** Empties a slot's bounds for its next chunk (bounds only ever grow otherwise). */
	resetSlot(slot: number) {
		this.bounds[slot].makeEmpty();
		this.visible[slot] = 0;
		this.distance[slot] = Number.POSITIVE_INFINITY;
	}
}

export type PlacementFamily = 'tree' | 'rock' | 'decoration';

/**
 * Which pools draw a placement: the runtime's model mapping (asset-plan.ts
 * renderAssetPlan's kinds, near and far LOD) as a function, so the core stays
 * free of models. Must not allocate.
 */
export interface PlacementRoute {
	readonly pools: readonly InstancePool[];
	/** Writes the indices into `pools` that draw placement `i` into `out`; returns how many. */
	route(family: PlacementFamily, kind: string, chunk: StreamChunk, i: number, out: Int32Array): number;
	/** Model scale for pool `pool` (multiplies the placement's own scale); 1 when absent. */
	scale?(pool: number, kind: string): number;
	/**
	 * The pools that draw a chunk's scenery placement `i` (kind 'waterfall':
	 * waterfalls.ts, the `ground-waterfall` model). Absent: no scenery is placed.
	 */
	scenery?(kind: string, chunk: StreamChunk, i: number, out: Int32Array): number;
	/**
	 * Called right after each instance goes into a pool: placement `i` of
	 * `family` ('scenery' for the waterfalls) in `chunk` is instance `id` of
	 * pool `pool` until removed() names the chunk. Drives per-instance state such
	 * as crown visibility and fade. Must not allocate.
	 */
	added?(
		family: PlacementFamily | 'scenery',
		kind: string,
		chunk: StreamChunk,
		i: number,
		pool: number,
		id: number
	): void;
	/** Called before a chunk's instances leave the pools (their ids are still live then). */
	removed?(chunk: StreamChunk): void;
}

const routed = new Int32Array(8);

/** Each chunk's instances in the pools, added and removed as a whole. */
export class ChunkPlacements {
	readonly grid: ToroidalBlockGrid;
	readonly route: PlacementRoute;
	/** Instances a full pool refused since creation (a capacity miss; should stay 0). */
	dropped = 0;
	/** Instances live in the pools. */
	live = 0;
	/** Per slot: (pool, id) pairs. */
	readonly #ids: Int32Array[];
	readonly #count: Int32Array;
	/** Which chunk holds each slot (chunkId), −1 when free, and the chunk itself. */
	readonly #owner: Float64Array;
	readonly #chunk: (StreamChunk | null)[];

	constructor(grid: ToroidalBlockGrid, route: PlacementRoute, perChunk = 512) {
		this.grid = grid;
		this.route = route;
		const slots = grid.side * grid.side;
		this.#ids = Array.from({ length: slots }, () => new Int32Array(perChunk * 2));
		this.#count = new Int32Array(slots);
		this.#owner = new Float64Array(slots).fill(-1);
		this.#chunk = new Array(slots).fill(null);
	}

	/** The chunk (chunkId) whose instances fill `slot`, or −1. */
	owner(slot: number): number {
		return this.#owner[slot];
	}

	/** Adds every placement of `chunk`; returns how many instances went in. */
	add(chunk: StreamChunk): number {
		const slot = this.grid.slotOf(chunk.cx, chunk.cz);
		if (this.#owner[slot] !== -1) this.remove(slot);
		this.grid.resetSlot(slot);
		this.#owner[slot] = chunk.key;
		this.#chunk[slot] = chunk;
		const before = this.#count[slot];
		this.#place(slot, chunk, 'tree', chunk.trees);
		this.#place(slot, chunk, 'rock', chunk.rocks);
		this.#place(slot, chunk, 'decoration', chunk.decorations);
		if (chunk.scenery && this.route.scenery) this.#place(slot, chunk, 'scenery', chunk.scenery);
		return (this.#count[slot] - before) / 2;
	}

	/**
	 * Removes the instances of whatever chunk holds `slot`, last added first: the
	 * pools hand ids out again last-freed first, so a chunk that comes straight
	 * back gets the very same ids.
	 */
	remove(slot: number): number {
		const ids = this.#ids[slot];
		const n = this.#count[slot];
		const pools = this.route.pools;
		const chunk = this.#chunk[slot];
		if (chunk && n > 0) this.route.removed?.(chunk);
		for (let k = n - 2; k >= 0; k -= 2) pools[ids[k]].remove(ids[k + 1]);
		this.#count[slot] = 0;
		this.#owner[slot] = -1;
		this.#chunk[slot] = null;
		this.grid.resetSlot(slot);
		this.live -= n / 2;
		return n / 2;
	}

	/** Removes the chunk at (cx, cz) if it holds its slot. */
	removeChunk(chunk: Pick<StreamChunk, 'cx' | 'cz' | 'key'>): number {
		const slot = this.grid.slotOf(chunk.cx, chunk.cz);
		return this.#owner[slot] === chunk.key ? this.remove(slot) : 0;
	}

	#place(slot: number, chunk: StreamChunk, family: PlacementFamily | 'scenery', p: Placements<string>) {
		const pools = this.route.pools;
		const added = this.route.added;
		for (let i = 0; i < p.count; i++) {
			const kind = p.kinds[p.kind[i]];
			const n =
				family === 'scenery'
					? (this.route.scenery as NonNullable<PlacementRoute['scenery']>)(kind, chunk, i, routed)
					: this.route.route(family, kind, chunk, i, routed);
			for (let r = 0; r < n; r++) {
				const pool = routed[r];
				const k = this.route.scale ? this.route.scale(pool, kind) : 1;
				const id = pools[pool].addPlaced(p.x[i], p.y[i], p.z[i], p.yawC[i], p.yawS[i], p.scale[i] * k);
				if (id < 0) {
					this.dropped++;
					continue;
				}
				this.#push(slot, pool, id);
				added?.(family, kind, chunk, i, pool, id);
			}
		}
	}

	#push(slot: number, pool: number, id: number) {
		let ids = this.#ids[slot];
		const n = this.#count[slot];
		if (n + 2 > ids.length) {
			const grown = new Int32Array(ids.length * 2);
			grown.set(ids);
			this.#ids[slot] = grown;
			ids = grown;
		}
		ids[n] = pool;
		ids[n + 1] = id;
		this.#count[slot] = n + 2;
		this.live++;
	}
}

/**
 * The most placements of one kind ("tree:jucara", survival's count keys) in a
 * single chunk, over 1 698 chunks: the five park zones and the generated world
 * around them (cx −12..20, cz −14..16), plus three 15 × 15 regions away from
 * the park (far east, baixada, serra), measured when P34 landed. A pool that
 * draws kinds K never needs more than slots × Σ PER_CHUNK_MAX[K]: the strict
 * bound. The busiest chunk holds 152 placements, the median 114.
 */
export const PER_CHUNK_MAX: Readonly<Record<string, number>> = {
	'decoration:beach-grass': 24,
	'decoration:bromelia': 48,
	'decoration:bush': 50,
	'decoration:fern': 64,
	'decoration:flower': 49,
	'decoration:grass': 78,
	'rock:boulder': 12,
	'rock:log': 6,
	'rock:stone': 10,
	'scenery:waterfall': 1,
	'tree:araucaria': 25,
	'tree:embauba': 13,
	'tree:ipe-amarelo': 11,
	'tree:ipe-rosa': 8,
	'tree:jequitiba': 17,
	'tree:jeriva': 13,
	'tree:jucara': 24,
	'tree:mangue-vermelho': 54,
	'tree:pau-brasil': 12,
	'tree:xaxim': 17
};

/**
 * The most placements of one kind in any render-residency window (S × S
 * chunks: 7 × 7 on low, 9 × 9 on high) over the same sample: what the pools
 * need in practice. ringCapacity() adds 25 % and takes the smaller of that
 * and the strict bound.
 */
export const WINDOW_MAX: Readonly<Record<'low' | 'high', Readonly<Record<string, number>>>> = {
	low: {
		'decoration:beach-grass': 150,
		'decoration:bromelia': 1130,
		'decoration:bush': 1370,
		'decoration:fern': 1798,
		'decoration:flower': 1372,
		'decoration:grass': 2480,
		'rock:boulder': 130,
		'rock:log': 65,
		'rock:stone': 143,
		'scenery:waterfall': 2,
		'tree:araucaria': 747,
		'tree:embauba': 283,
		'tree:ipe-amarelo': 279,
		'tree:ipe-rosa': 150,
		'tree:jequitiba': 349,
		'tree:jeriva': 73,
		'tree:jucara': 479,
		'tree:mangue-vermelho': 406,
		'tree:pau-brasil': 286,
		'tree:xaxim': 313
	},
	high: {
		'decoration:beach-grass': 174,
		'decoration:bromelia': 1628,
		'decoration:bush': 2025,
		'decoration:fern': 2712,
		'decoration:flower': 2109,
		'decoration:grass': 3903,
		'rock:boulder': 190,
		'rock:log': 95,
		'rock:stone': 211,
		'scenery:waterfall': 2,
		'tree:araucaria': 1198,
		'tree:embauba': 383,
		'tree:ipe-amarelo': 383,
		'tree:ipe-rosa': 197,
		'tree:jequitiba': 435,
		'tree:jeriva': 91,
		'tree:jucara': 618,
		'tree:mangue-vermelho': 409,
		'tree:pau-brasil': 394,
		'tree:xaxim': 452
	}
};

/** Slots of a render ring of `radius` with its slack ring. */
export const ringSlots = (radius: number) => (2 * (radius + 1) + 1) ** 2;

/** Instance capacity for a pool drawing the kinds `keys` on a ring of `radius` (2 low, 3 high). */
export function ringCapacity(keys: readonly string[], radius: number): number {
	const slots = ringSlots(radius);
	const tier = radius <= 2 ? WINDOW_MAX.low : WINDOW_MAX.high;
	let strict = 0;
	let measured = 0;
	for (const key of keys) {
		strict += slots * (PER_CHUNK_MAX[key] ?? 0);
		measured += Math.ceil((tier[key] ?? 0) * 1.25);
	}
	return Math.max(1, Math.min(strict, measured || strict));
}
