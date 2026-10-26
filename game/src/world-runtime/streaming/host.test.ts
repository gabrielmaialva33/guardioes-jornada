import { describe, expect, it } from 'vitest';
import type { ZoneId } from '../../level/zones/spec.ts';
import type { ZoneBuild } from '../../level/zones/zone.ts';
import { generateChunk } from '../../world-gen/chunk.ts';
import { StreamClient, type StreamPort, ZoneCancelled } from './client.ts';
import { fromWorldChunk } from './generated.ts';
import { createStreamHost } from './host.ts';
import type { BuildResult, StreamResponse } from './protocol.ts';
import { createTerrainAttributes } from './terrain-mesh.ts';
import { CHUNK_VERTICES, type StreamChunk } from './types.ts';
import { createWindow, fillWindow } from './window.ts';

/** The Worker stand-in: turns on demand, every message cloned with its transfer list. */
function fakeStream(built?: Map<ZoneId, ZoneBuild>) {
	const turns: (() => void)[] = [];
	const sent: StreamResponse['type'][] = [];
	let port: StreamPort;
	const host = createStreamHost(
		(message, transfer) => {
			sent.push(message.type);
			expect(new Set(transfer).size).toBe(transfer.length);
			port.onmessage?.({ data: structuredClone(message, { transfer }) as StreamResponse });
		},
		{ schedule: (turn) => turns.push(turn), built }
	);
	port = { postMessage: (message) => host.receive(structuredClone(message)), onmessage: null };
	return { port, host, sent, run: () => turns.shift()?.() };
}

const flush = async () => {
	for (let k = 0; k < 4; k++) await Promise.resolve();
};

describe('streaming worker protocol', () => {
	it("builds a zone's seams first, one zone per turn, each once per Worker", async () => {
		const w = fakeStream();
		const client = new StreamClient(w.port);
		const copa = client.zone('copa');
		expect(client.zone('copa', 5)).toBe(copa);
		const steps: string[] = [];
		for (let k = 0; k < 6 && w.host.pending > 0; k++) {
			w.run();
			steps.push([...w.host.built.keys()].join('+'));
		}
		// reserva, vale, praia, then copa itself (built and cut in one turn).
		expect(steps).toEqual(['reserva', 'reserva+vale', 'reserva+vale+praia', 'reserva+vale+praia+copa']);
		const cut = await copa;
		expect(cut.id).toBe('copa');
		expect(cut.chunks.length).toBe(16);
		// Vale is built already: cutting it takes one turn.
		const vale = client.zone('vale');
		w.run();
		expect((await vale).chunks.length).toBe(16);
		expect([...w.host.built.keys()].length).toBe(4);
	});

	it('runs builds between long zone builds and drops cancelled jobs', async () => {
		const w = fakeStream();
		const client = new StreamClient(w.port);
		const results: BuildResult[] = [];
		client.onBuilt = (r) => results.push(r);
		const zone = client.zone('copa', 10);
		const chunk = fromWorldChunk(generateChunk(40, 2)) as StreamChunk;
		const near = new Map<string, StreamChunk | null>();
		const lookup = (cx: number, cz: number) => {
			const key = `${cx},${cz}`;
			if (!near.has(key)) near.set(key, fromWorldChunk(generateChunk(cx, cz)));
			return near.get(key) ?? null;
		};
		const request = (job: number, priority: number) => ({
			job,
			priority,
			cx: chunk.cx,
			cz: chunk.cz,
			terrain: {
				window: fillWindow(createWindow(), chunk, lookup),
				x0: chunk.x0,
				z0: chunk.z0,
				waterLevel: chunk.waterLevel,
				rivers: chunk.rivers,
				pool: null,
				local: true
			},
			collision: {
				x0: chunk.x0,
				z0: chunk.z0,
				heights: chunk.heights,
				cylinders: chunk.collision.cylinders,
				boxes: chunk.collision.boxes,
				decks: chunk.collision.decks
			}
		});
		const a = client.nextJob();
		const b = client.nextJob();
		client.build(request(a, 1));
		client.build(request(b, 2));
		expect(client.cancelBuild(b)).toBe(true);
		w.run(); // the zone job's first zone (reserva) waits: the build ranks first
		expect(w.sent).toEqual(['built']);
		expect(results.map((r) => r.job)).toEqual([a]);
		const r = results[0];
		expect(r.terrain?.position.length).toBe(CHUNK_VERTICES * 3);
		expect(r.collision?.roots.length).toBeGreaterThan(0);
		const reference = createTerrainAttributes();
		expect(r.terrain?.normal.length).toBe(reference.normal.length);
		for (let k = 0; k < 8 && w.host.pending > 0; k++) w.run();
		expect(w.sent.filter((s) => s === 'built').length).toBe(1);
		expect((await zone).id).toBe('copa');
		expect(client.pending).toBe(0);
	});

	it('re-ranks a queued build', async () => {
		const w = fakeStream();
		const client = new StreamClient(w.port);
		const done: number[] = [];
		client.onBuilt = (r) => done.push(r.job);
		const chunk = fromWorldChunk(generateChunk(-30, 12)) as StreamChunk;
		const collision = {
			x0: chunk.x0,
			z0: chunk.z0,
			heights: chunk.heights,
			cylinders: chunk.collision.cylinders,
			boxes: chunk.collision.boxes,
			decks: chunk.collision.decks
		};
		const jobs = [client.nextJob(), client.nextJob(), client.nextJob()];
		for (const [k, job] of jobs.entries())
			client.build({ job, priority: k, cx: chunk.cx, cz: chunk.cz, terrain: null, collision });
		client.rank(jobs[2], -1);
		for (let k = 0; k < 3; k++) w.run();
		await flush();
		expect(done).toEqual([jobs[2], jobs[0], jobs[1]]);
	});

	it('rejects a cancelled zone and forgets its job', async () => {
		const w = fakeStream();
		const client = new StreamClient(w.port);
		const zone = client.zone('manguezal');
		expect(client.cancelZone('manguezal')).toBe(true);
		await expect(zone).rejects.toBeInstanceOf(ZoneCancelled);
		w.run();
		await flush();
		expect(w.host.pending).toBe(0);
		expect(w.sent).toEqual([]);
	});
});
