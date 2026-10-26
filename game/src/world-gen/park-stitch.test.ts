import { describe, expect, it } from 'vitest';
import { buildPark } from '../level/zones/park.ts';
import { zoneHeight } from '../level/zones/zone.ts';
import { floor } from '../survival/noise.ts';
import { generateArea, generateChunk } from './chunk.ts';
import { CHUNK_SIZE, STITCH_BAND, WORLD_SEED } from './constants.ts';
import { PARK_BOUNDARY, parkDistance, zoneOfChunk } from './park.ts';
import { PARK_EDGE_HEIGHTS } from './park-edges.ts';

const park = buildPark();
const SEEDS = [WORLD_SEED, 1, 0xdeadbeef];

/** Every vertex of an edge, with its world position. */
function* along(e: (typeof PARK_BOUNDARY)[number]) {
	for (let k = e.from; k <= e.to; k++)
		yield e.side === 'west' || e.side === 'east' ? { k, x: e.at, z: k } : { k, x: k, z: e.at };
}

/** The generated chunk just outside an edge at a vertex, and the vertex's index in it. */
function outside(e: (typeof PARK_BOUNDARY)[number], x: number, z: number) {
	// A vertex on a chunk line belongs to both chunks: take the one across the edge, and clamp the
	// other axis into the edge's own chunk span.
	const cx =
		e.side === 'west'
			? floor(x / CHUNK_SIZE) - 1
			: e.side === 'east'
				? floor(x / CHUNK_SIZE)
				: floor(Math.min(x, e.to - 1) / CHUNK_SIZE);
	const cz =
		e.side === 'north'
			? floor(z / CHUNK_SIZE) - 1
			: e.side === 'south'
				? floor(z / CHUNK_SIZE)
				: floor(Math.min(z, e.to - 1) / CHUNK_SIZE);
	return { cx, cz, i: x - cx * CHUNK_SIZE, j: z - cz * CHUNK_SIZE };
}

describe('the park stitch', () => {
	it('walks the whole outer boundary of the park, 1,760 u in 12 edges, each facing the generated world', () => {
		expect(PARK_BOUNDARY).toHaveLength(12);
		expect(PARK_BOUNDARY.reduce((sum, e) => sum + e.to - e.from, 0)).toBe(1760);
		for (const e of PARK_BOUNDARY)
			for (const { x, z } of along(e)) {
				if ((e.side === 'west' || e.side === 'east') && (z === e.from || z === e.to)) continue;
				if ((e.side === 'north' || e.side === 'south') && (x === e.from || x === e.to)) continue;
				const { cx, cz } = outside(e, x, z);
				expect(zoneOfChunk(cx, cz), `${e.zone} ${e.side} ${x},${z}`).toBe(null);
			}
	});

	it("holds the zones' current heights along it", () => {
		PARK_BOUNDARY.forEach((e, n) => {
			const zone = park.get(e.zone);
			if (!zone) throw new Error(e.zone);
			for (const { k, x, z } of along(e))
				expect(
					PARK_EDGE_HEIGHTS[n][k - e.from],
					'a zone changed: rerun world-gen/scripts/park-edges-table.ts (p20-zonas.md) into park-edges.ts, then re-pin the golden chunks by the park'
				).toBe(zoneHeight(zone, x, z));
		});
	});

	it('agrees with itself where two edges meet', () => {
		const at = new Map<string, number>();
		PARK_BOUNDARY.forEach((e, n) => {
			for (const { k, x, z } of along(e)) {
				const key = `${x},${z}`;
				const h = PARK_EDGE_HEIGHTS[n][k - e.from];
				const known = at.get(key);
				if (known !== undefined) expect(h, key).toBe(known);
				at.set(key, h);
			}
		});
	});

	it.each(SEEDS)('meets every zone with no step on the whole boundary (seed %i)', (seed) => {
		const chunks = new Map<string, ReturnType<typeof generateChunk>>();
		let worst = 0;
		let checked = 0;
		for (const e of PARK_BOUNDARY) {
			const zone = park.get(e.zone);
			if (!zone) throw new Error(e.zone);
			for (const { x, z } of along(e)) {
				const { cx, cz, i, j } = outside(e, x, z);
				if (zoneOfChunk(cx, cz) !== null) continue;
				const key = `${cx},${cz}`;
				let c = chunks.get(key);
				if (!c) {
					c = generateChunk(cx, cz, seed);
					chunks.set(key, c);
				}
				const diff = Math.abs(c.heights[j * c.grid + i] - zoneHeight(zone, x, z));
				worst = Math.max(worst, diff);
				expect(diff, `${e.zone} ${e.side} ${x},${z}`).toBeLessThanOrEqual(0.25);
				checked++;
			}
		}
		expect(worst).toBe(0);
		expect(checked).toBeGreaterThan(1700);
	});

	it('leaves the generated ground past the band as it was', () => {
		for (const [cx, cz] of [
			[9, 1],
			[-3, -1],
			[5, 6],
			[-2, 9]
		]) {
			const stitched = generateArea(cx * CHUNK_SIZE, cz * CHUNK_SIZE, CHUNK_SIZE, CHUNK_SIZE, WORLD_SEED);
			const bare = generateArea(cx * CHUNK_SIZE, cz * CHUNK_SIZE, CHUNK_SIZE, CHUNK_SIZE, WORLD_SEED, {
				stitch: false
			});
			let far = 0;
			for (let j = 0; j <= CHUNK_SIZE; j++)
				for (let i = 0; i <= CHUNK_SIZE; i++) {
					const q = j * stitched.sideX + i;
					if (parkDistance(cx * CHUNK_SIZE + i, cz * CHUNK_SIZE + j) < STITCH_BAND) continue;
					expect(Object.is(stitched.heights[q], bare.heights[q]), `${cx},${cz} (${i},${j})`).toBe(true);
					far++;
				}
			expect(far, `${cx},${cz}`).toBeGreaterThan(0);
		}
	});
});
