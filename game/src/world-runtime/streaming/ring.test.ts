import { BoxGeometry, MeshBasicMaterial, MeshLambertMaterial, Ray, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { buildPark } from '../../level/zones/park.ts';
import type { ZoneId } from '../../level/zones/spec.ts';
import type { ZoneBuild } from '../../level/zones/zone.ts';
import { InstancePool } from '../../render/index.ts';
import { DECORATION_KINDS, ROCK_KINDS, TREE_SPECIES } from '../../survival/types.ts';
import { type WorkerPort, WorldGenClient } from '../../world-gen/client.ts';
import { createHost } from '../../world-gen/host.ts';
import type { WorkerResponse } from '../../world-gen/protocol.ts';
import { StreamClient, type StreamPort } from './client.ts';
import { GeneratedSource } from './generated.ts';
import { createStreamHost } from './host.ts';
import type { StreamResponse } from './protocol.ts';
import { StreamingRing } from './ring.ts';
import { ChunkPlacements, type PlacementRoute, ringCapacity, ToroidalBlockGrid } from './slots.ts';
import { ParkSource, ZoneSource } from './sources.ts';
import { createWaterfallSpray } from './spray.ts';
import { TerrainMeshPool } from './terrain-mesh.ts';
import { RibbonMeshPool } from './trails.ts';
import { CHUNK_SIZE, chunkId } from './types.ts';
import { WaterMeshPool } from './water.ts';

/** world-gen's Worker in-process: turns run only when the test says, messages cloned as postMessage does. */
function fakeWorldGen() {
	const turns: (() => void)[] = [];
	let port: WorkerPort;
	const host = createHost(
		(message, transfer) =>
			port.onmessage?.({ data: structuredClone(message, { transfer }) as WorkerResponse }),
		{ schedule: (turn) => turns.push(turn) }
	);
	port = { postMessage: (message) => host.receive(structuredClone(message)), onmessage: null };
	return { port, run: (n: number) => runTurns(turns, n), turns };
}

/** The streaming Worker in-process, the zones it builds shared with buildPark()'s. */
function fakeStream(built?: Map<ZoneId, ZoneBuild>) {
	const turns: (() => void)[] = [];
	let port: StreamPort;
	const host = createStreamHost(
		(message, transfer) =>
			port.onmessage?.({ data: structuredClone(message, { transfer }) as StreamResponse }),
		{ schedule: (turn) => turns.push(turn), built }
	);
	port = { postMessage: (message) => host.receive(structuredClone(message)), onmessage: null };
	return { port, host, run: (n: number) => runTurns(turns, n), turns };
}

function runTurns(turns: (() => void)[], n: number) {
	let k = 0;
	for (; k < n && turns.length > 0; k++) turns.shift()?.();
	return k;
}

const settle = async () => {
	for (let k = 0; k < 8; k++) await Promise.resolve();
};

/** One pool per family; the route sends every placement to its family's pool. */
function placementsFor(grid: ToroidalBlockGrid, radius: number) {
	const keys = (family: string, kinds: readonly string[]) => kinds.map((k) => `${family}:${k}`);
	const pool = (name: string, capacity: number) =>
		new InstancePool([{ geometry: new BoxGeometry(), material: new MeshLambertMaterial() }], {
			name,
			capacity,
			grid
		});
	const pools = [
		pool('trees', ringCapacity(keys('tree', TREE_SPECIES), radius)),
		pool('rocks', ringCapacity(keys('rock', ROCK_KINDS), radius)),
		pool('decorations', ringCapacity(keys('decoration', DECORATION_KINDS), radius))
	];
	const route: PlacementRoute = {
		pools,
		route(family, _kind, _chunk, _i, out) {
			out[0] = family === 'tree' ? 0 : family === 'rock' ? 1 : 2;
			return 1;
		}
	};
	return { pools, placements: new ChunkPlacements(grid, route) };
}

function setup(quality: 'low' | 'high' = 'low', budgetMs = 1) {
	const park = buildPark();
	const gen = fakeWorldGen();
	const stream = fakeStream(new Map(park));
	const client = new WorldGenClient(gen.port, { byteCap: 4 * 1024 * 1024 });
	const streamClient = new StreamClient(stream.port);
	const zones = new ZoneSource(streamClient);
	const source = new ParkSource(zones, new GeneratedSource(client));
	const radius = quality === 'high' ? 3 : 2;
	const grid = new ToroidalBlockGrid(2 * (radius + 1) + 1);
	const { pools, placements } = placementsFor(grid, radius);
	const terrain = new TerrainMeshPool(new MeshBasicMaterial());
	const water = new WaterMeshPool(new MeshBasicMaterial());
	const ribbons = new RibbonMeshPool(new MeshBasicMaterial());
	const ring = new StreamingRing({
		source,
		builder: streamClient,
		quality,
		budgetMs,
		terrain,
		water,
		ribbons,
		waterfall: createWaterfallSpray,
		placements
	});
	/** One frame: the Workers do a little, promises settle, then the ring's main-thread work. */
	const frame = async (x: number, z: number, fx = 1, fz = 0, work = 2) => {
		gen.run(work);
		stream.run(work);
		await settle();
		ring.update(x, z, fx, fz);
	};
	return {
		park,
		gen,
		stream,
		client,
		streamClient,
		zones,
		source,
		grid,
		pools,
		water,
		ribbons,
		placements,
		terrain,
		ring,
		frame
	};
}

/** The keys of every chunk with data, sorted. */
function resident(ring: StreamingRing, fcx: number, fcz: number, reach = 6): number[] {
	const out: number[] = [];
	for (let dz = -reach; dz <= reach; dz++)
		for (let dx = -reach; dx <= reach; dx++)
			if (ring.chunkAt(fcx + dx, fcz + dz) !== undefined) out.push(chunkId(fcx + dx, fcz + dz));
	return out.sort((a, b) => a - b);
}

describe('streaming ring', () => {
	it('loads the rings around the player, park and generated world alike', async () => {
		const t = setup();
		let frames = 0;
		while (!t.ring.ready() && frames < 400) {
			await t.frame(80, 80);
			frames++;
		}
		expect(t.ring.ready()).toBe(true);
		const { stats } = t.ring;
		expect(stats.resident).toBe(49);
		expect(stats.meshes).toBe(25);
		expect(stats.colliders).toBe(9);
		expect(stats.placed).toBe(25);
		expect(t.ring.object.children.length).toBe(25 + stats.water + stats.ribbons + stats.falls);
		expect([stats.water > 0, stats.ribbons > 0, stats.falls]).toEqual([true, true, 1]);
		expect(t.zones.zones).toContain('reserva');
		// Standing on streamed collision: a ray down from above the spawn hits the ground there.
		const reserva = t.park.get('reserva') as ZoneBuild;
		const hit = t.ring.collision.raycast(new Ray(new Vector3(80.5, 100, 80.5), new Vector3(0, -1, 0)), 200);
		expect(100 - (hit as number)).toBeCloseTo(reserva.world.heights[80 * 161 + 80], 0);
		// Every placed instance went into a pool; none was refused.
		expect(t.placements.dropped).toBe(0);
		expect(t.placements.live).toBe(t.pools.reduce((n, p) => n + p.size, 0));
		t.ring.dispose();
	});

	it('walks 2 km east and back without leaking a chunk, mesh, collider or instance', async () => {
		const t = setup();
		const start = { x: 80, z: 80 };
		let frames = 0;
		while (!t.ring.ready() && frames < 400) {
			await t.frame(start.x, start.z);
			frames++;
		}
		// Come back from the east once, so the slack ring left behind matches the end of the walk.
		for (let x = start.x; x <= start.x + 160; x += 2) await t.frame(x, start.z, 1, 0);
		for (let x = start.x + 160; x >= start.x; x -= 2) await t.frame(x, start.z, -1, 0);
		for (let k = 0; k < 400 && !t.ring.ready(); k++) await t.frame(start.x, start.z, -1, 0);
		for (let k = 0; k < 60; k++) await t.frame(start.x, start.z, -1, 0);
		const before = {
			keys: resident(t.ring, 2, 2),
			resident: t.ring.stats.resident,
			bytes: t.ring.stats.bytes,
			meshes: t.ring.stats.meshes,
			water: t.ring.stats.water,
			ribbons: t.ring.stats.ribbons,
			falls: t.ring.stats.falls,
			colliders: t.ring.stats.colliders,
			placed: t.ring.stats.placed,
			live: t.placements.live,
			children: t.ring.object.children.length
		};
		let peakMeshPool = 0;
		let peakColliders = 0;
		let peakWater = 0;
		let peakRibbons = 0;
		let fallsSeen = 0;
		const step = 2;
		const walkMs: number[] = [];
		for (let x = start.x; x <= start.x + 2000; x += step) {
			await t.frame(x, start.z, 1, 0);
			walkMs.push(t.ring.stats.frameMs);
			peakMeshPool = Math.max(peakMeshPool, t.terrain.size);
			peakColliders = Math.max(peakColliders, t.ring.collision.size);
			peakWater = Math.max(peakWater, t.water.size);
			peakRibbons = Math.max(peakRibbons, t.ribbons.size);
			fallsSeen = Math.max(fallsSeen, t.ring.stats.falls);
		}
		const poolAtFarEnd = t.terrain.size;
		for (let x = start.x + 2000; x >= start.x; x -= step) {
			await t.frame(x, start.z, -1, 0);
			walkMs.push(t.ring.stats.frameMs);
			peakMeshPool = Math.max(peakMeshPool, t.terrain.size);
			peakColliders = Math.max(peakColliders, t.ring.collision.size);
			peakWater = Math.max(peakWater, t.water.size);
			peakRibbons = Math.max(peakRibbons, t.ribbons.size);
			fallsSeen = Math.max(fallsSeen, t.ring.stats.falls);
		}
		for (let k = 0; k < 400 && !t.ring.ready(); k++) await t.frame(start.x, start.z, -1, 0);
		for (let k = 0; k < 60; k++) await t.frame(start.x, start.z, -1, 0);
		const after = {
			keys: resident(t.ring, 2, 2),
			resident: t.ring.stats.resident,
			bytes: t.ring.stats.bytes,
			meshes: t.ring.stats.meshes,
			water: t.ring.stats.water,
			ribbons: t.ring.stats.ribbons,
			falls: t.ring.stats.falls,
			colliders: t.ring.stats.colliders,
			placed: t.ring.stats.placed,
			live: t.placements.live,
			children: t.ring.object.children.length
		};
		// Hitch budget: the main thread's streaming work per frame, the Workers' excluded (they run
		// between frames here). The ring's budget is 1 ms in this test: 4 ms at a 4× CPU throttle.
		walkMs.sort((a, b) => a - b);
		expect(walkMs[Math.floor(walkMs.length * 0.995)]).toBeLessThanOrEqual(1);
		expect(walkMs[walkMs.length - 1]).toBeLessThanOrEqual(4);
		expect(t.ring.stats.emergencies).toBe(0);
		for (const ms of t.ring.stats.maxStepMs) expect(ms).toBeLessThan(2);
		expect(after).toEqual(before);
		expect(t.ring.stats.pendingData).toBe(0);
		expect(t.ring.stats.pendingBuilds).toBe(0);
		expect(t.streamClient.pending).toBe(0);
		expect(t.client.pending).toBe(0);
		// Pools are bounded by the ring, and the walk back made none.
		expect(peakMeshPool).toBeLessThanOrEqual(49);
		expect(t.terrain.size).toBe(poolAtFarEnd);
		expect(t.terrain.inUse).toBe(t.ring.stats.meshes);
		// Water, trails and waterfalls ride along: bounded pools, in use exactly while their chunk renders.
		expect(before.water).toBeGreaterThan(0);
		expect(before.ribbons).toBeGreaterThan(0);
		expect(before.falls).toBe(1);
		expect(fallsSeen).toBe(2);
		expect(peakWater).toBeLessThanOrEqual(49);
		expect(peakRibbons).toBeLessThanOrEqual(49);
		expect(t.water.inUse).toBe(t.ring.stats.water);
		expect(t.ribbons.inUse).toBe(t.ring.stats.ribbons);
		expect(peakColliders).toBeLessThanOrEqual(25);
		expect(t.placements.dropped).toBe(0);
		expect(t.placements.live).toBe(t.pools.reduce((n, p) => n + p.size, 0));
		// Memory flat: the generator's cache stays under its cap, the zone cuts under theirs.
		expect(t.client.cache.bytes).toBeLessThanOrEqual(4 * 1024 * 1024);
		expect(t.zones.bytes).toBeLessThanOrEqual(8 * 1024 * 1024);
		expect(t.ring.stats.refocuses).toBeGreaterThanOrEqual(100);
		t.ring.dispose();
		expect(t.ring.stats.resident).toBe(0);
		expect(t.ring.stats.meshes).toBe(0);
		expect(t.ring.collision.size).toBe(0);
		expect(t.placements.live).toBe(0);
		expect(t.terrain.inUse).toBe(0);
		expect(t.water.inUse).toBe(0);
		expect(t.ribbons.inUse).toBe(0);
		expect(t.ring.stats.falls).toBe(0);
		expect(t.ring.object.children.length).toBe(0);
	}, 120_000);
});

describe('ring order of work', () => {
	it('asks first for the chunk the player faces, then the sides, the one behind last', async () => {
		const t = setup();
		const asked = new Map<number, number>();
		const request = t.source.request.bind(t.source);
		t.source.request = (cx, cz, priority) => {
			asked.set(chunkId(cx, cz), priority);
			return request(cx, cz, priority);
		};
		// Far from the park, in the middle of a chunk, facing north (−z).
		const x = 20_020;
		const z = 20_020;
		await t.frame(x, z, 0, -1, 0);
		expect(asked.size).toBe(49);
		const fcx = Math.floor(x / CHUNK_SIZE);
		const fcz = Math.floor(z / CHUNK_SIZE);
		const p = (dx: number, dz: number) => asked.get(chunkId(fcx + dx, fcz + dz)) as number;
		expect(p(0, 0)).toBe(0);
		expect(p(0, -1)).toBeLessThan(p(1, 0));
		expect(p(1, 0)).toBe(p(-1, 0));
		expect(p(1, 0)).toBeLessThan(p(0, 1));
		expect(p(0, -2)).toBeLessThan(p(0, 1));
		const sorted = [...asked.values()].sort((a, b) => a - b);
		expect(sorted[1]).toBe(p(0, -1));
		t.ring.dispose();
	});

	it('keeps one ring of slack: pacing over a chunk edge asks for nothing new', async () => {
		const t = setup();
		for (let k = 0; k < 400 && !t.ring.ready(); k++) await t.frame(100, 100);
		let asked = 0;
		const request = t.source.request.bind(t.source);
		t.source.request = (cx, cz, priority) => {
			asked++;
			return request(cx, cz, priority);
		};
		// Cross the x = 120 edge once (one new column), then pace over it.
		for (let x = 100; x <= 124; x += 2) await t.frame(x, 100);
		const first = asked;
		expect(first).toBe(7);
		const builds = t.streamClient.stats.builds;
		for (let n = 0; n < 6; n++) {
			for (let x = 124; x >= 116; x -= 2) await t.frame(x, 100);
			for (let x = 116; x <= 124; x += 2) await t.frame(x, 100);
		}
		for (let k = 0; k < 60; k++) await t.frame(124, 100);
		// Pending requests are re-ranked on each crossing; no chunk is new.
		const resident = t.ring.stats.resident;
		expect(resident).toBe(56);
		expect(t.streamClient.stats.builds - builds).toBeLessThanOrEqual(5 + 3);
		t.ring.dispose();
	});

	it('cancels what a teleport leaves behind and never takes a stale answer', async () => {
		const t = setup();
		await t.frame(3_000, 3_000, 1, 0, 0);
		expect(t.ring.stats.pendingData).toBe(49);
		// Teleport before the Worker ran anything: every pending request is given up.
		await t.frame(9_000, -7_000, 1, 0, 0);
		expect(t.client.stats.cancelled).toBe(49);
		expect(t.ring.stats.pendingData).toBe(49);
		t.ring.relocate();
		for (let k = 0; k < 400 && !t.ring.ready(); k++) await t.frame(9_000, -7_000);
		expect(t.ring.ready()).toBe(true);
		expect(t.ring.chunkAt(Math.floor(3_000 / CHUNK_SIZE), Math.floor(3_000 / CHUNK_SIZE))).toBeUndefined();
		expect(t.ring.stats.resident).toBe(49);
		expect(t.ring.stats.emergencies).toBe(0);
		t.ring.dispose();
	});

	it('asks again for a chunk that failed, then holds it as void rather than wait forever', async () => {
		const t = setup();
		const broken = chunkId(500, 500);
		let failures = 0;
		const request = t.source.request.bind(t.source);
		t.source.request = (cx, cz, priority) => {
			if (chunkId(cx, cz) !== broken) return request(cx, cz, priority);
			failures++;
			return Promise.reject(new Error('generator failed'));
		};
		for (let k = 0; k < 400 && !t.ring.ready(); k++) await t.frame(500 * 40 + 20, 500 * 40 + 20);
		expect(t.ring.ready()).toBe(true);
		expect(failures).toBe(4);
		expect(t.ring.stats.failed).toBe(1);
		expect(t.ring.chunkAt(500, 500)).toBeNull();
		t.ring.dispose();
	});

	it('stays under its byte cap by letting the slack ring go first', async () => {
		const park = buildPark();
		const gen = fakeWorldGen();
		const stream = fakeStream(new Map(park));
		const client = new WorldGenClient(gen.port);
		const builder = new StreamClient(stream.port);
		const source = new GeneratedSource(client);
		// Room for the 7 × 7 data ring and little more.
		const ring = new StreamingRing({ source, builder, quality: 'low', byteCap: 52 * 36_000 });
		const frame = async (x: number) => {
			gen.run(4);
			stream.run(4);
			await settle();
			ring.update(x, 30_020, 1, 0);
		};
		for (let x = 30_020; x <= 30_020 + 400; x += 4) await frame(x);
		for (let k = 0; k < 100; k++) await frame(30_420);
		expect(ring.stats.capped).toBeGreaterThan(0);
		expect(ring.stats.bytes).toBeLessThanOrEqual(52 * 36_000);
		expect(ring.stats.resident).toBeGreaterThanOrEqual(49);
		ring.dispose();
	});
});
