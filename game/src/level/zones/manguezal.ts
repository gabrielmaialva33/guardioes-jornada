/**
 * Zone 'manguezal', the Manguezal (PARK.md §5.2, P30), built from the control
 * points of manguezal-layout.ts on the zone pipeline (zone.ts):
 *
 * 1. Ground: the skeleton stitched to the Reserva (zoneGround), the park river
 *    to its mouth (river.ts).
 * 2. The high tide: the mangrove flooded 0.9 u deep (ZONE.sea, so the runtime
 *    treats it as water), the sandy levee under the arrival trail, the mud
 *    banks of the crabs and the propagule patch.
 * 3. The decks: the raised boardwalk loop (arched over the canoe channel), its
 *    spurs to the hide and the patch, and the two piers of the canoe.
 * 4. Reachability: on foot from the portal, plus the canoe as one link from
 *    the first landing to the second: the only way onto the boardwalk.
 * 5. The story data (missions M1–M5, checkpoints, triggers, landmarks), the
 *    mechanics' specs (Boardwalk, Canoe), animal homes and the vegetation.
 *
 * Pure and deterministic (survival/random.ts's rules) and Worker-safe: no
 * three.js. The zone is 200 × 160, so survival's 161-wide grid helpers do not
 * apply; this file carries its own. The output is zone-local (x + 40, z − 160).
 */
import { GRAVITY, JUMP_SPEED, WALK_SPEED } from '../../engine/constants.ts';
import type { BoardwalkSpec, Lookout } from '../../mechanics/boardwalk.ts';
import type { CanoeSpec } from '../../mechanics/canoe.ts';
import { checksumOf } from '../../survival/checksum.ts';
import { clamp, floor } from '../../survival/noise.ts';
import { poissonDisk } from '../../survival/poisson.ts';
import { Rng, subSeed } from '../../survival/random.ts';
import {
	ALBUM,
	type AnimalHome,
	BLOCK_SIZE,
	DECORATION_KINDS,
	type DecorationKind,
	FLAG,
	type Placements,
	type Point,
	RESOURCE_KINDS,
	ROCK_KINDS,
	type SurvivalWorld,
	THREAT_KINDS,
	TREE_SPECIES,
	type TreeSpecies,
	WADE_LIMIT,
	WATER_LEVEL,
	ZONE
} from '../../survival/types.ts';
import {
	arcLengths,
	distance,
	headingTo,
	insidePolygon,
	polygonEdgeDistance,
	polylineDistance,
	segmentDistance2
} from '../geometry.ts';
import type { Collectible, PlantingSpot, StoryCheckpoint, Trail } from '../types.ts';
import {
	FACING,
	type Facing,
	placeTrailMarks,
	type TrailMark,
	type ZoneContent,
	type ZoneHome,
	type ZoneLandmark,
	type ZoneMission,
	type ZoneTrigger
} from './content.ts';
import {
	ARRIVAL_TRAIL,
	BOARDWALK,
	CANOE,
	CLEAR,
	COVER,
	CRAB_BANK_RADIUS,
	CRAB_BANKS,
	CRAB_WATCH,
	DEFESO_BANK,
	DEFESO_SIGN,
	EMBARQUE,
	FENCE_MARGIN,
	HIDE,
	HOMES,
	INLAND,
	JUNCTION,
	LEVEE,
	MANGROVE,
	MARKS,
	MAX_INSTANCES,
	PATCH,
	PIER_OVERRUN,
	RAIL_GAP,
	SEAM_KEEP,
	STEP_COS,
	STEP_SIN,
	TIDAL,
	TIDE,
	TRAIL_CLEARANCE,
	TRAIL_HALF_WIDTH,
	TRASH,
	ZONE_SIGN
} from './manguezal-layout.ts';
import { MANGUE_MISSION_NAMES, MANGUE_TEXT } from './manguezal-text.ts';
import { carveRiver, stationsIn } from './river.ts';
import { coastLine } from './skeleton.ts';
import {
	CROSSING_HALF,
	ENTRIES,
	PARK_SEED,
	PARK_ZONES,
	RESTINGA,
	type XZ,
	ZONE_VERSION,
	type ZoneId
} from './spec.ts';
import {
	collisionBlocks,
	heightIn,
	walkStepsRect,
	type ZoneBuild,
	type ZoneLevel,
	zoneArrival,
	zoneGround
} from './zone.ts';

const SPEC = PARK_ZONES.manguezal;
const OX = SPEC.x0;
const OZ = SPEC.z0;
const W = SPEC.x1 - SPEC.x0;
const D = SPEC.z1 - SPEC.z0;
/** Row stride and vertex count of the zone's grid. */
const SIDE = W + 1;
const CELLS = SIDE * (D + 1);
const BLOCKS_X = W / BLOCK_SIZE;
const BLOCKS_Z = D / BLOCK_SIZE;
const SEED = subSeed(PARK_SEED, 0x3a6e);
const ENTRY_X = ENTRIES.manguezal.at[0];

/** survival/generate.ts TRUNK_RADIUS and TRUNK_HEIGHT (private there), for the species planted here. */
const TRUNK_RADIUS: Partial<Record<TreeSpecies, number>> = {
	'pau-brasil': 0.3,
	'ipe-rosa': 0.3,
	jucara: 0.15,
	embauba: 0.22,
	'mangue-vermelho': 0.3,
	jeriva: 0.2
};
const TRUNK_HEIGHT = 3.5;
/**
 * A red mangrove's collider reaches at least this high: no trunk top in the
 * flood is a step a jump from the boardwalk can land on (its arch at 2.1, a
 * rail 1.1 over it, a jump 4.32 high), so the trees never make a way across
 * the water.
 */
const MANGROVE_COLLIDER_TOP = 8;
/** Rail and screen colliders: thin oriented boxes. */
const RAIL_HALF_THICKNESS = 0.06;
const DECK_THICKNESS = 0.3;

/** A deck (the boardwalk's chords, its spurs, the piers, the hide): its top runs straight from `from` to `to`. */
export interface DeckPiece {
	id: string;
	from: Point;
	to: Point;
	halfWidth: number;
}

/** A rail or a screen: a straight run `height` tall standing on a deck that may slope (y0 → y1). */
export interface DeckRail {
	x0: number;
	y0: number;
	z0: number;
	x1: number;
	y1: number;
	z1: number;
	height: number;
}

/** A mud bank over the flood (zone-local): the crabs', the defeso's, the propagule patch. */
export interface MudBank extends Point {
	id: string;
	radius: number;
}

/** What the Manguezal adds to a zone's content: the canoe, the decks' rails, the tide's mud and the colhereiros' dusk. */
export interface ManguezalContent extends ZoneContent {
	canoes: CanoeSpec[];
	decks: DeckPiece[];
	rails: DeckRail[];
	banks: MudBank[];
	/** Where a caranguejo-uçá shows, one per M2 bank, on its mud. */
	crabs: Point[];
	tide: { water: number; floor: number; mud: number };
	/** M5: the flock arrives at dusk from the sea and settles on the roost. */
	colhereiros: { time: 'dusk'; flock: number; roost: Point; arrivesFrom: Point };
}

export type ManguezalLevel = ZoneLevel & { content: ManguezalContent };
export type ManguezalBuild = ZoneBuild & { level: ManguezalLevel };

/** engine/graybox.ts jumpReach, the same arithmetic without three.js (vale.ts's copy). */
export function jumpReach(rise = 0): number {
	const discriminant = JUMP_SPEED * JUMP_SPEED - 2 * GRAVITY * rise;
	return discriminant < 0 ? 0 : (WALK_SPEED * (JUMP_SPEED + Math.sqrt(discriminant))) / GRAVITY;
}

/** World (x, z) to zone-local. */
const local = ([x, z]: XZ): XZ => [x - OX, z - OZ];
/** Zone-local vertex of local (x, z). */
export const cellOf = (x: number, z: number) => floor(z + 0.5) * SIDE + floor(x + 0.5);
const blockOf = (x: number, z: number) =>
	clamp(floor(z / BLOCK_SIZE), 0, BLOCKS_Z - 1) * BLOCKS_X + clamp(floor(x / BLOCK_SIZE), 0, BLOCKS_X - 1);

// --- Plan (zone-local) ---------------------------------------------------------------------

/** The loop's vertices: rotating the unit vector by exact cos/sin literals, renormalised each step. */
export function loopVertices(): XZ[] {
	const [cx, cz] = local(BOARDWALK.centre);
	const out: XZ[] = [];
	let c = 1;
	let s = 0;
	for (let k = 0; k < BOARDWALK.segments; k++) {
		out.push([cx + BOARDWALK.radius * c, cz + BOARDWALK.radius * s]);
		const nc = c * STEP_COS - s * STEP_SIN;
		const ns = s * STEP_COS + c * STEP_SIN;
		const len = Math.sqrt(nc * nc + ns * ns);
		c = nc / len;
		s = ns / len;
	}
	return out;
}

const CHANNEL: readonly XZ[] = CANOE.channel.map(local);

/** Where two segments cross: the parameter along the first, or −1. */
function crossing(a: XZ, b: XZ, c: XZ, d: XZ): number {
	const rx = b[0] - a[0];
	const rz = b[1] - a[1];
	const sx = d[0] - c[0];
	const sz = d[1] - c[1];
	const den = rx * sz - rz * sx;
	if (den === 0) return -1;
	const t = ((c[0] - a[0]) * sz - (c[1] - a[1]) * sx) / den;
	const u = ((c[0] - a[0]) * rz - (c[1] - a[1]) * rx) / den;
	return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? t : -1;
}

/** The loop's deck height at each vertex: 1.5 over the water, raised over the canoe channel. */
function vertexHeights(vertices: readonly XZ[]): number[] {
	const n = vertices.length;
	const arcs = vertices.map((_, k) => k);
	const chord = distance(vertices[0][0], vertices[0][1], vertices[1][0], vertices[1][1]);
	const perimeter = n * chord;
	const crossings: number[] = [];
	for (let k = 0; k < n; k++)
		for (let m = 0; m + 1 < CHANNEL.length; m++) {
			const t = crossing(vertices[k], vertices[(k + 1) % n], CHANNEL[m], CHANNEL[m + 1]);
			if (t >= 0) crossings.push((k + t) * chord);
		}
	if (crossings.length === 0) throw new Error('the canoe channel must pass under the boardwalk');
	return arcs.map((k) => {
		const at = k * chord;
		const near = crossings.some((s) => {
			const d = Math.abs(at - s);
			return Math.min(d, perimeter - d) <= BOARDWALK.archReach;
		});
		return WATER_LEVEL + (near ? BOARDWALK.archOverWater : BOARDWALK.y - WATER_LEVEL);
	});
}

/** A point `along` u from a to b. */
function toward(a: XZ, b: XZ, along: number): XZ {
	const len = distance(a[0], a[1], b[0], b[1]);
	return [a[0] + ((b[0] - a[0]) * along) / len, a[1] + ((b[1] - a[1]) * along) / len];
}

interface Plan {
	vertices: XZ[];
	heights: number[];
	pieces: DeckPiece[];
	/** Pier ends and the exits on them (zone-local). */
	exits: [Point, Point];
	hideLookout: Point;
	platform: Point;
	patchSpurEnd: XZ;
}

function planDecks(): Plan {
	const vertices = loopVertices();
	const heights = vertexHeights(vertices);
	const n = vertices.length;
	const half = BOARDWALK.width / 2;
	const p = ([x, z]: XZ, y: number): Point => ({ x, y, z });
	const pieces: DeckPiece[] = [];
	for (let k = 0; k < n; k++)
		pieces.push({
			id: `passarela-${k + 1}`,
			from: p(vertices[k], heights[k]),
			to: p(vertices[(k + 1) % n], heights[(k + 1) % n]),
			halfWidth: half
		});
	const deckY = BOARDWALK.y;
	// The first pier: from the levee's tip over the river to the canoe.
	const tip = local(ARRIVAL_TRAIL[ARRIVAL_TRAIL.length - 1]);
	const exitA = local(CANOE.landings[0].exit);
	const pierA = toward(tip, exitA, distance(tip[0], tip[1], exitA[0], exitA[1]) + PIER_OVERRUN);
	pieces.push({ id: 'pier-embarque', from: p(tip, LEVEE.top), to: p(pierA, deckY), halfWidth: half });
	// The second pier: from the loop inwards to the canoe's second landing.
	const pierStart = vertices[JUNCTION.pier];
	const exitB = local(CANOE.landings[1].exit);
	const pierB = toward(
		pierStart,
		exitB,
		distance(pierStart[0], pierStart[1], exitB[0], exitB[1]) + PIER_OVERRUN
	);
	pieces.push({
		id: 'pier-desembarque',
		from: p(pierStart, heights[JUNCTION.pier]),
		to: p(pierB, deckY),
		halfWidth: half
	});
	// The hide: a spur to the middle of its north side, and its square deck.
	const [hx, hz] = local(HIDE.at);
	const hideEntry: XZ = [hx, hz - HIDE.half];
	pieces.push({
		id: 'ramal-esconderijo',
		from: p(vertices[JUNCTION.hide], heights[JUNCTION.hide]),
		to: p(hideEntry, deckY),
		halfWidth: half
	});
	pieces.push({
		id: 'esconderijo',
		from: { x: hx - HIDE.half, y: deckY, z: hz },
		to: { x: hx + HIDE.half, y: deckY, z: hz },
		halfWidth: HIDE.half
	});
	// The patch: a spur sloping down to a flat platform that ends over its mud.
	const patch = local(PATCH.centre);
	const start = vertices[JUNCTION.patch];
	const toPatch = distance(start[0], start[1], patch[0], patch[1]);
	const end = toward(start, patch, toPatch - (PATCH.radius - PATCH.platformIn));
	const flat = toward(start, patch, toPatch - (PATCH.radius - PATCH.platformIn) - PATCH.platform);
	pieces.push({
		id: 'ramal-propagulos',
		from: p(start, heights[JUNCTION.patch]),
		to: p(flat, PATCH.platformY),
		halfWidth: half
	});
	pieces.push({
		id: 'plataforma-propagulos',
		from: p(flat, PATCH.platformY),
		to: p(end, PATCH.platformY),
		halfWidth: half
	});
	const platformMid = toward(flat, end, PATCH.platform / 2);
	return {
		vertices,
		heights,
		pieces,
		exits: [p(exitA, deckY), p(exitB, deckY)],
		hideLookout: { x: hx - HIDE.half + HIDE.lookoutIn, y: deckY, z: hz },
		platform: p(platformMid, PATCH.platformY),
		patchSpurEnd: end
	};
}

/** Distance from (x, z) to a deck's centre line, and the deck's height there (t along it). */
function onPiece(piece: DeckPiece, x: number, z: number) {
	const { d2, t } = segmentDistance2(piece.from.x, piece.from.z, piece.to.x, piece.to.z, x, z);
	return { d: Math.sqrt(d2), y: piece.from.y + (piece.to.y - piece.from.y) * t, t };
}

/** The deck surface at (x, z), or NaN off every deck. */
export function deckAt(pieces: readonly DeckPiece[], x: number, z: number): number {
	let y = Number.NaN;
	for (const piece of pieces) {
		const on = onPiece(piece, x, z);
		if (on.d <= piece.halfWidth && !(on.y <= y)) y = on.y;
	}
	return y;
}

/** How far (x, z) is outside every deck: 0 on one. */
function offDecks(pieces: readonly DeckPiece[], x: number, z: number): number {
	let best = Number.POSITIVE_INFINITY;
	for (const piece of pieces) best = Math.min(best, onPiece(piece, x, z).d - piece.halfWidth);
	return Math.max(0, best);
}

// --- Terrain (world coordinates) -----------------------------------------------------------

/** Linear smoothstep-free blend: 0 at a, 1 at b. */
const ramp01 = (a: number, b: number, x: number) => clamp((x - a) / (b - a), 0, 1);

/** The mud banks, world coordinates: the crabs', the defeso's and the propagule patch. */
const MUD: readonly { id: string; at: XZ; radius: number }[] = [
	...CRAB_BANKS.map((at, k) => ({ id: `banco-${k + 1}`, at, radius: CRAB_BANK_RADIUS })),
	{ id: 'banco-defeso', at: DEFESO_BANK, radius: CRAB_BANK_RADIUS },
	{ id: 'clareira-propagulos', at: PATCH.centre, radius: PATCH.radius }
];

/** The flood at world (x, z): ground inside TIDAL sinks to the tide's floor over its shore, never rising. */
export function flooded(x: number, z: number, h: number): number {
	if (h <= TIDE.floor || !insidePolygon(TIDAL, x, z)) return h;
	return h + (TIDE.floor - h) * ramp01(0, TIDE.shore, polygonEdgeDistance(TIDAL, x, z));
}

/** The high tide at world (x, z) over ground h (not under the river): the flood, the levee, the mud. */
export function tideShape(x: number, z: number, h: number): number {
	let out = flooded(x, z, h);
	for (const bank of MUD) {
		const d = distance(x, z, bank.at[0], bank.at[1]);
		if (d < bank.radius + TIDE.shore)
			out = Math.max(
				out,
				TIDE.mud + (TIDE.floor - TIDE.mud) * ramp01(bank.radius, bank.radius + TIDE.shore, d)
			);
	}
	const levee = polylineDistance(ARRIVAL_TRAIL, x, z) - LEVEE.halfWidth;
	out = Math.max(out, LEVEE.top - LEVEE.slope * Math.max(0, levee));
	return out;
}

// --- The zone --------------------------------------------------------------------------------

export function buildManguezalZone(built: ReadonlyMap<ZoneId, ZoneBuild>): ManguezalBuild {
	const problems: string[] = [];
	const { width, depth, side, ground, band } = zoneGround('manguezal', built);
	if (width !== W || depth !== D || side !== SIDE) throw new Error('the Manguezal must be 200 × 160');
	const keep = band.seam;
	const river = carveRiver(ground, OX, OZ, width, depth, keep);
	for (let q = 0; q < CELLS; q++) {
		const i = q % SIDE;
		const j = (q - i) / SIDE;
		if (keep[q] || j < SEAM_KEEP) continue;
		// Under the river only the flood applies: its shallow banks deepen to the tide's floor.
		ground[q] = river.wet[q] ? flooded(OX + i, OZ + j, ground[q]) : tideShape(OX + i, OZ + j, ground[q]);
	}
	const heights = Float32Array.from(ground);

	// Zones and flags (zone.ts's rules, with the flood as sea and the levee as restinga).
	const zones = new Uint8Array(CELLS);
	const flags = new Uint8Array(CELLS);
	const tidal = new Uint8Array(CELLS);
	for (let q = 0; q < CELLS; q++) {
		const i = q % SIDE;
		const j = (q - i) / SIDE;
		const x = OX + i;
		const z = OZ + j;
		const h = heights[q];
		const wet = river.wet[q] === 1;
		const inTide = insidePolygon(TIDAL, x, z);
		tidal[q] = inTide ? 1 : 0;
		const shore = x - coastLine(z);
		const onLevee =
			polylineDistance(ARRIVAL_TRAIL, x, z) <= LEVEE.halfWidth + (LEVEE.top - TIDE.floor) / LEVEE.slope;
		const zone = wet
			? ZONE.river
			: h < WATER_LEVEL
				? ZONE.sea
				: inTide
					? onLevee
						? ZONE.restinga
						: ZONE.mangrove
					: shore < 2
						? ZONE.beach
						: insidePolygon(RESTINGA, x, z) || shore < 40
							? ZONE.restinga
							: x >= 110
								? ZONE.slope
								: ZONE.lowland;
		zones[q] = zone;
		let f = 0;
		if (wet) f |= FLAG.river;
		else if (h > WADE_LIMIT) f |= FLAG.walkable;
		if (!wet && h >= WATER_LEVEL && (zone === ZONE.lowland || zone === ZONE.slope || zone === ZONE.mangrove))
			f |= FLAG.forest;
		const toEdge = Math.min(i, j, W - i, D - j);
		if (toEdge < FENCE_MARGIN && !(j < FENCE_MARGIN && Math.abs(x - ENTRY_X) <= CROSSING_HALF))
			f &= ~FLAG.walkable;
		flags[q] = f;
	}

	// The decks, walkable at their own height.
	const plan = planDecks();
	const walkH = Float32Array.from(heights);
	const onDeck = new Uint8Array(CELLS);
	for (const piece of plan.pieces) {
		const r = piece.halfWidth + 1;
		const x0 = Math.max(0, floor(Math.min(piece.from.x, piece.to.x) - r));
		const x1 = Math.min(W, floor(Math.max(piece.from.x, piece.to.x) + r) + 1);
		const z0 = Math.max(0, floor(Math.min(piece.from.z, piece.to.z) - r));
		const z1 = Math.min(D, floor(Math.max(piece.from.z, piece.to.z) + r) + 1);
		for (let j = z0; j <= z1; j++)
			for (let i = x0; i <= x1; i++) {
				const on = onPiece(piece, i, j);
				if (on.d > piece.halfWidth) continue;
				const q = j * SIDE + i;
				walkH[q] = onDeck[q] ? Math.max(walkH[q], on.y) : on.y;
				onDeck[q] = 1;
				flags[q] |= FLAG.walkable | FLAG.crossing;
			}
	}

	// Arrival and reachability: on foot from the portal, and the canoe from the first landing to the second.
	const { arrival, inside, heading } = zoneArrival('manguezal', heights, SIDE);
	const steps = walkStepsRect(flags, walkH, W, D, cellOf(inside.x, inside.z));
	const [exitA, exitB] = plan.exits;
	const channelLength = arcLengths(CHANNEL)[CHANNEL.length - 1];
	const link = { from: cellOf(exitA.x, exitA.z), to: cellOf(exitB.x, exitB.z), length: channelLength };
	if (steps[link.from] < 0) problems.push('the first landing is unreachable on foot');
	else {
		const after = walkStepsRect(flags, walkH, W, D, link.to);
		const cost = steps[link.from] + floor(link.length + 0.5);
		for (let q = 0; q < CELLS; q++)
			if (after[q] >= 0 && (steps[q] < 0 || cost + after[q] < steps[q]))
				steps[q] = Math.min(32767, cost + after[q]);
	}

	const level = manguezalLevel(heights, plan, arrival, inside, heading);
	for (const p of reachTargets(level)) if (steps[cellOf(p.x, p.z)] < 0) problems.push(`${p.id} unreachable`);
	for (const c of level.collectibles)
		if (c.kind === 'trash' && offDecks(plan.pieces, c.x, c.z) + 0.7 > c.radius + 0.35)
			problems.push(`${c.id} out of reach of the deck`);

	// Vegetation.
	const clear = reserveGameplay(level, plan);
	const trees = plantTrees(zones, flags, clear, plan, level);
	const decorations = coverGround(zones, flags, tidal, clear);
	const dryTrees = trees.filter((t) => t.kind !== MANGUE);
	level.content.trailMarks = [
		...placeTrailMarks(level.trails, dryTrees, (x, z) => heightIn(heights, SIDE, x, z), MARKS),
		...loopMarks(plan)
	];
	const treeSet = packRect(TREE_SPECIES, trees, heights);
	const rockSet = packRect(ROCK_KINDS, [], heights);
	const decoSet = packRect(DECORATION_KINDS, decorations, heights);
	const instances = treeSet.count + rockSet.count + decoSet.count;
	if (instances > MAX_INSTANCES) problems.push(`${instances} instances over ${MAX_INSTANCES}`);
	const blocks = fillBlocks(collisionBlocks(heights, W, D), treeSet, plan.pieces, level.content.rails);

	const stations = stationsIn(SPEC.x0, SPEC.z0, SPEC.x1, SPEC.z1);
	const animals = animalsOf(heights);
	const world: SurvivalWorld = {
		generatorVersion: ZONE_VERSION,
		seed: PARK_SEED,
		attempt: 1,
		worldSeed: PARK_SEED,
		problems:
			band.unresolved > 0 ? [...problems, `${band.unresolved} band vertices over the slope limit`] : problems,
		size: W,
		grid: SIDE,
		waterLevel: WATER_LEVEL,
		heights,
		zones,
		flags,
		baseSteps: steps,
		highlandHeight: Number.POSITIVE_INFINITY,
		river: {
			points: stations.map((s) => ({ x: s.x - OX, z: s.z - OZ, water: s.water })),
			halfWidth: stations.reduce((m, s) => Math.max(m, s.halfWidth), 0),
			depth: stations.reduce((m, s) => Math.max(m, s.depth), 0)
		},
		crossings: [],
		base: {
			x: inside.x,
			y: inside.y,
			z: inside.z,
			yawC: heading[0],
			yawS: heading[1],
			radius: 0,
			spawn: { x: inside.x, y: inside.y, z: inside.z },
			pieces: []
		},
		pois: [],
		threats: [],
		corridor: { cells: [], length: 0, fromSize: 0, toSize: 0, joinsTwoLargest: false },
		animals,
		cameraSpots: [],
		resources: [],
		trees: treeSet,
		rocks: rockSet,
		decorations: decoSet,
		blocks,
		counts: countAll(treeSet, rockSet, decoSet, level, animals.length),
		checksum: 0
	};
	world.checksum = checksumOf(world);
	level.checksum = checksumOf(level);
	return {
		id: 'manguezal',
		spec: SPEC,
		offsetX: OX,
		offsetZ: OZ,
		width: W,
		depth: D,
		world,
		level,
		band: { unresolved: band.unresolved, updates: band.updates, where: band.where }
	};
}

// --- Story data ------------------------------------------------------------------------------

function manguezalLevel(
	heights: Float32Array,
	plan: Plan,
	arrival: NonNullable<ZoneLevel['arrival']>,
	inside: Point & { yaw: number },
	heading: [number, number]
): ManguezalLevel {
	const ground = (x: number, z: number) => heightIn(heights, SIDE, x, z);
	/** The surface a player stands on at local (x, z): a deck, else the ground. */
	const surface = (x: number, z: number) => {
		const deck = deckAt(plan.pieces, x, z);
		return Number.isNaN(deck) ? ground(x, z) : deck;
	};
	const at = (p: XZ): Point => {
		const [x, z] = local(p);
		return { x, y: surface(x, z), z };
	};
	const plain = ({ x, y, z }: Point): Point => ({ x, y, z });
	const checkpoint = (id: string, p: Point, facing: Facing, mission: number): StoryCheckpoint => ({
		id,
		mission,
		min: { x: p.x - 2, y: p.y - 0.5, z: p.z - 2 },
		max: { x: p.x + 2, y: p.y + 3, z: p.z + 2 },
		spawn: plain(p),
		yaw: FACING[facing]
	});
	const trigger = (
		id: string,
		kind: ZoneTrigger['kind'],
		p: Point,
		radius: number,
		mission: number,
		tall = 4
	): ZoneTrigger => ({
		id,
		kind,
		x: p.x,
		y: p.y,
		z: p.z,
		radius,
		minY: p.y - tall / 2,
		maxY: p.y + tall,
		mission
	});
	const landmark = (
		id: string,
		kind: ZoneLandmark['kind'],
		p: Point,
		[yawC, yawS]: [number, number],
		label: string,
		height = 0
	): ZoneLandmark => ({ id, kind, label, silhouette: false, height, ...plain(p), yawC, yawS });
	const facingTo = (p: Point, q: Point) => headingTo(p.x, p.z, q.x, q.z);

	const [exitA, exitB] = plan.exits;
	const [cx, cz] = local(BOARDWALK.centre);
	/** The loop's deck nearest a world point: on its circle, towards it. */
	const loopNear = (p: XZ): Point => {
		const [x, z] = local(p);
		const d = distance(cx, cz, x, z);
		const lx = cx + ((x - cx) * BOARDWALK.radius) / d;
		const lz = cz + ((z - cz) * BOARDWALK.radius) / d;
		return { x: lx, y: surface(lx, lz), z: lz };
	};

	// M2: a crab on each bank, watched from the deck nearest it.
	const crabs = CRAB_BANKS.map(at);
	const watch = CRAB_BANKS.map(loopNear);
	// M3: planting spots on a ring in the patch.
	const [pcx, pcz] = local(PATCH.centre);
	const ringDirections: XZ[] = [
		[1, 0],
		[0.5, 0.8660254037844386],
		[-0.5, 0.8660254037844386],
		[-1, 0],
		[-0.5, -0.8660254037844386],
		[0.5, -0.8660254037844386]
	];
	const planting: PlantingSpot[] = ringDirections.slice(0, PATCH.spots).map(([dx, dz], k) => {
		const x = pcx + PATCH.ring * dx;
		const z = pcz + PATCH.ring * dz;
		return { id: `propagulo-${k + 1}`, mission: 3, cell: -1, x, y: ground(x, z), z };
	});
	// M4: trash in the roots by the loop.
	const trash: Collectible[] = TRASH.vertices.map((v, k) => {
		const [vx, vz] = plan.vertices[v];
		const dx = (vx - cx) / BOARDWALK.radius;
		const dz = (vz - cz) / BOARDWALK.radius;
		const out = TRASH.side[k] * TRASH.out;
		return {
			id: `lixo-${k + 1}`,
			kind: 'trash' as const,
			variant: TRASH.variants[k],
			mission: 4,
			radius: TRASH.radius,
			on: '',
			x: vx + dx * out,
			y: TRASH.y,
			z: vz + dz * out
		};
	});
	const trashDeck = (c: Collectible): Point => {
		const d = distance(cx, cz, c.x, c.z);
		const x = cx + ((c.x - cx) * BOARDWALK.radius) / d;
		const z = cz + ((c.z - cz) * BOARDWALK.radius) / d;
		return { x, y: surface(x, z), z };
	};
	const lookout = plan.hideLookout;
	const roost = { ...plain(at(HIDE.roost)), y: ground(...local(HIDE.roost)) + HIDE.roostHeight };

	const spawn = {
		x: inside.x,
		y: inside.y,
		z: inside.z,
		yawC: heading[0],
		yawS: heading[1],
		yaw: inside.yaw
	};
	const start: StoryCheckpoint = {
		id: 'chegada',
		mission: 0,
		min: { x: inside.x - 2, y: inside.y - 0.5, z: inside.z - 2 },
		max: { x: inside.x + 2, y: inside.y + 3, z: inside.z + 2 },
		spawn: plain(inside),
		yaw: inside.yaw
	};
	const pierBBack = (() => {
		const pier = plan.pieces.find((p) => p.id === 'pier-desembarque');
		if (!pier) throw new Error('no second pier');
		const len = distance(pier.from.x, pier.from.z, exitB.x, exitB.z);
		const x = exitB.x + ((pier.from.x - exitB.x) * 2) / len;
		const z = exitB.z + ((pier.from.z - exitB.z) * 2) / len;
		return { x, y: surface(x, z), z };
	})();
	const [hx, hz] = local(HIDE.at);
	const hide = { x: hx, y: BOARDWALK.y, z: hz };
	const checkpoints = [
		checkpoint('embarque', at(EMBARQUE), 'west', 1),
		checkpoint('desembarque', pierBBack, 'west', 1),
		checkpoint('propagulos', plan.platform, 'southWest', 3),
		checkpoint('esconderijo', hide, 'west', 5)
	];

	const triggers: ZoneTrigger[] = [
		trigger('desembarque', 'mission', exitB, 2, 1),
		...watch.map((p, k) => trigger(`caranguejo-${k + 1}`, 'observation', p, CRAB_WATCH, 2)),
		...planting.map((p) => trigger(p.id, 'planting', p, 1.2, 3)),
		trigger('esconderijo', 'observation', lookout, 2, 5)
	];

	const targets = [
		exitB,
		watch[0],
		{ x: pcx, y: ground(pcx, pcz), z: pcz },
		trashDeck(trash[0]),
		lookout
	].map(plain);
	const missions: ZoneMission[] = [
		{
			id: 1,
			key: 'travessia-canoa',
			name: MANGUE_MISSION_NAMES[0],
			requires: [],
			target: targets[0],
			count: 1,
			dialogue: [
				'MANGUE_INTRO_1',
				'MANGUE_INTRO_2',
				'MANGUE_M1_INTRO',
				'MANGUE_M1_DONE',
				'MANGUE_NAO_PISE',
				'FACT_MANGUE_BERCARIO'
			],
			triggers: ['desembarque']
		},
		{
			id: 2,
			key: 'caranguejo-uca',
			name: MANGUE_MISSION_NAMES[1],
			requires: [1],
			target: targets[1],
			count: watch.length,
			dialogue: [
				'MANGUE_M2_INTRO',
				'MANGUE_M2_DONE',
				'MANGUE_DEFESO_PLACA',
				'FACT_DEFESO_CARANGUEJO',
				'FACT_CARANGUEJO_UCA'
			],
			triggers: watch.map((_, k) => `caranguejo-${k + 1}`)
		},
		{
			id: 3,
			key: 'propagulos',
			name: MANGUE_MISSION_NAMES[2],
			requires: [1],
			target: targets[2],
			count: planting.length,
			dialogue: ['MANGUE_M3_INTRO', 'MANGUE_M3_DONE', 'FACT_PROPAGULO'],
			triggers: planting.map((p) => p.id)
		},
		{
			id: 4,
			key: 'lixo-raizes',
			name: MANGUE_MISSION_NAMES[3],
			requires: [1],
			target: targets[3],
			count: trash.length,
			dialogue: ['MANGUE_M4_INTRO', 'MANGUE_M4_DONE', 'FACT_LIXO_RIO_MAR'],
			triggers: trash.map((c) => c.id)
		},
		{
			id: 5,
			key: 'colhereiros',
			name: MANGUE_MISSION_NAMES[4],
			requires: [1],
			target: targets[4],
			count: 1,
			dialogue: ['MANGUE_M5_INTRO', 'MANGUE_M5_DONE', 'FACT_GUARA', 'FACT_GUARA_CUBATAO'],
			triggers: ['esconderijo']
		}
	];

	const collectibles: Collectible[] = [
		...trash,
		...missions.map((m) => ({
			id: `folha-missao-${m.id}`,
			kind: 'gold-leaf' as const,
			variant: '',
			mission: m.id,
			radius: 1.2,
			on: '',
			...m.target
		}))
	];

	const trails: Trail[] = [
		{
			id: 'trilha-mangue',
			halfWidth: TRAIL_HALF_WIDTH,
			points: ARRIVAL_TRAIL.map((p) => local(p) as [number, number])
		}
	];
	const trailPoint = (p: XZ): Point => {
		const [x, z] = local(p);
		let best: Point = { x, y: 0, z };
		let bestD = Number.POSITIVE_INFINITY;
		for (let k = 0; k + 1 < ARRIVAL_TRAIL.length; k++) {
			const [ax, az] = local(ARRIVAL_TRAIL[k]);
			const [bx, bz] = local(ARRIVAL_TRAIL[k + 1]);
			const { d2, t } = segmentDistance2(ax, az, bx, bz, x, z);
			if (d2 < bestD) {
				bestD = d2;
				best = { x: ax + (bx - ax) * t, y: 0, z: az + (bz - az) * t };
			}
		}
		return best;
	};
	const sign = at(ZONE_SIGN.at);
	const defeso = at(DEFESO_SIGN);
	const atracadouro = at(EMBARQUE);
	const landmarks: ZoneLandmark[] = [
		landmark(
			'placa-manguezal',
			'zone-sign',
			sign,
			facingTo(sign, trailPoint(ZONE_SIGN.at)),
			MANGUE_TEXT.LABEL_MANGUEZAL.text,
			ZONE_SIGN.height
		),
		landmark(
			'placa-defeso',
			'trail-sign',
			defeso,
			facingTo(defeso, trailPoint(DEFESO_SIGN)),
			MANGUE_TEXT.LABEL_DEFESO.text
		),
		landmark(
			'atracadouro',
			'trail-sign',
			atracadouro,
			facingTo(atracadouro, exitA),
			MANGUE_TEXT.LABEL_ATRACADOURO.text
		),
		landmark(
			'esconderijo',
			'lookout',
			hide,
			facingTo(hide, roost),
			MANGUE_TEXT.LABEL_ESCONDERIJO.text,
			HIDE.screenHeight
		)
	];

	// The mechanics: a Boardwalk per deck (the hide's with its lookout), the canoe.
	const hideLookout: Lookout = {
		id: 'esconderijo',
		position: plain(lookout),
		camera: { x: lookout.x, y: lookout.y + HIDE.cameraLift, z: lookout.z },
		target: roost
	};
	const boardwalks: BoardwalkSpec[] = plan.pieces.map((piece) => ({
		id: piece.id,
		start: plain(piece.from),
		end: plain(piece.to),
		width: piece.halfWidth * 2,
		lookouts: piece.id === 'esconderijo' ? [hideLookout] : []
	}));
	const canoe: CanoeSpec = {
		id: 'canoa',
		channel: CHANNEL.map(([x, z]) => ({ x, y: WATER_LEVEL, z })),
		halfWidth: CANOE.halfWidth,
		landings: CANOE.landings.map((l, k) => ({
			id: l.id,
			water: { x: l.water[0] - OX, y: WATER_LEVEL, z: l.water[1] - OZ },
			exit: plain(plan.exits[k])
		})),
		currentSpeed: CANOE.current
	};
	const banks: MudBank[] = MUD.map((b) => ({ id: b.id, radius: b.radius, ...at(b.at) }));
	const [ax, az] = local(HIDE.arrivesFrom);
	const content: ManguezalContent = {
		// Filled after the planting: marks go on trunks by the trail.
		trailMarks: [],
		mechanics: { bridges: [], boardwalks, lookouts: [], cameraTraps: [] },
		homes: homesOf(heights, roost),
		basins: [],
		text: MANGUE_TEXT,
		canoes: [canoe],
		decks: plan.pieces,
		rails: railsOf(plan),
		banks,
		crabs,
		tide: { water: WATER_LEVEL, floor: TIDE.floor, mud: TIDE.mud },
		colhereiros: {
			time: 'dusk',
			flock: HOMES.colhereiros.group,
			roost,
			arrivesFrom: { x: ax, y: roost.y + 6, z: az }
		}
	};

	return {
		version: ZONE_VERSION,
		spawn,
		start,
		checkpoints,
		killY: -6,
		missions,
		obbies: [],
		collectibles,
		triggers,
		landmarks,
		trails,
		planting,
		pool: { x: 0, z: 0, water: WATER_LEVEL, axisX: 1, axisZ: 0, halfLength: 0, halfWidth: 0 },
		mirante: plain(lookout),
		handholds: [],
		arrival,
		content,
		checksum: 0
	};
}

/** Rails both sides of every deck, open where a spur leaves the loop and at the piers' ends; the hide's screens. */
function railsOf(plan: Plan): DeckRail[] {
	const rails: DeckRail[] = [];
	const n = plan.vertices.length;
	const [cx, cz] = local(BOARDWALK.centre);
	const add = (
		piece: DeckPiece,
		side: number,
		trimFrom: number,
		trimTo: number,
		height = BOARDWALK.railHeight
	) => {
		const { from, to } = piece;
		const len = distance(from.x, from.z, to.x, to.z);
		const ux = (to.x - from.x) / len;
		const uz = (to.z - from.z) / len;
		// Normal to the left of the direction (−uz, ux), scaled by side.
		const ox = -uz * piece.halfWidth * side;
		const oz = ux * piece.halfWidth * side;
		const t0 = trimFrom / len;
		const t1 = 1 - trimTo / len;
		if (t1 <= t0) return;
		rails.push({
			x0: from.x + (to.x - from.x) * t0 + ox,
			y0: from.y + (to.y - from.y) * t0,
			z0: from.z + (to.z - from.z) * t0 + oz,
			x1: from.x + (to.x - from.x) * t1 + ox,
			y1: from.y + (to.y - from.y) * t1,
			z1: from.z + (to.z - from.z) * t1 + oz,
			height
		});
	};
	/** The side (±1) of a loop chord facing outwards. */
	const outwards = (piece: DeckPiece) => {
		const mx = (piece.from.x + piece.to.x) / 2 - cx;
		const mz = (piece.from.z + piece.to.z) / 2 - cz;
		const dx = piece.to.x - piece.from.x;
		const dz = piece.to.z - piece.from.z;
		return -dz * mx + dx * mz > 0 ? 1 : -1;
	};
	const spurs: Record<number, number> = { [JUNCTION.hide]: 1, [JUNCTION.patch]: 1, [JUNCTION.pier]: -1 };
	for (let k = 0; k < n; k++) {
		const piece = plan.pieces[k];
		const out = outwards(piece);
		for (const side of [out, -out]) {
			const facing = side === out ? 1 : -1;
			const trimFrom = spurs[k] === facing ? RAIL_GAP : 0;
			const trimTo = spurs[(k + 1) % n] === facing ? RAIL_GAP : 0;
			add(piece, side, trimFrom, trimTo);
		}
	}
	const byId = (id: string) => {
		const piece = plan.pieces.find((p) => p.id === id);
		if (!piece) throw new Error(id);
		return piece;
	};
	// Spurs and piers: both sides, from the loop's edge; open at their far ends.
	for (const id of ['pier-desembarque', 'ramal-esconderijo', 'ramal-propagulos'])
		for (const side of [1, -1]) add(byId(id), side, BOARDWALK.width / 2, 0);
	for (const side of [1, -1]) add(byId('pier-embarque'), side, 0, 0);
	for (const side of [1, -1]) add(byId('plataforma-propagulos'), side, 0, PATCH.platformIn + 0.5);
	// The hide: a rail on the north (open at the spur) and east, screens west (towards the roost) and south.
	const [hx, hz] = local(HIDE.at);
	const y = BOARDWALK.y;
	const h = HIDE.half;
	const run = (x0: number, z0: number, x1: number, z1: number, height: number) =>
		rails.push({ x0, y0: y, z0, x1, y1: y, z1, height });
	run(hx - h, hz - h, hx - HIDE.entryGap, hz - h, BOARDWALK.railHeight);
	run(hx + HIDE.entryGap, hz - h, hx + h, hz - h, BOARDWALK.railHeight);
	run(hx + h, hz - h, hx + h, hz + h, BOARDWALK.railHeight);
	run(hx - h, hz + h, hx + h, hz + h, HIDE.screenHeight);
	run(hx - h, hz - h, hx - h, hz + h, HIDE.screenHeight);
	return rails;
}

/** Trail marks on the loop's outer rail, about every MARKS.spacing u, facing the deck. */
function loopMarks(plan: Plan): TrailMark[] {
	const n = plan.vertices.length;
	const chord = distance(plan.vertices[0][0], plan.vertices[0][1], plan.vertices[1][0], plan.vertices[1][1]);
	const count = Math.max(1, floor((n * chord) / MARKS.spacing + 0.5));
	const [cx, cz] = local(BOARDWALK.centre);
	const marks: TrailMark[] = [];
	for (let m = 0; m < count; m++) {
		const along = ((m + 0.5) * n) / count;
		const k = floor(along);
		const t = along - k;
		const piece = plan.pieces[k];
		const x = piece.from.x + (piece.to.x - piece.from.x) * t;
		const z = piece.from.z + (piece.to.z - piece.from.z) * t;
		const d = distance(cx, cz, x, z);
		const out = BOARDWALK.width / 2;
		const mx = x + ((x - cx) * out) / d;
		const mz = z + ((z - cz) * out) / d;
		const [yawC, yawS] = headingTo(mx, mz, x, z);
		marks.push({
			trail: 'passarela',
			on: 'post',
			x: mx,
			y: piece.from.y + (piece.to.y - piece.from.y) * t,
			z: mz,
			yawC,
			yawS,
			height: MARKS.height
		});
	}
	return marks;
}

function homesOf(heights: Float32Array, roost: Point): ZoneHome[] {
	const at = ([x, z]: XZ): Point => {
		const [lx, lz] = local([x, z]);
		return { x: lx, y: heightIn(heights, SIDE, lx, lz), z: lz };
	};
	return [
		{
			id: 'caranguejos',
			species: 'caranguejo-uca',
			...at(HOMES.caranguejos.at),
			group: HOMES.caranguejos.group,
			radius: HOMES.caranguejos.radius,
			rarity: 'common',
			time: 'day',
			tree: null,
			fact: 'FACT_CARANGUEJO_UCA'
		},
		{
			id: 'colhereiros',
			species: 'colhereiro',
			...at(HOMES.colhereiros.at),
			group: HOMES.colhereiros.group,
			radius: HOMES.colhereiros.radius,
			rarity: 'uncommon',
			time: 'dusk',
			tree: roost,
			fact: 'FACT_GUARA'
		},
		{
			id: 'garca',
			species: 'garca-branca',
			...at(HOMES.garca.at),
			group: HOMES.garca.group,
			radius: HOMES.garca.radius,
			rarity: 'common',
			time: 'day',
			tree: null,
			fact: 'FACT_GARCA_BRANCA'
		},
		{
			id: 'capivaras',
			species: 'capivara',
			...at(HOMES.capivaras.at),
			group: HOMES.capivaras.group,
			radius: HOMES.capivaras.radius,
			rarity: 'common',
			time: 'day',
			tree: null,
			fact: 'FACT_CAPIVARA'
		}
	];
}

/** The album species among the homes (survival's AnimalHome): the caranguejo-uçá alone. */
function animalsOf(heights: Float32Array): AnimalHome[] {
	return ALBUM.filter((entry) => entry.species === 'caranguejo-uca').map((entry, id) => {
		const [x, z] = local(HOMES.caranguejos.at);
		return {
			id,
			species: entry.species,
			zone: entry.zone,
			radius: HOMES.caranguejos.radius,
			x,
			y: heightIn(heights, SIDE, x, z),
			z
		};
	});
}

/** Everything the story needs to reach on foot or by deck (the trash is reached from the deck beside it). */
export function reachTargets(level: ZoneLevel): { id: string; x: number; z: number }[] {
	return [
		...level.missions.map((m) => ({ id: `missao-${m.id}`, x: m.target.x, z: m.target.z })),
		...[level.start, ...level.checkpoints].map((c) => ({
			id: `checkpoint ${c.id}`,
			x: c.spawn.x,
			z: c.spawn.z
		})),
		...level.collectibles.filter((c) => c.kind !== 'trash').map((c) => ({ id: c.id, x: c.x, z: c.z })),
		...level.planting.map((p) => ({ id: p.id, x: p.x, z: p.z })),
		...level.triggers.map((t) => ({ id: `gatilho ${t.id}`, x: t.x, z: t.z }))
	];
}

// --- Vegetation ----------------------------------------------------------------------------

interface Item {
	kind: number;
	x: number;
	z: number;
	scale: number;
	yawC: number;
	yawS: number;
}

const RESERVED = 1;
const OCCUPIED = 2;

function paint(mask: Uint8Array, x: number, z: number, r: number, bit: number) {
	for (let j = Math.max(0, floor(z - r)); j <= Math.min(D, floor(z + r) + 1); j++)
		for (let i = Math.max(0, floor(x - r)); i <= Math.min(W, floor(x + r) + 1); i++)
			if (distance(i, j, x, z) <= r) mask[j * SIDE + i] |= bit;
}

/** Ground kept free of trees and ground cover: every place the story uses. */
function reserveGameplay(level: ZoneLevel, plan: Plan): Uint8Array {
	const clear = new Uint8Array(CELLS);
	for (const m of level.missions) paint(clear, m.target.x, m.target.z, 2.5, RESERVED);
	for (const c of [level.start, ...level.checkpoints]) paint(clear, c.spawn.x, c.spawn.z, 2.5, RESERVED);
	for (const c of level.collectibles) paint(clear, c.x, c.z, 1.2, RESERVED);
	for (const p of level.planting) paint(clear, p.x, p.z, 1.5, RESERVED);
	for (const l of level.landmarks) paint(clear, l.x, l.z, 2.5, RESERVED);
	for (const e of plan.exits) paint(clear, e.x, e.z, 3, RESERVED);
	return clear;
}

const weightsOf = <K extends string>(kinds: readonly K[], mix: Partial<Record<K, number>>) =>
	kinds.map((s) => mix[s] ?? 0);
const TREE_MIX = {
	restinga: weightsOf(TREE_SPECIES, { jeriva: 0.45, 'pau-brasil': 0.2, 'ipe-rosa': 0.15, embauba: 0.2 }),
	lowland: weightsOf(TREE_SPECIES, {
		jucara: 0.3,
		embauba: 0.2,
		'pau-brasil': 0.2,
		'ipe-rosa': 0.15,
		jeriva: 0.15
	})
};
const DECO_MIX = {
	restinga: weightsOf(DECORATION_KINDS, {
		grass: 0.2,
		flower: 0.1,
		bush: 0.3,
		bromelia: 0.15,
		'beach-grass': 0.25
	}),
	lowland: weightsOf(DECORATION_KINDS, { grass: 0.25, flower: 0.15, bush: 0.2, fern: 0.3, bromelia: 0.1 }),
	beach: weightsOf(DECORATION_KINDS, { 'beach-grass': 1 })
};
const MANGUE = TREE_SPECIES.indexOf('mangue-vermelho');

function plantTrees(
	zones: Uint8Array,
	flags: Uint8Array,
	clear: Uint8Array,
	plan: Plan,
	level: ManguezalLevel
): Item[] {
	const trees: Item[] = [];
	const trail = level.trails[0].points as XZ[];
	const channel = CHANNEL;
	const banks = level.content.banks;
	const hide = local(HIDE.at);
	const roost = local(HIDE.roost);
	const sight: XZ[] = [hide, roost];
	const clearOfWater = (x: number, z: number, r: number) =>
		offDecks(plan.pieces, x, z) >= CLEAR.deck + r &&
		polylineDistance(channel, x, z) >= CANOE.halfWidth + CLEAR.channel + r &&
		polylineDistance(trail, x, z) >= LEVEE.halfWidth + CLEAR.levee + r &&
		banks.every(
			(b) =>
				distance(x, z, b.x, b.z) >= b.radius + (b.radius > CRAB_BANK_RADIUS ? CLEAR.patch : CLEAR.bank) + r
		);
	const free = (x: number, z: number) => {
		const q = cellOf(x, z);
		return clear[q] === 0 && (flags[q] & FLAG.river) === 0;
	};

	// The roost: big mangroves where the colhereiros settle, then the flood's mangroves.
	const rng = new Rng(subSeed(SEED, 1));
	for (let k = 0; k < HIDE.roostTrees; k++) {
		const [dx, dz] = rng.heading();
		const x = roost[0] + dx * 2.5 * (k === 0 ? 0 : 1);
		const z = roost[1] + dz * 2.5 * (k === 0 ? 0 : 1);
		const [yawC, yawS] = rng.heading();
		trees.push({ kind: MANGUE, x, z, scale: 1.3, yawC, yawS });
		paint(clear, x, z, 1.5, OCCUPIED);
	}
	const flood = poissonDisk(rng, 1, 1, W - 1, D - 1, MANGROVE.spacing);
	for (let k = 0; k < flood.length; k += 2) {
		const x = flood[k];
		const z = flood[k + 1];
		const q = cellOf(x, z);
		if (!insidePolygon(TIDAL, x + OX, z + OZ) || !free(x, z)) continue;
		if (zones[q] !== ZONE.sea && zones[q] !== ZONE.mangrove) continue;
		const scale = rng.range(MANGROVE.scale[0], MANGROVE.scale[1]);
		const r = 0.3 * scale;
		if (!clearOfWater(x, z, r)) continue;
		if (polylineDistance(sight, x, z) < HIDE.sightClear + r && distance(x, z, roost[0], roost[1]) > 4)
			continue;
		const [yawC, yawS] = rng.heading();
		trees.push({ kind: MANGUE, x, z, scale, yawC, yawS });
		paint(clear, x, z, 1, OCCUPIED);
	}

	// Root clumps: young mangroves behind each piece of trash, and along the loop.
	const clumps = new Rng(subSeed(SEED, 2));
	const [cx, cz] = local(BOARDWALK.centre);
	for (const c of level.collectibles) {
		if (c.kind !== 'trash') continue;
		const d = distance(cx, cz, c.x, c.z);
		const out = d > BOARDWALK.radius ? TRASH.clumpOut : -TRASH.clumpOut;
		const x = c.x + ((c.x - cx) * out) / d;
		const z = c.z + ((c.z - cz) * out) / d;
		const [yawC, yawS] = clumps.heading();
		trees.push({ kind: MANGUE, x, z, scale: MANGROVE.clumpScale[0], yawC, yawS });
	}
	const band = poissonDisk(clumps, 1, 1, W - 1, D - 1, MANGROVE.clumpSpacing);
	for (let k = 0; k < band.length; k += 2) {
		const x = band[k];
		const z = band[k + 1];
		const fromLoop = Math.abs(distance(cx, cz, x, z) - BOARDWALK.radius);
		const scale = clumps.range(MANGROVE.clumpScale[0], MANGROVE.clumpScale[1]);
		if (fromLoop > 5 || !insidePolygon(TIDAL, x + OX, z + OZ) || !free(x, z)) continue;
		if (!clearOfWater(x, z, 0.3 * scale)) continue;
		const [yawC, yawS] = clumps.heading();
		trees.push({ kind: MANGUE, x, z, scale, yawC, yawS });
		paint(clear, x, z, 1, OCCUPIED);
	}

	// Inland: restinga and lowland forest, clear of the trail.
	const inland = new Rng(subSeed(SEED, 3));
	const dry = poissonDisk(inland, 1, 1, W - 1, D - 1, INLAND.spacing);
	for (let k = 0; k < dry.length; k += 2) {
		const x = dry[k];
		const z = dry[k + 1];
		const q = cellOf(x, z);
		const zone = zones[q];
		if (insidePolygon(TIDAL, x + OX, z + OZ) || !free(x, z) || !(flags[q] & FLAG.walkable)) continue;
		if (zone !== ZONE.restinga && zone !== ZONE.lowland && zone !== ZONE.slope) continue;
		if (polylineDistance(trail, x, z) < TRAIL_CLEARANCE + 0.4) continue;
		const kind = inland.weighted(zone === ZONE.restinga ? TREE_MIX.restinga : TREE_MIX.lowland);
		const scale = inland.range(INLAND.scale[0], INLAND.scale[1]);
		const [yawC, yawS] = inland.heading();
		trees.push({ kind, x, z, scale, yawC, yawS });
		paint(clear, x, z, 1.2, OCCUPIED);
	}
	return trees;
}

function coverGround(zones: Uint8Array, flags: Uint8Array, tidal: Uint8Array, clear: Uint8Array): Item[] {
	const rng = new Rng(subSeed(SEED, 4));
	const trail = ARRIVAL_TRAIL.map(local);
	const out: Item[] = [];
	const points = poissonDisk(rng, 1, 1, W - 1, D - 1, COVER.spacing);
	for (let k = 0; k < points.length; k += 2) {
		const x = points[k];
		const z = points[k + 1];
		const q = cellOf(x, z);
		const f = flags[q];
		const zone = zones[q];
		if (clear[q] & RESERVED || f & (FLAG.river | FLAG.crossing) || !(f & FLAG.walkable)) continue;
		if (tidal[q] && zone !== ZONE.restinga) continue;
		if (polylineDistance(trail, x, z) < TRAIL_HALF_WIDTH + 0.4) continue;
		const mix: number[] | null =
			zone === ZONE.beach
				? DECO_MIX.beach
				: zone === ZONE.restinga
					? DECO_MIX.restinga
					: zone === ZONE.lowland || zone === ZONE.slope
						? DECO_MIX.lowland
						: null;
		if (!mix) continue;
		const kind = rng.weighted(mix);
		const scale = rng.range(COVER.scale[0], COVER.scale[1]);
		const [yawC, yawS] = rng.heading();
		out.push({ kind, x, z, scale, yawC, yawS });
	}
	return out;
}

// --- Packing and collision ------------------------------------------------------------------

/** survival/generate.ts pack for this zone's 5 × 4 blocks: sorted by block, then kind, then order. */
function packRect<K extends string>(
	kinds: readonly K[],
	items: Item[],
	heights: Float32Array
): Placements<K> {
	const keys = items.map((it) => blockOf(it.x, it.z) * 256 + it.kind);
	const order = items.map((_, k) => k).sort((a, b) => keys[a] - keys[b] || a - b);
	const n = items.length;
	const out: Placements<K> = {
		kinds,
		count: n,
		kind: new Uint8Array(n),
		block: new Uint8Array(n),
		x: new Float32Array(n),
		y: new Float32Array(n),
		z: new Float32Array(n),
		scale: new Float32Array(n),
		yawC: new Float32Array(n),
		yawS: new Float32Array(n)
	};
	for (let w = 0; w < n; w++) {
		const it = items[order[w]];
		out.kind[w] = it.kind;
		out.block[w] = keys[order[w]] >> 8;
		out.x[w] = it.x;
		out.y[w] = heightIn(heights, SIDE, it.x, it.z);
		out.z[w] = it.z;
		out.scale[w] = it.scale;
		out.yawC[w] = it.yawC;
		out.yawS[w] = it.yawS;
	}
	return out;
}

/** Trunks as cylinders, the decks as bridge decks and the rails and screens as thin boxes, per block. */
function fillBlocks(
	blocks: ReturnType<typeof collisionBlocks>,
	trees: Placements<TreeSpecies>,
	pieces: readonly DeckPiece[],
	rails: readonly DeckRail[]
): ReturnType<typeof collisionBlocks> {
	const cylinders: number[][] = blocks.map(() => []);
	const boxes: number[][] = blocks.map(() => []);
	const decks: number[][] = blocks.map(() => []);
	for (let k = 0; k < trees.count; k++) {
		const species = TREE_SPECIES[trees.kind[k]];
		const s = trees.scale[k];
		const bottom = trees.y[k] - 0.3;
		const height = TRUNK_HEIGHT * s;
		const top =
			species === 'mangue-vermelho' ? Math.max(bottom + height, MANGROVE_COLLIDER_TOP) : bottom + height;
		cylinders[trees.block[k]].push(
			trees.x[k],
			bottom,
			trees.z[k],
			(TRUNK_RADIUS[species] ?? 0.3) * s,
			top - bottom
		);
	}
	for (const p of pieces)
		decks[blockOf((p.from.x + p.to.x) / 2, (p.from.z + p.to.z) / 2)].push(
			p.from.x,
			p.from.y,
			p.from.z,
			p.to.x,
			p.to.y,
			p.to.z,
			p.halfWidth,
			DECK_THICKNESS
		);
	for (const r of rails) {
		const len = distance(r.x0, r.z0, r.x1, r.z1);
		const low = Math.min(r.y0, r.y1);
		const high = Math.max(r.y0, r.y1) + r.height;
		boxes[blockOf((r.x0 + r.x1) / 2, (r.z0 + r.z1) / 2)].push(
			(r.x0 + r.x1) / 2,
			(low + high) / 2,
			(r.z0 + r.z1) / 2,
			RAIL_HALF_THICKNESS,
			(high - low) / 2,
			len / 2,
			(r.z1 - r.z0) / len,
			(r.x1 - r.x0) / len
		);
	}
	return blocks.map((block) => ({
		...block,
		cylinders: Float32Array.from(cylinders[block.index]),
		boxes: Float32Array.from(boxes[block.index]),
		decks: Float32Array.from(decks[block.index])
	}));
}

/** Survival's count keys (generate.ts countAll's), plus the story's and this zone's mechanics. */
function countAll(
	trees: Placements<TreeSpecies>,
	rocks: Placements<string>,
	decorations: Placements<DecorationKind>,
	level: ManguezalLevel,
	animals: number
): Record<string, number> {
	const counts: Record<string, number> = {};
	const tally = (prefix: string, kinds: readonly string[], of: ArrayLike<number>) => {
		for (const kind of kinds) counts[`${prefix}:${kind}`] = 0;
		for (let k = 0; k < of.length; k++) counts[`${prefix}:${kinds[of[k]]}`]++;
	};
	tally('tree', TREE_SPECIES, trees.kind);
	tally('rock', ROCK_KINDS, rocks.kind);
	tally('decoration', DECORATION_KINDS, decorations.kind);
	tally('threat', THREAT_KINDS, []);
	tally('resource', RESOURCE_KINDS, []);
	counts.poi = 0;
	counts.planting = level.planting.length;
	counts.camera = 0;
	counts.animal = animals;
	// The busiest 100 × 80 u quadrant per species (blocks 0–2 west, 3–4 east).
	const quadrants = new Int32Array(TREE_SPECIES.length * 4);
	for (let k = 0; k < trees.count; k++) {
		const bx = trees.block[k] % BLOCKS_X;
		const bz = (trees.block[k] - bx) / BLOCKS_X;
		quadrants[trees.kind[k] * 4 + (bz >> 1) * 2 + (bx < 3 ? 0 : 1)]++;
	}
	TREE_SPECIES.forEach((species, s) => {
		counts[`treeQuadrantMax:${species}`] = Math.max(
			quadrants[s * 4],
			quadrants[s * 4 + 1],
			quadrants[s * 4 + 2],
			quadrants[s * 4 + 3]
		);
	});
	counts.instances = trees.count + rocks.count + decorations.count;
	for (const kind of ['jucara-fruit', 'trash', 'gold-leaf'])
		counts[`collectible:${kind}`] = level.collectibles.filter((c) => c.kind === kind).length;
	counts.checkpoint = level.checkpoints.length + 1;
	counts['obby:stone'] = 0;
	counts['obby:ledge'] = 0;
	counts.trailMark = level.content.trailMarks.length;
	counts.bridge = 0;
	counts.boardwalk = level.content.mechanics.boardwalks.length;
	counts.rail = level.content.rails.length;
	counts.canoe = level.content.canoes.length;
	return counts;
}
