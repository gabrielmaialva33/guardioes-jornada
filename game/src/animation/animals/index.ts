/**
 * Atlantic Forest fauna animation: public API for the scene wiring.
 * See ~/.cache/agents/2026-10-25-trilha-secreta/p3-animals.md for the guide.
 */
export { Animal, type AnimalOptions, type AnyAnimal, createAnimal } from './animal.ts';
export {
	ANIMAL_LAYERS,
	AnimalAnimator,
	type AnimalAnimatorOptions,
	availablePostures
} from './animal-animator.ts';
export { Behaviour, type BehaviourOptions, MAX_SUBSTEP, type TimeSource } from './behaviour.ts';
export { type AnimalRig, bindAnimal, placeAnimal } from './bind.ts';
export { BUGIO, BUGIO_STATES, BugioBehaviour, type BugioState } from './bugio.ts';
export { DampedSpring, type SpringPreset } from './damped-spring.ts';
export {
	FLOCK_KINDS,
	FLOCK_SUBSTEP,
	Flock,
	type FlockKind,
	type FlockOptions,
	type FlockParams
} from './flock.ts';
export { createFlyerGeometry, FlockMesh, type FlockMeshOptions } from './flock-mesh.ts';
export { AnimationLod, LOD_DEFAULTS, type LodOptions, type LodTier } from './lod.ts';
export { MICO, MICO_STATES, MicoBehaviour, type MicoState } from './mico.ts';
export { AnimalMotion, type AnimalWorld, createAnimalWorld } from './motion.ts';
export { MURIQUI, MURIQUI_STATES, MuriquiBehaviour, type MuriquiState, PENDULUM_STEP } from './muriqui.ts';
export { ONCA, ONCA_STATES, OncaBehaviour, type OncaState } from './onca.ts';
export { buildPostures, POSTURES, type Posture, posturesOf, SUSPENDED } from './postures.ts';
export {
	PREGUICA,
	PREGUICA_STATES,
	PreguicaBehaviour,
	type PreguicaState,
	SLOTH_LIMB_ORDER
} from './preguica.ts';
export { BIRD_LAYOUT, MODEL_RIGS, MODELS, type ModelId, QUADRUPED_LAYOUT } from './rigs.ts';
export { Route, RouteCursor } from './route.ts';
export { SPECIES, SPECIES_IDS, type SpeciesId, type SpeciesParams } from './species.ts';
export { type Perch, TUCANO, TUCANO_STATES, TucanoBehaviour, type TucanoState } from './tucano.ts';
export {
	createWingFlapUniforms,
	patchWingFlap,
	WING_FLAP_ATTRIBUTE,
	WING_FLAP_PRESETS,
	type WingFlapSettings
} from './wing-flap.ts';
