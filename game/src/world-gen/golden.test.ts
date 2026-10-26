import { describe, expect, it } from 'vitest';
import { generateChunk } from './chunk.ts';
import { chunkChecksum } from './checksum.ts';
import { DETAIL_VERSION, MACRO_VERSION, WORLD_SEED } from './constants.ts';

/**
 * Pinned for MACRO_VERSION 1 / DETAIL_VERSION 1: near the Reserva (the band,
 * the serra east of it), a wide baixada, the crest, the planalto and far away.
 * A change here means chunks changed: bump the version that covers it and
 * re-pin (saves reference both, f-mundo-infinito.md §4.4, §4.14). The same
 * values must come out of every engine (the Chrome Worker benchmark prints them).
 */
export const GOLDEN_CHUNKS: [number, number][] = [
	[4, 0],
	[-1, 2],
	[2, -1],
	[7, -5],
	[12, 25],
	[20, 9],
	[30, 30],
	[-20, 400],
	[2500, -3100]
];
export const GOLDEN: Record<number, number[]> = {
	[WORLD_SEED]: [],
	1: [],
	[0xdeadbeef]: []
};

describe('golden chunk checksums', () => {
	it('keep their versions', () => {
		expect(MACRO_VERSION).toBe(1);
		expect(DETAIL_VERSION).toBe(1);
		expect(WORLD_SEED).toBe(1499388684);
	});

	it.each(Object.keys(GOLDEN).map(Number))('seed %i', (seed) => {
		const sums = GOLDEN_CHUNKS.map(([cx, cz]) => {
			const c = generateChunk(cx, cz, seed);
			expect(chunkChecksum(c)).toBe(c.checksum);
			return c.checksum;
		});
		expect(sums.map((s) => `0x${s.toString(16)}`)).toEqual(GOLDEN[seed].map((s) => `0x${s.toString(16)}`));
	});
});
