/** WebGL2 single-draw packing, independent of WEBGL_multi_draw. Source meshes stay owned by their pools. */
import {
	BufferAttribute,
	BufferGeometry,
	DynamicDrawUsage,
	Frustum,
	type Material,
	Matrix4,
	type Mesh,
	type PerspectiveCamera,
	Sphere,
	Mesh as ThreeMesh
} from 'three';
import { RibbonMeshPool, type RibbonPiece } from './trails.ts';
import { type WaterAttributes, WaterMeshPool } from './water.ts';

export class SurfaceBatch {
	readonly object: ThreeMesh;
	readonly #meshes: (Mesh | null)[] = [];
	readonly #slots = new Map<Mesh, number>();
	readonly #visible: number[] = [];
	readonly #frustum = new Frustum();
	readonly #matrix = new Matrix4();
	readonly #sphere = new Sphere();
	readonly #attributes: Record<string, BufferAttribute> = {};
	#dirty = true;
	#disposed = false;
	overflows = 0;
	visibleChunks = 0;
	constructor(
		material: Material,
		readonly surface: 'water' | 'trail',
		readonly capacity = 120_000
	) {
		const geometry = new BufferGeometry();
		for (const name of ['position', 'color', 'normal', surface]) {
			const size = name === surface ? 2 : 3;
			const a = new BufferAttribute(new Float32Array(capacity * size), size).setUsage(DynamicDrawUsage);
			geometry.setAttribute(name, a);
			this.#attributes[name] = a;
		}
		geometry.setDrawRange(0, 0);
		this.object = new ThreeMesh(geometry, material);
		this.object.name = `stream-${surface}-batch`;
		this.object.frustumCulled = false;
		this.object.userData.noShadow = true;
	}
	add(mesh: Mesh) {
		if (this.#slots.has(mesh)) return;
		let slot = this.#meshes.indexOf(null);
		if (slot < 0) slot = this.#meshes.length;
		this.#meshes[slot] = mesh;
		this.#slots.set(mesh, slot);
		this.#visible[slot] = 0;
		mesh.visible = false;
		this.#dirty = true;
	}
	remove(mesh: Mesh) {
		const slot = this.#slots.get(mesh);
		if (slot === undefined) return;
		this.#slots.delete(mesh);
		this.#meshes[slot] = null;
		this.#visible[slot] = 0;
		this.#dirty = true;
	}
	sync(camera: PerspectiveCamera) {
		if (this.#disposed) return;
		this.#matrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
		this.#frustum.setFromProjectionMatrix(this.#matrix);
		let total = 0,
			visible = 0;
		for (let slot = 0; slot < this.#meshes.length; slot++) {
			const mesh = this.#meshes[slot];
			if (!mesh) continue;
			const sphere = mesh.geometry.boundingSphere;
			if (!sphere) mesh.geometry.computeBoundingSphere();
			const bounds = mesh.geometry.boundingSphere;
			const shown =
				!!bounds && this.#frustum.intersectsSphere(this.#sphere.copy(bounds).translate(mesh.position));
			if (+shown !== this.#visible[slot]) {
				this.#dirty = true;
				this.#visible[slot] = +shown;
			}
			if (shown) {
				visible++;
				total += Math.min(
					mesh.geometry.drawRange.count,
					mesh.geometry.index?.count ?? mesh.geometry.getAttribute('position').count
				);
			}
		}
		this.visibleChunks = visible;
		if (total > this.capacity) {
			this.overflows++;
			this.object.visible = false;
			for (let i = 0; i < this.#meshes.length; i++) {
				const mesh = this.#meshes[i];
				if (mesh) mesh.visible = this.#visible[i] === 1;
			}
			this.#dirty = true;
			return;
		}
		this.object.visible = total > 0;
		if (!this.#dirty) return;
		let cursor = 0;
		for (let slot = 0; slot < this.#meshes.length; slot++) {
			const mesh = this.#meshes[slot];
			if (!mesh) continue;
			mesh.visible = false;
			if (!this.#visible[slot]) continue;
			const g = mesh.geometry,
				index = g.index,
				count = Math.min(g.drawRange.count, index?.count ?? g.getAttribute('position').count);
			for (const name of ['position', 'color', 'normal', this.surface]) {
				const source = g.getAttribute(name),
					dest = this.#attributes[name],
					size = source.itemSize,
					a = source.array,
					out = dest.array;
				let o = cursor * size;
				for (let n = 0; n < count; n++) {
					const v = (index ? index.getX(n) : n) * size;
					out[o++] = a[v] + (name === 'position' ? mesh.position.x : 0);
					out[o++] = a[v + 1] + (name === 'position' ? mesh.position.y : 0);
					if (size === 3) out[o++] = a[v + 2] + (name === 'position' ? mesh.position.z : 0);
				}
				dest.clearUpdateRanges();
				dest.addUpdateRange(0, total * size);
				dest.needsUpdate = true;
			}
			cursor += count;
		}
		this.object.geometry.setDrawRange(0, cursor);
		this.#dirty = false;
	}
	dispose() {
		if (this.#disposed) return;
		this.#disposed = true;
		this.#meshes.length = 0;
		this.#slots.clear();
		this.object.removeFromParent();
		this.object.geometry.dispose();
	}
}

export class BatchedWaterPool extends WaterMeshPool {
	readonly batch: SurfaceBatch;
	constructor(material: Material) {
		super(material);
		this.batch = new SurfaceBatch(material, 'water');
	}
	override acquire(water: WaterAttributes, x: number, z: number) {
		const mesh = super.acquire(water, x, z);
		this.batch.add(mesh);
		return mesh;
	}
	override release(mesh: Mesh) {
		this.batch.remove(mesh);
		super.release(mesh);
	}
	override dispose() {
		this.batch.dispose();
		super.dispose();
	}
}
export class BatchedRibbonPool extends RibbonMeshPool {
	readonly batch: SurfaceBatch;
	constructor(material: Material) {
		super(material);
		this.batch = new SurfaceBatch(material, 'trail', 180_000);
	}
	override acquire(piece: RibbonPiece, x: number, z: number) {
		const mesh = super.acquire(piece, x, z);
		this.batch.add(mesh);
		return mesh;
	}
	override release(mesh: Mesh) {
		this.batch.remove(mesh);
		super.release(mesh);
	}
	override dispose() {
		this.batch.dispose();
		super.dispose();
	}
}
