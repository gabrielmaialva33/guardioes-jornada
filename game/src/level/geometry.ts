/**
 * Plane geometry on (x, z) for the story map builder: polygons, polylines and
 * distances, with exact arithmetic only (sqrt, no trigonometry), like
 * survival/random.ts requires.
 */
import { clamp } from '../survival/noise.ts';
import type { XZ } from './layout.ts';

/** Even-odd test of (x, z) against a closed polygon. */
export function insidePolygon(polygon: readonly XZ[], x: number, z: number): boolean {
	let inside = false;
	for (let a = 0, b = polygon.length - 1; a < polygon.length; b = a++) {
		const [xa, za] = polygon[a];
		const [xb, zb] = polygon[b];
		if (za > z !== zb > z && x < ((xb - xa) * (z - za)) / (zb - za) + xa) inside = !inside;
	}
	return inside;
}

/** Squared distance from (x, z) to the segment a–b, and the parameter t ∈ [0, 1] of the nearest point. */
export function segmentDistance2(ax: number, az: number, bx: number, bz: number, x: number, z: number) {
	const dx = bx - ax;
	const dz = bz - az;
	const len2 = dx * dx + dz * dz;
	const t = len2 > 0 ? clamp(((x - ax) * dx + (z - az) * dz) / len2, 0, 1) : 0;
	const ex = x - ax - t * dx;
	const ez = z - az - t * dz;
	return { d2: ex * ex + ez * ez, t };
}

/** Distance from (x, z) to a polygon's boundary. */
export function polygonEdgeDistance(polygon: readonly XZ[], x: number, z: number): number {
	let best = Number.POSITIVE_INFINITY;
	for (let a = 0, b = polygon.length - 1; a < polygon.length; b = a++) {
		const { d2 } = segmentDistance2(polygon[b][0], polygon[b][1], polygon[a][0], polygon[a][1], x, z);
		if (d2 < best) best = d2;
	}
	return Math.sqrt(best);
}

/** Distance from (x, z) to an open polyline. */
export function polylineDistance(points: readonly XZ[], x: number, z: number): number {
	return Math.sqrt(polylineNearest(points, x, z).d2);
}

/** Nearest point of an open polyline: squared distance and the arc length at that point. */
export function polylineNearest(points: readonly XZ[], x: number, z: number) {
	let best = Number.POSITIVE_INFINITY;
	let arc = 0;
	let walked = 0;
	for (let k = 0; k + 1 < points.length; k++) {
		const [ax, az] = points[k];
		const [bx, bz] = points[k + 1];
		const len = distance(ax, az, bx, bz);
		const { d2, t } = segmentDistance2(ax, az, bx, bz, x, z);
		if (d2 < best) {
			best = d2;
			arc = walked + t * len;
		}
		walked += len;
	}
	return { d2: best, arc };
}

export function distance(ax: number, az: number, bx: number, bz: number): number {
	const dx = bx - ax;
	const dz = bz - az;
	return Math.sqrt(dx * dx + dz * dz);
}

/** Arc length of a polyline up to each point. */
export function arcLengths(points: readonly XZ[]): number[] {
	const out = [0];
	for (let k = 1; k < points.length; k++)
		out.push(out[k - 1] + distance(points[k - 1][0], points[k - 1][1], points[k][0], points[k][1]));
	return out;
}

/** Unit vector from a to b. */
export function direction(ax: number, az: number, bx: number, bz: number): [number, number] {
	const len = distance(ax, az, bx, bz);
	return [(bx - ax) / len, (bz - az) / len];
}

/** Heading (yawC, yawS) whose front, (yawS, yawC), points from (x0, z0) to (x1, z1). */
export function headingTo(x0: number, z0: number, x1: number, z1: number): [number, number] {
	const len = distance(x0, z0, x1, z1);
	return len > 0 ? [(z1 - z0) / len, (x1 - x0) / len] : [1, 0];
}
