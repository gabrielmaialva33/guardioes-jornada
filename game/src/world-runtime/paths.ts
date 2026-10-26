import { BufferGeometry, Color, Float32BufferAttribute } from 'three';
import type { Trail } from '../level/types.ts';
import { RAMPS } from '../style/palette.ts';
import type { SurvivalWorld } from '../survival/types.ts';
/** Same two triangles and diagonal as the terrain's 1u grid, rather than bilinear height. */
export function terrainHeight(w: SurvivalWorld, x: number, z: number) {
	x = Math.max(0, Math.min(w.size - 0.00001, x));
	z = Math.max(0, Math.min(w.size - 0.00001, z));
	const ix = Math.floor(x),
		iz = Math.floor(z),
		fx = x - ix,
		fz = z - iz,
		i = iz * w.grid + ix;
	const a = w.heights[i],
		b = w.heights[i + 1],
		c = w.heights[i + w.grid],
		d = w.heights[i + w.grid + 1];
	return fx + fz <= 1 ? a + (b - a) * fx + (c - a) * fz : d + (c - d) * (1 - fx) + (b - d) * (1 - fz);
}
/** All trail strips in one draw; close-spaced edge samples retain a crisp silhouette on low. */
export function pathRibbon(world: SurvivalWorld, trails: readonly Trail[]) {
	const p: number[] = [],
		c: number[] = [],
		ix: number[] = [],
		color = new Color(RAMPS.soil[2]);
	for (const trail of trails) {
		let previous = -1,
			travel = 0;
		for (let j = 1; j < trail.points.length; j++) {
			const a = trail.points[j - 1],
				b = trail.points[j],
				dx = b[0] - a[0],
				dz = b[1] - a[1],
				length = Math.hypot(dx, dz);
			if (length < 0.001) continue;
			const n = Math.ceil(length / 0.5);
			for (let k = j === 1 ? 0 : 1; k <= n; k++) {
				const t = k / n,
					x = a[0] + dx * t,
					z = a[1] + dz * t,
					s = travel + length * t;
				const half = trail.halfWidth * (0.94 + 0.035 * Math.sin(s * 2.3) + 0.025 * Math.sin(s * 5.7));
				const center = 0.06 * Math.sin(s * 1.8),
					base = p.length / 3;
				for (const side of [-1, 1]) {
					const xx = x - (dz / length) * (side * half + center),
						zz = z + (dx / length) * (side * half + center);
					p.push(xx, terrainHeight(world, xx, zz) + 0.035, zz);
					const v = 0.97 + 0.03 * Math.sin(s * 0.8 + side);
					c.push(color.r * v, color.g * v, color.b * v);
				}
				if (previous >= 0) ix.push(previous, previous + 1, base, previous + 1, base + 1, base);
				previous = base;
			}
			travel += length;
		}
	}
	// Sharp authored turns can fold a join; keep every projected triangle facing up.
	for (let i = 0; i < ix.length; i += 3) {
		const a = ix[i] * 3,
			b = ix[i + 1] * 3,
			c = ix[i + 2] * 3;
		const up = (p[b + 2] - p[a + 2]) * (p[c] - p[a]) - (p[b] - p[a]) * (p[c + 2] - p[a + 2]);
		if (up < 0) [ix[i + 1], ix[i + 2]] = [ix[i + 2], ix[i + 1]];
	}
	const g = new BufferGeometry();
	g.setAttribute('position', new Float32BufferAttribute(p, 3));
	g.setAttribute('color', new Float32BufferAttribute(c, 3));
	g.setIndex(ix);
	g.computeVertexNormals();
	g.computeBoundingSphere();
	return g;
}
/** Small deterministic inward variation; the original obby colliders and deep-water checks stay intact. */
export function poolShoreScale(angle: number) {
	return 0.965 + 0.022 * Math.sin(angle * 3 + 0.4) + 0.013 * Math.sin(angle * 7 - 1.1);
}
