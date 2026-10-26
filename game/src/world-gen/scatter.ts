/**
 * Seamless blue-noise points (f-mundo-infinito.md §3.5, measured there): one
 * hashed candidate per cell of side r/√2, kept when no other candidate within
 * r has a higher priority hash (ties broken by cell offset). Each point is a
 * pure function of world position and the seed, so asking for any rectangle
 * gives exactly the points of the whole plane that fall inside it: chunks need
 * no border pass and no neighbour data, and their union is the whole-area
 * scatter. About 52% of the densest Poisson packing, minimum distance exactly
 * r. survival/poisson.ts (Bridson) stays for sets inside one object: it needs
 * a global order and broke the spacing at chunk borders.
 */
import { floor } from '../survival/noise.ts';
import { cellHash, cellUnit } from './hash.ts';

/**
 * Points at least r apart in [x0, x1) × [z0, z1), appended to `out` as
 * [x, z, hash] triples in cell order (rows, then columns); `hash` is the
 * point's unsigned 32-bit priority, a free per-point seed.
 */
export function blueNoise(
	seed: number,
	r: number,
	x0: number,
	z0: number,
	x1: number,
	z1: number,
	out: number[] = []
): number[] {
	const cell = r * 0.7071;
	// Candidates in cells farther than this can never be within r.
	const reach = 2;
	// One spare cell per side: a rounded x0 / cell must never skip a candidate just inside x0.
	const ci0 = floor(x0 / cell) - 1;
	const cj0 = floor(z0 / cell) - 1;
	const ci1 = floor(x1 / cell) + 1;
	const cj1 = floor(z1 / cell) + 1;
	const cols = ci1 - ci0 + 1 + 2 * reach;
	const rows = cj1 - cj0 + 1 + 2 * reach;
	const cx = new Float64Array(cols * rows);
	const cz = new Float64Array(cols * rows);
	const cp = new Float64Array(cols * rows);
	for (let b = 0; b < rows; b++)
		for (let a = 0; a < cols; a++) {
			const i = ci0 - reach + a;
			const j = cj0 - reach + b;
			const k = b * cols + a;
			cx[k] = (i + cellUnit(i, j, seed ^ 0x9e3779b9)) * cell;
			cz[k] = (j + cellUnit(j, i, seed ^ 0x7f4a7c15)) * cell;
			cp[k] = cellHash(i, j, seed);
		}
	const r2 = r * r;
	for (let b = reach; b < rows - reach; b++)
		for (let a = reach; a < cols - reach; a++) {
			const k = b * cols + a;
			const x = cx[k];
			const z = cz[k];
			if (x < x0 || x >= x1 || z < z0 || z >= z1) continue;
			const p = cp[k];
			let keep = true;
			for (let db = -reach; db <= reach && keep; db++)
				for (let da = -reach; da <= reach; da++) {
					if (da === 0 && db === 0) continue;
					const o = k + db * cols + da;
					const dx = cx[o] - x;
					const dz = cz[o] - z;
					if (dx * dx + dz * dz >= r2) continue;
					const op = cp[o];
					if (op > p || (op === p && (db > 0 || (db === 0 && da > 0)))) {
						keep = false;
						break;
					}
				}
			if (keep) out.push(x, z, p);
		}
	return out;
}
