/**
 * Relief of the survival map (research §3.2, steps 1–3): a sea → coastal plain
 * → serra ramp with value-noise hills and a ridge on the serra side, a river
 * carved from the serra down to the sea, then slope and zones by gradient
 * (not Voronoi). The campo de altitude is the 95% height quantile, so it exists
 * on every seed; an absolute threshold lost it on most seeds (research §3.2).
 */
import { clamp, fbm, floor, smoothstep, valueNoise } from './noise.ts';
import { Rng, subSeed } from './random.ts';
import { GRID, type River, type RiverPoint, WATER_LEVEL, WORLD_SIZE, ZONE } from './types.ts';

const N = GRID;

/** River cross-section: a flat bed, then banks rising at BANK_SLOPE (walkable) until they meet the ground. */
const BED_HALF_WIDTH = 2;
const RIVER_DEPTH = 1.4;
const BANK_SLOPE = 0.6;
const RIVER_HALF_WIDTH = BED_HALF_WIDTH + RIVER_DEPTH / BANK_SLOPE;
/** Far enough for the banks to climb out of the deepest serra valley. */
const RIVER_REACH = 40;

/** Large-scale profile across the map, u = x / WORLD_SIZE (the research prototype's ramp). */
export function ramp(u: number): number {
	return -3 + 3.8 * smoothstep(0, 0.1, u) + 18 * smoothstep(0.35, 1, u);
}

export interface Relief {
	heights: Float32Array;
	/** Distance to the river centre line, capped at RIVER_REACH. */
	riverDist: Float32Array;
	/** River surface height at the nearest centre-line point. */
	riverWater: Float32Array;
	river: River;
}

/** Ground heights with the river carved in. */
export function shapeRelief(seed: number): Relief {
	const heights = new Float32Array(N * N);
	const hillSeed = subSeed(seed, 1);
	const ridgeSeed = subSeed(seed, 2);
	for (let j = 0; j < N; j++)
		for (let i = 0; i < N; i++) {
			const u = i / WORLD_SIZE;
			const hills = fbm(i * 0.02, j * 0.02, hillSeed, 4) * (0.4 + 6 * smoothstep(0.25, 1, u));
			const ridge = (1 - Math.abs(valueNoise(i * 0.012, j * 0.012, ridgeSeed))) * 4 * smoothstep(0.6, 1, u);
			heights[j * N + i] = ramp(u) + hills + ridge;
		}

	// Nine control points from the serra (x = 160) to the sea (x = 0), z drifting.
	// The surface follows the ramp down, lower than the ground, and meets the sea at the mouth.
	const rng = new Rng(subSeed(seed, 3));
	const points: RiverPoint[] = [];
	let z = WORLD_SIZE * (0.3 + 0.4 * rng.next());
	for (let k = 0; k <= 8; k++) {
		const x = WORLD_SIZE * (1 - k / 8);
		points.push({ x, z, water: WATER_LEVEL + 0.45 * Math.max(0, ramp(x / WORLD_SIZE) - 0.8) });
		z = clamp(z + (rng.next() - 0.5) * WORLD_SIZE * 0.12, WORLD_SIZE * 0.15, WORLD_SIZE * 0.85);
	}

	// Distance field to the polyline (squared, no hypot), with the surface height of the nearest point.
	const reach2 = RIVER_REACH * RIVER_REACH;
	const dist2 = new Float32Array(N * N).fill(reach2);
	const riverWater = new Float32Array(N * N).fill(WATER_LEVEL);
	for (let k = 0; k < 8; k++) {
		const a = points[k];
		const b = points[k + 1];
		const dx = b.x - a.x;
		const dz = b.z - a.z;
		const len2 = dx * dx + dz * dz;
		const i0 = Math.max(0, floor(Math.min(a.x, b.x) - RIVER_REACH));
		const i1 = Math.min(N - 1, floor(Math.max(a.x, b.x) + RIVER_REACH) + 1);
		const j0 = Math.max(0, floor(Math.min(a.z, b.z) - RIVER_REACH));
		const j1 = Math.min(N - 1, floor(Math.max(a.z, b.z) + RIVER_REACH) + 1);
		for (let j = j0; j <= j1; j++)
			for (let i = i0; i <= i1; i++) {
				const px = i - a.x;
				const pz = j - a.z;
				const t = clamp((px * dx + pz * dz) / len2, 0, 1);
				const ex = px - t * dx;
				const ez = pz - t * dz;
				const e2 = ex * ex + ez * ez;
				const q = j * N + i;
				if (e2 < dist2[q]) {
					dist2[q] = e2;
					riverWater[q] = a.water + (b.water - a.water) * t;
				}
			}
	}

	// Carve: the ground never rises above a bank surface climbing from the bed at BANK_SLOPE,
	// with a little noise so valley walls are not planes (still under WALK_SLOPE).
	const riverDist = new Float32Array(N * N);
	const bankSeed = subSeed(seed, 13);
	for (let q = 0; q < N * N; q++) {
		const d = Math.sqrt(dist2[q]);
		riverDist[q] = d;
		if (d >= RIVER_REACH) continue;
		const i = q % N;
		const j = (q - i) / N;
		const wobble =
			0.5 * valueNoise(i * 0.1, j * 0.1, bankSeed) * smoothstep(RIVER_HALF_WIDTH, RIVER_HALF_WIDTH + 4, d);
		const bank = riverWater[q] - RIVER_DEPTH + BANK_SLOPE * Math.max(0, d - BED_HALF_WIDTH) + wobble;
		if (bank < heights[q]) heights[q] = bank;
	}
	return {
		heights,
		riverDist,
		riverWater,
		river: { points, halfWidth: RIVER_HALF_WIDTH, depth: RIVER_DEPTH }
	};
}

/** Lowers or raises a disk to height y, blending back to the ground between r0 and r1. */
export function flatten(heights: Float32Array, cx: number, cz: number, y: number, r0: number, r1: number) {
	for (let j = Math.max(0, cz - r1); j <= Math.min(N - 1, cz + r1); j++)
		for (let i = Math.max(0, cx - r1); i <= Math.min(N - 1, cx + r1); i++) {
			const d = Math.sqrt((i - cx) * (i - cx) + (j - cz) * (j - cz));
			if (d >= r1) continue;
			const q = j * N + i;
			heights[q] = y + (heights[q] - y) * smoothstep(r0, r1, d);
		}
}

/** Rise per unit at each cell, from central differences. */
export function slopes(heights: Float32Array): Float32Array {
	const slope = new Float32Array(N * N);
	for (let j = 0; j < N; j++)
		for (let i = 0; i < N; i++) {
			const hx = heights[j * N + Math.min(N - 1, i + 1)] - heights[j * N + Math.max(0, i - 1)];
			const hz = heights[Math.min(N - 1, j + 1) * N + i] - heights[Math.max(0, j - 1) * N + i];
			slope[j * N + i] = Math.sqrt(hx * hx + hz * hz) / 2;
		}
	return slope;
}

/** Zones by gradient across the map, plus the campo de altitude threshold. */
export function classify(relief: Relief, slope: Float32Array) {
	const { heights, riverDist, river } = relief;
	const sorted = Float32Array.from(heights).sort();
	const highlandHeight = sorted[floor(sorted.length * 0.95)];
	const zones = new Uint8Array(N * N);
	for (let j = 0; j < N; j++)
		for (let i = 0; i < N; i++) {
			const q = j * N + i;
			const h = heights[q];
			const u = i / WORLD_SIZE;
			const d = riverDist[q];
			let zone: number;
			if (d < river.halfWidth && h < relief.riverWater[q]) zone = ZONE.river;
			else if (h < WATER_LEVEL) zone = ZONE.sea;
			else if (u < 0.3 && d < 14 && h < 1.6) zone = ZONE.mangrove;
			else if (u < 0.1) zone = ZONE.beach;
			else if (u < 0.3) zone = ZONE.restinga;
			else if (h >= highlandHeight) zone = ZONE.highland;
			else if ((slope[q] > 0.45 && u > 0.4) || u > 0.66) zone = ZONE.slope;
			else zone = ZONE.lowland;
			zones[q] = zone;
		}
	return { zones, highlandHeight };
}

/** Bilinear ground height at (x, z), clamped to the map: the survival twin of the POC's terrainHeight. */
export function heightAt(heights: Float32Array, x: number, z: number): number {
	const cx = clamp(x, 0, WORLD_SIZE);
	const cz = clamp(z, 0, WORLD_SIZE);
	const i = Math.min(N - 2, floor(cx));
	const j = Math.min(N - 2, floor(cz));
	const tx = cx - i;
	const tz = cz - j;
	const q = j * N + i;
	const a = heights[q];
	const b = heights[q + 1];
	const c = heights[q + N];
	const d = heights[q + N + 1];
	return (a + (b - a) * tx) * (1 - tz) + (c + (d - c) * tx) * tz;
}
