/**
 * Collision per chunk: world-runtime/collision.ts buildMapCollision's block
 * builder, one chunk at a time (ground refined to the 1 u heights, trunk and
 * boulder cylinders of 8 sides, log boxes, deckGeometry decks, optional
 * PropProxy boxes) without the map's edge rails, baked into one indexed
 * geometry and one MeshBVH in world coordinates. The heavy half,
 * `collisionData`, runs in the streaming Worker and transfers the BVH as
 * MeshBVH.serialize data; `ChunkCollider` deserializes it in a few
 * microseconds on the main thread. `CompoundCollision` answers the engine's
 * two queries (CollisionWorld's shapecast and raycast) over the ring.
 *
 * World coordinates keep about 1 mm of float32 precision within ±10 km.
 */
import {
	Box3,
	BoxGeometry,
	BufferAttribute,
	BufferGeometry,
	CylinderGeometry,
	DoubleSide,
	type Ray
} from 'three';
import { type ExtendedTriangle, MeshBVH, type SerializedBVH } from 'three-mesh-bvh';
import { deckGeometry, type PropProxy, propGeometry } from '../collision.ts';
import { CHUNK_SIDE, CHUNK_SIZE } from './types.ts';

/** The two queries the character and the camera make (engine/world.ts CollisionWorld's). */
export interface CollisionQuery {
	/** Visits every triangle whose BVH node overlaps `bounds`. The triangle object is reused. */
	shapecast(bounds: Box3, visit: (triangle: ExtendedTriangle) => void): void;
	/** Distance to the first hit along `ray` (both faces count), or null within `far`. */
	raycast(ray: Ray, far: number): number | null;
}

export interface CollisionInput {
	x0: number;
	z0: number;
	/** 41² ground heights at 1 u (the chunk's grid). */
	heights: Float32Array;
	/** survival CollisionBlock arrays, world coordinates. */
	cylinders: Float32Array;
	boxes: Float32Array;
	decks: Float32Array;
	/** Extra boxes (prefab props, rails), world coordinates. */
	props?: readonly PropProxy[];
}

/** A baked chunk collider, ready to transfer: positions, the BVH's index and its serialized roots. */
export interface CollisionData {
	position: Float32Array;
	index: Uint32Array;
	roots: ArrayBuffer[];
	/** min x, y, z, max x, y, z. */
	bounds: Float32Array;
}

export function collisionTransferables(data: CollisionData): ArrayBuffer[] {
	return [data.position.buffer as ArrayBuffer, data.index.buffer as ArrayBuffer, ...data.roots];
}

/** Builds the geometry and its BVH (the Worker's part). */
export function collisionData(input: CollisionInput): CollisionData {
	const parts: BufferGeometry[] = [];
	const { cylinders, boxes, decks } = input;
	for (let i = 0; i < cylinders.length; i += 5) {
		const x = cylinders[i],
			y = cylinders[i + 1],
			z = cylinders[i + 2],
			r = cylinders[i + 3],
			h = cylinders[i + 4];
		parts.push(new CylinderGeometry(r, r, h, 8).translate(x, y + h / 2, z));
	}
	for (let i = 0; i < boxes.length; i += 8) {
		const x = boxes[i],
			y = boxes[i + 1],
			z = boxes[i + 2],
			hx = boxes[i + 3],
			hy = boxes[i + 4],
			hz = boxes[i + 5],
			c = boxes[i + 6],
			s = boxes[i + 7];
		parts.push(new BoxGeometry(hx * 2, hy * 2, hz * 2).rotateY(Math.atan2(s, c)).translate(x, y, z));
	}
	for (let i = 0; i < decks.length; i += 8) parts.push(deckGeometry(decks.subarray(i, i + 8)));
	for (const p of input.props ?? []) parts.push(propGeometry(p));

	const groundVertices = CHUNK_SIDE * CHUNK_SIDE;
	const groundIndices = CHUNK_SIZE * CHUNK_SIZE * 6;
	let vertices = groundVertices;
	let indices = groundIndices;
	for (const g of parts) {
		vertices += g.getAttribute('position').count;
		indices += g.index?.count ?? g.getAttribute('position').count;
	}
	const position = new Float32Array(vertices * 3);
	const index = new Uint32Array(indices);
	for (let j = 0; j < CHUNK_SIDE; j++)
		for (let i = 0; i < CHUNK_SIDE; i++) {
			const o = (j * CHUNK_SIDE + i) * 3;
			position[o] = input.x0 + i;
			position[o + 1] = input.heights[j * CHUNK_SIDE + i];
			position[o + 2] = input.z0 + j;
		}
	let cursor = 0;
	for (let z = 0; z < CHUNK_SIZE; z++)
		for (let x = 0; x < CHUNK_SIZE; x++) {
			const i = z * CHUNK_SIDE + x;
			index[cursor++] = i;
			index[cursor++] = i + CHUNK_SIDE;
			index[cursor++] = i + 1;
			index[cursor++] = i + 1;
			index[cursor++] = i + CHUNK_SIDE;
			index[cursor++] = i + CHUNK_SIDE + 1;
		}
	let vertex = groundVertices;
	for (const g of parts) {
		const source = g.getAttribute('position');
		for (let i = 0; i < source.count; i++) {
			const o = (vertex + i) * 3;
			position[o] = source.getX(i);
			position[o + 1] = source.getY(i);
			position[o + 2] = source.getZ(i);
		}
		if (g.index) for (let i = 0; i < g.index.count; i++) index[cursor++] = vertex + g.index.getX(i);
		else for (let i = 0; i < source.count; i++) index[cursor++] = vertex + i;
		vertex += source.count;
		g.dispose();
	}
	const geometry = new BufferGeometry();
	geometry.setAttribute('position', new BufferAttribute(position, 3));
	geometry.setIndex(new BufferAttribute(index, 1));
	const bvh = new MeshBVH(geometry);
	const box = new Box3();
	bvh.getBoundingBox(box);
	const data = MeshBVH.serialize(bvh, { cloneBuffers: false });
	return {
		position,
		index: data.index as Uint32Array,
		roots: data.roots as ArrayBuffer[],
		bounds: Float32Array.of(box.min.x, box.min.y, box.min.z, box.max.x, box.max.y, box.max.z)
	};
}

/** One chunk's collider on the main thread. */
export class ChunkCollider implements CollisionQuery {
	readonly geometry: BufferGeometry;
	readonly bvh: MeshBVH;
	/** World bounds of every triangle. */
	readonly box: Box3 = new Box3();
	#bounds: Box3 | null = null;
	#visit: ((triangle: ExtendedTriangle) => void) | null = null;
	readonly #callbacks = {
		intersectsBounds: (box: Box3) => this.#bounds?.intersectsBox(box) ?? false,
		intersectsTriangle: (triangle: ExtendedTriangle) => {
			this.#visit?.(triangle);
			return false;
		}
	};

	constructor(data: CollisionData) {
		this.geometry = new BufferGeometry();
		this.geometry.setAttribute('position', new BufferAttribute(data.position, 3));
		// `version` is in the serialized format (MeshBVH.serialize writes 1) but not in its typings.
		const serialized = { version: 1, roots: data.roots, index: data.index, indirectBuffer: null };
		this.bvh = MeshBVH.deserialize(serialized as SerializedBVH, this.geometry, { setIndex: true });
		const b = data.bounds;
		this.box.min.set(b[0], b[1], b[2]);
		this.box.max.set(b[3], b[4], b[5]);
	}

	/** Builds in place (the inline path, or an emergency on the main thread). */
	static build(input: CollisionInput): ChunkCollider {
		return new ChunkCollider(collisionData(input));
	}

	get triangles(): number {
		return (this.geometry.index?.count ?? 0) / 3;
	}

	shapecast(bounds: Box3, visit: (triangle: ExtendedTriangle) => void) {
		this.#bounds = bounds;
		this.#visit = visit;
		try {
			this.bvh.shapecast(this.#callbacks);
		} finally {
			this.#bounds = null;
			this.#visit = null;
		}
	}

	raycast(ray: Ray, far: number): number | null {
		return this.bvh.raycastFirst(ray, DoubleSide, 0, far)?.distance ?? null;
	}

	dispose() {
		this.geometry.dispose();
	}
}

/**
 * The collision ring as one query object: each call goes to the chunks whose
 * bounds it touches. Adding and removing happen on chunk crossings; queries
 * allocate nothing beyond what MeshBVH itself does.
 */
export class CompoundCollision implements CollisionQuery {
	readonly #items: ChunkCollider[] = [];

	get size(): number {
		return this.#items.length;
	}

	get triangles(): number {
		let n = 0;
		for (const c of this.#items) n += c.triangles;
		return n;
	}

	has(collider: ChunkCollider): boolean {
		return this.#items.includes(collider);
	}

	add(collider: ChunkCollider) {
		if (!this.#items.includes(collider)) this.#items.push(collider);
	}

	remove(collider: ChunkCollider): boolean {
		const k = this.#items.indexOf(collider);
		if (k < 0) return false;
		this.#items.splice(k, 1);
		return true;
	}

	shapecast(bounds: Box3, visit: (triangle: ExtendedTriangle) => void) {
		const items = this.#items;
		for (let k = 0; k < items.length; k++)
			if (items[k].box.intersectsBox(bounds)) items[k].shapecast(bounds, visit);
	}

	raycast(ray: Ray, far: number): number | null {
		let best: number | null = null;
		const items = this.#items;
		for (let k = 0; k < items.length; k++) {
			const c = items[k];
			if (!ray.intersectsBox(c.box)) continue;
			const d = c.raycast(ray, best ?? far);
			if (d !== null && (best === null || d < best)) best = d;
		}
		return best;
	}
}
