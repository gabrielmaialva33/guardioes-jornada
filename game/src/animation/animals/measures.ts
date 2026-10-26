/**
 * The numbers to retune for the P23 species (capivara … guará): real sizes, the gait
 * kinds and their Froude numbers. Everything the animator and the behaviours use for
 * these species is derived from this table in species.ts, so a measured table (for
 * example strides and cadences measured from reference clips) replaces values here and
 * nothing else changes.
 *
 * Size. ART.md §3: animals are drawn ×1.5 life size and one world unit is about 0.47 m,
 * so an animal `height` metres tall at the shoulder (the back or shell for low animals,
 * the head top for birds standing) is height × 1.5 / 0.47 u tall in the game.
 *
 * Gait [AJ83]. Animals of one shape move alike at equal Froude numbers F = v² / (g h),
 * with h the hip height. Here h is the drawn animal's own hip (the Cube Pets leg pivot
 * × the species scale), so its legs can cover the stride without sliding:
 * - speed  v = √(F g h);
 * - stride λ = 2.3 h F^0.3 (relative stride length λ/h against F, the relation of
 *   Alexander 1976 that AJ83 found to hold across quadrupeds);
 * - cadence = v / λ, so frequencies go as 1/√h at equal F, as the existing species' tempo.
 * g is real gravity in world units (9.81 / 0.47 u/s²). Typical F [AJ83]: walks below
 * about 0.5, trots between about 0.5 and 2–3, gallops above about 2.5; small animals
 * sprint at much higher F.
 *
 * Measured overrides: a gait may carry `speed` (u/s) and `stride` (u) in world units; they
 * replace the derived values. The scale-free way to bring a measurement in is its Froude
 * number (v² / (g h) of the real animal with its real hip height): the table then derives
 * the speed and stride of the drawn animal.
 */
import type { ModelId } from './rigs.ts';

/** One world unit in metres (ART.md §3: the 3.0 u avatar, 1 stud = 0.6 u). */
export const UNIT_METRES = 0.47;
/** ART.md §3 category factor for animals. */
export const ANIMAL_FACTOR = 1.5;
/** Real gravity in world units, u/s². */
export const GRAVITY_UNITS = 9.81 / UNIT_METRES;

/** AJ83 / Alexander 1976 relative stride: λ / h = coefficient × F^exponent. */
export const AJ83 = { strideCoefficient: 2.3, strideExponent: 0.3 } as const;

/**
 * Gait kinds, each a footfall pattern in species.ts:
 * - lateral-walk: LH, LF, RH, RF a quarter apart (non-primate mammals, tortoises, toads walking);
 * - trot: diagonal pairs together; gallop: rotary/transverse gallop with a flight phase;
 * - half-bound: hind feet together, forefeet staggered (rabbits);
 * - hop: both hind feet push together and the body flies (toads);
 * - crawl: a very slow lateral walk at a high duty factor (tortoises);
 * - sideways: legs swing across the body (crabs);
 * - biped-walk, biped-run: birds on the ground (only the two legs step).
 */
export type GaitKind =
	| 'lateral-walk'
	| 'trot'
	| 'gallop'
	| 'half-bound'
	| 'hop'
	| 'crawl'
	| 'sideways'
	| 'biped-walk'
	| 'biped-run';

export interface GaitMeasure {
	readonly kind: GaitKind;
	/** Froude number v² / (g h) of this gait at its typical speed. */
	readonly froude: number;
	/** Duty factor override (share of the stride each foot is down). */
	readonly duty?: number;
	/** Measured overrides in world units: speed (u/s) and stride (u). */
	readonly speed?: number;
	readonly stride?: number;
}

export type Activity = 'diurnal' | 'crepuscular' | 'nocturnal' | 'cathemeral';

export interface SpeciesMeasures {
	readonly scientific: string;
	/** Common name in Brazilian Portuguese (HUD, Guia da Mata). */
	readonly name: string;
	readonly model: ModelId;
	/** Shoulder height (back or shell for low animals, head top standing for birds), metres. */
	readonly height: number;
	/** Usual walk and the fastest gait it uses (flight, escape); null when it does not walk. */
	readonly walk: GaitMeasure | null;
	readonly run: GaitMeasure | null;
	readonly activity: Activity;
	/** What the values above rest on (see the report for full references). */
	readonly sources: readonly string[];
}

export const P23_SPECIES = [
	'capivara',
	'anta',
	'anta-filhote',
	'cateto',
	'veado-mateiro',
	'cachorro-do-mato',
	'onca-parda',
	'tapiti',
	'jaguatirica',
	'caranguejo-uca',
	'tatu-galinha',
	'jabuti-tinga',
	'sapo-cururu',
	'saira-sete-cores',
	'sabia-laranjeira',
	'jacutinga',
	'colhereiro'
] as const;

export type P23Species = (typeof P23_SPECIES)[number];

export const MEASURES: Readonly<Record<P23Species, SpeciesMeasures>> = {
	capivara: {
		scientific: 'Hydrochoerus hydrochaeris',
		name: 'Capivara',
		model: 'capivara',
		height: 0.55,
		walk: { kind: 'lateral-walk', froude: 0.25 },
		run: { kind: 'gallop', froude: 3 },
		activity: 'crepuscular',
		sources: ['SIB/APN and ADW: 50–62 cm at the shoulder; crepuscular, groups of 3–30', 'AJ83 (gaits)']
	},
	anta: {
		scientific: 'Tapirus terrestris',
		name: 'Anta',
		model: 'anta',
		height: 0.9,
		walk: { kind: 'lateral-walk', froude: 0.22 },
		run: { kind: 'gallop', froude: 2.5 },
		activity: 'nocturnal',
		sources: [
			'SIB/APN, ADW: 77–110 cm at the shoulder',
			'UFRGS Fauna Digital RS: nocturnal, solitary; a skilled swimmer',
			'AJ83 (gaits)'
		]
	},
	'anta-filhote': {
		scientific: 'Tapirus terrestris',
		name: 'Anta (filhote)',
		model: 'anta',
		height: 0.5,
		walk: { kind: 'lateral-walk', froude: 0.3 },
		run: { kind: 'gallop', froude: 4 },
		activity: 'nocturnal',
		sources: ['AJ83 (gaits): a calf keeps up with its mother at a higher F']
	},
	cateto: {
		scientific: 'Dicotyles tajacu',
		name: 'Cateto',
		model: 'cateto',
		height: 0.42,
		walk: { kind: 'lateral-walk', froude: 0.25 },
		run: { kind: 'gallop', froude: 3 },
		activity: 'diurnal',
		sources: [
			'ADW: 30–50 cm at the shoulder',
			'Marinho et al. 2019, Neotrop. Biol. Conserv. 14:499: diurnal-crepuscular, groups of 5–25',
			'SBMz 2025: Dicotyles tajacu (formerly Pecari tajacu)',
			'AJ83 (gaits)'
		]
	},
	'veado-mateiro': {
		scientific: 'Mazama rufa',
		name: 'Veado-mateiro',
		model: 'veado',
		height: 0.7,
		walk: { kind: 'lateral-walk', froude: 0.2 },
		run: { kind: 'gallop', froude: 4 },
		activity: 'cathemeral',
		sources: [
			'ADW: 65–80 cm at the shoulder; active by day and night, alone; leaps and freezes when chased',
			'Peres et al. 2021, Front. Genet. 12:742870: the Atlantic Forest red brocket is M. rufa (formerly M. americana)',
			'AJ83 (gaits)'
		]
	},
	'cachorro-do-mato': {
		scientific: 'Cerdocyon thous',
		name: 'Cachorro-do-mato',
		model: 'cachorro-do-mato',
		height: 0.37,
		walk: { kind: 'lateral-walk', froude: 0.3 },
		run: { kind: 'trot', froude: 1.2 },
		activity: 'crepuscular',
		sources: [
			'Pró-Carnívoros (Courtenay & Maffei 2004): 37 cm at the shoulder; crepuscular-nocturnal, alone or in groups of 2–5',
			'AJ83: canids trot at F 0.5–2.5'
		]
	},
	'onca-parda': {
		scientific: 'Puma concolor',
		name: 'Onça-parda',
		model: 'onca-parda',
		height: 0.65,
		walk: { kind: 'lateral-walk', froude: 0.3 },
		run: null,
		activity: 'crepuscular',
		sources: [
			'Minnesota Zoo: 2.0–2.5 ft at the shoulder; Pró-Carnívoros: more active at dusk and at night',
			'US17: felid lateral walk',
			'AJ83 (speeds)'
		]
	},
	tapiti: {
		scientific: 'Sylvilagus tapetillus',
		name: 'Tapiti',
		model: 'tapiti',
		height: 0.18,
		walk: { kind: 'lateral-walk', froude: 0.3 },
		// Rabbits leap far for their size: hops about 30 cm long in the game's scale (escape hops exceed 1 m).
		run: { kind: 'half-bound', froude: 6, stride: 1 },
		activity: 'nocturnal',
		sources: [
			'HMW Lagomorphs (Wilson et al. 2016): head-body 38–42 cm, ear 4–5 cm; standing height estimated',
			'Cordeiro-Estrela 2022: four Brazilian Sylvilagus; the Atlantic Forest ones are S. minensis / S. tapetillus',
			'UFRGS: nocturnal; Rossi et al. (Mamíferos do Brasil): first escape hop over 1 m, zig-zag',
			'AJ83 (gaits)'
		]
	},
	jaguatirica: {
		scientific: 'Leopardus pardalis',
		name: 'Jaguatirica',
		model: 'jaguatirica',
		height: 0.45,
		walk: { kind: 'lateral-walk', froude: 0.3 },
		run: null,
		activity: 'nocturnal',
		sources: [
			'San Diego Zoo Wildlife Alliance: 40–50 cm at the shoulder',
			'UFRGS: nocturnal; climbs, jumps and swims',
			'US17: felid lateral walk',
			'AJ83 (speeds)'
		]
	},
	'caranguejo-uca': {
		scientific: 'Ucides cordatus',
		name: 'Caranguejo-uçá',
		model: 'caranguejo',
		height: 0.08,
		// Strides set so the legs cycle at about 4–5 Hz, as a scuttling crab's do (estimate).
		walk: { kind: 'sideways', froude: 0.4, stride: 0.16 },
		run: { kind: 'sideways', froude: 2, duty: 0.45, stride: 0.3 },
		activity: 'cathemeral',
		sources: [
			'ICMBio/SALVE: carapace up to 10 cm wide; height estimated',
			'UFBA Qualibio: in the burrow at high tide, out at low tide',
			'crabs walk sideways (see report)'
		]
	},
	'tatu-galinha': {
		scientific: 'Dasypus novemcinctus',
		name: 'Tatu-galinha',
		model: 'tatu',
		height: 0.2,
		walk: { kind: 'lateral-walk', froude: 0.3 },
		run: { kind: 'trot', froude: 1.5 },
		activity: 'crepuscular',
		sources: [
			'ICMBio ficha: head-body 39.5–57.3 cm, tail 29–45 cm; standing height estimated',
			'UFRGS: dusk and night',
			'AJ83 (gaits)'
		]
	},
	'jabuti-tinga': {
		scientific: 'Chelonoidis denticulatus',
		name: 'Jabuti-tinga',
		model: 'jabuti',
		height: 0.17,
		// A step about a third of the shell long, near one stride a second (estimate).
		walk: { kind: 'crawl', froude: 0.03, stride: 0.25 },
		run: null,
		activity: 'cathemeral',
		sources: [
			'ICMBio/SALVE 2025 (doi:10.37002/salve.ficha.20811.3): forests ("raramente encontrada em áreas abertas"), active by day and night, eats mostly fruit and disperses seeds; EN',
			'Wikipedia/Animália Park: shell about 40 cm long on average; shell height estimated',
			'tortoises walk at high duty factors and very low F (see report)'
		]
	},
	'sapo-cururu': {
		scientific: 'Rhinella icterica',
		name: 'Sapo-cururu',
		model: 'sapo',
		height: 0.08,
		// Short hops of about a body length, two a second; bigger ones when it hurries (estimate).
		walk: { kind: 'hop', froude: 0.4, speed: 0.6, stride: 0.3 },
		run: { kind: 'hop', froude: 1.5, speed: 1.6, stride: 0.55 },
		activity: 'nocturnal',
		sources: [
			'UFRGS: R. icterica, 10–19 cm snout-vent; nocturnal; sitting height estimated',
			'AmphibiaWeb: sit-and-wait predator of the Atlantic Forest'
		]
	},
	'saira-sete-cores': {
		scientific: 'Tangara seledon',
		name: 'Saíra-sete-cores',
		model: 'passaro',
		height: 0.09,
		walk: null,
		run: null,
		activity: 'diurnal',
		sources: ['perches and hops along branches (see report)']
	},
	'sabia-laranjeira': {
		scientific: 'Turdus rufiventris',
		name: 'Sabiá-laranjeira',
		model: 'passaro',
		height: 0.13,
		walk: null,
		run: null,
		activity: 'diurnal',
		sources: ['WikiAves: 20–25 cm long; sings mostly at dawn and dusk; standing height estimated']
	},
	jacutinga: {
		scientific: 'Aburria jacutinga',
		name: 'Jacutinga',
		model: 'jacutinga',
		height: 0.38,
		walk: null,
		run: null,
		activity: 'diurnal',
		sources: [
			'WikiAves: 64–74 cm long; arboreal, alone or in pairs; swallows palm fruits whole; standing height estimated'
		]
	},
	colhereiro: {
		scientific: 'Platalea ajaja',
		name: 'Colhereiro',
		model: 'colhereiro',
		// The coordinator's figure for the standing bird (WikiAves: 68.5–86.5 cm long).
		height: 0.8,
		walk: { kind: 'biped-walk', froude: 0.15 },
		run: { kind: 'biped-run', froude: 0.8 },
		activity: 'cathemeral',
		sources: [
			'WikiAves: 68.5–86.5 cm long; pink, wings strongly pink with reddish feathers, pale neck, red legs, grey spoon bill, bare head; sifts the water swinging the bill; lives in flocks on mudflats and mangroves',
			'Replaces the guará (Eudocimus ruber), whose current range is SP to SC (fact check, 26/10)'
		]
	}
};

/** ART.md §3 height in world units for a real height in metres. */
export const gameHeight = (metres: number) => (metres * ANIMAL_FACTOR) / UNIT_METRES;

/** AJ83 speed (u/s) at Froude number `froude` for a hip `hip` u high. */
export const froudeSpeed = (froude: number, hip: number) => Math.sqrt(froude * GRAVITY_UNITS * hip);

/** AJ83 stride (u) at Froude number `froude` for a hip `hip` u high. */
export const froudeStride = (froude: number, hip: number) =>
	AJ83.strideCoefficient * hip * froude ** AJ83.strideExponent;
