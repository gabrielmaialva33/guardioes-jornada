/**
 * Bilinear ground height of the map's 1 u grid (survival/terrain.ts heightAt),
 * through fields: the per-frame paths pass no number arguments (V8 boxes them
 * in calls it does not inline, p3-animals.md).
 *
 *   ground.x = x; ground.z = z; ground.sample(); use(ground.y);
 */
export class GroundSampler {
	x = 0;
	z = 0;
	y = 0;
	readonly #heights: Float32Array;
	readonly #grid: number;
	readonly #size: number;

	constructor(heights: Float32Array, size: number) {
		this.#heights = heights;
		this.#size = size;
		this.#grid = size + 1;
	}

	sample() {
		const size = this.#size;
		const x = this.x < 0 ? 0 : Math.min(this.x, size);
		const z = this.z < 0 ? 0 : Math.min(this.z, size);
		const n = this.#grid;
		const i = Math.min(n - 2, Math.floor(x));
		const j = Math.min(n - 2, Math.floor(z));
		const tx = x - i;
		const tz = z - j;
		const q = j * n + i;
		const h = this.#heights;
		const a = h[q];
		const b = h[q + 1];
		const c = h[q + n];
		const d = h[q + n + 1];
		this.y = (a + (b - a) * tx) * (1 - tz) + (c + (d - c) * tx) * tz;
	}
}
