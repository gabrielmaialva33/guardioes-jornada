/**
 * Trail ribbons of streamed chunks (P37): paths.ts pathRibbon itself, run once
 * per zone (in the streaming Worker, with the zone cut), then split by chunk.
 * pathRibbon conforms every triangle to one half of one 1 u terrain cell, so
 * each triangle lies in exactly one chunk and the pieces tile the zone's
 * ribbon with nothing added or lost: the soft edges and the leaf band
 * (`trail` = (side, 1)) and P32's trail material apply unchanged.
 *
 * The generated world has no trails yet (WORLD.md F2/F3).
 */
import { BufferAttribute, BufferGeometry, type Material, Mesh, Sphere, Vector3 } from 'three';
import { PARK_ZONES } from '../../level/zones/spec.ts';
import type { ZoneBuild } from '../../level/zones/zone.ts';
import { pathRibbon } from '../paths.ts';
import { squareWorld } from './square.ts';
import { CHUNK_SIZE, chunkId } from './types.ts';

/**
 * One chunk's share of a zone's trail ribbon, paths.ts's vertex format
 * (`position`, `color`, `trail`, `normal`; three vertices per triangle, drawn
 * unindexed), positions chunk-local (the mesh sits at the chunk's x0, z0).
 */
export interface RibbonPiece {
	position: Float32Array;
	color: Float32Array;
	trail: Float32Array;
	normal: Float32Array;
	/** Vertices (3 per triangle). */
	count: number;
	minY: number;
	maxY: number;
}

export function ribbonBytes(r: RibbonPiece | null): number {
	return r ? r.position.byteLength + r.color.byteLength + r.trail.byteLength + r.normal.byteLength : 0;
}

/** A zone's ribbon, split by chunk (chunkId → piece); chunks without trail are absent. */
export function zoneRibbons(build: ZoneBuild): Map<number, RibbonPiece> {
	const out = new Map<number, RibbonPiece>();
	const trails = build.level.trails;
	if (trails.length === 0) return out;
	const world = build.width === build.depth ? build.world : squareWorld(build);
	const g = pathRibbon(world, trails);
	const position = g.getAttribute('position');
	const color = g.getAttribute('color');
	const trail = g.getAttribute('trail');
	const normal = g.getAttribute('normal');
	const index = g.getIndex();
	const spec = PARK_ZONES[build.id];
	const ox = build.offsetX;
	const oz = build.offsetZ;
	// Pass 1: the chunk of every triangle (by its centroid, inside one cell), and the counts.
	const triangles = (index?.count ?? position.count) / 3;
	const owner = new Float64Array(triangles);
	const counts = new Map<number, number>();
	const vertexOf = (k: number) => (index ? index.getX(k) : k);
	for (let t = 0; t < triangles; t++) {
		let cx = 0;
		let cz = 0;
		for (let k = 0; k < 3; k++) {
			const v = vertexOf(t * 3 + k);
			cx += position.getX(v);
			cz += position.getZ(v);
		}
		const bx = Math.floor((cx / 3 + ox) / CHUNK_SIZE);
		const bz = Math.floor((cz / 3 + oz) / CHUNK_SIZE);
		if (bx < spec.cx0 || bx > spec.cx1 || bz < spec.cz0 || bz > spec.cz1) {
			owner[t] = -1;
			continue;
		}
		const key = chunkId(bx, bz);
		owner[t] = key;
		counts.set(key, (counts.get(key) ?? 0) + 3);
	}
	for (const [key, n] of counts)
		out.set(key, {
			position: new Float32Array(n * 3),
			color: new Float32Array(n * 3),
			trail: new Float32Array(n * 2),
			normal: new Float32Array(n * 3),
			count: 0,
			minY: Number.POSITIVE_INFINITY,
			maxY: Number.NEGATIVE_INFINITY
		});
	// Pass 2: copy, chunk-local.
	for (let t = 0; t < triangles; t++) {
		const key = owner[t];
		if (key < 0) continue;
		const piece = out.get(key) as RibbonPiece;
		const x0 = (Math.floor(key / 65536) - 32768) * CHUNK_SIZE;
		const z0 = ((key % 65536) - 32768) * CHUNK_SIZE;
		for (let k = 0; k < 3; k++) {
			const v = vertexOf(t * 3 + k);
			const m = piece.count++;
			const y = position.getY(v);
			piece.position[m * 3] = position.getX(v) + ox - x0;
			piece.position[m * 3 + 1] = y;
			piece.position[m * 3 + 2] = position.getZ(v) + oz - z0;
			piece.color[m * 3] = color.getX(v);
			piece.color[m * 3 + 1] = color.getY(v);
			piece.color[m * 3 + 2] = color.getZ(v);
			piece.trail[m * 2] = trail.getX(v);
			piece.trail[m * 2 + 1] = trail.getY(v);
			piece.normal[m * 3] = normal.getX(v);
			piece.normal[m * 3 + 1] = normal.getY(v);
			piece.normal[m * 3 + 2] = normal.getZ(v);
			if (y < piece.minY) piece.minY = y;
			if (y > piece.maxY) piece.maxY = y;
		}
	}
	g.dispose();
	return out;
}

const scratch = new Vector3();
const NAMES = ['position', 'color', 'trail', 'normal'] as const;
const SIZES = [3, 3, 2, 3] as const;

/**
 * Ribbon meshes for the render ring. Pieces differ in size, so each mesh's
 * buffers grow to the largest piece they have held (the ring's slots bound
 * how many exist); smaller pieces set the draw range.
 */
export class RibbonMeshPool {
	readonly material: Material;
	readonly #free: Mesh[] = [];
	readonly #all: Mesh[] = [];

	constructor(material: Material) {
		this.material = material;
	}

	get size(): number {
		return this.#all.length;
	}

	get inUse(): number {
		return this.#all.length - this.#free.length;
	}

	acquire(piece: RibbonPiece, x0: number, z0: number): Mesh {
		const mesh = this.#free.pop() ?? this.#make();
		const capacity = (mesh.geometry.getAttribute('position') as BufferAttribute).count;
		if (capacity < piece.count) {
			// Grow by powers of two, a new geometry so the old GPU buffers go with dispose().
			let size = Math.max(capacity, 1024);
			while (size < piece.count) size *= 2;
			mesh.geometry.dispose();
			mesh.geometry = this.#geometry(size);
		}
		const g = mesh.geometry;
		for (let k = 0; k < NAMES.length; k++) {
			const a = g.getAttribute(NAMES[k]) as BufferAttribute;
			(a.array as Float32Array).set(piece[NAMES[k]]);
			a.clearUpdateRanges();
			a.addUpdateRange(0, piece.count * SIZES[k]);
			a.needsUpdate = true;
		}
		g.setDrawRange(0, piece.count);
		const half = CHUNK_SIZE / 2;
		const dy = (piece.maxY - piece.minY) / 2;
		const sphere = g.boundingSphere as Sphere;
		sphere.center.set(half, (piece.minY + piece.maxY) / 2, half);
		sphere.radius = Math.sqrt(half * half * 2 + dy * dy);
		const box = g.boundingBox;
		if (box) {
			box.min.set(0, piece.minY, 0);
			box.max.copy(box.min).add(scratch.set(CHUNK_SIZE, piece.maxY - piece.minY, CHUNK_SIZE));
		}
		mesh.position.set(x0, 0, z0);
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

	#geometry(vertices: number): BufferGeometry {
		const g = new BufferGeometry();
		for (let k = 0; k < NAMES.length; k++)
			g.setAttribute(NAMES[k], new BufferAttribute(new Float32Array(vertices * SIZES[k]), SIZES[k]));
		g.boundingSphere = new Sphere();
		return g;
	}

	#make(): Mesh {
		const mesh = new Mesh(this.#geometry(0), this.material);
		mesh.name = 'stream-trails';
		mesh.matrixAutoUpdate = false;
		this.#all.push(mesh);
		return mesh;
	}
}
