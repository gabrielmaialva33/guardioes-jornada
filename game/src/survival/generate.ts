/**
 * The survival map generator (research §3.2–3.4). Solvable by construction:
 * relief, river and zones first, then the reachability network (bridges, then
 * a BFS from the base over walkable steps), and only then everything the child
 * must reach (POIs, threat slots, the ecological corridor, camera-trap spots,
 * resources), placed on reachable cells only. Vegetation fills what is left.
 * A map that still misses something is rebuilt from a derived seed, up to
 * MAX_ATTEMPTS times; the last attempt relaxes the zone rules of the POIs.
 *
 * Pure data and deterministic across engines (rules in random.ts).
 */
import { checksumOf } from './checksum.ts';
import { clamp, fbm, floor, smoothstep } from './noise.ts';
import { poissonDisk } from './poisson.ts';
import { Rng, subSeed } from './random.ts';
import { classify, flatten, heightAt, type Relief, shapeRelief, slopes } from './terrain.ts';
import {
	ALBUM,
	type AnimalHome,
	BASE_PIECES,
	type BaseCamp,
	type BasePieceKind,
	BLOCK_SIZE,
	BLOCKS_PER_SIDE,
	type CameraSpot,
	COLLISION_STEP,
	type CollisionBlock,
	type Corridor,
	type Crossing,
	DECORATION_KINDS,
	FLAG,
	GENERATOR_VERSION,
	GRID,
	MAX_POI_STEPS,
	MIN_POI_STEPS,
	PLANT_GRID,
	PLANT_STEP,
	type PlantingCell,
	type Placements,
	type Poi,
	POI_KINDS,
	type Point,
	RESOURCE_KINDS,
	type ResourceNode,
	RESPONDER,
	ROCK_KINDS,
	type SurvivalWorld,
	THREAT_KINDS,
	THREAT_MIN_BASE_DISTANCE,
	type ThreatKind,
	type ThreatSlot,
	TREE_SPECIES,
	type TreeSpecies,
	WADE_LIMIT,
	WALK_SLOPE,
	WATER_LEVEL,
	WORLD_SIZE,
	ZONE,
	ZONES
} from './types.ts';

const N = GRID;
const CELLS = N * N;
/** Cells along the map edge kept out of reach: the park fence. */
const MARGIN = 2;
const MAX_ATTEMPTS = 6;
const BASE_PAD = 6;
const BASE_BLEND = 11;
const SLOTS_PER_KIND = 28;
const THREAT_SPACING: Record<ThreatKind, number> = { trash: 6, trap: 8, fire: 8, 'invasive-grass': 6 };
const MIN_FRAGMENT = 150;
/** Upstream of this column the canopy closes over the river, so it does not split the serra forest. */
const SERRA_COLUMN = floor(0.66 * WORLD_SIZE);
/** Highest rise of a diagonal step (run √2). */
const DIAGONAL_RISE = WALK_SLOPE * 1.41;
const MAX_CORRIDOR_STEPS = 60;
const CORRIDOR_EDGE = 8;
const MAX_PLANTING = 120;
const RESOURCES_PER_KIND = 6;
const TREE_SPACING = 3.8;
const ROCK_SPACING = 7;
const DECO_SPACING = 2.6;
const MIN_PLANTING = 16;
/** Steepest plantable pasture: hillside restoration is common, and it stays under WALK_SLOPE. */
const PLANT_SLOPE = 0.75;
/** Minimum counts of a valid map; the relaxed last attempt asks for less. */
const STRICT = { slots: 20, planting: MIN_PLANTING, camera: 8, poiZones: true, poiMaxSteps: MAX_POI_STEPS };
const RELAXED = { slots: 10, planting: 6, camera: 4, poiZones: false, poiMaxSteps: 2 * MAX_POI_STEPS };

/** Bits of the scratch `clear` mask: ground taken by gameplay, by a trunk or rock, near the corridor. */
const RESERVED = 1;
const OCCUPIED = 2;
const NEAR_CORRIDOR = 4;

const POI_ZONES: Partial<Record<(typeof POI_KINDS)[number], number[]>> = {
	lookout: [ZONE.highland],
	spring: [ZONE.slope],
	'mother-tree': [ZONE.lowland],
	'abandoned-camp': [ZONE.lowland, ZONE.slope],
	'mangrove-boardwalk': [ZONE.mangrove],
	'restinga-trail': [ZONE.restinga]
};

/** Relative species weights per zone (or pasture). Botanical fit awaits the review of research §8.7. */
const weightsOf = (mix: Partial<Record<TreeSpecies, number>>) => TREE_SPECIES.map((s) => mix[s] ?? 0);
const TREE_MIX = {
	mangrove: weightsOf({ 'mangue-vermelho': 1 }),
	restinga: weightsOf({ jeriva: 3, embauba: 1 }),
	lowland: weightsOf({
		jequitiba: 2,
		'pau-brasil': 2,
		'ipe-amarelo': 2,
		'ipe-rosa': 1,
		jucara: 2,
		embauba: 1
	}),
	slope: weightsOf({ jucara: 3, xaxim: 2, jequitiba: 1, 'ipe-amarelo': 1, embauba: 1, araucaria: 1 }),
	highland: weightsOf({ araucaria: 3, xaxim: 1 }),
	pasture: weightsOf({ embauba: 1 })
};
/** Share of Poisson points that grow a tree. */
const TREE_DENSITY = {
	mangrove: 0.55,
	restinga: 0.4,
	lowland: 0.9,
	slope: 0.75,
	highland: 0.1,
	pasture: 0.04
};
/** Trunk collider radius per species at scale 1; the canopy never collides. */
const TRUNK_RADIUS: Record<TreeSpecies, number> = {
	'pau-brasil': 0.3,
	'ipe-amarelo': 0.3,
	'ipe-rosa': 0.3,
	jequitiba: 0.45,
	jucara: 0.15,
	embauba: 0.22,
	xaxim: 0.25,
	araucaria: 0.3,
	'mangue-vermelho': 0.3,
	jeriva: 0.2
};
const TRUNK_HEIGHT = 3.5;
/** Canopy top over forest ground, for the lookout's line of sight. */
const CANOPY = 6;
/** Ground cover per zone, weights over DECORATION_KINDS (grass, flower, bush, fern, bromelia, beach-grass). */
const DECO_MIX: Record<string, number[]> = {
	beach: [0, 0, 0, 0, 0, 1],
	restinga: [1, 0, 2, 0, 2, 0],
	lowland: [0, 1, 2, 2, 1, 0],
	slope: [0, 0, 1, 3, 2, 0],
	highland: [3, 2, 0, 0, 0, 0],
	pasture: [3, 1, 0, 0, 0, 0]
};
/** Share of Poisson points that hold a rock, per zone index (sea … river). */
const ROCK_WEIGHT = [0, 0.25, 0, 0.15, 0.15, 0.45, 0.6, 0];
/** Base camp layout in the camp's local frame (x right, z front). */
const BASE_LAYOUT: [BasePieceKind, number, number][] = [
	['tent', -3.5, 2],
	['bedroll', -3.5, 2.4],
	['workbench', 2.5, -2],
	['nursery', 3.5, 2.5],
	['water-tank', -3, -2.5],
	['supply-box', 0.5, -3.5],
	['radio-mast', 0, 4],
	['signpost', 0, -5.5]
];

interface Item {
	kind: number;
	x: number;
	z: number;
	scale: number;
	yawC: number;
	yawS: number;
}

const cellOf = (x: number, z: number) => floor(z + 0.5) * N + floor(x + 0.5);
const columnOf = (q: number) => q % N;
const rowOf = (q: number) => (q - (q % N)) / N;
const insideBy = (i: number, j: number, m: number) => i >= m && j >= m && i < N - m && j < N - m;
const inside = (i: number, j: number) => insideBy(i, j, MARGIN);

/** Generates the map for a seed: same seed and GENERATOR_VERSION, same map, on every engine. */
export function generateWorld(seed: number): SurvivalWorld {
	const requested = seed >>> 0;
	for (let attempt = 1; ; attempt++) {
		const worldSeed = attempt === 1 ? requested : subSeed(requested, 0x100 + attempt);
		const draft = build(worldSeed, attempt === MAX_ATTEMPTS);
		if (draft.problems.length > 0 && attempt < MAX_ATTEMPTS) continue;
		const world: SurvivalWorld = {
			generatorVersion: GENERATOR_VERSION,
			seed: requested,
			attempt,
			worldSeed,
			...draft,
			checksum: 0
		};
		world.checksum = checksumOf(world);
		return world;
	}
}

function build(seed: number, relaxed: boolean) {
	const rules = relaxed ? RELAXED : STRICT;
	const relief = shapeRelief(seed);
	const { heights, riverDist, river } = relief;

	// Base camp on flat lowland away from the river, then a flat pad for its pieces.
	const baseRng = new Rng(subSeed(seed, 4));
	const baseQ = pickBase(baseRng, relief);
	const bx = columnOf(baseQ);
	const bz = rowOf(baseQ);
	const by = heights[baseQ];
	flatten(heights, bx, bz, by, BASE_PAD, BASE_BLEND);
	const slope = slopes(heights);
	const { zones, highlandHeight } = classify(relief, slope);

	const flags = new Uint8Array(CELLS);
	const clear = new Uint8Array(CELLS);
	for (let q = 0; q < CELLS; q++) {
		const i = columnOf(q);
		const j = rowOf(q);
		if (zones[q] === ZONE.river) flags[q] |= FLAG.river;
		else if (inside(i, j) && heights[q] > WADE_LIMIT) flags[q] |= FLAG.walkable;
		if ((i - bx) * (i - bx) + (j - bz) * (j - bz) < BASE_PAD * BASE_PAD) flags[q] |= FLAG.base;
	}
	paint(clear, bx, bz, BASE_BLEND, RESERVED);

	// Crossings before reachability: three bridges count, the stepping stones are an optional obby.
	const walkH = Float32Array.from(heights);
	const stoneRng = new Rng(subSeed(seed, 14));
	const crossings = (
		[
			['rope-bridge', 2],
			['bridge', 4],
			['stepping-stones', 5],
			['bridge', 6]
		] as const
	).map(([kind, k]) => makeCrossing(kind, k, relief, stoneRng, flags, walkH, clear));
	const steps = walkSteps(flags, walkH, baseQ);
	const reach = (x: number, z: number) => steps[cellOf(x, z)];

	// Pasture and forest fragments, then the corridor that should join them. About 25% of the
	// lowland is pasture, 20% of the restinga, and a belt at the foot of the serra (u 0.52 to 0.58,
	// fading out to 0.47 and 0.62) is all pasture: it cuts the lowland forest off the serra forest,
	// the gap the corridor closes.
	const fragSeed = subSeed(seed, 5);
	for (let j = MARGIN; j < N - MARGIN; j++)
		for (let i = MARGIN; i < N - MARGIN; i++) {
			const q = j * N + i;
			const zone = zones[q];
			if (zone !== ZONE.restinga && zone !== ZONE.lowland && zone !== ZONE.slope) continue;
			const u = i / WORLD_SIZE;
			const n = fbm(i * 0.035, j * 0.035, fragSeed, 2);
			const belt = smoothstep(0.47, 0.52, u) * (1 - smoothstep(0.58, 0.62, u));
			const pasture =
				(flags[q] & FLAG.base) !== 0 ||
				(zone === ZONE.restinga && n < -0.3) ||
				((zone === ZONE.lowland || (zone === ZONE.slope && u < 0.62)) && n < -0.25 + 1.3 * belt);
			flags[q] |= pasture ? FLAG.cleared : FLAG.forest;
		}
	const corridor = planCorridor(flags, steps, slope, heights, clear);

	// POIs: best-candidate among reachable cells of their zone, spread out from the base and each other.
	const poiRng = new Rng(subSeed(seed, 6));
	const pois: Poi[] = [];
	const spread: [number, number][] = [[bx, bz]];
	for (const kind of POI_KINDS) {
		let x: number;
		let z: number;
		let y: number;
		let yaw: [number, number];
		if (kind === 'rope-bridge' || kind === 'stepping-stones') {
			const crossing = crossings[kind === 'rope-bridge' ? 0 : 2];
			const { from, to } = crossing;
			x = (from.x + to.x) / 2;
			z = (from.z + to.z) / 2;
			y = kind === 'rope-bridge' ? (from.y + to.y) / 2 : crossing.water;
			yaw = headingTo(from.x, from.z, to.x, to.z);
		} else {
			const allowed = POI_ZONES[kind] ?? [];
			const needsForest = kind === 'mother-tree' || kind === 'abandoned-camp';
			const q = bestCandidate(poiRng, spread, 10, (q) => {
				const s = steps[q];
				if (s < MIN_POI_STEPS || s > rules.poiMaxSteps || clear[q] !== 0) return false;
				if (!rules.poiZones) return zones[q] !== ZONE.sea && zones[q] !== ZONE.beach;
				if (kind === 'spring' && columnOf(q) < 0.6 * WORLD_SIZE) return false;
				return allowed.includes(zones[q]) && (!needsForest || (flags[q] & FLAG.forest) !== 0);
			});
			if (q < 0) continue;
			x = columnOf(q);
			z = rowOf(q);
			y = heights[q];
			yaw = poiRng.heading();
		}
		const q = cellOf(x, z);
		const s =
			kind === 'stepping-stones' || kind === 'rope-bridge' ? crossingSteps(crossings, kind, steps) : steps[q];
		pois.push({
			id: pois.length,
			kind,
			zone: ZONES[zones[q]],
			steps: s,
			x,
			y,
			z,
			yawC: yaw[0],
			yawS: yaw[1]
		});
		spread.push([x, z]);
		paint(clear, x, z, 5, RESERVED);
	}
	const lookout = pois.find((p) => p.kind === 'lookout');

	// Threat slots: Poisson per kind, weighted by zone, within the walking window, away from the base.
	const threatRng = new Rng(subSeed(seed, 7));
	const threats: ThreatSlot[] = [];
	for (const kind of THREAT_KINDS) {
		const points = poissonDisk(
			threatRng,
			MARGIN,
			MARGIN,
			N - 1 - MARGIN,
			N - 1 - MARGIN,
			THREAT_SPACING[kind]
		);
		const pool: number[] = [];
		for (let k = 0; k < points.length; k += 2) {
			const x = points[k];
			const z = points[k + 1];
			const q = cellOf(x, z);
			const s = steps[q];
			if (s < 0 || s > MAX_POI_STEPS || clear[q] & RESERVED || flags[q] & (FLAG.crossing | FLAG.base))
				continue;
			const dx = x - bx;
			const dz = z - bz;
			if (dx * dx + dz * dz < THREAT_MIN_BASE_DISTANCE * THREAT_MIN_BASE_DISTANCE) continue;
			if (threatRng.next() < threatWeight(kind, zones[q], flags[q], clear[q], riverDist[q])) pool.push(k);
		}
		// A random subset, so the sampler's growth order never shows.
		const take = Math.min(SLOTS_PER_KIND, pool.length);
		for (let n = 0; n < take; n++) {
			const pick = n + threatRng.int(pool.length - n);
			const k = pool[pick];
			pool[pick] = pool[n];
			const x = points[k];
			const z = points[k + 1];
			const q = cellOf(x, z);
			const y = heightAt(heights, x, z);
			const [yawC, yawS] = threatRng.heading();
			const seen = lookout !== undefined && lineOfSight(heights, flags, lookout, x, y + (kind === 'fire' ? 10 : 1), z);
			threats.push({
				id: threats.length,
				kind,
				responder: RESPONDER[kind],
				zone: ZONES[zones[q]],
				steps: steps[q],
				seenFromLookout: seen,
				x,
				y,
				z,
				yawC,
				yawS
			});
			paint(clear, x, z, 2.5, RESERVED);
		}
	}

	// Album animals: one home per species in its zone, and a camera-trap spot by a clue facing it.
	const animalRng = new Rng(subSeed(seed, 8));
	const animals: AnimalHome[] = [];
	const cameraSpots: CameraSpot[] = [];
	const homes: [number, number][] = [[bx, bz]];
	for (const entry of ALBUM) {
		const zone = ZONE[entry.zone];
		const needsForest = zone === ZONE.lowland || zone === ZONE.slope;
		const home = bestCandidate(animalRng, homes, 6, (q) => {
			const s = steps[q];
			return (
				zones[q] === zone &&
				s >= 15 &&
				s <= MAX_POI_STEPS &&
				(clear[q] & RESERVED) === 0 &&
				(!needsForest || (flags[q] & FLAG.forest) !== 0)
			);
		});
		if (home < 0) continue;
		const hx = columnOf(home);
		const hz = rowOf(home);
		const spot = pickNear(animalRng, hx, hz, 4, 9, 60, (q) => {
			return steps[q] >= 0 && (clear[q] & RESERVED) === 0 && (flags[q] & (FLAG.crossing | FLAG.base)) === 0;
		});
		if (spot < 0) continue;
		const sx = columnOf(spot);
		const sz = rowOf(spot);
		const [yawC, yawS] = headingTo(sx, sz, hx, hz);
		animals.push({
			id: animals.length,
			species: entry.species,
			zone: entry.zone,
			radius: 6,
			x: hx,
			y: heights[home],
			z: hz
		});
		cameraSpots.push({
			id: cameraSpots.length,
			species: entry.species,
			clue: entry.clue,
			zone: ZONES[zones[spot]],
			steps: steps[spot],
			x: sx,
			y: heights[spot],
			z: sz,
			yawC,
			yawS
		});
		homes.push([hx, hz]);
		paint(clear, sx, sz, 2, RESERVED);
	}

	// Resources: man-made only. Crates along the trails, reclaimed wood from old pasture fences.
	const resourceRng = new Rng(subSeed(seed, 9));
	const resources: ResourceNode[] = [];
	const depots: [number, number][] = [[bx, bz]];
	for (const kind of RESOURCE_KINDS)
		for (let n = 0; n < RESOURCES_PER_KIND; n++) {
			const q = bestCandidate(resourceRng, depots, 5, (q) => {
				const s = steps[q];
				if (s < 20 || s > 100 || clear[q] !== 0 || flags[q] & (FLAG.crossing | FLAG.base)) return false;
				return kind === 'reclaimed-wood' ? (flags[q] & FLAG.cleared) !== 0 : zones[q] !== ZONE.sea;
			});
			if (q < 0) break;
			const [yawC, yawS] = resourceRng.heading();
			const x = columnOf(q);
			const z = rowOf(q);
			resources.push({ id: resources.length, kind, steps: steps[q], x, y: heights[q], z, yawC, yawS });
			depots.push([x, z]);
			paint(clear, x, z, 2, RESERVED);
		}

	// Vegetation: Poisson-disk trees thinned by zone density, rocks, then a jittered grid of ground cover.
	const treeRng = new Rng(subSeed(seed, 10));
	const trees: Item[] = [];
	for (const poi of pois)
		if (poi.kind === 'mother-tree') {
			trees.push({
				kind: TREE_SPECIES.indexOf('jequitiba'),
				x: poi.x,
				z: poi.z,
				scale: 2.2,
				yawC: poi.yawC,
				yawS: poi.yawS
			});
			paint(clear, poi.x, poi.z, 2.5, OCCUPIED);
		}
	const treePoints = poissonDisk(treeRng, 1, 1, N - 2, N - 2, TREE_SPACING);
	for (let k = 0; k < treePoints.length; k += 2) {
		const x = treePoints[k];
		const z = treePoints[k + 1];
		const q = cellOf(x, z);
		const key = vegetationKey(zones[q], flags[q]);
		if (key === null || key === 'beach' || clear[q] !== 0 || slope[q] > 1.3) continue;
		if (treeRng.next() >= TREE_DENSITY[key]) continue;
		const kind = treeRng.weighted(TREE_MIX[key]);
		const scale = treeRng.range(0.8, 1.3);
		const [yawC, yawS] = treeRng.heading();
		trees.push({ kind, x, z, scale, yawC, yawS });
		paint(clear, x, z, 1.2, OCCUPIED);
	}

	const rockRng = new Rng(subSeed(seed, 11));
	const rocks: Item[] = [];
	const rockPoints = poissonDisk(rockRng, 1, 1, N - 2, N - 2, ROCK_SPACING);
	for (let k = 0; k < rockPoints.length; k += 2) {
		const x = rockPoints[k];
		const z = rockPoints[k + 1];
		const q = cellOf(x, z);
		if (clear[q] !== 0 || flags[q] & (FLAG.river | FLAG.crossing | FLAG.base) || heights[q] < WATER_LEVEL)
			continue;
		const weight = riverDist[q] < 9 ? 0.6 : ROCK_WEIGHT[zones[q]];
		if (rockRng.next() >= weight) continue;
		const forest = (flags[q] & FLAG.forest) !== 0;
		const kind = rockRng.weighted(forest ? [0.35, 0.4, 0.25] : [0.45, 0.55, 0]);
		const scale =
			kind === 0 ? rockRng.range(0.7, 1.5) : kind === 1 ? rockRng.range(0.5, 1) : rockRng.range(0.8, 1.3);
		const [yawC, yawS] = rockRng.heading();
		rocks.push({ kind, x, z, scale, yawC, yawS });
		paint(clear, x, z, 1.5, OCCUPIED);
	}

	const decoRng = new Rng(subSeed(seed, 12));
	const decorations: Item[] = [];
	const decoCells = floor(WORLD_SIZE / DECO_SPACING);
	for (let gz = 0; gz < decoCells; gz++)
		for (let gx = 0; gx < decoCells; gx++) {
			const x = (gx + 0.15 + 0.7 * decoRng.next()) * DECO_SPACING;
			const z = (gz + 0.15 + 0.7 * decoRng.next()) * DECO_SPACING;
			const q = cellOf(x, z);
			const key = vegetationKey(zones[q], flags[q]);
			if (key === null || key === 'mangrove' || clear[q] !== 0 || flags[q] & (FLAG.crossing | FLAG.base))
				continue;
			const kind = decoRng.weighted(DECO_MIX[key]);
			const scale = decoRng.range(0.6, 1.3);
			const [yawC, yawS] = decoRng.heading();
			decorations.push({ kind, x, z, scale, yawC, yawS });
		}

	const base = baseCamp(baseRng, heights, bx, bz, by);
	const treeSet = pack(TREE_SPECIES, trees, heights);
	const rockSet = pack(ROCK_KINDS, rocks, heights);
	const decoSet = pack(DECORATION_KINDS, decorations, heights);

	// Checks: everything required exists and is reachable from the base.
	const problems: string[] = [];
	for (const kind of POI_KINDS) if (!pois.some((p) => p.kind === kind)) problems.push(`poi ${kind} missing`);
	for (const poi of pois) if (poi.steps < 0) problems.push(`poi ${poi.kind} unreachable`);
	for (const c of crossings)
		if (reach(c.from.x, c.from.z) < 0 || reach(c.to.x, c.to.z) < 0)
			problems.push(`${c.kind} bank unreachable`);
	for (const kind of THREAT_KINDS)
		if (threats.filter((t) => t.kind === kind).length < rules.slots) problems.push(`too few ${kind} slots`);
	if (corridor.cells.length < rules.planting) problems.push('corridor too short');
	if (cameraSpots.length < rules.camera) problems.push('too few camera spots');
	for (const item of [...threats, ...corridor.cells, ...cameraSpots, ...resources])
		if (item.steps < 0) problems.push('objective unreachable');

	return {
		problems,
		size: WORLD_SIZE,
		grid: N,
		waterLevel: WATER_LEVEL,
		heights,
		zones,
		flags,
		baseSteps: steps,
		highlandHeight,
		river,
		crossings,
		base,
		pois,
		threats,
		corridor,
		animals,
		cameraSpots,
		resources,
		trees: treeSet,
		rocks: rockSet,
		decorations: decoSet,
		blocks: collisionBlocks(heights, treeSet, rockSet, crossings),
		counts: countAll(treeSet, rockSet, decoSet, pois, threats, corridor, cameraSpots, resources)
	};
}

function pickBase(rng: Rng, relief: Relief): number {
	const { heights, riverDist } = relief;
	let fallback = 80 * N + 64;
	let found = false;
	for (let t = 0; t < 2000; t++) {
		// Middle of the map: lowland or the pasture belt (u 0.4 to 0.575), central rows.
		const i = 64 + rng.int(29);
		const j = 50 + rng.int(61);
		const q = j * N + i;
		const h = heights[q];
		if (h < WATER_LEVEL + 0.8 || riverDist[q] < 16) continue;
		if (!found) {
			fallback = q;
			found = true;
		}
		const flat =
			Math.abs(heights[q - 5] - h) < 1 &&
			Math.abs(heights[q + 5] - h) < 1 &&
			Math.abs(heights[q - 5 * N] - h) < 1 &&
			Math.abs(heights[q + 5 * N] - h) < 1;
		if (flat) return q;
	}
	return fallback;
}

/**
 * A crossing across river segment k, at its middle. Bridges mark their deck
 * cells walkable at the deck height; the deck runs straight between banks at
 * least half a unit above the water, lengthened until both ends are dry.
 */
function makeCrossing(
	kind: Crossing['kind'],
	k: number,
	relief: Relief,
	rng: Rng,
	flags: Uint8Array,
	walkH: Float32Array,
	clear: Uint8Array
): Crossing {
	const { heights, river } = relief;
	const a = river.points[k];
	const b = river.points[k + 1];
	const dx = b.x - a.x;
	const dz = b.z - a.z;
	const len = Math.sqrt(dx * dx + dz * dz);
	// u along the flow, p across it.
	const ux = dx / len;
	const uz = dz / len;
	const px = -uz;
	const pz = ux;
	const mx = (a.x + b.x) / 2;
	const mz = (a.z + b.z) / 2;
	const water = (a.water + b.water) / 2;
	const end = (side: number): Point => {
		let half = river.halfWidth + 2.5;
		while (
			half < river.halfWidth + 8 &&
			heightAt(heights, mx + side * px * half, mz + side * pz * half) < water + 0.5
		)
			half += 0.5;
		const x = mx + side * px * half;
		const z = mz + side * pz * half;
		return { x, y: heightAt(heights, x, z), z };
	};
	const from = end(-1);
	const to = end(1);
	const stones: Crossing['stones'] = [];
	const halfWidth = kind === 'stepping-stones' ? 0.6 : 1.5;
	if (kind === 'stepping-stones') {
		const gap = 2.2;
		const count = floor((2 * (river.halfWidth - 0.8)) / gap) + 1;
		for (let n = 0; n < count; n++) {
			const s = (n - (count - 1) / 2) * gap;
			const w = rng.range(-0.3, 0.3);
			stones.push({
				x: mx + px * s + ux * w,
				y: water + 0.35,
				z: mz + pz * s + uz * w,
				r: rng.range(0.5, 0.65)
			});
		}
	}
	// Deck cells: projected on the deck axis, within its half width.
	const sx = to.x - from.x;
	const sz = to.z - from.z;
	const span2 = sx * sx + sz * sz;
	const i0 = floor(Math.min(from.x, to.x) - 2);
	const j0 = floor(Math.min(from.z, to.z) - 2);
	for (let j = j0; j <= floor(Math.max(from.z, to.z) + 3); j++)
		for (let i = i0; i <= floor(Math.max(from.x, to.x) + 3); i++) {
			const t = ((i - from.x) * sx + (j - from.z) * sz) / span2;
			const lateral = (i - mx) * ux + (j - mz) * uz;
			if (t < 0 || t > 1 || lateral > 2.5 || lateral < -2.5) continue;
			const q = j * N + i;
			clear[q] |= RESERVED;
			if (kind === 'stepping-stones' || lateral > halfWidth || lateral < -halfWidth) continue;
			walkH[q] = from.y + (to.y - from.y) * t;
			flags[q] |= FLAG.walkable | FLAG.crossing;
		}
	return { kind, from, to, halfWidth, water, stones };
}

/**
 * Walking distance from the start in units (−1 where unreachable): Dijkstra
 * over walkable cells and their 8 neighbours, with integer costs of 2 per
 * straight step and 3 per diagonal (≈ 2√2) in half units, on a 4-bucket queue.
 * A step rises at most WALK_SLOPE per unit of run; diagonals never cut a corner.
 * Walkable cells stay MARGIN cells inside the map, so neighbours never wrap.
 */
function walkSteps(flags: Uint8Array, walkH: Float32Array, start: number): Int16Array {
	const far = 0x7fffffff;
	const half = new Int32Array(CELLS).fill(far);
	const buckets: number[][] = [[], [], [], []];
	const walkable = (q: number) => (flags[q] & FLAG.walkable) !== 0;
	half[start] = 0;
	buckets[0].push(start);
	let pending = 1;
	for (let d = 0; pending > 0; d++) {
		// Costs 2 and 3 never land in the bucket being read.
		const bucket = buckets[d & 3];
		for (let k = 0; k < bucket.length; k++) {
			const q = bucket[k];
			if (half[q] !== d) continue;
			const h = walkH[q];
			for (let dz = -1; dz <= 1; dz++)
				for (let dx = -1; dx <= 1; dx++) {
					const n = q + dz * N + dx;
					const diagonal = dx !== 0 && dz !== 0;
					if (n === q || !walkable(n) || (diagonal && !(walkable(q + dx) && walkable(q + dz * N)))) continue;
					if (Math.abs(walkH[n] - h) > (diagonal ? DIAGONAL_RISE : WALK_SLOPE)) continue;
					const next = d + (diagonal ? 3 : 2);
					if (next < half[n]) {
						half[n] = next;
						buckets[next & 3].push(n);
						pending++;
					}
				}
		}
		pending -= bucket.length;
		bucket.length = 0;
	}
	const steps = new Int16Array(CELLS);
	for (let q = 0; q < CELLS; q++) steps[q] = half[q] === far ? -1 : (half[q] + 1) >> 1;
	return steps;
}

/**
 * Labels forest fragments, then finds the shortest land gaps from the largest
 * one to every other fragment of at least MIN_FRAGMENT cells within
 * MAX_CORRIDOR_STEPS, and keeps the gap to the largest of those. The pasture
 * cells along it become the 2 u planting cells of the corridor.
 */
function planCorridor(
	flags: Uint8Array,
	steps: Int16Array,
	slope: Float32Array,
	heights: Float32Array,
	clear: Uint8Array
): Corridor {
	const empty: Corridor = { cells: [], length: 0, fromSize: 0, toSize: 0, joinsTwoLargest: false };
	const label = new Int32Array(CELLS).fill(-1);
	const sizes: number[] = [];
	const queue = new Int32Array(CELLS);
	const around = (q: number) => [q + 1, q - 1, q + N, q - N];
	const joinsForest = (q: number) => {
		if (flags[q] & FLAG.forest) return true;
		const i = columnOf(q);
		return (flags[q] & FLAG.river) !== 0 && i >= SERRA_COLUMN && i < N - MARGIN && rowOf(q) >= MARGIN && rowOf(q) < N - MARGIN;
	};
	for (let start = 0; start < CELLS; start++) {
		if (label[start] >= 0 || (flags[start] & FLAG.forest) === 0) continue;
		const id = sizes.length;
		let head = 0;
		let tail = 0;
		label[start] = id;
		queue[tail++] = start;
		while (head < tail)
			for (const n of around(queue[head++]))
				if (label[n] < 0 && joinsForest(n)) {
					label[n] = id;
					queue[tail++] = n;
				}
		sizes.push(tail);
	}
	let largest = -1;
	let second = -1;
	for (let id = 0; id < sizes.length; id++) {
		if (largest < 0 || sizes[id] > sizes[largest]) {
			second = largest;
			largest = id;
		} else if (second < 0 || sizes[id] > sizes[second]) second = id;
	}
	if (largest < 0) return empty;

	// Multi-source BFS from the largest fragment over land, never water or decks.
	const parent = new Int32Array(CELLS).fill(-2);
	const depth = new Int16Array(CELLS);
	let head = 0;
	let tail = 0;
	for (let q = 0; q < CELLS; q++)
		if (label[q] === largest) {
			parent[q] = -1;
			queue[tail++] = q;
		}
	// First cell reached in each big fragment; small fragments are walked through (stepping stones).
	const hits = new Map<number, number>();
	while (head < tail) {
		const q = queue[head++];
		const l = label[q];
		if (l >= 0 && l !== largest && sizes[l] >= MIN_FRAGMENT) {
			if (!hits.has(l)) hits.set(l, q);
			continue;
		}
		if (depth[q] >= MAX_CORRIDOR_STEPS) continue;
		for (const n of around(q)) {
			if (parent[n] !== -2 || (flags[n] & (FLAG.forest | FLAG.cleared)) === 0 || flags[n] & FLAG.crossing)
				continue;
			// Corridors stay off the park fence.
			if (!insideBy(columnOf(n), rowOf(n), CORRIDOR_EDGE)) continue;
			parent[n] = q;
			depth[n] = depth[q] + 1;
			queue[tail++] = n;
		}
	}
	let target = -1;
	for (const l of hits.keys()) if (target < 0 || sizes[l] > sizes[target]) target = l;
	if (target < 0) return empty;
	const end = hits.get(target) ?? -1;
	const path: number[] = [];
	for (let q = parent[end]; q >= 0 && label[q] !== largest; q = parent[q]) path.push(q);
	path.reverse();
	for (const q of path) flags[q] |= FLAG.corridor;

	// Planting cells: 2 u cells around the path, in path order, on reachable flat pasture.
	// A short gap gets a wider band, so every corridor has enough cells to plant.
	let cells: PlantingCell[] = [];
	for (let radius = 2; radius <= 4 && cells.length < MIN_PLANTING; radius++) {
		const seen = new Uint8Array(PLANT_GRID * PLANT_GRID);
		cells = [];
		for (const q of path) {
			const i = columnOf(q);
			const j = rowOf(q);
			for (let dj = -radius; dj <= radius; dj++)
				for (let di = -radius; di <= radius; di++) {
					const gx = clamp(floor((i + di) / PLANT_STEP), 0, PLANT_GRID - 1);
					const gz = clamp(floor((j + dj) / PLANT_STEP), 0, PLANT_GRID - 1);
					const cell = gz * PLANT_GRID + gx;
					if (seen[cell] || cells.length >= MAX_PLANTING) continue;
					seen[cell] = 1;
					const x = gx * PLANT_STEP + 1;
					const z = gz * PLANT_STEP + 1;
					const c = z * N + x;
					const f = flags[c];
					if ((f & FLAG.cleared) === 0 || (f & FLAG.walkable) === 0 || f & (FLAG.base | FLAG.crossing))
						continue;
					if (steps[c] < 0 || slope[c] > PLANT_SLOPE) continue;
					cells.push({ cell, steps: steps[c], x, y: heights[c], z });
				}
		}
	}
	for (const cell of cells) {
		paint(clear, cell.x, cell.z, 1.5, RESERVED);
		paint(clear, cell.x, cell.z, 10, NEAR_CORRIDOR);
	}
	return {
		cells,
		length: path.length,
		fromSize: sizes[largest],
		toSize: sizes[target],
		joinsTwoLargest: target === second
	};
}

function threatWeight(
	kind: ThreatKind,
	zone: number,
	flags: number,
	clear: number,
	riverDist: number
): number {
	const pasture = (flags & FLAG.cleared) !== 0;
	switch (kind) {
		case 'trash':
			if (riverDist < 10 && zone !== ZONE.highland) return 1;
			return [0, 1, 0.8, 0.6, 0.25, 0.1, 0.1, 0][zone] + (pasture ? 0.2 : 0);
		case 'trap':
			if ((flags & FLAG.forest) === 0) return 0;
			return zone === ZONE.slope ? 1 : zone === ZONE.lowland ? 0.8 : 0.3;
		case 'fire':
			// Highland grassland and pasture edges burn most (research §4.5).
			if (zone === ZONE.highland) return 1;
			if (pasture) return 0.6;
			return zone === ZONE.slope ? 0.35 : zone === ZONE.restinga ? 0.2 : zone === ZONE.lowland ? 0.1 : 0;
		case 'invasive-grass':
			if (pasture) return clear & NEAR_CORRIDOR ? 1 : 0.6;
			return zone === ZONE.highland || zone === ZONE.restinga ? 0.25 : 0;
	}
}

/** Which vegetation table a cell uses, or null where nothing grows. */
function vegetationKey(zone: number, flags: number) {
	if (flags & (FLAG.river | FLAG.crossing)) return null;
	if (flags & FLAG.cleared) return 'pasture';
	switch (zone) {
		case ZONE.beach:
			return 'beach';
		case ZONE.mangrove:
			return 'mangrove';
		case ZONE.restinga:
			return 'restinga';
		case ZONE.lowland:
			return 'lowland';
		case ZONE.slope:
			return 'slope';
		case ZONE.highland:
			return 'highland';
		default:
			return null;
	}
}

function baseCamp(rng: Rng, heights: Float32Array, x: number, z: number, y: number): BaseCamp {
	const [yawC, yawS] = rng.heading();
	const pieces = BASE_LAYOUT.map(([kind, lx, lz]) => {
		const px = x + lx * yawC + lz * yawS;
		const pz = z - lx * yawS + lz * yawC;
		return { kind, x: px, y: heightAt(heights, px, pz), z: pz, yawC, yawS };
	});
	return { x, y, z, yawC, yawS, radius: BASE_PAD, spawn: { x, y, z }, pieces };
}

/** Marks every cell within r of (x, z) with `bit`. */
function paint(clear: Uint8Array, x: number, z: number, r: number, bit: number) {
	const r2 = r * r;
	for (let j = Math.max(0, floor(z - r)); j <= Math.min(N - 1, floor(z + r) + 1); j++)
		for (let i = Math.max(0, floor(x - r)); i <= Math.min(N - 1, floor(x + r) + 1); i++)
			if ((i - x) * (i - x) + (j - z) * (j - z) <= r2) clear[j * N + i] |= bit;
}

/** Of `candidates` random cells passing `ok`, the one farthest from every point in `from`. */
function bestCandidate(
	rng: Rng,
	from: [number, number][],
	candidates: number,
	ok: (q: number) => boolean
): number {
	let best = -1;
	let bestD = -1;
	for (let c = 0; c < candidates; c++) {
		let q = -1;
		for (let t = 0; t < 300 && q < 0; t++) {
			const i = MARGIN + rng.int(N - 2 * MARGIN);
			const j = MARGIN + rng.int(N - 2 * MARGIN);
			if (ok(j * N + i)) q = j * N + i;
		}
		if (q < 0) break;
		let dmin = Number.POSITIVE_INFINITY;
		for (const [x, z] of from) {
			const dx = columnOf(q) - x;
			const dz = rowOf(q) - z;
			dmin = Math.min(dmin, dx * dx + dz * dz);
		}
		if (dmin > bestD) {
			bestD = dmin;
			best = q;
		}
	}
	return best;
}

/** A cell at a distance in [rMin, rMax] from (x, z) passing `ok`, or −1. */
function pickNear(
	rng: Rng,
	x: number,
	z: number,
	rMin: number,
	rMax: number,
	tries: number,
	ok: (q: number) => boolean
) {
	for (let t = 0; t < tries; t++) {
		const dx = rng.range(-rMax, rMax);
		const dz = rng.range(-rMax, rMax);
		const d2 = dx * dx + dz * dz;
		if (d2 < rMin * rMin || d2 > rMax * rMax) continue;
		const i = floor(x + dx + 0.5);
		const j = floor(z + dz + 0.5);
		if (inside(i, j) && ok(j * N + i)) return j * N + i;
	}
	return -1;
}

function headingTo(x0: number, z0: number, x1: number, z1: number): [number, number] {
	const dx = x1 - x0;
	const dz = z1 - z0;
	const len = Math.sqrt(dx * dx + dz * dz);
	// Local +z (the front) is (yawS, yawC).
	return len > 0 ? [dz / len, dx / len] : [1, 0];
}

/** Steps to a crossing: the nearer of its two banks. */
function crossingSteps(crossings: Crossing[], kind: 'rope-bridge' | 'stepping-stones', steps: Int16Array) {
	const { from, to } = crossings[kind === 'rope-bridge' ? 0 : 2];
	const a = steps[cellOf(from.x, from.z)];
	const b = steps[cellOf(to.x, to.z)];
	return a < 0 ? b : b < 0 ? a : Math.min(a, b);
}

/**
 * Whether the point (x, top, z) shows from the lookout's deck, 6 u up, over
 * the terrain and the forest canopy (CANOPY u over forest cells). A trap under
 * the trees stays hidden; the smoke of a fire (top 10 u up) rises above them.
 */
function lineOfSight(heights: Float32Array, flags: Uint8Array, lookout: Point, x: number, top: number, z: number) {
	const eye = lookout.y + 6;
	const dx = x - lookout.x;
	const dz = z - lookout.z;
	const n = floor(Math.sqrt(dx * dx + dz * dz));
	for (let k = 1; k < n; k++) {
		const t = k / n;
		const px = lookout.x + dx * t;
		const pz = lookout.z + dz * t;
		const canopy = flags[cellOf(px, pz)] & FLAG.forest ? CANOPY : 0;
		if (heightAt(heights, px, pz) + canopy > eye + (top - eye) * t) return false;
	}
	return true;
}

const blockOf = (x: number, z: number) =>
	Math.min(BLOCKS_PER_SIDE - 1, floor(z / BLOCK_SIZE)) * BLOCKS_PER_SIDE +
	Math.min(BLOCKS_PER_SIDE - 1, floor(x / BLOCK_SIZE));

/** Items as parallel typed arrays, sorted by block, then kind, then creation order. */
function pack<K extends string>(kinds: readonly K[], items: Item[], heights: Float32Array): Placements<K> {
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
		out.y[w] = heightAt(heights, it.x, it.z);
		out.z[w] = it.z;
		out.scale[w] = it.scale;
		out.yawC[w] = it.yawC;
		out.yawS[w] = it.yawS;
	}
	return out;
}

/** Ground every COLLISION_STEP u, trunk and boulder cylinders, log boxes and bridge decks, per block. */
function collisionBlocks(
	heights: Float32Array,
	trees: Placements<TreeSpecies>,
	rocks: Placements<(typeof ROCK_KINDS)[number]>,
	crossings: Crossing[]
): CollisionBlock[] {
	const blocks = BLOCKS_PER_SIDE * BLOCKS_PER_SIDE;
	const cylinders: number[][] = Array.from({ length: blocks }, () => []);
	const boxes: number[][] = Array.from({ length: blocks }, () => []);
	const decks: number[][] = Array.from({ length: blocks }, () => []);
	for (let k = 0; k < trees.count; k++) {
		const s = trees.scale[k];
		cylinders[trees.block[k]].push(
			trees.x[k],
			trees.y[k] - 0.3,
			trees.z[k],
			TRUNK_RADIUS[TREE_SPECIES[trees.kind[k]]] * s,
			TRUNK_HEIGHT * s
		);
	}
	for (let k = 0; k < rocks.count; k++) {
		const s = rocks.scale[k];
		if (rocks.kind[k] === 0)
			cylinders[rocks.block[k]].push(rocks.x[k], rocks.y[k] - 0.3, rocks.z[k], 0.8 * s, 1.1 * s);
		else if (rocks.kind[k] === 2)
			boxes[rocks.block[k]].push(
				rocks.x[k],
				rocks.y[k] + 0.3 * s,
				rocks.z[k],
				1.2 * s,
				0.3 * s,
				0.3 * s,
				rocks.yawC[k],
				rocks.yawS[k]
			);
	}
	for (const c of crossings) {
		const b = blockOf((c.from.x + c.to.x) / 2, (c.from.z + c.to.z) / 2);
		if (c.kind !== 'stepping-stones')
			decks[b].push(c.from.x, c.from.y, c.from.z, c.to.x, c.to.y, c.to.z, c.halfWidth, 0.3);
		const bed = c.water - 1.4;
		for (const s of c.stones) cylinders[blockOf(s.x, s.z)].push(s.x, bed, s.z, s.r, s.y - bed);
	}
	const per = BLOCK_SIZE / COLLISION_STEP + 1;
	const out: CollisionBlock[] = [];
	for (let index = 0; index < blocks; index++) {
		const bx = index % BLOCKS_PER_SIDE;
		const bz = (index - bx) / BLOCKS_PER_SIDE;
		const x0 = bx * BLOCK_SIZE;
		const z0 = bz * BLOCK_SIZE;
		const ground = new Float32Array(per * per);
		for (let b = 0; b < per; b++)
			for (let a = 0; a < per; a++)
				ground[b * per + a] = heights[(z0 + b * COLLISION_STEP) * N + x0 + a * COLLISION_STEP];
		let minY = Number.POSITIVE_INFINITY;
		let maxY = Number.NEGATIVE_INFINITY;
		for (let j = z0; j <= z0 + BLOCK_SIZE; j++)
			for (let i = x0; i <= x0 + BLOCK_SIZE; i++) {
				minY = Math.min(minY, heights[j * N + i]);
				maxY = Math.max(maxY, heights[j * N + i]);
			}
		out.push({
			index,
			bx,
			bz,
			x0,
			z0,
			minY,
			maxY,
			heights: ground,
			cylinders: Float32Array.from(cylinders[index]),
			boxes: Float32Array.from(boxes[index]),
			decks: Float32Array.from(decks[index])
		});
	}
	return out;
}

/** Counts per kind, every key always present, plus the busiest 80 u quadrant per tree species. */
function countAll(
	trees: Placements<TreeSpecies>,
	rocks: Placements<string>,
	decorations: Placements<string>,
	pois: Poi[],
	threats: ThreatSlot[],
	corridor: Corridor,
	cameraSpots: CameraSpot[],
	resources: ResourceNode[]
): Record<string, number> {
	const counts: Record<string, number> = {};
	const tally = (prefix: string, kinds: readonly string[], of: ArrayLike<number> | string[]) => {
		for (const kind of kinds) counts[`${prefix}:${kind}`] = 0;
		for (let k = 0; k < of.length; k++) {
			const kind = typeof of[k] === 'number' ? kinds[of[k] as number] : (of[k] as string);
			counts[`${prefix}:${kind}`]++;
		}
	};
	tally('tree', TREE_SPECIES, trees.kind);
	tally('rock', ROCK_KINDS, rocks.kind);
	tally('decoration', DECORATION_KINDS, decorations.kind);
	tally(
		'threat',
		THREAT_KINDS,
		threats.map((t) => t.kind)
	);
	tally(
		'resource',
		RESOURCE_KINDS,
		resources.map((r) => r.kind)
	);
	counts.poi = pois.length;
	counts.planting = corridor.cells.length;
	counts.camera = cameraSpots.length;
	counts.animal = cameraSpots.length;
	const quadrants = new Int32Array(TREE_SPECIES.length * 4);
	for (let k = 0; k < trees.count; k++) {
		const bx = trees.block[k] % BLOCKS_PER_SIDE;
		const bz = (trees.block[k] - bx) / BLOCKS_PER_SIDE;
		quadrants[trees.kind[k] * 4 + (bz >> 1) * 2 + (bx >> 1)]++;
	}
	TREE_SPECIES.forEach((species, s) => {
		counts[`treeQuadrantMax:${species}`] = Math.max(
			quadrants[s * 4],
			quadrants[s * 4 + 1],
			quadrants[s * 4 + 2],
			quadrants[s * 4 + 3]
		);
	});
	return counts;
}
