/**
 * The hand-made park as chunks: a zone built once (level/zones park.ts
 * buildOne, with only the zones its seams read), then cut into the 40 u
 * StreamChunks the ring streams. Pure and three-free, so it runs in the
 * streaming Worker (host.ts) as well as inline.
 */
import { buildOne } from '../../level/zones/park.ts';
import { BUILD_ORDER, PARK_ZONES, SEAMS, ZONE_IDS, type ZoneId } from '../../level/zones/spec.ts';
import type { ZoneBuild } from '../../level/zones/zone.ts';
import type { CollisionBlock, Placements, SurvivalWorld } from '../../survival/types.ts';
import { generateArea } from '../../world-gen/chunk.ts';
import { WORLD_SEED } from '../../world-gen/constants.ts';
import {
	APRON_LENGTH,
	CHUNK_SIDE,
	CHUNK_SIZE,
	CHUNK_VERTICES,
	chunkId,
	heightRange,
	RIVER_STRIDE,
	type StoryRef,
	type StreamChunk,
	streamChunkBytes
} from './types.ts';
import { waterfallPlacements, waterfallsIn, waterfallsOf } from './waterfalls.ts';

/** The zones a zone's build reads (its seams' fixed sides), transitively, in build order, itself last. */
export function zoneClosure(id: ZoneId): ZoneId[] {
	const need = new Set<ZoneId>([id]);
	for (let grew = true; grew; ) {
		grew = false;
		for (const seam of SEAMS)
			if (need.has(seam.zone) && !need.has(seam.fixed)) {
				need.add(seam.fixed);
				grew = true;
			}
	}
	return BUILD_ORDER.filter((z) => need.has(z));
}

/**
 * Builds `id` and whatever it reads into `built` (a per-Worker memo), each
 * zone once. Returns the zone. The result equals buildPark()'s: a zone only
 * reads the zones its seams name (zone-cut.test.ts checks every checksum).
 */
export function buildZoneOnDemand(id: ZoneId, built: Map<ZoneId, ZoneBuild>): ZoneBuild {
	for (const z of zoneClosure(id)) if (!built.has(z)) built.set(z, buildOne(z, built));
	return built.get(id) as ZoneBuild;
}

/** World height at integer (x, z) inside a built zone (edges included), or undefined. */
function zoneSample(build: ZoneBuild, x: number, z: number): number | undefined {
	const lx = x - build.offsetX;
	const lz = z - build.offsetZ;
	if (lx < 0 || lz < 0 || lx > build.width || lz > build.depth) return undefined;
	return build.world.heights[lz * build.world.grid + lx];
}

/**
 * The apron of a zone chunk: from the zone, else from another zone already
 * built, else the generated (stitched) ground, the same ground the generated
 * neighbour chunks hold. Inside a park zone that is not built yet the last
 * case is only an estimate, as world-gen's own apron is; the ring reads the
 * loaded neighbour's heights instead whenever it can.
 */
function zoneApron(
	build: ZoneBuild,
	built: ReadonlyMap<ZoneId, ZoneBuild>,
	x0: number,
	z0: number,
	seed: number
): Float32Array {
	const out = new Float32Array(APRON_LENGTH);
	const sample = (x: number, z: number): number | undefined => {
		const own = zoneSample(build, x, z);
		if (own !== undefined) return own;
		for (const other of built.values()) {
			if (other === build) continue;
			const h = zoneSample(other, x, z);
			if (h !== undefined) return h;
		}
		return undefined;
	};
	// Strips in apron order: north row, south row (43 each), west column, east column (41 each).
	const strips: [number, number, number, number][] = [
		[x0 - 1, z0 - 1, CHUNK_SIDE + 1, 0],
		[x0 - 1, z0 + CHUNK_SIDE, CHUNK_SIDE + 1, 0],
		[x0 - 1, z0, 0, CHUNK_SIZE],
		[x0 + CHUNK_SIDE, z0, 0, CHUNK_SIZE]
	];
	let k = 0;
	for (const [sx, sz, w, d] of strips) {
		const n = (w + 1) * (d + 1);
		let missing = false;
		for (let m = 0; m < n; m++) {
			const h = sample(sx + (w > 0 ? m : 0), sz + (d > 0 ? m : 0));
			if (h === undefined) missing = true;
			else out[k + m] = h;
		}
		if (missing) {
			const area = generateArea(sx, sz, w, d, seed);
			for (let m = 0; m < n; m++) {
				const x = sx + (w > 0 ? m : 0);
				const z = sz + (d > 0 ? m : 0);
				if (sample(x, z) === undefined) out[k + m] = area.heights[m];
			}
		}
		k += n;
	}
	return out;
}

/** The largest float32 below `limit` (so a placement converted to world coordinates stays in its chunk). */
function below(limit: number): number {
	const f = new Float32Array([limit]);
	const bits = new Int32Array(f.buffer);
	bits[0] += limit > 0 ? -1 : 1;
	return f[0];
}

function cutPlacements<K extends string>(
	p: Placements<K>,
	block: number,
	ox: number,
	oz: number,
	x0: number,
	z0: number
): Placements<K> {
	let n = 0;
	for (let k = 0; k < p.count; k++) if (p.block[k] === block) n++;
	const out: Placements<K> = {
		kinds: p.kinds,
		count: n,
		kind: new Uint8Array(n),
		block: new Uint8Array(n),
		x: new Float32Array(n),
		y: new Float32Array(n),
		z: new Float32Array(n),
		scale: new Float32Array(n),
		yawC: new Float32Array(n),
		yawS: new Float32Array(n)
	};
	const xMax = below(x0 + CHUNK_SIZE);
	const zMax = below(z0 + CHUNK_SIZE);
	let m = 0;
	for (let k = 0; k < p.count; k++) {
		if (p.block[k] !== block) continue;
		out.kind[m] = p.kind[k];
		out.x[m] = Math.min(xMax, Math.max(x0, Math.fround(p.x[k] + ox)));
		out.y[m] = p.y[k];
		out.z[m] = Math.min(zMax, Math.max(z0, Math.fround(p.z[k] + oz)));
		out.scale[m] = p.scale[k];
		out.yawC[m] = p.yawC[k];
		out.yawS[m] = p.yawS[k];
		m++;
	}
	return out;
}

/** A zone's collision block moved to world coordinates (bx, bz become the chunk's). */
function cutCollision(b: CollisionBlock, ox: number, oz: number, cx: number, cz: number): CollisionBlock {
	const cylinders = b.cylinders.slice();
	for (let i = 0; i < cylinders.length; i += 5) {
		cylinders[i] += ox;
		cylinders[i + 2] += oz;
	}
	const boxes = b.boxes.slice();
	for (let i = 0; i < boxes.length; i += 8) {
		boxes[i] += ox;
		boxes[i + 2] += oz;
	}
	const decks = b.decks.slice();
	for (let i = 0; i < decks.length; i += 8) {
		decks[i] += ox;
		decks[i + 2] += oz;
		decks[i + 3] += ox;
		decks[i + 5] += oz;
	}
	return {
		index: 0,
		bx: cx,
		bz: cz,
		x0: b.x0 + ox,
		z0: b.z0 + oz,
		minY: b.minY,
		maxY: b.maxY,
		heights: b.heights.slice(),
		cylinders,
		boxes,
		decks
	};
}

/** The zone river's segments whose water reaches [x0, x0 + 40]², in world coordinates. */
function cutRivers(build: ZoneBuild, x0: number, z0: number): Float32Array {
	const { points, halfWidth, depth } = build.world.river;
	const out: number[] = [];
	const ox = build.offsetX;
	const oz = build.offsetZ;
	for (let i = 1; i < points.length; i++) {
		const a = points[i - 1];
		const b = points[i];
		const ax = a.x + ox;
		const az = a.z + oz;
		const bx = b.x + ox;
		const bz = b.z + oz;
		if (
			Math.min(ax, bx) - halfWidth <= x0 + CHUNK_SIZE &&
			Math.max(ax, bx) + halfWidth >= x0 &&
			Math.min(az, bz) - halfWidth <= z0 + CHUNK_SIZE &&
			Math.max(az, bz) + halfWidth >= z0
		)
			out.push(ax, az, a.water, bx, bz, b.water, halfWidth, depth);
	}
	return Float32Array.from(out);
}

/** Whether a box (world) meets chunk [x0, x0 + 40]². */
const touches = (minX: number, minZ: number, maxX: number, maxZ: number, x0: number, z0: number) =>
	minX <= x0 + CHUNK_SIZE && maxX >= x0 && minZ <= z0 + CHUNK_SIZE && maxZ >= z0;

/** The zone's still pool (level.pool, when it is a real one) if its water reaches the chunk. */
function cutPools(build: ZoneBuild, x0: number, z0: number): Float32Array {
	const p = build.level.pool;
	if (!p || !(p.halfLength > 0 && p.halfWidth > 0)) return new Float32Array(0);
	const x = p.x + build.offsetX;
	const z = p.z + build.offsetZ;
	const r = Math.max(p.halfLength, p.halfWidth);
	if (!touches(x - r, z - r, x + r, z + r, x0, z0)) return new Float32Array(0);
	const key = ZONE_IDS.indexOf(build.id) * 1000;
	return Float32Array.of(key, x, z, p.water, p.axisX, p.axisZ, p.halfLength, p.halfWidth);
}

/** The zone's basins (content) whose water reaches the chunk, keyed in the zone's order. */
function cutBasins(build: ZoneBuild, x0: number, z0: number): Float32Array {
	const out: number[] = [];
	const basins = build.level.content?.basins ?? [];
	const base = ZONE_IDS.indexOf(build.id) * 1000 + 1;
	basins.forEach((b, k) => {
		const ax = b.a[0] + build.offsetX;
		const az = b.a[1] + build.offsetZ;
		const bx = b.b[0] + build.offsetX;
		const bz = b.b[1] + build.offsetZ;
		const r = b.radius;
		if (
			touches(Math.min(ax, bx) - r, Math.min(az, bz) - r, Math.max(ax, bx) + r, Math.max(az, bz) + r, x0, z0)
		)
			out.push(base + k, ax, az, bx, bz, r, b.water);
	});
	return Float32Array.from(out);
}

/** Every typed array reachable from `value`, each once (plain data: objects, arrays, typed arrays). */
export function typedArraysOf(
	value: unknown,
	out: ArrayBufferView[] = [],
	seen = new Set<unknown>()
): ArrayBufferView[] {
	if (value === null || typeof value !== 'object' || seen.has(value)) return out;
	seen.add(value);
	if (ArrayBuffer.isView(value)) {
		out.push(value);
		return out;
	}
	for (const v of Array.isArray(value) ? value : Object.values(value)) typedArraysOf(v, out, seen);
	return out;
}

/** The distinct buffers under `value`: what it holds in memory, and what a transfer list moves. */
export function buffersOf(value: unknown): ArrayBuffer[] {
	return [...new Set(typedArraysOf(value).map((a) => a.buffer as ArrayBuffer))];
}

/** Bytes of a world's typed arrays (heights, zones, flags, baseSteps, placements, collision blocks…). */
export function worldBytes(world: SurvivalWorld): number {
	let bytes = 0;
	for (const b of buffersOf(world)) bytes += b.byteLength;
	return bytes;
}

export interface ZoneCut {
	id: ZoneId;
	offsetX: number;
	offsetZ: number;
	width: number;
	depth: number;
	level: StoryRef['level'];
	/**
	 * A snapshot of the zone's SurvivalWorld (zone-local, the zone's own shape:
	 * heights, zones, flags, river, animals…) on buffers of its own, for whoever
	 * needs the whole zone on the main thread (Soundscape.setMap with origin
	 * (offsetX, offsetZ)) without building it there. The Worker's memoised build
	 * is never transferred: only the snapshot's buffers travel.
	 */
	world: SurvivalWorld;
	/** Row-major over the zone's chunk rectangle (PARK_ZONES[id] cx0..cx1, cz0..cz1). */
	chunks: StreamChunk[];
	/** Bytes of every chunk and of the world snapshot. */
	bytes: number;
}

/**
 * Cuts a built zone into its chunks. `built` supplies neighbouring zones for
 * the aprons; `seed` the generated ground beyond the park.
 */
export function cutZone(
	build: ZoneBuild,
	built: ReadonlyMap<ZoneId, ZoneBuild> = new Map(),
	seed = WORLD_SEED
): ZoneCut {
	const spec = PARK_ZONES[build.id];
	const { world, offsetX: ox, offsetZ: oz } = build;
	const blocksX = build.width / CHUNK_SIZE;
	const chunks: StreamChunk[] = [];
	const falls = waterfallsOf(build);
	let total = 0;
	for (let cz = spec.cz0; cz <= spec.cz1; cz++)
		for (let cx = spec.cx0; cx <= spec.cx1; cx++) {
			const bx = cx - spec.cx0;
			const bz = cz - spec.cz0;
			const block = bz * blocksX + bx;
			const x0 = cx * CHUNK_SIZE;
			const z0 = cz * CHUNK_SIZE;
			const lx0 = bx * CHUNK_SIZE;
			const lz0 = bz * CHUNK_SIZE;
			const heights = new Float32Array(CHUNK_VERTICES);
			const flags = new Uint8Array(CHUNK_VERTICES);
			const zones = new Uint8Array(CHUNK_VERTICES);
			for (let j = 0; j < CHUNK_SIDE; j++)
				for (let i = 0; i < CHUNK_SIDE; i++) {
					const s = (lz0 + j) * world.grid + lx0 + i;
					const d = j * CHUNK_SIDE + i;
					heights[d] = world.heights[s];
					flags[d] = world.flags[s];
					zones[d] = world.zones[s];
				}
			const [minY, maxY] = heightRange(heights);
			const chunk: Omit<StreamChunk, 'bytes'> = {
				key: chunkId(cx, cz),
				cx,
				cz,
				x0,
				z0,
				origin: 'zone',
				zone: build.id,
				waterLevel: world.waterLevel,
				heights,
				apron: zoneApron(build, built, x0, z0, seed),
				flags,
				zones,
				rivers: cutRivers(build, x0, z0),
				riverFlags: new Uint8Array(0),
				trees: cutPlacements(world.trees, block, ox, oz, x0, z0),
				rocks: cutPlacements(world.rocks, block, ox, oz, x0, z0),
				decorations: cutPlacements(world.decorations, block, ox, oz, x0, z0),
				collision: cutCollision(world.blocks[block], ox, oz, cx, cz),
				pools: cutPools(build, x0, z0),
				basins: cutBasins(build, x0, z0),
				waterfalls: waterfallsIn(falls, cx, cz),
				scenery: waterfallPlacements(waterfallsIn(falls, cx, cz)),
				story: { zone: build.id, offsetX: ox, offsetZ: oz, block, level: build.level },
				minY,
				maxY,
				generated: null
			};
			chunk.riverFlags = new Uint8Array(chunk.rivers.length / RIVER_STRIDE);
			const bytes = streamChunkBytes(chunk);
			total += bytes;
			chunks.push({ ...chunk, bytes });
		}
	// Its own copy: the memo (build.world) must keep its buffers whatever the snapshot's travel does.
	const snapshot = structuredClone(world);
	total += worldBytes(snapshot);
	return {
		id: build.id,
		offsetX: ox,
		offsetZ: oz,
		width: build.width,
		depth: build.depth,
		level: build.level,
		world: snapshot,
		chunks,
		bytes: total
	};
}
