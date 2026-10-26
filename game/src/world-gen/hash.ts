/**
 * Position hashes: every random decision of the endless world is a hash of an
 * integer cell and a layer seed, never a sequential Rng that walks across a
 * chunk (f-mundo-infinito.md §4.4), so the order of generation never matters.
 */
import { mix32 } from '../survival/random.ts';

/** Unsigned 32-bit hash of cell (i, j) in a layer. */
export function cellHash(i: number, j: number, seed: number): number {
	return mix32((Math.imul(i, 0x27d4eb2d) ^ Math.imul(j, 0x165667b1) ^ seed) | 0);
}

/** cellHash scaled to [0, 1). */
export function cellUnit(i: number, j: number, seed: number): number {
	return cellHash(i, j, seed) / 4294967296;
}
