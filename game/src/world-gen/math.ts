/**
 * Hot-path helpers under the determinism rules (survival/random.ts).
 */
import { floor } from '../survival/noise.ts';

/**
 * survival's smoothstep for edge0 < edge1, returning early outside the edges:
 * the same bits (0 and 1 exactly outside, the same polynomial inside), faster
 * on the many vertices where a band does not apply.
 */
export function smooth(edge0: number, edge1: number, x: number): number {
	if (x <= edge0) return 0;
	if (x >= edge1) return 1;
	const t = (x - edge0) / (edge1 - edge0);
	return t * t * (3 - 2 * t);
}

/**
 * A low-frequency field sampled at world-aligned nodes every `step` u and
 * read bilinearly: a pure function of (x, z), cheap per vertex. `prepare`
 * tabulates the nodes over a rectangle; nodes outside it are computed on
 * demand with the same function, so the table only ever saves time.
 */
export class CoarseField {
	readonly step: number;
	readonly #node: (x: number, z: number) => number;
	#i0 = 0;
	#j0 = 0;
	#cols = 0;
	#rows = 0;
	#values = new Float64Array(0);

	/** `node(x, z)` is the field at node world position (x, z), both multiples of `step`. */
	constructor(step: number, node: (x: number, z: number) => number) {
		this.step = step;
		this.#node = node;
	}

	prepare(x0: number, z0: number, x1: number, z1: number) {
		const step = this.step;
		const i0 = floor(x0 / step) - 1;
		const j0 = floor(z0 / step) - 1;
		const cols = floor(x1 / step) + 3 - i0;
		const rows = floor(z1 / step) + 3 - j0;
		if (i0 === this.#i0 && j0 === this.#j0 && cols === this.#cols && rows === this.#rows) return;
		const values = new Float64Array(cols * rows);
		for (let b = 0; b < rows; b++)
			for (let a = 0; a < cols; a++) values[b * cols + a] = this.#node((i0 + a) * step, (j0 + b) * step);
		this.#i0 = i0;
		this.#j0 = j0;
		this.#cols = cols;
		this.#rows = rows;
		this.#values = values;
	}

	#at(i: number, j: number): number {
		const a = i - this.#i0;
		const b = j - this.#j0;
		if (a >= 0 && b >= 0 && a < this.#cols && b < this.#rows) return this.#values[b * this.#cols + a];
		return this.#node(i * this.step, j * this.step);
	}

	at(x: number, z: number): number {
		const step = this.step;
		const i = floor(x / step);
		const j = floor(z / step);
		const tx = (x - i * step) / step;
		const tz = (z - j * step) / step;
		const c00 = this.#at(i, j);
		const c10 = this.#at(i + 1, j);
		const c01 = this.#at(i, j + 1);
		const c11 = this.#at(i + 1, j + 1);
		return (c00 + (c10 - c00) * tx) * (1 - tz) + (c01 + (c11 - c01) * tx) * tz;
	}
}
