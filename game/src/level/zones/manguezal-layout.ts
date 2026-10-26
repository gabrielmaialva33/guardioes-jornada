/**
 * The Manguezal's content as control points (PARK.md §5.2, park-plan.py), in
 * world coordinates; manguezal.ts turns them into the zone's map and story
 * data, zone-local. Plain data only.
 *
 * The plan's two canoe landings, (2, 222) and (10, 255), lie on the same bank of
 * the river, so the river alone cannot make the canoe the only way across. The
 * mangrove is therefore at high tide ("maré cheia"): water over its mud, too deep
 * to wade, with the mud showing only on a few banks and the propagule patch.
 * The arrival trail runs on a sandy levee to the first landing; the boardwalk,
 * the second landing, the patch and the colhereiros' hide stand in the flooded
 * mangrove, which the canoe alone reaches.
 */
import type { XZ } from './spec.ts';

/** The high tide: the mangrove's floor under the water, and the exposed mud of its banks and patch. */
export const TIDE = {
	/** Flooded floor: 0.9 under the sea's −0.5, past the runtime's 0.65 drowning depth. */
	floor: -1.4,
	/** Exposed mud (banks, the propagule patch): 0.6 over the water. */
	mud: 0.1,
	/** Shore blend into the flood, in u. */
	shore: 3
} as const;

/**
 * The flooded mangrove: spec.ts MANGUE, widened south-east so the colhereiros' hide
 * stands 20 u inside it (PARK.md's (52, 282) is 6 u outside the plan's polygon).
 */
export const TIDAL: readonly XZ[] = [
	[-30, 196],
	[40, 186],
	[70, 214],
	[72, 262],
	[74, 300],
	[20, 306],
	[-26, 296],
	[-34, 250]
];

/** Ground within this many u of the north seam (z 160) keeps the stitched skeleton's heights. */
export const SEAM_KEEP = 6;
/** The zone's edges are rails (soft walls) but for the way in from the Reserva. */
export const FENCE_MARGIN = 2;

/** The arrival trail (PARK.md §5.2): south portal → the first landing's pier, on its levee where it crosses the flood. */
export const ARRIVAL_TRAIL: readonly XZ[] = [
	[40, 160],
	[34, 186],
	[24, 206],
	[12, 219]
];
export const TRAIL_HALF_WIDTH = 2;
/** Trees and rocks keep this far from the trail's centre line. */
export const TRAIL_CLEARANCE = 2.9;
/** The levee under the trail: a flat sandy top `halfWidth` either side, sides falling `slope` per u into the flood. */
export const LEVEE = { halfWidth: 3.5, top: 1, slope: 0.8 } as const;

/**
 * The boardwalk loop (PARK.md §5.2: radius 26, raised 1.5 u). Its centre moves
 * from the plan's (18, 246) to (24, 256): there the loop would cross the river
 * and pass 3 u from the first landing, a jump from the arrival side. A polygon
 * of `segments` chords from vertex 0 due east, turning south (+z) first; decks
 * 1.5 over the water, rails both sides.
 */
export const BOARDWALK = {
	centre: [24, 256] as XZ,
	radius: 26,
	segments: 36,
	width: 2,
	/** Deck top over the water (−0.5): 1.5 u. */
	y: 1,
	railHeight: 1.1,
	/** Over the canoe channel the deck rises this high over the water, at every vertex within `archReach` (along the loop) of it. */
	archOverWater: 2.6,
	archReach: 10
} as const;
/** cos and sin of 10° (360° / BOARDWALK.segments), as exact literals: the determinism scan allows no Math.cos. */
export const STEP_COS = 0.984807753012208;
export const STEP_SIN = 0.17364817766693033;
/** Loop vertices where the spurs leave: the hide (outwards), the propagule patch (outwards), the second pier (inwards). */
export const JUNCTION = { hide: 4, patch: 15, pier: 17 } as const;
/** Rails stop this far short of a junction, leaving the way onto a spur open. */
export const RAIL_GAP = 1.5;

/**
 * Mission M1's canoe (PARK.md §6 Canoe spec): the channel from the river at the
 * first landing, under the boardwalk's west arc, to the second landing inside
 * the loop; each landing's water anchor (the plan's points) and its exit on a pier.
 */
export const CANOE = {
	channel: [
		[2, 222],
		[5, 232],
		[8, 244],
		[10, 255]
	] as readonly XZ[],
	halfWidth: 3,
	current: 0.35,
	landings: [
		{ id: 'embarque', water: [2, 222] as XZ, exit: [4, 223] as XZ },
		{ id: 'desembarque', water: [10, 255] as XZ, exit: [10, 257.5] as XZ }
	]
} as const;
/** The piers run this far past their exits, so the exit stands on the deck. */
export const PIER_OVERRUN = 0.75;

/** The colhereiros' hide (M5): a screened deck at the end of a spur from the loop, facing their roost. */
export const HIDE = {
	at: [52, 282] as XZ,
	half: 2.5,
	/** The spur arrives at the middle of the north side, through a gap in its rail this wide either side. */
	entryGap: 1,
	screenHeight: 2.2,
	/** The lookout stands this far in from the west screen; its camera looks out over it. */
	lookoutIn: 1.2,
	cameraLift: 1.6,
	/** Where the flock settles at dusk, in the mangrove's crowns, and where it flies in from (the sea). */
	roost: [30, 292] as XZ,
	roostHeight: 4,
	roostTrees: 4,
	arrivesFrom: [-40, 286] as XZ,
	/** No tree on the line from the hide to the roost, this far either side. */
	sightClear: 3
} as const;

/** The propagule patch (M3): a cleared mud disk, its 6 planting spots on a ring, reached by a spur ending on a low platform. */
export const PATCH = {
	centre: [-14, 280] as XZ,
	radius: 6,
	ring: 3,
	spots: 6,
	/** The spur ends `platformIn` inside the mud's edge, low enough to step down onto it; its last `platform` u are flat. */
	platformIn: 0.5,
	platform: 2,
	platformY: 0.6
} as const;

/** Mud banks where the caranguejos-uçás show (M2), each `radius` u, out of a jump from the boardwalk. */
export const CRAB_BANKS: readonly XZ[] = [
	[24, 242],
	[36.1, 249],
	[31, 268.1],
	[5, 289],
	[43, 223.1]
];
export const CRAB_BANK_RADIUS = 2;
/** The defeso bank, seen from the arrival levee (park-plan.py's crab mark at (36, 212), moved off the levee's jump), and its sign on the levee. */
export const DEFESO_BANK: XZ = [40, 214];
export const DEFESO_SIGN: XZ = [28.5, 204];
/** Watching a crab: from the deck nearest its bank, within this radius. */
export const CRAB_WATCH = 3;

/** M4: trash caught in the roots, beside the loop at these vertices, `out` u past the deck's centre line on the `side` (1 outwards). */
export const TRASH = {
	vertices: [2, 9, 13, 20, 31],
	side: [1, 1, -1, 1, -1],
	variants: ['bottle', 'bag', 'can', 'bottle', 'bag'],
	out: 1.9,
	/** Over the water (−0.5), caught on a root clump, so a player on the deck is within reach (missions/story.ts: 1.4 u up or down). */
	y: 0,
	radius: 2.2,
	/** The root clump behind each piece. */
	clumpOut: 0.9
} as const;

/** Animal homes (PARK.md §10, the Guia da Mata's ids). The garça-branca has no Guia entry yet. */
export const HOMES = {
	caranguejos: { at: CRAB_BANKS[0], group: 12, radius: 30 },
	colhereiros: { at: HIDE.roost, group: 14, radius: 12 },
	garca: { at: CRAB_BANKS[0], group: 1, radius: 14 },
	capivaras: { at: [31, 178] as XZ, group: 4, radius: 10 }
} as const;

/** The zone's sign, just inside the portal, beside the trail. */
export const ZONE_SIGN = { at: [43.6, 168] as XZ, height: 2.2 } as const;

/** The checkpoint on the levee, short of the first pier. */
export const EMBARQUE: XZ = [14.5, 216.5];

/** The vegetation: red mangroves over the flood (with their prop roots), restinga and lowland trees inland. */
export const MANGROVE = {
	spacing: 3.6,
	scale: [0.85, 1.3],
	clumpSpacing: 6,
	clumpScale: [0.45, 0.7]
} as const;
export const INLAND = { spacing: 7, scale: [0.8, 1.25] } as const;
export const COVER = { spacing: 4.5, scale: [0.6, 1.2] } as const;
/** Kept clear of trunks, past the edge of each: the decks, the channel, the levee's top, the banks and the patch. */
export const CLEAR = { deck: 1.2, channel: 1.5, levee: 1, bank: 1, patch: 1.5 } as const;
export const MAX_INSTANCES = 1600;

/** Trail marks (PARK.md §3, level/layout.ts TRAIL_MARKS's values): along the arrival trail, and on the loop's outer rail posts. */
export const MARKS = { spacing: 20, trunkReach: 6, postOut: 0.6, postSearch: 3, height: 1.6 } as const;
