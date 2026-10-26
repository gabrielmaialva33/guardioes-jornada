import { describe, expect, it } from 'vitest';
import { buildPark } from '../../level/zones/park.ts';
import { PARK_ZONES, ZONE_IDS, type ZoneId } from '../../level/zones/spec.ts';
import type { ZoneBuild } from '../../level/zones/zone.ts';
import { StreamClient, type StreamPort } from './client.ts';
import { createStreamHost } from './host.ts';
import { cutTransferables, type StreamResponse } from './protocol.ts';
import { ZoneSource } from './sources.ts';
import { cutZone, typedArraysOf, worldBytes } from './zone-cut.ts';

/** The Worker stand-in: responses cross with their transfer lists, as postMessage does. */
function fakeStream(built: Map<ZoneId, ZoneBuild>) {
	const turns: (() => void)[] = [];
	const sent: StreamResponse[] = [];
	let port: StreamPort;
	const host = createStreamHost(
		(message, transfer) => {
			const copy = structuredClone(message, { transfer }) as StreamResponse;
			sent.push(message);
			port.onmessage?.({ data: copy });
		},
		{ schedule: (turn) => turns.push(turn), built }
	);
	port = { postMessage: (message) => host.receive(structuredClone(message)), onmessage: null };
	const run = () => {
		while (turns.length > 0) turns.shift()?.();
	};
	return { port, host, sent, run };
}

const settle = async () => {
	for (let k = 0; k < 8; k++) await Promise.resolve();
};

describe("a zone cut's world snapshot", () => {
	const park = buildPark();

	it('is a copy of the build, never the memo itself', () => {
		for (const id of ZONE_IDS) {
			const build = park.get(id) as ZoneBuild;
			const cut = cutZone(build, park);
			expect(cut.world).not.toBe(build.world);
			expect(cut.world.heights).not.toBe(build.world.heights);
			expect(cut.world.checksum).toBe(build.world.checksum);
			expect(cut.world.heights).toEqual(build.world.heights);
			expect(cut.world.river).toEqual(build.world.river);
			expect(cut.world.animals).toEqual(build.world.animals);
			// No buffer is shared with the memo.
			const memo = new Set(typedArraysOf(build.world).map((a) => a.buffer));
			for (const a of typedArraysOf(cut.world)) expect(memo.has(a.buffer)).toBe(false);
			const before = build.world.heights[0];
			cut.world.heights[0] = before + 100;
			cut.world.flags.fill(0);
			expect(build.world.heights[0]).toBe(before);
		}
	});

	it('counts in the cut’s bytes', () => {
		for (const id of ZONE_IDS) {
			const cut = cutZone(park.get(id) as ZoneBuild, park);
			const chunks = cut.chunks.reduce((n, c) => n + c.bytes, 0);
			const world = worldBytes(cut.world);
			expect(world).toBeGreaterThan(cut.world.heights.byteLength + cut.world.baseSteps.byteLength);
			expect(cut.bytes).toBe(chunks + world);
		}
	});

	it('travels to the page on its own buffers; the Worker’s memo keeps every one of its own', async () => {
		const built = new Map<ZoneId, ZoneBuild>();
		const w = fakeStream(built);
		const client = new StreamClient(w.port);
		const vale = client.zone('vale');
		w.run();
		const cut = await vale;
		const memo = built.get('vale') as ZoneBuild;
		// The snapshot the Worker sent was transferred (its buffers are gone there)...
		const sentCut = (w.sent.find((m) => m.type === 'zone') as Extract<StreamResponse, { type: 'zone' }>).cut;
		expect(sentCut.world.heights.byteLength).toBe(0);
		expect(cutTransferables(sentCut).length).toBeGreaterThan(0);
		// ...and the memo, the Reserva (the Vale's seam) included, keeps every array whole:
		// the same sizes as an independent build of the same zones.
		for (const id of ['reserva', 'vale'] as const) {
			const sizes = typedArraysOf((built.get(id) as ZoneBuild).world).map((a) => a.byteLength);
			const reference = typedArraysOf((park.get(id) as ZoneBuild).world).map((a) => a.byteLength);
			expect(sizes, `${id} memo`).toEqual(reference);
			expect(sizes.some((n) => n > 0)).toBe(true);
		}
		expect(memo.world.heights.byteLength).toBe(161 * 161 * 4);
		expect(cut.world.heights).toEqual(memo.world.heights);
		expect(cut.world.checksum).toBe(memo.world.checksum);
		expect(cut.world.heights).not.toBe(memo.world.heights);
		// A second cut of the same memo still works: nothing of it was detached.
		const again = client.zone('vale');
		w.run();
		expect((await again).world.heights).toEqual(memo.world.heights);
	});
});

describe('ZoneSource.cut(id)', () => {
	it('hands over the cut it holds, as it arrived, until it lets it go', async () => {
		const w = fakeStream(new Map(buildPark()));
		const client = new StreamClient(w.port);
		const zones = new ZoneSource(client, { keepBytes: 0 });
		expect(zones.cut('reserva')).toBeUndefined();
		const r = PARK_ZONES.reserva;
		const pending = [zones.request(r.cx0, r.cz0, 0), zones.request(r.cx0 + 1, r.cz0, 0)];
		w.run();
		const [a] = await Promise.all(pending);
		await settle();
		const cut = zones.cut('reserva');
		expect(cut).toBeDefined();
		expect(zones.cut('reserva')).toBe(cut);
		expect(cut?.chunks).toContain(a);
		expect(cut?.world.size).toBe(160);
		expect(cut?.offsetX).toBe(r.x0);
		expect(zones.bytes).toBe(cut?.bytes);
		// One chunk still held: kept.
		zones.release(r.cx0, r.cz0);
		expect(zones.cut('reserva')).toBe(cut);
		// None held, nothing kept (keepBytes 0): gone, and its bytes with it.
		zones.release(r.cx0 + 1, r.cz0);
		expect(zones.cut('reserva')).toBeUndefined();
		expect(zones.bytes).toBe(0);
	});

	it('keeps an unheld cut for a walk back while it fits in keepBytes', async () => {
		const w = fakeStream(new Map(buildPark()));
		const client = new StreamClient(w.port);
		const zones = new ZoneSource(client);
		const v = PARK_ZONES.vale;
		const pending = zones.request(v.cx0, v.cz0, 0);
		w.run();
		await pending;
		await settle();
		zones.release(v.cx0, v.cz0);
		const kept = zones.cut('vale');
		expect(kept).toBeDefined();
		expect(kept?.bytes).toBeLessThanOrEqual(zones.keepBytes);
	});

	it('by default (2 MiB) keeps the three zones held last once the walk leaves the park', async () => {
		const w = fakeStream(new Map(buildPark()));
		const client = new StreamClient(w.port);
		const zones = new ZoneSource(client);
		const order = ['reserva', 'vale', 'copa', 'praia', 'manguezal'] as const;
		for (const id of order) {
			const z = PARK_ZONES[id];
			const pending = zones.request(z.cx0, z.cz0, 0);
			w.run();
			await pending;
			await settle();
		}
		for (const id of order) zones.release(PARK_ZONES[id].cx0, PARK_ZONES[id].cz0);
		expect(zones.zones.sort()).toEqual(['copa', 'manguezal', 'praia']);
		expect(zones.bytes).toBeLessThanOrEqual(zones.keepBytes);
		expect(zones.keepBytes).toBe(2 * 1024 * 1024);
	});
});
