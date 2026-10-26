/**
 * The park's zones (game/PARK.md, P20): the zone builder API. buildZone(id)
 * gives a zone in the SurvivalWorld + StoryLevel shapes, zone-local, with its
 * world offset; every zone carries its content (P25 vale.ts, P31 copa.ts,
 * P33 praia.ts, pB's P30 manguezal.ts; content.ts, kit.ts).
 * spec.ts is the part world-gen's Worker reads; park.ts and reserva.ts pull in
 * the level builder.
 */
export { BAND, BAND_SLOPE, type BandSide, stitchBands } from './band.ts';
export type {
	Basin,
	CameraTrapSpot,
	CreatureSpot,
	FragileArea,
	PlantSpot,
	Rarity,
	SeedSpot,
	Stair,
	TrailMark,
	ZoneContent,
	ZoneHome,
	ZoneLandmark,
	ZoneLandmarkKind,
	ZoneMechanics,
	ZoneMission,
	ZoneText,
	ZoneTrigger,
	ZoneTriggerKind
} from './content.ts';
export { buildCopaZone } from './copa.ts';
export { COPA_TEXT } from './copa-text.ts';
export { buildManguezalZone } from './manguezal.ts';
export { MANGUE_TEXT } from './manguezal-text.ts';
export { buildOne, buildPark, buildParkFresh, buildZone } from './park.ts';
export { buildPraiaZone } from './praia.ts';
export { PRAIA_TEXT } from './praia-text.ts';
export { carveRiver, RIVER_REACH, riverInside } from './river.ts';
export { coastLine, coastProfile, skeletonHeight } from './skeleton.ts';
export * from './spec.ts';
export { buildValeZone } from './vale.ts';
export { VALE_TEXT } from './vale-text.ts';
export {
	buildSkeletonZone,
	heightIn,
	seamProfile,
	walkStepsRect,
	type ZoneArrival,
	type ZoneBuild,
	type ZoneGround,
	type ZoneLevel,
	zoneArrival,
	zoneGround,
	zoneHeight
} from './zone.ts';
