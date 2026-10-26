import { describe, expect, it } from 'vitest';
import { buildStoryWorld } from '../level/build.ts';
import { STORY_SEED } from '../level/layout.ts';
import { subSeed } from '../survival/random.ts';
import { BLOCK_SIZE, WORLD_SIZE } from '../survival/types.ts';
import { generateChunk } from './chunk.ts';
import { chunkChecksum } from './checksum.ts';
import { CHUNK_SIZE, isHandMade, RESERVE, WORLD_SEED } from './constants.ts';
import { chunkBytes } from './protocol.ts';

/** level/build.test.ts's pins: generating the endless world must leave the Reserva exactly as it is. */
const GOLDEN_WORLD = 0x58158de7;
const GOLDEN_LEVEL = 0x4e8295c1;

describe('the hand-made Reserva', () => {
	it('is chunks (0..3, 0..3), the level square', () => {
		expect(CHUNK_SIZE).toBe(BLOCK_SIZE);
		expect([RESERVE.x0, RESERVE.z0, RESERVE.x1, RESERVE.z1]).toEqual([0, 0, WORLD_SIZE, WORLD_SIZE]);
		for (let cz = -2; cz <= 5; cz++)
			for (let cx = -2; cx <= 5; cx++)
				expect(isHandMade(cx, cz)).toBe(cx >= 0 && cx <= 3 && cz >= 0 && cz <= 3);
	});

	it('is flagged and never generated', () => {
		for (let cz = 0; cz <= 3; cz++)
			for (let cx = 0; cx <= 3; cx++) {
				const c = generateChunk(cx, cz, WORLD_SEED);
				expect(c.handMade).toBe(true);
				expect([c.x0, c.z0, c.grid]).toEqual([cx * 40, cz * 40, 0]);
				expect(chunkBytes(c)).toBe(0);
				expect(c.trees.count + c.rocks.count + c.decorations.count).toBe(0);
				expect(c.collision.heights).toHaveLength(0);
				expect(chunkChecksum(c)).toBe(c.checksum);
			}
	});

	it('keeps the ring around it procedural, with nothing placed inside it', () => {
		for (let cz = -1; cz <= 4; cz++)
			for (let cx = -1; cx <= 4; cx++) {
				if (isHandMade(cx, cz)) continue;
				const c = generateChunk(cx, cz, WORLD_SEED);
				expect(c.handMade).toBe(false);
				for (const p of [c.trees, c.rocks, c.decorations])
					for (let k = 0; k < p.count; k++) {
						const inside = p.x[k] > 0 && p.x[k] < 160 && p.z[k] > 0 && p.z[k] < 160;
						expect(inside).toBe(false);
					}
			}
	});

	it('keeps its golden checksums after the endless world is generated around it', () => {
		for (let cz = -2; cz <= 5; cz++) for (let cx = -2; cx <= 5; cx++) generateChunk(cx, cz, WORLD_SEED);
		const { world, level } = buildStoryWorld();
		expect(world.checksum).toBe(GOLDEN_WORLD);
		expect(level.checksum).toBe(GOLDEN_LEVEL);
	});

	it("derives the world seed from the level's story seed", () => {
		expect(WORLD_SEED).toBe(subSeed(STORY_SEED, 20));
	});
});
