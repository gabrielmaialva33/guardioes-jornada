/**
 * Collision world: one static BVH over simplified proxy colliders (ground,
 * boxes, ramps, logs, platforms), built once when the level loads. Visual meshes
 * are not colliders: leaves and decoration stay out, and proxies share the
 * level's transforms rather than its rendered LOD. The camera casts against the
 * same BVH.
 *
 * Adapted from BvhPhysicsWorld in @pmndrs/viverse 0.2.29 (src/physics/world.ts,
 * npm tarball of 2026-10-16). Changes: static bodies only (no kinematic,
 * instanced or batched entries, no sensors), every source merged into a single
 * BVH, and raycasts report world-space distances. The bake still de-interleaves
 * and de-quantizes positions like the original.
 *
 * Copyright 2024 Bela Bohlender
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy of this software and
 * associated documentation files (the "Software"), to deal in the Software without restriction, including
 * without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the
 * following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all copies or substantial
 * portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT
 * LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO
 * EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER
 * IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR
 * THE USE OR OTHER DEALINGS IN THE SOFTWARE.
 */
import {
	type Box3,
	BufferAttribute,
	BufferGeometry,
	DoubleSide,
	type Matrix4,
	Mesh,
	type Object3D,
	type Ray,
	SkinnedMesh,
	Vector3
} from 'three';
import { type ExtendedTriangle, MeshBVH } from 'three-mesh-bvh';

export interface ColliderSource {
	geometry: BufferGeometry;
	/** Local-to-world transform; identity when omitted. */
	matrix?: Matrix4;
}

const point = new Vector3();

export class CollisionWorld {
	/** Merged world-space positions, handy for a ?debug wireframe. */
	readonly geometry: BufferGeometry;
	readonly bvh: MeshBVH;
	// One callbacks object for every query: shapecasts run several times per tick.
	#bounds: Box3 | null = null;
	#visit: ((triangle: ExtendedTriangle) => void) | null = null;
	readonly #callbacks = {
		intersectsBounds: (box: Box3) => this.#bounds?.intersectsBox(box) ?? false,
		intersectsTriangle: (triangle: ExtendedTriangle) => {
			this.#visit?.(triangle);
			return false;
		}
	};

	constructor(sources: Iterable<ColliderSource>) {
		this.geometry = bake(sources);
		this.bvh = new MeshBVH(this.geometry);
	}

	/**
	 * Bakes every mesh under `root` in world space. Skinned and morph-deformed
	 * meshes are skipped (their drawn shape differs from the rest geometry); so are
	 * hidden ones unless `include` says otherwise, so toggled decoration never
	 * becomes a collider.
	 */
	static fromObject(root: Object3D, include: (mesh: Mesh) => boolean = isVisible): CollisionWorld {
		root.updateWorldMatrix(true, true);
		const sources: ColliderSource[] = [];
		root.traverse((object) => {
			if (!(object instanceof Mesh) || object instanceof SkinnedMesh || !include(object)) return;
			const geometry = object.geometry as BufferGeometry;
			if (!geometry.getAttribute('position') || isMorphDeformed(object)) return;
			sources.push({ geometry, matrix: object.matrixWorld });
		});
		return new CollisionWorld(sources);
	}

	get triangles(): number {
		return (this.geometry.index?.count ?? 0) / 3;
	}

	/** Visits every triangle whose BVH node overlaps `bounds`. The triangle object is reused. */
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

	/** Distance to the first hit along `ray` (both faces count), or null within `far`. */
	raycast(ray: Ray, far: number): number | null {
		return this.bvh.raycastFirst(ray, DoubleSide, 0, far)?.distance ?? null;
	}

	dispose() {
		this.geometry.dispose();
	}
}

function isVisible(mesh: Mesh): boolean {
	for (let object: Object3D | null = mesh; object; object = object.parent) if (!object.visible) return false;
	return true;
}

function isMorphDeformed(mesh: Mesh): boolean {
	return (
		mesh.geometry.morphAttributes.position != null &&
		(mesh.morphTargetInfluences?.some((influence) => influence !== 0) ?? false)
	);
}

/**
 * Merges positions and indices into one indexed geometry in world space. A BVH
 * needs nothing else, and reading through getX/getY/getZ de-interleaves and
 * de-quantizes (meshopt) attributes.
 */
function bake(sources: Iterable<ColliderSource>): BufferGeometry {
	const list = [...sources];
	let vertices = 0;
	let indices = 0;
	for (const { geometry } of list) {
		const count = geometry.getAttribute('position').count;
		vertices += count;
		indices += geometry.index?.count ?? count;
	}
	const positions = new Float32Array(vertices * 3);
	const index = new Uint32Array(indices);
	let vertex = 0;
	let cursor = 0;
	for (const { geometry, matrix } of list) {
		const source = geometry.getAttribute('position');
		for (let i = 0; i < source.count; i++) {
			point.fromBufferAttribute(source, i);
			if (matrix) point.applyMatrix4(matrix);
			point.toArray(positions, (vertex + i) * 3);
		}
		if (geometry.index)
			for (let i = 0; i < geometry.index.count; i++) index[cursor++] = vertex + geometry.index.getX(i);
		else for (let i = 0; i < source.count; i++) index[cursor++] = vertex + i;
		vertex += source.count;
	}
	const geometry = new BufferGeometry();
	geometry.setAttribute('position', new BufferAttribute(positions, 3));
	geometry.setIndex(new BufferAttribute(index, 1));
	return geometry;
}
