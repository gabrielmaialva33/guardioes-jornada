/**
 * Poisson-disk sampling after Bridson, "Fast Poisson Disk Sampling in
 * Arbitrary Dimensions" (SIGGRAPH 2007). Candidates around an active point are
 * drawn in the square [−2r, 2r]² and kept when r ≤ d < 2r (about 59% are),
 * instead of picking an angle: no trigonometry, so the same points everywhere.
 * fast-2d-poisson-disk-sampling uses Math.cos/sin/pow, hence this copy.
 */
import { floor } from './noise.ts';
import type { Rng } from './random.ts';

/** Points at least `r` apart filling [x0, x1) × [z0, z1), as a flat [x, z, x, z, …] list. */
export function poissonDisk(rng: Rng, x0: number, z0: number, x1: number, z1: number, r: number, tries = 20) {
	// Cells smaller than r/√2 hold at most one point; ±2 cells cover the radius.
	const cell = r / 1.5;
	const width = x1 - x0;
	const depth = z1 - z0;
	const cols = floor(width / cell) + 1;
	const rows = floor(depth / cell) + 1;
	const grid = new Int32Array(cols * rows).fill(-1);
	const points: number[] = [];
	const active: number[] = [];
	const r2 = r * r;

	const add = (x: number, z: number) => {
		const k = points.length >> 1;
		points.push(x, z);
		active.push(k);
		grid[floor((z - z0) / cell) * cols + floor((x - x0) / cell)] = k;
	};
	const isFree = (x: number, z: number) => {
		if (x < x0 || z < z0 || x >= x1 || z >= z1) return false;
		const gx = floor((x - x0) / cell);
		const gz = floor((z - z0) / cell);
		for (let j = Math.max(0, gz - 2); j <= Math.min(rows - 1, gz + 2); j++)
			for (let i = Math.max(0, gx - 2); i <= Math.min(cols - 1, gx + 2); i++) {
				const k = grid[j * cols + i];
				if (k < 0) continue;
				const dx = points[2 * k] - x;
				const dz = points[2 * k + 1] - z;
				if (dx * dx + dz * dz < r2) return false;
			}
		return true;
	};

	add(x0 + rng.next() * width, z0 + rng.next() * depth);
	while (active.length > 0) {
		const a = rng.int(active.length);
		const k = active[a];
		const px = points[2 * k];
		const pz = points[2 * k + 1];
		let found = false;
		for (let t = 0; t < tries; ) {
			const dx = (rng.next() * 4 - 2) * r;
			const dz = (rng.next() * 4 - 2) * r;
			const d2 = dx * dx + dz * dz;
			if (d2 < r2 || d2 >= 4 * r2) continue;
			t++;
			if (isFree(px + dx, pz + dz)) {
				add(px + dx, pz + dz);
				found = true;
				break;
			}
		}
		if (!found) {
			active[a] = active[active.length - 1];
			active.pop();
		}
	}
	return points;
}
