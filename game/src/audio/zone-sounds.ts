/**
 * The bed of each park zone (soundscape v2, P35), read from the zone's own
 * world and level so it follows the zone's data (PARK.md §4–§7), in the zone's
 * local coordinates (the same frame as its world and level):
 *
 * - Reserva: the default soundscape (the forest bed, the river, the waterfall).
 * - Vale: the default, plus the waterfall's far roar at the same landmark, heard
 *   from across the valley and growing as the player climbs to it; the near
 *   roar and the stream are the default's waterfall and river.
 * - Copa: the forest bed, plus the canopy birds, louder the higher the
 *   listener is over the ground (the suspended walkway).
 * - Praia: surf on the costão and surf on the sand, each at the nearest point of
 *   its stretch of waterline; the forest bed at half, from the restinga.
 * - Manguezal: water lapping in the flooded mangrove everywhere and the mud's
 *   clicks at the nearest crab bank; no forest bed, and no river (its river is
 *   the estuary under the flood, not a stream). The colhereiros' dusk has no
 *   sound yet: no CC0/CC BY recording of the species was found (P35 report).
 *
 * Levels follow the P15 measurements (p15-estudo-audio.md §7): beds near −31 LUFS
 * after the bank gain, textures at bed level.
 */
import type { ManguezalContent } from '../level/zones/manguezal.ts';
import type { ZoneId } from '../level/zones/spec.ts';
import type { ZoneLevel } from '../level/zones/zone.ts';
import type { SurvivalWorld } from '../survival/types.ts';
import type { SoundId } from './bank.ts';

/** A loop at a fixed point. */
export interface FixedEmitter {
	id: SoundId;
	x: number;
	y: number;
	z: number;
}

/** A loop whose emitter sits on the point of `points` (x, y, z triples) nearest the listener. */
export interface FollowEmitter {
	id: SoundId;
	points: Float32Array;
}

export interface ZoneSounds {
	/** The day forest bed's gain over its bank gain; 0 leaves it off. */
	forest: number;
	/** Whether the river emitter plays. */
	river: boolean;
	/** Beds that play everywhere in the zone, not placed. */
	beds: SoundId[];
	fixed: FixedEmitter[];
	follow: FollowEmitter[];
	/** A bed whose gain rises with the listener's height over the ground: `low` near it, 1 from `rise` u above `above`. */
	canopy: { id: SoundId; low: number; above: number; rise: number } | null;
}

/** The default soundscape: what a map without a zone (the Reserva, the graybox) plays. */
export const DEFAULT_SOUNDS: ZoneSounds = {
	forest: 1,
	river: true,
	beds: [],
	fixed: [],
	follow: [],
	canopy: null
};

/** A waterline point is on the costão when ground this far over the water stands within ROCK_REACH u. */
const ROCK_RISE = 1.7;
const ROCK_REACH = 4;

export function zoneSounds(zone: ZoneId, world: SurvivalWorld, level?: ZoneLevel): ZoneSounds {
	switch (zone) {
		case 'vale': {
			const fall = level?.landmarks.find((l) => l.kind === 'waterfall');
			return {
				...DEFAULT_SOUNDS,
				fixed: fall ? [{ id: 'waterfall-far', x: fall.x, y: fall.y, z: fall.z }] : []
			};
		}
		case 'copa':
			// The listener is the camera, about 3 u over the avatar's feet; the walkway is about 8 u up.
			return {
				...DEFAULT_SOUNDS,
				river: false,
				canopy: { id: 'canopy-birds', low: 0.35, above: 3, rise: 6 }
			};
		case 'praia': {
			const { rocks, sand } = waterline(world);
			const follow: FollowEmitter[] = [
				{ id: 'surf-rocks', points: rocks },
				{ id: 'surf-beach', points: sand }
			];
			return {
				...DEFAULT_SOUNDS,
				forest: 0.5,
				river: false,
				follow: follow.filter((f) => f.points.length > 0)
			};
		}
		case 'manguezal': {
			const content = level?.content as Partial<ManguezalContent> | undefined;
			const crabs = content?.crabs ?? [];
			return {
				...DEFAULT_SOUNDS,
				forest: 0,
				river: false,
				beds: ['mangrove-water'],
				follow: crabs.length
					? [{ id: 'mangrove-clicks', points: Float32Array.from(crabs.flatMap((c) => [c.x, c.y, c.z])) }]
					: []
			};
		}
		default:
			return DEFAULT_SOUNDS;
	}
}

/**
 * The zone's waterline: dry grid cells with a wet neighbour, at the water's
 * level, split into the costão's (high ground near) and the beach's.
 */
export function waterline(world: SurvivalWorld): { rocks: Float32Array; sand: Float32Array } {
	const { grid, heights, waterLevel } = world;
	const rows = Math.floor(heights.length / grid);
	const rocks: number[] = [];
	const sand: number[] = [];
	const wet = (q: number) => heights[q] <= waterLevel;
	for (let j = 1; j < rows - 1; j++)
		for (let i = 1; i < grid - 1; i++) {
			const q = j * grid + i;
			if (wet(q) || !(wet(q - 1) || wet(q + 1) || wet(q - grid) || wet(q + grid))) continue;
			let high = false;
			for (let dj = -ROCK_REACH; dj <= ROCK_REACH && !high; dj++)
				for (let di = -ROCK_REACH; di <= ROCK_REACH; di++) {
					const jj = j + dj;
					const ii = i + di;
					if (jj < 0 || ii < 0 || jj >= rows || ii >= grid) continue;
					if (heights[jj * grid + ii] > waterLevel + ROCK_RISE) {
						high = true;
						break;
					}
				}
			(high ? rocks : sand).push(i, waterLevel, j);
		}
	return { rocks: Float32Array.from(rocks), sand: Float32Array.from(sand) };
}

/** Bilinear ground height at (x, z) on the world's own grid (a zone may be wider than the Reserva). */
export function groundAt(world: SurvivalWorld, x: number, z: number): number {
	const { grid, heights } = world;
	const rows = Math.floor(heights.length / grid);
	const cx = Math.max(0, Math.min(grid - 1, x));
	const cz = Math.max(0, Math.min(rows - 1, z));
	const i = Math.min(grid - 2, Math.floor(cx));
	const j = Math.min(rows - 2, Math.floor(cz));
	const tx = cx - i;
	const tz = cz - j;
	const q = j * grid + i;
	const a = heights[q];
	const b = heights[q + 1];
	const c = heights[q + grid];
	const d = heights[q + grid + 1];
	return (a + (b - a) * tx) * (1 - tz) + (c + (d - c) * tx) * tz;
}

/** The point of `points` (x, y, z triples) nearest (x, z), written to `out`; false when there is none. */
export function nearestPoint(
	points: Float32Array,
	x: number,
	z: number,
	out: { x: number; y: number; z: number }
): boolean {
	let best = Number.POSITIVE_INFINITY;
	for (let k = 0; k < points.length; k += 3) {
		const dx = points[k] - x;
		const dz = points[k + 2] - z;
		const d = dx * dx + dz * dz;
		if (d < best) {
			best = d;
			out.x = points[k];
			out.y = points[k + 1];
			out.z = points[k + 2];
		}
	}
	return best < Number.POSITIVE_INFINITY;
}
