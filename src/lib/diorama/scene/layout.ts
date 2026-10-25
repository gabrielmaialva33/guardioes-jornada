/**
 * The diorama's composition in one place, mirroring the SVG landscape: the
 * spring and river on the left, the trail coming in from the front right,
 * the araucária right of centre, mountains along the back rim.
 *
 * Units: the floating island is an ellipse 2·RX wide and 2·RZ deep, top at
 * y ≈ 0, +z towards the camera.
 */
import { clamp, smoothstep, type V3 } from './builder.ts';

export const RX = 4.4;
export const RZ = 2.3;

/** 0 at the centre, 1 on the rim. */
export function rimDistance(x: number, z: number) {
	return Math.hypot(x / RX, z / RZ);
}

/** Max |z| inside the island at a given x. */
export function rimZ(x: number) {
	return RZ * Math.sqrt(Math.max(0, 1 - (x / RX) ** 2));
}

export const SPRING: V3 = [-3.05, 0, -1.0];

/** River control points in (x, z), from the spring to the front rim. */
export const RIVER: [number, number][] = [
	[-3.05, -1.0],
	[-2.55, -0.55],
	[-2.05, -0.05],
	[-1.45, 0.35],
	[-1.1, 0.95],
	[-0.95, 1.55],
	[-0.86, 2.3]
];

/** Trail control points in (x, z), from the front right rim to the clearing. */
export const TRAIL: [number, number][] = [
	[2.75, 1.78],
	[2.3, 1.35],
	[1.75, 1.15],
	[1.35, 0.75],
	[0.95, 0.45],
	[0.45, 0.2]
];

/** Centre of the clearing with flowers (stage 0). */
export const CLEARING: [number, number] = [0.1, 0.75];

export const ARAUCARIA: V3 = [1.2, 0, -0.45];

/** Young araucárias that come with the big one, deeper in the forest. [x, z, height] */
export const YOUNG_ARAUCARIAS: [number, number, number][] = [
	[2.75, -1.0, 1.25],
	[-1.55, -1.2, 1.05]
];

/** Stage 1: the first trees, as in the SVG (cedro, canela, canela, cedro). */
export const FIRST_TREES: { kind: 'canela' | 'cedro'; x: number; z: number; s: number }[] = [
	{ kind: 'cedro', x: -2.55, z: 0.75, s: 0.95 },
	{ kind: 'canela', x: -1.95, z: 1.45, s: 1.0 },
	{ kind: 'canela', x: 2.35, z: 0.45, s: 0.9 },
	{ kind: 'cedro', x: 3.25, z: 0.95, s: 1.05 },
	{ kind: 'cedro', x: -0.35, z: -0.35, s: 0.8 }
];

/** Stage 4: Serra de Paranapiacaba, along the back rim. [x, height, width] */
export const PEAKS: [number, number, number][] = [
	[-3.45, 1.35, 0.95],
	[-2.45, 2.05, 1.15],
	[-1.3, 1.65, 1.05],
	[-0.2, 2.35, 1.25],
	[0.95, 1.75, 1.05],
	[2.05, 2.15, 1.15],
	[3.2, 1.45, 0.95]
];

/** Distance from (x, z) to a polyline given as control points. */
export function distanceToPath(path: [number, number][], x: number, z: number) {
	let best = Infinity;
	for (let i = 0; i < path.length - 1; i++) {
		const [ax, az] = path[i];
		const [bx, bz] = path[i + 1];
		const dx = bx - ax;
		const dz = bz - az;
		const t = clamp(((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz));
		best = Math.min(best, Math.hypot(x - (ax + dx * t), z - (az + dz * t)));
	}
	return best;
}

/** Ground height of the island top. */
export function heightAt(x: number, z: number) {
	const nz = z / RZ;
	let h =
		0.09 * Math.sin(x * 1.05 + 0.6) * Math.cos(z * 1.5 - 0.4) + 0.05 * Math.sin(x * 2.2 - z * 1.7 + 1.3);
	// The land rises towards the mountains at the back.
	h += 0.22 * smoothstep(-0.1, -0.95, nz);
	// A flat, open clearing in front.
	const clearing = 1 - smoothstep(0.7, 1.6, Math.hypot(x - CLEARING[0], (z - CLEARING[1]) * 1.3));
	h = h * (1 - clearing) + 0.02 * clearing;
	// A shallow channel for the river (dry until stage 2 brings the water).
	h -= 0.05 * (1 - smoothstep(0.08, 0.32, distanceToPath(RIVER, x, z)));
	// Round the rim down.
	const r = rimDistance(x, z);
	h = h * (1 - smoothstep(0.82, 1.0, r)) - 0.04 * smoothstep(0.9, 1.0, r);
	return h;
}

/** True if a forest tree may stand at (x, z). */
export function freeForTree(x: number, z: number, margin = 0) {
	if (rimDistance(x, z) > 0.9 - margin) return false;
	if (distanceToPath(RIVER, x, z) < 0.42 + margin) return false;
	if (distanceToPath(TRAIL, x, z) < 0.32 + margin) return false;
	if (Math.hypot(x - ARAUCARIA[0], z - ARAUCARIA[2]) < 0.7 + margin) return false;
	if (Math.hypot(x - SPRING[0], z - SPRING[2]) < 0.5 + margin) return false;
	for (const [yx, yz] of YOUNG_ARAUCARIAS) if (Math.hypot(x - yx, z - yz) < 0.42 + margin) return false;
	for (const t of FIRST_TREES) if (Math.hypot(x - t.x, z - t.z) < 0.5 + margin) return false;
	return true;
}
