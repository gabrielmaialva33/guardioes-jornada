/**
 * Sizes, versions, seeds and the hand-made Reserva of the endless world
 * (game/WORLD.md §2, f-mundo-infinito.md §4.3–4.4).
 *
 * Determinism rules are survival's (survival/random.ts), enforced over this
 * directory by determinism.test.ts: every generated value is a pure function
 * of world position and the seed, built from exact arithmetic and integer
 * hashes only, so any chunk can be built alone, in any order, in any Worker,
 * and two neighbours agree bit for bit on their shared edge.
 */
import { subSeed } from '../survival/random.ts';
import { BLOCK_SIZE, COLLISION_STEP, WORLD_SIZE } from '../survival/types.ts';

/** Relief, rivers, zones and the ids saves will reference: bump when any of them changes for a seed. */
export const MACRO_VERSION = 1;
/** Vegetation, rocks and decorations: bump when they change; saves keep their progress. */
export const DETAIL_VERSION = 1;

/** A chunk is one of the runtime's 40 u blocks. */
export const CHUNK_SIZE = BLOCK_SIZE;
/** Height samples per chunk side, one per unit; the last row and column are the neighbour's first. */
export const CHUNK_SIDE = CHUNK_SIZE + 1;
export const CHUNK_CELLS = CHUNK_SIDE * CHUNK_SIDE;
/** Collision ground samples per side, every COLLISION_STEP u (survival's CollisionBlock). */
export const COLLISION_SIDE = CHUNK_SIZE / COLLISION_STEP + 1;

/**
 * level/layout.ts STORY_SEED, copied so the Worker never imports the level
 * (and through it the animation module); world-gen.test.ts checks they agree.
 */
const STORY_SEED = 0x1a8a2026;
/** The one "Mundo da Mata" every child shares (f-mundo-infinito.md §4.4). */
export const WORLD_SEED = subSeed(STORY_SEED, 20);

/** The hand-made Reserva da Iara: world [0, 160]², chunks (0..3, 0..3). */
export const RESERVE = {
	x0: 0,
	z0: 0,
	x1: WORLD_SIZE,
	z1: WORLD_SIZE,
	minChunk: 0,
	maxChunk: WORLD_SIZE / CHUNK_SIZE - 1
} as const;
/** Width of the band around the Reserva that F2 blends into it (WORLD.md §3). */
export const STITCH_BAND = 40;

/** True for the Reserva's chunks, which come from level/build.ts and are never generated. */
export function isHandMade(cx: number, cz: number): boolean {
	return cx >= RESERVE.minChunk && cx <= RESERVE.maxChunk && cz >= RESERVE.minChunk && cz <= RESERVE.maxChunk;
}

/** Distance from (x, z) to the Reserva's square, 0 inside. */
export function reserveDistance(x: number, z: number): number {
	const dx = x < RESERVE.x0 ? RESERVE.x0 - x : x > RESERVE.x1 ? x - RESERVE.x1 : 0;
	const dz = z < RESERVE.z0 ? RESERVE.z0 - z : z > RESERVE.z1 ? z - RESERVE.z1 : 0;
	return Math.sqrt(dx * dx + dz * dz);
}

/** How far z lies outside the Reserva's z range, 0 within it. */
export function outsideReserveZ(z: number): number {
	return z < RESERVE.z0 ? RESERVE.z0 - z : z > RESERVE.z1 ? z - RESERVE.z1 : 0;
}

/**
 * One independent stream per layer (subSeed k ≥ 21, clear of survival's
 * 1–14), so changing a layer never reshuffles the others.
 */
export interface LayerSeeds {
	coast: number;
	foot: number;
	warpX: number;
	warpZ: number;
	plain: number;
	morro: number;
	hills: number;
	ridge: number;
	river: number;
	exposure: number;
	pressure: number;
	trees: number;
	decorations: number;
	species: number;
}

const cachedSeeds = new Map<number, LayerSeeds>();

export function layerSeeds(seed: number): LayerSeeds {
	const known = cachedSeeds.get(seed);
	if (known) return known;
	const layers: LayerSeeds = {
		coast: subSeed(seed, 21),
		foot: subSeed(seed, 22),
		warpX: subSeed(seed, 23),
		warpZ: subSeed(seed, 24),
		plain: subSeed(seed, 25),
		morro: subSeed(seed, 26),
		hills: subSeed(seed, 27),
		ridge: subSeed(seed, 28),
		river: subSeed(seed, 29),
		exposure: subSeed(seed, 30),
		pressure: subSeed(seed, 31),
		trees: subSeed(seed, 32),
		decorations: subSeed(seed, 33),
		species: subSeed(seed, 34)
	};
	if (cachedSeeds.size > 64) cachedSeeds.clear();
	cachedSeeds.set(seed, layers);
	return layers;
}
