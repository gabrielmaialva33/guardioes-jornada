/** One coarse background draw over the data ring; slots and GPU buffers never grow. */
import { BufferAttribute, BufferGeometry, Color, DynamicDrawUsage, Mesh, MeshLambertMaterial } from 'three';
import { stylize } from '../../render/stylized.ts';
import { patchFarShader } from '../far-field.ts';
import type { StreamingRing } from './ring.ts';
import { windowTint } from './tint.ts';
import { CHUNK_SIDE, type StreamChunk } from './types.ts';
import { type ChunkLookup, createWindow, fillWindow } from './window.ts';

const SIDE = 11,
	VERTICES = SIDE * SIDE,
	INDICES = 10 * 10 * 6;
const mod = (n: number, side: number) => ((n % side) + side) % side;

export class StreamFarTerrain {
	readonly object: Mesh<BufferGeometry, MeshLambertMaterial>;
	readonly #positions: Float32Array;
	readonly #colors: Float32Array;
	readonly #normals: Float32Array;
	readonly #indices: Uint32Array;
	readonly #owners: Float64Array;
	readonly #cx: Int32Array;
	readonly #cz: Int32Array;
	readonly #window = createWindow();
	readonly #color = new Color();
	#disposed = false;
	#size = 0;
	constructor(readonly side: number) {
		const count = side * side;
		this.#positions = new Float32Array(count * VERTICES * 3);
		this.#colors = new Float32Array(count * VERTICES * 3);
		this.#normals = new Float32Array(count * VERTICES * 3);
		this.#indices = new Uint32Array(count * INDICES);
		this.#owners = new Float64Array(count).fill(-1);
		this.#cx = new Int32Array(count);
		this.#cz = new Int32Array(count);
		const geometry = new BufferGeometry();
		geometry.setAttribute('position', new BufferAttribute(this.#positions, 3).setUsage(DynamicDrawUsage));
		geometry.setAttribute('color', new BufferAttribute(this.#colors, 3).setUsage(DynamicDrawUsage));
		geometry.setAttribute('normal', new BufferAttribute(this.#normals, 3).setUsage(DynamicDrawUsage));
		geometry.setIndex(new BufferAttribute(this.#indices, 1).setUsage(DynamicDrawUsage));
		const material = stylize(new MeshLambertMaterial({ vertexColors: true, fog: false }), {
			vegetation: true
		});
		const previous = material.onBeforeCompile.bind(material),
			key = material.customProgramCacheKey();
		material.onBeforeCompile = (shader, renderer) => {
			previous(shader, renderer);
			patchFarShader(shader);
		};
		material.customProgramCacheKey = () => `${key}|stream-far-v1`;
		this.object = new Mesh(geometry, material);
		this.object.name = 'stream-far-field';
		this.object.frustumCulled = false;
		this.object.renderOrder = -2000;
		this.object.userData.noShadow = true;
	}
	get size() {
		return this.#size;
	}
	add(chunk: StreamChunk, lookup: ChunkLookup) {
		if (this.#disposed) return;
		const slot = mod(chunk.cx, this.side) + mod(chunk.cz, this.side) * this.side;
		if (this.#owners[slot] === chunk.key) return;
		if (this.#owners[slot] === -1) this.#size++;
		this.#owners[slot] = chunk.key;
		this.#cx[slot] = chunk.cx;
		this.#cz[slot] = chunk.cz;
		const win = fillWindow(this.#window, chunk, lookup),
			h = chunk.heights;
		const offset = slot * VERTICES * 3;
		for (let j = 0; j < SIDE; j++)
			for (let i = 0; i < SIDE; i++) {
				const x = i * 4,
					z = j * 4,
					k = z * CHUNK_SIDE + x,
					o = offset + (j * SIDE + i) * 3;
				let y = h[k];
				// A coarse surface lies under the exact collision-matched ground, never over a narrow ledge.
				for (let dz = -2; dz <= 2; dz++)
					for (let dx = -2; dx <= 2; dx++)
						y = Math.min(
							y,
							h[Math.max(0, Math.min(40, z + dz)) * CHUNK_SIDE + Math.max(0, Math.min(40, x + dx))]
						);
				this.#positions[o] = chunk.x0 + x;
				this.#positions[o + 1] = y - 0.25;
				this.#positions[o + 2] = chunk.z0 + z;
				windowTint(win, chunk.x0 + x, chunk.z0 + z, this.#color);
				this.#colors[o] = this.#color.r;
				this.#colors[o + 1] = this.#color.g;
				this.#colors[o + 2] = this.#color.b;
				this.#normals[o] = 0;
				this.#normals[o + 1] = 1;
				this.#normals[o + 2] = 0;
			}
		let cursor = slot * INDICES;
		for (let j = 0; j < 10; j++)
			for (let i = 0; i < 10; i++) {
				const a = slot * VERTICES + j * SIDE + i;
				this.#indices[cursor++] = a;
				this.#indices[cursor++] = a + SIDE;
				this.#indices[cursor++] = a + 1;
				this.#indices[cursor++] = a + 1;
				this.#indices[cursor++] = a + SIDE;
				this.#indices[cursor++] = a + SIDE + 1;
			}
		for (const name of ['position', 'color', 'normal'])
			this.object.geometry.getAttribute(name).needsUpdate = true;
		const index = this.object.geometry.index;
		if (index) index.needsUpdate = true;
	}
	/** At most one newly arrived chunk per frame, outside the ring's own work budget. */
	sync(ring: StreamingRing) {
		const x = ring.stats.focusX,
			z = ring.stats.focusZ,
			r = ring.radii.data + 1;
		for (let i = 0; i < this.#owners.length; i++)
			if (this.#owners[i] !== -1 && (Math.abs(this.#cx[i] - x) > r || Math.abs(this.#cz[i] - z) > r)) {
				this.#owners[i] = -1;
				this.#size--;
				this.#indices.fill(0, i * INDICES, (i + 1) * INDICES);
				const index = this.object.geometry.index;
				if (index) index.needsUpdate = true;
			}
		for (let dz = -r; dz <= r; dz++)
			for (let dx = -r; dx <= r; dx++) {
				const chunk = ring.chunkAt(x + dx, z + dz);
				if (!chunk) continue;
				const slot = mod(chunk.cx, this.side) + mod(chunk.cz, this.side) * this.side;
				if (this.#owners[slot] === chunk.key) continue;
				this.add(chunk, this.#lookup(ring));
				return;
			}
	}
	#lookup(ring: StreamingRing): ChunkLookup {
		return (cx, cz) => ring.chunkAt(cx, cz);
	}
	dispose() {
		if (this.#disposed) return;
		this.#disposed = true;
		this.object.removeFromParent();
		this.object.geometry.dispose();
		this.object.material.dispose();
		this.#size = 0;
	}
}
