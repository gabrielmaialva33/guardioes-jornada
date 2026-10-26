/**
 * The living-world layer of the Secret Trail: animals at their homes, flocks,
 * wind, falling leaves and pollen, and Iara's NPC life. Wiring recipe and
 * measurements: ~/.cache/agents/2026-10-25-trilha-secreta/p8-life.md.
 */
export { createLivingWorld, type LivingWorldOptions, loadPaletteTexture } from './create.ts';
export { DESCENT, HowlEvent, LIFE_TIERS, type LifeBlobs } from './fauna.ts';
export { BUTTERFLY_BASE, BUTTERFLY_MAX, BUTTERFLY_PER_SEEDLING } from './flocks.ts';
export { CROWNS, LIFE_SEED, type LifePlan, POPULATION, planLife } from './homes.ts';
export { IARA, IaraFrame, type IaraGesture, IaraLife, type IaraOptions } from './iara.ts';
export type {
	LifeActor,
	LifeDebug,
	LifeFrame,
	LifeStoryState,
	LivingWorld,
	Vec3Like
} from './living-world.ts';
export { PARTICLE_COLORS, PARTICLES } from './particles.ts';
export {
	applyWind,
	patchWind,
	updateWind,
	WIND,
	WIND_GLSL,
	WIND_HEADER,
	type WindMaterialUniforms,
	type WindOptions,
	WindSample,
	windAt,
	windUniforms,
	windVertex
} from './wind.ts';
