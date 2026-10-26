import { describe, expect, it } from 'vitest';
import { PARK_ZONES } from '../../level/zones/spec.ts';
import type { ZoneBuild } from '../../level/zones/zone.ts';
import { buildChunk, fieldAt, park, SEAMS, waterCoverage } from './fixtures.test-helper.ts';
import { CHUNK_SIDE, CHUNK_SIZE, chunkOf } from './types.ts';
import { FALL_STEP, SHORE_FAR } from './water.ts';

/** Every attribute of water vertex (i, j), positions in world space. */
const waterVertex = (b: ReturnType<typeof buildChunk>, i: number, j: number) => {
	const v = j * CHUNK_SIDE + i;
	const w = b.water;
	return [
		...w.position.subarray(v * 3, v * 3 + 3),
		...w.color.subarray(v * 3, v * 3 + 3),
		...w.water.subarray(v * 2, v * 2 + 2),
		...w.normal.subarray(v * 3, v * 3 + 3),
		...fieldAt(b.field, i, j),
		...b.terrain.shore.subarray(v * 2, v * 2 + 2)
	];
};

/** The shared edge's vertices of a and b (b is a's neighbour). */
function edge(ax: number, az: number, bx: number, bz: number, k: number) {
	const east = bx - ax;
	const south = bz - az;
	const a = east === 1 ? [40, k] : east === -1 ? [0, k] : south === 1 ? [k, 40] : [k, 0];
	const b = east === 1 ? [0, k] : east === -1 ? [40, k] : south === 1 ? [k, 0] : [k, 40];
	return { a, b };
}

describe('streamed water', () => {
	it('is seamless across every seam kind: field, water mesh and terrain shore', () => {
		let wet = 0;
		for (const [ax, az, bx, bz, name] of SEAMS) {
			const a = buildChunk(ax, az);
			const b = buildChunk(bx, bz);
			let both = 0;
			for (let k = 0; k < CHUNK_SIDE; k++) {
				const e = edge(ax, az, bx, bz, k);
				const va = waterVertex(a, e.a[0], e.a[1]);
				const vb = waterVertex(b, e.b[0], e.b[1]);
				expect(vb, `${name} k=${k}`).toEqual(va);
				if (va[6] <= 0.6) both++;
			}
			if (both > 0 && a.water.count > 0 && b.water.count > 0) wet++;
		}
		// Most of the seams carry water across them (rivers, the sea, the flooded mangrove).
		expect(wet).toBeGreaterThanOrEqual(6);
	});

	it('draws the same water as shore.ts waterSurface on the Reserva, value for value', async () => {
		const { waterField, waterSurface } = await import('../shore.ts');
		const reserva = park.get('reserva') as ZoneBuild;
		const surface = waterSurface(reserva.world, reserva.level.pool);
		const cells = new Set<number>();
		const position = surface.getAttribute('position');
		const index = surface.getIndex();
		if (!index) throw new Error('waterSurface is indexed');
		for (let k = 0; k < index.count; k += 6) {
			const v = index.getX(k);
			cells.add(Math.round(position.getZ(v)) * 160 + Math.round(position.getX(v)));
		}
		const sample = { height: 0, distance: 0, depth: 0 };
		for (const [cx, cz] of [
			[1, 1],
			[1, 2],
			[2, 1],
			[2, 2]
		]) {
			const b = buildChunk(cx, cz);
			expect(b.bodies.sea).toBe(false);
			for (let j = 0; j < CHUNK_SIDE; j++)
				for (let i = 0; i < CHUNK_SIDE; i++) {
					const x = cx * CHUNK_SIZE + i;
					const z = cz * CHUNK_SIZE + j;
					waterField(reserva.world, reserva.level.pool, x, z, sample);
					const [h, d, depth] = fieldAt(b.field, i, j);
					if (sample.distance > 31) continue;
					expect(Math.abs(h - Math.fround(sample.height))).toBeLessThan(1e-5);
					expect(Math.abs(d - Math.fround(sample.distance))).toBeLessThan(1e-4);
					expect(Math.abs(depth - Math.fround(sample.depth))).toBeLessThan(1e-5);
				}
			const covered = waterCoverage(b.water);
			for (let j = 0; j < CHUNK_SIZE; j++)
				for (let i = 0; i < CHUNK_SIZE; i++) {
					const wanted = cells.has((cz * CHUNK_SIZE + j) * 160 + cx * CHUNK_SIZE + i) ? 1 : 0;
					expect(covered[j * CHUNK_SIZE + i], `cell ${cx * 40 + i},${cz * 40 + j}`).toBe(wanted);
				}
		}
	});

	it('covers the open sea in a few quads and keeps the coast at 1 u', () => {
		const sea = buildChunk(-4, 2);
		expect(sea.water.count).toBe(6);
		expect(waterCoverage(sea.water).every((c) => c === 1)).toBe(true);
		// The Praia's beach: the sea's edge runs through the chunk.
		const coast = buildChunk(-1, -2);
		const covered = waterCoverage(coast.water);
		expect(covered.some((c) => c === 0)).toBe(true);
		expect(covered.some((c) => c === 1)).toBe(true);
		expect(covered.every((c) => c <= 1)).toBe(true);
		// Foam runs along the coast: the field crosses zero inside the chunk.
		let crossings = 0;
		for (let j = 0; j < CHUNK_SIDE; j++)
			for (let i = 0; i < CHUNK_SIZE; i++)
				if (Math.sign(fieldAt(coast.field, i, j)[1]) !== Math.sign(fieldAt(coast.field, i + 1, j)[1]))
					crossings++;
		expect(crossings).toBeGreaterThan(10);
	});

	it("fills the Praia's tide pools and the Manguezal's flooded mangrove", () => {
		const praia = park.get('praia') as ZoneBuild;
		for (const basin of praia.level.content?.basins ?? []) {
			const x = basin.a[0] + praia.offsetX;
			const z = basin.a[1] + praia.offsetZ;
			const b = buildChunk(chunkOf(x), chunkOf(z));
			const i = Math.floor(x) - b.chunk.x0;
			const j = Math.floor(z) - b.chunk.z0;
			expect(waterCoverage(b.water)[j * CHUNK_SIZE + i], basin.id).toBe(1);
			expect(fieldAt(b.field, i, j)[1]).toBeLessThan(0);
		}
		const m = PARK_ZONES.manguezal;
		let wet = 0;
		for (let cz = m.cz0; cz <= m.cz1; cz++)
			for (let cx = m.cx0; cx <= m.cx1; cx++)
				wet += waterCoverage(buildChunk(cx, cz).water).filter((c) => c).length;
		expect(wet).toBeGreaterThan(20 * 1600 * 0.25);
	});

	it("leaves the Vale's fall to the waterfall model and draws the river above and below it", () => {
		const vale = park.get('vale') as ZoneBuild;
		const fall = vale.level.landmarks.find((l) => l.kind === 'waterfall');
		if (!fall) throw new Error('the Vale has its fall');
		const cx = chunkOf(fall.x + vale.offsetX);
		const ys = new Set<number>();
		// The lip sits on a chunk edge (z 40): the chunks either side of it.
		for (const cz of [0, 1]) {
			const w = buildChunk(cx, cz).water;
			for (let k = 0; k < w.count; k += 3) {
				const tri = [0, 1, 2].map((q) => w.position[w.index[k + q] * 3 + 1]);
				expect(Math.max(...tri) - Math.min(...tri)).toBeLessThanOrEqual(FALL_STEP);
			}
			for (let k = 0; k < w.count; k++) ys.add(Math.round(w.position[w.index[k] * 3 + 1]));
		}
		expect([...ys].some((y) => y >= 49)).toBe(true);
		expect([...ys].some((y) => y <= 31)).toBe(true);
	});

	it('writes no water and no shore where there is none', () => {
		const copa = buildChunk(5, -2);
		expect(copa.water.count).toBe(0);
		for (let v = 0; v < copa.terrain.shore.length; v += 2) {
			expect(copa.terrain.shore[v]).toBe(-SHORE_FAR);
			expect(copa.terrain.shore[v + 1]).toBe(SHORE_FAR);
		}
		// No sea in or around the Reserva's middle: its carved river bed below sea level stays the river's.
		expect(buildChunk(1, 1).bodies.sea).toBe(false);
	});
});
