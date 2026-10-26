/**
 * The ground under the player's feet, for footsteps (c-audio.md §3.4), in this
 * order: shallow water, then the piece underfoot (obby stone, ledge, bridge
 * deck), then a trail, then the biome (forest floor, pasture and campo, sandy
 * restinga and beach). Called on foot contacts only, a few times a second; it
 * allocates nothing.
 */
import type { StoryLevel } from '../level/types.ts';
import { heightAt } from '../survival/terrain.ts';
import { FLAG, type SurvivalWorld, ZONE } from '../survival/types.ts';
import { riverSurfaceAt } from '../world-runtime/navigation.ts';
import type { Surface } from './bank.ts';

/** Feet this far above the terrain stand on something: a stone, a ledge, a deck. */
const ON_PIECE = 0.3;
/** Feet below the water surface plus this (5 cm) are wading. */
const WADE = 0.05;
/** Feet within this of an obby top stand on it. */
const PIECE_TOP = 0.35;

export type SurfaceSampler = (x: number, y: number, z: number) => Surface;

/** Without a map (the graybox fixture): its platforms are wood, its floor grass. */
export const fixtureSurface: SurfaceSampler = (_x, y) => (y > ON_PIECE ? 'wood' : 'grass');

export function createSurfaceSampler(
	world: SurvivalWorld,
	level?: Pick<StoryLevel, 'trails' | 'obbies' | 'pool'>
): SurfaceSampler {
	// Trail segments flattened once: [ax, az, bx, bz, halfWidth²] per segment.
	const segments: number[] = [];
	for (const trail of level?.trails ?? [])
		for (let k = 1; k < trail.points.length; k++) {
			const [ax, az] = trail.points[k - 1];
			const [bx, bz] = trail.points[k];
			segments.push(ax, az, bx, bz, trail.halfWidth * trail.halfWidth);
		}
	const trails = Float64Array.from(segments);
	const pieces = level?.obbies.flatMap((o) => o.pieces) ?? [];
	const { grid, size, zones, flags } = world;

	function onTrail(x: number, z: number) {
		for (let k = 0; k < trails.length; k += 5) {
			const ax = trails[k];
			const az = trails[k + 1];
			const dx = trails[k + 2] - ax;
			const dz = trails[k + 3] - az;
			const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1)));
			const ex = x - ax - t * dx;
			const ez = z - az - t * dz;
			if (ex * ex + ez * ez <= trails[k + 4]) return true;
		}
		return false;
	}

	return (x, y, z) => {
		const water = riverSurfaceAt(world, x, z, level?.pool);
		const ground = heightAt(world.heights, x, z);
		const cell = x >= 0 && z >= 0 && x <= size && z <= size ? Math.round(z) * grid + Math.round(x) : -1;
		const cellFlags = cell >= 0 ? flags[cell] : 0;
		if (y - ground > ON_PIECE) {
			for (const p of pieces) {
				const dx = x - p.x;
				const dz = z - p.z;
				if (dx * dx + dz * dz <= (p.radius + 0.3) ** 2 && Math.abs(y - p.y) <= PIECE_TOP)
					return p.piece === 'stone' || p.variant === 'rock' ? 'rock' : 'wood';
			}
			if (cellFlags & (FLAG.crossing | FLAG.base)) return 'wood';
			if (water === null || y > water + WADE) return 'rock';
		}
		if (water !== null && y < water + WADE) return 'water';
		if (onTrail(x, z) || cellFlags & FLAG.base) return 'soil';
		if (cellFlags & FLAG.forest) return 'leaves';
		const zone = cell >= 0 ? zones[cell] : ZONE.lowland;
		if (zone === ZONE.restinga || zone === ZONE.beach || zone === ZONE.mangrove || zone === ZONE.river)
			return 'soil';
		return 'grass';
	};
}
