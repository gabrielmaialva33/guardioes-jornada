/** Deterministic, render-only planting. No source asset metadata or collision writes. */
import { polylineDistance } from '../level/geometry.ts';
import type { StoryLevel } from '../level/types.ts';
import { CROWNS } from '../life/homes.ts';
import type { Quality } from '../render/quality.ts';
import { mix32 } from '../survival/random.ts';
import { FLAG, type SurvivalWorld, ZONE } from '../survival/types.ts';

export type VegetationRole =
	| 'groundcover'
	| 'understorey'
	| 'flowers'
	| 'liana'
	| 'tree'
	| 'log'
	| 'rock-ivy'
	| 'litter';
export interface VegetationPlacement {
	role: VegetationRole;
	x: number;
	y: number;
	z: number;
	height: number;
	yaw: number;
	/** Stable density rank, 0..1; smaller ranks survive lower quality. */
	rank: number;
	variant: number;
	/** Native tree pool replaced at this same trunk location. */
	replaces?: string;
}
export interface VegetationPlan {
	placements: VegetationPlacement[];
	/** Approximate usable planting area, u², sampled on the planting grid. */
	eligibleArea: number;
}
export const VEGETATION_QUALITY = {
	low: { density: 0.28, near: 12, far: 25, tallFar: 55, atlas: 64 },
	medium: { density: 0.6, near: 20, far: 42, tallFar: 80, atlas: 96 },
	high: { density: 1, near: 28, far: 58, tallFar: 110, atlas: 128 }
} as const;
const BLOCKED = FLAG.river | FLAG.crossing | FLAG.base | FLAG.corridor;
const SPACING = 3;
const LIMIT = 2200;
const unit = (n: number) => mix32(n) / 0x1_0000_0000;
const gap = (x: number, z: number, p: { x: number; z: number }, r: number) =>
	Math.hypot(p.x - x, p.z - z) <= r;

/** Reserve gameplay approaches as well as the actual support/trigger point. */
export function vegetationClearance(
	world: SurvivalWorld,
	level: StoryLevel | undefined,
	x: number,
	z: number,
	radius: number
): boolean {
	if (x < 2 + radius || z < 2 + radius || x > world.size - 2 - radius || z > world.size - 2 - radius)
		return false;
	if (gap(x, z, world.base, world.base.radius + radius + 1)) return false;
	for (const crossing of world.crossings)
		if (
			polylineDistance(
				[
					[crossing.from.x, crossing.from.z],
					[crossing.to.x, crossing.to.z]
				],
				x,
				z
			) <=
			crossing.halfWidth + radius + 1.5
		)
			return false;
	for (const p of [...world.pois, ...world.threats, ...world.resources])
		if (gap(x, z, p, 2.5 + radius)) return false;
	if (!level) return true;
	for (const trail of level.trails) {
		if (
			trail.points.length === 1 &&
			gap(x, z, { x: trail.points[0][0], z: trail.points[0][1] }, trail.halfWidth + radius + 1.25)
		)
			return false;
		if (polylineDistance(trail.points, x, z) <= trail.halfWidth + radius + 1.25) return false;
	}
	for (const p of [
		...level.collectibles,
		...level.planting,
		...level.checkpoints.map((c) => c.spawn),
		...level.missions.map((m) => m.target)
	])
		if (gap(x, z, p, 2.5 + radius)) return false;
	for (const obby of level.obbies) {
		if (gap(x, z, obby.takeoff, 3 + radius) || gap(x, z, obby.landing, 3 + radius)) return false;
		for (const p of obby.pieces) if (gap(x, z, p, p.radius + radius + 1.5)) return false;
	}
	const pool = level.pool;
	const dx = x - pool.x,
		dz = z - pool.z;
	const along = dx * pool.axisX + dz * pool.axisZ,
		across = -dx * pool.axisZ + dz * pool.axisX;
	return (along / (pool.halfLength + radius + 1)) ** 2 + (across / (pool.halfWidth + radius + 1)) ** 2 > 1;
}

function suitable(world: SurvivalWorld, x: number, z: number): boolean {
	const i = Math.round(x),
		j = Math.round(z),
		n = world.grid,
		k = j * n + i;
	if (i < 1 || j < 1 || i >= n - 1 || j >= n - 1) return false;
	const f = world.flags[k],
		zone = world.zones[k],
		y = world.heights[k];
	if (
		!(f & FLAG.walkable) ||
		!(f & FLAG.forest) ||
		f & BLOCKED ||
		zone === ZONE.highland ||
		zone === ZONE.beach ||
		zone === ZONE.sea ||
		y <= world.waterLevel + 0.2
	)
		return false;
	return [k - 1, k + 1, k - n, k + n].every((q) => Math.abs(world.heights[q] - y) <= 0.6);
}

function groundY(world: SurvivalWorld, x: number, z: number) {
	const i = Math.floor(x),
		j = Math.floor(z),
		tx = x - i,
		tz = z - j,
		k = j * world.grid + i,
		h = world.heights;
	return (
		(h[k] * (1 - tx) + h[k + 1] * tx) * (1 - tz) +
		(h[k + world.grid] * (1 - tx) + h[k + world.grid + 1] * tx) * tz
	);
}

/** Same plan at every quality: changing quality only thins a stable subset. */
export function planStudyVegetation(world: SurvivalWorld, level?: StoryLevel): VegetationPlan {
	const placements: VegetationPlacement[] = [];
	let eligibleArea = 0;
	for (let z = SPACING; z < world.size - SPACING; z += SPACING)
		for (let x = SPACING; x < world.size - SPACING; x += SPACING) {
			const seed = mix32(world.worldSeed ^ Math.imul(x, 73856093) ^ Math.imul(z, 19349663));
			const px = x + (unit(seed + 1) - 0.5) * 1.2,
				pz = z + (unit(seed + 2) - 0.5) * 1.2;
			if (!suitable(world, px, pz) || !vegetationClearance(world, level, px, pz, 0.8)) continue;
			// Keep a clear trunk collar; dense foliage starts outside the support footprint.
			let trunk = false;
			for (let i = 0; i < world.trees.count; i++)
				if (Math.hypot(px - world.trees.x[i], pz - world.trees.z[i]) < 1.4) {
					trunk = true;
					break;
				}
			if (trunk) continue;
			eligibleArea += SPACING * SPACING;
			if (placements.length >= LIMIT) continue;
			const roll = unit(seed + 3);
			const role: VegetationRole =
				roll < 0.58 ? 'groundcover' : roll < 0.86 ? 'understorey' : roll < 0.95 ? 'flowers' : 'litter';
			const height =
				role === 'groundcover'
					? 0.25 + unit(seed + 4) * 0.55
					: role === 'understorey'
						? 1.2 + unit(seed + 4) * 2.2
						: role === 'flowers'
							? 0.6 + unit(seed + 4) * 0.8
							: 0.08 + unit(seed + 4) * 0.08;
			placements.push({
				role,
				x: px,
				y: groundY(world, px, pz) - 0.015,
				z: pz,
				height,
				yaw: unit(seed + 5) * Math.PI * 2,
				rank: unit(seed + 6),
				variant: mix32(seed + 7)
			});
		}
	for (let i = 0; i < world.trees.count; i++) {
		const x = world.trees.x[i],
			z = world.trees.z[i],
			kind = world.trees.kinds[world.trees.kind[i]],
			scale = world.trees.scale[i];
		const seed = mix32(world.worldSeed ^ Math.imul(i + 1, 83492791));
		// Keep the native palms, blossom trees, tree ferns and araucárias recognizable.
		if (
			(kind === 'jequitiba' || kind === 'pau-brasil') &&
			world.heights[Math.round(z) * world.grid + Math.round(x)] > world.waterLevel + 0.2 &&
			!(world.flags[Math.round(z) * world.grid + Math.round(x)] & FLAG.river)
		)
			placements.push({
				role: 'tree',
				x,
				y: world.trees.y[i],
				z,
				height: CROWNS[kind].top * scale,
				yaw: Math.atan2(world.trees.yawS[i], world.trees.yawC[i]),
				rank: 0,
				variant: seed,
				replaces: `tree:${kind}`
			});
		if (!suitable(world, x, z)) continue;
		if (unit(seed + 1) > 0.35 || !vegetationClearance(world, level, x + 0.9, z, 0.8)) continue;
		const height = 2.2 + unit(seed + 2) * 1.8,
			anchor = CROWNS[kind].base * scale;
		if (anchor - height < 3.2) continue;
		placements.push({
			role: 'liana',
			x: x + 0.9,
			y: world.trees.y[i] + anchor - height,
			z,
			height,
			yaw: unit(seed + 3) * Math.PI * 2,
			rank: unit(seed + 4),
			variant: seed
		});
	}
	for (let i = 0; i < world.rocks.count; i++) {
		const kind = world.rocks.kinds[world.rocks.kind[i]],
			x = world.rocks.x[i],
			z = world.rocks.z[i],
			seed = mix32(world.worldSeed ^ Math.imul(i + 1, 49979687));
		const k = Math.round(z) * world.grid + Math.round(x);
		if (world.heights[k] <= world.waterLevel + 0.2 || world.flags[k] & FLAG.river) continue;
		if (kind === 'log')
			placements.push({
				role: 'log',
				x,
				y: world.rocks.y[i],
				z,
				height: 0.6 * world.rocks.scale[i],
				yaw: Math.atan2(world.rocks.yawS[i], world.rocks.yawC[i]),
				rank: 0,
				variant: seed,
				replaces: 'rock:log'
			});
		else if (kind === 'boulder' && suitable(world, x, z) && vegetationClearance(world, level, x, z, 0.8))
			placements.push({
				role: 'rock-ivy',
				x,
				y: world.rocks.y[i] + 0.05,
				z,
				height: 0.8 * world.rocks.scale[i],
				yaw: unit(seed) * Math.PI * 2,
				rank: unit(seed + 1),
				variant: seed
			});
	}
	return { placements, eligibleArea };
}

export function vegetationVisible(placement: VegetationPlacement, quality: Quality): boolean {
	return placement.replaces !== undefined || placement.rank < VEGETATION_QUALITY[quality].density;
}
