/**
 * The Vale das Cachoeiras as control points (PARK.md §4.1, park-plan.py), in
 * world coordinates (x east, z south). vale.ts builds the zone from these,
 * the way level/build.ts builds the Reserva from layout.ts.
 *
 * Shape: a lower valley (floor 20–30) entered from the F1 portal at (160, 70);
 * the Cachoeira Grande's sheer face at x 250.5 with the upper valley (50 → 60)
 * behind it; the plunge pool below the fall; a 5 u cascade out of the pool
 * into a gorge that the suspension bridge crosses at x 205; south of the pool a
 * hill climbing to a rock shelf at 39.5, and from the shelf seven stones in
 * the cleft beside the face, 1.5 u higher each, up to the rim at 50; then the
 * upper valley along the stream to the spring at (300, 20).
 */
import type { XZ } from './spec.ts';

// --- Terrain -------------------------------------------------------------------------

/** The Cachoeira Grande: its lip and foot (spec.ts PARK_RIVER's stations at x 250.5 and 249.5), top and bottom. */
export const FALL = {
	lip: [250.5, 38 + (8 * 5.5) / 18] as XZ,
	foot: [249.5, 38 + (8 * 6.5) / 18] as XZ,
	top: 50,
	bottom: 30
} as const;

/**
 * Near the fall the wall is one sheer face: vertices west of it keep the
 * lower valley, east of it the upper. It stands at x 250.5 up to z `recessZ`
 * (the fall, and the rock tongue beside it the last stone lands on), then
 * steps back to `recessX`, so the stones below the last two stay out of reach
 * of the rim. It runs from z0 to z1 and blends back to the skeleton's 6 u
 * wall over `blend` u beyond them.
 */
export const FACE = { x: 250.5, recessZ: 50.5, recessX: 255.5, z0: 30, z1: 112, blend: 6 } as const;

/**
 * The plunge pool: a capsule from the fall's foot to the pool centre (238, 46).
 * Deep in the middle; on its south side a shallow rim to wade on, then a
 * beach; on its north side deep water up to a low rock lip, so nobody wades
 * round it to the north bank (the bridge is the way over).
 */
export const POOL = {
	a: FALL.foot,
	b: [238, 46] as XZ,
	water: 30,
	/** Deepest bed below the water, out to `deepTo` from the axis (north: `northDeepTo`). */
	deep: 2.6,
	deepTo: 4,
	northDeepTo: 5.5,
	/** South: `shelfDepth` deep at `shelfAt`, `rimDepth` at `rimTo` (the wadeable rim), the beach up to the terrace by `beachTo`. */
	shelfAt: 6.5,
	shelfDepth: 0.58,
	rimTo: 9,
	rimDepth: 0.12,
	beachTo: 10.5,
	/** North: 1.2 deep at `lipAt`, then straight up to the terrace. */
	lipAt: 7,
	lipDepth: 1.2,
	/** The terrace around it, 0.5 above the water, falling 0.3 per unit past `terraceTo`. */
	terrace: 0.5,
	terraceTo: 11,
	terraceFall: 0.3,
	/** Wading depth (avatar-context's water surface reads up to 0.65). */
	wade: 0.6,
	/** No tree within this of the axis: the clearing round the pool. */
	clearing: 14
} as const;

/** The spring: a round basin, its eye deep, a wadeable rim, in a clearing of the upper valley. */
export const SPRING = {
	centre: [300, 20] as XZ,
	water: 59,
	/** Bed 1.4 deep to `eyeTo`, `shelfDepth` at `shelfAt`, `rimDepth` at `rimTo`, the bank `bank` above by `bankTo`. */
	deep: 1.4,
	eyeTo: 1.6,
	shelfAt: 3,
	shelfDepth: 0.58,
	rimTo: 4.5,
	rimDepth: 0.1,
	bankTo: 5.5,
	bank: 0.6,
	wade: 0.6,
	clearing: 11
} as const;

/** The hill south of the pool: `rise` u over the floor, from z0 to z1 north to south and x0 to x1 west to east, gone by z2..z3. */
export const HILL = { rise: 9.5, z0: 56, z1: 80, x0: 226, x1: 244, z2: 90, z3: 110 } as const;

/** The rock shelf the stones start from, flush with the hill's top, between the hill and the face. */
export const SHELF = { x0: 244.5, z0: 77.6, z1: 86, y: 39.5 } as const;

/** The cleft between the hill and the face, under the stones: its floor rising south from z0 to z1. */
export const CLEFT = { x0: 246.6, z0: 46, z1: 77.5, floor: 30.5, rise: 3.5, riseFrom: 48 } as const;

/**
 * Obby (V5): seven stones up the cleft beside the fall, 1.5 u higher each,
 * from the shelf's edge to the rim at the fall's top. Gaps (edge to edge) are
 * fractions of jumpReach(1.5), PARK.md's 0.45–0.6.
 */
export const STONES = {
	takeoff: [248, 78.2] as XZ,
	/** Where the line points; the last stone lands near it. */
	toward: [249.6, 47] as XZ,
	radius: 1.1,
	/** The last stone is wider and reaches over the face onto the rim. */
	lastRadius: 1.25,
	rise: 1.5,
	gapFractions: [0.45, 0.5, 0.55, 0.6, 0.55, 0.5, 0.45],
	/** Stones alternate this far left and right of the line (the last one sits on it). */
	zigzag: 0.4,
	/** Stone that holds the gold leaf (1-based). */
	goldLeafStone: 4,
	/** Feet before the first jump, back on the shelf, and after the last one, on the upper valley. */
	padBack: 2,
	landing: [253.5, 47.2] as XZ
} as const;

/** Bridge abutments: flat ground at `y` within r0 of each end, blending out by r1. */
export const ABUTMENT = { y: 26.5, r0: 2.5, r1: 5.5 } as const;

// --- Places --------------------------------------------------------------------------

/** The suspension bridge over the gorge (V3): 16 u from the south bank to the north bank. */
export const BRIDGE = {
	from: [205, 52] as XZ,
	to: [205, 36] as XZ,
	width: 2,
	/** One plank per half unit. */
	planks: 32
} as const;

/** The pool viewpoint (V1): a rock platform south-west of the pool, framed on the fall. */
export const LOOKOUT = {
	at: [236, 58] as XZ,
	y: 31.5,
	r0: 2.2,
	r1: 4,
	/** The camera behind the feet, `cameraLift` above them, looking at the fall's middle (x, y, z). */
	camera: [233.8, 60.7] as XZ,
	cameraLift: 2.4,
	target: [250, 40, 41] as const
} as const;

/** The camera-trap trunk (V4): a jequitibá east of the muriqui trail, watching the group at (216, 12). */
export const CAMERA_TRUNK = { at: [219.5, 18.5] as XZ, scale: 1.6, mountY: 1.2 } as const;

/** Iara's sign at the way in. */
export const ZONE_SIGN = { at: [170, 65.2] as XZ, height: 2.2 } as const;

export const TRAIL_HALF_WIDTH = 2;
/** Trees keep this from a trail's centre line (plus their trunk): the forest comes close. */
export const TRAIL_CLEARANCE = 2.9;
/** Trail marks: level/layout.ts TRAIL_MARKS (the Reserva's rule), copied so zones never import the layout. */
export const TRAIL_MARKS = { spacing: 20, trunkReach: 6, postOut: 0.6, postSearch: 3, height: 1.6 } as const;

/** The trails (park-plan.py TRAILS["Vale"]): the way to the pool, the bridge spur, the muriqui trail, the climb and the spring. */
export const TRAILS: Record<string, readonly XZ[]> = {
	'vale-trilha': [
		[160, 70],
		[200, 70],
		[222, 64],
		[236, 58]
	],
	'vale-ponte': [
		[204, 68.9],
		[205, 60],
		[205, 54]
	],
	'vale-muriquis': [
		[205, 34],
		[212, 22],
		[220, 10],
		[222, 1]
	],
	'vale-encosta': [
		[236, 58],
		[240.5, 63],
		[244, 71],
		[247, 80]
	],
	'vale-nascente': [
		[253.5, 47.2],
		[262, 42.5],
		[270, 37],
		[284, 31.5],
		[298, 27]
	]
};

/** V2: the visitors' trash round the pool, all on the south side. */
export const TRASH: readonly [XZ, string][] = [
	[[239.5, 55.5], 'bottle'],
	[[244.5, 55.5], 'can'],
	[[232.5, 54.5], 'bag'],
	[[236.8, 61], 'orange-peel'],
	[[229, 51], 'straw'],
	[[246, 57.5], 'snack-wrapper']
];

/** V5: seedlings round the spring, this far from its centre, in these directions (away from the outflow and the trail). */
export const PLANTING = {
	radius: 7.5,
	directions: [
		[-1, -1],
		[0, -1],
		[1, -1],
		[1, 0],
		[1, 1]
	] as readonly XZ[]
} as const;

/** Checkpoints besides the portal (PARK.md: the portal, the pool, the bridge's north end, the spring). */
export const CHECKPOINTS = {
	poco: [232.5, 60.5] as XZ,
	ponteNorte: [205, 32] as XZ,
	nascente: [295, 29.5] as XZ
} as const;

/** Mission targets that are not places above. */
export const TARGETS = {
	poco: [240.5, 56] as XZ,
	ponteNorte: [205, 33.5] as XZ,
	nascente: [298, 27] as XZ
} as const;

// --- Animals (PARK.md §4.1) ------------------------------------------------------------

export const HOMES = {
	muriquis: { at: [216, 12] as XZ, group: 5, radius: 10 },
	bugios: { at: [194, 110] as XZ, group: 4, radius: 12 },
	/** The sloth's tree, a big broadleaf crown at the pool clearing's edge (it browses young leaves of many trees). */
	preguica: { at: [226.5, 57.5] as XZ, group: 1, radius: 2 },
	jacutinga: { at: [288, 46] as XZ, group: 1, radius: 8 }
} as const;

/** Hand-placed trees: the muriquis' and bugios' canopy, the sloth's jequitibá, the marked trunk. */
export const SPECIAL_TREES: readonly [string, XZ, number][] = [
	['jequitiba', HOMES.preguica.at, 1.5],
	['jequitiba', CAMERA_TRUNK.at, CAMERA_TRUNK.scale],
	['jequitiba', [211, 9], 1.5],
	['jequitiba', [226, 5], 1.4],
	['jequitiba', [196, 112], 1.8],
	['jequitiba', [189, 104], 1.5]
];

// --- Vegetation (≤ 1,600 placements, PARK.md §8) -----------------------------------------

export const MAX_INSTANCES = 1600;
export const TREE_SPACING = 5.2;
export const ROCK_SPACING = 8;
export const DECORATION_SPACING = 4;
/** Riverside forest: within this of the river's water. */
export const RIPARIAN = 12;
