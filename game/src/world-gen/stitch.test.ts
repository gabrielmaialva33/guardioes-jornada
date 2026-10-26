import { describe, expect, it } from 'vitest';
import { buildStoryWorld } from '../level/build.ts';
import { WALK_SLOPE } from '../survival/types.ts';
import { generateArea, generateChunk, heightWithApron } from './chunk.ts';
import { CHUNK_SIZE, WORLD_SEED } from './constants.ts';
import { RESERVA_EAST_COLUMNS } from './reserva-edge.ts';
import { EastStitch, eastWeight, insideReserva } from './stitch.ts';

const SEEDS = [WORLD_SEED, 1, 0xdeadbeef];
const story = buildStoryWorld().world;
const reserva = (x: number, z: number) => story.heights[z * story.grid + x];

/** The stitched ground over the band's table, x 120..200, z −40..200 (NaN inside the Reserva). */
function band(seed: number, stitch = true) {
	const a = generateArea(120, -40, 80, 240, seed, { stitch });
	return (x: number, z: number) =>
		insideReserva(x, z) ? Number.NaN : a.heights[(z + 40) * a.sideX + x - 120];
}

describe('east stitch band', () => {
	it("copies the Reserva's two east columns exactly", () => {
		for (const x of [159, 160] as const)
			for (let z = 0; z <= 160; z++)
				expect(
					RESERVA_EAST_COLUMNS[x][z],
					`level/build.ts changed: rerun world-gen/scripts/reserva-edge-table.ts (p9 report §9) into reserva-edge.ts, then re-pin chunk (4, 0)`
				).toBe(reserva(x, z));
	});

	it.each(SEEDS)('meets the Reserva at x 160 with no step (seed %i)', (seed) => {
		let worst = 0;
		for (let cz = -1; cz <= 4; cz++) {
			const c = generateChunk(4, cz, seed);
			for (let j = 0; j <= CHUNK_SIZE; j++) {
				const z = cz * CHUNK_SIZE + j;
				if (z < 0 || z > 160) continue;
				const seam = c.heights[j * c.grid];
				worst = Math.max(worst, Math.abs(seam - reserva(160, z)));
				expect(Math.abs(seam - reserva(160, z))).toBeLessThanOrEqual(0.25);
				// And on into the band: one walkable step east of the seam.
				expect(Math.abs(c.heights[j * c.grid + 1] - seam)).toBeLessThanOrEqual(WALK_SLOPE);
				// The apron west of the seam is the Reserva's own x = 159, for seamless normals.
				if (z > 0 && z < 160) expect(heightWithApron(c, -1, j)).toBe(reserva(159, z));
			}
		}
		expect(worst).toBe(0);
	});

	it.each(SEEDS)('is walkable through the band, every step under WALK_SLOPE (seed %i)', (seed) => {
		const h = band(seed);
		const diagonal = WALK_SLOPE * 1.41;
		let checked = 0;
		for (let z = -40; z < 200; z++)
			for (let x = 120; x < 200; x++) {
				if (Number.isNaN(h(x, z))) continue;
				for (const [dx, dz, limit] of [
					[1, 0, WALK_SLOPE],
					[0, 1, WALK_SLOPE],
					[1, 1, diagonal],
					[1, -1, diagonal]
				]) {
					const x2 = x + dx;
					const z2 = z + dz;
					if (Number.isNaN(h(x2, z2)) || (eastWeight(x, z) === 0 && eastWeight(x2, z2) === 0)) continue;
					// Pairs on the seam itself are the Reserva's own.
					if (x === 160 && x2 === 160 && z >= 0 && z2 <= 160) continue;
					checked++;
					expect(Math.abs(h(x2, z2) - h(x, z)), `(${x},${z})→(${x2},${z2})`).toBeLessThanOrEqual(limit);
				}
			}
		expect(checked).toBeGreaterThan(30000);
		// East from the seam the band climbs from the Reserva's ~10 u towards the serra's ~25.
		let rise = 0;
		for (let z = 0; z <= 160; z++) rise += h(200, z) - h(160, z);
		expect(rise / 161).toBeGreaterThan(8);
	});

	it.each(SEEDS)(
		'leaves the ground outside the band, and the closed sides, as they were (seed %i)',
		(seed) => {
			const stitched = band(seed);
			const bare = band(seed, false);
			let inside = 0;
			for (let z = -40; z <= 200; z++)
				for (let x = 120; x <= 200; x++) {
					if (Number.isNaN(bare(x, z))) continue;
					if (eastWeight(x, z) === 0) expect(Object.is(stitched(x, z), bare(x, z)), `(${x},${z})`).toBe(true);
					else inside++;
				}
			expect(inside).toBeGreaterThan(8000);
			// The north band west of the corner disc and the far side of the chunk east of the band.
			for (const [cx, cz] of [
				[1, -1],
				[2, 4],
				[5, 1],
				[-1, 2]
			]) {
				const c = generateChunk(cx, cz, seed);
				const a = generateArea(cx * CHUNK_SIZE, cz * CHUNK_SIZE, CHUNK_SIZE, CHUNK_SIZE, seed, {
					stitch: false
				});
				expect(c.heights).toEqual(a.heights);
			}
		}
	);

	it('builds its table the same every time, and cheaply', () => {
		const a = new EastStitch(WORLD_SEED);
		const b = new EastStitch(WORLD_SEED);
		for (let z = -40; z <= 200; z += 3)
			for (let x = 159; x <= 200; x++) expect(Object.is(a.height(x, z), b.height(x, z))).toBe(true);
		expect(a.updates).toBeLessThan(64 * 10000);
	});
});
