/**
 * Render budget infrastructure for the Secret Trail: quality tiers and the DPR
 * governor, instance pools with per-block culling and LOD, fog matched to the
 * tier's view distance, shadow tiers with on-demand shadow maps and blob
 * shadows, and per-frame accounting across all passes.
 *
 * Per frame, in this order (see p1-render.md for the Threlte wiring):
 * 1. `budget.beginFrame(time)`: closes the previous frame's counts.
 * 2. game update (controller, camera, animation), then `shadows.markMoved()` if
 *    the avatar or an animal moved or changed pose.
 * 3. `grid.update(camera)`: block culling + LOD, repacks pools that changed.
 * 4. `shadows.blobs.set(...)` for actors, `shadows.blobs.sync()`,
 *    `shadows.update(player.x, player.y, player.z)`.
 * 5. render (three's shadow pass runs only when the rig asked for it).
 * 6. `if (governor.sample(intervalMs)) dpr.set(governor.dpr)`.
 */
export { BLOCK_SIZE, BlockGrid, type BlockGridOptions, type BlockSyncTarget } from './blocks.ts';
export {
	BUDGET,
	collectTextures,
	type DebugSnapshot,
	debugSnapshot,
	FrameBudget,
	type FrameBudgetOptions,
	type FrameStats,
	type InfoRenderer,
	shadowMapBytes,
	textureBytes
} from './budget.ts';
export {
	applyFog,
	type FogSettings,
	fogSettings,
	keepFraction,
	type LightVariant,
	type LodBand,
	type LodCategory,
	type LodProfile,
	lodProfiles,
	lodProfilesFor,
	lodRank,
	NIGHT_FOG_END
} from './fog-lod.ts';
export {
	type AddPlacementsOptions,
	addPlacements,
	createPoolsFromScene,
	extractParts,
	type GeometryPiece,
	InstancePool,
	type InstancePoolOptions,
	type MaterialMode,
	mergePieces,
	type PlacementArrays,
	type PoolPart,
	type PoolReport,
	PoolSet,
	placedMatrix,
	type ScenePoolOptions
} from './instancing.ts';
export { houseMaterial, preparePaletteMap } from './materials.ts';
export {
	type Capabilities,
	type ContextLossHandlers,
	type ContextLossOptions,
	DPR_STEPS,
	DprGovernor,
	dprLimit,
	type GovernorOptions,
	isWeakGpu,
	type PickOptions,
	pickQuality,
	probeCapabilities,
	QUALITIES,
	QUALITY,
	type Quality,
	type QualityChoice,
	type QualityPreset,
	readCapabilities,
	watchContextLoss
} from './quality.ts';
export {
	applyHemisphere,
	BLOB_OPACITY,
	type BlobKind,
	type BlobMode,
	BlobShadows,
	type CasterKind,
	createBlobTexture,
	createHemisphere,
	LIGHT_INTENSITY,
	SHADOW_TIERS,
	type ShadowRenderer,
	ShadowRig,
	type ShadowRigOptions,
	type ShadowTierSettings,
	SUN_AZIMUTH_DEG,
	sunDirection
} from './shadows.ts';
