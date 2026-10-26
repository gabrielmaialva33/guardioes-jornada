/**
 * Builds the story map ("Reserva da Iara", game/LEVEL.md) from the control
 * points in layout.ts: a SurvivalWorld for the shared renderer and collision,
 * and the StoryLevel on top. Always the same map: the noise and vegetation
 * streams come from STORY_SEED, and every rule of survival/random.ts holds
 * (exact arithmetic only, determinism.test.ts scans this folder).
 *
 * Order: obby geometry from the jump numbers (the stones stretch the pool,
 * the ledges aim at the rim), relief, river and pool, plateau cliffs, pads,
 * flags, the bridge, reachability with the obbies as jump links, then
 * vegetation around everything the child must reach, and the story data.
 */
import { jumpReach } from '../engine/graybox.ts';
import { checksumOf } from '../survival/checksum.ts';
import { collisionBlocks, type Item, pack, paint, walkSteps } from '../survival/generate.ts';
import { clamp, fbm, floor, smoothstep } from '../survival/noise.ts';
import { poissonDisk } from '../survival/poisson.ts';
import { Rng, subSeed } from '../survival/random.ts';
import { heightAt } from '../survival/terrain.ts';
import {
	ALBUM,
	type AnimalHome,
	type BaseCamp,
	type Corridor,
	type Crossing,
	DECORATION_KINDS,
	FLAG,
	GRID,
	PLANT_GRID,
	PLANT_STEP,
	type PlantingCell,
	type Poi,
	type Point,
	RESOURCE_KINDS,
	RESPONDER,
	type RiverPoint,
	ROCK_KINDS,
	THREAT_KINDS,
	type ThreatSlot,
	TREE_SPECIES,
	type TreeSpecies,
	WORLD_SIZE,
	ZONE,
	ZONES
} from '../survival/types.ts';
import {
	arcLengths,
	direction,
	distance,
	headingTo,
	insidePolygon,
	polylineDistance,
	polylineNearest
} from './geometry.ts';
import {
	ACT1_TEXT,
	ANIMALS,
	BASE,
	BIRD_PERCHES,
	BRIDGE_HALF_WIDTH,
	BUTTERFLIES,
	CANOPY,
	CHECKPOINT_FACING,
	CHECKPOINT_SIZE,
	CHECKPOINTS,
	CLAREIRA,
	COLLECT_RADIUS,
	CORRIDOR_FRAGMENTS,
	CORRIDOR_LINE,
	CUTTING_TREE,
	DECORATION_SPACING,
	EDGE_BAND,
	EDGE_PORTALS,
	FACING,
	type Facing,
	FENCE_MARGIN,
	FOREST,
	FRUITS,
	GORGE,
	GROTTO,
	KILL_Y,
	LANE_CLEARANCE,
	LEDGES,
	LOGGER_RADIUS,
	MIRANTE_DECK,
	MIRANTE_RADIUS,
	MIRANTE_TOP,
	MURIQUI_HANDHOLDS,
	MURIQUI_ROW,
	NPCS,
	OBSERVATION_ROCK,
	ONCA_RADIUS,
	PASTURE,
	PLACES,
	PLANTING_RADIUS,
	PLATEAU,
	POOL,
	PORTAL,
	RELIEF,
	RIVER,
	RIVER_BANK_SLOPE,
	RIVER_DEPTH,
	RIVER_HALF_WIDTH,
	RIVER_SURFACE,
	RIVER_TOP_INDEX,
	ROCK_SPACING,
	SEED_SPOTS,
	SERRA,
	SPAWN,
	STONES,
	STORY_SEED,
	STORY_VERSION,
	TRAIL_CLEARANCE,
	TRAIL_HALF_WIDTH,
	TRAIL_MARKS,
	TRAILS,
	TRAP_RADIUS,
	TRAPS,
	TRASH,
	TRASH_KINDS,
	TREE_SPACING_EDGE,
	TREE_SPACING_FOREST,
	TREE_SPACING_OPEN,
	TREEHOUSE,
	WATERFALL,
	type XZ,
	ZIPLINE,
	ZIPLINE_BASE
} from './layout.ts';
import { cellOf, type JumpLink, stepsWithLinks } from './reach.ts';
import type {
	Act1,
	Collectible,
	Deck,
	Landmark,
	Mission,
	Obby,
	ObbyGap,
	ObbyTop,
	PlantingSpot,
	Pool,
	Portal,
	Rail,
	StoryBuild,
	StoryCheckpoint,
	StoryLevel,
	StoryWorld,
	Trail,
	TrailMark,
	TriggerZone
} from './types.ts';

const N = GRID;
const CELLS = N * N;
/** Bits of the scratch `clear` mask, as in generate.ts: ground kept for gameplay, ground taken by a trunk or rock. */
const RESERVED = 1;
const OCCUPIED = 2;
/** Largest trunk collider (jequitibá 0.45 × scale 1.3), for the trail clearance of trees. */
const MAX_TRUNK_RADIUS = 0.6;
/** Steepest ground anything grows on (generate.ts). */
const GROW_SLOPE = 1.3;
const SQRT_HALF = Math.sqrt(0.5);
/** Unit headings (yawC, yawS) of the compass facings, matching FACING's angles. */
const HEADING: Record<Facing, [number, number]> = {
	north: [-1, 0],
	northEast: [-SQRT_HALF, SQRT_HALF],
	east: [0, 1],
	southEast: [SQRT_HALF, SQRT_HALF],
	south: [1, 0],
	southWest: [SQRT_HALF, -SQRT_HALF],
	west: [0, -1],
	northWest: [-SQRT_HALF, -SQRT_HALF]
};

/** Relative species weights by area (no ipê-amarelo: the base's is the only yellow canopy). */
const weightsOf = (mix: Partial<Record<TreeSpecies, number>>) => TREE_SPECIES.map((s) => mix[s] ?? 0);
const TREE_MIX = {
	restinga: weightsOf({ jeriva: 3, embauba: 1 }),
	lowland: weightsOf({ jequitiba: 2, 'pau-brasil': 2, 'ipe-rosa': 1, jucara: 3, embauba: 1 }),
	slope: weightsOf({ jucara: 3, xaxim: 2, jequitiba: 1, embauba: 1, araucaria: 1 }),
	highland: weightsOf({ araucaria: 3, xaxim: 1 }),
	open: weightsOf({ embauba: 2, jeriva: 1, 'pau-brasil': 1 })
};
/** Share of open-ground Poisson points that grow a tree, and of plateau points. */
const OPEN_DENSITY = 0.55;
const HIGHLAND_DENSITY = 0.35;
/** Ground cover weights over DECORATION_KINDS (grass, flower, bush, fern, bromelia, beach-grass). */
const DECO_MIX = {
	restinga: [1, 0, 2, 0, 2, 2],
	forest: [0, 1, 2, 2, 1, 0],
	slope: [0, 0, 1, 3, 2, 0],
	highland: [3, 2, 0, 0, 0, 0],
	open: [3, 1, 1, 0, 0, 0]
};

interface River {
	points: RiverPoint[];
	/** Surface height at an arc length from the head. */
	waterAt: (arc: number) => number;
}

interface Stones {
	takeoffA: Point;
	takeoffB: Point;
	padA: Point;
	padB: Point;
	tops: ObbyTop[];
	gaps: ObbyGap[];
	/** Forward length of the run, take-off to take-off. */
	length: number;
	pool: Pool;
}

/** The grotto's three stones across the plunge pool, from its west bank to the niche. */
interface GrottoRun {
	takeoff: Point;
	pad: Point;
	landing: Point;
	tops: ObbyTop[];
	gaps: ObbyGap[];
	length: number;
	pool: Pool;
}

/** The canopy branches, from the take-off on the ground to the leaf's platform. */
interface Branches {
	takeoff: Point;
	dirX: number;
	dirZ: number;
	tops: ObbyTop[];
	gaps: ObbyGap[];
	tree: Point;
}

interface Ledges {
	takeoff: Point;
	pad: Point;
	landing: Point;
	dirX: number;
	dirZ: number;
	tops: ObbyTop[];
	gaps: ObbyGap[];
	length: number;
}

/** The story map: the world in survival's shape and the story level. */
export function buildStoryWorld(): StoryBuild {
	const problems: string[] = [];
	const river = riverModel();
	const stones = planStones(river);
	const ledges = planLedges();
	const grotto = planGrotto(river);

	// Relief, water, plateau, the gorge and the grotto's niche, then the flat pads.
	const heights = new Float32Array(CELLS);
	const edge = new Float32Array(CELLS);
	const waterY = new Float32Array(CELLS);
	shapeRelief(heights);
	carveWater(heights, edge, waterY, river, [stones.pool, grotto.pool]);
	raiseMassifs(heights);
	openPortal(heights);
	carveGorge(heights, edge, waterY);
	cutNiche(heights, edge);
	for (const top of ledges.tops.slice(0, -1)) notch(heights, top);
	const dry = (q: number) => edge[q] >= 0;
	flattenDisk(
		heights,
		stones.padA.x,
		stones.padA.z,
		stones.padA.y,
		STONES.padRadius,
		STONES.padRadius + 2,
		dry
	);
	flattenDisk(
		heights,
		stones.padB.x,
		stones.padB.z,
		stones.padB.y,
		STONES.padRadius,
		STONES.padRadius + 2,
		dry
	);
	flattenDisk(heights, ledges.pad.x, ledges.pad.z, LEDGES.takeoffY, LEDGES.padRadius, LEDGES.padRadius + 2.5);
	flattenDisk(heights, grotto.pad.x, grotto.pad.z, grotto.pad.y, GROTTO.padRadius, GROTTO.padRadius + 2, dry);
	const [bcx, bcz] = BASE.centre;
	const baseY = heightAt(heights, bcx, bcz);
	flattenDisk(heights, bcx, bcz, baseY, BASE.radius, BASE.blend);
	for (const top of ledges.tops) top.bottom = groundUnder(heights, top) - 0.3;
	for (const top of stones.tops) top.bottom = stones.pool.water - RIVER_DEPTH;
	ledges.landing.y = heightAt(heights, ledges.landing.x, ledges.landing.z);
	const branches = planBranches(heights);

	// Zones and flags.
	const slope = slopeOf(heights);
	const zones = new Uint8Array(CELLS);
	const flags = new Uint8Array(CELLS);
	const clear = new Uint8Array(CELLS);
	for (let q = 0; q < CELLS; q++) {
		const i = q % N;
		const j = (q - i) / N;
		const isRiver = edge[q] < 0 && heights[q] < waterY[q];
		const onPlateau = insidePolygon(PLATEAU, i, j) || inCauseway(i, j);
		const onSerra = insidePolygon(SERRA, i, j);
		zones[q] = isRiver
			? ZONE.river
			: onPlateau
				? ZONE.highland
				: i < RELIEF.restingaX
					? ZONE.restinga
					: onSerra || i >= RELIEF.encostaFromX || slope[q] > GROW_SLOPE
						? ZONE.slope
						: ZONE.lowland;
		let f = 0;
		// A cliff standing in the water (the river head, the plateau's corner) is not ground either.
		if (isRiver) f |= FLAG.river;
		else if (
			edge[q] >= 0 &&
			((i >= FENCE_MARGIN && j >= FENCE_MARGIN && i < N - FENCE_MARGIN && j < N - FENCE_MARGIN) ||
				inPortalGap(i, j))
		)
			f |= FLAG.walkable;
		if (distance(i, j, bcx, bcz) < BASE.radius) f |= FLAG.base;
		if (insidePolygon(PASTURE, i, j)) f |= FLAG.cleared | FLAG.corridor;
		else if (distance(i, j, CLAREIRA.centre[0], CLAREIRA.centre[1]) < CLAREIRA.radius) f |= FLAG.cleared;
		else if (!isRiver && !onPlateau && FOREST.some((poly) => insidePolygon(poly, i, j))) f |= FLAG.forest;
		flags[q] = f;
	}
	// Ground under a ledge is the ledge's, never walked on.
	for (const top of ledges.tops.slice(0, -1))
		forCells(top.x, top.z, top.radius * 1.5, (q, i, j) => {
			if (insideTop(top, i, j, 0)) flags[q] &= ~FLAG.walkable;
		});

	// The bridge: a deck from bank to bank, at least half a unit over the water.
	const walkH = Float32Array.from(heights);
	const bridge = makeBridge(heights, flags, walkH, clear, river);
	const crossings: Crossing[] = [
		bridge,
		{
			kind: 'stepping-stones',
			from: stones.takeoffA,
			to: stones.takeoffB,
			halfWidth: 0.6,
			water: stones.pool.water,
			stones: stones.tops.map((t) => ({ x: t.x, y: t.y, z: t.z, r: t.radius }))
		}
	];

	// Reachability from the spawn: walking, the bridge, and the obbies as jump links.
	const [sx, sz] = SPAWN.at;
	const spawnCell = cellOf(sx, sz);
	const padA = cellOf(stones.padA.x, stones.padA.z);
	const padB = cellOf(stones.padB.x, stones.padB.z);
	const stoneRun = stones.length + 2 * STONES.padBack;
	const grottoPad = cellOf(grotto.pad.x, grotto.pad.z);
	const grottoLanding = cellOf(grotto.landing.x, grotto.landing.z);
	const grottoRun = grotto.length + GROTTO.padBack;
	const links: JumpLink[] = [
		{ from: padA, to: padB, length: stoneRun },
		{ from: padB, to: padA, length: stoneRun },
		{
			from: cellOf(ledges.pad.x, ledges.pad.z),
			to: cellOf(ledges.landing.x, ledges.landing.z),
			length: ledges.length
		},
		{ from: grottoPad, to: grottoLanding, length: grottoRun },
		{ from: grottoLanding, to: grottoPad, length: grottoRun }
	];
	const steps = stepsWithLinks(flags, walkH, spawnCell, links);
	const walkOnly = walkSteps(flags, walkH, spawnCell);
	for (const obby of [stones, ledges, grotto, branches])
		for (const g of obby.gaps)
			if (g.gap > jumpReach(g.rise)) problems.push(`obby gap ${g.gap.toFixed(2)} beyond reach`);

	// Story places, then the ground they keep free of trees and rocks.
	const level = storyLevel(heights, river, stones, ledges, bridge, grotto, branches);
	reserveGameplay(clear, level, stones, ledges, grotto, branches);

	// Vegetation, kept off the trails, the obby lanes and the zipline's cable.
	const lanes = laneSegments(stones, ledges, grotto, branches);
	const trails = level.trails.map((t) => t.points as XZ[]);
	const cable: [XZ, XZ, number] = [ZIPLINE.start, ZIPLINE.end, ZIPLINE.clearance];
	const awayFromPaths = (x: number, z: number, r: number) =>
		trails.every((t) => polylineDistance(t, x, z) >= TRAIL_CLEARANCE + r) &&
		lanes.every(([a, b, w]) => polylineDistance([a, b], x, z) >= w + r) &&
		polylineDistance([cable[0], cable[1]], x, z) >= cable[2] + r;
	const trees = plantTrees(zones, flags, clear, slope, awayFromPaths, [
		[TREEHOUSE.species, TREEHOUSE.tree, TREEHOUSE.scale],
		[CANOPY.species, [branches.tree.x, branches.tree.z], CANOPY.scale]
	]);
	const rocks = placeRocks(zones, flags, clear, slope, edge, awayFromPaths);
	const decorations = coverGround(zones, flags, clear, slope, trails, lanes, cable);
	if (level.act1) level.act1.marks = trailMarks(heights, level.trails, trees);
	const treeSet = pack(TREE_SPECIES, trees, heights);
	const rockSet = pack(ROCK_KINDS, rocks, heights);
	const decoSet = pack(DECORATION_KINDS, decorations, heights);
	const blocks = collisionBlocks(heights, treeSet, rockSet, crossings);
	addLedgeBoxes(blocks, ledges.tops);

	// Survival-shaped records.
	const base = baseCamp(heights, baseY);
	const corridor = corridorOf(level, flags, steps);
	const pois = poisOf(level, stones, zones, steps);
	const threats = threatsOf(level, heights, flags, zones, steps);
	const animals = animalsOf(heights);
	const counts = countAll(treeSet.kind, rockSet.kind, decoSet.kind, treeSet.block, level, pois, threats);

	for (const p of reachTargets(level))
		if (p.onObby === '' && steps[cellOf(p.x, p.z)] < 0) problems.push(`${p.id} unreachable`);
	if (walkOnly[padB] < 0) problems.push('east bank unreachable without the stones');

	const world: StoryWorld = {
		generatorVersion: STORY_VERSION,
		seed: STORY_SEED,
		attempt: 1,
		worldSeed: STORY_SEED,
		problems,
		size: WORLD_SIZE,
		grid: N,
		waterLevel: RIVER_SURFACE.seaY,
		heights,
		zones,
		flags,
		baseSteps: steps,
		highlandHeight: RELIEF.plateauY - 3,
		river: { points: river.points, halfWidth: RIVER_HALF_WIDTH, depth: RIVER_DEPTH },
		crossings,
		base,
		pois,
		threats,
		corridor,
		animals,
		cameraSpots: [],
		resources: [],
		trees: treeSet,
		rocks: rockSet,
		decorations: decoSet,
		blocks,
		counts,
		checksum: 0
	};
	world.checksum = checksumOf(world);
	level.checksum = checksumOf(level);
	return { world, level };
}

// --- River and obby geometry --------------------------------------------------

function riverModel(): River {
	const arcs = arcLengths(RIVER);
	const top = arcs[RIVER_TOP_INDEX];
	const end = arcs[arcs.length - 1];
	const { topY, seaY } = RIVER_SURFACE;
	const waterAt = (arc: number) => topY + ((seaY - topY) * (arc - top)) / (end - top);
	return { points: RIVER.map(([x, z], k) => ({ x, z, water: waterAt(arcs[k]) })), waterAt };
}

const riverWaterAt = (river: River, x: number, z: number) => river.waterAt(polylineNearest(RIVER, x, z).arc);

/**
 * Obby 1 from its gaps: bank, seven stones zigzagging across the axis, bank.
 * A gap is edge to edge; the forward step is what is left of the centre
 * distance after the sideways zigzag. The two take-offs then sit at the pool's
 * ends, centred on the pool.
 */
function planStones(river: River): Stones {
	const [cx, cz] = POOL.centre;
	const [ax, az] = direction(STONES.from[0], STONES.from[1], STONES.to[0], STONES.to[1]);
	const px = -az;
	const pz = ax;
	const water = riverWaterAt(river, cx, cz);
	const reach = jumpReach(0);
	const count = STONES.topOffsets.length;
	const r = STONES.radius;
	const lateral = (k: number) => (k < 0 || k >= count ? 0 : k % 2 === 0 ? -STONES.zigzag : STONES.zigzag);
	const radius = (k: number) => (k < 0 || k >= count ? 0 : r);
	const top = (k: number) => water + STONES.topAboveWater + (k < 0 || k >= count ? 0 : STONES.topOffsets[k]);
	const forward: number[] = [];
	const gaps: ObbyGap[] = [];
	for (let g = 0; g <= count; g++) {
		const gap = STONES.gapFractions[g] * reach;
		const centre = gap + radius(g - 1) + radius(g);
		const side = lateral(g) - lateral(g - 1);
		forward.push(Math.sqrt(centre * centre - side * side));
		gaps.push({ gap, rise: top(g) - top(g - 1), fraction: STONES.gapFractions[g], reachRise: 0 });
	}
	let length = 0;
	for (const f of forward) length += f;
	const x0 = cx - (ax * length) / 2;
	const z0 = cz - (az * length) / 2;
	const tops: ObbyTop[] = [];
	let along = 0;
	for (let k = 0; k < count; k++) {
		along += forward[k];
		tops.push({
			piece: 'stone',
			x: x0 + ax * along + px * lateral(k),
			y: top(k),
			z: z0 + az * along + pz * lateral(k),
			yawC: az,
			yawS: ax,
			radius: r,
			variant: `${k % 3}`,
			bottom: 0
		});
	}
	const bankY = top(-1);
	const back = STONES.padBack;
	return {
		takeoffA: { x: x0, y: bankY, z: z0 },
		takeoffB: { x: x0 + ax * length, y: bankY, z: z0 + az * length },
		padA: { x: x0 - ax * back, y: bankY, z: z0 - az * back },
		padB: { x: x0 + ax * (length + back), y: bankY, z: z0 + az * (length + back) },
		tops,
		gaps,
		length,
		pool: { x: cx, z: cz, water, axisX: ax, axisZ: az, halfLength: length / 2, halfWidth: POOL.halfWidth }
	};
}

/**
 * Obby 2 from its gaps: the ledges start at LEVEL.md's first ledge and climb
 * in a straight line whose length the gaps fix; the line is aimed at the one
 * point of the plateau's west face at that distance, so the last ledge sits on
 * the rim at the plateau's height. Each ledge faces along the line.
 */
function planLedges(): Ledges {
	const [x1, z1] = LEDGES.first;
	const reach = jumpReach(1.5);
	const half = LEDGES.size / 2;
	const n = LEDGES.tops.length;
	let span = 0;
	for (let k = 1; k < n; k++) span += LEDGES.gapFractions[k] * reach + LEDGES.size;
	// Bisection along the rim edge for the point at distance `span` from the first ledge.
	const [ea, eb] = LEDGES.rimEdge;
	const [rax, raz] = PLATEAU[ea];
	const [rbx, rbz] = PLATEAU[eb];
	let lo = 0;
	let hi = 1;
	for (let it = 0; it < 60; it++) {
		const t = (lo + hi) / 2;
		if (distance(x1, z1, rax + (rbx - rax) * t, raz + (rbz - raz) * t) < span) lo = t;
		else hi = t;
	}
	const rx = rax + (rbx - rax) * lo;
	const rz = raz + (rbz - raz) * lo;
	const [dx, dz] = direction(x1, z1, rx, rz);
	const tops: ObbyTop[] = [];
	const gaps: ObbyGap[] = [];
	let along = 0;
	for (let k = 0; k < n; k++) {
		if (k > 0) along += LEDGES.gapFractions[k] * reach + LEDGES.size;
		tops.push({
			piece: 'ledge',
			x: x1 + dx * along,
			y: LEDGES.tops[k],
			z: z1 + dz * along,
			yawC: dz,
			yawS: dx,
			radius: half,
			variant: LEDGES.materials[k],
			bottom: 0
		});
		const below = k === 0 ? LEDGES.takeoffY : LEDGES.tops[k - 1];
		gaps.push({
			gap: LEDGES.gapFractions[k] * reach,
			rise: LEDGES.tops[k] - below,
			fraction: LEDGES.gapFractions[k],
			reachRise: 1.5
		});
	}
	const first = LEDGES.gapFractions[0] * reach + half;
	const takeoff = { x: x1 - dx * first, y: LEDGES.takeoffY, z: z1 - dz * first };
	// Land 3 u inside the rim, square to the face.
	const [fx, fz] = direction(rax, raz, rbx, rbz);
	const inward = insidePolygon(PLATEAU, rx + fz, rz - fx) ? [fz, -fx] : [-fz, fx];
	return {
		takeoff,
		pad: { x: takeoff.x - dx * LEDGES.padRadius, y: LEDGES.takeoffY, z: takeoff.z - dz * LEDGES.padRadius },
		landing: { x: rx + inward[0] * 3, y: RELIEF.plateauY, z: rz + inward[1] * 3 },
		dirX: dx,
		dirZ: dz,
		tops,
		gaps,
		length: first + along + 3 + LEDGES.padRadius
	};
}

/**
 * The grotto's stones from their gaps: they run due east across the plunge
 * pool to the niche floor's landing, so the take-off sits the gaps' length west
 * of it, at the pool's west end. The pool takes the river head's water (the
 * small waterfall's foot) and reaches from the take-off past the serra's face,
 * so the only dry way into the niche is over the stones.
 */
function planGrotto(river: River): GrottoRun {
	const water = river.waterAt(0);
	const reach = jumpReach(0);
	const r = GROTTO.stoneRadius;
	const top = water + GROTTO.topAboveWater;
	const [lx, lz] = GROTTO.landing;
	const count = GROTTO.gapFractions.length - 1;
	let length = 2 * r * count;
	for (const f of GROTTO.gapFractions) length += f * reach;
	const x0 = lx - length;
	const tops: ObbyTop[] = [];
	const gaps: ObbyGap[] = [];
	let along = 0;
	GROTTO.gapFractions.forEach((f, k) => {
		const rise = k === count ? GROTTO.floorY - top : 0;
		gaps.push({ gap: f * reach, rise, fraction: f, reachRise: 0 });
		if (k === count) return;
		along += f * reach + (k === 0 ? r : 2 * r);
		tops.push({
			piece: 'stone',
			x: x0 + along,
			y: top,
			z: lz,
			yawC: 0,
			yawS: 1,
			radius: r,
			variant: `${k % 3}`,
			bottom: water - RIVER_DEPTH
		});
	});
	const end = GROTTO.niche.x0 - 0.5 + GROTTO.poolBeyond;
	return {
		takeoff: { x: x0, y: top, z: lz },
		pad: { x: x0 - GROTTO.padBack, y: top, z: lz },
		landing: { x: lx, y: GROTTO.floorY, z: lz },
		tops,
		gaps,
		length,
		pool: {
			x: (x0 + end) / 2,
			z: lz,
			water,
			axisX: 1,
			axisZ: 0,
			halfLength: (end - x0) / 2,
			halfWidth: GROTTO.poolHalfWidth
		}
	};
}

/**
 * The canopy branches from their gaps: a straight line aimed from CANOPY.from
 * at the leaf's platform, each branch CANOPY.rise over the last and the first
 * over the take-off's ground, so the leaf sits five rises up in the crown of
 * the tree just past it.
 */
function planBranches(heights: Float32Array): Branches {
	const [lx, lz] = CANOPY.leaf;
	const [dx, dz] = direction(CANOPY.from[0], CANOPY.from[1], lx, lz);
	const reach = jumpReach(0);
	const r = CANOPY.radius;
	let back = r;
	CANOPY.gapFractions.forEach((f, k) => {
		back += f * reach + (k === 0 ? 0 : 2 * r);
	});
	const takeoff = { x: lx - dx * back, y: 0, z: lz - dz * back };
	takeoff.y = heightAt(heights, takeoff.x, takeoff.z);
	const tops: ObbyTop[] = [];
	const gaps: ObbyGap[] = [];
	let along = 0;
	CANOPY.gapFractions.forEach((f, k) => {
		along += f * reach + (k === 0 ? r : 2 * r);
		const x = takeoff.x + dx * along;
		const z = takeoff.z + dz * along;
		tops.push({
			piece: 'branch',
			x,
			y: takeoff.y + CANOPY.rise * (k + 1),
			z,
			yawC: dz,
			yawS: dx,
			radius: r,
			variant: k === CANOPY.gapFractions.length - 1 ? 'crown' : 'branch',
			bottom: heightAt(heights, x, z)
		});
		gaps.push({ gap: f * reach, rise: CANOPY.rise, fraction: f, reachRise: 0 });
	});
	const tx = lx + dx * CANOPY.treeBeyond;
	const tz = lz + dz * CANOPY.treeBeyond;
	return { takeoff, dirX: dx, dirZ: dz, tops, gaps, tree: { x: tx, y: heightAt(heights, tx, tz), z: tz } };
}

// --- Relief ---------------------------------------------------------------------

/** Restinga, baixada, encosta and the east, the serra edge and the rising map edges (LEVEL.md §3). */
function shapeRelief(heights: Float32Array) {
	const seed = subSeed(STORY_SEED, 1);
	const R = RELIEF;
	for (let j = 0; j < N; j++)
		for (let i = 0; i < N; i++) {
			const n = fbm(i * R.noiseScale, j * R.noiseScale, seed, 3);
			const baixada = clamp(
				R.baixadaFrom +
					(R.baixadaTo - R.baixadaFrom) * smoothstep(R.restingaX, R.encostaFromX, i) +
					R.baixadaNoise * n,
				R.baixadaMin,
				R.baixadaMax
			);
			let h = R.restingaY + (baixada - R.restingaY) * smoothstep(R.restingaX - 1, R.restingaX + 4, i);
			const encosta =
				i <= R.encostaToX
					? R.encostaFromY +
						((R.encostaToY - R.encostaFromY) * clamp(i - R.encostaFromX, 0, R.encostaToX - R.encostaFromX)) /
							(R.encostaToX - R.encostaFromX)
					: R.encostaToY + (R.eastY - R.encostaToY) * smoothstep(R.encostaToX, R.serraFromX, i);
			const east = smoothstep(R.encostaFromX - 6, R.encostaFromX + 2, i);
			h += (encosta + 0.3 * n - h) * east;
			const toEdge = Math.min(i, j, WORLD_SIZE - i, WORLD_SIZE - j);
			h += R.edgeRise * smoothstep(R.edgeWidth, 0, toEdge);
			heights[j * N + i] = h;
		}
}

/**
 * River and pool: `edge` is the signed distance to the water's edge (negative
 * in the water), `waterY` the surface there. The ground never rises above a
 * bank climbing at RIVER_BANK_SLOPE from the water's edge, down to the bed at
 * RIVER_DEPTH. A pool's distance is its ellipse's, scaled by its half width.
 */
function carveWater(
	heights: Float32Array,
	edge: Float32Array,
	waterY: Float32Array,
	river: River,
	pools: Pool[]
) {
	for (let q = 0; q < CELLS; q++) {
		const i = q % N;
		const j = (q - i) / N;
		const { d2, arc } = polylineNearest(RIVER, i, j);
		let e = Math.sqrt(d2) - RIVER_HALF_WIDTH;
		let water = river.waterAt(arc);
		for (const pool of pools) {
			const a = (i - pool.x) * pool.axisX + (j - pool.z) * pool.axisZ;
			const b = (j - pool.z) * pool.axisX - (i - pool.x) * pool.axisZ;
			const rho = Math.sqrt(
				(a / pool.halfLength) * (a / pool.halfLength) + (b / pool.halfWidth) * (b / pool.halfWidth)
			);
			const ePool = (rho - 1) * pool.halfWidth;
			if (ePool < e) {
				e = ePool;
				water = pool.water;
			}
		}
		edge[q] = e;
		waterY[q] = water;
		const bank = Math.max(water - RIVER_DEPTH, water + RIVER_BANK_SLOPE * e);
		if (bank < heights[q]) heights[q] = bank;
	}
}

/**
 * The two massifs, the mirante and the serra: a top inside each polygon (flat
 * for the mirante, rising east for the serra) and a cliff one grid step wide
 * around it. A sloped band would not do: where a face runs at an angle to the
 * grid, the column of cells along it climbs a little per step and makes a ramp
 * to the top. Applied after the river, so water never cuts into a cliff.
 */
function raiseMassifs(heights: Float32Array) {
	const R = RELIEF;
	const massifs: [readonly XZ[], (i: number) => number][] = [
		[PLATEAU, () => R.plateauY],
		[SERRA, (i) => R.serraFromY + (R.serraToY - R.serraFromY) * smoothstep(R.serraFromX, WORLD_SIZE - 2, i)]
	];
	for (let q = 0; q < CELLS; q++) {
		const i = q % N;
		const j = (q - i) / N;
		const toEdge = Math.min(i, j, WORLD_SIZE - i, WORLD_SIZE - j);
		// The east portal lowers the plateau's edge lip into its opening.
		const lip = toEdge === WORLD_SIZE - i ? 1 - portalOpening(j) : 1;
		for (const [polygon, top] of massifs)
			if (insidePolygon(polygon, i, j))
				heights[q] = Math.max(heights[q], top(i) + R.edgeRise * smoothstep(R.edgeWidth, 0, toEdge) * lip);
	}
}

/** Cells of the east portal's causeway: from PORTAL.fromX to the map edge, within halfWidth of its z. */
export const inCauseway = (i: number, j: number) =>
	i >= PORTAL.fromX && i <= WORLD_SIZE && Math.abs(j - PORTAL.z) <= PORTAL.halfWidth;

/** 1 within the portal's opening, 0 from lipBlend past its sides: how much of the plateau's edge lip it removes. */
function portalOpening(j: number): number {
	return 1 - smoothstep(PORTAL.halfWidth, PORTAL.halfWidth + PORTAL.lipBlend, Math.abs(j - PORTAL.z));
}

/**
 * The east portal's causeway: the plateau's flat top carried across the edge
 * strip to x = 160. Every other cell keeps its height, so its flanks are the
 * same one-cell cliffs as the plateau's faces and the strip never leads up.
 */
function openPortal(heights: Float32Array) {
	for (let j = 0; j < N; j++)
		for (let i = PORTAL.fromX; i < N; i++) if (inCauseway(i, j)) heights[j * N + i] = RELIEF.plateauY;
}

/** Cells the fence leaves open: the east causeway and the north and south openings (their outer FENCE_MARGIN rows). */
export const inPortalGap = (i: number, j: number) =>
	inCauseway(i, j) ||
	EDGE_PORTALS.some(
		(p) =>
			Math.abs(i - p.x) <= p.halfWidth && (p.side === 'north' ? j < FENCE_MARGIN : j > N - 1 - FENCE_MARGIN)
	);

/** The gorge's centre line: the edge station, the lip station, and the small waterfall at the river's head. */
const GORGE_LINE: readonly XZ[] = [GORGE.from, GORGE.lip, WATERFALL];
const GORGE_RUN = distance(GORGE.from[0], GORGE.from[1], GORGE.lip[0], GORGE.lip[1]);
/** The gorge's surface at an arc length from the edge: falling to the lip, then level to the waterfall. */
const gorgeWaterAt = (arc: number) =>
	GORGE.waterFrom + (GORGE.waterLip - GORGE.waterFrom) * Math.min(1, arc / GORGE_RUN);

/**
 * Where (x, z) lies against the gorge: its distance `d` from the line, the arc length
 * at its nearest point, its side, and how far that side's bank is there (GORGE.north
 * or GORGE.south). Past the waterfall's end only the
 * narrow north width applies, so the cut stops at the lip.
 */
export function gorgeBank(x: number, z: number): { d: number; arc: number; bank: number; south: boolean } {
	const { d2, arc } = polylineNearest(GORGE_LINE, x, z);
	const t = Math.min(1, arc / GORGE_RUN);
	const [ax, az] = x >= GORGE.lip[0] ? GORGE.from : GORGE.lip;
	const [bx, bz] = x >= GORGE.lip[0] ? GORGE.lip : WATERFALL;
	// The line runs west, so the south bank is on its left: a negative cross product.
	const south = (bx - ax) * (z - az) - (bz - az) * (x - ax) < 0;
	const [from, to] = south && x >= WATERFALL[0] ? GORGE.south : GORGE.north;
	return { d: Math.sqrt(d2), arc, bank: from + (to - from) * t, south };
}

/**
 * The gorge through the serra (layout.ts GORGE): after the massifs, every cell
 * within its bank's distance of the line drops to the flat bed under the stream
 * and becomes water. Cells only ever go down, so the river head below the lip
 * keeps its own water, and the massif beside the cut stands as its walls.
 */
function carveGorge(heights: Float32Array, edge: Float32Array, waterY: Float32Array) {
	const [fx, fz] = GORGE.from;
	const [wx, wz] = WATERFALL;
	const r = Math.max(GORGE.north[0], GORGE.north[1], GORGE.south[0], GORGE.south[1]);
	for (
		let j = Math.max(0, floor(Math.min(fz, wz) - r));
		j <= Math.min(N - 1, floor(Math.max(fz, wz) + r) + 1);
		j++
	)
		for (let i = Math.max(0, floor(wx - r)); i <= Math.min(N - 1, floor(fx + r) + 1); i++) {
			const { d, arc, bank } = gorgeBank(i, j);
			if (d > bank) continue;
			const q = j * N + i;
			const water = gorgeWaterAt(arc);
			if (heights[q] <= water - GORGE.depth) continue;
			heights[q] = water - GORGE.depth;
			edge[q] = Math.min(edge[q], d - bank - 1e-3);
			waterY[q] = water;
		}
}

/**
 * The grotto's niche: a flat dry floor cut into the serra's west face behind
 * the small waterfall (the plunge pool's ellipse runs under the face, so its
 * cells are marked dry again).
 */
function cutNiche(heights: Float32Array, edge: Float32Array) {
	const { x0, x1, z0, z1 } = GROTTO.niche;
	for (let j = z0; j <= z1; j++)
		for (let i = x0; i <= x1; i++) {
			heights[j * N + i] = Math.min(heights[j * N + i], GROTTO.floorY);
			edge[j * N + i] = Math.max(edge[j * N + i], 0);
		}
}

/** Cuts the cliff back under a ledge, so the ledge juts out of the face. */
function notch(heights: Float32Array, top: ObbyTop) {
	forCells(top.x, top.z, top.radius * 2, (q, i, j) => {
		if (insideTop(top, i, j, 0.75) && heights[q] > top.y - 0.05) heights[q] = top.y - 0.05;
	});
}

/** Lowers or raises a disk to height y around a point anywhere, blending back between r0 and r1. */
function flattenDisk(
	heights: Float32Array,
	x: number,
	z: number,
	y: number,
	r0: number,
	r1: number,
	only: (q: number) => boolean = () => true
) {
	forCells(x, z, r1, (q, i, j) => {
		const d = distance(i, j, x, z);
		if (d < r1 && only(q)) heights[q] = y + (heights[q] - y) * smoothstep(r0, r1, d);
	});
}

function forCells(x: number, z: number, r: number, visit: (q: number, i: number, j: number) => void) {
	for (let j = Math.max(0, floor(z - r)); j <= Math.min(N - 1, floor(z + r) + 1); j++)
		for (let i = Math.max(0, floor(x - r)); i <= Math.min(N - 1, floor(x + r) + 1); i++)
			visit(j * N + i, i, j);
}

/** Whether (x, z) lies on an obby top grown by `margin`: a disk, or a square turned to the top's heading. */
export function insideTop(top: ObbyTop, x: number, z: number, margin: number): boolean {
	const dx = x - top.x;
	const dz = z - top.z;
	const r = top.radius + margin;
	if (top.piece !== 'ledge') return dx * dx + dz * dz <= r * r;
	// Local +z is (yawS, yawC), local +x is (yawC, −yawS).
	const front = dx * top.yawS + dz * top.yawC;
	const side = dx * top.yawC - dz * top.yawS;
	return Math.abs(front) <= r && Math.abs(side) <= r;
}

function groundUnder(heights: Float32Array, top: ObbyTop): number {
	let low = Number.POSITIVE_INFINITY;
	forCells(top.x, top.z, top.radius * 1.5, (_q, i, j) => {
		if (insideTop(top, i, j, 0.5)) low = Math.min(low, heights[j * N + i]);
	});
	return low === Number.POSITIVE_INFINITY ? heightAt(heights, top.x, top.z) : low;
}

/** Rise per unit at each cell, from central differences (terrain.ts slopes). */
function slopeOf(heights: Float32Array): Float32Array {
	const slope = new Float32Array(CELLS);
	for (let j = 0; j < N; j++)
		for (let i = 0; i < N; i++) {
			const hx = heights[j * N + Math.min(N - 1, i + 1)] - heights[j * N + Math.max(0, i - 1)];
			const hz = heights[Math.min(N - 1, j + 1) * N + i] - heights[Math.max(0, j - 1) * N + i];
			slope[j * N + i] = Math.sqrt(hx * hx + hz * hz) / 2;
		}
	return slope;
}

/** The bridge deck, walkable at the height of the line between its banks (generate.ts makeCrossing). */
function makeBridge(
	heights: Float32Array,
	flags: Uint8Array,
	walkH: Float32Array,
	clear: Uint8Array,
	river: River
): Crossing {
	const [fx, fz] = PLACES.bridgeFrom;
	const [tx, tz] = PLACES.bridgeTo;
	const water = riverWaterAt(river, (fx + tx) / 2, (fz + tz) / 2);
	const from = { x: fx, y: Math.max(heightAt(heights, fx, fz), water + 0.5), z: fz };
	const to = { x: tx, y: Math.max(heightAt(heights, tx, tz), water + 0.5), z: tz };
	const sx = tx - fx;
	const sz = tz - fz;
	const span = Math.sqrt(sx * sx + sz * sz);
	forCells((fx + tx) / 2, (fz + tz) / 2, span / 2 + 3, (q, i, j) => {
		const t = ((i - fx) * sx + (j - fz) * sz) / (span * span);
		const off = Math.abs((i - fx) * sz - (j - fz) * sx) / span;
		if (t < 0 || t > 1 || off > BRIDGE_HALF_WIDTH + 1) return;
		clear[q] |= RESERVED;
		if (off > BRIDGE_HALF_WIDTH) return;
		walkH[q] = from.y + (to.y - from.y) * t;
		flags[q] |= FLAG.walkable | FLAG.crossing;
	});
	return { kind: 'bridge', from, to, halfWidth: BRIDGE_HALF_WIDTH, water, stones: [] };
}

/** The mirante ledges as oriented boxes (stride 8, like logs) from the ground under them to their tops. */
function addLedgeBoxes(blocks: ReturnType<typeof collisionBlocks>, tops: ObbyTop[]) {
	const extra: number[][] = blocks.map(() => []);
	for (const top of tops) {
		const b = Math.min(3, floor(top.z / 40)) * 4 + Math.min(3, floor(top.x / 40));
		const half = (top.y - top.bottom) / 2;
		extra[b].push(top.x, top.bottom + half, top.z, top.radius, half, top.radius, top.yawC, top.yawS);
	}
	for (const block of blocks)
		if (extra[block.index].length > 0)
			block.boxes = Float32Array.from([...block.boxes, ...extra[block.index]]);
}

// --- Story data ------------------------------------------------------------------

function point(heights: Float32Array, [x, z]: XZ, lift = 0): Point {
	return { x, y: heightAt(heights, x, z) + lift, z };
}

function checkpoint(
	id: string,
	at: Point,
	facing: Facing,
	mission: number,
	size = CHECKPOINT_SIZE
): StoryCheckpoint {
	const h = size / 2;
	return {
		id,
		mission,
		min: { x: at.x - h, y: at.y - 0.5, z: at.z - h },
		max: { x: at.x + h, y: at.y + 3, z: at.z + h },
		spawn: { x: at.x, y: at.y, z: at.z },
		yaw: FACING[facing]
	};
}

function zone(
	id: string,
	kind: TriggerZone['kind'],
	at: Point,
	radius: number,
	mission: number,
	tall = 4
): TriggerZone {
	return { id, kind, x: at.x, y: at.y, z: at.z, radius, minY: at.y - tall / 2, maxY: at.y + tall, mission };
}

function resolveTrail(p: (typeof TRAILS)[string][number], stones: Stones, ledges: Ledges): [number, number] {
	if (p === 'stonesWest') return [stones.padA.x, stones.padA.z];
	if (p === 'stonesEast') return [stones.padB.x, stones.padB.z];
	if (p === 'ledgeTakeoff') return [ledges.pad.x, ledges.pad.z];
	return [p[0], p[1]];
}

function storyLevel(
	heights: Float32Array,
	river: River,
	stones: Stones,
	ledges: Ledges,
	bridge: Crossing,
	grotto: GrottoRun,
	branches: Branches
): StoryLevel {
	const at = (p: XZ, lift = 0) => point(heights, p, lift);
	const [spawnYawC, spawnYawS] = HEADING[SPAWN.facing];
	const spawn = { ...at(SPAWN.at), yawC: spawnYawC, yawS: spawnYawS, yaw: FACING[SPAWN.facing] };

	// Planting: the corridor line across the pasture, the ring in the clareira.
	const planting: PlantingSpot[] = [];
	for (let k = 0; k < CORRIDOR_LINE.count; k++) {
		const x = CORRIDOR_LINE.from[0];
		const z = CORRIDOR_LINE.from[1] + k * CORRIDOR_LINE.stepZ;
		const cell = floor(z / PLANT_STEP) * PLANT_GRID + floor(x / PLANT_STEP);
		planting.push({ id: `corredor-${k + 1}`, mission: 1, cell, ...at([x, z]) });
	}
	const s = Math.sqrt(3) / 2;
	const ring: XZ[] = [
		[1, 0],
		[0.5, s],
		[-0.5, s],
		[-1, 0],
		[-0.5, -s],
		[0.5, -s]
	];
	const [ccx, ccz] = CLAREIRA.centre;
	ring.forEach(([c, sn], k) => {
		planting.push({
			id: `clareira-${k + 1}`,
			mission: 4,
			cell: -1,
			...at([ccx + CLAREIRA.ringRadius * c, ccz + CLAREIRA.ringRadius * sn])
		});
	});

	// The observation rock's hiding spot: behind the boulder, away from the cutting.
	const [rx, rz] = PLACES.observationRock;
	const [cux, cuz] = PLACES.cutting;
	const [hx, hz] = direction(cux, cuz, rx, rz);
	const hide = at([rx + hx * OBSERVATION_ROCK.hideDistance, rz + hz * OBSERVATION_ROCK.hideDistance]);
	const mirante = at(MIRANTE_TOP);
	const stoneLedge = ledges.tops[LEDGES.checkpointLedge - 1];

	const checkpoints: StoryCheckpoint[] = [
		checkpoint('pasto', at(CHECKPOINTS.pasture), CHECKPOINT_FACING.pasture, 1),
		checkpoint('pedras-oeste', stones.padA, CHECKPOINT_FACING.stonesWest, 3),
		checkpoint('pedras-leste', stones.padB, CHECKPOINT_FACING.stonesEast, 3),
		checkpoint('clareira', at(CHECKPOINTS.clareira), CHECKPOINT_FACING.clareira, 4),
		checkpoint(
			`degrau-${LEDGES.checkpointLedge}`,
			{ x: stoneLedge.x, y: stoneLedge.y, z: stoneLedge.z },
			CHECKPOINT_FACING.ledge,
			6,
			LEDGES.size
		),
		checkpoint('mirante-topo', mirante, CHECKPOINT_FACING.mirante, 6)
	];
	const start = checkpoint('inicio', spawn, CHECKPOINT_FACING.start, 0);

	const triggers: TriggerZone[] = [
		zone('iara', 'npc', at(PLACES.iara), 3, 0),
		...planting.map((p) => zone(p.id, 'planting', p, PLANTING_RADIUS, p.mission)),
		zone('observacao', 'observation', hide, OBSERVATION_ROCK.zoneRadius, 2),
		zone('madeireiro', 'logger', at(PLACES.cutting), LOGGER_RADIUS, 2, 20),
		...TRAPS.map((p, k) => zone(`armadilha-${k + 1}`, 'trap', at(p), TRAP_RADIUS, 5)),
		zone('onca', 'onca', at(ANIMALS['onca-pintada']), ONCA_RADIUS, 0, 20),
		zone('mirante', 'mirante', mirante, MIRANTE_RADIUS, 6)
	];

	// Plain points: a target taken from a planting spot must not carry its id into the mission leaf.
	const targets: Point[] = [planting[2], hide, stones.padB, at(CLAREIRA.centre), at(TRAPS[0]), mirante].map(
		({ x, y, z }) => ({ x, y, z })
	);
	const missions: Mission[] = [
		{
			id: 1,
			key: 'sementes',
			name: 'Sementes de juçara',
			requires: [],
			target: targets[0],
			count: CORRIDOR_LINE.count,
			dialogue: ['FRUIT_FACT', 'MICO_FEED'],
			triggers: [
				...FRUITS.map((_, k) => `jucara-${k + 1}`),
				...planting.filter((p) => p.mission === 1).map((p) => p.id)
			]
		},
		{
			id: 2,
			key: 'corte-ilegal',
			name: 'Olho no corte ilegal',
			requires: [1],
			target: targets[1],
			count: 1,
			dialogue: ['LOGGER_DIALOG'],
			triggers: ['observacao', 'madeireiro']
		},
		{
			id: 3,
			key: 'pedras',
			name: 'Pedras do rio',
			requires: [1],
			target: targets[2],
			count: 1,
			dialogue: [],
			triggers: ['pedras-leste']
		},
		{
			id: 4,
			key: 'mudas',
			name: 'Mudas na clareira',
			requires: [1],
			target: targets[3],
			count: ring.length,
			dialogue: [],
			triggers: planting.filter((p) => p.mission === 4).map((p) => p.id)
		},
		{
			id: 5,
			key: 'armadilhas',
			name: 'Armadilhas',
			requires: [1],
			target: targets[4],
			count: TRAPS.length,
			dialogue: ['TRAP_FACT'],
			triggers: TRAPS.map((_, k) => `armadilha-${k + 1}`)
		},
		{
			id: 6,
			key: 'mirante',
			name: 'Mirante',
			requires: [1, 2, 3, 4, 5],
			target: targets[5],
			count: 1,
			dialogue: [],
			triggers: ['mirante']
		}
	];

	const leafStone = stones.tops[STONES.goldLeafStone - 1];
	const collectibles: Collectible[] = [
		...FRUITS.map((p, k) => ({
			id: `jucara-${k + 1}`,
			kind: 'jucara-fruit' as const,
			variant: '',
			mission: 1,
			radius: COLLECT_RADIUS,
			on: '',
			...at(p)
		})),
		...TRASH.map((p, k) => ({
			id: `lixo-${k + 1}`,
			kind: 'trash' as const,
			variant: TRASH_KINDS[k % TRASH_KINDS.length],
			mission: 0,
			radius: COLLECT_RADIUS,
			on: '',
			...at(p)
		})),
		{
			id: 'folha-pedra',
			kind: 'gold-leaf',
			variant: '',
			mission: 3,
			radius: COLLECT_RADIUS,
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
			radius: COLLECT_RADIUS,
			on: '',
			x: m.target.x,
			y: m.target.y,
			z: m.target.z
		}))
	];

	const toSpawn = (p: XZ): [number, number] => headingTo(p[0], p[1], SPAWN.at[0], SPAWN.at[1]);
	const landmark = (
		id: string,
		kind: Landmark['kind'],
		p: Point,
		heading: [number, number],
		label = '',
		height = 0,
		silhouette = false
	): Landmark => ({ id, kind, label, silhouette, height, ...p, yawC: heading[0], yawS: heading[1] });
	// The small waterfall falls from the gorge's lip to the river's head.
	const waterfallTop = GORGE.waterLip;
	const landmarks: Landmark[] = [
		landmark('iara', 'npc-iara', at(PLACES.iara), toSpawn(PLACES.iara), 'Iara'),
		landmark('viveiro', 'viveiro', at(PLACES.viveiro), toSpawn(PLACES.viveiro), 'Viveiro'),
		landmark('ipe', 'ipe-amarelo', at(PLACES.ipe), [1, 0], 'Ipê-amarelo', 12, true),
		landmark(
			'placa',
			'trail-sign',
			at(PLACES.trailSign),
			toSpawn(PLACES.trailSign),
			'Trilha da Reserva',
			2.2
		),
		landmark(
			'pedra-observacao',
			'observation-rock',
			at(PLACES.observationRock),
			headingTo(cux, cuz, rx, rz),
			'Pedra de observação',
			OBSERVATION_ROCK.height
		),
		landmark('corte', 'cutting', at(PLACES.cutting), headingTo(cux, cuz, rx, rz)),
		landmark('jequitiba-rosa', 'cutting-tree', at(CUTTING_TREE), [1, 0]),
		landmark(
			'ponte',
			'bridge',
			{
				x: (bridge.from.x + bridge.to.x) / 2,
				y: (bridge.from.y + bridge.to.y) / 2,
				z: (bridge.from.z + bridge.to.z) / 2
			},
			headingTo(bridge.from.x, bridge.from.z, bridge.to.x, bridge.to.z),
			'Ponte'
		),
		landmark('jequitiba', 'jequitiba', at(PLACES.jequitiba), [1, 0], 'Jequitibá', 18, true),
		landmark(
			'cachoeira',
			'waterfall',
			{ x: WATERFALL[0], y: waterfallTop, z: WATERFALL[1] },
			[1, 0],
			'',
			waterfallTop - river.waterAt(0)
		),
		landmark('mirante', 'mirante', mirante, HEADING.west, 'Mirante'),
		landmark('borboletas', 'butterflies', at(BUTTERFLIES, 1), [1, 0])
	];

	// The edge portals: data only, the runtime draws them and keeps each gate shut until its mission is done.
	const opener = missions.find((m) => m.key === PORTAL.requires);
	if (!opener) throw new Error(`portal requires unknown mission ${PORTAL.requires}`);
	const posts = (points: readonly XZ[]): Portal['posts'] => {
		const [a, b] = points.map((p) => ({ ...at(p), radius: PORTAL.postRadius, height: PORTAL.postHeight }));
		return [a, b];
	};
	const gateOf = ([a, b]: Portal['posts']): Portal['gate'] => ({
		from: { x: a.x, y: a.y, z: a.z },
		to: { x: b.x, y: b.y, z: b.z },
		height: PORTAL.gateHeight
	});
	const eastPosts = posts(PORTAL.posts);
	const east: Portal = {
		id: 'leste',
		side: 'east',
		requires: PORTAL.requires,
		mission: opener.id,
		gap: {
			at: WORLD_SIZE,
			from: PORTAL.z - PORTAL.halfWidth,
			to: PORTAL.z + PORTAL.halfWidth,
			y: RELIEF.plateauY
		},
		posts: eastPosts,
		sign: landmark(
			'placa-serra',
			'portal-sign',
			at(PORTAL.sign),
			HEADING.west,
			PORTAL.label,
			PORTAL.signHeight
		),
		gate: gateOf(eastPosts),
		inside: { ...at(PORTAL.inside), yaw: FACING.west },
		outside: { x: PORTAL.outside[0], y: RELIEF.plateauY, z: PORTAL.outside[1] },
		trail: 'mirante-leste'
	};
	const portals: Portal[] = [
		east,
		...EDGE_PORTALS.map((p): Portal => {
			const edgeZ = p.side === 'north' ? 0 : WORLD_SIZE;
			const y = heightAt(heights, p.x, edgeZ);
			const pair = posts(p.posts);
			return {
				id: p.id,
				side: p.side,
				requires: p.requires,
				mission: opener.id,
				gap: { at: edgeZ, from: p.x - p.halfWidth, to: p.x + p.halfWidth, y },
				posts: pair,
				sign: landmark(
					`placa-${p.id}`,
					'portal-sign',
					at(p.sign),
					HEADING[p.signFacing],
					p.label,
					PORTAL.signHeight
				),
				gate: gateOf(pair),
				inside: { ...at(p.inside), yaw: FACING[p.insideFacing] },
				outside: { x: p.outside[0], y, z: p.outside[1] },
				trail: p.trail
			};
		})
	];

	const trails: Trail[] = Object.entries(TRAILS).map(([id, points]) => ({
		id,
		halfWidth: TRAIL_HALF_WIDTH,
		points: points.map((p) => resolveTrail(p, stones, ledges))
	}));

	const obbies: Obby[] = [
		{
			id: 'stones',
			mission: 3,
			takeoff: stones.takeoffA,
			landing: stones.takeoffB,
			dirX: stones.pool.axisX,
			dirZ: stones.pool.axisZ,
			pieces: stones.tops,
			gaps: stones.gaps
		},
		{
			id: 'ledges',
			mission: 6,
			takeoff: ledges.takeoff,
			landing: ledges.landing,
			dirX: ledges.dirX,
			dirZ: ledges.dirZ,
			pieces: ledges.tops,
			gaps: ledges.gaps
		}
	];

	const act1 = act1Level(heights, grotto, branches, missions);

	return {
		version: STORY_VERSION,
		spawn,
		start,
		checkpoints,
		killY: KILL_Y,
		missions,
		obbies,
		collectibles,
		triggers,
		landmarks,
		trails,
		planting,
		pool: stones.pool,
		mirante,
		handholds: handholds(heights),
		portal: east,
		portals,
		act1,
		checksum: 0
	};
}

/** A rectangle's rails on the sides named, each side optionally split by an opening (centre along it, width). */
function railsOf(
	d: { x0: number; x1: number; z0: number; z1: number; y: number },
	height: number,
	sides: Partial<Record<'north' | 'south' | 'east' | 'west', { at: number; width: number } | null>>
): Rail[] {
	const rails: Rail[] = [];
	const run = (x0: number, z0: number, x1: number, z1: number) => {
		if (x0 !== x1 || z0 !== z1) rails.push({ x0, z0, x1, z1, y: d.y, height });
	};
	for (const [side, gap] of Object.entries(sides)) {
		const alongX = side === 'north' || side === 'south';
		const fixed = side === 'north' ? d.z0 : side === 'south' ? d.z1 : side === 'west' ? d.x0 : d.x1;
		const from = alongX ? d.x0 : d.z0;
		const to = alongX ? d.x1 : d.z1;
		const cuts: [number, number][] = gap
			? [
					[from, gap.at - gap.width / 2],
					[gap.at + gap.width / 2, to]
				]
			: [[from, to]];
		for (const [a, b] of cuts) {
			if (alongX) run(a, fixed, b, fixed);
			else run(fixed, a, fixed, b);
		}
	}
	return rails;
}

/**
 * Act 1's additions (PARK.md §3): the treehouse and its ladder, the zipline and
 * its two decks, the gorge's water, the grotto, the canopy branches, the two
 * NPCs, their seeds and birds, and their three missions. Trail marks need the
 * trees, so the builder fills `marks` after planting.
 */
function act1Level(heights: Float32Array, grotto: GrottoRun, branches: Branches, story: Mission[]): Act1 {
	const at = (p: XZ, lift = 0) => point(heights, p, lift);
	const plain = ({ x, y, z }: Point): Point => ({ x, y, z });

	// The treehouse: a deck around the trunk, railed but for the ladder's top on the south edge.
	const tree = at(TREEHOUSE.tree);
	const h = TREEHOUSE.deckHalf;
	const deckY = tree.y + TREEHOUSE.height;
	const box = { x0: tree.x - h, x1: tree.x + h, z0: tree.z - h, z1: tree.z + h, y: deckY };
	const house: Deck = {
		id: 'casa-na-arvore',
		...box,
		rails: railsOf(box, TREEHOUSE.railHeight, {
			north: null,
			east: null,
			west: null,
			south: { at: tree.x, width: TREEHOUSE.ladderWidth }
		})
	};
	const ladder = {
		id: 'escada-casa',
		bottom: at([tree.x, box.z1 + TREEHOUSE.ladderOut]),
		top: { x: tree.x, y: deckY, z: box.z1 - 0.5 },
		yaw: FACING.north,
		yawC: HEADING.north[0],
		yawS: HEADING.north[1],
		width: TREEHOUSE.ladderWidth,
		deck: house.id
	};

	// The zipline and its decks.
	const M = MIRANTE_DECK;
	const mirante: Deck = {
		id: 'mirante-deck',
		x0: M.x0,
		x1: M.x1,
		z0: M.z0,
		z1: M.z1,
		y: M.y,
		rails: railsOf(M, M.railHeight, {
			north: null,
			south: null,
			east: null,
			west: { at: M.gapZ, width: M.gapWidth }
		})
	};
	const B = ZIPLINE_BASE;
	const base: Deck = {
		id: 'tirolesa-base',
		x0: B.x0,
		x1: B.x1,
		z0: B.z0,
		z1: B.z1,
		y: B.y,
		rails: railsOf(B, B.railHeight, { north: null, south: null })
	};
	const start = { x: ZIPLINE.start[0], y: ZIPLINE.startY, z: ZIPLINE.start[1] };
	const end = { x: ZIPLINE.end[0], y: ZIPLINE.endY, z: ZIPLINE.end[1] };
	const run = distance(start.x, start.z, end.x, end.z);
	const drop = start.y - end.y;
	const opener = story.find((m) => m.key === ZIPLINE.requires);
	if (!opener) throw new Error(`zipline requires unknown mission ${ZIPLINE.requires}`);

	// NPCs, seeds, birds and the missions.
	const npcs = (['ana', 'ze'] as const).map((id) => {
		const npc = NPCS[id];
		const p = at(npc.at);
		const [yawC, yawS] = headingTo(p.x, p.z, npc.facing[0], npc.facing[1]);
		return { id, name: npc.name, mission: id === 'ana' ? 7 : 8, ...p, yawC, yawS };
	});
	const seeds = SEED_SPOTS.map((s, k) => ({
		id: `semente-${k + 1}`,
		species: s.species,
		mission: 7,
		radius: COLLECT_RADIUS,
		...at(s.at)
	}));
	const birds = BIRD_PERCHES.map((b) => ({
		id: `ave-${b.species}`,
		species: b.species,
		mission: 8,
		...at(b.at, b.lift)
	}));
	const [ana, ze] = npcs;
	const triggers: TriggerZone[] = [
		{
			...zone(house.id, 'mission', plain(tree), TREEHOUSE.missionRadius, 0),
			y: deckY,
			minY: deckY - 0.5,
			maxY: deckY + 4
		},
		zone('ana', 'npc', plain(ana), 3, 7),
		zone('ze', 'npc', plain(ze), 3, 8)
	];
	const missions: Mission[] = [
		{
			id: 0,
			key: 'casa-na-arvore',
			name: 'Suba e veja a Reserva',
			requires: [],
			target: plain(ladder.bottom),
			count: 1,
			dialogue: ['CASA_INTRO', 'CASA_VISTA'],
			triggers: [house.id]
		},
		{
			id: 7,
			key: 'sementes-viveiro',
			name: 'Sementes para o viveiro',
			requires: [1],
			target: plain(ana),
			count: seeds.length,
			dialogue: [
				'ANA_INTRO',
				'ANA_OBRIGADA',
				'FACT_SEMENTE_PAU_BRASIL',
				'FACT_SEMENTE_JEQUITIBA',
				'FACT_SEMENTE_IPE_ROSA'
			],
			triggers: ['ana', ...seeds.map((s) => s.id)]
		},
		{
			id: 8,
			key: 'fotografe-aves',
			name: 'Fotografe 3 aves',
			requires: [1],
			target: plain(ze),
			count: birds.length,
			dialogue: ['ZE_INTRO', 'ZE_OBRIGADO', 'FACT_AVE_TUCANO', 'FACT_AVE_SAIRA', 'FACT_AVE_SABIA'],
			triggers: ['ze', ...birds.map((b) => b.id)]
		}
	];

	const leaf = (id: string, p: Point, on: string) => ({
		id,
		kind: 'gold-leaf' as const,
		variant: '',
		mission: 0,
		radius: COLLECT_RADIUS,
		on,
		...plain(p)
	});
	const last = branches.tops[branches.tops.length - 1];
	return {
		missions,
		firstRequires: [0],
		triggers,
		treehouse: { tree, deck: house, ladder },
		zipline: {
			id: 'tirolesa',
			start,
			end,
			cableAbove: ZIPLINE.cableAbove,
			length: Math.sqrt(run * run + drop * drop),
			drop,
			clearance: ZIPLINE.clearance,
			brake: ZIPLINE.brake,
			maxSpeed: ZIPLINE.maxSpeed,
			requires: ZIPLINE.requires,
			mission: opener.id,
			startDeck: mirante.id,
			endDeck: base.id
		},
		decks: [house, mirante, base],
		gorge: {
			id: 'garganta',
			points: [GORGE.from, GORGE.lip, WATERFALL].map(([x, z], k) => ({
				x,
				z,
				water: k === 0 ? GORGE.waterFrom : GORGE.waterLip,
				north: k === 0 ? GORGE.north[0] : GORGE.north[1],
				south: k === 0 ? GORGE.south[0] : k === 1 ? GORGE.south[1] : GORGE.north[1]
			})),
			depth: GORGE.depth
		},
		grotto: {
			niche: { ...GROTTO.niche, y: GROTTO.floorY },
			pool: grotto.pool,
			obby: {
				id: 'gruta',
				mission: 0,
				takeoff: grotto.takeoff,
				landing: grotto.landing,
				dirX: 1,
				dirZ: 0,
				pieces: grotto.tops,
				gaps: grotto.gaps
			},
			leaf: leaf('folha-gruta', at(GROTTO.leaf), ''),
			note: { ...at(GROTTO.note), text: 'GRUTA_BILHETE' }
		},
		canopy: {
			obby: {
				id: 'copa',
				mission: 0,
				takeoff: branches.takeoff,
				landing: plain(last),
				dirX: branches.dirX,
				dirZ: branches.dirZ,
				pieces: branches.tops,
				gaps: branches.gaps
			},
			leaf: leaf('folha-copa', last, `galho-${branches.tops.length}`),
			tree: branches.tree
		},
		npcs,
		seeds,
		birds,
		marks: [],
		text: { ...ACT1_TEXT }
	};
}

/**
 * Trail marks about every TRAIL_MARKS.spacing u along each trail: on the
 * nearest trunk within trunkReach of the spot, facing the trail, else on a post
 * just off the trail's right edge, facing back at it.
 */
function trailMarks(heights: Float32Array, trails: Trail[], trees: Item[]): TrailMark[] {
	const marks: TrailMark[] = [];
	for (const trail of trails) {
		const arcs = arcLengths(trail.points);
		const length = arcs[arcs.length - 1];
		const count = Math.max(1, floor(length / TRAIL_MARKS.spacing + 0.5));
		for (let k = 0; k < count; k++) {
			const arc = (length * (k + 0.5)) / count;
			let seg = 0;
			while (seg + 2 < arcs.length && arcs[seg + 1] < arc) seg++;
			const [ax, az] = trail.points[seg];
			const [bx, bz] = trail.points[seg + 1];
			const t = (arc - arcs[seg]) / (arcs[seg + 1] - arcs[seg]);
			const px = ax + (bx - ax) * t;
			const pz = az + (bz - az) * t;
			let best = -1;
			let bestD: number = TRAIL_MARKS.trunkReach;
			for (let n = 0; n < trees.length; n++) {
				const d = distance(px, pz, trees[n].x, trees[n].z);
				if (d <= bestD) {
					bestD = d;
					best = n;
				}
			}
			const [dx, dz] = direction(ax, az, bx, bz);
			const [mx, mz] =
				best >= 0 ? [trees[best].x, trees[best].z] : postBeside(trails, px, pz, dx, dz, trail.halfWidth);
			const [yawC, yawS] = headingTo(mx, mz, px, pz);
			marks.push({
				trail: trail.id,
				on: best >= 0 ? 'trunk' : 'post',
				x: mx,
				y: heightAt(heights, mx, mz),
				z: mz,
				yawC,
				yawS,
				height: TRAIL_MARKS.height
			});
		}
	}
	return marks;
}

/**
 * A post `postOut` u off the trail's edge, on the first side (left, then right) clear
 * of every trail by that much; where a trail doubles back, further out on that side.
 */
function postBeside(trails: Trail[], px: number, pz: number, dx: number, dz: number, halfWidth: number): XZ {
	for (let extra = 0; extra <= TRAIL_MARKS.postSearch; extra += 0.5)
		for (const side of [1, -1]) {
			const out = side * (halfWidth + TRAIL_MARKS.postOut + extra);
			const x = px - dz * out;
			const z = pz + dx * out;
			if (trails.every((t) => polylineDistance(t.points, x, z) >= t.halfWidth + TRAIL_MARKS.postOut - 1e-9))
				return [x, z];
		}
	throw new Error(`no room for a trail post near ${px},${pz}`);
}

/** Branch handholds along the muriqui row, evenly spaced within MURIQUI_HANDHOLDS. */
function handholds(heights: Float32Array): Point[] {
	const arcs = arcLengths(MURIQUI_ROW);
	const length = arcs[arcs.length - 1];
	const spacing = Math.min(MURIQUI_HANDHOLDS.spacingMax, MURIQUI_HANDHOLDS.maxReach);
	const spans = floor(length / spacing - 1e-9) + 1;
	const out: Point[] = [];
	for (let k = 0; k <= spans; k++) {
		const arc = (length * k) / spans;
		let seg = 0;
		while (seg + 2 < arcs.length && arcs[seg + 1] < arc) seg++;
		const t = (arc - arcs[seg]) / (arcs[seg + 1] - arcs[seg]);
		const [ax, az] = MURIQUI_ROW[seg];
		const [bx, bz] = MURIQUI_ROW[seg + 1];
		const x = ax + (bx - ax) * t;
		const z = az + (bz - az) * t;
		out.push({ x, y: heightAt(heights, x, z) + MURIQUI_HANDHOLDS.height, z });
	}
	return out;
}

/** Everything the child must reach, for the builder's own check and the tests. */
export function reachTargets(level: StoryLevel): { id: string; x: number; z: number; onObby: string }[] {
	return [
		...level.missions.map((m) => ({ id: `missao-${m.id}`, x: m.target.x, z: m.target.z, onObby: '' })),
		...[level.start, ...level.checkpoints].map((c) => ({
			id: `checkpoint ${c.id}`,
			x: c.spawn.x,
			z: c.spawn.z,
			onObby: c.id.startsWith('degrau') ? 'ledges' : ''
		})),
		...level.collectibles.map((c) => ({ id: c.id, x: c.x, z: c.z, onObby: c.on === '' ? '' : 'stones' })),
		...level.planting.map((p) => ({ id: p.id, x: p.x, z: p.z, onObby: '' })),
		{ id: 'mirante', x: level.mirante.x, z: level.mirante.z, onObby: '' },
		...(level.portals ?? [level.portal]).flatMap((p) => {
			const mid = (p.gap.from + p.gap.to) / 2;
			return [
				{ id: `portal-${p.id}`, x: p.inside.x, z: p.inside.z, onObby: '' },
				{
					id: `portal-${p.id}-borda`,
					x: p.side === 'east' ? p.gap.at : mid,
					z: p.side === 'east' ? mid : p.gap.at,
					onObby: ''
				}
			];
		}),
		...act1Targets(level)
	];
}

/** Act 1's places: on foot, but for the treehouse deck (by its ladder), the base deck (by the zipline) and the canopy leaf. */
function act1Targets(level: StoryLevel): { id: string; x: number; z: number; onObby: string }[] {
	const a = level.act1;
	if (!a) return [];
	const ground = (id: string, p: { x: number; z: number }, onObby = '') => ({ id, x: p.x, z: p.z, onObby });
	return [
		...a.missions.map((m) => ground(`missao-${m.id}`, m.target)),
		ground('escada-casa', a.treehouse.ladder.bottom),
		ground('casa-na-arvore', a.treehouse.ladder.top, 'casa'),
		ground('tirolesa-inicio', a.zipline.start),
		ground('tirolesa-fim', a.zipline.end, 'tirolesa'),
		...a.npcs.map((n) => ground(n.id, n)),
		...a.seeds.map((s) => ground(s.id, s)),
		ground('gruta-saida', {
			x: a.grotto.obby.takeoff.x - a.grotto.obby.dirX * GROTTO.padBack,
			z: a.grotto.obby.takeoff.z - a.grotto.obby.dirZ * GROTTO.padBack
		}),
		ground(a.grotto.leaf.id, a.grotto.leaf),
		ground('copa-saida', a.canopy.obby.takeoff),
		ground(a.canopy.leaf.id, a.canopy.leaf, 'copa')
	];
}

/** Ground kept free of trees and rocks: the base, every target, the obby pads and the bridge ends. */
function reserveGameplay(
	clear: Uint8Array,
	level: StoryLevel,
	stones: Stones,
	ledges: Ledges,
	grotto: GrottoRun,
	branches: Branches
) {
	const [bcx, bcz] = BASE.centre;
	paint(clear, bcx, bcz, BASE.radius + 1, RESERVED);
	for (const m of level.missions) paint(clear, m.target.x, m.target.z, 3, RESERVED);
	for (const c of level.checkpoints) paint(clear, c.spawn.x, c.spawn.z, 2.5, RESERVED);
	for (const c of level.collectibles) paint(clear, c.x, c.z, 1.5, RESERVED);
	for (const p of level.planting) paint(clear, p.x, p.z, 1.5, RESERVED);
	for (const t of level.triggers)
		if (t.kind === 'trap' || t.kind === 'npc' || t.kind === 'observation')
			paint(clear, t.x, t.z, 2.5, RESERVED);
	for (const l of level.landmarks) if (l.kind !== 'cutting-tree') paint(clear, l.x, l.z, 2.5, RESERVED);
	for (const p of [stones.padA, stones.padB]) paint(clear, p.x, p.z, STONES.padRadius + 1.5, RESERVED);
	paint(clear, ledges.pad.x, ledges.pad.z, LEDGES.padRadius + 2, RESERVED);
	paint(clear, level.mirante.x, level.mirante.z, 4, RESERVED);
	// The portal's causeway and its posts and sign: no tree, rock or ground cover in the way.
	for (let x = PORTAL.fromX; x <= WORLD_SIZE; x += 2)
		paint(clear, x, PORTAL.z, PORTAL.halfWidth + 1.5, RESERVED);
	for (const portal of level.portals ?? [level.portal])
		for (const p of [...portal.posts, portal.sign, portal.inside]) paint(clear, p.x, p.z, 2, RESERVED);
	for (const [x, z] of [PLACES.bridgeFrom, PLACES.bridgeTo]) paint(clear, x, z, 4, RESERVED);
	// Act 1: the decks' footprints (the treehouse's own tree is planted on purpose), the ladder's foot,
	// the NPCs, the seeds, the grotto's pad and niche, and the canopy's take-off.
	const a = level.act1;
	if (!a) return;
	for (const d of a.decks)
		for (let z = d.z0 - 1; z <= d.z1 + 1; z += 1)
			for (let x = d.x0 - 1; x <= d.x1 + 1; x += 1) paint(clear, x, z, 1, RESERVED);
	paint(clear, a.treehouse.ladder.bottom.x, a.treehouse.ladder.bottom.z, 2, RESERVED);
	for (const n of a.npcs) paint(clear, n.x, n.z, 2.5, RESERVED);
	for (const s of a.seeds) paint(clear, s.x, s.z, 1.5, RESERVED);
	paint(clear, grotto.pad.x, grotto.pad.z, GROTTO.padRadius + 1.5, RESERVED);
	const { x0, x1, z0, z1 } = GROTTO.niche;
	for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) paint(clear, x, z, 1, RESERVED);
	paint(clear, branches.takeoff.x, branches.takeoff.z, 2, RESERVED);
}

/** Obby lanes as segments with a half width: no collider inside them. */
function laneSegments(
	stones: Stones,
	ledges: Ledges,
	grotto: GrottoRun,
	branches: Branches
): [XZ, XZ, number][] {
	const lane = LANE_CLEARANCE;
	const last = branches.tops[branches.tops.length - 1];
	return [
		[[stones.padA.x, stones.padA.z], [stones.padB.x, stones.padB.z], STONES.zigzag + STONES.radius + lane],
		[[ledges.pad.x, ledges.pad.z], [ledges.landing.x, ledges.landing.z], LEDGES.size / 2 + lane],
		[[grotto.pad.x, grotto.pad.z], [grotto.landing.x, grotto.landing.z], GROTTO.stoneRadius + lane],
		// The branches climb among the trees: only the jumps' own air is kept clear.
		[[branches.takeoff.x, branches.takeoff.z], [last.x, last.z], CANOPY.radius + 1.5]
	];
}

// --- Vegetation -----------------------------------------------------------------------

function plantTrees(
	zones: Uint8Array,
	flags: Uint8Array,
	clear: Uint8Array,
	slope: Float32Array,
	awayFromPaths: (x: number, z: number, r: number) => boolean,
	extraTrees: [TreeSpecies, XZ, number][]
): Item[] {
	const seed = subSeed(STORY_SEED, 2);
	const rng = new Rng(seed);
	const trees: Item[] = [];
	const species = (name: TreeSpecies) => TREE_SPECIES.indexOf(name);
	const special = (name: TreeSpecies, [x, z]: XZ, scale: number) => {
		const [yawC, yawS] = rng.heading();
		trees.push({ kind: species(name), x, z, scale, yawC, yawS });
		paint(clear, x, z, 2.5, OCCUPIED);
	};
	special('ipe-amarelo', PLACES.ipe, 1.3);
	special('jequitiba', PLACES.jequitiba, 2.2);
	special('jequitiba', CUTTING_TREE, 1.6);
	special('embauba', ANIMALS.preguica, 1.2);
	special('araucaria', ANIMALS.tucano, 1.2);
	MURIQUI_ROW.forEach((p, k) => {
		special(k % 2 === 0 ? 'jequitiba' : 'pau-brasil', p, 1.2);
	});
	// Act 1's trees: the treehouse's and the canopy leaf's crown, facing a fixed way.
	for (const [name, [x, z], scale] of extraTrees) {
		trees.push({ kind: species(name), x, z, scale, yawC: 1, yawS: 0 });
		paint(clear, x, z, 2.5, OCCUPIED);
	}

	// Each pass draws its points from its own stream and each candidate its numbers from
	// its own cell's, so a spot kept clear (a new lane, a cable) reshuffles no other tree.
	const grow = (x: number, z: number, density: number) => {
		const q = cellOf(x, z);
		const f = flags[q];
		if (clear[q] !== 0 || slope[q] > GROW_SLOPE) return;
		if (f & (FLAG.river | FLAG.crossing | FLAG.base | FLAG.cleared)) return;
		if (!awayFromPaths(x, z, MAX_TRUNK_RADIUS)) return;
		const rng = new Rng(subSeed(seed, 3 + q));
		if (rng.next() >= density) return;
		const zone = zones[q];
		const mix =
			zone === ZONE.restinga
				? TREE_MIX.restinga
				: zone === ZONE.highland
					? TREE_MIX.highland
					: zone === ZONE.slope
						? TREE_MIX.slope
						: f & FLAG.forest
							? TREE_MIX.lowland
							: TREE_MIX.open;
		const kind = rng.weighted(mix);
		const scale = rng.range(0.8, 1.3);
		const [yawC, yawS] = rng.heading();
		trees.push({ kind, x, z, scale, yawC, yawS });
		paint(clear, x, z, 1.2, OCCUPIED);
	};
	const forestPoints = poissonDisk(new Rng(subSeed(seed, 0)), 1, 1, N - 2, N - 2, TREE_SPACING_FOREST);
	for (let k = 0; k < forestPoints.length; k += 2) {
		const x = forestPoints[k];
		const z = forestPoints[k + 1];
		if (flags[cellOf(x, z)] & FLAG.forest) grow(x, z, 1);
	}
	const openPoints = poissonDisk(new Rng(subSeed(seed, 1)), 1, 1, N - 2, N - 2, TREE_SPACING_OPEN);
	for (let k = 0; k < openPoints.length; k += 2) {
		const x = openPoints[k];
		const z = openPoints[k + 1];
		const q = cellOf(x, z);
		if (flags[q] & FLAG.forest) continue;
		grow(x, z, zones[q] === ZONE.highland ? HIGHLAND_DENSITY : OPEN_DENSITY);
	}
	const edgePoints = poissonDisk(new Rng(subSeed(seed, 2)), 1, 1, N - 2, N - 2, TREE_SPACING_EDGE);
	for (let k = 0; k < edgePoints.length; k += 2) {
		const x = edgePoints[k];
		const z = edgePoints[k + 1];
		if (Math.min(x, z, WORLD_SIZE - x, WORLD_SIZE - z) < EDGE_BAND) grow(x, z, 1);
	}
	return trees;
}

function placeRocks(
	zones: Uint8Array,
	flags: Uint8Array,
	clear: Uint8Array,
	slope: Float32Array,
	edge: Float32Array,
	awayFromPaths: (x: number, z: number, r: number) => boolean
): Item[] {
	const rng = new Rng(subSeed(STORY_SEED, 3));
	const rocks: Item[] = [];
	// The observation boulder, about 4 u tall (boulder collider 1.1 u per unit of scale).
	const [ox, oz] = PLACES.observationRock;
	rocks.push({ kind: 0, x: ox, z: oz, scale: OBSERVATION_ROCK.height / 1.1, yawC: 1, yawS: 0 });
	paint(clear, ox, oz, OBSERVATION_ROCK.radius + 1, OCCUPIED);
	const points = poissonDisk(rng, 1, 1, N - 2, N - 2, ROCK_SPACING);
	for (let k = 0; k < points.length; k += 2) {
		const x = points[k];
		const z = points[k + 1];
		const q = cellOf(x, z);
		if (clear[q] !== 0 || slope[q] > GROW_SLOPE || flags[q] & (FLAG.river | FLAG.crossing | FLAG.base))
			continue;
		const zone = zones[q];
		const weight = edge[q] < 6 ? 0.5 : zone === ZONE.slope || zone === ZONE.highland ? 0.4 : 0.12;
		if (rng.next() >= weight) continue;
		const forest = (flags[q] & FLAG.forest) !== 0;
		const kind = rng.weighted(forest ? [0.35, 0.4, 0.25] : [0.45, 0.55, 0]);
		const scale = kind === 0 ? rng.range(0.7, 1.5) : kind === 1 ? rng.range(0.5, 1) : rng.range(0.8, 1.3);
		// Boulder radius 0.8, log half length 1.2 per unit of scale; stones never collide but keep off the paths too.
		const reach = kind === 0 ? 0.8 * scale : kind === 2 ? 1.25 * scale : 0.6 * scale;
		if (!awayFromPaths(x, z, reach)) continue;
		const [yawC, yawS] = rng.heading();
		rocks.push({ kind, x, z, scale, yawC, yawS });
		paint(clear, x, z, 1.5, OCCUPIED);
	}
	return rocks;
}

function coverGround(
	zones: Uint8Array,
	flags: Uint8Array,
	clear: Uint8Array,
	slope: Float32Array,
	trails: XZ[][],
	lanes: [XZ, XZ, number][],
	cable: [XZ, XZ, number]
): Item[] {
	const rng = new Rng(subSeed(STORY_SEED, 4));
	const out: Item[] = [];
	const points = poissonDisk(rng, 1, 1, N - 2, N - 2, DECORATION_SPACING);
	for (let k = 0; k < points.length; k += 2) {
		const x = points[k];
		const z = points[k + 1];
		const q = cellOf(x, z);
		const f = flags[q];
		if (clear[q] & RESERVED || slope[q] > GROW_SLOPE || f & (FLAG.river | FLAG.crossing | FLAG.base))
			continue;
		if (trails.some((t) => polylineDistance(t, x, z) < TRAIL_HALF_WIDTH + 0.5)) continue;
		if (lanes.some(([a, b, w]) => polylineDistance([a, b], x, z) < w - LANE_CLEARANCE)) continue;
		if (polylineDistance([cable[0], cable[1]], x, z) < cable[2] + 0.5) continue;
		const zone = zones[q];
		const mix =
			zone === ZONE.restinga
				? DECO_MIX.restinga
				: zone === ZONE.highland
					? DECO_MIX.highland
					: zone === ZONE.slope
						? DECO_MIX.slope
						: f & FLAG.forest
							? DECO_MIX.forest
							: DECO_MIX.open;
		const kind = rng.weighted(mix);
		const scale = rng.range(0.6, 1.3);
		const [yawC, yawS] = rng.heading();
		out.push({ kind, x, z, scale, yawC, yawS });
	}
	return out;
}

// --- Survival-shaped records -------------------------------------------------------

function baseCamp(heights: Float32Array, y: number): BaseCamp {
	const [x, z] = BASE.centre;
	const [yawC, yawS] = HEADING[SPAWN.facing];
	const [sx, sz] = SPAWN.at;
	const piece = (kind: BaseCamp['pieces'][number]['kind'], [px, pz]: XZ) => {
		const [c, s] = headingTo(px, pz, sx, sz);
		return { kind, x: px, y: heightAt(heights, px, pz), z: pz, yawC: c, yawS: s };
	};
	const [ix, iz] = PLACES.iara;
	return {
		x,
		y,
		z,
		yawC,
		yawS,
		radius: BASE.radius,
		spawn: { x: sx, y: heightAt(heights, sx, sz), z: sz },
		pieces: [
			piece('nursery', PLACES.viveiro),
			piece('signpost', PLACES.trailSign),
			piece('radio-mast', [ix + 1.5, iz - 1.5])
		]
	};
}

function corridorOf(level: StoryLevel, flags: Uint8Array, steps: Int16Array): Corridor {
	const cells: PlantingCell[] = level.planting
		.filter((p) => p.mission === 1)
		.map((p) => ({ cell: p.cell, steps: steps[cellOf(p.x, p.z)], x: p.x, y: p.y, z: p.z }));
	const sizes = FOREST.map((poly) => {
		let n = 0;
		for (let q = 0; q < CELLS; q++) {
			const i = q % N;
			if (flags[q] & FLAG.forest && insidePolygon(poly, i, (q - i) / N)) n++;
		}
		return n;
	});
	const [a, b] = CORRIDOR_FRAGMENTS;
	const ranked = sizes.map((_, k) => k).sort((p, q) => sizes[q] - sizes[p] || p - q);
	return {
		cells,
		length: (CORRIDOR_LINE.count - 1) * CORRIDOR_LINE.stepZ + 1,
		fromSize: sizes[a],
		toSize: sizes[b],
		joinsTwoLargest: (ranked[0] === a && ranked[1] === b) || (ranked[0] === b && ranked[1] === a)
	};
}

function poisOf(level: StoryLevel, stones: Stones, zones: Uint8Array, steps: Int16Array): Poi[] {
	const jequitiba = level.landmarks.find((l) => l.kind === 'jequitiba');
	const list: [Poi['kind'], Point, [number, number]][] = [
		['lookout', level.mirante, HEADING.west],
		[
			'stepping-stones',
			{ x: stones.pool.x, y: stones.pool.water, z: stones.pool.z },
			[stones.pool.axisZ, stones.pool.axisX]
		],
		['mother-tree', jequitiba ?? level.mirante, [1, 0]]
	];
	return list.map(([kind, p, [yawC, yawS]], id) => {
		const q = cellOf(p.x, p.z);
		const s = kind === 'stepping-stones' ? steps[cellOf(stones.padA.x, stones.padA.z)] : steps[q];
		return { id, kind, zone: ZONES[zones[q]], steps: s, x: p.x, y: p.y, z: p.z, yawC, yawS };
	});
}

/** Traps and trash as survival threat slots; seenFromLookout is a sight line from the mirante over the canopy. */
function threatsOf(
	level: StoryLevel,
	heights: Float32Array,
	flags: Uint8Array,
	zones: Uint8Array,
	steps: Int16Array
): ThreatSlot[] {
	const threats: ThreatSlot[] = [];
	const add = (kind: 'trap' | 'trash', p: Point) => {
		const q = cellOf(p.x, p.z);
		threats.push({
			id: threats.length,
			kind,
			responder: RESPONDER[kind],
			zone: ZONES[zones[q]],
			steps: steps[q],
			seenFromLookout: seen(heights, flags, level.mirante, p.x, p.y + 1, p.z),
			x: p.x,
			y: p.y,
			z: p.z,
			yawC: 1,
			yawS: 0
		});
	};
	for (const t of level.triggers) if (t.kind === 'trap') add('trap', t);
	for (const c of level.collectibles) if (c.kind === 'trash') add('trash', c);
	return threats;
}

/** Whether (x, top, z) shows from 3 u over the mirante, over the ground and a 6 u canopy on forest cells. */
function seen(heights: Float32Array, flags: Uint8Array, from: Point, x: number, top: number, z: number) {
	const eye = from.y + 3;
	const dx = x - from.x;
	const dz = z - from.z;
	const n = floor(Math.sqrt(dx * dx + dz * dz));
	for (let k = 1; k < n; k++) {
		const t = k / n;
		const px = from.x + dx * t;
		const pz = from.z + dz * t;
		const canopy = flags[cellOf(px, pz)] & FLAG.forest ? 6 : 0;
		if (heightAt(heights, px, pz) + canopy > eye + (top - eye) * t) return false;
	}
	return true;
}

function animalsOf(heights: Float32Array): AnimalHome[] {
	return ALBUM.filter((entry) => entry.species in ANIMALS).map((entry, id) => {
		const [x, z] = ANIMALS[entry.species as keyof typeof ANIMALS];
		return { id, species: entry.species, zone: entry.zone, radius: 6, x, y: heightAt(heights, x, z), z };
	});
}

/** Survival's counts (every key present, the busiest 80 u quadrant per tree species), plus the story's. */
function countAll(
	treeKinds: Uint8Array,
	rockKinds: Uint8Array,
	decoKinds: Uint8Array,
	treeBlocks: Uint8Array,
	level: StoryLevel,
	pois: Poi[],
	threats: ThreatSlot[]
): Record<string, number> {
	const counts: Record<string, number> = {};
	const tally = (prefix: string, kinds: readonly string[], of: ArrayLike<number>) => {
		for (const kind of kinds) counts[`${prefix}:${kind}`] = 0;
		for (let k = 0; k < of.length; k++) counts[`${prefix}:${kinds[of[k]]}`]++;
	};
	tally('tree', TREE_SPECIES, treeKinds);
	tally('rock', ROCK_KINDS, rockKinds);
	tally('decoration', DECORATION_KINDS, decoKinds);
	tally(
		'threat',
		THREAT_KINDS,
		threats.map((t) => THREAT_KINDS.indexOf(t.kind))
	);
	tally('resource', RESOURCE_KINDS, []);
	counts.poi = pois.length;
	counts.planting = level.planting.filter((p) => p.mission === 1).length;
	counts.camera = 0;
	counts.animal = Object.keys(ANIMALS).length;
	const quadrants = new Int32Array(TREE_SPECIES.length * 4);
	for (let k = 0; k < treeKinds.length; k++) {
		const bx = treeBlocks[k] % 4;
		const bz = (treeBlocks[k] - bx) / 4;
		quadrants[treeKinds[k] * 4 + (bz >> 1) * 2 + (bx >> 1)]++;
	}
	TREE_SPECIES.forEach((species, s) => {
		counts[`treeQuadrantMax:${species}`] = Math.max(
			quadrants[s * 4],
			quadrants[s * 4 + 1],
			quadrants[s * 4 + 2],
			quadrants[s * 4 + 3]
		);
	});
	counts.instances = treeKinds.length + rockKinds.length + decoKinds.length;
	for (const kind of ['jucara-fruit', 'trash', 'gold-leaf'])
		counts[`collectible:${kind}`] = level.collectibles.filter((c) => c.kind === kind).length;
	counts.checkpoint = level.checkpoints.length + 1;
	counts['obby:stone'] = level.obbies[0].pieces.length;
	counts['obby:ledge'] = level.obbies[1].pieces.length;
	return counts;
}
