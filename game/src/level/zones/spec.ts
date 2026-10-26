/**
 * The park as data (game/PARK.md §2, game/docs/park-plan.py, which holds the
 * coordinates): the Reserva da Iara plus four hand-made zones, each a
 * rectangle of 40 u chunks. Plain data and pure functions only, safe in the
 * world-gen Worker (no three.js, no level/build.ts): world-gen reads it to
 * know which chunks are hand-made and where the park's edges run.
 *
 * World coordinates throughout: x grows east (the serra), z grows south.
 */
import { BLOCK_SIZE } from '../../survival/types.ts';

export const ZONE_IDS = ['reserva', 'vale', 'copa', 'praia', 'manguezal'] as const;
export type ZoneId = (typeof ZONE_IDS)[number];

/** Skeleton zones' generator version: bump when any zone's output changes (the Reserva keeps STORY_VERSION). */
export const ZONE_VERSION = 1;
/** level/layout.ts STORY_SEED, copied so this module never imports the level; zones.test.ts checks it. */
export const PARK_SEED = 0x1a8a2026;

export interface ZoneSpec {
	id: ZoneId;
	/** Player-facing name (pt-BR). */
	name: string;
	act: 1 | 2 | 3;
	/** Chunk rectangle, both ends included. */
	cx0: number;
	cz0: number;
	cx1: number;
	cz1: number;
	/** World rectangle: (x0, z0) to (x1, z1). */
	x0: number;
	z0: number;
	x1: number;
	z1: number;
}

function zone(id: ZoneId, name: string, act: 1 | 2 | 3, cx0: number, cz0: number, cx1: number, cz1: number) {
	return {
		id,
		name,
		act,
		cx0,
		cz0,
		cx1,
		cz1,
		x0: cx0 * BLOCK_SIZE,
		z0: cz0 * BLOCK_SIZE,
		x1: (cx1 + 1) * BLOCK_SIZE,
		z1: (cz1 + 1) * BLOCK_SIZE
	} satisfies ZoneSpec;
}

/** PARK.md §2's table. */
export const PARK_ZONES: Readonly<Record<ZoneId, ZoneSpec>> = {
	reserva: zone('reserva', 'Reserva da Iara', 1, 0, 0, 3, 3),
	vale: zone('vale', 'Vale das Cachoeiras', 2, 4, 0, 7, 3),
	copa: zone('copa', 'Copa das Árvores', 2, 4, -4, 7, -1),
	praia: zone('praia', 'Praia e Costão', 3, -1, -4, 3, -1),
	manguezal: zone('manguezal', 'Manguezal', 3, -1, 4, 3, 7)
};

/** The zone a chunk belongs to, or null for the generated world. */
export function zoneOfChunk(cx: number, cz: number): ZoneId | null {
	for (const id of ZONE_IDS) {
		const z = PARK_ZONES[id];
		if (cx >= z.cx0 && cx <= z.cx1 && cz >= z.cz0 && cz <= z.cz1) return id;
	}
	return null;
}

export type Side = 'west' | 'east' | 'north' | 'south';

/**
 * A shared edge between two zones. The `fixed` zone keeps its heights; the
 * `zone` blends its own band towards them (WORLD.md §3's recipe), with no
 * step anywhere on the seam and walkable slopes across each crossing.
 * `side` is the seam's side of `zone`; `at` its x (west/east) or z
 * (north/south); `from`..`to` its extent along the other axis.
 */
export interface Seam {
	id: string;
	fixed: ZoneId;
	zone: ZoneId;
	side: Side;
	at: number;
	from: number;
	to: number;
	/** Where people cross (PARK.md §2), as ranges along the seam: the slope limit holds there. */
	crossings: readonly (readonly [number, number])[];
}

/** Half width of a crossing's opening (the F1 east portal's 8 u). */
export const CROSSING_HALF = 4;
const crossing = (centre: number) => [centre - CROSSING_HALF, centre + CROSSING_HALF] as const;

/**
 * Every shared edge, in build order: a zone is built after the zones it reads.
 * Praia ↔ Copa has no crossing in PARK.md but is stitched all the same, so the
 * park has no step between zones anywhere.
 */
export const SEAMS: readonly Seam[] = [
	{
		id: 'reserva-vale',
		fixed: 'reserva',
		zone: 'vale',
		side: 'west',
		at: 160,
		from: 0,
		to: 160,
		crossings: [crossing(70)]
	},
	{
		id: 'reserva-praia',
		fixed: 'reserva',
		zone: 'praia',
		side: 'south',
		at: 0,
		from: 0,
		to: 160,
		crossings: [crossing(70)]
	},
	{
		id: 'reserva-manguezal',
		fixed: 'reserva',
		zone: 'manguezal',
		side: 'north',
		at: 160,
		from: 0,
		to: 160,
		crossings: [crossing(40)]
	},
	{
		id: 'vale-copa',
		fixed: 'vale',
		zone: 'copa',
		side: 'south',
		at: 0,
		from: 160,
		to: 320,
		crossings: [crossing(222)]
	},
	{ id: 'praia-copa', fixed: 'praia', zone: 'copa', side: 'west', at: 160, from: -160, to: 0, crossings: [] }
];

/** Zones in the order they can be built (each after the zones its seams read). */
export const BUILD_ORDER: readonly ZoneId[] = ['reserva', 'vale', 'praia', 'manguezal', 'copa'];

export type XZ = readonly [number, number];

/**
 * How each zone is entered (PARK.md §2): the opening on its edge and the
 * mission that opens it. The Vale's is the F1 east portal (level.portal).
 */
export interface ZoneEntry {
	zone: ZoneId;
	/** Where the opening is, on the zone's edge. */
	at: XZ;
	side: Side;
	/** Mission key of the Reserva that opens it. */
	requires: string;
	label: string;
	/** A point just inside the zone, facing in. */
	inside: XZ;
}

export const ENTRIES: Readonly<Record<Exclude<ZoneId, 'reserva'>, ZoneEntry>> = {
	vale: {
		zone: 'vale',
		at: [160, 70],
		side: 'west',
		requires: 'mirante',
		label: 'Rumo à serra',
		inside: [166, 70]
	},
	copa: {
		zone: 'copa',
		at: [222, 0],
		side: 'south',
		requires: 'mirante',
		label: 'Subida às copas',
		inside: [222, -6]
	},
	praia: {
		zone: 'praia',
		at: [70, 0],
		side: 'south',
		requires: 'mirante',
		label: 'Rumo à praia',
		inside: [70, -6]
	},
	manguezal: {
		zone: 'manguezal',
		at: [40, 160],
		side: 'north',
		requires: 'mirante',
		label: 'Rumo ao manguezal',
		inside: [40, 166]
	}
};

// --- park-plan.py shapes ---------------------------------------------------------

/** The sea; its east chain (from z −160 to 320) is the coast line. */
export const SEA: readonly XZ[] = [
	[-40, -160],
	[-6, -160],
	[-2, -120],
	[-14, -96],
	[-34, -88],
	[-12, -76],
	[-4, -40],
	[0, 0],
	[0, 160],
	[-6, 200],
	[-26, 236],
	[-10, 262],
	[-6, 320],
	[-40, 320]
];
/** The coast line: the sea's east chain, single-valued in z. */
export const COAST: readonly XZ[] = SEA.slice(1, -1);
/** The rocky headland of the Praia, and the tide pools at its foot. */
export const COSTAO: readonly XZ[] = [
	[-14, -96],
	[-36, -90],
	[-34, -84],
	[-12, -78]
];
export const TIDE_POOLS: XZ = [-8, -74];
export const MANGUE: readonly XZ[] = [
	[-30, 196],
	[40, 186],
	[70, 214],
	[60, 270],
	[20, 300],
	[-26, 290],
	[-34, 250]
];
export const RESTINGA: readonly XZ[] = [
	[-4, -150],
	[40, -150],
	[40, -10],
	[0, -6],
	[-4, -40]
];

// --- The park river --------------------------------------------------------------

/** One point of the park river: the water surface there, its half width and depth. */
export interface RiverStation {
	x: number;
	z: number;
	water: number;
	halfWidth: number;
	depth: number;
}

/** level/layout.ts RIVER and its surface rule (build.ts riverModel), copied; zones.test.ts checks them. */
const RESERVA_RIVER: readonly XZ[] = [
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
const RESERVA_TOP_INDEX = 1;
const RESERVA_SURFACE = { topY: 3, seaY: -0.5 } as const;
const RESERVA_HALF_WIDTH = 4.5;
const RESERVA_DEPTH = 1.6;

function reservaWaters(): number[] {
	const arcs = [0];
	for (let k = 1; k < RESERVA_RIVER.length; k++) {
		const [ax, az] = RESERVA_RIVER[k - 1];
		const [bx, bz] = RESERVA_RIVER[k];
		arcs.push(arcs[k - 1] + Math.sqrt((bx - ax) * (bx - ax) + (bz - az) * (bz - az)));
	}
	const top = arcs[RESERVA_TOP_INDEX];
	const end = arcs[arcs.length - 1];
	const { topY, seaY } = RESERVA_SURFACE;
	return arcs.map((arc) => topY + ((seaY - topY) * (arc - top)) / (end - top));
}

/** A point on the plan's segment a → b at x (the plan's polyline keeps its shape; this only adds a station). */
function onSegment(a: XZ, b: XZ, x: number): XZ {
	const t = (x - a[0]) / (b[0] - a[0]);
	return [x, a[1] + (b[1] - a[1]) * t];
}

/**
 * park-plan.py RIVER, from the spring to the mouth, with water heights that
 * only fall (PARK.md §2, §4.1, §5.2): spring 59 (ground 60), the Cachoeira
 * Grande from 50 to its pool at 30, rapids down to the Reserva's edge, the
 * Reserva's small waterfall at (132, 30) into its river (3 → −0.5, exactly
 * level/build.ts's), then at sea level through the mangrove to the mouth.
 * Extra stations on the plan's segments mark the drops: the waterfall's lip
 * and foot at x 250.5 and 249.5, the Reserva's edge at x 160 and the small
 * waterfall's lip at x 133. Between the Reserva's edge and (132, 30) the
 * river crosses the Reserva's serra massif, which has no channel yet: that
 * stretch is the level's (p20-zonas.md).
 */
export const PARK_RIVER: readonly RiverStation[] = (() => {
	const vale: [XZ, number, number, number][] = [
		[[300, 20], 59, 2.5, 0.8],
		[[272, 30], 53, 3, 1],
		[[256, 38], 50, 3, 1],
		[onSegment([256, 38], [238, 46], 250.5), 50, 3, 1],
		[onSegment([256, 38], [238, 46], 249.5), 30, 6, 1.6],
		[[238, 46], 30, 8, 1.6],
		[[210, 42], 24.5, 3.5, 1.2],
		[[180, 34], 19, 3.5, 1.2],
		[onSegment([180, 34], [132, 30], 160), 9.4, 3.5, 1],
		[onSegment([180, 34], [132, 30], 133), 9, 3, 1]
	];
	const waters = reservaWaters();
	const out: RiverStation[] = vale.map(([[x, z], water, halfWidth, depth]) => ({
		x,
		z,
		water,
		halfWidth,
		depth
	}));
	RESERVA_RIVER.forEach(([x, z], k) => {
		out.push({ x, z, water: waters[k], halfWidth: RESERVA_HALF_WIDTH, depth: RESERVA_DEPTH });
	});
	const mouth: [XZ, number][] = [
		[[18, 190], 5],
		[[6, 214], 6],
		[[-8, 232], 7],
		[[-26, 240], 8]
	];
	for (const [[x, z], halfWidth] of mouth)
		out.push({ x, z, water: RESERVA_SURFACE.seaY, halfWidth, depth: RESERVA_DEPTH });
	return out;
})();

/** Index of the first and last station of the Reserva's own river within PARK_RIVER. */
export const RESERVA_RIVER_SPAN: readonly [number, number] = [10, 10 + RESERVA_RIVER.length - 1];
