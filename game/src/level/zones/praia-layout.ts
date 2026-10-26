/**
 * The Praia e Costão as control points (PARK.md §5.1, park-plan.py), in world
 * coordinates (x east, z south). praia.ts builds the zone from these.
 *
 * Shape: the sea for x < 0 and a beach from the water's edge (x ≈ −8) to x 2;
 * the restinga from x 0 to 40, crossed by a raised boardwalk along x 4; the
 * forest from x 40 east. The costão juts out into the sea at z −96..−78: a
 * rounded rock whose top is highest at its root (−12, −88), the viewpoint,
 * falling in walkable slopes and low ledges to the water; a rock shelf with
 * four tide pools lies at its foot (−8, −74). Two green turtles feed in the
 * water off it, one of them caught in fishing line.
 */
import type { XZ } from './spec.ts';

// --- The costão and the tide pools ----------------------------------------------------------

/**
 * The costão's rock: a dome highest at `peak`, falling `fall` per unit to its
 * `floor` (the low outer ledges), over park-plan.py's COSTAO polygon and its
 * root on the land side (x ≥ `rootX`); the sea round it keeps its depth, so
 * the dome's edge is a low cliff into the water. Its top steps down in a few
 * `ledge`-high ledges.
 */
export const COSTAO_ROCK = {
	peak: [-12, -88] as XZ,
	top: 5.5,
	fall: 0.33,
	floor: 1.5,
	rootX: -13,
	ledge: 0.5
} as const;

/** The viewpoint on the costão (PARK.md: the trail's end, the "costão tip"), and its camera. */
export const COSTAO_LOOKOUT = { at: [-12, -88] as XZ, cameraBack: 2.5, cameraLift: 2.2 } as const;

/** The rock shelf at the costão's foot: flat at `y` within r0 of the centre, blending out by r1. */
export const SHELF = { centre: [-7.5, -75] as XZ, y: 0.4, r0: 6.5, r1: 8.5 } as const;

/**
 * The four tide pools in the shelf, each with its creature (the props'
 * `custom-*` where one exists). Water stands `water` u over the sea at
 * `depth` over the bed; "não pise" reaches `noStep` past each rim.
 */
export const POOLS: readonly { id: string; at: XZ; radius: number; species: string; model: string }[] = [
	{
		id: 'poca-ourico',
		at: [-10.5, -76.5],
		radius: 1.3,
		species: 'ourico-do-mar',
		model: 'custom-ourico-do-mar'
	},
	{
		id: 'poca-estrela',
		at: [-7, -79],
		radius: 1.1,
		species: 'estrela-do-mar',
		model: 'custom-estrela-do-mar'
	},
	{ id: 'poca-anemona', at: [-5.5, -72.5], radius: 1.2, species: 'anemona', model: 'custom-anemona' },
	{ id: 'poca-peixe', at: [-10, -71.5], radius: 1.2, species: 'peixe-de-poca', model: '' }
];
export const POOL_WATER = { surface: 0.3, depth: 0.5, noStep: 0.7, look: 1.2 } as const;

/** The green turtles in the water off the costão (props `custom-tartaruga-verde` and its `-linha` variant). */
export const TURTLES: readonly { id: string; at: XZ; state: string; model: string }[] = [
	{ id: 'tartaruga-algas', at: [-24, -105], state: 'feeding', model: 'custom-tartaruga-verde' },
	{ id: 'tartaruga-linha', at: [-24, -74], state: 'entangled', model: 'custom-tartaruga-verde-linha' }
];
/** A turtle swims this far under the surface. */
export const TURTLE_DEPTH = 0.3;

// --- The restinga boardwalk (P4) ------------------------------------------------------------

/**
 * The raised boardwalk along x 4 (PARK.md: z −20 to −140), in two runs that
 * leave the trail to the costão a crossing at ground level: each run ramps up
 * `ramp` u from the sand to its deck and down again. Each deck vertex stands
 * `deck` over the highest sand within half a segment of it, so the deck clears
 * the dunes between vertices. The props' walkway tiles, set 3 u lower than the
 * Copa's.
 */
export const BOARDWALK = {
	x: 4,
	runs: [
		{ id: 'restinga-norte', from: -20, to: -74 },
		{ id: 'restinga-sul', from: -88, to: -140 }
	],
	deck: 1,
	ramp: 6,
	segment: 8,
	width: 2
} as const;

/** P4's plants, photographed from the boardwalk; the two lookouts face the bromélia and the cactus. */
export const RESTINGA_SUBJECTS: readonly { species: string; at: XZ; lift: number; lookout: string }[] = [
	{ species: 'bromelia', at: [11, -47], lift: 0.6, lookout: 'restinga-norte' },
	{ species: 'pitangueira', at: [10.5, -97], lift: 1.6, lookout: '' },
	{ species: 'cacto', at: [11, -116], lift: 1, lookout: 'restinga-sul' }
];
export const BOARDWALK_LOOKOUT = { cameraBack: 2.5, cameraLift: 2 } as const;

/** Restinga plants survival has no kind for, scattered in the restinga (data for their models). */
export const RESTINGA_PLANTS = {
	region: { x0: 7, x1: 37, z0: -148, z1: -14 },
	spacing: 9,
	mix: { cacto: 1, pitangueira: 1 }
} as const;

// --- Beach trash (P1) ------------------------------------------------------------------------

export const TRASH: readonly [XZ, string][] = [
	[[-3, -30], 'bottle'],
	[[-5, -44], 'bottle-cap'],
	[[-2, -58], 'can'],
	[[-1, -66], 'straw'],
	[[-4, -106], 'bag'],
	[[-2, -118], 'cup'],
	[[-5, -131], 'glass-bottle'],
	[[-3, -145], 'snack-wrapper']
];
/** Plastic against the rest, for P1's counter. */
export const TRASH_MATERIALS: Record<string, 'plastic' | 'other'> = {
	bottle: 'plastic',
	'bottle-cap': 'plastic',
	straw: 'plastic',
	bag: 'plastic',
	cup: 'plastic',
	'snack-wrapper': 'plastic',
	can: 'other',
	'glass-bottle': 'other'
};

// --- Trails, checkpoints, signs ----------------------------------------------------------------

export const TRAIL_HALF_WIDTH = 2;
export const TRAIL_CLEARANCE = 2.9;
/** level/layout.ts TRAIL_MARKS (the Reserva's rule), copied so zones never import the layout. */
export const TRAIL_MARKS = { spacing: 20, trunkReach: 6, postOut: 0.6, postSearch: 3, height: 1.6 } as const;

/** PARK.md §5.1's trail from the north portal to the costão, the way to the boardwalk and to the tide pools. */
export const TRAILS: Record<string, readonly XZ[]> = {
	'praia-trilha': [
		[70, 0],
		[60, -30],
		[30, -60],
		[6, -80],
		[-4, -84.5],
		[-12, -88]
	],
	'praia-passarela': [
		[66, -2],
		[40, -10],
		[14, -17],
		[5, -18.5]
	],
	'praia-pocas': [
		[-4, -84.5],
		[-2, -78],
		[-1.5, -75.5]
	]
};

export const CHECKPOINTS = {
	praia: [-1, -38] as XZ,
	costao: [-2, -82] as XZ,
	restinga: [7, -143] as XZ
} as const;

/** Targets that are not places above: P1's beach, P2's shelf. */
export const TARGETS = { praia: [-2, -36] as XZ, pocas: [-1.5, -75.5] as XZ } as const;

export const SIGNS = {
	praia: { at: [66, -8] as XZ, label: 'LABEL_PRAIA' },
	restinga: { at: [7.5, -16] as XZ, label: 'LABEL_RESTINGA' },
	pocas: { at: [-1, -73] as XZ, label: 'LABEL_POCAS' }
} as const;

// --- Animals (PARK.md §5.1) -------------------------------------------------------------------

export const HOMES: Record<
	string,
	{
		at: XZ;
		group: number;
		radius: number;
		rarity: 'common' | 'uncommon' | 'rare' | 'legendary';
		time: 'day' | 'dawn' | 'dusk';
		fact: string;
	}
> = {
	'tartaruga-verde': {
		at: [-24, -105],
		group: 2,
		radius: 12,
		rarity: 'rare',
		time: 'day',
		fact: 'FACT_TARTARUGA_VERDE'
	},
	'caranguejo-de-pedra': {
		at: [-24, -88],
		group: 6,
		radius: 6,
		rarity: 'common',
		time: 'day',
		fact: 'FACT_CARANGUEJO'
	},
	atoba: { at: [-33, -87], group: 3, radius: 10, rarity: 'uncommon', time: 'day', fact: 'FACT_ATOBA' },
	gaivota: { at: [-4, -122], group: 4, radius: 14, rarity: 'common', time: 'day', fact: 'FACT_GAIVOTA' },
	saira: { at: [44, -62], group: 4, radius: 8, rarity: 'common', time: 'day', fact: 'FACT_SAIRA' },
	sabia: { at: [45, -112], group: 2, radius: 8, rarity: 'common', time: 'dawn', fact: 'FACT_SABIA' }
};

// --- Vegetation (≤ 1,600 placements, PARK.md §8) ---------------------------------------------------

export const MAX_INSTANCES = 1600;
/** Where the forest starts, and the restinga's few trees. */
export const FOREST_X = 40;
export const TREE_SPACING = 5.6;
export const RESTINGA_TREE_DENSITY = 0.18;
export const ROCK_SPACING = 10;
export const DECORATION_SPACING = 4.2;
/** Trunks and rocks keep this from the boardwalk's centre line, plus their radius. */
export const BOARDWALK_CLEARANCE = 2;
