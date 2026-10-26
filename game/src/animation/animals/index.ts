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
export {
	GROUND,
	GROUND_SPECIES,
	GROUND_STATES,
	GroundBehaviour,
	type GroundOptions,
	type GroundSpecies,
	type GroundState,
	type GroundTuning,
	Herd,
	isActive,
	isGroundSpecies,
	type Reaction
} from './ground.ts';
export { AnimationLod, LOD_DEFAULTS, type LodOptions, type LodTier } from './lod.ts';
export {
	type Activity,
	AJ83,
	ANIMAL_FACTOR,
	type GaitKind,
	type GaitMeasure,
	GRAVITY_UNITS,
	gameHeight,
	MEASURES,
	P23_SPECIES,
	type P23Species,
	type SpeciesMeasures,
	UNIT_METRES
} from './measures.ts';
export { MICO, MICO_STATES, MicoBehaviour, type MicoState } from './mico.ts';
export { AnimalMotion, type AnimalWorld, createAnimalWorld, type Light, PLAYER_EYES } from './motion.ts';
export {
	MURIQUI,
	MURIQUI_HOLDS,
	MURIQUI_STATES,
	MuriquiBehaviour,
	type MuriquiState,
	PENDULUM_STEP
} from './muriqui.ts';
export {
	FELIDS,
	type FelidSpecies,
	type FelidTuning,
	ONCA,
	ONCA_STATES,
	OncaBehaviour,
	type OncaState
} from './onca.ts';
export { buildPostures, POSTURES, type Posture, posturesOf, SUSPENDED } from './postures.ts';
export {
	PREGUICA,
	PREGUICA_STATES,
	PreguicaBehaviour,
	type PreguicaState,
	SLOTH_LIMB_ORDER
} from './preguica.ts';
export {
	BIRD_LAYOUT,
	BIRD_MODELS,
	isBird,
	MODEL_IDS,
	MODEL_RIGS,
	MODELS,
	type ModelId,
	QUADRUPED_LAYOUT
} from './rigs.ts';
export { Route, RouteCursor } from './route.ts';
export {
	derivedGait,
	hipHeight,
	resolveSpeciesId,
	SPECIES,
	SPECIES_ALIASES,
	SPECIES_IDS,
	type SpeciesId,
	type SpeciesParams
} from './species.ts';
export {
	PERCHERS,
	type Perch,
	type PercherSpecies,
	type PerchTuning,
	TUCANO,
	TUCANO_STATES,
	TucanoBehaviour,
	type TucanoState
} from './tucano.ts';
export {
	createWingFlapUniforms,
	patchWingFlap,
	WING_FLAP_ATTRIBUTE,
	WING_FLAP_PRESETS,
	type WingFlapSettings
} from './wing-flap.ts';
