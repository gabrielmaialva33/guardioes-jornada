import { Ray, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { buildPark, buildZone } from '../../level/zones/park.ts';
import { PARK_ZONES, ZONE_IDS } from '../../level/zones/spec.ts';
import { FLAG } from '../../survival/types.ts';
import { buildMapCollision } from '../collision.ts';
import { StreamClient, type StreamPort } from './client.ts';
import { createStreamHost } from './host.ts';
import type { StreamResponse } from './protocol.ts';
import { StreamingRing } from './ring.ts';
import { chunkOf } from './types.ts';
import { loadZoneMap, zoneOnlySource, zoneParam, zoneSpawn } from './zone-loader.ts';

function fakeStream() {
	const turns: (() => void)[] = [];
	let port: StreamPort;
	const host = createStreamHost(
		(message, transfer) =>
			port.onmessage?.({ data: structuredClone(message, { transfer }) as StreamResponse }),
		{ schedule: (turn) => turns.push(turn), built: new Map(buildPark()) }
	);
	port = { postMessage: (message) => host.receive(structuredClone(message)), onmessage: null };
	return { port, run: () => turns.shift()?.() };
}

describe('?zone=<id>', () => {
	it('reads the zone from the query, ignoring unknown ids', () => {
		expect(zoneParam('?zone=vale')).toBe('vale');
		expect(zoneParam(new URLSearchParams('debug&zone=praia'))).toBe('praia');
		expect(zoneParam('?zone=atlantis')).toBeNull();
		expect(zoneParam('')).toBeNull();
	});

	it("hands a square zone over as it is, in Root's mapData shape", () => {
		for (const id of ['reserva', 'vale', 'copa'] as const) {
			const map = loadZoneMap(id);
			const zone = buildZone(id);
			expect(map.padded).toBe(false);
			expect(map.world).toBe(zone.world);
			expect(map.level).toBe(zone.level);
			expect([map.offsetX, map.offsetZ]).toEqual([PARK_ZONES[id].x0, PARK_ZONES[id].z0]);
		}
	});

	it('pads a zone wider than deep to a square nobody can walk into', () => {
		for (const id of ['praia', 'manguezal'] as const) {
			const map = loadZoneMap(id);
			const zone = buildZone(id);
			const { world } = map;
			expect(map.padded).toBe(true);
			expect([world.size, world.grid, world.blocks.length]).toEqual([200, 201, 25]);
			expect(world.heights.length).toBe(201 * 201);
			expect(world.heights.subarray(0, zone.world.heights.length)).toEqual(zone.world.heights);
			for (let j = 161; j <= 200; j += 13)
				for (let i = 0; i <= 200; i += 17) {
					expect(world.heights[j * 201 + i]).toBe(world.heights[160 * 201 + i]);
					expect(world.flags[j * 201 + i] & FLAG.walkable).toBe(0);
				}
			for (let b = 0; b < 20; b++) expect(world.blocks[b]).toBe(zone.world.blocks[b]);
			// The present whole-map collision loads it, and a rail stands on the zone's south edge.
			const collision = buildMapCollision(world);
			const ray = new Ray(new Vector3(100, world.heights[150 * 201 + 100] + 1, 150), new Vector3(0, 0, 1));
			expect(collision.raycast(ray, 30)).toBeCloseTo(9.5, 3);
			collision.dispose();
		}
	});

	it('streams one zone alone: its chunks, railed in, void around', async () => {
		const stream = fakeStream();
		const client = new StreamClient(stream.port);
		const id = 'praia';
		const source = zoneOnlySource(client, id);
		const ring = new StreamingRing({ source, builder: client, quality: 'low', budgetMs: 4 });
		const level = buildZone(id).level;
		const spawn = zoneSpawn(id, level);
		for (let k = 0; k < 200 && !ring.ready(); k++) {
			for (let n = 0; n < 4; n++) stream.run();
			for (let n = 0; n < 8; n++) await Promise.resolve();
			ring.update(spawn.x, spawn.z);
		}
		expect(ring.ready()).toBe(true);
		const fcx = chunkOf(spawn.x);
		const fcz = chunkOf(spawn.z);
		const z = PARK_ZONES[id];
		for (let dz = -3; dz <= 3; dz++)
			for (let dx = -3; dx <= 3; dx++) {
				const cx = fcx + dx;
				const cz = fcz + dz;
				const inside = cx >= z.cx0 && cx <= z.cx1 && cz >= z.cz0 && cz <= z.cz1;
				const chunk = ring.chunkAt(cx, cz);
				if (inside) expect(chunk?.zone).toBe(id);
				else expect(chunk).toBeNull();
			}
		// The spawn sits on the zone's south edge band: the rail along z = 0 stops a walk out.
		const out = new Ray(new Vector3(spawn.x, spawn.y + 1, spawn.z), new Vector3(0, 0, 1));
		const hit = ring.collision.raycast(out, 20);
		expect(hit).not.toBeNull();
		expect(spawn.z + (hit as number)).toBeCloseTo(z.z1 - 0.5, 3);
		expect(ZONE_IDS).toContain(id);
		ring.dispose();
		client.dispose();
	});
});
