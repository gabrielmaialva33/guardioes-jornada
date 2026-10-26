import { describe, expect, it } from 'vitest';
import { buildPark } from '../../level/zones/park.ts';
import { PARK_ZONES, ZONE_IDS, type ZoneId } from '../../level/zones/spec.ts';
import type { ZoneBuild } from '../../level/zones/zone.ts';
import { generateChunk } from '../../world-gen/chunk.ts';
import { fromWorldChunk } from './generated.ts';
import { apronHeight, CHUNK_SIDE, CHUNK_SIZE, type StreamChunk } from './types.ts';
import { buildZoneOnDemand, cutZone, zoneClosure } from './zone-cut.ts';

const park = buildPark();
const cuts = new Map(ZONE_IDS.map((id) => [id, cutZone(park.get(id) as ZoneBuild, park)]));
const zoneChunk = (cx: number, cz: number): StreamChunk | undefined => {
	for (const cut of cuts.values()) {
		const c = cut.chunks.find((k) => k.cx === cx && k.cz === cz);
		if (c) return c;
	}
	return undefined;
};
const anyChunk = (cx: number, cz: number): StreamChunk =>
	zoneChunk(cx, cz) ?? (fromWorldChunk(generateChunk(cx, cz)) as StreamChunk);

describe('park zones as chunks', () => {
	it('builds a zone with only the zones its seams read', () => {
		expect(zoneClosure('reserva')).toEqual(['reserva']);
		expect(zoneClosure('vale')).toEqual(['reserva', 'vale']);
		expect(zoneClosure('manguezal')).toEqual(['reserva', 'manguezal']);
		expect(zoneClosure('copa')).toEqual(['reserva', 'vale', 'praia', 'copa']);
	});

	it('gives every zone the same build as the whole park, whatever zone comes first', () => {
		for (const id of ZONE_IDS) {
			const built = new Map<ZoneId, ZoneBuild>();
			const zone = buildZoneOnDemand(id, built);
			expect([...built.keys()]).toEqual(zoneClosure(id));
			const whole = park.get(id) as ZoneBuild;
			expect([zone.world.checksum, zone.level.checksum]).toEqual([
				whole.world.checksum,
				whole.level.checksum
			]);
		}
	});

	it('cuts each zone into its chunk rectangle with every sample, placement and collider', () => {
		for (const id of ZONE_IDS) {
			const zone = park.get(id) as ZoneBuild;
			const cut = cuts.get(id);
			if (!cut) throw new Error(id);
			const spec = PARK_ZONES[id];
			expect(cut.chunks.length).toBe((spec.cx1 - spec.cx0 + 1) * (spec.cz1 - spec.cz0 + 1));
			let trees = 0;
			let rocks = 0;
			let decorations = 0;
			let cylinders = 0;
			for (const c of cut.chunks) {
				expect(c.origin).toBe('zone');
				expect(c.zone).toBe(id);
				expect(c.story?.level).toBe(zone.level);
				for (let j = 0; j < CHUNK_SIDE; j += 8)
					for (let i = 0; i < CHUNK_SIDE; i += 8) {
						const s = (c.z0 + j - zone.offsetZ) * zone.world.grid + c.x0 + i - zone.offsetX;
						expect(c.heights[j * CHUNK_SIDE + i]).toBe(zone.world.heights[s]);
						expect(c.flags[j * CHUNK_SIDE + i]).toBe(zone.world.flags[s]);
					}
				for (const p of [c.trees, c.rocks, c.decorations])
					for (let k = 0; k < p.count; k++) {
						expect(Math.floor(p.x[k] / CHUNK_SIZE)).toBe(c.cx);
						expect(Math.floor(p.z[k] / CHUNK_SIZE)).toBe(c.cz);
					}
				trees += c.trees.count;
				rocks += c.rocks.count;
				decorations += c.decorations.count;
				cylinders += c.collision.cylinders.length / 5;
				expect([c.collision.bx, c.collision.bz, c.collision.x0, c.collision.z0]).toEqual([
					c.cx,
					c.cz,
					c.x0,
					c.z0
				]);
				for (let k = 0; k < c.collision.cylinders.length; k += 5) {
					const x = c.collision.cylinders[k];
					expect(x).toBeGreaterThan(c.x0 - 2);
					expect(x).toBeLessThan(c.x0 + CHUNK_SIZE + 2);
				}
			}
			expect([trees, rocks, decorations]).toEqual([
				zone.world.trees.count,
				zone.world.rocks.count,
				zone.world.decorations.count
			]);
			expect(cylinders).toBe(zone.world.blocks.reduce((n, b) => n + b.cylinders.length / 5, 0));
		}
	});

	it('meets its neighbours edge to edge, zones and generated world alike', () => {
		let checked = 0;
		for (const cut of cuts.values())
			for (const c of cut.chunks)
				for (const [dx, dz] of [
					[1, 0],
					[0, 1],
					[-1, 0],
					[0, -1]
				]) {
					const n = anyChunk(c.cx + dx, c.cz + dz);
					for (let k = 0; k < CHUNK_SIDE; k++) {
						const [i, j] = dx === 1 ? [40, k] : dx === -1 ? [0, k] : dz === 1 ? [k, 40] : [k, 0];
						const [ni, nj] = dx === 1 ? [0, k] : dx === -1 ? [40, k] : dz === 1 ? [k, 0] : [k, 40];
						expect(n.heights[nj * CHUNK_SIDE + ni]).toBe(c.heights[j * CHUNK_SIDE + i]);
					}
					checked++;
				}
		expect(checked).toBe(4 * [...cuts.values()].reduce((n, c) => n + c.chunks.length, 0));
	});

	it('fills the apron with the neighbours’ heights', () => {
		for (const cut of cuts.values())
			for (const c of cut.chunks) {
				const west = anyChunk(c.cx - 1, c.cz);
				const north = anyChunk(c.cx, c.cz - 1);
				for (let k = 0; k < CHUNK_SIDE; k++) {
					expect(apronHeight(c, -1, k)).toBe(west.heights[k * CHUNK_SIDE + 39]);
					expect(apronHeight(c, k, -1)).toBe(north.heights[39 * CHUNK_SIDE + k]);
				}
			}
	});
});
