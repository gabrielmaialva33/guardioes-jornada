import { describe, expect, it } from 'vitest';
import { Rng } from '../survival/random.ts';
import { generateArea, generateChunk } from './chunk.ts';
import { chunkChecksum } from './checksum.ts';
import { CHUNK_SIZE, WORLD_SEED } from './constants.ts';
import { clearRiverCaches } from './rivers.ts';

const CHUNKS: [number, number][] = [];
for (let cz = -3; cz <= 6; cz++) for (let cx = -2; cx <= 8; cx++) CHUNKS.push([cx, cz]);
CHUNKS.push([300, -77], [-5, 1200], [2000, 2000], [17, -4000]);

function checksums(order: [number, number][], seed: number): Map<string, number> {
	const out = new Map<string, number>();
	for (const [cx, cz] of order) out.set(`${cx},${cz}`, generateChunk(cx, cz, seed).checksum);
	return out;
}

describe('generation order', () => {
	it('never changes a chunk', () => {
		clearRiverCaches();
		const forward = checksums(CHUNKS, WORLD_SEED);
		clearRiverCaches();
		const backward = checksums([...CHUNKS].reverse(), WORLD_SEED);
		clearRiverCaches();
		const rng = new Rng(7);
		const shuffled = [...CHUNKS];
		for (let k = shuffled.length - 1; k > 0; k--) {
			const j = rng.int(k + 1);
			[shuffled[k], shuffled[j]] = [shuffled[j], shuffled[k]];
		}
		const random = checksums(shuffled, WORLD_SEED);
		// Interleaved with other seeds, warm caches.
		const mixed = new Map<string, number>();
		for (const [cx, cz] of shuffled) {
			generateChunk(cz, cx, 99);
			mixed.set(`${cx},${cz}`, generateChunk(cx, cz, WORLD_SEED).checksum);
		}
		for (const [key, sum] of forward) {
			expect(backward.get(key), key).toBe(sum);
			expect(random.get(key), key).toBe(sum);
			expect(mixed.get(key), key).toBe(sum);
		}
	});

	it('gives each chunk the bits of any bigger area around it', () => {
		const area = generateArea(-2 * CHUNK_SIZE, 4 * CHUNK_SIZE, 3 * CHUNK_SIZE, 2 * CHUNK_SIZE, WORLD_SEED);
		for (let b = 0; b < 2; b++)
			for (let a = 0; a < 3; a++) {
				const c = generateChunk(a - 2, b + 4, WORLD_SEED);
				for (let j = 0; j <= CHUNK_SIZE; j++)
					for (let i = 0; i <= CHUNK_SIZE; i++) {
						const q = j * c.grid + i;
						const p = (b * CHUNK_SIZE + j) * area.sideX + a * CHUNK_SIZE + i;
						expect(Object.is(c.heights[q], area.heights[p])).toBe(true);
						expect(c.flags[q]).toBe(area.flags[p]);
						expect(c.zones[q]).toBe(area.zones[p]);
					}
			}
	});

	it('checksums what it holds', () => {
		const c = generateChunk(9, -2, WORLD_SEED);
		expect(chunkChecksum(c)).toBe(c.checksum);
		c.heights[100] += 0.25;
		expect(chunkChecksum(c)).not.toBe(c.checksum);
		const seeds = new Set([1, 2, 3, 4, 5, 6].map((s) => generateChunk(9, -2, s).checksum));
		expect(seeds.size).toBe(6);
	});
});
