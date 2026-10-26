/**
 * Per-chunk terrain mesh in terrain.ts terrainChunk's vertex format, so the
 * P32 terrain material applies unchanged: `position` (3), `color` (3),
 * `normal` (3), `shore` (2: water height, distance to the water's edge, from
 * water.ts's field, the one the chunk's water mesh is built from) and
 * the same index order over 41 × 41 vertices. Normals are terrainChunk's
 * central differences, n = normalize(−dx, 2, −dz), read from the FieldWindow,
 * so they are seamless across chunk edges. Positions are chunk-local by
 * default (the mesh sits at (x0, 0, z0)); the stylized shader works from
 * modelMatrix · position, so world-space effects line up either way.
 *
 * `buildTerrainRows` is pure (three's Color is its only import from three)
 * and runs in the streaming Worker or, row by row, on the main thread.
 * `TerrainMeshPool` reuses meshes and their buffers: no allocation per chunk.
 */
import { BufferAttribute, BufferGeometry, Color, type Material, Mesh, Sphere, Vector3 } from 'three';
import { poolShoreScale } from '../paths.ts';
import { type TerrainTint, windowTint } from './tint.ts';
import { CHUNK_SIDE, CHUNK_SIZE, CHUNK_VERTICES, RIVER_STRIDE } from './types.ts';
import {
	type PoolShape,
	SHORE_FAR,
	SHORE_REACH,
	type WaterBodies,
	type WaterField,
	type WaterSample,
	waterAt,
	writeShore
} from './water.ts';
import { type FieldWindow, WINDOW_MARGIN, WINDOW_SIDE } from './window.ts';

export { type PoolShape, SHORE_FAR, SHORE_REACH } from './water.ts';

export interface TerrainInput {
	window: FieldWindow;
	x0: number;
	z0: number;
	waterLevel: number;
	/** River segments around the chunk (its own and its neighbours'), RIVER_STRIDE floats each, world coordinates. */
	rivers: Float32Array;
	pool: PoolShape | null;
	/**
	 * Every body of water around the chunk (water.ts gatherBodies: rivers,
	 * pools, basins, the sea). When present it is the `shore` attribute's field;
	 * without it, the P34 shore (rivers and one pool).
	 */
	bodies?: WaterBodies;
	/** Chunk-local positions (default) or world positions. */
	local: boolean;
}

/** The bodies of an input: its own, or the P34 pair (rivers and one pool) as bodies. */
export function inputBodies(input: TerrainInput): WaterBodies {
	return (
		input.bodies ?? {
			waterLevel: input.waterLevel,
			rivers: input.rivers,
			pools: input.pool && input.pool.halfLength > 0 && input.pool.halfWidth > 0 ? [input.pool] : [],
			basins: new Float32Array(0),
			sea: false
		}
	);
}

/**
 * The P34 shore of one vertex (rivers and one pool, world coordinates):
 * water.ts waterAt without basins or sea. Writes [height, distance] at `o`.
 */
export function shoreSample(
	rivers: Float32Array,
	pool: PoolShape | null,
	waterLevel: number,
	x: number,
	z: number,
	out: Float32Array,
	o: number
) {
	let distance = Number.POSITIVE_INFINITY;
	let height = waterLevel;
	for (let s = 0; s < rivers.length; s += RIVER_STRIDE) {
		const ax = rivers[s],
			az = rivers[s + 1],
			aw = rivers[s + 2],
			dx = rivers[s + 3] - ax,
			dz = rivers[s + 4] - az,
			t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1))),
			px = x - ax - t * dx,
			pz = z - az - t * dz;
		const d = Math.sqrt(px * px + pz * pz) - rivers[s + 6];
		if (d < distance) {
			distance = d;
			height = aw + (rivers[s + 5] - aw) * t;
		}
	}
	if (pool && pool.halfLength > 0 && pool.halfWidth > 0) {
		const dx = x - pool.x,
			dz = z - pool.z,
			a = (dx * pool.axisX + dz * pool.axisZ) / pool.halfLength,
			b = (-dx * pool.axisZ + dz * pool.axisX) / pool.halfWidth;
		const d =
			(Math.sqrt(a * a + b * b) - poolShoreScale(Math.atan2(b, a))) *
			Math.min(pool.halfLength, pool.halfWidth);
		const t = Math.max(0, Math.min(1, (distance - d + 1) * 0.5)),
			blend = t * t * (3 - 2 * t);
		height += (pool.water - height) * blend;
		distance = Math.min(distance, d);
	}
	const far = !(distance < SHORE_REACH);
	out[o] = far ? -SHORE_FAR : height;
	out[o + 1] = far ? SHORE_FAR : distance;
}

export interface TerrainAttributes {
	position: Float32Array;
	color: Float32Array;
	normal: Float32Array;
	shore: Float32Array;
}

export function createTerrainAttributes(): TerrainAttributes {
	return {
		position: new Float32Array(CHUNK_VERTICES * 3),
		color: new Float32Array(CHUNK_VERTICES * 3),
		normal: new Float32Array(CHUNK_VERTICES * 3),
		shore: new Float32Array(CHUNK_VERTICES * 2)
	};
}

/** terrainChunk's triangle order: (i, i + 41, i + 1), (i + 1, i + 41, i + 42). Shared by every chunk. */
export const TERRAIN_INDEX: Uint16Array = (() => {
	const out = new Uint16Array(CHUNK_SIZE * CHUNK_SIZE * 6);
	let k = 0;
	for (let z = 0; z < CHUNK_SIZE; z++)
		for (let x = 0; x < CHUNK_SIZE; x++) {
			const i = z * CHUNK_SIDE + x;
			out[k++] = i;
			out[k++] = i + CHUNK_SIDE;
			out[k++] = i + 1;
			out[k++] = i + 1;
			out[k++] = i + CHUNK_SIDE;
			out[k++] = i + CHUNK_SIDE + 1;
		}
	return out;
})();

const color = new Color();

/**
 * Fills vertex rows [j0, j1) of `out` (0 ≤ j0 < j1 ≤ 41) from the window and
 * the chunk's water field (water.ts fillWaterField, the same field its water
 * mesh is built from). No allocation.
 */
export function buildTerrainRows(
	input: TerrainInput,
	out: TerrainAttributes,
	j0 = 0,
	j1 = CHUNK_SIDE,
	tint: TerrainTint = windowTint,
	field?: WaterField
) {
	const { window: win, x0, z0, local } = input;
	const h = win.heights;
	const m = WINDOW_MARGIN;
	for (let j = j0; j < j1; j++)
		for (let i = 0; i < CHUNK_SIDE; i++) {
			const v = j * CHUNK_SIDE + i;
			const w = (j + m) * WINDOW_SIDE + i + m;
			const x = x0 + i;
			const z = z0 + j;
			const p = v * 3;
			out.position[p] = local ? i : x;
			out.position[p + 1] = h[w];
			out.position[p + 2] = local ? j : z;
			const dx = h[w + 1] - h[w - 1];
			const dz = h[w + WINDOW_SIDE] - h[w - WINDOW_SIDE];
			const n = Math.hypot(dx, 2, dz);
			out.normal[p] = -dx / n;
			out.normal[p + 1] = 2 / n;
			out.normal[p + 2] = -dz / n;
			tint(win, x, z, color);
			out.color[p] = color.r;
			out.color[p + 1] = color.g;
			out.color[p + 2] = color.b;
		}
	if (field) writeShore(field, out.shore, j0, j1);
	else {
		// No field handed over: compute the shore here, vertex by vertex, from the input's bodies.
		const bodies = inputBodies(input);
		for (let j = j0; j < j1; j++)
			for (let i = 0; i < CHUNK_SIDE; i++) {
				waterAt(bodies, input.window, x0 + i, z0 + j, sample);
				const v = (j * CHUNK_SIDE + i) * 2;
				const far = !(sample.distance < SHORE_REACH);
				out.shore[v] = far ? -SHORE_FAR : sample.height;
				out.shore[v + 1] = far ? SHORE_FAR : sample.distance;
			}
	}
}

const sample: WaterSample = { height: 0, distance: 0, depth: 0 };

/** Bounding sphere of a chunk mesh from its height range (local or world positions). */
export function chunkSphere(
	target: Sphere,
	x0: number,
	z0: number,
	minY: number,
	maxY: number,
	local: boolean
): Sphere {
	const half = CHUNK_SIZE / 2;
	const dy = (maxY - minY) / 2;
	target.center.set(local ? half : x0 + half, (minY + maxY) / 2, local ? half : z0 + half);
	target.radius = Math.sqrt(half * half * 2 + dy * dy);
	return target;
}

const scratch = new Vector3();
const ATTRIBUTES = ['position', 'color', 'normal', 'shore'] as const;

/**
 * Terrain meshes for the render ring, made once and reused: a released mesh
 * keeps its buffers for the next chunk. Every geometry shares one index.
 */
export class TerrainMeshPool {
	readonly material: Material;
	readonly local: boolean;
	readonly #free: Mesh[] = [];
	readonly #all: Mesh[] = [];
	readonly #index = new BufferAttribute(TERRAIN_INDEX, 1);

	constructor(material: Material, options: { local?: boolean; prealloc?: number } = {}) {
		this.material = material;
		this.local = options.local ?? true;
		for (let k = 0; k < (options.prealloc ?? 0); k++) this.#free.push(this.#make());
	}

	/** Meshes made so far (in use or free). */
	get size(): number {
		return this.#all.length;
	}

	get inUse(): number {
		return this.#all.length - this.#free.length;
	}

	/** A mesh holding `attributes` for the chunk at (x0, z0). */
	acquire(attributes: TerrainAttributes, x0: number, z0: number, minY: number, maxY: number): Mesh {
		const mesh = this.#free.pop() ?? this.#make();
		const g = mesh.geometry;
		for (let k = 0; k < ATTRIBUTES.length; k++) {
			const name = ATTRIBUTES[k];
			const a = g.getAttribute(name) as BufferAttribute;
			(a.array as Float32Array).set(attributes[name]);
			a.needsUpdate = true;
		}
		chunkSphere(g.boundingSphere as Sphere, x0, z0, minY, maxY, this.local);
		const box = g.boundingBox;
		if (box) {
			box.min.set(this.local ? 0 : x0, minY, this.local ? 0 : z0);
			box.max.copy(box.min).add(scratch.set(CHUNK_SIZE, maxY - minY, CHUNK_SIZE));
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
		g.setAttribute('normal', new BufferAttribute(new Float32Array(CHUNK_VERTICES * 3), 3));
		g.setAttribute('shore', new BufferAttribute(new Float32Array(CHUNK_VERTICES * 2), 2));
		g.setIndex(this.#index);
		g.boundingSphere = new Sphere();
		const mesh = new Mesh(g, this.material);
		mesh.name = 'stream-terrain';
		mesh.matrixAutoUpdate = false;
		this.#all.push(mesh);
		return mesh;
	}
}
