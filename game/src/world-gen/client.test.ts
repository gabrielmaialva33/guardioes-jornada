import { describe, expect, it } from 'vitest';
import { generateChunk, type WorldChunk } from './chunk.ts';
import { ChunkCache, ChunkCancelled, type WorkerPort, WorldGenClient } from './client.ts';
import { WORLD_SEED } from './constants.ts';
import { createHost } from './host.ts';
import { chunkArrays, chunkBytes, chunkKey, chunkTransferables, type WorkerResponse } from './protocol.ts';

/**
 * A Worker stand-in: the host runs in-process, its turns only when the test
 * says, and every response is structured-cloned with its transfer list the
 * way postMessage does (so a shared or duplicated buffer would throw).
 */
function fakeWorker() {
	const turns: (() => void)[] = [];
	const order: string[] = [];
	let port: WorkerPort;
	const host = createHost(
		(message, transfer) => {
			if (message.type === 'chunk') order.push(message.key);
			const copy = structuredClone(message, { transfer }) as WorkerResponse;
			port.onmessage?.({ data: copy });
		},
		{ schedule: (turn) => turns.push(turn), now: () => 0 }
	);
	port = {
		postMessage: (message) => host.receive(structuredClone(message)),
		onmessage: null,
		terminate: () => {
			turns.length = 0;
		}
	};
	const run = (n = Number.POSITIVE_INFINITY) => {
		for (let k = 0; k < n && turns.length > 0; k++) turns.shift()?.();
	};
	return { port, host, run, order };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('world-gen worker protocol', () => {
	it('transfers every array of a chunk, each on its own buffer', () => {
		const c = generateChunk(5, -3, WORLD_SEED);
		const buffers = chunkTransferables(c);
		expect(new Set(buffers).size).toBe(buffers.length);
		const bytes = chunkBytes(c);
		const copy = structuredClone(c, { transfer: buffers });
		expect(copy.checksum).toBe(c.checksum);
		expect(chunkBytes(copy)).toBe(bytes);
		for (const a of chunkArrays(c)) expect(a.byteLength).toBe(0);
	});

	it('runs the nearest chunks first and answers each request once', async () => {
		const { port, run, order } = fakeWorker();
		const client = new WorldGenClient(port);
		client.focus(10 * 40, -5 * 40);
		const wanted: [number, number][] = [
			[5, -3],
			[10, -5],
			[9, -5],
			[12, -8],
			[10, -4]
		];
		const promises = wanted.map(([cx, cz]) => client.request(cx, cz));
		expect(client.pending).toBe(5);
		// Asking again while pending is the same request.
		expect(client.request(10, -5)).toBe(promises[1]);
		run();
		const chunks = await Promise.all(promises);
		expect(order).toEqual(['10,-5', '9,-5', '10,-4', '12,-8', '5,-3']);
		chunks.forEach((c, k) => {
			expect([c.cx, c.cz]).toEqual(wanted[k]);
			expect(c.checksum).toBe(generateChunk(c.cx, c.cz, WORLD_SEED).checksum);
		});
		expect(client.stats.completed).toBe(5);
		expect(client.pending).toBe(0);
		// Now cached: no new job.
		expect(await client.request(9, -5)).toBe(chunks[2]);
		run();
		expect(order).toHaveLength(5);
	});

	it('lets an explicit priority jump the queue', async () => {
		const { port, run, order } = fakeWorker();
		const client = new WorldGenClient(port);
		client.focus(0, 0);
		const a = client.request(-1, -1);
		const b = client.request(40, 40, -1);
		run();
		await Promise.all([a, b]);
		expect(order).toEqual(['40,40', '-1,-1']);
	});

	it('cancels queued jobs and drops the ones left behind by the focus', async () => {
		const { port, host, run, order } = fakeWorker();
		const client = new WorldGenClient(port);
		client.focus(0, 0);
		const near = client.request(-1, 0);
		const cancelled = client.request(-2, 0);
		const far = client.request(20, 20);
		const farther = client.request(-30, 2);
		expect(client.cancel(-2, 0)).toBe(true);
		expect(client.cancel(-2, 0)).toBe(false);
		await expect(cancelled).rejects.toBeInstanceOf(ChunkCancelled);
		client.focus(-40, 0, 300);
		await expect(far).rejects.toBeInstanceOf(ChunkCancelled);
		await expect(farther).rejects.toBeInstanceOf(ChunkCancelled);
		expect(host.pending).toBe(1);
		run();
		expect((await near).cx).toBe(-1);
		expect(order).toEqual(['-1,0']);
		expect(client.stats.cancelled).toBe(3);
	});

	it('keeps a chunk that outran its cancel, and rejects everything on dispose', async () => {
		const { port, run } = fakeWorker();
		const client = new WorldGenClient(port);
		const a = client.request(7, 7);
		run();
		await a;
		expect(client.cancel(7, 7)).toBe(false);
		expect(client.get(7, 7)?.cx).toBe(7);
		const b = client.request(8, 8);
		client.dispose();
		await expect(b).rejects.toBeInstanceOf(ChunkCancelled);
		await flush();
	});
});

describe('chunk cache', () => {
	const chunks: WorldChunk[] = [
		[5, 5],
		[6, 5],
		[7, 5],
		[8, 5]
	].map(([cx, cz]) => generateChunk(cx, cz, WORLD_SEED));
	const size = chunkBytes(chunks[0]);

	it('evicts the least recently used past its byte cap', () => {
		const evicted: string[] = [];
		const cache = new ChunkCache(2.5 * size);
		cache.onEvict = (c) => evicted.push(chunkKey(c.cx, c.cz));
		cache.set('5,5', chunks[0]);
		cache.set('6,5', chunks[1]);
		expect(cache.get('5,5')).toBe(chunks[0]);
		cache.set('7,5', chunks[2]);
		expect(evicted).toEqual(['6,5']);
		expect(cache.keys()).toEqual(['5,5', '7,5']);
		expect(cache.bytes).toBe(chunkBytes(chunks[0]) + chunkBytes(chunks[2]));
		cache.set('8,5', chunks[3]);
		expect(evicted).toEqual(['6,5', '5,5']);
		expect(cache.peek('7,5')).toBe(chunks[2]);
		expect(cache.bytes).toBeLessThanOrEqual(cache.byteCap);
		expect(cache.evicted).toBe(2);
	});

	it('always keeps the newest chunk, even over the cap', () => {
		const cache = new ChunkCache(10);
		cache.set('5,5', chunks[0]);
		cache.set('6,5', chunks[1]);
		expect(cache.keys()).toEqual(['6,5']);
		expect(cache.delete('6,5')).toBe(true);
		expect(cache.bytes).toBe(0);
	});

	it('caps the client cache', async () => {
		const { port, run } = fakeWorker();
		const client = new WorldGenClient(port, { byteCap: 3 * size });
		const all = [0, 1, 2, 3, 4, 5].map((k) => client.request(10 + k, -10));
		run();
		await Promise.all(all);
		expect(client.cache.size).toBeLessThanOrEqual(3);
		expect(client.cache.bytes).toBeLessThanOrEqual(3 * size + 2048);
		expect(client.get(15, -10)?.cx).toBe(15);
		expect(client.get(10, -10)).toBeUndefined();
	});
});
