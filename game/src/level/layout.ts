/**
 * Every control point of the story map ("Reserva da Iara", game/LEVEL.md), in
 * one place so the owner can move things without touching the builder. The
 * coordinates are LEVEL.md's and game/docs/level-plan.py's; where the builder
 * derives a position instead (the obby pieces, from their gaps), the comment
 * says so. Units: avatar H = 3 u; x grows east towards the serra, z south.
 *
 * Plain data only: no Math calls here (the determinism scan covers this file).
 */
import { MURIQUI_HOLDS } from '../animation/animals/index.ts';

export type XZ = readonly [number, number];

/** Fixed seed of the story map's noise and vegetation streams; it never changes per player. */
export const STORY_SEED = 0x1a8a2026;
/**
 * Bump on any change that alters the built map; saves and the golden test record it.
 * 2: the east portal (F1). 3: the Act 1 additions (PARK.md §3), the north and south portals and the gorge.
 */
export const STORY_VERSION = 3;

/** Facing angles about +y, 0 = +z (south), the engine's convention (atan2(x, z)). */
// biome-ignore lint/suspicious/noApproximativeNumericConstant: the determinism scan allows no Math member but the exact operations; this literal is Math.PI's exact double.
const PI = 3.141592653589793;
export const FACING = {
	north: PI,
	northEast: (3 * PI) / 4,
	east: PI / 2,
	southEast: PI / 4,
	south: 0,
	southWest: -PI / 4,
	west: -PI / 2,
	northWest: (-3 * PI) / 4
} as const;
export type Facing = keyof typeof FACING;

// --- Relief (LEVEL.md §3) ---------------------------------------------------

export const RELIEF = {
	/** Restinga strip on the west edge. */
	restingaX: 10,
	restingaY: 0.5,
	/** Baixada base level from x 10 to 110, plus value noise of this amplitude, clamped. */
	baixadaFrom: 1.6,
	baixadaTo: 2.8,
	baixadaNoise: 1,
	baixadaMin: 1,
	baixadaMax: 4,
	/** Noise frequency per unit. */
	noiseScale: 0.045,
	/** Encosta: rises from 3 at x 110 to 6 at x 126. */
	encostaFromX: 110,
	encostaToX: 126,
	encostaFromY: 3,
	encostaToY: 6,
	/** East of the encosta outside the plateau and the serra: 6 rising to this at x 150 (gentle, walkable). */
	eastY: 7.5,
	/** Serra top: from serraFromY at x serraFromX to serraToY at the east edge, inside SERRA. */
	serraFromX: 132,
	serraFromY: 11,
	serraToY: 18,
	/** Every map edge rises by this over the last edgeWidth units (then the fence). */
	edgeRise: 2.5,
	edgeWidth: 6,
	/** Mirante plateau: flat top; its faces, like the serra's, are one-cell cliffs. */
	plateauY: 15
} as const;

/** Mirante plateau polygon (LEVEL.md §3). */
export const PLATEAU: readonly XZ[] = [
	[128, 40],
	[158, 40],
	[158, 100],
	[130, 100],
	[126, 70]
];

/**
 * The serra edge north of the plateau (LEVEL.md §3: 10–18, steep forest). A
 * massif with the plateau's cliffs, so it is never climbed: its west face runs
 * through the river head, where the waterfall drops, so nobody walks around
 * the river's source either. Wider than LEVEL.md's "x > 150, z < 40": with a
 * walkable gap between the river head and x 150 the two banks joined in the
 * north and the stones and the bridge stopped mattering.
 */
export const SERRA: readonly XZ[] = [
	[134, 0],
	[160, 0],
	[160, 40],
	[128, 40],
	[132, 30]
];

/** Walking fence: cells closer than this to the map edge are not walkable (the invisible wall at 1 u). */
export const FENCE_MARGIN = 2;

// --- River (LEVEL.md §4) ----------------------------------------------------

/** From the serra to the sea. */
export const RIVER: readonly XZ[] = [
	[132, 30],
	[118, 42],
	[104, 58],
	[94, 76],
	[84, 94],
	[70, 112],
	[56, 128],
	[40, 144],
	[28, 160]
];
/** Index of the river point where the surface is RIVER_SURFACE.topY; it falls linearly by arc length to the last point. */
export const RIVER_TOP_INDEX = 1;
export const RIVER_SURFACE = { topY: 3, seaY: -0.5 } as const;
export const RIVER_HALF_WIDTH = 4.5;
export const RIVER_DEPTH = 1.6;
/** Banks rise at this many u per u from the bed to the ground (under WALK_SLOPE); the bed is where they reach the depth. */
export const RIVER_BANK_SLOPE = 0.8;
/** The small waterfall at the river's head. */
export const WATERFALL: XZ = [132, 30];

/**
 * The stones pool: centred on the river, `halfWidth` u across the crossing axis
 * (LEVEL.md: half-width 10). Along the axis it is as long as the stones need
 * (derived from their gaps in build.ts), so its ends are the two take-offs.
 */
export const POOL = { centre: [94, 76] as XZ, halfWidth: 10 } as const;

// --- Vegetation areas (level-plan.py) --------------------------------------

export const FOREST: readonly (readonly XZ[])[] = [
	// north
	[
		[4, 4],
		[60, 4],
		[96, 6],
		[110, 20],
		[104, 34],
		[80, 38],
		[62, 44],
		[40, 40],
		[20, 44],
		[6, 36]
	],
	// west, around the base
	[
		[4, 52],
		[30, 50],
		[44, 58],
		[46, 70],
		[26, 76],
		[20, 100],
		[34, 108],
		[24, 132],
		[6, 150],
		[4, 100]
	],
	// north bank strip
	[
		[76, 46],
		[96, 44],
		[100, 56],
		[88, 70],
		[76, 62]
	],
	// south-west of the clareira
	[
		[78, 106],
		[90, 98],
		[100, 100],
		[96, 128],
		[86, 150],
		[70, 152],
		[66, 136]
	],
	// south-east, the onça's
	[
		[128, 110],
		[150, 104],
		[158, 120],
		[158, 158],
		[118, 158],
		[126, 134]
	],
	// serra north
	[
		[116, 24],
		[150, 8],
		[158, 30],
		[150, 40],
		[130, 40]
	]
];
/** Indices into FOREST of the two fragments the corridor joins. */
export const CORRIDOR_FRAGMENTS = [0, 1] as const;
/** The pasture gap the corridor closes (FLAG.corridor | FLAG.cleared). */
export const PASTURE: readonly XZ[] = [
	[44, 46],
	[76, 44],
	[78, 58],
	[46, 60]
];
/** Mission 1 planting cells: a line across the pasture, 4 u east of the trilha (2 u planting grid centres). */
export const CORRIDOR_LINE = { from: [59, 49] as XZ, count: 5, stepZ: 2 } as const;
/** Clareira (FLAG.cleared) and its ring of six planting spots. */
export const CLAREIRA = { centre: [112, 118] as XZ, radius: 14, ringRadius: 7 } as const;

// --- Places (LEVEL.md §5) ---------------------------------------------------

export const SPAWN = { at: [34, 92] as XZ, facing: 'northEast' as Facing };
/** The base pad: flat ground around the hub. */
export const BASE = { centre: [34, 85] as XZ, radius: 10, blend: 16 } as const;
export const PLACES = {
	iara: [38, 80],
	viveiro: [27, 79],
	ipe: [30, 70],
	trailSign: [42, 88],
	observationRock: [100, 24],
	cutting: [114, 14],
	jequitiba: [146, 62],
	bridgeFrom: [50, 124],
	bridgeTo: [62, 134]
} as const satisfies Record<string, XZ>;
/** The observation boulder: about 4 u tall; the hiding spot is behind it, away from the cutting. */
export const OBSERVATION_ROCK = { height: 4, radius: 2.9, hideDistance: 4.6, zoneRadius: 3.5 } as const;
/** The jequitibá-rosa next to the cutting. */
export const CUTTING_TREE: XZ = [117, 12];
/**
 * The row of canopy trees from the muriquis towards the cutting (LEVEL.md §10):
 * what logging would cut off. The builder strings branch handholds along it.
 */
export const MURIQUI_ROW: readonly XZ[] = [
	[104, 30],
	[107, 27],
	[110, 24],
	[113, 21]
];
/**
 * Brachiation handholds: spacing and reach come from the fauna module
 * (src/animation/animals MURIQUI_HOLDS, scaled with the muriqui's arm), so the
 * row always matches the animation. Only the height is the map's.
 */
export const MURIQUI_HANDHOLDS = {
	spacingMin: MURIQUI_HOLDS.min,
	spacingMax: MURIQUI_HOLDS.max,
	/** Longest swing between two handholds; no spacing may exceed it. */
	maxReach: MURIQUI_HOLDS.reach,
	/** Handhold height above the ground: low in the canopy, under the palm fronds that hid a 10 u row. */
	height: 8
} as const;
export const BRIDGE_HALF_WIDTH = 1.5;

// --- Trails (LEVEL.md §6) -----------------------------------------------------

/**
 * Soil paths 4 u wide. 'stonesWest', 'stonesEast' and 'ledgeTakeoff' stand for
 * the take-off points the builder derives from the obby gaps: the trails end
 * exactly where the obbies start.
 */
export type TrailPoint = XZ | 'stonesWest' | 'stonesEast' | 'ledgeTakeoff';
export const TRAILS: Record<string, readonly TrailPoint[]> = {
	trilha: [
		[36, 86],
		[42, 70],
		[46, 58],
		[52, 50],
		[62, 40],
		[78, 30],
		[92, 26]
	],
	margem: [[92, 26], [96, 40], [90, 56], 'stonesWest'],
	leste: ['stonesEast', [108, 100], [112, 112]],
	armadilhas: [
		[112, 118],
		[124, 104],
		'ledgeTakeoff',
		[126, 120],
		[142, 128],
		[120, 140],
		[96, 140],
		[104, 124]
	],
	ponte: [
		[34, 92],
		[38, 112],
		[48, 124],
		[64, 132],
		[82, 128],
		[100, 120]
	],
	/** The spur from the mirante top across the plateau to the east portal (WORLD.md §3, F1). */
	'mirante-leste': [
		[134, 72],
		[146, 71],
		[156, 70],
		[160, 70]
	],
	/** From the trilha (on its segment at x 70) north to the north portal (PARK.md §2). */
	'trilha-praia': [
		[70, 35],
		[70, 18],
		[70, 0]
	],
	/** From the ponte trail past the bridge, along the river's east bank, to the south portal. */
	'trilha-mangue': [
		[64, 132],
		[52, 145],
		[44, 152],
		[42, 156],
		[41, 160]
	]
};
export const TRAIL_HALF_WIDTH = 2;
/** No tree or rock collider within this of a trail centre line. */
export const TRAIL_CLEARANCE = 3;

// --- Obbies (LEVEL.md §7) -----------------------------------------------------

/**
 * Obby 1. The stones cross the pool along the axis from `from` to `to`
 * (LEVEL.md's end points, which only give the direction now); the positions
 * come from the gaps, so the pool stretches along the axis to fit them.
 */
export const STONES = {
	from: [86, 70] as XZ,
	to: [103, 82] as XZ,
	radius: 1.3,
	/** Top above the water, plus a small per-stone offset (rises stay within ±0.3). */
	topAboveWater: 0.6,
	topOffsets: [0, 0.15, 0, -0.15, 0, 0.15, 0],
	/** Bank → stone 1, …, stone 7 → bank, as fractions of jumpReach(0). */
	gapFractions: [0.45, 0.5, 0.55, 0.6, 0.55, 0.6, 0.65, 0.5],
	/** Stones alternate this far left and right of the axis. */
	zigzag: 1.6,
	/** Stone that holds the gold leaf (1-based, LEVEL.md: stone 4). */
	goldLeafStone: 4,
	/** Bank pads: radius of the flat take-off ground, its centre this far behind the take-off point. */
	padRadius: 2,
	padBack: 2
} as const;

/**
 * Obby 2. Ledges start at LEVEL.md's first ledge and climb towards the rim; the
 * spacing comes from the gaps, and the line is aimed so the last ledge lands
 * on the plateau rim (build.ts), a few units north of LEVEL.md's sketch.
 */
export const LEDGES = {
	first: [121, 97] as XZ,
	/** The plateau edge (indices into PLATEAU) the last ledge's centre sits on: the west face from (130, 100) to (126, 70). */
	rimEdge: [3, 4],
	size: 2.5,
	tops: [7.5, 9, 10.5, 12, 13.5, 15],
	materials: ['rock', 'root', 'log', 'rock', 'root', 'log'],
	takeoffY: 6,
	/** Take-off → ledge 1, …, ledge 5 → ledge 6, as fractions of jumpReach(1.5). */
	gapFractions: [0.45, 0.5, 0.55, 0.6, 0.55, 0.5],
	/** Checkpoint ledge (1-based, LEVEL.md: ledge 3). */
	checkpointLedge: 3,
	padRadius: 1.5
} as const;
/** No collider within this of the obby lanes' centre lines (beyond the zigzag). */
export const LANE_CLEARANCE = 3;

// --- Missions, checkpoints, collectibles (LEVEL.md §5, §8, level-plan.py) ----

export const MIRANTE_TOP: XZ = [134, 72];

/**
 * The east portal (WORLD.md §3, F1 "rumo à serra"): an opening in the east
 * edge at the mirante, `halfWidth` u either side of z, where a causeway keeps
 * the plateau's height from `fromX` across the edge strip to the map edge.
 * The plateau's edge lip is lowered into it over `lipBlend` u along z. Its
 * flanks are one-cell cliffs down to the strip, like the plateau's faces, so
 * the strip below never leads up: the mirante (mission 6, by the ledges)
 * stays the only way to the portal, and its gate stays closed until then.
 * Posts stand inside the opening's edges; the sign faces the trail.
 */
export const PORTAL = {
	z: 70,
	halfWidth: 4,
	fromX: 148,
	lipBlend: 4,
	requires: 'mirante',
	label: 'Rumo à serra',
	posts: [
		[159.5, 66.4],
		[159.5, 73.6]
	] as readonly XZ[],
	postHeight: 3.2,
	postRadius: 0.3,
	sign: [153, 66.6] as XZ,
	signHeight: 2.2,
	gateHeight: 2.4,
	/** Where "voltar" lands: on the causeway, facing home. */
	inside: [156, 70] as XZ,
	/** The first step past the edge, into the generated world. */
	outside: [163, 70] as XZ
} as const;

/**
 * The north and south portals (PARK.md §2): openings `halfWidth` u either side
 * of `x` in the north (z 0) and south (z 160) fences, where the Praia's and the
 * Manguezal's crossings meet the Reserva (level/zones/spec.ts SEAMS). Unlike
 * the east one they are on low ground the child walks to from the start, so no
 * height changes: only the fence opens, and the gate keeps them shut until
 * `requires` is done. Each is reached by its own trail spur.
 */
export const EDGE_PORTALS = [
	{
		id: 'norte',
		side: 'north',
		x: 70,
		halfWidth: 4,
		requires: 'mirante',
		label: 'Rumo à praia',
		posts: [
			[66.4, 0.5],
			[73.6, 0.5]
		] as readonly XZ[],
		/** Beside the spur, facing south: the way the trail comes. */
		sign: [66.5, 8] as XZ,
		signFacing: 'south',
		inside: [70, 4] as XZ,
		insideFacing: 'south',
		outside: [70, -3] as XZ,
		trail: 'trilha-praia'
	},
	{
		id: 'sul',
		side: 'south',
		x: 40,
		halfWidth: 4,
		requires: 'mirante',
		label: 'Rumo ao manguezal',
		posts: [
			[36.4, 159.5],
			[43.6, 159.5]
		] as readonly XZ[],
		sign: [46, 156] as XZ,
		signFacing: 'north',
		inside: [41, 156] as XZ,
		insideFacing: 'north',
		outside: [40, 163] as XZ,
		trail: 'trilha-mangue'
	}
] as const;

/**
 * The gorge (PARK.md §4.1, p20-zonas.md §2): the Vale's stream crossing the
 * serra massif from the Reserva's east edge to the small waterfall's lip, on
 * level/zones/spec.ts PARK_RIVER's own line and water (9.4 at the edge, 9 at
 * the lip station by x 133). A flat bed `depth` under the water, with the
 * massif left standing as its walls: never walkable, so it opens no way onto the
 * serra or round the mirante.
 *
 * Its banks lie `north` and `south` of the line, from the edge to the lip (linear
 * between): 3.5 either side at the edge, PARK_RIVER's own half width there, then
 * 2 north, to keep the grotto niche's wall, and 5.5 south. At least 7 u across
 * everywhere, so no jump crosses it (`jumpReach(0)` is 5.2): the serra north of
 * it is cut off, and its south rim is reachable after the ledges.
 */
export const GORGE = {
	from: [160, 32 + 1 / 3] as XZ,
	lip: [133, 30 + 1 / 12] as XZ,
	waterFrom: 9.4,
	waterLip: 9,
	north: [3.5, 2],
	south: [3.5, 5.5],
	depth: 1
} as const;
/** Checkpoints besides spawn, the stone banks and the two on the ledges (derived). */
export const CHECKPOINTS = {
	pasture: [55, 52],
	clareira: [104, 112]
} as const satisfies Record<string, XZ>;
export const CHECKPOINT_SIZE = 4;
/** Which way each checkpoint respawns the child: towards the next thing to do. */
export const CHECKPOINT_FACING = {
	start: 'northEast',
	pasture: 'east',
	stonesWest: 'southEast',
	stonesEast: 'south',
	clareira: 'northEast',
	ledge: 'north',
	mirante: 'west'
} as const satisfies Record<string, Facing>;
export const TRAPS: readonly XZ[] = [
	[124, 104],
	[142, 128],
	[96, 140]
];
export const FRUITS: readonly XZ[] = [
	[44, 66],
	[40, 50],
	[58, 34],
	[72, 30],
	[48, 42]
];
export const TRASH: readonly XZ[] = [
	[40, 76],
	[44, 62],
	[66, 38],
	[88, 30],
	[92, 52],
	[108, 96],
	[118, 130],
	[100, 140],
	/** LEVEL.md (60, 130) is in the river by the bridge; moved to the ponte trail's east bank. */
	[66, 131.5],
	[40, 110]
];
export const TRASH_KINDS = ['bottle', 'can', 'bag'] as const;
/** Trigger radii (LEVEL.md §8, §10). */
export const LOGGER_RADIUS = 12;
export const ONCA_RADIUS = 15;
export const TRAP_RADIUS = 2.5;
export const PLANTING_RADIUS = 1.2;
export const COLLECT_RADIUS = 1.2;
export const MIRANTE_RADIUS = 6;
/** Fall below this and respawn at the last checkpoint (the river bed is about −2). */
export const KILL_Y = -6;

// --- Animals (LEVEL.md §10) -------------------------------------------------------

export const ANIMALS = {
	'mico-leao-dourado': [60, 38],
	bugio: [18, 20],
	muriqui: [108, 32],
	/** LEVEL.md (128, 124), moved 2.5 u off the trap trail so its embaúba keeps the trail clearance. */
	preguica: [127, 126.5],
	tucano: [138, 58],
	'onca-pintada': [146, 148]
} as const satisfies Record<string, XZ>;
export const BUTTERFLIES: XZ = [112, 118];

// --- Budgets and vegetation (LEVEL.md §9) -------------------------------------

export const MAX_INSTANCES = 1600;
export const TREE_SPACING_FOREST = 5;
export const TREE_SPACING_OPEN = 9;
/** Extra trees along the map edges ("rising ground plus dense trees"). */
export const TREE_SPACING_EDGE = 4;
export const EDGE_BAND = 5;
export const ROCK_SPACING = 9;
export const DECORATION_SPACING = 5.5;

// --- Act 1 additions (PARK.md §3) ---------------------------------------------------
//
// Data only, like the portals: the runtime draws and collides with the decks,
// rails, ladders, branches and the cable from these numbers. The map keeps
// the ground they need free of trees, rocks and ground cover.

/**
 * Mission 0, the treehouse: a square deck `height` u up around the trunk of the
 * ipê-amarelo's neighbour tree, railed all round but for the ladder's top. PARK.md's
 * (40, 74) is on the trilha itself, so the tree stands 4.5 u east, just past the
 * trail clearance; the ladder is on the deck's south edge, facing the base.
 */
export const TREEHOUSE = {
	tree: [44.5, 74] as XZ,
	species: 'jequitiba',
	scale: 1.3,
	deckHalf: 2.5,
	height: 6,
	railHeight: 1.1,
	ladderWidth: 1.2,
	/** The ladder's foot stands this far out from the deck edge, on the ground. */
	ladderOut: 0.4,
	/** The mission's trigger: the deck top, this far from the trunk. */
	missionRadius: 2.5
} as const;

/**
 * The tirolesa (PARK.md §3, the coordinator's numbers): from the mirante's
 * lookout deck west along z 84 to a low deck at the base. `start` and `end` are
 * the rider's feet; the cable runs `cableAbove` over them. No tree, rock or
 * ground cover stands within `clearance` of the cable's line on the ground.
 */
export const ZIPLINE = {
	start: [129, 84] as XZ,
	startY: 15,
	end: [46, 84] as XZ,
	endY: 4,
	cableAbove: 3.6,
	clearance: 2,
	/** Braking over the last `brake` u, top speed in u/s (PARK.md §6). */
	brake: 6,
	maxSpeed: 11,
	requires: 'mirante'
} as const;
/** The mirante's lookout deck, the zipline's start station: railed north, south and east, open west at z 84. */
export const MIRANTE_DECK = {
	x0: 128,
	x1: 134,
	z0: 81.5,
	z1: 86.5,
	y: 15,
	railHeight: 1.1,
	gapZ: 84,
	gapWidth: 2
} as const;
/** The zipline's end station at the base: a low deck under the cable's end, railed north and south. */
export const ZIPLINE_BASE = {
	x0: 44,
	x1: 48,
	z0: 82.5,
	z1: 85.5,
	y: 4,
	railHeight: 1.1
} as const;

/**
 * The grotto behind the small waterfall (PARK.md §3): a niche cut into the
 * serra's west face (cells x0..x1, z0..z1, a flat floor), facing a plunge pool
 * at the waterfall's foot. Three stones cross the pool from its west bank to
 * the niche, like the river stones: the pool stretches along the line to fit
 * their gaps, and the take-off sits at its west end.
 */
export const GROTTO = {
	niche: { x0: 133, x1: 136, z0: 23, z1: 27 },
	floorY: 4.4,
	/** The feet after the last jump, on the niche floor; the stones run east to it. */
	landing: [133.6, 25] as XZ,
	stoneRadius: 1,
	topAboveWater: 0.6,
	/** Bank → stone 1, …, stone 3 → niche, as fractions of jumpReach(0). */
	gapFractions: [0.3, 0.35, 0.35, 0.3],
	poolHalfWidth: 4.5,
	/** The pool runs this far past the face, into the cliff that stands over it, so it is wide where it meets the niche. */
	poolBeyond: 3,
	padRadius: 1.5,
	padBack: 1.5,
	leaf: [135.5, 25] as XZ,
	/** Iara's hidden note, in the niche's north corner. */
	note: [135.8, 23.6] as XZ
} as const;

/**
 * The canopy gold leaf (PARK.md §3): the micos' branch path, five branch
 * platforms climbing `rise` u per jump in a straight line from the take-off to
 * the leaf's platform in the crown of a tree just past it. The line is aimed
 * from `from` (direction only); the gaps fix its length.
 */
export const CANOPY = {
	leaf: [60, 24] as XZ,
	from: [44, 39] as XZ,
	radius: 1,
	rise: 1.8,
	/** Take-off → branch 1, …, branch 4 → branch 5, as fractions of jumpReach(0). */
	gapFractions: [0.45, 0.5, 0.55, 0.5, 0.45],
	treeBeyond: 2.2,
	species: 'jequitiba',
	scale: 1.3
} as const;

/** The two NPCs of Act 1 and where they look. */
export const NPCS = {
	ana: { at: [112, 106] as XZ, name: 'Bióloga Ana', facing: CLAREIRA.centre },
	ze: { at: [96, 30] as XZ, name: 'Seu Zé', facing: [78, 30] as XZ }
} as const;
/** "Sementes para o viveiro": six fallen seeds, two each of three species, round the clareira, off the trails. */
export const SEED_SPOTS: readonly { at: XZ; species: string }[] = [
	{ at: [130, 118], species: 'pau-brasil' },
	{ at: [123, 129], species: 'jequitiba' },
	{ at: [112, 136], species: 'ipe-rosa' },
	{ at: [98, 126], species: 'pau-brasil' },
	{ at: [98, 110], species: 'jequitiba' },
	{ at: [112, 100], species: 'ipe-rosa' }
];
/** "Fotografe 3 aves": where each bird perches, `lift` u over the ground, 10–15 u from Seu Zé (the camera's 25 u). */
export const BIRD_PERCHES: readonly { species: string; at: XZ; lift: number }[] = [
	{ species: 'tucano', at: [104, 38], lift: 7 },
	{ species: 'saira', at: [88, 22], lift: 5 },
	{ species: 'sabia', at: [86, 36], lift: 2.5 }
];

/**
 * Trail marks (PARK.md §3): about every `spacing` u along every trail, on the
 * trunk of a tree within `trunkReach` of the centre line, else on a post `postOut`
 * off the trail's right edge (the left one, or up to `postSearch` further out, where
 * a trail doubles back); each faces the trail.
 */
export const TRAIL_MARKS = { spacing: 20, trunkReach: 6, postOut: 0.6, postSearch: 3, height: 1.6 } as const;

/**
 * Player-facing text of the Act 1 missions (pt-BR). Keys starting with
 * FACT_ are checked facts; ACT1_SOURCES gives each one its source.
 */
export const ACT1_TEXT: Record<string, string> = {
	CASA_INTRO: 'Antes de tudo, suba na casa da árvore e olhe a Reserva lá de cima.',
	CASA_VISTA:
		'Daqui dá para ver o rio, o mirante e o jequitibá. Guarde esses pontos: eles ajudam a não se perder.',
	ANA_INTRO:
		'Oi! Eu sou a Ana, bióloga. O viveiro precisa de sementes: você me ajuda a juntar seis, de três árvores diferentes, aqui em volta da clareira?',
	ANA_OBRIGADA: 'Obrigada! Dessas sementes o viveiro vai tirar mudas para a mata.',
	ZE_INTRO:
		'Psiu, fale baixinho! Eu sou o Seu Zé e observo aves aqui faz tempo. Você consegue fotografar um tucano, uma saíra e um sabiá?',
	ZE_OBRIGADO: 'Que fotos bonitas! Quem observa sem espantar vê muito mais.',
	GRUTA_BILHETE: 'Você achou meu esconderijo! Daqui eu escuto a água que desce lá da serra. — Iara',
	TRILHA_PERDIDA: 'Não estou vendo você perto das marcas da trilha. Volte até a última marca que você viu.',
	FACT_SEMENTE_PAU_BRASIL:
		'A vagem do pau-brasil guarda uma ou duas sementes e se abre de repente para soltá-las.',
	FACT_SEMENTE_JEQUITIBA:
		'O fruto do jequitibá-rosa parece um potinho de madeira com tampa e guarda de 10 a 15 sementes com asas.',
	FACT_SEMENTE_IPE_ROSA: 'As sementes do ipê-rosa têm duas asinhas e são levadas pelo vento.',
	FACT_AVE_TUCANO:
		'Ao comer frutos de palmito-juçara, o tucano-de-bico-verde leva as sementes para longe da palmeira-mãe.',
	FACT_AVE_SAIRA:
		'A saíra-sete-cores tem cabeça azul-turquesa, verde-limão no pescoço e laranja perto da cauda.',
	FACT_AVE_SABIA:
		'O sabiá-laranjeira é considerado popularmente a Ave Nacional do Brasil e é homenageado no Dia da Ave, em 5 de outubro.'
};

/** Source (https URL) of each Act 1 fact, by its ACT1_TEXT key. */
export const ACT1_SOURCES: Record<string, string> = {
	FACT_SEMENTE_PAU_BRASIL:
		'https://www.alice.cnptia.embrapa.br/alice/bitstream/doc/1140103/1/Especies-Arboreas-Brasileiras-vol-1-Pau-Brasil.pdf',
	FACT_SEMENTE_JEQUITIBA:
		'https://www.alice.cnptia.embrapa.br/alice/bitstream/doc/1140093/1/Especies-Arboreas-Brasileiras-vol-1-Jequitiba-Rosa.pdf',
	FACT_SEMENTE_IPE_ROSA:
		'https://www.alice.cnptia.embrapa.br/alice/bitstream/doc/1140086/1/Especies-Arboreas-Brasileiras-vol-1-Ipe-Roxo.pdf',
	FACT_AVE_TUCANO: 'https://periodicos.ufjf.br/index.php/zoociencias/article/download/24681/13849',
	FACT_AVE_SAIRA: 'https://ebird.org/species/grhtan2?siteLanguage=pt_BR',
	FACT_AVE_SABIA: 'https://www.planalto.gov.br/ccivil_03/dnn/2002/dnn9675.htm'
};
