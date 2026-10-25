/**
 * Instance pools: one InstancedMesh per (GLTF node, material), with a fixed
 * capacity, stable ids, per-block culling and LOD, and optional per-instance
 * colour. One pool is one draw call per pass however many instances it shows
 * (InstancedMesh is native WebGL2 instancing; BatchedMesh is avoided because
 * without WEBGL_multi_draw it falls back to one draw per geometry,
 * roblox-web-stack.md §6).
 *
 * How a frame works: `grid.update(camera)` tests the blocks (blocks.ts), then
 * each registered pool compares every block's "keep" share (0 when the block is
 * out of view, else its LOD profile at the block's distance) with the last
 * frame's. Only when one changed, or instances were added, removed or moved
 * across blocks, does the pool rewrite its GPU buffer: it walks the visible
 * blocks in order and packs the kept instances at the front, then sets `count`.
 * Each block lands in one contiguous range ([blockStart, blockStart +
 * blockDrawn)); hidden blocks cost nothing on the GPU. A move inside a block
 * that is drawn is written in place. Nothing in the per-frame path allocates.
 *
 * The same pools serve the hand-made adventure level and the generated
 * survival map: both cut the ground into 40 u blocks, and `addPlacements`
 * feeds the generator's typed arrays (kind, x, y, z, scale, yawC, yawS) in
 * their block-sorted order.
 */
import {
	Box3,
	BufferAttribute,
	BufferGeometry,
	type Color,
	DynamicDrawUsage,
	Group,
	InstancedBufferAttribute,
	InstancedMesh,
	type Material,
	Matrix3,
	Matrix4,
	type Mesh,
	type Object3D,
	Sphere,
	Vector3
} from 'three';
import type { BlockGrid, BlockSyncTarget } from './blocks.ts';
import { keepFraction, type LodProfile, lodRank } from './fog-lod.ts';
import { houseMaterial } from './materials.ts';

/** One drawable piece of a pool: a merged geometry and the material it is drawn with. */
export interface PoolPart {
	geometry: BufferGeometry;
	material: Material;
}

export interface InstancePoolOptions {
	/** For reports and the debug overlay; usually the GLTF node name. */
	name?: string;
	/** Fixed number of instances; add() returns -1 when the pool is full. */
	capacity: number;
	grid: BlockGrid;
	/**
	 * Per-instance colour, multiplied with the vertex colour and palette map.
	 * Created up front, so the shader program never changes later.
	 */
	colors?: boolean;
	/** Distance thinning of far blocks (fog-lod.ts lodProfiles); null draws all of a visible block. */
	lod?: LodProfile | null;
	/** Instances move often (animals, spinning pickups): hint DYNAMIC_DRAW. */
	dynamic?: boolean;
	castShadow?: boolean;
	receiveShadow?: boolean;
	/** Dispose the parts' geometries with the pool (true for pools built from a GLTF node). */
	ownsGeometry?: boolean;
}

/** A pending GPU upload range, reused so pushing it never allocates. */
interface Range {
	start: number;
	count: number;
}

const _vector = new Vector3();
const _box = new Box3();

/**
 * Writes the matrix of a yaw (cos c, sin s) about +y, a uniform scale k and a
 * translation, in three.js column-major order: local +x goes to (c, 0, −s) and
 * local +z to (s, 0, c), as in survival/types.ts.
 */
function writePlaced(
	out: Float32Array | number[],
	o: number,
	x: number,
	y: number,
	z: number,
	c: number,
	s: number,
	k: number
): void {
	out[o] = c * k;
	out[o + 1] = 0;
	out[o + 2] = -s * k;
	out[o + 3] = 0;
	out[o + 4] = 0;
	out[o + 5] = k;
	out[o + 6] = 0;
	out[o + 7] = 0;
	out[o + 8] = s * k;
	out[o + 9] = 0;
	out[o + 10] = c * k;
	out[o + 11] = 0;
	out[o + 12] = x;
	out[o + 13] = y;
	out[o + 14] = z;
	out[o + 15] = 1;
}

/** Queues [start, start + count) for upload, merging with a pending range of ours. */
function pushRange(attribute: BufferAttribute, range: Range, start: number, count: number): void {
	const ranges = attribute.updateRanges;
	if (ranges.length === 1 && ranges[0] === range) {
		const end = Math.max(range.start + range.count, start + count);
		range.start = Math.min(range.start, start);
		range.count = end - range.start;
	} else if (ranges.length === 0) {
		range.start = start;
		range.count = count;
		ranges.push(range);
	} else {
		// Someone else queued ranges: drop them all, which uploads the whole buffer.
		attribute.clearUpdateRanges();
	}
	attribute.needsUpdate = true;
}

export class InstancePool implements BlockSyncTarget {
	readonly name: string;
	readonly capacity: number;
	readonly grid: BlockGrid;
	/** Add this to the scene; it holds one InstancedMesh per part. */
	readonly object = new Group();
	readonly meshes: readonly InstancedMesh[];
	/** Triangles drawn per instance, summed over the parts. */
	readonly trianglesPerInstance: number;
	/** Local bounding sphere of one instance (all parts). */
	readonly localSphere = new Sphere();
	/** Distance thinning; changing it takes effect at the next sync. */
	lod: LodProfile | null;
	readonly #ownsGeometry: boolean;
	readonly #matrices: Float32Array;
	readonly #colors: Float32Array | null;
	readonly #gpuMatrices: Float32Array;
	readonly #gpuColors: Float32Array | null;
	readonly #instanceMatrix: InstancedBufferAttribute;
	readonly #instanceColor: InstancedBufferAttribute | null;
	/** Block of each slot, -1 when the slot is free. */
	readonly #block: Int16Array;
	readonly #prev: Int32Array;
	readonly #next: Int32Array;
	readonly #rank: Uint8Array;
	readonly #free: Int32Array;
	/** GPU index of each slot, -1 when not drawn; and the slot at each GPU index. */
	readonly #gpuOf: Int32Array;
	readonly #slotAt: Int32Array;
	/** Per block: list head and tail, member count, applied keep (0..256), drawn range. */
	readonly #head: Int32Array;
	readonly #tail: Int32Array;
	readonly #members: Int32Array;
	readonly #keep: Uint16Array;
	readonly #drawStart: Int32Array;
	readonly #drawCount: Int32Array;
	readonly #matrixRange: Range = { start: 0, count: 0 };
	readonly #colorRange: Range = { start: 0, count: 0 };
	#freeTop: number;
	#size = 0;
	#count = 0;
	#dirty = true;
	#lo = Number.POSITIVE_INFINITY;
	#hi = -1;

	constructor(parts: readonly PoolPart[], options: InstancePoolOptions) {
		if (parts.length === 0) throw new Error(`InstancePool ${options.name ?? ''}: no parts`);
		const capacity = Math.floor(options.capacity);
		if (!(capacity >= 1 && capacity <= 0x7fff_ffff))
			throw new RangeError('InstancePool capacity must be ≥ 1');
		this.name = options.name ?? parts[0].geometry.name;
		this.capacity = capacity;
		this.grid = options.grid;
		this.lod = options.lod ?? null;
		this.#ownsGeometry = options.ownsGeometry ?? false;
		this.object.name = this.name;
		this.object.matrixAutoUpdate = false;

		this.#matrices = new Float32Array(capacity * 16);
		this.#colors = options.colors ? new Float32Array(capacity * 3).fill(1) : null;
		this.#instanceMatrix = new InstancedBufferAttribute(new Float32Array(capacity * 16), 16);
		this.#instanceColor = options.colors
			? new InstancedBufferAttribute(new Float32Array(capacity * 3).fill(1), 3)
			: null;
		if (options.dynamic) {
			this.#instanceMatrix.setUsage(DynamicDrawUsage);
			this.#instanceColor?.setUsage(DynamicDrawUsage);
		}
		this.#gpuMatrices = this.#instanceMatrix.array as Float32Array;
		this.#gpuColors = this.#instanceColor ? (this.#instanceColor.array as Float32Array) : null;

		this.#block = new Int16Array(capacity).fill(-1);
		this.#prev = new Int32Array(capacity);
		this.#next = new Int32Array(capacity);
		this.#rank = new Uint8Array(capacity);
		this.#free = new Int32Array(capacity);
		this.#gpuOf = new Int32Array(capacity).fill(-1);
		this.#slotAt = new Int32Array(capacity);
		for (let slot = 0; slot < capacity; slot++) {
			this.#rank[slot] = lodRank(slot);
			// Popped from the top: ids come out 0, 1, 2…, which keeps block runs in rank order.
			this.#free[slot] = capacity - 1 - slot;
		}
		this.#freeTop = capacity;
		const blocks = this.grid.count;
		this.#head = new Int32Array(blocks).fill(-1);
		this.#tail = new Int32Array(blocks).fill(-1);
		this.#members = new Int32Array(blocks);
		this.#keep = new Uint16Array(blocks);
		this.#drawStart = new Int32Array(blocks);
		this.#drawCount = new Int32Array(blocks);

		let triangles = 0;
		let first = true;
		const meshes: InstancedMesh[] = [];
		for (const part of parts) {
			const geometry = part.geometry;
			if (!geometry.boundingSphere) geometry.computeBoundingSphere();
			const sphere = geometry.boundingSphere as Sphere;
			if (first) this.localSphere.copy(sphere);
			else this.localSphere.union(sphere);
			first = false;
			triangles += (geometry.index ? geometry.index.count : geometry.getAttribute('position').count) / 3;
			// Count 0 so the constructor allocates nothing big; the shared attributes replace it.
			const mesh = new InstancedMesh(geometry, part.material, 0);
			mesh.instanceMatrix = this.#instanceMatrix;
			mesh.instanceColor = this.#instanceColor;
			mesh.count = 0;
			mesh.visible = false;
			// Culling is per block here; three's own test would use a stale whole-pool sphere.
			mesh.frustumCulled = false;
			// Kept current from the drawn blocks, for sorting and raycasts, never recomputed by three.
			mesh.boundingSphere = new Sphere();
			mesh.boundingBox = new Box3();
			mesh.matrixAutoUpdate = false;
			mesh.castShadow = options.castShadow ?? false;
			mesh.receiveShadow = options.receiveShadow ?? false;
			mesh.name = `${this.name}#${meshes.length}`;
			meshes.push(mesh);
			this.object.add(mesh);
		}
		this.meshes = meshes;
		this.trianglesPerInstance = triangles;
		this.grid.register(this);
	}

	/** Live instances. */
	get size(): number {
		return this.#size;
	}

	/** Instances drawn after the last sync. */
	get count(): number {
		return this.#count;
	}

	/** Draw calls this pool issues per pass in which it is drawn (0 when nothing is visible). */
	get drawCalls(): number {
		return this.#count > 0 ? this.meshes.length : 0;
	}

	/** Draw calls in the shadow pass. */
	get shadowDrawCalls(): number {
		return this.#count > 0 && this.meshes[0].castShadow ? this.meshes.length : 0;
	}

	/** Triangles drawn per pass after the last sync. */
	get triangles(): number {
		return this.#count * this.trianglesPerInstance;
	}

	/** Adds an instance at a yaw (radians about +y) and uniform scale. Returns its id, or -1 when full. */
	add(x: number, y: number, z: number, yaw = 0, scale = 1): number {
		return this.addPlaced(x, y, z, Math.cos(yaw), Math.sin(yaw), scale);
	}

	/** Adds an instance from a heading (cos, sin of the yaw), as the survival generator stores it. */
	addPlaced(x: number, y: number, z: number, yawC: number, yawS: number, scale = 1): number {
		const slot = this.#alloc();
		if (slot < 0) return -1;
		writePlaced(this.#matrices, slot * 16, x, y, z, yawC, yawS, scale);
		this.#insert(slot);
		return slot;
	}

	/** Adds an instance with a full world matrix. */
	addMatrix(matrix: Matrix4): number {
		const slot = this.#alloc();
		if (slot < 0) return -1;
		this.#matrices.set(matrix.elements, slot * 16);
		this.#insert(slot);
		return slot;
	}

	has(id: number): boolean {
		return id >= 0 && id < this.capacity && this.#block[id] >= 0;
	}

	setTransform(id: number, x: number, y: number, z: number, yaw = 0, scale = 1): boolean {
		return this.setPlaced(id, x, y, z, Math.cos(yaw), Math.sin(yaw), scale);
	}

	setPlaced(id: number, x: number, y: number, z: number, yawC: number, yawS: number, scale = 1): boolean {
		if (!this.has(id)) return false;
		writePlaced(this.#matrices, id * 16, x, y, z, yawC, yawS, scale);
		this.#moved(id);
		return true;
	}

	setMatrix(id: number, matrix: Matrix4): boolean {
		if (!this.has(id)) return false;
		this.#matrices.set(matrix.elements, id * 16);
		this.#moved(id);
		return true;
	}

	/** Copies an instance's world matrix into `target`. */
	getMatrix(id: number, target: Matrix4): Matrix4 {
		return target.fromArray(this.#matrices, id * 16);
	}

	/** Per-instance colour in the working (linear) colour space. Needs `colors: true`. */
	setRGB(id: number, r: number, g: number, b: number): boolean {
		const colors = this.#colors;
		if (!colors || !this.has(id)) return false;
		const o = id * 3;
		colors[o] = r;
		colors[o + 1] = g;
		colors[o + 2] = b;
		const gpu = this.#gpuOf[id];
		if (gpu >= 0 && this.#gpuColors) {
			this.#gpuColors[gpu * 3] = r;
			this.#gpuColors[gpu * 3 + 1] = g;
			this.#gpuColors[gpu * 3 + 2] = b;
			this.#touch(gpu);
		}
		return true;
	}

	setColor(id: number, color: Color): boolean {
		return this.setRGB(id, color.r, color.g, color.b);
	}

	/** Removes an instance; its id may be handed out again by a later add. */
	remove(id: number): boolean {
		if (!this.has(id)) return false;
		this.#unlink(id);
		this.#block[id] = -1;
		this.#free[this.#freeTop++] = id;
		this.#size--;
		if (this.#gpuOf[id] >= 0) this.#dirty = true;
		this.#gpuOf[id] = -1;
		if (this.#colors) this.#colors.fill(1, id * 3, id * 3 + 3);
		return true;
	}

	/** Removes every instance. */
	clear(): void {
		this.#block.fill(-1);
		this.#gpuOf.fill(-1);
		this.#head.fill(-1);
		this.#tail.fill(-1);
		this.#members.fill(0);
		this.#colors?.fill(1);
		for (let slot = 0; slot < this.capacity; slot++) this.#free[slot] = this.capacity - 1 - slot;
		this.#freeTop = this.capacity;
		this.#size = 0;
		this.#dirty = true;
	}

	/** The instance id at a drawn index, e.g. a raycast hit's `instanceId`; -1 if out of range. */
	idAt(index: number): number {
		return index >= 0 && index < this.#count ? this.#slotAt[index] : -1;
	}

	/** First drawn index of a block's range after the last sync. */
	blockStart(block: number): number {
		return this.#drawStart[block];
	}

	/** Instances of a block drawn after the last sync. */
	blockDrawn(block: number): number {
		return this.#drawCount[block];
	}

	/** Instances of a block, drawn or not. */
	blockMembers(block: number): number {
		return this.#members[block];
	}

	/** Re-adds every live instance to the grid bounds (after `grid.clearBounds()`). */
	refreshBounds(): void {
		for (let slot = 0; slot < this.capacity; slot++) if (this.#block[slot] >= 0) this.#include(slot);
	}

	setShadows(cast: boolean, receive: boolean): void {
		for (const mesh of this.meshes) {
			mesh.castShadow = cast;
			mesh.receiveShadow = receive;
		}
	}

	/**
	 * Applies the grid's last cull to this pool. Called by `grid.update()`; call
	 * it yourself only after `grid.cull()`. Returns true when GPU data changed.
	 */
	sync(): boolean {
		const grid = this.grid;
		const lod = this.lod;
		let changed = this.#dirty;
		for (let b = 0; b < grid.count; b++) {
			let keep = 0;
			if (this.#members[b] > 0 && grid.visible[b] === 1)
				keep = lod === null ? 256 : Math.round(keepFraction(lod, grid.distance[b]) * 256);
			if (keep !== this.#keep[b]) {
				this.#keep[b] = keep;
				changed = true;
			}
		}
		if (changed) {
			this.#compact();
			return true;
		}
		if (this.#hi >= 0) {
			this.#upload(this.#lo, this.#hi + 1);
			return true;
		}
		return false;
	}

	/** Removes the pool from its grid and frees GPU attributes (and owned geometry). */
	dispose(): void {
		this.grid.unregister(this);
		for (const mesh of this.meshes) {
			mesh.dispose();
			if (this.#ownsGeometry) mesh.geometry.dispose();
		}
		this.object.clear();
	}

	#alloc(): number {
		if (this.#freeTop === 0) return -1;
		return this.#free[--this.#freeTop];
	}

	#insert(slot: number): void {
		const block = this.#include(slot);
		this.#block[slot] = block;
		this.#link(slot, block);
		this.#size++;
		// Only a slot that the current culling would draw needs a repack.
		if (this.#rank[slot] < this.#keep[block]) this.#dirty = true;
	}

	#moved(slot: number): void {
		const block = this.#include(slot);
		if (block !== this.#block[slot]) {
			const wasDrawn = this.#gpuOf[slot] >= 0;
			this.#unlink(slot);
			this.#block[slot] = block;
			this.#link(slot, block);
			if (wasDrawn || this.#rank[slot] < this.#keep[block]) this.#dirty = true;
			return;
		}
		const gpu = this.#gpuOf[slot];
		if (gpu < 0) return;
		const m = this.#matrices;
		const g = this.#gpuMatrices;
		const from = slot * 16;
		const to = gpu * 16;
		for (let i = 0; i < 16; i++) g[to + i] = m[from + i];
		this.#touch(gpu);
	}

	/** Grows the grid bounds by the slot's world sphere; returns the slot's block. */
	#include(slot: number): number {
		const m = this.#matrices;
		const o = slot * 16;
		const c = this.localSphere.center;
		const x = m[o] * c.x + m[o + 4] * c.y + m[o + 8] * c.z + m[o + 12];
		const y = m[o + 1] * c.x + m[o + 5] * c.y + m[o + 9] * c.z + m[o + 13];
		const z = m[o + 2] * c.x + m[o + 6] * c.y + m[o + 10] * c.z + m[o + 14];
		const sx = m[o] * m[o] + m[o + 1] * m[o + 1] + m[o + 2] * m[o + 2];
		const sy = m[o + 4] * m[o + 4] + m[o + 5] * m[o + 5] + m[o + 6] * m[o + 6];
		const sz = m[o + 8] * m[o + 8] + m[o + 9] * m[o + 9] + m[o + 10] * m[o + 10];
		const radius = this.localSphere.radius * Math.sqrt(Math.max(sx, sy, sz));
		// Blocks follow the instance origin (a tree's base), as in the survival generator.
		const block = this.grid.blockOf(m[o + 12], m[o + 14]);
		this.grid.include(block, x, y, z, radius);
		return block;
	}

	#link(slot: number, block: number): void {
		const tail = this.#tail[block];
		this.#prev[slot] = tail;
		this.#next[slot] = -1;
		if (tail >= 0) this.#next[tail] = slot;
		else this.#head[block] = slot;
		this.#tail[block] = slot;
		this.#members[block]++;
	}

	#unlink(slot: number): void {
		const block = this.#block[slot];
		const prev = this.#prev[slot];
		const next = this.#next[slot];
		if (prev >= 0) this.#next[prev] = next;
		else this.#head[block] = next;
		if (next >= 0) this.#prev[next] = prev;
		else this.#tail[block] = prev;
		this.#members[block]--;
	}

	#touch(gpu: number): void {
		if (gpu < this.#lo) this.#lo = gpu;
		if (gpu > this.#hi) this.#hi = gpu;
	}

	/** Packs the kept instances of visible blocks at the front of the GPU buffers, block by block. */
	#compact(): void {
		const m = this.#matrices;
		const g = this.#gpuMatrices;
		const colors = this.#colors;
		const gpuColors = this.#gpuColors;
		const next = this.#next;
		const rank = this.#rank;
		const box = _box.makeEmpty();
		this.#gpuOf.fill(-1);
		let n = 0;
		for (let b = 0; b < this.grid.count; b++) {
			this.#drawStart[b] = n;
			const keep = this.#keep[b];
			if (keep > 0) {
				for (let slot = this.#head[b]; slot !== -1; slot = next[slot]) {
					if (rank[slot] >= keep) continue;
					const from = slot * 16;
					const to = n * 16;
					for (let i = 0; i < 16; i++) g[to + i] = m[from + i];
					if (colors && gpuColors) {
						gpuColors[n * 3] = colors[slot * 3];
						gpuColors[n * 3 + 1] = colors[slot * 3 + 1];
						gpuColors[n * 3 + 2] = colors[slot * 3 + 2];
					}
					this.#slotAt[n] = slot;
					this.#gpuOf[slot] = n;
					n++;
				}
			}
			this.#drawCount[b] = n - this.#drawStart[b];
			if (this.#drawCount[b] > 0) box.union(this.grid.bounds[b]);
		}
		this.#count = n;
		this.#dirty = false;
		this.#lo = Number.POSITIVE_INFINITY;
		this.#hi = -1;
		for (const mesh of this.meshes) {
			mesh.count = n;
			mesh.visible = n > 0;
			if (n > 0) {
				(mesh.boundingBox as Box3).copy(box);
				box.getBoundingSphere(mesh.boundingSphere as Sphere);
			}
		}
		if (n > 0) this.#upload(0, n);
	}

	#upload(from: number, to: number): void {
		pushRange(this.#instanceMatrix, this.#matrixRange, from * 16, (to - from) * 16);
		if (this.#instanceColor) pushRange(this.#instanceColor, this.#colorRange, from * 3, (to - from) * 3);
		this.#lo = Number.POSITIVE_INFINITY;
		this.#hi = -1;
	}
}

// --- Geometry from GLTF nodes ---------------------------------------------------------

/** A mesh (or one material group of it) to merge, with its transform into the pool's frame. */
export interface GeometryPiece {
	geometry: BufferGeometry;
	matrix: Matrix4;
	/** Index range (or vertex range for non-indexed geometry); the whole geometry by default. */
	start?: number;
	count?: number;
}

/**
 * Merges pieces into one indexed geometry in the pool's frame, de-quantized to
 * float: position, normal (computed if any piece lacks them), uv (when all
 * have one) and colour (always; white where a piece has no bake, so every
 * house material uses vertex colours). Mirrored transforms keep their winding.
 */
export function mergePieces(pieces: readonly GeometryPiece[]): BufferGeometry {
	let hasNormal = true;
	let hasUv = true;
	const prepared: { piece: GeometryPiece; vertices: Int32Array; indices: Uint32Array }[] = [];
	let vertexTotal = 0;
	let indexTotal = 0;
	for (const piece of pieces) {
		const geometry = piece.geometry;
		const position = geometry.getAttribute('position');
		if (!position) continue;
		if (!geometry.getAttribute('normal')) hasNormal = false;
		if (!geometry.getAttribute('uv')) hasUv = false;
		const index = geometry.index;
		const available = index ? index.count : position.count;
		const start = Math.min(piece.start ?? 0, available);
		const count = Math.min(piece.count ?? available - start, available - start);
		const used = count - (count % 3);
		const indices = new Uint32Array(used);
		let vertices: Int32Array;
		if (index) {
			const remap = new Int32Array(position.count).fill(-1);
			const order: number[] = [];
			for (let i = 0; i < used; i++) {
				const v = index.getX(start + i);
				if (remap[v] < 0) {
					remap[v] = order.length;
					order.push(v);
				}
				indices[i] = remap[v];
			}
			vertices = Int32Array.from(order);
		} else {
			vertices = new Int32Array(used);
			for (let i = 0; i < used; i++) {
				vertices[i] = start + i;
				indices[i] = i;
			}
		}
		if (piece.matrix.determinant() < 0)
			for (let i = 0; i < used; i += 3) {
				const swap = indices[i + 1];
				indices[i + 1] = indices[i + 2];
				indices[i + 2] = swap;
			}
		prepared.push({ piece, vertices, indices });
		vertexTotal += vertices.length;
		indexTotal += used;
	}

	const positions = new Float32Array(vertexTotal * 3);
	const normals = hasNormal ? new Float32Array(vertexTotal * 3) : null;
	const uvs = hasUv ? new Float32Array(vertexTotal * 2) : null;
	const colors = new Float32Array(vertexTotal * 3);
	const index = vertexTotal > 65535 ? new Uint32Array(indexTotal) : new Uint16Array(indexTotal);
	const normalMatrix = new Matrix3();
	let vertexBase = 0;
	let indexBase = 0;
	for (const { piece, vertices, indices } of prepared) {
		const geometry = piece.geometry;
		const position = geometry.getAttribute('position');
		const normal = geometry.getAttribute('normal');
		const uv = geometry.getAttribute('uv');
		const color = geometry.getAttribute('color');
		normalMatrix.getNormalMatrix(piece.matrix);
		for (let i = 0; i < vertices.length; i++) {
			const v = vertices[i];
			const o = vertexBase + i;
			_vector.fromBufferAttribute(position, v).applyMatrix4(piece.matrix);
			positions[o * 3] = _vector.x;
			positions[o * 3 + 1] = _vector.y;
			positions[o * 3 + 2] = _vector.z;
			if (normals && normal) {
				_vector.fromBufferAttribute(normal, v).applyNormalMatrix(normalMatrix);
				normals[o * 3] = _vector.x;
				normals[o * 3 + 1] = _vector.y;
				normals[o * 3 + 2] = _vector.z;
			}
			if (uvs && uv) {
				uvs[o * 2] = uv.getX(v);
				uvs[o * 2 + 1] = uv.getY(v);
			}
			colors[o * 3] = color ? color.getX(v) : 1;
			colors[o * 3 + 1] = color ? color.getY(v) : 1;
			colors[o * 3 + 2] = color ? color.getZ(v) : 1;
		}
		for (let i = 0; i < indices.length; i++) index[indexBase + i] = vertexBase + indices[i];
		vertexBase += vertices.length;
		indexBase += indices.length;
	}

	const merged = new BufferGeometry();
	merged.setAttribute('position', new BufferAttribute(positions, 3));
	if (normals) merged.setAttribute('normal', new BufferAttribute(normals, 3));
	if (uvs) merged.setAttribute('uv', new BufferAttribute(uvs, 2));
	merged.setAttribute('color', new BufferAttribute(colors, 3));
	merged.setIndex(new BufferAttribute(index, 1));
	if (!normals) merged.computeVertexNormals();
	merged.computeBoundingBox();
	merged.computeBoundingSphere();
	return merged;
}

/** How a pool's material is chosen from the GLTF's: the house family (default), as is, or custom. */
export type MaterialMode = 'house' | 'source' | ((source: Material) => Material);

/**
 * The meshes under `node`, grouped by material and merged: one part per
 * distinct material. Transforms are relative to `root` (the GLTF scene), so
 * the node's own placement in the kit (e.g. kit-flora's y = −0.05 sink, the
 * bag's 0.71 scale) is kept; pass `root = node` to drop it.
 */
export function extractParts(
	root: Object3D,
	node: Object3D,
	materialFor: (source: Material) => Material
): PoolPart[] {
	root.updateMatrixWorld(true);
	const toRoot = new Matrix4().copy(root.matrixWorld).invert();
	const buckets = new Map<Material, GeometryPiece[]>();
	const bucket = (material: Material) => {
		let list = buckets.get(material);
		if (!list) {
			list = [];
			buckets.set(material, list);
		}
		return list;
	};
	node.traverse((object) => {
		const mesh = object as Mesh;
		if (!mesh.isMesh || (object as InstancedMesh).isInstancedMesh) return;
		const matrix = new Matrix4().multiplyMatrices(toRoot, mesh.matrixWorld);
		const geometry = mesh.geometry;
		if (Array.isArray(mesh.material)) {
			if (geometry.groups.length === 0) bucket(mesh.material[0]).push({ geometry, matrix });
			for (const group of geometry.groups) {
				const material = mesh.material[group.materialIndex ?? 0];
				if (material) bucket(material).push({ geometry, matrix, start: group.start, count: group.count });
			}
		} else bucket(mesh.material).push({ geometry, matrix });
	});
	const parts: PoolPart[] = [];
	for (const [source, pieces] of buckets) {
		const geometry = mergePieces(pieces);
		geometry.name = node.name;
		parts.push({ geometry, material: materialFor(source) });
	}
	return parts;
}

export interface ScenePoolOptions extends Omit<InstancePoolOptions, 'capacity' | 'name' | 'lod'> {
	/** One capacity for every node, or per node name (missing names use `default`, else 64). */
	capacity: number | Readonly<Record<string, number>>;
	/** One LOD profile for every node, or per node name (missing names: no LOD). */
	lod?: LodProfile | null | Readonly<Record<string, LodProfile | null>>;
	material?: MaterialMode;
}

export interface PoolReport {
	name: string;
	/** Materials, hence draw calls per pass when anything is visible. */
	materials: number;
	capacity: number;
	instances: number;
	drawn: number;
	drawCalls: number;
	shadowDrawCalls: number;
	triangles: number;
}

/** Pools built from one GLTF scene; they share converted materials. */
export class PoolSet {
	readonly object = new Group();
	readonly pools = new Map<string, InstancePool>();
	readonly #materials: Material[];

	constructor(pools: readonly InstancePool[], materials: readonly Material[]) {
		this.object.matrixAutoUpdate = false;
		for (const pool of pools) {
			this.pools.set(pool.name, pool);
			this.object.add(pool.object);
		}
		this.#materials = [...materials];
	}

	/** The pool of a node name; throws when the set has none. */
	get(name: string): InstancePool {
		const pool = this.pools.get(name);
		if (!pool) throw new Error(`PoolSet: no pool "${name}"`);
		return pool;
	}

	/** Main-pass draw calls of every pool after the last sync. */
	get drawCalls(): number {
		let calls = 0;
		for (const pool of this.pools.values()) calls += pool.drawCalls;
		return calls;
	}

	get shadowDrawCalls(): number {
		let calls = 0;
		for (const pool of this.pools.values()) calls += pool.shadowDrawCalls;
		return calls;
	}

	get triangles(): number {
		let triangles = 0;
		for (const pool of this.pools.values()) triangles += pool.triangles;
		return triangles;
	}

	/** Per-pool numbers for the debug overlay and the budget report (allocates; not per frame). */
	report(): PoolReport[] {
		return [...this.pools.values()].map((pool) => ({
			name: pool.name,
			materials: pool.meshes.length,
			capacity: pool.capacity,
			instances: pool.size,
			drawn: pool.count,
			drawCalls: pool.drawCalls,
			shadowDrawCalls: pool.shadowDrawCalls,
			triangles: pool.triangles
		}));
	}

	/** Disposes every pool, their merged geometries and the converted materials (not the GLTF textures). */
	dispose(): void {
		for (const pool of this.pools.values()) pool.dispose();
		for (const material of this.#materials) material.dispose();
		this.pools.clear();
		this.object.clear();
	}
}

function lodFor(lod: ScenePoolOptions['lod'], name: string): LodProfile | null {
	if (lod === undefined || lod === null) return null;
	if (isProfile(lod)) return lod;
	return lod[name] ?? null;
}

function isProfile(value: LodProfile | Readonly<Record<string, LodProfile | null>>): value is LodProfile {
	return Array.isArray(value);
}

/**
 * One pool per named node of a GLTF scene, e.g. kit-flora's tree_oak,
 * tree_palmTall, rock_largeA. Throws when a name is missing. Materials are
 * converted once per source material and shared by all pools of the set.
 */
export function createPoolsFromScene(
	root: Object3D,
	names: readonly string[],
	options: ScenePoolOptions
): PoolSet {
	const mode = options.material ?? 'house';
	const converted = new Map<Material, Material>();
	const owned: Material[] = [];
	const materialFor = (source: Material) => {
		if (mode === 'source') return source;
		let material = converted.get(source);
		if (!material) {
			material = mode === 'house' ? houseMaterial(source) : mode(source);
			converted.set(source, material);
			if (material !== source) owned.push(material);
		}
		return material;
	};
	const pools: InstancePool[] = [];
	try {
		for (const name of names) {
			const node = root.getObjectByName(name);
			if (!node) throw new Error(`createPoolsFromScene: node "${name}" not found`);
			const capacity =
				typeof options.capacity === 'number'
					? options.capacity
					: (options.capacity[name] ?? options.capacity.default ?? 64);
			const lod = lodFor(options.lod, name);
			pools.push(
				new InstancePool(extractParts(root, node, materialFor), {
					...options,
					name,
					capacity,
					lod,
					ownsGeometry: true
				})
			);
		}
	} catch (error) {
		for (const pool of pools) pool.dispose();
		for (const material of owned) material.dispose();
		throw error;
	}
	return new PoolSet(pools, owned);
}

/**
 * The structure-of-arrays shape of survival/types.ts Placements, without
 * importing it: instances sorted by block, then kind.
 */
export interface PlacementArrays<K extends string = string> {
	readonly kinds: readonly K[];
	readonly count: number;
	readonly kind: ArrayLike<number>;
	readonly x: ArrayLike<number>;
	readonly y: ArrayLike<number>;
	readonly z: ArrayLike<number>;
	readonly scale: ArrayLike<number>;
	readonly yawC: ArrayLike<number>;
	readonly yawS: ArrayLike<number>;
}

export interface AddPlacementsOptions<K extends string> {
	/** Per-instance colour for a kind (null for none); the pool needs `colors: true`. */
	colorFor?: (kind: K) => Color | null;
	/**
	 * Base scale of a kind, multiplied with the placement's own scale. Kenney kit
	 * trees are about 1.2 u tall and ART.md §3 wants 6–18 u, so trees need ~5–15.
	 */
	scaleFor?: (kind: K) => number;
}

/**
 * Adds generator placements to pools. `poolFor` maps a kind to its pool (or
 * undefined to skip it). Returns the id of each placement (-1 when skipped or
 * its pool was full), so the game can remove or move one later (a tree cut, a
 * seedling grown). Placements arrive sorted by block, so each block's run gets
 * consecutive ids and LOD thins it evenly.
 */
export function addPlacements<K extends string>(
	placements: PlacementArrays<K>,
	poolFor: (kind: K) => InstancePool | undefined,
	options: AddPlacementsOptions<K> = {}
): Int32Array {
	const { colorFor, scaleFor } = options;
	const ids = new Int32Array(placements.count).fill(-1);
	for (let i = 0; i < placements.count; i++) {
		const kind = placements.kinds[placements.kind[i]];
		const pool = poolFor(kind);
		if (!pool) continue;
		const id = pool.addPlaced(
			placements.x[i],
			placements.y[i],
			placements.z[i],
			placements.yawC[i],
			placements.yawS[i],
			placements.scale[i] * (scaleFor ? scaleFor(kind) : 1)
		);
		ids[i] = id;
		const color = id >= 0 && colorFor ? colorFor(kind) : null;
		if (color) pool.setColor(id, color);
	}
	return ids;
}

/** Writes an instance's world matrix from a position, yaw and scale (the matrix add() builds). */
export function placedMatrix(target: Matrix4, x: number, y: number, z: number, yaw = 0, scale = 1): Matrix4 {
	writePlaced(target.elements, 0, x, y, z, Math.cos(yaw), Math.sin(yaw), scale);
	return target;
}
