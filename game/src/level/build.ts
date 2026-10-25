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
	ANIMALS,
	BASE,
	BRIDGE_HALF_WIDTH,
	BUTTERFLIES,
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
	FACING,
	type Facing,
	FENCE_MARGIN,
	FOREST,
	FRUITS,
	KILL_Y,
	LANE_CLEARANCE,
	LEDGES,
	LOGGER_RADIUS,
	MIRANTE_RADIUS,
	MIRANTE_TOP,
	MURIQUI_HANDHOLDS,
	MURIQUI_ROW,
	OBSERVATION_ROCK,
	ONCA_RADIUS,
	PASTURE,
	PLACES,
	PLANTING_RADIUS,
	PLATEAU,
	POOL,
	RELIEF,
	RIVER,
	RIVER_BANK_SLOPE,
	RIVER_DEPTH,
	RIVER_HALF_WIDTH,
	RIVER_SURFACE,
	RIVER_TOP_INDEX,
	ROCK_SPACING,
	SERRA,
	SPAWN,
	STONES,
	STORY_SEED,
	STORY_VERSION,
	TRAIL_CLEARANCE,
	TRAIL_HALF_WIDTH,
	TRAILS,
	TRAP_RADIUS,
	TRAPS,
	TRASH,
	TRASH_KINDS,
	TREE_SPACING_EDGE,
	TREE_SPACING_FOREST,
	TREE_SPACING_OPEN,
	WATERFALL,
	type XZ
} from './layout.ts';
import { cellOf, type JumpLink, stepsWithLinks } from './reach.ts';
import type {
	Collectible,
	Landmark,
	Mission,
	Obby,
	ObbyGap,
	ObbyTop,
	PlantingSpot,
	Pool,
	StoryBuild,
	StoryCheckpoint,
	StoryLevel,
	StoryWorld,
	Trail,
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

	// Relief, water, plateau, then the flat pads.
	const heights = new Float32Array(CELLS);
	const edge = new Float32Array(CELLS);
	const waterY = new Float32Array(CELLS);
	shapeRelief(heights);
	carveWater(heights, edge, waterY, river, stones.pool);
	raiseMassifs(heights);
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
	const [bcx, bcz] = BASE.centre;
	const baseY = heightAt(heights, bcx, bcz);
	flattenDisk(heights, bcx, bcz, baseY, BASE.radius, BASE.blend);
	for (const top of ledges.tops) top.bottom = groundUnder(heights, top) - 0.3;
	for (const top of stones.tops) top.bottom = stones.pool.water - RIVER_DEPTH;
	ledges.landing.y = heightAt(heights, ledges.landing.x, ledges.landing.z);

	// Zones and flags.
	const slope = slopeOf(heights);
	const zones = new Uint8Array(CELLS);
	const flags = new Uint8Array(CELLS);
	const clear = new Uint8Array(CELLS);
	for (let q = 0; q < CELLS; q++) {
		const i = q % N;
		const j = (q - i) / N;
		const isRiver = edge[q] < 0 && heights[q] < waterY[q];
		const onPlateau = insidePolygon(PLATEAU, i, j);
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
			i >= FENCE_MARGIN &&
			j >= FENCE_MARGIN &&
			i < N - FENCE_MARGIN &&
			j < N - FENCE_MARGIN
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
	const links: JumpLink[] = [
		{ from: padA, to: padB, length: stoneRun },
		{ from: padB, to: padA, length: stoneRun },
		{
			from: cellOf(ledges.pad.x, ledges.pad.z),
			to: cellOf(ledges.landing.x, ledges.landing.z),
			length: ledges.length
		}
	];
	const steps = stepsWithLinks(flags, walkH, spawnCell, links);
	const walkOnly = walkSteps(flags, walkH, spawnCell);
	for (const obby of [stones, ledges])
		for (const g of obby.gaps)
			if (g.gap > jumpReach(g.rise)) problems.push(`obby gap ${g.gap.toFixed(2)} beyond reach`);

	// Story places, then the ground they keep free of trees and rocks.
	const level = storyLevel(heights, stones, ledges, bridge);
	reserveGameplay(clear, level, stones, ledges);

	// Vegetation.
	const lanes = laneSegments(stones, ledges);
	const trails = level.trails.map((t) => t.points as XZ[]);
	const awayFromPaths = (x: number, z: number, r: number) =>
		trails.every((t) => polylineDistance(t, x, z) >= TRAIL_CLEARANCE + r) &&
		lanes.every(([a, b, w]) => polylineDistance([a, b], x, z) >= w + r);
	const trees = plantTrees(zones, flags, clear, slope, awayFromPaths);
	const rocks = placeRocks(zones, flags, clear, slope, edge, awayFromPaths);
	const decorations = coverGround(zones, flags, clear, slope, trails, lanes);
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
 * RIVER_DEPTH. The pool's distance is the ellipse's, scaled by its half width.
 */
function carveWater(
	heights: Float32Array,
	edge: Float32Array,
	waterY: Float32Array,
	river: River,
	pool: Pool
) {
	for (let q = 0; q < CELLS; q++) {
		const i = q % N;
		const j = (q - i) / N;
		const { d2, arc } = polylineNearest(RIVER, i, j);
		let e = Math.sqrt(d2) - RIVER_HALF_WIDTH;
		let water = river.waterAt(arc);
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
		for (const [polygon, top] of massifs)
			if (insidePolygon(polygon, i, j))
				heights[q] = Math.max(heights[q], top(i) + R.edgeRise * smoothstep(R.edgeWidth, 0, toEdge));
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
	if (top.piece === 'stone') return dx * dx + dz * dz <= r * r;
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

function storyLevel(heights: Float32Array, stones: Stones, ledges: Ledges, bridge: Crossing): StoryLevel {
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
		checkpoint('mirante', mirante, CHECKPOINT_FACING.mirante, 6)
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

	const targets: Point[] = [planting[2], hide, stones.padB, at(CLAREIRA.centre), at(TRAPS[0]), mirante];
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
			...m.target
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
	const waterfallTop = heightAt(heights, WATERFALL[0] + 3, WATERFALL[1] - 3);
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
			Math.max(0, waterfallTop - RIVER_SURFACE.topY)
		),
		landmark('mirante', 'mirante', mirante, HEADING.west, 'Mirante'),
		landmark('borboletas', 'butterflies', at(BUTTERFLIES, 1), [1, 0])
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
		checksum: 0
	};
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
		{ id: 'mirante', x: level.mirante.x, z: level.mirante.z, onObby: '' }
	];
}

/** Ground kept free of trees and rocks: the base, every target, the obby pads and the bridge ends. */
function reserveGameplay(clear: Uint8Array, level: StoryLevel, stones: Stones, ledges: Ledges) {
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
	for (const [x, z] of [PLACES.bridgeFrom, PLACES.bridgeTo]) paint(clear, x, z, 4, RESERVED);
}

/** Obby lanes as segments with a half width: no collider inside them. */
function laneSegments(stones: Stones, ledges: Ledges): [XZ, XZ, number][] {
	const lane = LANE_CLEARANCE;
	return [
		[[stones.padA.x, stones.padA.z], [stones.padB.x, stones.padB.z], STONES.zigzag + STONES.radius + lane],
		[[ledges.pad.x, ledges.pad.z], [ledges.landing.x, ledges.landing.z], LEDGES.size / 2 + lane]
	];
}

// --- Vegetation -----------------------------------------------------------------------

function plantTrees(
	zones: Uint8Array,
	flags: Uint8Array,
	clear: Uint8Array,
	slope: Float32Array,
	awayFromPaths: (x: number, z: number, r: number) => boolean
): Item[] {
	const rng = new Rng(subSeed(STORY_SEED, 2));
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

	const grow = (x: number, z: number, density: number) => {
		const q = cellOf(x, z);
		const f = flags[q];
		if (clear[q] !== 0 || slope[q] > GROW_SLOPE) return;
		if (f & (FLAG.river | FLAG.crossing | FLAG.base | FLAG.cleared)) return;
		if (!awayFromPaths(x, z, MAX_TRUNK_RADIUS)) return;
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
	const forestPoints = poissonDisk(rng, 1, 1, N - 2, N - 2, TREE_SPACING_FOREST);
	for (let k = 0; k < forestPoints.length; k += 2) {
		const x = forestPoints[k];
		const z = forestPoints[k + 1];
		if (flags[cellOf(x, z)] & FLAG.forest) grow(x, z, 1);
	}
	const openPoints = poissonDisk(rng, 1, 1, N - 2, N - 2, TREE_SPACING_OPEN);
	for (let k = 0; k < openPoints.length; k += 2) {
		const x = openPoints[k];
		const z = openPoints[k + 1];
		const q = cellOf(x, z);
		if (flags[q] & FLAG.forest) continue;
		grow(x, z, zones[q] === ZONE.highland ? HIGHLAND_DENSITY : OPEN_DENSITY);
	}
	const edgePoints = poissonDisk(rng, 1, 1, N - 2, N - 2, TREE_SPACING_EDGE);
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
	lanes: [XZ, XZ, number][]
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
