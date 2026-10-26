/**
 * The whole park (game/PARK.md): every zone built in seam order
 * (spec.ts BUILD_ORDER), each stitched to the zones it borders.
 */
import { buildCopaZone } from './copa.ts';
import { buildManguezalZone } from './manguezal.ts';
import { buildPraiaZone } from './praia.ts';
import { buildReservaZone } from './reserva.ts';
import { BUILD_ORDER, type ZoneId } from './spec.ts';
import { buildValeZone } from './vale.ts';
import { buildSkeletonZone, type ZoneBuild } from './zone.ts';

/** Builds one zone from the zones built before it: the Reserva through its adapter, the others with their content. */
export function buildOne(id: ZoneId, built: ReadonlyMap<ZoneId, ZoneBuild>): ZoneBuild {
	if (id === 'reserva') return buildReservaZone();
	if (id === 'vale') return buildValeZone(built);
	if (id === 'copa') return buildCopaZone(built);
	if (id === 'praia') return buildPraiaZone(built);
	if (id === 'manguezal') return buildManguezalZone(built);
	return buildSkeletonZone(id, built);
}

/** Builds the park afresh, in seam order. */
export function buildParkFresh(): ReadonlyMap<ZoneId, ZoneBuild> {
	const built = new Map<ZoneId, ZoneBuild>();
	for (const id of BUILD_ORDER) built.set(id, buildOne(id, built));
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
