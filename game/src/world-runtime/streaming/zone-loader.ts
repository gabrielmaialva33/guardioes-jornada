/**
 * `?zone=<id>`: one park zone alone as the map, for testing (PARK.md §8).
 * Two data paths, both wired by the runtime (Root and the environment):
 *
 * - `loadZoneMap(id)` hands the zone over in Root's mapData shape, a
 *   SurvivalWorld and its level in zone-local coordinates, so the present
 *   whole-map runtime (createMapEnvironment, buildMapCollision with its edge
 *   rails) loads it as it loads the Reserva. A zone wider than deep (Praia,
 *   Manguezal: 200 × 160) is padded to a square, since that runtime assumes
 *   one; the padding repeats the last row, is never walkable, and a rail
 *   closes it off.
 * - `zoneOnlySource(client, id)` streams the zone alone through the ring, in
 *   world coordinates, with rails on its outer edges and void around it.
 */
import { buildZone } from '../../level/zones/park.ts';
import { PARK_ZONES, ZONE_IDS, type ZoneId } from '../../level/zones/spec.ts';
import type { ZoneBuild, ZoneLevel } from '../../level/zones/zone.ts';
import type { SurvivalWorld } from '../../survival/types.ts';
import type { StreamClient } from './client.ts';
import { ZoneSource } from './sources.ts';
import { squareWorld } from './square.ts';

/** The zone a page asks for with `?zone=<id>`, or null (absent or unknown). */
export function zoneParam(search: string | URLSearchParams): ZoneId | null {
	const query = typeof search === 'string' ? new URLSearchParams(search) : search;
	const id = query.get('zone');
	return id && (ZONE_IDS as readonly string[]).includes(id) ? (id as ZoneId) : null;
}

export interface ZoneMap {
	id: ZoneId;
	/** Player-facing name (pt-BR). */
	name: string;
	/** Zone-local, Root's mapData shape. */
	world: SurvivalWorld;
	level: ZoneLevel;
	/** World position of the local origin, for anything placed in world coordinates. */
	offsetX: number;
	offsetZ: number;
	/** The zone's own extent (before any padding). */
	width: number;
	depth: number;
	/** True when the world was padded to width × width. */
	padded: boolean;
}

/** The zone alone as Root's map data. */
export function loadZoneMap(id: ZoneId, build: (id: ZoneId) => ZoneBuild = buildZone): ZoneMap {
	const zone = build(id);
	const padded = zone.width !== zone.depth;
	return {
		id,
		name: zone.spec.name,
		world: padded ? squareWorld(zone) : zone.world,
		level: zone.level,
		offsetX: zone.offsetX,
		offsetZ: zone.offsetZ,
		width: zone.width,
		depth: zone.depth,
		padded
	};
}

/** The streaming path: only this zone's chunks, railed in, void around. */
export function zoneOnlySource(client: StreamClient, id: ZoneId): ZoneSource {
	return new ZoneSource(client, { only: id });
}

/** Where a zone-only stream starts: the zone's spawn in world coordinates. */
export function zoneSpawn(id: ZoneId, level: ZoneLevel): { x: number; y: number; z: number; yaw: number } {
	const z = PARK_ZONES[id];
	return { x: level.spawn.x + z.x0, y: level.spawn.y, z: level.spawn.z + z.z0, yaw: level.spawn.yaw };
}
