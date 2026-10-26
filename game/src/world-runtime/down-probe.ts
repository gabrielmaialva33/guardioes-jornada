import { Box3, Ray, Vector3 } from 'three';
import type { ExtendedTriangle } from 'three-mesh-bvh';
import { type CollisionQuery, CollisionWorld } from '../engine/world.ts';

/** Snapshot the public BVH traversal once. Queries avoid MeshBVH's allocating shapecast/raycast wrappers. */
export class DownProbe {
	readonly #bounds: Float32Array;
	readonly #next: Int32Array;
	readonly #offsets: Int32Array;
	readonly #counts: Int32Array;
	readonly #ray = new Ray(new Vector3(), new Vector3(0, -1, 0));
	readonly #a = new Vector3();
	readonly #b = new Vector3();
	readonly #c = new Vector3();
	readonly #hit = new Vector3();
	readonly #queryBounds = new Box3();
	readonly #staticWorld: CollisionWorld | null;
	readonly #visit = (triangle: ExtendedTriangle) => {
		if (
			this.#ray.intersectTriangle(triangle.a, triangle.b, triangle.c, false, this.#hit) &&
			this.#hit.y >= this.y - this.depth &&
			this.#hit.y > this.height
		)
			this.height = this.#hit.y;
	};
	x = 0;
	y = 0;
	z = 0;
	depth = 2;
	height = -Infinity;
	constructor(readonly world: CollisionQuery) {
		// A compound/streamed world can change without replacing this probe. Only a plain static BVH is snapshotted.
		this.#staticWorld =
			world instanceof CollisionWorld && Object.getPrototypeOf(world) === CollisionWorld.prototype
				? world
				: null;
		const bounds: number[] = [],
			next: number[] = [],
			offsets: number[] = [],
			counts: number[] = [],
			parents: number[] = [];
		// CollisionWorld bakes one indexed geometry without groups, hence one BVH root.
		this.#staticWorld?.bvh.traverse((depth, leaf, box, offset, count) => {
			const node = next.length;
			while (parents.length > depth) {
				const parent = parents.pop();
				if (parent !== undefined) next[parent] = node;
			}
			for (let i = 0; i < 6; i++) bounds.push(box[i]);
			next.push(0);
			offsets.push(leaf ? offset : 0);
			counts.push(leaf ? count : 0);
			parents.push(node);
		});
		for (const node of parents) next[node] = next.length;
		this.#bounds = Float32Array.from(bounds);
		this.#next = Int32Array.from(next);
		this.#offsets = Int32Array.from(offsets);
		this.#counts = Int32Array.from(counts);
	}
	sample() {
		const { x, y, z, depth } = this;
		this.height = -Infinity;
		this.#ray.origin.set(x, y, z);
		if (!this.#staticWorld) {
			this.#queryBounds.min.set(x - 0.00001, y - depth, z - 0.00001);
			this.#queryBounds.max.set(x + 0.00001, y, z + 0.00001);
			this.world.shapecast(this.#queryBounds, this.#visit);
			return;
		}
		const bounds = this.#bounds,
			geometry = this.#staticWorld.geometry,
			index = geometry.index,
			p = geometry.getAttribute('position');
		if (!index) return;
		for (let node = 0; node < this.#next.length; ) {
			const i = node * 6;
			if (
				x < bounds[i] ||
				x > bounds[i + 3] ||
				z < bounds[i + 2] ||
				z > bounds[i + 5] ||
				y < bounds[i + 1] ||
				y - depth > bounds[i + 4]
			) {
				node = this.#next[node];
				continue;
			}
			const end = (this.#offsets[node] + this.#counts[node]) * 3;
			for (let t = this.#offsets[node] * 3; t < end; t += 3) {
				this.#a.fromBufferAttribute(p, index.getX(t));
				this.#b.fromBufferAttribute(p, index.getX(t + 1));
				this.#c.fromBufferAttribute(p, index.getX(t + 2));
				if (
					this.#ray.intersectTriangle(this.#a, this.#b, this.#c, false, this.#hit) &&
					this.#hit.y > this.height &&
					this.#hit.y >= y - depth
				)
					this.height = this.#hit.y;
			}
			node++;
		}
	}
}
