/**
 * The park's zones (game/PARK.md, P20): the zone builder API. buildZone(id)
 * gives a zone in the SurvivalWorld + StoryLevel shapes, zone-local, with its
 * world offset. spec.ts is the Worker-safe part (world-gen reads it); park.ts
 * and reserva.ts pull in the level builder.
 */
export { BAND, BAND_SLOPE, type BandSide, stitchBands } from './band.ts';
export { buildPark, buildParkFresh, buildZone } from './park.ts';
export { carveRiver, RIVER_REACH } from './river.ts';
export { coastLine, coastProfile, skeletonHeight } from './skeleton.ts';
export * from './spec.ts';
export {
	buildSkeletonZone,
	heightIn,
	seamProfile,
	walkStepsRect,
	type ZoneArrival,
	type ZoneBuild,
	type ZoneLevel,
	zoneHeight
} from './zone.ts';
