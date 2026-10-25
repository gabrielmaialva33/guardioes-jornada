import {
	BoxGeometry,
	BufferAttribute,
	BufferGeometry,
	Color,
	Group,
	InterleavedBuffer,
	InterleavedBufferAttribute,
	Matrix4,
	Mesh,
	MeshLambertMaterial,
	MeshStandardMaterial,
	NearestFilter,
	PerspectiveCamera,
	Texture,
	Vector3
} from 'three';
import { describe, expect, it } from 'vitest';
import { BlockGrid } from './blocks.ts';
import { lodRank } from './fog-lod.ts';
import { createPoolsFromScene, InstancePool, mergePieces, placedMatrix } from './instancing.ts';

/** Every block visible and near, without a camera. */
function showAll(grid: BlockGrid) {
	grid.visible.fill(1);
	grid.distance.fill(0);
}

function boxPool(capacity: number, grid: BlockGrid, colors = false) {
	return new InstancePool([{ geometry: new BoxGeometry(1, 1, 1), material: new MeshLambertMaterial() }], {
		name: 'box',
		capacity,
		grid,
		colors
	});
}

/** A kit-like GLTF scene: named nodes holding meshes, some sharing a material. */
function kitScene() {
	const palette = new MeshStandardMaterial({ name: 'palette', map: new Texture() });
	const other = new MeshStandardMaterial({ name: 'other' });
	const root = new Group();
	const tree = new Group();
	tree.name = 'tree_oak';
	tree.position.y = -0.05;
	const trunk = new Mesh(new BoxGeometry(0.4, 2, 0.4), palette);
	const crown = new Mesh(new BoxGeometry(2, 2, 2), palette);
	crown.position.y = 2;
	tree.add(trunk, crown);
	const sign = new Group();
	sign.name = 'sign';
	sign.add(new Mesh(new BoxGeometry(1, 2, 0.1), palette), new Mesh(new BoxGeometry(0.8, 0.5, 0.05), other));
	root.add(tree, sign);
	return { root, palette, other };
}

describe('InstancePool', () => {
	it('has a fixed capacity, hands out ids in order and reuses freed ones', () => {
		const grid = new BlockGrid({ minX: 0, minZ: 0, columns: 1, rows: 1 });
		const pool = boxPool(3, grid);
		expect([pool.add(1, 0, 1), pool.add(2, 0, 2), pool.add(3, 0, 3)]).toEqual([0, 1, 2]);
		expect(pool.add(4, 0, 4)).toBe(-1);
		expect(pool.size).toBe(3);
		expect(pool.remove(1)).toBe(true);
		expect(pool.remove(1)).toBe(false);
		expect(pool.has(1)).toBe(false);
		expect(pool.add(5, 0, 5)).toBe(1);
		expect(pool.size).toBe(3);
		pool.clear();
		expect(pool.size).toBe(0);
		expect(pool.add(0, 0, 0)).toBe(0);
	});

	it('draws exactly the live instances through count, one draw call per material', () => {
		const grid = new BlockGrid({ minX: 0, minZ: 0, columns: 1, rows: 1 });
		const pool = boxPool(8, grid);
		const mesh = pool.meshes[0];
		showAll(grid);
		expect(pool.sync()).toBe(true);
		expect(mesh.count).toBe(0);
		expect(mesh.visible).toBe(false);
		expect(pool.drawCalls).toBe(0);
		const ids = [pool.add(1, 0, 1), pool.add(2, 0, 2), pool.add(3, 0, 3)];
		pool.sync();
		expect(mesh.count).toBe(3);
		expect(mesh.visible).toBe(true);
		expect(pool.drawCalls).toBe(1);
		expect(pool.triangles).toBe(3 * 12);
		pool.remove(ids[1]);
		pool.sync();
		expect(mesh.count).toBe(2);
		const drawn = [pool.idAt(0), pool.idAt(1)].sort();
		expect(drawn).toEqual([ids[0], ids[2]]);
		// The GPU buffer holds the drawn instances' matrices at the front.
		const at = new Matrix4().fromArray(mesh.instanceMatrix.array, 1 * 16);
		const expected = pool.getMatrix(pool.idAt(1), new Matrix4());
		expect(at.elements).toEqual(expected.elements);
		// Nothing changed: no upload.
		expect(pool.sync()).toBe(false);
	});

	it('writes yaw and scale like the survival generator (local +z to (yawS, 0, yawC))', () => {
		const grid = new BlockGrid({ minX: 0, minZ: 0, columns: 1, rows: 1 });
		const pool = boxPool(1, grid);
		const yaw = 0.7;
		const id = pool.addPlaced(5, 1, 6, Math.cos(yaw), Math.sin(yaw), 2);
		const front = new Vector3(0, 0, 1).applyMatrix4(pool.getMatrix(id, new Matrix4()));
		expect(front.x).toBeCloseTo(5 + 2 * Math.sin(yaw));
		expect(front.z).toBeCloseTo(6 + 2 * Math.cos(yaw));
		const same = placedMatrix(new Matrix4(), 5, 1, 6, yaw, 2);
		expect(same.elements.map((v) => Number(v.toFixed(6)))).toEqual(
			pool.getMatrix(id, new Matrix4()).elements.map((v) => Number(v.toFixed(6)))
		);
	});

	it('updates a drawn instance in place, uploading only its range', () => {
		const grid = new BlockGrid({ minX: 0, minZ: 0, columns: 2, rows: 1 });
		const pool = boxPool(4, grid);
		const a = pool.add(5, 0, 5);
		const b = pool.add(10, 0, 10);
		showAll(grid);
		pool.sync();
		const attribute = pool.meshes[0].instanceMatrix;
		attribute.clearUpdateRanges();
		const version = attribute.version;
		pool.setTransform(b, 12, 0, 12);
		expect(pool.sync()).toBe(true);
		expect(attribute.version).toBe(version + 1);
		const index = pool.idAt(0) === b ? 0 : 1;
		expect(attribute.updateRanges).toEqual([{ start: index * 16, count: 16 }]);
		expect(attribute.array[index * 16 + 12]).toBe(12);
		// Moving across blocks repacks instead.
		pool.setTransform(a, 60, 0, 5);
		pool.sync();
		expect(pool.blockDrawn(0)).toBe(1);
		expect(pool.blockDrawn(1)).toBe(1);
	});

	it('keeps per-instance colours with their instance through repacks', () => {
		const grid = new BlockGrid({ minX: 0, minZ: 0, columns: 2, rows: 1 });
		const pool = boxPool(4, grid, true);
		const a = pool.add(5, 0, 5);
		const b = pool.add(50, 0, 5);
		pool.setColor(b, new Color(1, 0, 0));
		showAll(grid);
		pool.sync();
		const colors = pool.meshes[0].instanceColor?.array as Float32Array;
		const indexOf = (id: number) => (pool.idAt(0) === id ? 0 : 1);
		expect(Array.from(colors.slice(indexOf(b) * 3, indexOf(b) * 3 + 3))).toEqual([1, 0, 0]);
		expect(Array.from(colors.slice(indexOf(a) * 3, indexOf(a) * 3 + 3))).toEqual([1, 1, 1]);
		grid.visible[0] = 0;
		pool.sync();
		expect(pool.count).toBe(1);
		expect(Array.from(colors.slice(0, 3))).toEqual([1, 0, 0]);
	});

	it('does not allocate per frame when nothing changes (sync is a no-op)', () => {
		const grid = new BlockGrid({ minX: 0, minZ: 0, columns: 4, rows: 4 });
		const pool = boxPool(200, grid);
		for (let i = 0; i < 200; i++) pool.add((i * 7.3) % 160, 0, (i * 13.1) % 160);
		showAll(grid);
		pool.sync();
		for (let frame = 0; frame < 100; frame++) expect(pool.sync()).toBe(false);
	});
});

describe('block culling', () => {
	it('draws only visible blocks, each in one contiguous range', () => {
		const grid = new BlockGrid({ minX: 0, minZ: 0, columns: 4, rows: 4 });
		const pool = boxPool(64, grid);
		const blockOfId = new Map<number, number>();
		for (let block = 0; block < 16; block++) {
			const x = (block % 4) * 40 + 20;
			const z = Math.floor(block / 4) * 40 + 20;
			for (let k = 0; k < 3; k++) blockOfId.set(pool.add(x + k, 0, z), block);
		}
		grid.distance.fill(0);
		grid.visible.fill(0);
		for (const block of [1, 5, 6, 15]) grid.visible[block] = 1;
		pool.sync();
		expect(pool.count).toBe(12);
		let expectedStart = 0;
		for (let block = 0; block < 16; block++) {
			const shown = grid.visible[block] === 1 ? 3 : 0;
			expect(pool.blockDrawn(block)).toBe(shown);
			expect(pool.blockStart(block)).toBe(expectedStart);
			for (let i = 0; i < shown; i++) expect(blockOfId.get(pool.idAt(expectedStart + i))).toBe(block);
			expectedStart += shown;
		}
		// Toggling one block moves the ranges after it.
		grid.visible[5] = 0;
		grid.visible[0] = 1;
		expect(pool.sync()).toBe(true);
		expect(pool.blockStart(0)).toBe(0);
		expect(pool.blockDrawn(0)).toBe(3);
		expect(pool.blockStart(1)).toBe(3);
		expect(pool.blockDrawn(5)).toBe(0);
		expect(pool.count).toBe(12);
	});

	it('culls blocks outside a real camera frustum', () => {
		const grid = new BlockGrid({ minX: 0, minZ: 0, columns: 4, rows: 4 });
		const pool = boxPool(16, grid);
		for (let block = 0; block < 16; block++)
			pool.add((block % 4) * 40 + 20, 0, Math.floor(block / 4) * 40 + 20);
		// In block 0, looking along +x, far plane at 70: blocks 0..1 in the first row.
		const camera = new PerspectiveCamera(70, 1, 0.1, 70);
		camera.position.set(2, 3, 20);
		camera.lookAt(100, 3, 20);
		grid.update(camera);
		const visible = [...grid.visible].flatMap((v, b) => (v ? [b] : []));
		expect(visible).toContain(0);
		expect(visible).toContain(1);
		expect(visible).not.toContain(3);
		expect(visible).not.toContain(12);
		expect(pool.count).toBe(visible.length);
		// Distances are to the content bounds (one unit box per block), not to the cell.
		const half = Math.sqrt(3) / 2;
		expect(grid.distance[0]).toBeCloseTo(20 - half - 2, 4);
		expect(grid.distance[1]).toBeCloseTo(60 - half - 2, 4);
	});

	it('syncs registered pools from grid.update and forgets disposed ones', () => {
		const grid = new BlockGrid({ minX: 0, minZ: 0, columns: 1, rows: 1 });
		const pool = boxPool(4, grid);
		pool.add(20, 0, 20);
		const camera = new PerspectiveCamera(70, 1, 0.1, 100);
		camera.position.set(20, 5, -10);
		camera.lookAt(20, 0, 20);
		expect(grid.update(camera)).toBe(1);
		expect(pool.count).toBe(1);
		camera.lookAt(20, 0, -60);
		expect(grid.update(camera)).toBe(1);
		expect(pool.count).toBe(0);
		pool.dispose();
		camera.lookAt(20, 0, 20);
		expect(grid.update(camera)).toBe(0);
	});

	it('thins far blocks by LOD rank: half keeps every second instance of a run', () => {
		const grid = new BlockGrid({ minX: 0, minZ: 0, columns: 2, rows: 1 });
		const pool = new InstancePool([{ geometry: new BoxGeometry(), material: new MeshLambertMaterial() }], {
			capacity: 64,
			grid,
			lod: [
				{ until: 10, keep: 1 },
				{ until: 50, keep: 0.5 },
				{ until: 90, keep: 0.25 }
			]
		});
		for (let i = 0; i < 16; i++) pool.add(5 + i, 0, 5);
		for (let i = 0; i < 16; i++) pool.add(45 + i, 0, 5);
		grid.visible.fill(1);
		grid.distance[0] = 0;
		grid.distance[1] = 30;
		pool.sync();
		expect(pool.blockDrawn(0)).toBe(16);
		expect(pool.blockDrawn(1)).toBe(8);
		const kept = Array.from({ length: 8 }, (_, i) => pool.idAt(16 + i));
		expect(kept.every((id) => lodRank(id) < 128)).toBe(true);
		grid.distance[1] = 80;
		pool.sync();
		expect(pool.blockDrawn(1)).toBe(4);
		const quarter = Array.from({ length: 4 }, (_, i) => pool.idAt(16 + i));
		// Nested: everything kept at a quarter was kept at a half.
		expect(quarter.every((id) => kept.includes(id))).toBe(true);
		grid.distance[1] = 200;
		pool.sync();
		expect(pool.blockDrawn(1)).toBe(0);
	});
});

describe('pools from a GLTF scene', () => {
	it('merges meshes that share a material and reports draw calls per pool', () => {
		const { root, palette } = kitScene();
		const grid = new BlockGrid({ minX: 0, minZ: 0, columns: 4, rows: 4 });
		const set = createPoolsFromScene(root, ['tree_oak', 'sign'], {
			grid,
			capacity: { tree_oak: 10, sign: 2 }
		});
		const tree = set.get('tree_oak');
		const sign = set.get('sign');
		expect(tree.meshes).toHaveLength(1);
		expect(sign.meshes).toHaveLength(2);
		expect(tree.capacity).toBe(10);
		expect(tree.trianglesPerInstance).toBe(24);
		// The house material: Lambert, flat, vertex colours, the palette map with nearest sampling.
		const material = tree.meshes[0].material as MeshLambertMaterial;
		expect(material).toBeInstanceOf(MeshLambertMaterial);
		expect(material.flatShading).toBe(true);
		expect(material.vertexColors).toBe(true);
		expect(material.map).toBe(palette.map);
		expect(palette.map?.minFilter).toBe(NearestFilter);
		expect(palette.map?.generateMipmaps).toBe(false);
		// Shared between pools of the set.
		expect(sign.meshes.some((mesh) => mesh.material === material)).toBe(true);
		// The node's own placement (y = -0.05) is kept; the crown sits at y = 2.
		const box = tree.meshes[0].geometry.boundingBox;
		expect(box?.min.y).toBeCloseTo(-1.05);
		expect(box?.max.y).toBeCloseTo(2.95);
		tree.add(20, 0, 20);
		tree.add(100, 0, 100);
		sign.add(20, 0, 25);
		showAll(grid);
		for (const pool of set.pools.values()) pool.sync();
		expect(set.drawCalls).toBe(3);
		expect(set.report()).toEqual([
			expect.objectContaining({ name: 'tree_oak', materials: 1, instances: 2, drawCalls: 1 }),
			expect.objectContaining({ name: 'sign', materials: 2, instances: 1, drawCalls: 2 })
		]);
		set.dispose();
		expect(set.pools.size).toBe(0);
	});

	it('throws on a missing node name', () => {
		const { root } = kitScene();
		const grid = new BlockGrid({ minX: 0, minZ: 0, columns: 1, rows: 1 });
		expect(() => createPoolsFromScene(root, ['tree_oak', 'nope'], { grid, capacity: 4 })).toThrow(/nope/);
	});
});

describe('mergePieces', () => {
	it('de-quantizes interleaved attributes, adds white colour and keeps mirrored winding', () => {
		// A quantized triangle: Uint16 positions in an interleaved buffer, scaled by the node matrix.
		const data = new InterleavedBuffer(new Uint16Array([0, 0, 0, 0, 1000, 0, 0, 0, 0, 1000, 0, 0]), 4);
		const geometry = new BufferGeometry();
		geometry.setAttribute('position', new InterleavedBufferAttribute(data, 3, 0));
		geometry.setIndex([0, 1, 2]);
		const scale = new Matrix4().makeScale(0.001, 0.001, 0.001);
		const merged = mergePieces([{ geometry, matrix: scale }]);
		const position = merged.getAttribute('position');
		expect(position.array).toBeInstanceOf(Float32Array);
		expect(position.getX(1)).toBeCloseTo(1);
		expect(position.getY(2)).toBeCloseTo(1);
		expect(Array.from(merged.getAttribute('color').array)).toEqual([1, 1, 1, 1, 1, 1, 1, 1, 1]);
		expect(merged.getAttribute('normal')).toBeDefined();
		const mirrored = mergePieces([{ geometry, matrix: new Matrix4().makeScale(-1, 1, 1) }]);
		expect(Array.from(mirrored.index?.array ?? [])).toEqual([0, 2, 1]);
	});

	it('keeps a baked colour and merges an index range only', () => {
		const geometry = new BoxGeometry(1, 1, 1);
		const colors = new Float32Array(geometry.getAttribute('position').count * 3).fill(0.5);
		geometry.setAttribute('color', new BufferAttribute(colors, 3));
		const merged = mergePieces([{ geometry, matrix: new Matrix4(), start: 0, count: 6 }]);
		expect(merged.index?.count).toBe(6);
		expect(merged.getAttribute('position').count).toBe(4);
		expect(merged.getAttribute('color').getX(0)).toBe(0.5);
	});
});
