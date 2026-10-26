/** A moving R8 path/shade pair. Builds are sliced; pixels and origin publish together, never half a map. */
import { DataTexture, LinearFilter, RedFormat, Vector2 } from 'three';
import { SUN_AZIMUTH_DEG } from '../../render/shadows.ts';
import { LIGHT } from '../../style/palette.ts';
import { segmentDistance } from '../terrain.ts';
import type { StreamChunk } from './types.ts';

interface Segment {
	ax: number;
	az: number;
	bx: number;
	bz: number;
	half: number;
}
interface Stamp {
	x: number;
	z: number;
	radius: number;
	stretch: number;
	strength: number;
}
const CROWNS: Readonly<Record<string, readonly [number, number]>> = {
	jequitiba: [4.7, 12],
	araucaria: [4, 10],
	embauba: [3, 7],
	jucara: [2.5, 6],
	jeriva: [3, 8],
	xaxim: [2, 4],
	'pau-brasil': [3.4, 8],
	'mangue-vermelho': [3, 6],
	'ipe-amarelo': [3.4, 8],
	'ipe-rosa': [3.4, 8]
};

export class GroundClipmap {
	readonly paths: DataTexture;
	readonly shade: DataTexture;
	readonly origin = new Vector2();
	revision = 0;
	get pathPixels() {
		return this.#pathPixels;
	}
	get shadePixels() {
		return this.#shadePixels;
	}
	readonly #pathPixels: Uint8Array;
	readonly #shadePixels: Uint8Array;
	readonly #nextPath: Uint8Array;
	readonly #nextShade: Uint8Array;
	#segments: Segment[] = [];
	#stamps: Stamp[] = [];
	#row = 0;
	#stamp = 0;
	#busy = false;
	#targetX = 0;
	#targetZ = 0;
	#targetRevision = 0;
	#disposed = false;
	readonly #sunX = Math.sin((SUN_AZIMUTH_DEG * Math.PI) / 180);
	readonly #sunZ = Math.cos((SUN_AZIMUTH_DEG * Math.PI) / 180);
	constructor(
		readonly side = 128,
		readonly size = 320
	) {
		this.#pathPixels = new Uint8Array(side * side).fill(255);
		this.#shadePixels = new Uint8Array(side * side).fill(255);
		this.#nextPath = new Uint8Array(side * side);
		this.#nextShade = new Uint8Array(side * side);
		this.paths = new DataTexture(this.#pathPixels, side, side, RedFormat);
		this.shade = new DataTexture(this.#shadePixels, side, side, RedFormat);
		for (const texture of [this.paths, this.shade]) {
			texture.minFilter = texture.magFilter = LinearFilter;
			texture.generateMipmaps = false;
			texture.unpackAlignment = 1;
			texture.needsUpdate = true;
		}
		this.paths.name = 'stream-trail-field';
		this.shade.name = 'stream-canopy-field';
	}
	request(x: number, z: number, chunks: Iterable<StreamChunk>, revision: number) {
		if (this.#disposed) return;
		const ox = Math.floor(x / 40) * 40 - this.size / 2,
			oz = Math.floor(z / 40) * 40 - this.size / 2;
		if (this.#busy && ox === this.#targetX && oz === this.#targetZ) return;
		if (!this.#busy && this.revision === revision && this.origin.x === ox && this.origin.y === oz) return;
		this.#targetX = ox;
		this.#targetZ = oz;
		this.#targetRevision = revision;
		this.#segments = [];
		this.#stamps = [];
		this.#row = 0;
		this.#stamp = 0;
		this.#busy = true;
		this.#nextPath.fill(255);
		this.#nextShade.fill(255);
		const zones = new Set<string>();
		for (const chunk of chunks) {
			const story = chunk.story;
			if (story && !zones.has(story.zone)) {
				zones.add(story.zone);
				for (const trail of story.level.trails)
					for (let i = 1; i < trail.points.length; i++) {
						const a = trail.points[i - 1],
							b = trail.points[i];
						this.#segments.push({
							ax: a[0] + story.offsetX,
							az: a[1] + story.offsetZ,
							bx: b[0] + story.offsetX,
							bz: b[1] + story.offsetZ,
							half: trail.halfWidth
						});
					}
			}
			const trees = chunk.trees;
			for (let i = 0; i < trees.count; i++) {
				const x = trees.x[i],
					z = trees.z[i];
				if (x < ox - 40 || z < oz - 40 || x > ox + this.size + 40 || z > oz + this.size + 40) continue;
				const crown = CROWNS[trees.kinds[trees.kind[i]]] ?? [3, 7],
					k = trees.scale[i];
				const reach = (crown[1] * k) / Math.tan((LIGHT.daylight.sunElevationDeg * Math.PI) / 180);
				this.#stamps.push({
					x: x - this.#sunX * reach,
					z: z - this.#sunZ * reach,
					radius: crown[0] * k,
					stretch: 1.5,
					strength: 0.62
				});
				this.#stamps.push({ x, z, radius: 0.85 * k, stretch: 1, strength: 0.26 });
			}
		}
	}
	step(budgetMs = 0.65) {
		if (!this.#busy || this.#disposed || budgetMs <= 0) return false;
		const start = performance.now(),
			side = this.side,
			scale = side / this.size;
		while (this.#row < side) {
			const z = this.#targetZ + (this.#row + 0.5) / scale;
			for (let i = 0; i < side; i++) {
				const x = this.#targetX + (i + 0.5) / scale;
				let distance = 6;
				for (const s of this.#segments) {
					if (
						x < Math.min(s.ax, s.bx) - s.half - 6 ||
						x > Math.max(s.ax, s.bx) + s.half + 6 ||
						z < Math.min(s.az, s.bz) - s.half - 6 ||
						z > Math.max(s.az, s.bz) + s.half + 6
					)
						continue;
					distance = Math.min(distance, segmentDistance(x, z, s.ax, s.az, s.bx, s.bz) - s.half);
				}
				this.#nextPath[this.#row * side + i] = Math.round(Math.max(0, Math.min(1, (distance + 2) / 8)) * 255);
			}
			this.#row++;
			if (performance.now() - start >= budgetMs) return false;
		}
		while (this.#stamp < this.#stamps.length) {
			const s = this.#stamps[this.#stamp++],
				r = s.radius * scale * s.stretch,
				cx = (s.x - this.#targetX) * scale,
				cz = (s.z - this.#targetZ) * scale;
			for (let z = Math.max(0, Math.floor(cz - r)); z <= Math.min(side - 1, Math.ceil(cz + r)); z++)
				for (let x = Math.max(0, Math.floor(cx - r)); x <= Math.min(side - 1, Math.ceil(cx + r)); x++) {
					const dx = x - cx,
						dz = z - cz,
						a = (dx * this.#sunX + dz * this.#sunZ) / s.stretch,
						b = dx * this.#sunZ - dz * this.#sunX;
					const d = (a * a + b * b) / (s.radius * s.radius * scale * scale);
					if (d < 1)
						this.#nextShade[z * side + x] = Math.max(
							30,
							Math.round(this.#nextShade[z * side + x] * (1 - s.strength * (1 - d) ** 2))
						);
				}
			if (performance.now() - start >= budgetMs) return false;
		}
		this.#pathPixels.set(this.#nextPath);
		this.#shadePixels.set(this.#nextShade);
		this.origin.set(this.#targetX, this.#targetZ);
		this.revision = this.#targetRevision;
		this.paths.needsUpdate = true;
		this.shade.needsUpdate = true;
		this.#busy = false;
		this.#segments = [];
		this.#stamps = [];
		return true;
	}
	dispose() {
		if (this.#disposed) return;
		this.#disposed = true;
		this.#segments = [];
		this.#stamps = [];
		this.paths.dispose();
		this.shade.dispose();
	}
}
