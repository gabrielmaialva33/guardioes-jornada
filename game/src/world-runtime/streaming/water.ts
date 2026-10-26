/**
 * Water of a streamed chunk (P37): one signed field per vertex, the union of
 * every body of water around the chunk, from which both the terrain's
 * `shore` attribute and the chunk's water mesh are written.
 *
 * The field is shore.ts waterField, extended. In order:
 * - rivers: segments with their own half width, surface linear along each;
 * - still pools (level/types.ts Pool, poolShoreScale's outline);
 * - basins (zone content: capsules, the Vale's plunge pool and spring, the
 *   Praia's tide pools);
 * - the sea: the level set of φ = h − waterLevel over ZONE.sea ground (the
 *   coast, the surf, the Manguezal's flooded mangrove and its canoe
 *   channel), land held at φ ≥ SEA_LAND so no dry ground below sea level (a
 *   carved river bed) floods. Distance is φ / |∇φ|, first order, from the
 *   FieldWindow's samples.
 * Pools, basins and the sea blend their surface in as waterField blends its
 * pool. On the Reserva (river and pool only) this is waterField exactly.
 *
 * Every term is in world coordinates and every body within SHORE_REACH of a
 * vertex is in its chunk's 3 × 3 list, so both sides of a chunk edge compute
 * the same field: the foam and the depth colour run on without a seam.
 *
 * The mesh is shore.ts waterSurface's: a 1 u grid, `position` at the surface
 * + 0.005, `color` shallow → deep by depth, `water` (distance, depth),
 * `normal`, and the cells whose nearest corner is within 0.6 u of the water.
 * Two departures, both invisible: a cell spanning a drop of more than
 * FALL_STEP is left out (the waterfall's own model fills it), and runs of deep,
 * level cells (open sea) merge into larger quads.
 */
import { BufferAttribute, BufferGeometry, Color, type Material, Mesh, Sphere, Vector3 } from 'three';
import { RAMPS } from '../../style/palette.ts';
import { ZONE } from '../../survival/types.ts';
import { poolShoreScale } from '../paths.ts';
import {
	BASIN_KEYED_STRIDE,
	CHUNK_SIDE,
	CHUNK_SIZE,
	CHUNK_VERTICES,
	POOL_STRIDE,
	RIVER_STRIDE,
	type StreamChunk
} from './types.ts';
import { type FieldWindow, WINDOW_MARGIN, WINDOW_SIDE } from './window.ts';

/** A still pool (level/types.ts Pool), world coordinates. */
export interface PoolShape {
	x: number;
	z: number;
	water: number;
	axisX: number;
	axisZ: number;
	halfLength: number;
	halfWidth: number;
}

/** Floats per basin: [ax, az, bx, bz, radius, water], world coordinates. */
export const BASIN_STRIDE = 6;

/** Every body of water a chunk's field reads, in a fixed order on both sides of any edge. */
export interface WaterBodies {
	waterLevel: number;
	/** RIVER_STRIDE floats per segment. */
	rivers: Float32Array;
	pools: readonly PoolShape[];
	/** BASIN_STRIDE floats per basin. */
	basins: Float32Array;
	/** Whether the window holds any sea sample (φ ≤ 0); seaInWindow() tells. */
	sea: boolean;
}

/** True when any sample of the window is sea (ZONE.sea at or below the water level). */
export function seaInWindow(win: FieldWindow, waterLevel: number): boolean {
	for (let s = 0; s < win.zones.length; s++)
		if (win.zones[s] === ZONE.sea && win.heights[s] <= waterLevel) return true;
	return false;
}

/**
 * Beyond this distance from any water the shore attribute holds the runtime's
 * "no shore" value (cliff.ts, visual.ts): (−10000, 10000). The shader reads
 * the shore within about 1 u only.
 */
export const SHORE_REACH = 32;
export const SHORE_FAR = 10000;
/** A water cell is drawn when its nearest corner is this close (shore.ts waterSurface). */
export const WATER_CELL = 0.6;
/** A cell whose corners' surfaces differ by more than this is a fall: left to the waterfall model. */
export const FALL_STEP = 1.5;
/** Land never sits closer than this above the sea in φ, so dry ground below sea level stays dry. */
export const SEA_LAND = 0.3;
/** The sea term applies within this many samples (Chebyshev) of a sea sample. */
const SEA_NEAR = 2;
/** Slope floor for the sea's φ / |∇φ|: flat ground far from the coast reads far, not near. */
const SEA_SLOPE = 0.05;
/** Cells deeper than this inside open water look the same: their colour and foam are saturated. */
const DEEP_INSIDE = -2;
const DEEP_DEPTH = 1.5;

export interface WaterSample {
	height: number;
	distance: number;
	depth: number;
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/** φ of the sea at window sample s. */
function seaPhi(win: FieldWindow, s: number, level: number): number {
	const v = win.heights[s] - level;
	return win.zones[s] === ZONE.sea ? v : Math.max(v, SEA_LAND);
}

/**
 * The field at vertex (x, z), world coordinates, an integer vertex of the
 * window's chunk or its one-sample margin. Allocation-free.
 */
export function waterAt(
	b: WaterBodies,
	win: FieldWindow,
	x: number,
	z: number,
	out: WaterSample
): WaterSample {
	let distance = Number.POSITIVE_INFINITY;
	let height = b.waterLevel;
	const rivers = b.rivers;
	// shore.ts waterField: the nearest river segment wins.
	for (let s = 0; s < rivers.length; s += RIVER_STRIDE) {
		const ax = rivers[s],
			az = rivers[s + 1],
			aw = rivers[s + 2],
			dx = rivers[s + 3] - ax,
			dz = rivers[s + 4] - az,
			t = clamp01(((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1)),
			px = x - ax - t * dx,
			pz = z - az - t * dz;
		const d = Math.sqrt(px * px + pz * pz) - rivers[s + 6];
		if (d < distance) {
			distance = d;
			height = aw + (rivers[s + 5] - aw) * t;
		}
	}
	// Still water blends its surface in (waterField's pool), then takes the union.
	for (let k = 0; k < b.pools.length; k++) {
		const pool = b.pools[k];
		const dx = x - pool.x,
			dz = z - pool.z,
			a = (dx * pool.axisX + dz * pool.axisZ) / pool.halfLength,
			c = (-dx * pool.axisZ + dz * pool.axisX) / pool.halfWidth;
		const d =
			(Math.sqrt(a * a + c * c) - poolShoreScale(Math.atan2(c, a))) *
			Math.min(pool.halfLength, pool.halfWidth);
		const t = clamp01((distance - d + 1) * 0.5),
			blend = t * t * (3 - 2 * t);
		height += (pool.water - height) * blend;
		distance = Math.min(distance, d);
	}
	const basins = b.basins;
	for (let s = 0; s < basins.length; s += BASIN_STRIDE) {
		const ax = basins[s],
			az = basins[s + 1],
			dx = basins[s + 2] - ax,
			dz = basins[s + 3] - az,
			t0 = clamp01(((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1)),
			px = x - ax - t0 * dx,
			pz = z - az - t0 * dz;
		const d = Math.sqrt(px * px + pz * pz) - basins[s + 4];
		const t = clamp01((distance - d + 1) * 0.5),
			blend = t * t * (3 - 2 * t);
		height += (basins[s + 5] - height) * blend;
		distance = Math.min(distance, d);
	}
	// The sea: φ / |∇φ| from the window (central differences), first order, wherever a sea
	// sample (φ ≤ 0) lies within 2 u: the shoreline is a real crossing, never a low slope alone.
	const i = x - win.x0;
	const j = z - win.z0;
	const c = j * WINDOW_SIDE + i;
	const level = b.waterLevel;
	const phi = seaPhi(win, c, level);
	let sea = phi <= 0;
	if (!sea && b.sea)
		near: for (let dz = -SEA_NEAR; dz <= SEA_NEAR; dz++)
			for (let dx = -SEA_NEAR; dx <= SEA_NEAR; dx++)
				if (seaPhi(win, c + dz * WINDOW_SIDE + dx, level) <= 0) {
					sea = true;
					break near;
				}
	if (sea) {
		const gx = (seaPhi(win, c + 1, level) - seaPhi(win, c - 1, level)) * 0.5;
		const gz = (seaPhi(win, c + WINDOW_SIDE, level) - seaPhi(win, c - WINDOW_SIDE, level)) * 0.5;
		const d = phi / Math.max(Math.sqrt(gx * gx + gz * gz), SEA_SLOPE);
		const t = clamp01((distance - d + 1) * 0.5),
			blend = t * t * (3 - 2 * t);
		height += (level - height) * blend;
		distance = Math.min(distance, d);
	}
	out.height = height;
	out.distance = distance;
	out.depth = Math.max(0, height - win.heights[c]);
	return out;
}

const EMPTY = new Float32Array(0);

/**
 * The bodies of water around a chunk: rivers, pools and basins of the chunk
 * and its eight neighbours (each lists what reaches it), pools and basins
 * deduplicated and ordered by key, so every chunk blends them in the same
 * order; the sea from the filled window.
 */
export function gatherBodies(
	chunk: StreamChunk,
	lookup: (cx: number, cz: number) => StreamChunk | null | undefined,
	win: FieldWindow
): WaterBodies {
	let rivers = 0;
	const pools = new Map<number, PoolShape>();
	const basins = new Map<number, number>();
	const around: StreamChunk[] = [];
	for (let dz = -1; dz <= 1; dz++)
		for (let dx = -1; dx <= 1; dx++) {
			const c = dx === 0 && dz === 0 ? chunk : lookup(chunk.cx + dx, chunk.cz + dz);
			if (!c) continue;
			around.push(c);
			rivers += c.rivers.length;
			const p = c.pools ?? EMPTY;
			for (let s = 0; s < p.length; s += POOL_STRIDE) {
				pools.set(p[s], {
					x: p[s + 1],
					z: p[s + 2],
					water: p[s + 3],
					axisX: p[s + 4],
					axisZ: p[s + 5],
					halfLength: p[s + 6],
					halfWidth: p[s + 7]
				});
			}
			const b = c.basins ?? EMPTY;
			for (let s = 0; s < b.length; s += BASIN_KEYED_STRIDE) basins.set(b[s], s);
		}
	const river = new Float32Array(rivers);
	let o = 0;
	for (const c of around) {
		river.set(c.rivers, o);
		o += c.rivers.length;
	}
	// Basin values: from whichever chunk listed the key (identical in each).
	const basinKeys = [...basins.keys()].sort((a, b) => a - b);
	const basin = new Float32Array(basinKeys.length * BASIN_STRIDE);
	basinKeys.forEach((key, k) => {
		for (const c of around) {
			const b = c.basins ?? EMPTY;
			for (let s = 0; s < b.length; s += BASIN_KEYED_STRIDE)
				if (b[s] === key) {
					basin.set(b.subarray(s + 1, s + BASIN_KEYED_STRIDE), k * BASIN_STRIDE);
					return;
				}
		}
	});
	return {
		waterLevel: chunk.waterLevel,
		rivers: river,
		pools: [...pools.keys()].sort((a, b) => a - b).map((key) => pools.get(key) as PoolShape),
		basins: basin,
		sea: seaInWindow(win, chunk.waterLevel)
	};
}

/** The field over a chunk's vertices plus one ring: (41 + 2)², row-major from (x0 − 1, z0 − 1). */
export const FIELD_SIDE = CHUNK_SIDE + 2;

export interface WaterField {
	height: Float32Array;
	distance: Float32Array;
	depth: Float32Array;
}

export function createWaterField(): WaterField {
	const n = FIELD_SIDE * FIELD_SIDE;
	return { height: new Float32Array(n), distance: new Float32Array(n), depth: new Float32Array(n) };
}

const sample: WaterSample = { height: 0, distance: 0, depth: 0 };

/** Fills the field for the window's chunk (the margin ring needs WINDOW_MARGIN ≥ 1 + SEA_NEAR). */
export function fillWaterField(b: WaterBodies, win: FieldWindow, out: WaterField): WaterField {
	const x0 = win.x0 + WINDOW_MARGIN;
	const z0 = win.z0 + WINDOW_MARGIN;
	for (let j = 0; j < FIELD_SIDE; j++)
		for (let i = 0; i < FIELD_SIDE; i++) {
			waterAt(b, win, x0 - 1 + i, z0 - 1 + j, sample);
			const f = j * FIELD_SIDE + i;
			// Out of reach the bodies around differ from chunk to chunk: hold one value for "no water".
			const far = !(sample.distance < SHORE_REACH);
			out.height[f] = far ? b.waterLevel : sample.height;
			out.distance[f] = far ? SHORE_FAR : sample.distance;
			out.depth[f] = far ? 0 : sample.depth;
		}
	return out;
}

/** Writes rows [j0, j1) of the terrain's `shore` attribute (41² × 2) from the field. */
export function writeShore(field: WaterField, shore: Float32Array, j0 = 0, j1 = CHUNK_SIDE) {
	for (let j = j0; j < j1; j++)
		for (let i = 0; i < CHUNK_SIDE; i++) {
			const f = (j + 1) * FIELD_SIDE + i + 1;
			const v = (j * CHUNK_SIDE + i) * 2;
			const d = field.distance[f];
			const far = !(d < SHORE_REACH);
			shore[v] = far ? -SHORE_FAR : field.height[f];
			shore[v + 1] = far ? SHORE_FAR : d;
		}
}

/** A chunk's water mesh data: every vertex of the 41² grid, the index of the cells drawn. */
export interface WaterAttributes {
	position: Float32Array;
	color: Float32Array;
	water: Float32Array;
	normal: Float32Array;
	/** Up to 40 · 40 · 6; `count` of them are used. */
	index: Uint16Array;
	count: number;
	/** Surface height range of the drawn vertices. */
	minY: number;
	maxY: number;
}

export function createWaterAttributes(): WaterAttributes {
	return {
		position: new Float32Array(CHUNK_VERTICES * 3),
		color: new Float32Array(CHUNK_VERTICES * 3),
		water: new Float32Array(CHUNK_VERTICES * 2),
		normal: new Float32Array(CHUNK_VERTICES * 3),
		index: new Uint16Array(CHUNK_SIZE * CHUNK_SIZE * 6),
		count: 0,
		minY: 0,
		maxY: 0
	};
}

const deep = new Color(RAMPS.water[0]);
const shallow = new Color(RAMPS.water[2]);
const tint = new Color();
const covered = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE);

/** The water mesh of the field's chunk at (x0, z0); positions chunk-local unless `local` is false. */
export function buildWaterMesh(
	field: WaterField,
	x0: number,
	z0: number,
	local: boolean,
	out: WaterAttributes
) {
	const F = FIELD_SIDE;
	for (let j = 0; j < CHUNK_SIDE; j++)
		for (let i = 0; i < CHUNK_SIDE; i++) {
			const f = (j + 1) * F + i + 1;
			const v = j * CHUNK_SIDE + i;
			const h = field.height[f];
			out.position[v * 3] = local ? i : x0 + i;
			out.position[v * 3 + 1] = h + 0.005;
			out.position[v * 3 + 2] = local ? j : z0 + j;
			out.water[v * 2] = Math.min(field.distance[f], SHORE_FAR);
			out.water[v * 2 + 1] = field.depth[f];
			const t = clamp01((field.depth[f] - 0.1) / 1.4);
			tint.copy(shallow).lerp(deep, t * t * (3 - 2 * t));
			out.color[v * 3] = tint.r;
			out.color[v * 3 + 1] = tint.g;
			out.color[v * 3 + 2] = tint.b;
			const dx = field.height[f + 1] - field.height[f - 1];
			const dz = field.height[f + F] - field.height[f - F];
			const n = Math.sqrt(dx * dx + 4 + dz * dz);
			out.normal[v * 3] = -dx / n;
			out.normal[v * 3 + 1] = 2 / n;
			out.normal[v * 3 + 2] = -dz / n;
		}
	// Which cells: water within WATER_CELL of a corner, no fall across them; open sea merges.
	const S = CHUNK_SIDE;
	const kind = covered;
	const at = (i: number, j: number) => (j + 1) * F + i + 1;
	for (let j = 0; j < CHUNK_SIZE; j++)
		for (let i = 0; i < CHUNK_SIZE; i++) {
			const a = at(i, j),
				b = a + 1,
				c = a + F,
				d = c + 1;
			const dist = field.distance;
			const nearest = Math.min(dist[a], dist[b], dist[c], dist[d]);
			const hs = field.height;
			const lo = Math.min(hs[a], hs[b], hs[c], hs[d]);
			const hi = Math.max(hs[a], hs[b], hs[c], hs[d]);
			let k = 0;
			if (nearest <= WATER_CELL && hi - lo <= FALL_STEP) {
				k = 1;
				const dp = field.depth;
				if (
					hi === lo &&
					Math.max(dist[a], dist[b], dist[c], dist[d]) < DEEP_INSIDE &&
					Math.min(dp[a], dp[b], dp[c], dp[d]) >= DEEP_DEPTH
				)
					k = 2;
			}
			kind[j * CHUNK_SIZE + i] = k;
		}
	let n = 0;
	let minY = Number.POSITIVE_INFINITY;
	let maxY = Number.NEGATIVE_INFINITY;
	const quad = (i0: number, j0: number, i1: number, j1: number) => {
		const a = j0 * S + i0,
			b = j0 * S + i1,
			c = j1 * S + i0,
			d = j1 * S + i1;
		// shore.ts's winding: (a, c, b), (b, c, d).
		out.index[n++] = a;
		out.index[n++] = c;
		out.index[n++] = b;
		out.index[n++] = b;
		out.index[n++] = c;
		out.index[n++] = d;
		const ya = out.position[a * 3 + 1],
			yb = out.position[b * 3 + 1],
			yc = out.position[c * 3 + 1],
			yd = out.position[d * 3 + 1];
		minY = Math.min(minY, ya, yb, yc, yd);
		maxY = Math.max(maxY, ya, yb, yc, yd);
	};
	for (let j = 0; j < CHUNK_SIZE; j++)
		for (let i = 0; i < CHUNK_SIZE; i++) {
			const k = kind[j * CHUNK_SIZE + i];
			if (k === 0) continue;
			if (k === 1) {
				quad(i, j, i + 1, j + 1);
				kind[j * CHUNK_SIZE + i] = 0;
				continue;
			}
			// Greedy rectangle of open-sea cells at one level.
			const y = field.height[at(i, j)];
			let w = 1;
			while (i + w < CHUNK_SIZE && kind[j * CHUNK_SIZE + i + w] === 2 && field.height[at(i + w, j)] === y)
				w++;
			let h = 1;
			grow: while (j + h < CHUNK_SIZE) {
				for (let m = 0; m < w; m++)
					if (kind[(j + h) * CHUNK_SIZE + i + m] !== 2 || field.height[at(i + m, j + h)] !== y) break grow;
				h++;
			}
			for (let q = 0; q < h; q++) kind.fill(0, (j + q) * CHUNK_SIZE + i, (j + q) * CHUNK_SIZE + i + w);
			quad(i, j, i + w, j + h);
		}
	out.count = n;
	out.minY = n > 0 ? minY : 0;
	out.maxY = n > 0 ? maxY : 0;
	return out;
}

const scratch = new Vector3();
const NAMES = ['position', 'color', 'water', 'normal'] as const;

/**
 * Water meshes for the render ring, reused like the terrain's: every mesh
 * owns 41² vertices and a full index; a chunk sets the draw range.
 */
export class WaterMeshPool {
	readonly material: Material;
	readonly local: boolean;
	readonly #free: Mesh[] = [];
	readonly #all: Mesh[] = [];

	constructor(material: Material, options: { local?: boolean } = {}) {
		this.material = material;
		this.local = options.local ?? true;
	}

	get size(): number {
		return this.#all.length;
	}

	get inUse(): number {
		return this.#all.length - this.#free.length;
	}

	/** A mesh holding the chunk's water; call only when `water.count` > 0. */
	acquire(water: WaterAttributes, x0: number, z0: number): Mesh {
		const mesh = this.#free.pop() ?? this.#make();
		const g = mesh.geometry;
		for (let k = 0; k < NAMES.length; k++) {
			const a = g.getAttribute(NAMES[k]) as BufferAttribute;
			(a.array as Float32Array).set(water[NAMES[k]]);
			a.needsUpdate = true;
		}
		const index = g.getIndex() as BufferAttribute;
		(index.array as Uint16Array).set(water.index.subarray(0, water.count));
		index.clearUpdateRanges();
		index.addUpdateRange(0, water.count);
		index.needsUpdate = true;
		g.setDrawRange(0, water.count);
		const half = CHUNK_SIZE / 2;
		const dy = (water.maxY - water.minY) / 2;
		const sphere = g.boundingSphere as Sphere;
		sphere.center.set(
			this.local ? half : x0 + half,
			(water.minY + water.maxY) / 2,
			this.local ? half : z0 + half
		);
		sphere.radius = Math.sqrt(half * half * 2 + dy * dy);
		const box = g.boundingBox;
		if (box) {
			box.min.set(this.local ? 0 : x0, water.minY, this.local ? 0 : z0);
			box.max.copy(box.min).add(scratch.set(CHUNK_SIZE, water.maxY - water.minY, CHUNK_SIZE));
		}
		mesh.position.set(this.local ? x0 : 0, 0, this.local ? z0 : 0);
		mesh.updateMatrix();
		mesh.updateMatrixWorld();
		mesh.visible = true;
		return mesh;
	}

	release(mesh: Mesh) {
		mesh.removeFromParent();
		mesh.visible = false;
		this.#free.push(mesh);
	}

	dispose() {
		for (const mesh of this.#all) {
			mesh.removeFromParent();
			mesh.geometry.dispose();
		}
		this.#all.length = 0;
		this.#free.length = 0;
	}

	#make(): Mesh {
		const g = new BufferGeometry();
		g.setAttribute('position', new BufferAttribute(new Float32Array(CHUNK_VERTICES * 3), 3));
		g.setAttribute('color', new BufferAttribute(new Float32Array(CHUNK_VERTICES * 3), 3));
		g.setAttribute('water', new BufferAttribute(new Float32Array(CHUNK_VERTICES * 2), 2));
		g.setAttribute('normal', new BufferAttribute(new Float32Array(CHUNK_VERTICES * 3), 3));
		g.setIndex(new BufferAttribute(new Uint16Array(CHUNK_SIZE * CHUNK_SIZE * 6), 1));
		g.boundingSphere = new Sphere();
		const mesh = new Mesh(g, this.material);
		mesh.name = 'stream-water';
		mesh.matrixAutoUpdate = false;
		this.#all.push(mesh);
		return mesh;
	}
}
