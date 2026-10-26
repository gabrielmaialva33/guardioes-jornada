/**
 * Public surface of the endless-world generator (game/WORLD.md, phase F0):
 * pure TypeScript, no three.js, DOM or Svelte, safe in a Worker. The page
 * side (client.ts, protocol.ts) is exported separately so importing it never
 * pulls the generator into the main bundle.
 */
export {
	BIOME,
	BIOME_COUNT,
	BIOME_RANK,
	BIOME_ZONE,
	BIOMES,
	type Biome
} from './biomes.ts';
export {
	APRON_LENGTH,
	type Area,
	type AreaOptions,
	clearWorldGenCaches,
	generateArea,
	generateChunk,
	heightIn,
	heightWithApron,
	RIVER_STRIDE,
	type WorldChunk
} from './chunk.ts';
export {
	CHUNK_CELLS,
	CHUNK_SIDE,
	CHUNK_SIZE,
	COLLISION_SIDE,
	DETAIL_VERSION,
	isHandMade,
	MACRO_VERSION,
	RESERVE,
	STITCH_BAND,
	WORLD_SEED
} from './constants.ts';
export {
	BAIXADA_FOOT,
	COSTAO_FOOT,
	CREST_S,
	coastX,
	farHeights,
	macroHeight,
	PLANALTO_S,
	serraFoot
} from './macro.ts';
export { nearPark, PARK_BOUNDARY, type ParkEdge, parkDistance, zoneOfChunk } from './park.ts';
export { parkStitch, touchesParkBand } from './park-stitch.ts';
export {
	RIVER_ACC,
	RIVER_FLAG,
	type RiverLattice,
	riverLattice,
	STREAM_ACC
} from './rivers.ts';
