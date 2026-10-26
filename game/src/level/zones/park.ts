/**
 * The whole park (game/PARK.md): every zone built in seam order
 * (spec.ts BUILD_ORDER), each skeleton zone stitched to the zones it borders.
 */
import { buildReservaZone } from './reserva.ts';
import { BUILD_ORDER, type ZoneId } from './spec.ts';
import { buildSkeletonZone, type ZoneBuild } from './zone.ts';

/** Builds the park afresh: the Reserva through its adapter, the rest from their skeletons. */
export function buildParkFresh(): ReadonlyMap<ZoneId, ZoneBuild> {
	const built = new Map<ZoneId, ZoneBuild>();
	for (const id of BUILD_ORDER)
		built.set(id, id === 'reserva' ? buildReservaZone() : buildSkeletonZone(id, built));
	return built;
}

let park: ReadonlyMap<ZoneId, ZoneBuild> | null = null;

/** The park, built once and shared. */
export function buildPark(): ReadonlyMap<ZoneId, ZoneBuild> {
	park ??= buildParkFresh();
	return park;
}

/** One zone of the shared park. */
export function buildZone(id: ZoneId): ZoneBuild {
	const zone = buildPark().get(id);
	if (!zone) throw new Error(`unknown zone ${id}`);
	return zone;
}
