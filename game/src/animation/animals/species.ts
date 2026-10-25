/**
 * Per-species parameters: scale (ART.md §3), gait footfalls and strides, spring
 * tempo (ART.md §7 presets, scaled), look limits and tail motion. The behaviour
 * timings live with each behaviour; this table holds what the animator needs.
 *
 * Sources, cited per value below:
 * - [RS94] Rosenberger & Stafford 1994, "Locomotion in captive Leontopithecus and
 *   Callimico", Am. J. Phys. Anthropol. 94:379–394: L. rosalia walks with a
 *   diagonal-sequence gait and shifts to bounding at speed ("transaxial bounding",
 *   overstriding hindlimb).
 * - [H67] Hildebrand 1967, "Symmetrical gaits of primates", Am. J. Phys. Anthropol.
 *   26:119–130; [CLS02] Cartmill, Lemelin & Schmitt 2002, "Support polygons and
 *   symmetrical gaits in mammals", Zool. J. Linn. Soc. 136:401–420: primates walk
 *   with diagonal sequences (limb phase > 0.5), most other mammals with lateral ones.
 * - [US17] Usherwood & Self Davies 2017, "Work minimization accounts for footfall
 *   phasing in slow quadrupedal gaits", eLife 6:e29495: non-primate walks near 25%
 *   phase; sloths near 25% at high duty factor.
 * - [N10] Nyakatura, Petrovitch & Fischer 2010, Zoology 113:221–234: sloths' slow
 *   suspensory walks have duty factors up to 0.89 and no strict sequence.
 * - [M25] Mossor et al. 2025, J. Exp. Zool. A, doi:10.1002/jez.2911: three-toed
 *   sloths (Bradypus) have forelimbs markedly longer than hindlimbs.
 * - [E63] Erikson 1963, "Brachiation in New World monkeys and in anthropoid apes",
 *   Symp. Zool. Soc. Lond. 10:135–164: atelines (muriqui) have long forelimbs.
 * - [C86] Cant 1986, Folia Primatol. 46:1–14: howlers move quadrupedally and
 *   slowly and do not brachiate.
 * - [ICMBio] species sheets and action plans cited in assets-report.md §3.3.
 */
import { SPRING } from '../../style/motion.ts';
import type { SpringPreset } from './damped-spring.ts';
import { MODELS, type ModelId } from './rigs.ts';
import { DEG } from './scalar.ts';

export const SPECIES_IDS = [
	'mico-leao-dourado',
	'muriqui',
	'bugio-ruivo',
	'onca-pintada',
	'preguica-de-coleira',
	'tucano-de-bico-verde'
] as const;

export type SpeciesId = (typeof SPECIES_IDS)[number];

/** A symmetrical or bounding gait as footfall timing, Hildebrand style. */
export interface GaitParams {
	/** Touch-down time of each limb as a fraction of the stride: front left, front right, back left, back right. */
	readonly touchdown: readonly [number, number, number, number];
	/** Share of the stride each foot is on the support (duty factor). */
	readonly duty: readonly [number, number, number, number];
	/** Largest swing of a leg either side of vertical, radians (Kenney's own walk uses 50°). */
	readonly maxSwing: number;
	/** Foot lift during the swing, model units. */
	readonly lift: number;
	/** Body bob, model units, and bobs per stride (2 for walks: one per footfall pair). */
	readonly bob: number;
	readonly bobsPerStride: number;
	/** Body pitch and roll amplitudes, radians. */
	readonly pitch: number;
	readonly roll: number;
	/** Whole-body ballistic arc for bounds (model units) and its window in the stride. */
	readonly arc: number;
	readonly arcStart: number;
	readonly arcEnd: number;
}

/** Stride length (world units) at two speeds (u/s), linear between and clamped outside. */
export interface StrideParams {
	readonly slowSpeed: number;
	readonly slowStride: number;
	readonly fastSpeed: number;
	readonly fastStride: number;
}

export interface SpeciesParams {
	readonly id: SpeciesId;
	/** Common name in Brazilian Portuguese, for the HUD and debug overlays. */
	readonly name: string;
	readonly model: ModelId;
	/** ART.md §3 size in world units (×1.5 life size against the 3.0 u avatar). */
	readonly size: number;
	/** World units per model unit: scale the placed group by this. */
	readonly scale: number;
	/** Static limb stretch (node scale y), for long-limbed species. */
	readonly limbScale: { readonly front: number; readonly hind: number };
	/**
	 * Frequency factor applied to every SPRING preset. Rule: √(0.9 u / size), the
	 * pendulum scaling of a swinging part (f ∝ 1/√length) with the mico as the
	 * reference, times a behavioural factor where noted.
	 */
	readonly tempo: number;
	/** Preset for head (or body) look turns. */
	readonly lookPreset: SpringPreset;
	readonly walk: GaitParams | null;
	readonly run: GaitParams | null;
	/** Speeds (u/s) across which the walk crossfades into the run. */
	readonly runFrom: number;
	readonly runTo: number;
	readonly stride: StrideParams;
	/** Look limits with a head node, radians; without one the body takes `bodyLook` of it. */
	readonly lookYaw: number;
	readonly lookPitch: number;
	readonly bodyLook: number;
	/** Birds cock the head to look with one eye: roll per radian of look yaw. */
	readonly headTilt: number;
	/** Idle tail sway (radians, seconds); decorative, so 0 with reduced motion. */
	readonly tailSway: number;
	readonly tailSwayPeriod: number;
	/** Tail swing per rad/s of turning and per u/s² of acceleration. */
	readonly tailTurn: number;
	readonly tailAccel: number;
	/** Fastest body turn, rad/s. */
	readonly turnRate: number;
	/** What the citations above support for this species. */
	readonly sources: readonly string[];
}

/** √(0.9 / size): f ∝ 1/√length, mico = 1. */
const tempoFor = (size: number) => Math.sqrt(0.9 / size);

const scaleFor = (model: ModelId, size: number, measure: 'bodyLength' | 'totalLength' = 'bodyLength') =>
	size / MODELS[model][measure];

/** Primate walk, diagonal sequence: LH 0, RF 0.2, RH 0.5, LF 0.7 (limb phase 0.7) [H67, CLS02, RS94]. */
const DS_WALK: GaitParams = {
	touchdown: [0.7, 0.2, 0, 0.5],
	duty: [0.7, 0.7, 0.7, 0.7],
	maxSwing: 40 * DEG,
	lift: 0.04,
	bob: 0.02,
	bobsPerStride: 2,
	pitch: 0,
	roll: 2 * DEG,
	arc: 0,
	arcStart: 0,
	arcEnd: 0
};

/**
 * The tamarin's half-bound [RS94]: the hind pair pushes off at 0, the body flies
 * until the forelimbs land at ~0.3 (left a little before right), then the
 * hindlimbs land beside or ahead of them at ~0.5 (overstriding).
 */
const BOUND: GaitParams = {
	touchdown: [0.3, 0.34, 0.5, 0.54],
	duty: [0.2, 0.2, 0.32, 0.32],
	maxSwing: 50 * DEG,
	lift: 0.06,
	bob: 0,
	bobsPerStride: 1,
	pitch: 12 * DEG,
	roll: 0,
	arc: 0.22,
	arcStart: 0,
	arcEnd: 0.3
};

/** Felid walk, lateral sequence near 25% phase [US17]: LH 0, LF 0.25, RH 0.5, RF 0.75. */
const LS_WALK: GaitParams = {
	touchdown: [0.25, 0.75, 0, 0.5],
	duty: [0.68, 0.68, 0.68, 0.68],
	maxSwing: 45 * DEG,
	lift: 0.05,
	bob: 0.025,
	bobsPerStride: 2,
	pitch: 1 * DEG,
	roll: 2.5 * DEG,
	arc: 0,
	arcStart: 0,
	arcEnd: 0
};

const NO_STRIDE: StrideParams = { slowSpeed: 0, slowStride: 1, fastSpeed: 1, fastStride: 1 };

const MICO_SIZE = 0.9;
const MURIQUI_SIZE = 1.7;
const BUGIO_SIZE = 1.4;
const ONCA_SIZE = 3;
const PREGUICA_SIZE = 1.4;
const TUCANO_SIZE = 0.9;

export const SPECIES: Readonly<Record<SpeciesId, SpeciesParams>> = {
	'mico-leao-dourado': {
		id: 'mico-leao-dourado',
		name: 'Mico-leão-dourado',
		model: 'monkey',
		size: MICO_SIZE,
		scale: scaleFor('monkey', MICO_SIZE),
		limbScale: { front: 1, hind: 1 },
		tempo: tempoFor(MICO_SIZE),
		// Quick vigilance scans: the snappy "pop" preset instead of "body".
		lookPreset: SPRING.pop,
		walk: DS_WALK,
		run: BOUND,
		runFrom: 2,
		runTo: 3.5,
		// A small primate: short quick strides walking, ~2.3 body lengths per bound at the player's speed.
		stride: { slowSpeed: 0.5, slowStride: 0.4, fastSpeed: 10, fastStride: 2.2 },
		lookYaw: 70 * DEG,
		lookPitch: 30 * DEG,
		bodyLook: 0.4,
		headTilt: 0,
		tailSway: 4 * DEG,
		tailSwayPeriod: 2.6,
		tailTurn: 0.12,
		tailAccel: 0.02,
		turnRate: 10,
		sources: [
			'RS94: diagonal-sequence walk, bounding at speed, overstriding hindlimb',
			'ICMBio ficha Leontopithecus rosalia; AMLD: tail not prehensile, used for balance'
		]
	},
	muriqui: {
		id: 'muriqui',
		name: 'Muriqui',
		model: 'monkey',
		size: MURIQUI_SIZE,
		scale: scaleFor('monkey', MURIQUI_SIZE),
		// Long forelimbs for arm-swinging [E63]; the Cube Pets leg is a short block.
		limbScale: { front: 2.2, hind: 1.4 },
		tempo: tempoFor(MURIQUI_SIZE),
		lookPreset: SPRING.body,
		walk: null,
		run: null,
		runFrom: 0,
		runTo: 1,
		stride: NO_STRIDE,
		lookYaw: 60 * DEG,
		lookPitch: 25 * DEG,
		bodyLook: 0.35,
		headTilt: 0,
		tailSway: 5 * DEG,
		tailSwayPeriod: 4,
		tailTurn: 0.1,
		tailAccel: 0.02,
		turnRate: 2,
		sources: [
			'E63, Strier 1992 (Am. J. Phys. Anthropol. 88:515–524): suspensory locomotion, brachiation',
			'Wisconsin NPRC factsheet: prehensile tail, can hang by it alone to feed with both hands',
			'ICMBio PAN Muriquis'
		]
	},
	'bugio-ruivo': {
		id: 'bugio-ruivo',
		name: 'Bugio-ruivo',
		model: 'monkey',
		size: BUGIO_SIZE,
		scale: scaleFor('monkey', BUGIO_SIZE),
		limbScale: { front: 1, hind: 1 },
		tempo: tempoFor(BUGIO_SIZE),
		lookPreset: SPRING.body,
		walk: { ...DS_WALK, duty: [0.75, 0.75, 0.75, 0.75], maxSwing: 32 * DEG, lift: 0.03, bob: 0.015 },
		run: null,
		runFrom: 0,
		runTo: 1,
		// Slow, deliberate quadrupedal walking along branches [C86].
		stride: { slowSpeed: 0.3, slowStride: 0.5, fastSpeed: 1.4, fastStride: 0.75 },
		lookYaw: 60 * DEG,
		lookPitch: 25 * DEG,
		bodyLook: 0.35,
		headTilt: 0,
		tailSway: 3 * DEG,
		tailSwayPeriod: 5,
		tailTurn: 0.1,
		tailAccel: 0.02,
		turnRate: 1.5,
		sources: [
			'C86: quadrupedal and slow, no tail-arm suspension; tail and hind feet hold it while feeding',
			'Chiarello 1993, Primates 34:289–293: brown howlers rest most of the day',
			'Oliveira & Ades 2004, An. Acad. Bras. Ciênc. 76:393–398: long-distance roars',
			'ICMBio ficha Alouatta guariba clamitans'
		]
	},
	'onca-pintada': {
		id: 'onca-pintada',
		name: 'Onça-pintada',
		model: 'tiger',
		size: ONCA_SIZE,
		scale: scaleFor('tiger', ONCA_SIZE),
		limbScale: { front: 1, hind: 1 },
		tempo: tempoFor(ONCA_SIZE),
		lookPreset: SPRING.body,
		walk: LS_WALK,
		run: null,
		runFrom: 0,
		runTo: 1,
		// A calm walk near 0.7 body lengths per second with strides the short legs can cover.
		stride: { slowSpeed: 1, slowStride: 1.1, fastSpeed: 4, fastStride: 1.8 },
		lookYaw: 60 * DEG,
		lookPitch: 20 * DEG,
		bodyLook: 0.3,
		headTilt: 0,
		// The slow resting sway of a cat's tail.
		tailSway: 10 * DEG,
		tailSwayPeriod: 5,
		tailTurn: 0.15,
		tailAccel: 0.03,
		turnRate: 1.8,
		sources: [
			'US17: lateral-sequence walk near 25% phase in non-primate quadrupeds',
			'ICMBio PAN Grandes Felinos / CENAP: jaguars avoid people; never aggressive in this game'
		]
	},
	'preguica-de-coleira': {
		id: 'preguica-de-coleira',
		name: 'Preguiça-de-coleira',
		model: 'koala',
		size: PREGUICA_SIZE,
		scale: scaleFor('koala', PREGUICA_SIZE),
		// Forelimbs much longer than hindlimbs [M25]; both longer than the Cube Pets block.
		limbScale: { front: 1.8, hind: 1.4 },
		// ×0.4 on top of the size rule: sloths move slowly, with little muscle and a very
		// low metabolic rate (Gilmore, da Costa & Duarte 2001, Braz. J. Biol. 61:2).
		tempo: tempoFor(PREGUICA_SIZE) * 0.4,
		lookPreset: SPRING.body,
		walk: null,
		run: null,
		runFrom: 0,
		runTo: 1,
		stride: NO_STRIDE,
		lookYaw: 80 * DEG,
		lookPitch: 30 * DEG,
		bodyLook: 0.3,
		headTilt: 0,
		tailSway: 0,
		tailSwayPeriod: 1,
		tailTurn: 0,
		tailAccel: 0,
		turnRate: 0.2,
		sources: [
			'N10, US17: slow suspensory walks, one limb at a time near 25% phase',
			'M25: long forelimbs',
			'Chiarello 1998, J. Zool. 246:1–10: B. torquatus rests most of the day',
			'ICMBio ficha Bradypus torquatus; AMLD conectividade BR-101'
		]
	},
	'tucano-de-bico-verde': {
		id: 'tucano-de-bico-verde',
		name: 'Tucano-de-bico-verde',
		model: 'parrot',
		size: TUCANO_SIZE,
		// Birds are measured bill tip to tail tip.
		scale: scaleFor('parrot', TUCANO_SIZE, 'totalLength'),
		limbScale: { front: 1, hind: 1 },
		tempo: tempoFor(TUCANO_SIZE),
		lookPreset: SPRING.body,
		walk: null,
		run: null,
		runFrom: 0,
		runTo: 1,
		stride: NO_STRIDE,
		lookYaw: 70 * DEG,
		lookPitch: 25 * DEG,
		bodyLook: 0.45,
		headTilt: 0.35,
		tailSway: 0,
		tailSwayPeriod: 1,
		tailTurn: 0.08,
		tailAccel: 0.01,
		turnRate: 8,
		sources: [
			'Short & Horne 2001 (Toucans, Barbets and Honeyguides, OUP): moves along branches by hopping',
			'Van Tyne 1929; Skutch 1971 (Auk 88:381–396): 6–10 wingbeats, wings closed briefly, then a glide',
			'Kricher 1989 via ADW: roosts with the tail folded up over the back',
			'WikiAves: Ramphastos dicolorus'
		]
	}
};

/** Stride length (u) of a species at a speed (u/s): linear between the two stride points, clamped. */
export function strideAt(species: SpeciesParams, speed: number): number {
	const { slowSpeed, slowStride, fastSpeed, fastStride } = species.stride;
	const t = Math.min(1, Math.max(0, (speed - slowSpeed) / (fastSpeed - slowSpeed)));
	return slowStride + (fastStride - slowStride) * t;
}
