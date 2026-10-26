import { describe, expect, it } from 'vitest';
import { chunkChecksum } from './checksum.ts';
import { generateChunk } from './chunk.ts';
import { DETAIL_VERSION, MACRO_VERSION, WORLD_SEED } from './constants.ts';

/**
 * Pinned for MACRO_VERSION 1 / DETAIL_VERSION 1: near the Reserva (the band,
 * the serra east of it), a wide baixada, the crest, the planalto and far away.
 * A change here means chunks changed: bump the version that covers it and
 * re-pin (saves reference both, f-mundo-infinito.md §4.4, §4.14). The same
 * values must come out of every engine (the Chrome Worker benchmark prints them).
 * F1 prep re-pinned only (4, 0), the one golden chunk in the east stitch band;
 * versions stay 1 because nothing has been saved yet (saves start in F3).
 * F1 part 1 (the east portal) left all nine as they were and added (4, 1),
 * the chunk the portal opens into. P20 (the park's zones) made (4, 0), (2, −1)
 * and (4, 1) hand-made (now empty), changed (−1, 2) and (7, −5) in the park's
 * stitch band, and added (8, 1) and (4, 4), generated chunks in that band;
 * the five far chunks stayed as they were.
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
	[2500, -3100],
	[4, 1],
	[8, 1],
	[4, 4]
];
export const GOLDEN: Record<number, number[]> = {
	[WORLD_SEED]: [
		0xc86f92fb, 0xadbebc34, 0x70aed70d, 0x99b33571, 0x710db001, 0xcad9938e, 0x555b0596, 0xaee93750,
		0x022d955d, 0x998374cc, 0x408f436c, 0xca3dcaf7
	],
	1: [
		0x113184c1, 0x450effa6, 0x6d490df3, 0xfdea417a, 0x299a6b62, 0x82bd2047, 0xd7d5fe66, 0xaec0c1ab,
		0x32be8ff5, 0xeb2e393d, 0x58522799, 0xa3b4801a
	],
	/** 0xdeadbeef */
	3735928559: [
		0x53517cb9, 0x09804d8a, 0xd0449df8, 0xa70a8625, 0x5b1b8584, 0x97983496, 0xa558f4a2, 0x4399c02a,
		0xa88fa091, 0xcae63a86, 0x1fa03768, 0xdd8f6b26
	]
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
