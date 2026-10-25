import { describe, expect, it } from 'vitest';
import { MAX_SLOPE } from '../engine/constants.ts';
import { checksumOf } from './checksum.ts';
import { generateWorld } from './generate.ts';
import { heightAt } from './terrain.ts';
import {
	BLOCK_SIZE,
	BLOCKS_PER_SIDE,
	COLLISION_STEP,
	DECORATION_KINDS,
	GENERATOR_VERSION,
	GRID,
	type Placements,
	RESPONDER,
	ROCK_KINDS,
	THREAT_MIN_BASE_DISTANCE,
	TREE_SPECIES,
	WALK_SLOPE,
	ZONE
} from './types.ts';

/**
 * Pinned for GENERATOR_VERSION 1; the same values came out of Node 26 (JIT and
 * --jitless), Chromium 151 and Firefox 157. A change here means the maps
 * changed: bump GENERATOR_VERSION and re-pin.
 */
const GOLDEN: [number, number][] = [
	[1, 0x82012546],
	[20261025, 0xa62ac128],
	[0xdeadbeef, 0x5a581d28]
];

describe('survival generator', () => {
	it.each(GOLDEN)('seed %i keeps its golden checksum', (seed, checksum) => {
		const world = generateWorld(seed);
		expect(world.generatorVersion).toBe(GENERATOR_VERSION);
		expect(world.seed).toBe(seed);
		expect(world.problems).toEqual([]);
		expect(world.checksum).toBe(checksum);
		expect(checksumOf(world)).toBe(checksum);
	});

	it('rebuilds the same map from the same seed', () => {
		const a = generateWorld(77);
		const b = generateWorld(77);
		expect(b.checksum).toBe(a.checksum);
		expect(b.heights).toEqual(a.heights);
		expect(b.trees).toEqual(a.trees);
		expect(b.threats).toEqual(a.threats);
	});

	it('gives different maps for different seeds', () => {
		const checksums = new Set<number>();
		for (let seed = 5000; seed < 5024; seed++) checksums.add(generateWorld(seed).checksum);
		expect(checksums.size).toBe(24);
		const a = generateWorld(5000);
		const b = generateWorld(5001);
		let same = 0;
		for (let q = 0; q < a.heights.length; q++) if (a.heights[q] === b.heights[q]) same++;
		expect(same / a.heights.length).toBeLessThan(0.05);
		expect(a.trees.count === b.trees.count && a.trees.x[0] === b.trees.x[0]).toBe(false);
	});

	it('orders the zones from the sea to the serra', () => {
		const order = [ZONE.sea, ZONE.beach, ZONE.restinga, ZONE.lowland, ZONE.slope, ZONE.highland];
		for (const seed of [1, 2, 3, 20261025, 0xdeadbeef]) {
			const { zones } = generateWorld(seed);
			const sum = new Float64Array(8);
			const count = new Float64Array(8);
			for (let q = 0; q < zones.length; q++) {
				sum[zones[q]] += q % GRID;
				count[zones[q]]++;
			}
			const meanX = (zone: number) => sum[zone] / count[zone];
			for (const zone of [...order, ZONE.mangrove, ZONE.river]) expect(count[zone]).toBeGreaterThan(0);
			for (let k = 1; k < order.length; k++) expect(meanX(order[k])).toBeGreaterThan(meanX(order[k - 1]));
			expect(meanX(ZONE.mangrove)).toBeLessThan(meanX(ZONE.lowland));
			// The campo de altitude is the top 5% of heights, so it always exists.
			expect(count[ZONE.highland] / zones.length).toBeGreaterThan(0.03);
		}
	});

	it('walks no steeper than the character controller climbs', () => {
		expect(WALK_SLOPE).toBeLessThan(Math.tan(MAX_SLOPE));
		for (const seed of [1, 20261025]) {
			for (const crossing of generateWorld(seed).crossings) {
				if (crossing.kind === 'stepping-stones') {
					expect(crossing.stones.length).toBeGreaterThan(2);
					continue;
				}
				const dx = crossing.to.x - crossing.from.x;
				const dz = crossing.to.z - crossing.from.z;
				const rise = Math.abs(crossing.to.y - crossing.from.y);
				expect(rise / Math.sqrt(dx * dx + dz * dz)).toBeLessThan(WALK_SLOPE);
				expect(Math.min(crossing.from.y, crossing.to.y)).toBeGreaterThanOrEqual(crossing.water + 0.5);
			}
		}
	});

	it('sorts instances by block, then kind, and counts them', () => {
		const world = generateWorld(20261025);
		const check = (set: Placements<string>, prefix: string) => {
			let total = 0;
			for (const kind of set.kinds) total += world.counts[`${prefix}:${kind}`];
			expect(total).toBe(set.count);
			for (let k = 0; k < set.count; k++) {
				const bx = Math.min(BLOCKS_PER_SIDE - 1, Math.floor(set.x[k] / BLOCK_SIZE));
				const bz = Math.min(BLOCKS_PER_SIDE - 1, Math.floor(set.z[k] / BLOCK_SIZE));
				expect(set.block[k]).toBe(bz * BLOCKS_PER_SIDE + bx);
				if (k > 0)
					expect(set.block[k] * 256 + set.kind[k]).toBeGreaterThanOrEqual(
						set.block[k - 1] * 256 + set.kind[k - 1]
					);
				expect(set.y[k]).toBeCloseTo(heightAt(world.heights, set.x[k], set.z[k]), 4);
				expect(set.yawC[k] ** 2 + set.yawS[k] ** 2).toBeCloseTo(1, 5);
			}
		};
		check(world.trees, 'tree');
		check(world.rocks, 'rock');
		check(world.decorations, 'decoration');
		expect(world.trees.kinds).toBe(TREE_SPECIES);
		expect(world.rocks.kinds).toBe(ROCK_KINDS);
		expect(world.decorations.kinds).toBe(DECORATION_KINDS);
	});

	it('describes collision per 40 u block', () => {
		const world = generateWorld(20261025);
		const per = BLOCK_SIZE / COLLISION_STEP + 1;
		expect(world.blocks).toHaveLength(BLOCKS_PER_SIDE * BLOCKS_PER_SIDE);
		let cylinders = 0;
		let boxes = 0;
		let decks = 0;
		for (const block of world.blocks) {
			expect(block.heights).toHaveLength(per * per);
			expect(block.heights[0]).toBe(world.heights[block.z0 * GRID + block.x0]);
			expect(block.heights[per * per - 1]).toBe(
				world.heights[(block.z0 + BLOCK_SIZE) * GRID + block.x0 + BLOCK_SIZE]
			);
			expect(block.minY).toBeLessThanOrEqual(block.maxY);
			expect(block.cylinders.length % 5).toBe(0);
			expect(block.boxes.length % 8).toBe(0);
			expect(block.decks.length % 8).toBe(0);
			for (let k = 0; k < block.cylinders.length; k += 5) {
				expect(block.cylinders[k]).toBeGreaterThanOrEqual(block.x0);
				expect(block.cylinders[k]).toBeLessThanOrEqual(block.x0 + BLOCK_SIZE);
			}
			cylinders += block.cylinders.length / 5;
			boxes += block.boxes.length / 8;
			decks += block.decks.length / 8;
		}
		const stones = world.crossings.reduce((n, c) => n + c.stones.length, 0);
		expect(cylinders).toBe(world.trees.count + world.counts['rock:boulder'] + stones);
		expect(boxes).toBe(world.counts['rock:log']);
		expect(decks).toBe(3);
	});

	it('samples heights bilinearly', () => {
		const { heights } = generateWorld(1);
		expect(heightAt(heights, 10, 20)).toBe(heights[20 * GRID + 10]);
		const mid = (heights[20 * GRID + 10] + heights[20 * GRID + 11]) / 2;
		expect(heightAt(heights, 10.5, 20)).toBeCloseTo(mid, 6);
		expect(heightAt(heights, -5, 200)).toBe(heights[160 * GRID]);
	});

	it('keeps threats away from the base and leaves them to adults', () => {
		const world = generateWorld(20261025);
		for (const slot of world.threats) {
			expect(Math.hypot(slot.x - world.base.x, slot.z - world.base.z)).toBeGreaterThanOrEqual(
				THREAT_MIN_BASE_DISTANCE
			);
			expect(slot.responder).toBe(RESPONDER[slot.kind]);
		}
		expect(world.threats.some((slot) => slot.seenFromLookout)).toBe(true);
		expect(world.counts.planting).toBe(world.corridor.cells.length);
		expect(world.corridor.cells.length).toBeGreaterThanOrEqual(16);
	});
});
