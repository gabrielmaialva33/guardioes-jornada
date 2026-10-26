/**
 * The hand-made park as world-gen sees it (game/PARK.md §2, level/zones/spec.ts):
 * which chunks are hand-made, how far a point is from the park, and the
 * park's outer boundary: the zone edges that face the generated world, where
 * park-stitch.ts blends the generated ground into the zones.
 */
import { PARK_ZONES, type Side, ZONE_IDS, type ZoneId, zoneOfChunk } from '../level/zones/spec.ts';
import { CHUNK_SIZE } from './constants.ts';

export { zoneOfChunk };

/** One straight piece of the park's outer boundary: a zone's `side`, at x or z `at`, from `from` to `to`. */
export interface ParkEdge {
	zone: ZoneId;
	side: Side;
	at: number;
	from: number;
	to: number;
}

/** Distance from (x, z) to the park (0 inside any zone, or on its boundary). */
export function parkDistance(x: number, z: number): number {
	let best = Number.POSITIVE_INFINITY;
	for (const id of ZONE_IDS) {
		const r = PARK_ZONES[id];
		const dx = x < r.x0 ? r.x0 - x : x > r.x1 ? x - r.x1 : 0;
		const dz = z < r.z0 ? r.z0 - z : z > r.z1 ? z - r.z1 : 0;
		best = Math.min(best, Math.sqrt(dx * dx + dz * dz));
	}
	return best;
}

/**
 * The park's outer boundary, from the zones' chunk rectangles: every chunk
 * side with no zone chunk across it, merged into straight edges per zone and
 * side, in ZONE_IDS order, then west, east, north, south, then position.
 */
export const PARK_BOUNDARY: readonly ParkEdge[] = (() => {
	const units: ParkEdge[] = [];
	for (const id of ZONE_IDS) {
		const r = PARK_ZONES[id];
		for (let cz = r.cz0; cz <= r.cz1; cz++)
			for (let cx = r.cx0; cx <= r.cx1; cx++) {
				const x0 = cx * CHUNK_SIZE;
				const z0 = cz * CHUNK_SIZE;
				if (zoneOfChunk(cx - 1, cz) === null)
					units.push({ zone: id, side: 'west', at: x0, from: z0, to: z0 + CHUNK_SIZE });
				if (zoneOfChunk(cx + 1, cz) === null)
					units.push({ zone: id, side: 'east', at: x0 + CHUNK_SIZE, from: z0, to: z0 + CHUNK_SIZE });
				if (zoneOfChunk(cx, cz - 1) === null)
					units.push({ zone: id, side: 'north', at: z0, from: x0, to: x0 + CHUNK_SIZE });
				if (zoneOfChunk(cx, cz + 1) === null)
					units.push({ zone: id, side: 'south', at: z0 + CHUNK_SIZE, from: x0, to: x0 + CHUNK_SIZE });
			}
	}
	const order: Side[] = ['west', 'east', 'north', 'south'];
	units.sort(
		(a, b) =>
			ZONE_IDS.indexOf(a.zone) - ZONE_IDS.indexOf(b.zone) ||
			order.indexOf(a.side) - order.indexOf(b.side) ||
			a.at - b.at ||
			a.from - b.from
	);
	const merged: ParkEdge[] = [];
	for (const u of units) {
		const last = merged[merged.length - 1];
		if (last && last.zone === u.zone && last.side === u.side && last.at === u.at && last.to === u.from)
			last.to = u.to;
		else merged.push({ ...u });
	}
	return merged;
})();

/** Whether a rectangle (grown by `reach`) can touch the park or its stitch band. */
export function nearPark(x0: number, z0: number, x1: number, z1: number, reach: number): boolean {
	for (const id of ZONE_IDS) {
		const r = PARK_ZONES[id];
		if (x1 >= r.x0 - reach && x0 <= r.x1 + reach && z1 >= r.z0 - reach && z0 <= r.z1 + reach) return true;
	}
	return false;
}
