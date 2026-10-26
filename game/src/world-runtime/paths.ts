import { BufferGeometry, Color, Float32BufferAttribute } from 'three';
import type { Trail } from '../level/types.ts';
import { RAMPS } from '../style/palette.ts';
import type { SurvivalWorld } from '../survival/types.ts';
/** Same two triangles and diagonal as the terrain's 1u grid, rather than bilinear height. */
export function terrainHeight(w: SurvivalWorld, x: number, z: number) {
	x = Math.max(0, Math.min(w.size - 0.00001, x));
	z = Math.max(0, Math.min(w.heights.length / w.grid - 1.00001, z));
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
interface RibbonVertex {
	x: number;
	z: number;
	side: number;
	r: number;
	g: number;
	b: number;
}
function clipRibbon(source: RibbonVertex[], value: (v: RibbonVertex) => number): RibbonVertex[] {
	const result: RibbonVertex[] = [];
	let previous = source[source.length - 1],
		pv = previous ? value(previous) : 0;
	for (const current of source) {
		const cv = value(current);
		if (cv >= 0 !== pv >= 0) {
			const t = pv / (pv - cv);
			result.push({
				x: previous.x + (current.x - previous.x) * t,
				z: previous.z + (current.z - previous.z) * t,
				side: previous.side + (current.side - previous.side) * t,
				r: previous.r + (current.r - previous.r) * t,
				g: previous.g + (current.g - previous.g) * t,
				b: previous.b + (current.b - previous.b) * t
			});
		}
		if (cv >= 0) result.push(current);
		previous = current;
		pv = cv;
	}
	return result;
}
/** Clip to both halves of each 1u terrain cell: every triangle interior stays exactly on its support. */
function conformRibbon(world: SurvivalWorld, p: number[], c: number[], field: number[], indices: number[]) {
	const positions: number[] = [],
		colors: number[] = [],
		trail: number[] = [],
		faces: number[] = [];
	for (let i = 0; i < indices.length; i += 3) {
		const source = indices.slice(i, i + 3).map((j) => ({
			x: p[j * 3],
			z: p[j * 3 + 2],
			side: field[j * 2],
			r: c[j * 3],
			g: c[j * 3 + 1],
			b: c[j * 3 + 2]
		}));
		const x0 = Math.max(0, Math.floor(Math.min(...source.map((v) => v.x)))),
			x1 = Math.min(world.size - 1, Math.floor(Math.max(...source.map((v) => v.x)))),
			z0 = Math.max(0, Math.floor(Math.min(...source.map((v) => v.z)))),
			z1 = Math.min(world.heights.length / world.grid - 2, Math.floor(Math.max(...source.map((v) => v.z))));
		for (let z = z0; z <= z1; z++)
			for (let x = x0; x <= x1; x++) {
				let cell = clipRibbon(source, (v) => v.x - x);
				cell = clipRibbon(cell, (v) => x + 1 - v.x);
				cell = clipRibbon(cell, (v) => v.z - z);
				cell = clipRibbon(cell, (v) => z + 1 - v.z);
				for (const side of [-1, 1]) {
					const polygon = clipRibbon(cell, (v) => side * (v.x + v.z - x - z - 1));
					for (let j = 1; j < polygon.length - 1; j++) {
						const a = polygon[0],
							b = polygon[j],
							d = polygon[j + 1];
						if (Math.abs((b.x - a.x) * (d.z - a.z) - (b.z - a.z) * (d.x - a.x)) < 1e-6) continue;
						const base = positions.length / 3;
						for (const v of [a, b, d]) {
							positions.push(v.x, terrainHeight(world, v.x, v.z) + 0.035, v.z);
							colors.push(v.r, v.g, v.b);
							trail.push(v.side, 1);
						}
						faces.push(base, base + 1, base + 2);
					}
				}
			}
	}
	return { positions, colors, trail, faces };
}
/** All trail strips in one draw; close-spaced edge samples retain a crisp silhouette on low. */
export function pathRibbon(world: SurvivalWorld, trails: readonly Trail[]) {
	const p: number[] = [],
		c: number[] = [],
		trailField: number[] = [],
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
			const n = Math.ceil(length / 1.5);
			for (let k = j === 1 ? 0 : 1; k <= n; k++) {
				const t = k / n,
					x = a[0] + dx * t,
					z = a[1] + dz * t,
					s = travel + length * t;
				const half = trail.halfWidth * (0.94 + 0.035 * Math.sin(s * 2.3) + 0.025 * Math.sin(s * 5.7));
				const center = 0.06 * Math.sin(s * 1.8),
					base = p.length / 3;
				for (const side of [-1, -0.82, 0.82, 1]) {
					const xx = x - (dz / length) * (side * half + center),
						zz = z + (dx / length) * (side * half + center);
					p.push(xx, terrainHeight(world, xx, zz) + 0.035, zz);
					const v = 0.97 + 0.03 * Math.sin(s * 0.8 + side);
					c.push(color.r * v, color.g * v, color.b * v);
					trailField.push(side, 1);
				}
				if (previous >= 0)
					for (let side = 0; side < 3; side++)
						ix.push(
							previous + side,
							previous + side + 1,
							base + side,
							previous + side + 1,
							base + side + 1,
							base + side
						);
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
	const conformed = conformRibbon(world, p, c, trailField, ix),
		g = new BufferGeometry();
	g.setAttribute('position', new Float32BufferAttribute(conformed.positions, 3));
	g.setAttribute('color', new Float32BufferAttribute(conformed.colors, 3));
	g.setAttribute('trail', new Float32BufferAttribute(conformed.trail, 2));
	g.setIndex(conformed.faces);
	g.computeVertexNormals();
	g.computeBoundingSphere();
	return g;
}
/** Small deterministic inward variation; the original obby colliders and deep-water checks stay intact. */
export function poolShoreScale(angle: number) {
	return 0.92 + 0.045 * Math.sin(angle * 3 + 0.4) + 0.025 * Math.sin(angle * 7 - 1.1);
}
