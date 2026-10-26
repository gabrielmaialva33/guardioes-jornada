/**
 * Zone 'vale', the Vale das Cachoeiras (PARK.md §4.1, P25), built from the
 * control points of vale-layout.ts on the zone pipeline (zone.ts):
 *
 * 1. Ground: the skeleton stitched to the Reserva (zoneGround).
 * 2. Shape: the sheer face by the fall, the hill south of the pool, the
 *    pool's terrace, the stones' shelf, the bridge's abutments, the lookout.
 * 3. The park river (spec.ts): the fall, the 5 u cascade out of the pool,
 *    the gorge under the bridge with its walls, the rapids to the Reserva.
 * 4. Cut: the plunge pool and the spring basins, the cleft under the stones.
 * 5. Water and flags (wading on the basins' shallow rims), the obby, the
 *    bridge deck, reachability with both, the story data, the mechanics'
 *    specs, animal homes and the forest.
 *
 * Pure and deterministic (survival/random.ts's rules) and Worker-safe: no
 * three.js (kit.ts jumpReach is engine/graybox.ts's arithmetic on its constants).
 * The output is zone-local (x − 160, z), like every zone.
 */
import { checksumOf } from '../../survival/checksum.ts';
import { collisionBlocks, type Item, pack, paint } from '../../survival/generate.ts';
import { clamp, floor } from '../../survival/noise.ts';
import { poissonDisk } from '../../survival/poisson.ts';
import { Rng, subSeed } from '../../survival/random.ts';
import { heightAt } from '../../survival/terrain.ts';
import {
	ALBUM,
	type AnimalHome,
	type Crossing,
	DECORATION_KINDS,
	FLAG,
	type Point,
	ROCK_KINDS,
	type SurvivalWorld,
	TREE_SPECIES,
	type TreeSpecies,
	WATER_LEVEL,
	ZONE
} from '../../survival/types.ts';
import { smooth } from '../../world-gen/math.ts';
import { direction, distance, headingTo, polylineDistance } from '../geometry.ts';
import { cellOf, type JumpLink, stepsWithLinks } from '../reach.ts';
import type {
	Collectible,
	Obby,
	ObbyGap,
	ObbyTop,
	PlantingSpot,
	Pool,
	StoryCheckpoint,
	Trail
} from '../types.ts';
import {
	type Basin,
	type CameraTrapSpot,
	FACING,
	type Facing,
	HEADING,
	placeTrailMarks,
	type ZoneContent,
	type ZoneHome,
	type ZoneLandmark,
	type ZoneMission,
	type ZoneTrigger
} from './content.ts';
import {
	CELLS,
	countAll,
	FENCE_MARGIN,
	fenceEdges,
	flatten,
	forCells,
	GROW_SLOPE,
	jumpReach,
	lineTrails,
	MAX_TRUNK,
	N,
	OCCUPIED,
	RESERVED,
	ramp,
	slopeOf,
	type TrailTrees,
	weightsOf
} from './kit.ts';
import { carveRiver, riverInside, stationsIn } from './river.ts';
import { valeFloor, valeUpper, valeWall } from './skeleton.ts';
import {
	CROSSING_HALF,
	ENTRIES,
	PARK_SEED,
	PARK_ZONES,
	SEAMS,
	type XZ,
	ZONE_VERSION,
	type ZoneId
} from './spec.ts';
import {
	ABUTMENT,
	BRIDGE,
	CAMERA_TRUNK,
	CHECKPOINTS,
	CLEFT,
	DECORATION_SPACING,
	FACE,
	FALL,
	HILL,
	HOMES,
	LOOKOUT,
	PLANTING,
	POOL,
	RIPARIAN,
	ROCK_SPACING,
	SHELF,
	SPECIAL_TREES,
	SPRING,
	STONES,
	TARGETS,
	TRAIL_CLEARANCE,
	TRAIL_HALF_WIDTH,
	TRAIL_MARKS,
	TRAILS,
	TRASH,
	TREE_SPACING,
	ZONE_SIGN
} from './vale-layout.ts';
import { VALE_MISSION_NAMES, VALE_TEXT } from './vale-text.ts';
import { type ZoneBuild, type ZoneLevel, zoneArrival, zoneGround } from './zone.ts';

const SPEC = PARK_ZONES.vale;
const OX = SPEC.x0;
const OZ = SPEC.z0;
const SEED = subSeed(PARK_SEED, 0x0a1e);

/** The Vale is the Reserva's shape (160 × 160), so kit.ts's square-zone helpers apply. */
export { jumpReach } from './kit.ts';

// --- Terrain (world coordinates) ---------------------------------------------------------

/** The pool's axis, from the fall's foot to its centre, and the unit normal across it pointing south (+z). */
const POOL_DX = POOL.b[0] - POOL.a[0];
const POOL_DZ = POOL.b[1] - POOL.a[1];
const POOL_LEN2 = POOL_DX * POOL_DX + POOL_DZ * POOL_DZ;
const POOL_LEN = Math.sqrt(POOL_LEN2);
const POOL_NX = POOL_DZ > 0 ? POOL_DZ / POOL_LEN : -POOL_DZ / POOL_LEN;
const POOL_NZ = POOL_DZ > 0 ? -POOL_DX / POOL_LEN : POOL_DX / POOL_LEN;

/** Distance from (x, z) to the pool's axis. */
function poolDistance(x: number, z: number): number {
	const px = x - POOL.a[0];
	const pz = z - POOL.a[1];
	const t = clamp((px * POOL_DX + pz * POOL_DZ) / POOL_LEN2, 0, 1);
	const ex = px - t * POOL_DX;
	const ez = pz - t * POOL_DZ;
	return Math.sqrt(ex * ex + ez * ez);
}

/** Signed distance across the pool's axis line, positive to the south. */
const poolAcross = (x: number, z: number) => (x - POOL.a[0]) * POOL_NX + (z - POOL.a[1]) * POOL_NZ;

const springDistance = (x: number, z: number) => distance(x, z, SPRING.centre[0], SPRING.centre[1]);

/** Where the sheer face stands at z: by the fall, then stepped back beside the stones. */
export const faceX = (z: number) => (z <= FACE.recessZ ? FACE.x : FACE.recessX);

/** 1 along the sheer face's stretch, blending to 0 beyond its ends. */
const faceWeight = (z: number) =>
	smooth(FACE.z0 - FACE.blend, FACE.z0, z) * (1 - smooth(FACE.z1, FACE.z1 + FACE.blend, z));

const hillBump = (x: number, z: number) =>
	HILL.rise * smooth(HILL.z0, HILL.z1, z) * smooth(HILL.x0, HILL.x1, x) * (1 - smooth(HILL.z2, HILL.z3, z));

/**
 * The skeleton's relief with the hill on the lower valley and, along the fall,
 * the one-cell face instead of the skeleton's 6 u wall. Equal to the skeleton
 * west of HILL.x0, where neither applies.
 */
function design(x: number, z: number): number {
	const lower = valeFloor(x, z) + hillBump(x, z);
	const upper = valeUpper(x);
	const skeleton = lower + (upper - lower) * valeWall(x);
	const w = faceWeight(z);
	if (w === 0) return skeleton;
	const sheer = x >= faceX(z) ? upper : lower;
	return skeleton + (sheer - skeleton) * w;
}

/** Step 2 (after the band, before the river): the face, the hill and every flat the story stands on. */
export function valeShape(x: number, z: number, h: number): number {
	let g = x >= HILL.x0 ? design(x, z) : h;
	if (x >= faceX(z)) return g;
	g = Math.max(
		g,
		POOL.water + POOL.terrace - POOL.terraceFall * Math.max(0, poolDistance(x, z) - POOL.terraceTo)
	);
	if (x >= SHELF.x0 && z >= SHELF.z0 && z <= SHELF.z1) g = SHELF.y;
	g = flatten(g, x, z, BRIDGE.from, ABUTMENT.y, ABUTMENT.r0, ABUTMENT.r1);
	g = flatten(g, x, z, BRIDGE.to, ABUTMENT.y, ABUTMENT.r0, ABUTMENT.r1);
	return flatten(g, x, z, LOOKOUT.at, LOOKOUT.y, LOOKOUT.r0, LOOKOUT.r1);
}

/** The plunge pool's ground below (−) or above its water at distance d from the axis, `across` it. */
function poolDepth(d: number, across: number): number {
	const P = POOL;
	const south =
		d <= P.deepTo
			? -P.deep
			: d <= P.shelfAt
				? ramp(d, P.deepTo, P.shelfAt, -P.deep, -P.shelfDepth)
				: d <= P.rimTo
					? ramp(d, P.shelfAt, P.rimTo, -P.shelfDepth, -P.rimDepth)
					: ramp(d, P.rimTo, P.beachTo, -P.rimDepth, P.terrace);
	const north =
		d <= P.northDeepTo
			? -P.deep
			: d <= P.lipAt
				? ramp(d, P.northDeepTo, P.lipAt, -P.deep, -P.lipDepth)
				: P.terrace;
	return north + (south - north) * smooth(1, 2.5, across);
}

function springDepth(d: number): number {
	const S = SPRING;
	if (d <= S.eyeTo) return -S.deep;
	if (d <= S.shelfAt) return ramp(d, S.eyeTo, S.shelfAt, -S.deep, -S.shelfDepth);
	if (d <= S.rimTo) return ramp(d, S.shelfAt, S.rimTo, -S.shelfDepth, -S.rimDepth);
	return ramp(d, S.rimTo, S.bankTo, -S.rimDepth, S.bank);
}

/** Step 4 (after the river): the basins and the cleft under the stones; they only ever lower the ground. */
export function valeCut(x: number, z: number, h: number): number {
	let g = h;
	if (x < faceX(z)) {
		const d = poolDistance(x, z);
		if (d <= POOL.beachTo) g = Math.min(g, POOL.water + poolDepth(d, poolAcross(x, z)));
		if (x >= CLEFT.x0 && z >= CLEFT.z0 && z <= CLEFT.z1)
			g = Math.min(g, CLEFT.floor + CLEFT.rise * smooth(CLEFT.riseFrom, CLEFT.z1, z));
	}
	const s = springDistance(x, z);
	if (s <= SPRING.bankTo) g = Math.min(g, SPRING.water + springDepth(s));
	return g;
}

/** The basins as data (world coordinates). */
const BASINS: readonly Basin[] = [
	{ id: 'poco', a: POOL.a, b: POOL.b, radius: POOL.beachTo, water: POOL.water, wade: POOL.wade },
	{
		id: 'nascente',
		a: SPRING.centre,
		b: SPRING.centre,
		radius: SPRING.bankTo,
		water: SPRING.water,
		wade: SPRING.wade
	}
];

/**
 * The basin whose still water covers (x, z), or null. The river's own water
 * there must be the basin's: the gorge below the pool's outlet is not the pool.
 */
function basinAt(x: number, z: number, riverWater: number): Basin | null {
	const same = (w: number) => Number.isNaN(riverWater) || Math.abs(riverWater - w) < 0.5;
	if (x < faceX(z) && poolDistance(x, z) <= POOL.beachTo && same(POOL.water)) return BASINS[0];
	if (springDistance(x, z) <= SPRING.bankTo && same(SPRING.water)) return BASINS[1];
	return null;
}

// --- The obby (V5) -------------------------------------------------------------------------

interface Stones {
	takeoff: Point;
	pad: Point;
	landing: Point;
	dirX: number;
	dirZ: number;
	tops: ObbyTop[];
	gaps: ObbyGap[];
	/** Path length from the pad to the landing. */
	length: number;
}

/**
 * The stones from their gaps (build.ts planLedges' recipe): from the shelf's
 * take-off along the line to STONES.toward, each 1.5 u higher, alternating
 * left and right; a gap is edge to edge, and the forward step is what is left
 * of the centre distance after the sideways step. World coordinates.
 */
function planStones(): Stones {
	const [tx, tz] = STONES.takeoff;
	const [dx, dz] = direction(tx, tz, STONES.toward[0], STONES.toward[1]);
	const px = -dz;
	const pz = dx;
	const reach = jumpReach(STONES.rise);
	const count = STONES.gapFractions.length;
	const radius = (k: number) => (k < 0 ? 0 : k === count - 1 ? STONES.lastRadius : STONES.radius);
	const lateral = (k: number) =>
		k < 0 || k === count - 1 ? 0 : k % 2 === 0 ? -STONES.zigzag : STONES.zigzag;
	const tops: ObbyTop[] = [];
	const gaps: ObbyGap[] = [];
	let along = 0;
	for (let k = 0; k < count; k++) {
		const gap = STONES.gapFractions[k] * reach;
		const centre = gap + radius(k - 1) + radius(k);
		const side = lateral(k) - lateral(k - 1);
		along += Math.sqrt(centre * centre - side * side);
		tops.push({
			piece: 'stone',
			x: tx + dx * along + px * lateral(k),
			y: SHELF.y + STONES.rise * (k + 1),
			z: tz + dz * along + pz * lateral(k),
			yawC: dz,
			yawS: dx,
			radius: radius(k),
			variant: `${k % 3}`,
			bottom: 0
		});
		gaps.push({ gap, rise: STONES.rise, fraction: STONES.gapFractions[k], reachRise: STONES.rise });
	}
	const last = tops[count - 1];
	const [lx, lz] = STONES.landing;
	return {
		takeoff: { x: tx, y: SHELF.y, z: tz },
		pad: { x: tx - dx * STONES.padBack, y: SHELF.y, z: tz - dz * STONES.padBack },
		landing: { x: lx, y: 0, z: lz },
		dirX: dx,
		dirZ: dz,
		tops,
		gaps,
		length: STONES.padBack + along + distance(last.x, last.z, lx, lz)
	};
}

// --- The build ---------------------------------------------------------------------------

const TREE_MIX = {
	riparian: weightsOf({ jucara: 3, xaxim: 3, embauba: 2, jequitiba: 1 }),
	lower: weightsOf({ jucara: 4, jequitiba: 2, embauba: 2, xaxim: 2, 'ipe-rosa': 0.6, 'pau-brasil': 0.6 }),
	upper: weightsOf({ jucara: 4, xaxim: 3, jequitiba: 1, embauba: 1, araucaria: 0.5 })
};
/** Ground cover over DECORATION_KINDS (grass, flower, bush, fern, bromelia, beach-grass): a dense understorey. */
const DECO_MIX = {
	forest: [0.2, 0.4, 2, 4, 3, 0],
	riparian: [0, 0.3, 1, 5, 3, 0],
	clearing: [3, 2, 0.5, 0.3, 0.2, 0]
};
/** survival generate.ts's jequitibá trunk radius at scale 1 (the camera-trap trunk). */
const JEQUITIBA_TRUNK = 0.45;
/** Extra trees along the zone's edges, as in the Reserva, except at the two ways through. */
const EDGE_BAND = 4;
const EDGE_TREE_SPACING = 3.4;
/** The ways through the edges: the portal from the Reserva (spec.ts ENTRIES) and the Copa's crossing (SEAMS). */
const ENTRY_Z = ENTRIES.vale.at[1];
const COPA_CROSSING = SEAMS.find((s) => s.fixed === 'vale' && s.zone === 'copa')?.crossings[0] ?? [0, -1];
/** Trees lining the trails: one every `step` u on each side, `offset` to `offset + spread` from the centre line. */
const TRAIL_TREES: TrailTrees = { step: 5.5, offset: 3.55, spread: 0.8, density: 0.9 };

/** Builds zone 'vale' after the Reserva (its west seam). */
export function buildValeZone(built: ReadonlyMap<ZoneId, ZoneBuild>): ZoneBuild {
	const problems: string[] = [];
	const { width, depth, ground, band } = zoneGround('vale', built);
	if (width !== N - 1 || depth !== N - 1) throw new Error('the Vale must be 160 × 160');
	const keep = band.seam;
	for (let q = 0; q < CELLS; q++) {
		if (keep[q]) continue;
		const i = q % N;
		ground[q] = valeShape(OX + i, OZ + (q - i) / N, ground[q]);
	}
	const river = carveRiver(ground, OX, OZ, width, depth, keep);
	for (let q = 0; q < CELLS; q++) {
		if (keep[q]) continue;
		const i = q % N;
		ground[q] = valeCut(OX + i, OZ + (q - i) / N, ground[q]);
	}

	// Water: the river's channels and the basins; wading on a basin's shallow rim.
	const wet = new Uint8Array(CELLS);
	const wade = new Uint8Array(CELLS);
	for (let q = 0; q < CELLS; q++) {
		const i = q % N;
		const x = OX + i;
		const z = OZ + (q - i) / N;
		const h = ground[q];
		if (river.inside[q] > 0 && h < river.water[q]) wet[q] = 1;
		const basin = basinAt(x, z, river.water[q]);
		if (basin && h < basin.water) {
			wet[q] = 1;
			// The pool is waded on its south side only: north of it the bridge is the way over.
			if (basin.water - h <= basin.wade && (basin !== BASINS[0] || poolAcross(x, z) > 1)) wade[q] = 1;
		}
	}
	const heights = Float32Array.from(ground);
	const slope = slopeOf(heights);

	// The obby on the final ground: each stone a pillar from the ground under it.
	const stones = planStones();
	for (const top of stones.tops) {
		top.x -= OX;
		top.z -= OZ;
		top.bottom = groundUnder(heights, top) - 0.3;
	}
	for (const p of [stones.takeoff, stones.pad, stones.landing]) {
		p.x -= OX;
		p.z -= OZ;
	}
	stones.landing.y = heightAt(heights, stones.landing.x, stones.landing.z);

	// Zones and flags.
	const zones = new Uint8Array(CELLS);
	const flags = new Uint8Array(CELLS);
	for (let q = 0; q < CELLS; q++) {
		const i = q % N;
		const j = (q - i) / N;
		const x = OX + i;
		const z = OZ + j;
		const isWet = wet[q] === 1;
		zones[q] = isWet ? ZONE.river : slope[q] > GROW_SLOPE ? ZONE.highland : ZONE.slope;
		let f = 0;
		if (isWet) {
			f |= FLAG.river;
			if (wade[q]) f |= FLAG.walkable;
		} else f |= FLAG.walkable;
		const cleared =
			(x < faceX(z) && poolDistance(x, z) <= POOL.clearing) || springDistance(x, z) <= SPRING.clearing;
		if (!isWet && cleared) f |= FLAG.cleared;
		else if (!isWet && zones[q] === ZONE.slope) f |= FLAG.forest;
		flags[q] = f;
	}
	// The edges are rails (soft walls) but for the two ways through: the portal and the climb to the Copa.
	fenceEdges(
		flags,
		OX,
		OZ,
		(x, z) =>
			(x - OX < FENCE_MARGIN && Math.abs(z - ENTRY_Z) <= CROSSING_HALF) ||
			(z - OZ < FENCE_MARGIN && x >= COPA_CROSSING[0] && x <= COPA_CROSSING[1])
	);
	// Ground under a stone is the stone's.
	for (const top of stones.tops)
		forCells(top.x, top.z, top.radius + 1, (q, i, j) => {
			if (distance(i, j, top.x, top.z) <= top.radius) flags[q] &= ~FLAG.walkable;
		});

	// The bridge deck over the gorge, walkable at the height of the line between its ends.
	const walkH = Float32Array.from(heights);
	const clear = new Uint8Array(CELLS);
	const deckMid = cellOf((BRIDGE.from[0] + BRIDGE.to[0]) / 2 - OX, (BRIDGE.from[1] + BRIDGE.to[1]) / 2 - OZ);
	const bridge = makeBridge(heights, flags, walkH, clear, river.water[deckMid]);

	// Arrival and reachability: walking, the bridge, and the stones as one jump link up.
	const { arrival, inside, heading } = zoneArrival('vale', heights, N);
	const spawnCell = cellOf(inside.x, inside.z);
	const link: JumpLink = {
		from: cellOf(stones.pad.x, stones.pad.z),
		to: cellOf(stones.landing.x, stones.landing.z),
		length: stones.length
	};
	const steps = stepsWithLinks(flags, walkH, spawnCell, [link]);
	for (const g of stones.gaps)
		if (g.gap > jumpReach(g.rise)) problems.push(`obby gap ${g.gap.toFixed(2)} beyond reach`);

	// Story data, then the ground it keeps free.
	const level = valeLevel(heights, stones, bridge, arrival, inside, heading);
	reserveGameplay(clear, level, stones);

	// Vegetation.
	const trails = level.trails.map((t) => t.points as XZ[]);
	const lane: [XZ, XZ, number] = [
		[stones.pad.x, stones.pad.z],
		[stones.tops[stones.tops.length - 1].x, stones.tops[stones.tops.length - 1].z],
		STONES.radius + STONES.zigzag + 1.5
	];
	const awayFromPaths = (x: number, z: number, r: number) =>
		trails.every((t) => polylineDistance(t, x, z) >= TRAIL_CLEARANCE + r) &&
		polylineDistance([lane[0], lane[1]], x, z) >= lane[2] + r;
	const trees = plantTrees(zones, flags, clear, slope, trails, awayFromPaths);
	const rocks = placeRocks(zones, flags, clear, slope, awayFromPaths);
	const decorations = coverGround(flags, clear, slope, trails, lane);
	if (level.content)
		level.content.trailMarks = placeTrailMarks(
			level.trails,
			trees,
			(x, z) => heightAt(heights, x, z),
			TRAIL_MARKS
		);
	const treeSet = pack(TREE_SPECIES, trees, heights);
	const rockSet = pack(ROCK_KINDS, rocks, heights);
	const decoSet = pack(DECORATION_KINDS, decorations, heights);
	const blocks = collisionBlocks(heights, treeSet, rockSet, [bridge]);
	addStoneCylinders(blocks, stones.tops);

	for (const p of reachTargets(level)) if (steps[cellOf(p.x, p.z)] < 0) problems.push(`${p.id} unreachable`);

	const stations = stationsIn(SPEC.x0, SPEC.z0, SPEC.x1, SPEC.z1);
	const animals = animalsOf(heights);
	const world: SurvivalWorld = {
		generatorVersion: ZONE_VERSION,
		seed: PARK_SEED,
		attempt: 1,
		worldSeed: PARK_SEED,
		problems:
			band.unresolved > 0 ? [...problems, `${band.unresolved} band vertices over the slope limit`] : problems,
		size: width,
		grid: N,
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
		crossings: [bridge],
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
		counts: countAll(treeSet.kind, rockSet.kind, decoSet.kind, treeSet.block, level, animals.length, {
			trailMark: level.content?.trailMarks.length ?? 0,
			bridge: level.content?.mechanics.bridges.length ?? 0
		}),
		checksum: 0
	};
	world.checksum = checksumOf(world);
	level.checksum = checksumOf(level);
	return {
		id: 'vale',
		spec: SPEC,
		offsetX: OX,
		offsetZ: OZ,
		width,
		depth,
		world,
		level,
		band: { unresolved: band.unresolved, updates: band.updates, where: band.where }
	};
}

// --- Helpers (zone-local coordinates) ------------------------------------------------------

function groundUnder(heights: Float32Array, top: ObbyTop): number {
	let low = Number.POSITIVE_INFINITY;
	forCells(top.x, top.z, top.radius + 1, (q, i, j) => {
		if (distance(i, j, top.x, top.z) <= top.radius + 0.5) low = Math.min(low, heights[q]);
	});
	return low === Number.POSITIVE_INFINITY ? heightAt(heights, top.x, top.z) : low;
}

/** The deck from bank to bank (build.ts makeBridge), its ends on the abutments. */
function makeBridge(
	heights: Float32Array,
	flags: Uint8Array,
	walkH: Float32Array,
	clear: Uint8Array,
	water: number
): Crossing {
	const fx = BRIDGE.from[0] - OX;
	const fz = BRIDGE.from[1] - OZ;
	const tx = BRIDGE.to[0] - OX;
	const tz = BRIDGE.to[1] - OZ;
	const from = { x: fx, y: heightAt(heights, fx, fz), z: fz };
	const to = { x: tx, y: heightAt(heights, tx, tz), z: tz };
	const half = BRIDGE.width / 2;
	const sx = tx - fx;
	const sz = tz - fz;
	const span = Math.sqrt(sx * sx + sz * sz);
	forCells((fx + tx) / 2, (fz + tz) / 2, span / 2 + 3, (q, i, j) => {
		const t = ((i - fx) * sx + (j - fz) * sz) / (span * span);
		const off = Math.abs((i - fx) * sz - (j - fz) * sx) / span;
		if (t < 0 || t > 1 || off > half + 1) return;
		clear[q] |= RESERVED;
		if (off > half) return;
		walkH[q] = from.y + (to.y - from.y) * t;
		flags[q] |= FLAG.walkable | FLAG.crossing;
	});
	return { kind: 'rope-bridge', from, to, halfWidth: half, water, stones: [] };
}

/** The stones as upright cylinders (stride 5) from the ground under them to their tops. */
function addStoneCylinders(blocks: ReturnType<typeof collisionBlocks>, tops: ObbyTop[]) {
	const extra: number[][] = blocks.map(() => []);
	for (const top of tops) {
		const b = Math.min(3, floor(top.z / 40)) * 4 + Math.min(3, floor(top.x / 40));
		extra[b].push(top.x, top.bottom, top.z, top.radius, top.y - top.bottom);
	}
	for (const block of blocks)
		if (extra[block.index].length > 0)
			block.cylinders = Float32Array.from([...block.cylinders, ...extra[block.index]]);
}

// --- Story data ------------------------------------------------------------------------

function valeLevel(
	heights: Float32Array,
	stones: Stones,
	bridge: Crossing,
	arrival: NonNullable<ZoneLevel['arrival']>,
	inside: Point & { yaw: number },
	heading: [number, number]
): ZoneLevel {
	const local = ([x, z]: XZ): XZ => [x - OX, z - OZ];
	const at = (p: XZ, lift = 0): Point => {
		const [x, z] = local(p);
		return { x, y: heightAt(heights, x, z) + lift, z };
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
		height = 0,
		silhouette = false
	): ZoneLandmark => ({ id, kind, label, silhouette, height, ...plain(p), yawC, yawS });

	// Places.
	const lookout = at(LOOKOUT.at);
	const fallFoot = { x: FALL.foot[0] - OX, y: FALL.bottom, z: FALL.foot[1] - OZ };
	// As the Reserva's waterfall: at its lip, its top, the drop as its height.
	const fallTop = { x: FALL.lip[0] - OX, y: FALL.top, z: FALL.lip[1] - OZ };
	const springAt = { x: SPRING.centre[0] - OX, y: SPRING.water, z: SPRING.centre[1] - OZ };
	const north = at(TARGETS.ponteNorte);
	const [ttx, ttz] = local(CAMERA_TRUNK.at);
	const trunk = { x: ttx, y: heightAt(heights, ttx, ttz), z: ttz };
	const [hmx, hmz] = local(HOMES.muriquis.at);
	const [ux, uz] = direction(ttx, ttz, hmx, hmz);
	const trunkRadius = JEQUITIBA_TRUNK * CAMERA_TRUNK.scale;
	const mount = {
		x: ttx + ux * (trunkRadius + 0.08),
		y: trunk.y + CAMERA_TRUNK.mountY,
		z: ttz + uz * (trunkRadius + 0.08)
	};
	// The player stands in front of the mount, on the trunk's side the trap looks out of.
	const trapFeet = at([
		CAMERA_TRUNK.at[0] + ux * (trunkRadius + 1.2),
		CAMERA_TRUNK.at[1] + uz * (trunkRadius + 1.2)
	]);

	// Planting (V5): seedlings round the spring.
	const planting: PlantingSpot[] = PLANTING.directions.map(([dx, dz], k) => {
		const d = Math.sqrt(dx * dx + dz * dz);
		return {
			id: `nascente-${k + 1}`,
			mission: 5,
			cell: -1,
			...at([SPRING.centre[0] + (PLANTING.radius * dx) / d, SPRING.centre[1] + (PLANTING.radius * dz) / d])
		};
	});

	const spawn = {
		x: inside.x,
		y: inside.y,
		z: inside.z,
		yawC: heading[0],
		yawS: heading[1],
		yaw: inside.yaw
	};
	const start: StoryCheckpoint = {
		id: 'portal',
		mission: 0,
		min: { x: inside.x - 2, y: inside.y - 0.5, z: inside.z - 2 },
		max: { x: inside.x + 2, y: inside.y + 3, z: inside.z + 2 },
		spawn: plain(inside),
		yaw: inside.yaw
	};
	const checkpoints = [
		checkpoint('poco', at(CHECKPOINTS.poco), 'northEast', 1),
		checkpoint('ponte-norte', at(CHECKPOINTS.ponteNorte), 'north', 3),
		checkpoint('nascente', at(CHECKPOINTS.nascente), 'northEast', 5)
	];

	const trash: Collectible[] = TRASH.map(([p, variant], k) => ({
		id: `lixo-${k + 1}`,
		kind: 'trash' as const,
		variant,
		mission: 2,
		radius: 1.2,
		on: '',
		...at(p)
	}));

	const triggers: ZoneTrigger[] = [
		trigger('mirante-poco', 'lookout', lookout, 3, 1),
		trigger('ponte-norte', 'bridge', north, 2.5, 3),
		trigger('armadilha-foto', 'camera-trap', trapFeet, 2, 4),
		...planting.map((p) => trigger(p.id, 'planting', p, 1.2, 5)),
		trigger('nascente', 'mission', at(TARGETS.nascente), 3, 5)
	];

	const targets = [lookout, at(TARGETS.poco), north, trapFeet, at(TARGETS.nascente)].map(plain);
	const missions: ZoneMission[] = [
		{
			id: 1,
			key: 'som-da-agua',
			name: VALE_MISSION_NAMES[0],
			requires: [],
			target: targets[0],
			count: 1,
			dialogue: ['VALE_INTRO_1', 'VALE_INTRO_2', 'VALE_INTRO_3', 'VALE_V1_DONE', 'FACT_SOM_DA_AGUA'],
			triggers: ['mirante-poco']
		},
		{
			id: 2,
			key: 'poco-limpo',
			name: VALE_MISSION_NAMES[1],
			requires: [1],
			target: targets[1],
			count: trash.length,
			dialogue: ['VALE_V2_INTRO', 'VALE_V2_DONE', 'FACT_LEVE_SEU_LIXO', 'FACT_CASCA_DE_FRUTA'],
			triggers: trash.map((c) => c.id)
		},
		{
			id: 3,
			key: 'ponte-pensil',
			name: VALE_MISSION_NAMES[2],
			requires: [1],
			target: targets[2],
			count: 1,
			dialogue: ['VALE_V3_INTRO', 'VALE_V3_DONE', 'FACT_PONTE_PENSIL'],
			triggers: ['ponte-norte']
		},
		{
			id: 4,
			key: 'censo-muriquis',
			name: VALE_MISSION_NAMES[3],
			requires: [1],
			target: targets[3],
			count: 1,
			dialogue: [
				'VALE_V4_INTRO',
				'VALE_V4_PLACED',
				'VALE_V4_DONE',
				'FACT_MURIQUI',
				'FACT_ARMADILHA_FOTOGRAFICA'
			],
			triggers: ['armadilha-foto']
		},
		{
			id: 5,
			key: 'nascente',
			name: VALE_MISSION_NAMES[4],
			requires: [1],
			target: targets[4],
			count: planting.length,
			dialogue: [
				'VALE_V5_INTRO',
				'VALE_V5_STONES',
				'VALE_V5_SPRING',
				'VALE_V5_DONE',
				'FACT_APP_NASCENTE',
				'FACT_MATA_CILIAR'
			],
			triggers: planting.map((p) => p.id)
		}
	];

	const leafStone = stones.tops[STONES.goldLeafStone - 1];
	const collectibles: Collectible[] = [
		...trash,
		{
			id: 'folha-pedra',
			kind: 'gold-leaf',
			variant: '',
			mission: 5,
			radius: 1.2,
			on: `pedra-${STONES.goldLeafStone}`,
			x: leafStone.x,
			y: leafStone.y,
			z: leafStone.z
		},
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

	const toward = (p: Point, q: Point) => headingTo(p.x, p.z, q.x, q.z);
	const bridgeMid = {
		x: (bridge.from.x + bridge.to.x) / 2,
		y: (bridge.from.y + bridge.to.y) / 2,
		z: (bridge.from.z + bridge.to.z) / 2
	};
	const sign = at(ZONE_SIGN.at);
	const landmarks: ZoneLandmark[] = [
		landmark(
			'cachoeira-grande',
			'waterfall',
			fallTop,
			HEADING.west,
			VALE_TEXT.LABEL_CACHOEIRA.text,
			FALL.top - FALL.bottom,
			true
		),
		landmark('ponte-pensil', 'bridge', bridgeMid, toward(bridge.from, bridge.to), VALE_TEXT.LABEL_PONTE.text),
		landmark('mirante-poco', 'lookout', lookout, toward(lookout, fallFoot), VALE_TEXT.LABEL_MIRANTE.text),
		landmark('nascente', 'spring', springAt, HEADING.south, VALE_TEXT.LABEL_NASCENTE.text),
		landmark('tronco-marcado', 'camera-trunk', trunk, [uz, ux], VALE_TEXT.LABEL_TRONCO.text),
		landmark('placa-vale', 'zone-sign', sign, HEADING.west, VALE_TEXT.LABEL_VALE.text, ZONE_SIGN.height)
	];

	const trails: Trail[] = Object.entries(TRAILS).map(([id, points]) => ({
		id,
		halfWidth: TRAIL_HALF_WIDTH,
		points: points.map((p) => local(p) as [number, number])
	}));

	const obby: Obby = {
		id: 'stones',
		mission: 5,
		takeoff: stones.takeoff,
		landing: stones.landing,
		dirX: stones.dirX,
		dirZ: stones.dirZ,
		pieces: stones.tops,
		gaps: stones.gaps
	};

	// The plunge pool as the runtime's pool ellipse: along its axis, from the fall's foot to the far rim.
	const [ex, ez] = POOL.a;
	const wx = POOL.b[0] + (POOL_DX / POOL_LEN) * POOL.rimTo;
	const wz = POOL.b[1] + (POOL_DZ / POOL_LEN) * POOL.rimTo;
	const pool: Pool = {
		x: (ex + wx) / 2 - OX,
		z: (ez + wz) / 2 - OZ,
		water: POOL.water,
		axisX: POOL_DX / POOL_LEN,
		axisZ: POOL_DZ / POOL_LEN,
		halfLength: distance(ex, ez, wx, wz) / 2,
		halfWidth: POOL.rimTo
	};

	const cameraTrap: CameraTrapSpot = {
		id: 'armadilha-muriquis',
		species: 'muriqui',
		ownerMission: 'censo-muriquis',
		mission: 4,
		trunk,
		trunkRadius,
		mount,
		yawC: uz,
		yawS: ux,
		subject: at(HOMES.muriquis.at)
	};
	const [lcx, lcz] = local(LOOKOUT.camera);
	const [tgx, tgy, tgz] = LOOKOUT.target;
	const content: ZoneContent = {
		// Filled after the planting: marks go on trunks by the trails.
		trailMarks: [],
		mechanics: {
			bridges: [
				{
					id: 'ponte-pensil',
					start: plain(bridge.from),
					end: plain(bridge.to),
					width: BRIDGE.width,
					planks: BRIDGE.planks
				}
			],
			boardwalks: [],
			lookouts: [
				{
					id: 'mirante-poco',
					position: plain(lookout),
					camera: { x: lcx, y: lookout.y + LOOKOUT.cameraLift, z: lcz },
					target: { x: tgx - OX, y: tgy, z: tgz - OZ }
				}
			],
			cameraTraps: [cameraTrap]
		},
		homes: homesOf(heights),
		basins: BASINS.map((b) => ({ ...b, a: local(b.a), b: local(b.b) })),
		text: VALE_TEXT
	};

	return {
		version: ZONE_VERSION,
		spawn,
		start,
		checkpoints,
		killY: -6,
		missions,
		obbies: [obby],
		collectibles,
		triggers,
		landmarks,
		trails,
		planting,
		pool,
		mirante: plain(lookout),
		handholds: [],
		arrival,
		content,
		checksum: 0
	};
}

function homesOf(heights: Float32Array): ZoneHome[] {
	const at = ([x, z]: XZ): Point => ({ x: x - OX, y: heightAt(heights, x - OX, z - OZ), z: z - OZ });
	const home = (
		id: string,
		species: string,
		place: { at: XZ; group: number; radius: number },
		rarity: ZoneHome['rarity'],
		time: ZoneHome['time'],
		fact: string,
		tree = false
	): ZoneHome => ({
		id,
		species,
		...at(place.at),
		group: place.group,
		radius: place.radius,
		rarity,
		time,
		tree: tree ? at(place.at) : null,
		fact
	});
	return [
		home('muriquis', 'muriqui', HOMES.muriquis, 'rare', 'day', 'FACT_MURIQUI'),
		// Bugios howl when groups meet, at any hour (no dawn chorus for Alouatta guariba).
		home('bugios', 'bugio', HOMES.bugios, 'rare', 'day', 'FACT_BUGIO'),
		home('preguica', 'preguica', HOMES.preguica, 'uncommon', 'day', 'FACT_PREGUICA', true),
		home('jacutinga', 'jacutinga', HOMES.jacutinga, 'legendary', 'dawn', 'FACT_JACUTINGA')
	];
}

/** The album species among the homes, in survival's AnimalHome shape (the jacutinga is not in the album yet). */
function animalsOf(heights: Float32Array): AnimalHome[] {
	const places: Record<string, { at: XZ; radius: number }> = {
		muriqui: HOMES.muriquis,
		bugio: HOMES.bugios,
		preguica: HOMES.preguica
	};
	return ALBUM.filter((entry) => entry.species in places).map((entry, id) => {
		const { at, radius } = places[entry.species];
		const x = at[0] - OX;
		const z = at[1] - OZ;
		return { id, species: entry.species, zone: entry.zone, radius, x, y: heightAt(heights, x, z), z };
	});
}

/** Everything the story needs to reach, with the obby it stands on ('' for ground). */
export function reachTargets(level: ZoneLevel): { id: string; x: number; z: number; onObby: string }[] {
	return [
		...level.missions.map((m) => ({ id: `missao-${m.id}`, x: m.target.x, z: m.target.z, onObby: '' })),
		...[level.start, ...level.checkpoints].map((c) => ({
			id: `checkpoint ${c.id}`,
			x: c.spawn.x,
			z: c.spawn.z,
			onObby: ''
		})),
		...level.collectibles.map((c) => ({ id: c.id, x: c.x, z: c.z, onObby: c.on === '' ? '' : 'stones' })),
		...level.planting.map((p) => ({ id: p.id, x: p.x, z: p.z, onObby: '' })),
		...level.triggers.map((t) => ({ id: `gatilho ${t.id}`, x: t.x, z: t.z, onObby: '' }))
	].filter((p) => p.onObby === '');
}

/** Ground kept free of trees, rocks and ground cover: every place the story uses. */
function reserveGameplay(clear: Uint8Array, level: ZoneLevel, stones: Stones) {
	for (const m of level.missions) paint(clear, m.target.x, m.target.z, 2.5, RESERVED);
	for (const c of [level.start, ...level.checkpoints]) paint(clear, c.spawn.x, c.spawn.z, 2.5, RESERVED);
	for (const c of level.collectibles) if (c.on === '') paint(clear, c.x, c.z, 1.5, RESERVED);
	for (const p of level.planting) paint(clear, p.x, p.z, 1.5, RESERVED);
	for (const t of level.triggers) paint(clear, t.x, t.z, Math.min(t.radius, 2.5), RESERVED);
	for (const l of level.landmarks) if (l.kind !== 'waterfall') paint(clear, l.x, l.z, 2.5, RESERVED);
	for (const p of [stones.pad, stones.takeoff]) paint(clear, p.x, p.z, 3, RESERVED);
	paint(clear, stones.landing.x, stones.landing.z, 3, RESERVED);
	// The way in from the portal.
	for (let x = 0; x <= 12; x += 2) paint(clear, x, 70 - OZ, 6, RESERVED);
}

// --- Vegetation ------------------------------------------------------------------------

/** Within RIPARIAN of the river's water, below the fall. */
const riparian = (x: number, z: number) => x + OX < faceX(z + OZ) && riverInside(x + OX, z + OZ) > -RIPARIAN;
const upperValley = (x: number, z: number) => x + OX >= faceX(z + OZ);

function plantTrees(
	zones: Uint8Array,
	flags: Uint8Array,
	clear: Uint8Array,
	slope: Float32Array,
	trails: XZ[][],
	awayFromPaths: (x: number, z: number, r: number) => boolean
): Item[] {
	const rng = new Rng(subSeed(SEED, 1));
	const trees: Item[] = [];
	const species = (name: TreeSpecies) => TREE_SPECIES.indexOf(name);
	for (const [name, [wx, wz], scale] of SPECIAL_TREES) {
		const [yawC, yawS] = rng.heading();
		const x = wx - OX;
		const z = wz - OZ;
		trees.push({ kind: species(name as TreeSpecies), x, z, scale, yawC, yawS });
		paint(clear, x, z, 2.5, OCCUPIED);
	}
	const grow = (x: number, z: number, density: number) => {
		const q = cellOf(x, z);
		const f = flags[q];
		if (clear[q] !== 0 || slope[q] > GROW_SLOPE || zones[q] !== ZONE.slope) return;
		if (f & (FLAG.river | FLAG.crossing | FLAG.cleared) || !(f & FLAG.walkable)) return;
		if (!awayFromPaths(x, z, MAX_TRUNK)) return;
		if (rng.next() >= density) return;
		const mix = upperValley(x, z) ? TREE_MIX.upper : riparian(x, z) ? TREE_MIX.riparian : TREE_MIX.lower;
		const kind = rng.weighted(mix);
		const scale = rng.range(0.8, 1.3);
		const [yawC, yawS] = rng.heading();
		trees.push({ kind, x, z, scale, yawC, yawS });
		paint(clear, x, z, 1.2, OCCUPIED);
	};
	// The forest right up to the trails first, then everywhere.
	lineTrails(trails, TRAIL_TREES, rng, grow);
	const points = poissonDisk(rng, 1, 1, N - 2, N - 2, TREE_SPACING);
	for (let k = 0; k < points.length; k += 2) grow(points[k], points[k + 1], 1);
	const edge = poissonDisk(rng, 1, 1, N - 2, N - 2, EDGE_TREE_SPACING);
	for (let k = 0; k < edge.length; k += 2) {
		const x = edge[k];
		const z = edge[k + 1];
		const toEdge = Math.min(x, z, N - 1 - x, N - 1 - z);
		// Not across the way in from the portal (west, z 70) nor the climb to the Copa (north, x 222).
		const portal = x < EDGE_BAND + 2 && Math.abs(z + OZ - ENTRY_Z) < 10;
		const copa = z < EDGE_BAND + 2 && x + OX > COPA_CROSSING[0] - 6 && x + OX < COPA_CROSSING[1] + 6;
		if (toEdge < EDGE_BAND && !portal && !copa) grow(x, z, 1);
	}
	return trees;
}

function placeRocks(
	zones: Uint8Array,
	flags: Uint8Array,
	clear: Uint8Array,
	slope: Float32Array,
	awayFromPaths: (x: number, z: number, r: number) => boolean
): Item[] {
	const rng = new Rng(subSeed(SEED, 2));
	const rocks: Item[] = [];
	const points = poissonDisk(rng, 1, 1, N - 2, N - 2, ROCK_SPACING);
	for (let k = 0; k < points.length; k += 2) {
		const x = points[k];
		const z = points[k + 1];
		const q = cellOf(x, z);
		if (clear[q] !== 0 || slope[q] > GROW_SLOPE || flags[q] & (FLAG.river | FLAG.crossing)) continue;
		if (!(flags[q] & FLAG.walkable)) continue;
		const nearWater = riverInside(x + OX, z + OZ) > -6;
		const weight = nearWater ? 0.6 : zones[q] === ZONE.slope ? 0.3 : 0.15;
		if (rng.next() >= weight) continue;
		const kind = rng.weighted(nearWater ? [0.55, 0.45, 0] : [0.35, 0.4, 0.25]);
		const scale = kind === 0 ? rng.range(0.7, 1.6) : kind === 1 ? rng.range(0.5, 1) : rng.range(0.8, 1.3);
		const reach = kind === 0 ? 0.8 * scale : kind === 2 ? 1.25 * scale : 0.6 * scale;
		if (!awayFromPaths(x, z, reach)) continue;
		const [yawC, yawS] = rng.heading();
		rocks.push({ kind, x, z, scale, yawC, yawS });
		paint(clear, x, z, 1.5, OCCUPIED);
	}
	return rocks;
}

function coverGround(
	flags: Uint8Array,
	clear: Uint8Array,
	slope: Float32Array,
	trails: XZ[][],
	lane: [XZ, XZ, number]
): Item[] {
	const rng = new Rng(subSeed(SEED, 3));
	const out: Item[] = [];
	const points = poissonDisk(rng, 1, 1, N - 2, N - 2, DECORATION_SPACING);
	for (let k = 0; k < points.length; k += 2) {
		const x = points[k];
		const z = points[k + 1];
		const q = cellOf(x, z);
		const f = flags[q];
		if (clear[q] & RESERVED || slope[q] > GROW_SLOPE || f & (FLAG.river | FLAG.crossing)) continue;
		if (!(f & FLAG.walkable)) continue;
		if (trails.some((t) => polylineDistance(t, x, z) < TRAIL_HALF_WIDTH + 0.4)) continue;
		if (polylineDistance([lane[0], lane[1]], x, z) < lane[2]) continue;
		const mix = f & FLAG.cleared ? DECO_MIX.clearing : riparian(x, z) ? DECO_MIX.riparian : DECO_MIX.forest;
		const kind = rng.weighted(mix);
		const scale = rng.range(0.6, 1.3);
		const [yawC, yawS] = rng.heading();
		out.push({ kind, x, z, scale, yawC, yawS });
	}
	return out;
}
