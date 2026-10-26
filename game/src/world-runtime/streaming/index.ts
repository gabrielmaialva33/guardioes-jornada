/**
 * The streaming core (P34): the park and the endless world loaded by 40 u
 * chunks around the player. Public surface; see p34-streaming-core.md for
 * the wiring.
 */
export {
	ChunkCollider,
	type CollisionData,
	type CollisionInput,
	type CollisionQuery,
	CompoundCollision,
	collisionData
} from './chunk-collision.ts';
export {
	createInlineStreamPort,
	createStreamWorker,
	StreamClient,
	type StreamPort,
	type StreamStats,
	ZoneCancelled
} from './client.ts';
export { fromWorldChunk, GeneratedSource } from './generated.ts';
export { createStreamHost, type StreamHost, type StreamHostOptions } from './host.ts';
export type { BuildRequest, BuildResult, StreamRequest, StreamResponse } from './protocol.ts';
export {
	type MountedFall,
	type RingOptions,
	type RingRadii,
	type RingStats,
	ringRadii,
	STEP,
	StreamingRing
} from './ring.ts';
export {
	ChunkPlacements,
	PER_CHUNK_MAX,
	type PlacementFamily,
	type PlacementRoute,
	ringCapacity,
	ringSlots,
	ToroidalBlockGrid,
	WINDOW_MAX
} from './slots.ts';
export { cutIndex, ParkSource, ZoneSource, type ZoneSourceOptions, zoneRails } from './sources.ts';
export { createWaterfallSpray } from './spray.ts';
export { squareWorld } from './square.ts';
export {
	buildTerrainRows,
	chunkSphere,
	createTerrainAttributes,
	inputBodies,
	type PoolShape,
	SHORE_FAR,
	SHORE_REACH,
	shoreSample,
	TERRAIN_INDEX,
	type TerrainAttributes,
	type TerrainInput,
	TerrainMeshPool
} from './terrain-mesh.ts';
export { type TerrainTint, windowTint } from './tint.ts';
export { RibbonMeshPool, type RibbonPiece, ribbonBytes, zoneRibbons } from './trails.ts';
export {
	APRON_LENGTH,
	apronHeight,
	BASIN_KEYED_STRIDE,
	CHUNK_SIDE,
	CHUNK_SIZE,
	CHUNK_VERTICES,
	type ChunkOrigin,
	type ChunkSource,
	chunkId,
	chunkIdX,
	chunkIdZ,
	chunkOf,
	emptyPlacements,
	POOL_STRIDE,
	RIVER_STRIDE,
	type StoryRef,
	StreamCancelled,
	type StreamChunk
} from './types.ts';
export {
	BASIN_STRIDE,
	buildWaterMesh,
	createWaterAttributes,
	createWaterField,
	FALL_STEP,
	FIELD_SIDE,
	fillWaterField,
	gatherBodies,
	SEA_LAND,
	seaInWindow,
	WATER_CELL,
	type WaterAttributes,
	type WaterBodies,
	type WaterField,
	WaterMeshPool,
	type WaterSample,
	waterAt,
	writeShore
} from './water.ts';
export {
	SPRAY_OUT,
	type StreamWaterfall,
	WATERFALL_MODEL_DROP,
	waterfallPlacements,
	waterfallsIn,
	waterfallsOf
} from './waterfalls.ts';
export { createWindow, type FieldWindow, fillWindow, WINDOW_MARGIN, WINDOW_SIDE } from './window.ts';
export { buildZoneOnDemand, cutZone, type ZoneCut, zoneClosure } from './zone-cut.ts';
export { loadZoneMap, type ZoneMap, zoneOnlySource, zoneParam, zoneSpawn } from './zone-loader.ts';
