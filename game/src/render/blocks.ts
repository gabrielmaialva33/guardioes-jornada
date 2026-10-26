/**
 * Block culling for instance pools. The ground plane is cut into square blocks
 * of 40 u (the survival map's BLOCK_SIZE, 4 × 4 over 160 × 160; the adventure
 * level uses the same size). Once per frame the camera frustum is tested
 * against each block's content bounds, and every pool registered on the grid
 * then redraws only the instances of visible blocks (see instancing.ts).
 * Sixteen box tests replace hundreds of per-instance tests, and a pool stays
 * one draw call however many blocks are visible.
 */
import { Box3, type Camera, Frustum, Matrix4 } from 'three';

/** Block side in world units, shared with survival/types.ts BLOCK_SIZE. */
export const BLOCK_SIZE = 40;

/** What a pool registered on the grid implements. */
export interface BlockSyncTarget {
	/** Applies the grid's current visibility; returns true when GPU buffers changed. */
	sync(): boolean;
}

export interface BlockGridOptions {
	/** Minimum corner of the gridded area on the ground plane. */
	minX: number;
	minZ: number;
	/** Blocks along x and along z. */
	columns: number;
	rows: number;
	blockSize?: number;
}

export class BlockGrid {
	readonly minX: number;
	readonly minZ: number;
	readonly columns: number;
	readonly rows: number;
	readonly blockSize: number;
	/** Last cull eye, for mutually exclusive per-instance geometry LOD bands. */
	cameraX = 0;
	cameraZ = 0;
	/** columns × rows; block index = row * columns + column, as in the survival generator. */
	readonly count: number;
	/**
	 * Content bounds per block: the union of the bounding spheres placed in it,
	 * empty until something is. Bounds only grow (a removed tree leaves its
	 * block slightly too big, which is conservative).
	 */
	readonly bounds: readonly Box3[];
	/** 1 when the block's bounds touched the camera frustum at the last cull(). */
	readonly visible: Uint8Array;
	/**
	 * Ground-plane distance from the camera to the nearest point of the block's
	 * bounds at the last cull(): 0 inside, Infinity for an empty block. Pools
	 * feed it to their LOD profile.
	 */
	readonly distance: Float32Array;
	/** Blocks visible at the last cull(). */
	visibleCount = 0;
	readonly #targets: BlockSyncTarget[] = [];
	readonly #frustum = new Frustum();
	readonly #matrix = new Matrix4();

	constructor(options: BlockGridOptions) {
		if (!(options.columns >= 1 && options.rows >= 1))
			throw new RangeError('BlockGrid needs at least one block');
		this.minX = options.minX;
		this.minZ = options.minZ;
		this.columns = Math.floor(options.columns);
		this.rows = Math.floor(options.rows);
		this.blockSize = options.blockSize ?? BLOCK_SIZE;
		this.count = this.columns * this.rows;
		this.bounds = Array.from({ length: this.count }, () => new Box3());
		this.visible = new Uint8Array(this.count);
		this.distance = new Float32Array(this.count).fill(Number.POSITIVE_INFINITY);
	}

	/** The smallest grid of `blockSize` blocks that covers a rectangle of the ground plane. */
	static covering(minX: number, minZ: number, maxX: number, maxZ: number, blockSize = BLOCK_SIZE): BlockGrid {
		return new BlockGrid({
			minX,
			minZ,
			columns: Math.max(1, Math.ceil((maxX - minX) / blockSize)),
			rows: Math.max(1, Math.ceil((maxZ - minZ) / blockSize)),
			blockSize
		});
	}

	/** Block index under a ground point; points outside the grid go to the nearest edge block. */
	blockOf(x: number, z: number): number {
		const column = Math.min(this.columns - 1, Math.max(0, Math.floor((x - this.minX) / this.blockSize)));
		const row = Math.min(this.rows - 1, Math.max(0, Math.floor((z - this.minZ) / this.blockSize)));
		return row * this.columns + column;
	}

	/** Grows a block's bounds to hold a sphere. */
	include(block: number, x: number, y: number, z: number, radius: number): void {
		const box = this.bounds[block];
		if (box.isEmpty()) {
			box.min.set(x - radius, y - radius, z - radius);
			box.max.set(x + radius, y + radius, z + radius);
			return;
		}
		if (x - radius < box.min.x) box.min.x = x - radius;
		if (y - radius < box.min.y) box.min.y = y - radius;
		if (z - radius < box.min.z) box.min.z = z - radius;
		if (x + radius > box.max.x) box.max.x = x + radius;
		if (y + radius > box.max.y) box.max.y = y + radius;
		if (z + radius > box.max.z) box.max.z = z + radius;
	}

	/** Empties every block's bounds; pools must re-add or call `refreshBounds()`. */
	clearBounds(): void {
		for (const box of this.bounds) box.makeEmpty();
	}

	/**
	 * Tests every block against the camera and measures its distance. Updates
	 * the camera's world matrix first, so call it after the camera has moved
	 * for this frame. Returns the number of visible blocks. No allocation.
	 */
	cull(camera: Camera): number {
		camera.updateMatrixWorld();
		this.#matrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
		this.#frustum.setFromProjectionMatrix(this.#matrix);
		const e = camera.matrixWorld.elements;
		const px = e[12];
		const pz = e[14];
		this.cameraX = px;
		this.cameraZ = pz;
		let visible = 0;
		for (let b = 0; b < this.count; b++) {
			const box = this.bounds[b];
			if (box.isEmpty()) {
				this.visible[b] = 0;
				this.distance[b] = Number.POSITIVE_INFINITY;
				continue;
			}
			const dx = Math.max(box.min.x - px, 0, px - box.max.x);
			const dz = Math.max(box.min.z - pz, 0, pz - box.max.z);
			this.distance[b] = Math.sqrt(dx * dx + dz * dz);
			const inside = this.#frustum.intersectsBox(box) ? 1 : 0;
			this.visible[b] = inside;
			visible += inside;
		}
		this.visibleCount = visible;
		return visible;
	}

	/**
	 * The one per-frame call: cull(), then sync every registered pool. Returns
	 * the number of pools whose GPU buffers changed this frame.
	 */
	update(camera: Camera): number {
		this.cull(camera);
		let changed = 0;
		for (let i = 0; i < this.#targets.length; i++) if (this.#targets[i].sync()) changed++;
		return changed;
	}

	/** Pools register themselves on creation and unregister on dispose. */
	register(target: BlockSyncTarget): void {
		if (!this.#targets.includes(target)) this.#targets.push(target);
	}

	unregister(target: BlockSyncTarget): void {
		const index = this.#targets.indexOf(target);
		if (index >= 0) this.#targets.splice(index, 1);
	}
}
