/**
 * The Reserva da Iara as zone 'reserva': level/build.ts buildStoryWorld()
 * unchanged, behind the zone API. Its world and level are the very objects the
 * builder returns, so its golden checksums stay the level's own. This is the
 * one zone file that imports the level builder (and through it three.js):
 * world-gen never imports it.
 */
import { buildStoryWorld } from '../build.ts';
import { PARK_ZONES } from './spec.ts';
import type { ZoneBuild } from './zone.ts';

export function buildReservaZone(): ZoneBuild {
	const { world, level } = buildStoryWorld();
	const spec = PARK_ZONES.reserva;
	return {
		id: 'reserva',
		spec,
		offsetX: spec.x0,
		offsetZ: spec.z0,
		width: spec.x1 - spec.x0,
		depth: spec.z1 - spec.z0,
		world,
		level
	};
}
