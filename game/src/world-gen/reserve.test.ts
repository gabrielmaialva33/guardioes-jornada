import { describe, expect, it } from 'vitest';
import { buildStoryWorld } from '../level/build.ts';
import { STORY_SEED } from '../level/layout.ts';
import { PARK_ZONES, ZONE_IDS, zoneOfChunk } from '../level/zones/spec.ts';
import { subSeed } from '../survival/random.ts';
import { BLOCK_SIZE, WORLD_SIZE } from '../survival/types.ts';
import { chunkChecksum } from './checksum.ts';
import { generateChunk } from './chunk.ts';
import { CHUNK_SIZE, isHandMade, RESERVE, WORLD_SEED } from './constants.ts';
import { chunkBytes } from './protocol.ts';

describe('the hand-made park', () => {
	it('is the Reserva, chunks (0..3, 0..3), and the four zones of PARK.md §2', () => {
		expect(CHUNK_SIZE).toBe(BLOCK_SIZE);
		expect([RESERVE.x0, RESERVE.z0, RESERVE.x1, RESERVE.z1]).toEqual([0, 0, WORLD_SIZE, WORLD_SIZE]);
		const reserva = PARK_ZONES.reserva;
		expect([reserva.cx0, reserva.cz0, reserva.cx1, reserva.cz1]).toEqual([0, 0, 3, 3]);
		let park = 0;
		for (let cz = -8; cz <= 10; cz++)
			for (let cx = -4; cx <= 10; cx++) {
				expect(isHandMade(cx, cz)).toBe(zoneOfChunk(cx, cz) !== null);
				if (isHandMade(cx, cz)) park++;
			}
		expect(park).toBe(88);
	});

	it('is flagged and never generated', () => {
		for (const id of ZONE_IDS) {
			const z = PARK_ZONES[id];
			for (let cz = z.cz0; cz <= z.cz1; cz++)
				for (let cx = z.cx0; cx <= z.cx1; cx++) {
					const c = generateChunk(cx, cz, WORLD_SEED);
					expect(c.handMade).toBe(true);
					expect([c.x0, c.z0, c.grid]).toEqual([cx * 40, cz * 40, 0]);
					expect(chunkBytes(c)).toBe(0);
					expect(c.trees.count + c.rocks.count + c.decorations.count).toBe(0);
					expect(chunkChecksum(c)).toBe(c.checksum);
				}
		}
	});

	it('keeps the ring around it procedural, with nothing placed inside any zone', () => {
		let ring = 0;
		for (let cz = -5; cz <= 8; cz++)
			for (let cx = -2; cx <= 8; cx++) {
				if (isHandMade(cx, cz)) continue;
				const touches = [-1, 0, 1].some((a) => [-1, 0, 1].some((b) => isHandMade(cx + a, cz + b)));
				if (!touches) continue;
				ring++;
				const c = generateChunk(cx, cz, WORLD_SEED);
				expect(c.handMade).toBe(false);
				for (const p of [c.trees, c.rocks, c.decorations])
					for (let k = 0; k < p.count; k++) {
						const inside = ZONE_IDS.some((id) => {
							const r = PARK_ZONES[id];
							return p.x[k] > r.x0 && p.x[k] < r.x1 && p.z[k] > r.z0 && p.z[k] < r.z1;
						});
						expect(inside).toBe(false);
					}
			}
		expect(ring).toBeGreaterThan(40);
	});

	it('comes out of level/build.ts the same after the endless world is generated around it', () => {
		const before = buildStoryWorld();
		for (let cz = -2; cz <= 5; cz++) for (let cx = -2; cx <= 5; cx++) generateChunk(cx, cz, WORLD_SEED);
		const after = buildStoryWorld();
		expect(after.world.checksum).toBe(before.world.checksum);
		expect(after.level.checksum).toBe(before.level.checksum);
	});

	it("derives the world seed from the level's story seed", () => {
		expect(WORLD_SEED).toBe(subSeed(STORY_SEED, 20));
	});
});
