/**
 * Zone 'praia', the Praia e Costão (PARK.md §5.1, P33), built from the
 * control points of praia-layout.ts on the zone pipeline (zone.ts):
 *
 * 1. Ground: the skeleton (the coast profile: sea, beach, restinga, forest,
 *    the serra's foot) stitched to the Reserva (zoneGround).
 * 2. Shape: the costão as a rounded rock highest at its root, the viewpoint,
 *    stepping down in low ledges to a cliff into the sea; the rock shelf at
 *    its foot with four tide pools.
 * 3. Water and flags: the sea (shallow surf is wadeable), the tide pools (not
 *    walkable, and "não pise" round them); the rails on every edge but the
 *    north portal from the Reserva.
 * 4. The restinga boardwalk as BoardwalkSpecs (two runs along x 4, ramped at
 *    their ends, with a lookout each), the costão's lookout, the turtles and
 *    the pools' creatures, the fragile ground, missions P1–P4, checkpoints,
 *    trails and their marks, animal homes, the forest from x 40 and the
 *    restinga's plants.
 *
 * The Praia is 200 × 160 u, so it uses kit.ts's `Rect` helpers, not
 * survival's square grid. Pure and deterministic (survival/random.ts's rules),
 * Worker-safe; the output is zone-local (x + 40, z + 160).
 */
import type { BoardwalkSpec, Lookout } from '../../mechanics/boardwalk.ts';
import type { PhotoSubject } from '../../mechanics/photo.ts';
import { checksumOf } from '../../survival/checksum.ts';
import { floor } from '../../survival/noise.ts';
import { poissonDisk } from '../../survival/poisson.ts';
import { Rng, subSeed } from '../../survival/random.ts';
import {
	ALBUM,
	type AnimalHome,
	DECORATION_KINDS,
	FLAG,
	type Point,
	ROCK_KINDS,
	type SurvivalWorld,
	TREE_SPECIES,
	WADE_LIMIT,
	WATER_LEVEL,
	ZONE
} from '../../survival/types.ts';
import { direction, distance, headingTo, insidePolygon, polylineDistance } from '../geometry.ts';
import type { Collectible, StoryCheckpoint, Trail } from '../types.ts';
import {
	type Basin,
	type CreatureSpot,
	FACING,
	type Facing,
	type FragileArea,
	HEADING,
	type PlantSpot,
	placeTrailMarks,
	type ZoneContent,
	type ZoneHome,
	type ZoneLandmark,
	type ZoneMission,
	type ZoneTrigger
} from './content.ts';
import {
	countAll,
	flatten,
	GROW_SLOPE,
	lineTrails,
	MAX_TRUNK,
	OCCUPIED,
	RESERVED,
	type Rect,
	rectBlocks,
	rectCell,
	rectFence,
	rectOf,
	rectPack,
	rectPaint,
	rectSlope,
	type TrailTrees,
	weightsOf
} from './kit.ts';
import {
	BOARDWALK,
	BOARDWALK_CLEARANCE,
	BOARDWALK_LOOKOUT,
	CHECKPOINTS,
	COSTAO_LOOKOUT,
	COSTAO_ROCK,
	DECORATION_SPACING,
	FOREST_X,
	HOMES,
	POOL_WATER,
	POOLS,
	RESTINGA_PLANTS,
	RESTINGA_SUBJECTS,
	RESTINGA_TREE_DENSITY,
	ROCK_SPACING,
	SHELF,
	SIGNS,
	TARGETS,
	TRAIL_CLEARANCE,
	TRAIL_HALF_WIDTH,
	TRAIL_MARKS,
	TRAILS,
	TRASH,
	TRASH_MATERIALS,
	TREE_SPACING,
	TURTLE_DEPTH,
	TURTLES
} from './praia-layout.ts';
import { PRAIA_MISSION_NAMES, PRAIA_TEXT } from './praia-text.ts';
import {
	COSTAO,
	CROSSING_HALF,
	ENTRIES,
	PARK_SEED,
	PARK_ZONES,
	type XZ,
	ZONE_VERSION,
	type ZoneId
} from './spec.ts';
import { heightIn, walkStepsRect, type ZoneBuild, type ZoneLevel, zoneArrival, zoneGround } from './zone.ts';

const SPEC = PARK_ZONES.praia;
const OX = SPEC.x0;
const OZ = SPEC.z0;
const G: Rect = rectOf(SPEC.x1 - SPEC.x0, SPEC.z1 - SPEC.z0);
const SEED = subSeed(PARK_SEED, 0x9a1a);
/** The north portal from the Reserva (spec.ts ENTRIES), the one gap in the Praia's rails. */
const PORTAL_X = ENTRIES.praia.at[0];

// --- Terrain (world coordinates) ---------------------------------------------------------

/** The costão's dome at (x, z): its top falling from the peak, stepped into ledges, never under its floor. */
function costaoDome(x: number, z: number): number {
	const R = COSTAO_ROCK;
	const d = distance(x, z, R.peak[0], R.peak[1]);
	const smooth = Math.max(R.floor, R.top - R.fall * d);
	return R.floor + R.ledge * floor((smooth - R.floor) / R.ledge + 0.5);
}

/** Whether (x, z) is under the pool's water or rim: the pool it is in, or −1. */
function poolAt(x: number, z: number, margin: number): number {
	for (let k = 0; k < POOLS.length; k++)
		if (distance(x, z, POOLS[k].at[0], POOLS[k].at[1]) <= POOLS[k].radius + margin) return k;
	return -1;
}

/**
 * Step 2 (after the band): the shelf at the costão's foot, then the costão's
 * rock over park-plan.py's polygon and its root on the land side, then the
 * pools cut into the shelf.
 */
export function praiaShape(x: number, z: number, h: number): number {
	let g = flatten(h, x, z, SHELF.centre, SHELF.y, SHELF.r0, SHELF.r1);
	const dome = costaoDome(x, z);
	if (insidePolygon(COSTAO, x, z)) g = dome;
	else if (x >= COSTAO_ROCK.rootX && dome > COSTAO_ROCK.floor) g = Math.max(g, dome);
	const p = poolAt(x, z, 0.4);
	if (p >= 0) {
		const pool = POOLS[p];
		const d = distance(x, z, pool.at[0], pool.at[1]);
		const bed = POOL_WATER.surface - POOL_WATER.depth;
		const rim = d <= pool.radius ? bed : bed + ((SHELF.y - bed) * (d - pool.radius)) / 0.4;
		g = Math.min(g, rim);
	}
	return g;
}

/**
 * Where to stand to look into a pool (P2): on the shelf's dry rock just past
 * its "não pise" ring, clear of every other pool's ring, facing the way the
 * trail comes in if that is free, else turned 45° at a time.
 */
function lookSpot(pool: (typeof POOLS)[number]): XZ {
	const [ux, uz] = direction(pool.at[0], pool.at[1], TARGETS.pocas[0], TARGETS.pocas[1]);
	const reach = pool.radius + POOL_WATER.noStep + POOL_WATER.look;
	const h = Math.sqrt(0.5);
	let [dx, dz] = [ux, uz];
	const turns: [number, number][] = [];
	for (let k = 0; k < 8; k++) {
		turns.push([dx, dz]);
		[dx, dz] = [(dx - dz) * h, (dx + dz) * h];
	}
	// Straight on, then 45°, −45°, 90°, −90°…
	for (const k of [0, 1, 7, 2, 6, 3, 5, 4]) {
		const [tx, tz] = turns[k];
		const spot: XZ = [pool.at[0] + tx * reach, pool.at[1] + tz * reach];
		const clear = POOLS.every(
			(p) => distance(spot[0], spot[1], p.at[0], p.at[1]) >= p.radius + POOL_WATER.noStep + 0.6
		);
		if (clear && distance(spot[0], spot[1], SHELF.centre[0], SHELF.centre[1]) <= SHELF.r0) return spot;
	}
	throw new Error(`no place to look into ${pool.id}`);
}

// --- The build ---------------------------------------------------------------------------

const TREE_MIX = {
	forest: weightsOf({
		jucara: 3,
		jequitiba: 2,
		'pau-brasil': 1.5,
		embauba: 2,
		'ipe-rosa': 1,
		xaxim: 1,
		jeriva: 0.5
	}),
	restinga: weightsOf({ jeriva: 3, embauba: 1 })
};
/** Ground cover over DECORATION_KINDS (grass, flower, bush, fern, bromelia, beach-grass). */
const DECO_MIX = {
	beach: [0.5, 0, 0, 0, 0, 3],
	restinga: [1, 1, 3, 0, 3, 2],
	forest: [0.3, 0.5, 2, 3, 2, 0],
	rock: [0, 0, 0, 0, 1, 0.5]
};
/** Of the Poisson points, the share that grows ground cover on the beach and on the costão's rock. */
const SPARSE = { beach: 0.3, rock: 0.25 } as const;
const TRAIL_TREES: TrailTrees = { step: 5.5, offset: 3.55, spread: 0.8, density: 0.9 };
const EDGE_BAND = 4;
const EDGE_TREE_SPACING = 3.6;

/** Builds zone 'praia' after the Reserva (its south seam). */
export function buildPraiaZone(built: ReadonlyMap<ZoneId, ZoneBuild>): ZoneBuild {
	const problems: string[] = [];
	const { width, depth, ground, band } = zoneGround('praia', built);
	if (width !== G.width || depth !== G.depth) throw new Error('the Praia must be 200 × 160');
	const keep = band.seam;
	for (let q = 0; q < G.cells; q++) {
		if (keep[q]) continue;
		const i = q % G.side;
		ground[q] = praiaShape(OX + i, OZ + (q - i) / G.side, ground[q]);
	}
	const heights = Float32Array.from(ground);
	const slope = rectSlope(G, heights);

	// Water, zones and flags.
	const zones = new Uint8Array(G.cells);
	const flags = new Uint8Array(G.cells);
	for (let q = 0; q < G.cells; q++) {
		const i = q % G.side;
		const x = OX + i;
		const z = OZ + (q - i) / G.side;
		const h = heights[q];
		const inPool = poolAt(x, z, 0.4) >= 0 && h < POOL_WATER.surface;
		const sea = h < WATER_LEVEL;
		const rock =
			insidePolygon(COSTAO, x, z) ||
			(x >= COSTAO_ROCK.rootX && costaoDome(x, z) > COSTAO_ROCK.floor && h >= COSTAO_ROCK.floor) ||
			distance(x, z, SHELF.centre[0], SHELF.centre[1]) <= SHELF.r0;
		zones[q] =
			inPool || sea
				? ZONE.sea
				: rock
					? ZONE.highland
					: x < 2.5 && h <= 1.5
						? ZONE.beach
						: x < FOREST_X
							? ZONE.restinga
							: x < 110
								? ZONE.lowland
								: ZONE.slope;
		let f = 0;
		if (inPool) f |= FLAG.river;
		else if (h > WADE_LIMIT) f |= FLAG.walkable;
		if (!inPool && !sea && (zones[q] === ZONE.lowland || zones[q] === ZONE.slope)) f |= FLAG.forest;
		flags[q] = f;
	}
	rectFence(G, flags, OX, OZ, (x, z) => SPEC.z1 - z < 2 && Math.abs(x - PORTAL_X) <= CROSSING_HALF);

	// Arrival and reachability on the ground (the boardwalk stands 1 u over it).
	const { arrival, inside, heading } = zoneArrival('praia', heights, G.side);
	const steps = walkStepsRect(flags, heights, width, depth, rectCell(G, inside.x, inside.z));

	// The story, then the ground it keeps free.
	const level = praiaLevel(heights, arrival, inside, heading);
	const content = level.content as ZoneContent;
	const clear = new Uint8Array(G.cells);
	reserveGameplay(clear, level);

	// Vegetation and the restinga's plants.
	const trails = level.trails.map((t) => t.points as XZ[]);
	const boardwalk = content.mechanics.boardwalks.map((b): [XZ, XZ] => [
		[b.start.x, b.start.z],
		[b.end.x, b.end.z]
	]);
	const awayFromPaths = (x: number, z: number, r: number) =>
		trails.every((t) => polylineDistance(t, x, z) >= TRAIL_CLEARANCE + r) &&
		boardwalk.every((b) => polylineDistance(b, x, z) >= BOARDWALK_CLEARANCE + r);
	const trees = plantTrees(zones, flags, clear, slope, trails, awayFromPaths);
	content.plants = [...(content.plants ?? []), ...placePlants(heights, flags, clear, slope, awayFromPaths)];
	content.trailMarks = placeTrailMarks(
		level.trails,
		trees,
		(x, z) => heightIn(heights, G.side, x, z),
		TRAIL_MARKS
	);
	const rocks = placeRocks(zones, flags, clear, slope, awayFromPaths);
	const decorations = coverGround(zones, flags, clear, slope, trails, boardwalk);
	const treeSet = rectPack(G, TREE_SPECIES, trees, heights);
	const rockSet = rectPack(G, ROCK_KINDS, rocks, heights);
	const decoSet = rectPack(G, DECORATION_KINDS, decorations, heights);
	const blocks = rectBlocks(G, heights, treeSet, rockSet);

	for (const p of groundTargets(level))
		if (steps[rectCell(G, p.x, p.z)] < 0) problems.push(`${p.id} unreachable`);

	const animals = animalsOf(heights);
	const mechanics = content.mechanics;
	const world: SurvivalWorld = {
		generatorVersion: ZONE_VERSION,
		seed: PARK_SEED,
		attempt: 1,
		worldSeed: PARK_SEED,
		problems:
			band.unresolved > 0 ? [...problems, `${band.unresolved} band vertices over the slope limit`] : problems,
		size: width,
		grid: G.side,
		waterLevel: WATER_LEVEL,
		heights,
		zones,
		flags,
		baseSteps: steps,
		highlandHeight: Number.POSITIVE_INFINITY,
		river: { points: [], halfWidth: 0, depth: 0 },
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
		counts: countAll(treeSet.kind, rockSet.kind, decoSet.kind, treeSet.block, level, animals.length, {
			trailMark: content.trailMarks.length,
			boardwalk: mechanics.boardwalks.length,
			lookout: mechanics.boardwalks.reduce((n, b) => n + b.lookouts.length, 0) + mechanics.lookouts.length,
			photoSubject: mechanics.photoSubjects?.length ?? 0,
			creature: content.creatures?.length ?? 0,
			plant: content.plants?.length ?? 0,
			fragile: content.fragile?.length ?? 0
		}),
		checksum: 0
	};
	world.checksum = checksumOf(world);
	level.checksum = checksumOf(level);
	return {
		id: 'praia',
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

// --- Story data (zone-local) ------------------------------------------------------------

const local = ([x, z]: XZ): XZ => [x - OX, z - OZ];

/** The boardwalk's runs: ramp up, deck segments `deck` over the ground, ramp down. */
function boardwalkRuns(ground: (x: number, z: number) => number): BoardwalkSpec[] {
	const out: BoardwalkSpec[] = [];
	const B = BOARDWALK;
	/** The deck over z: `lift` over the highest sand within `reach` u along the line. */
	const at = (z: number, lift: number, reach: number) => {
		const [x, lz] = local([B.x, z]);
		let high = ground(x, lz);
		for (let s = -reach; s <= reach; s += 0.5) high = Math.max(high, ground(x, lz + s));
		return { x, y: high + lift, z: lz };
	};
	for (const run of B.runs) {
		const dir = run.to < run.from ? -1 : 1;
		const deckFrom = run.from + dir * B.ramp;
		const deckTo = run.to - dir * B.ramp;
		const count = Math.max(1, floor(Math.abs(deckTo - deckFrom) / B.segment + 0.5));
		const stops: number[] = [run.from];
		for (let k = 0; k <= count; k++) stops.push(deckFrom + ((deckTo - deckFrom) * k) / count);
		stops.push(run.to);
		for (let k = 1; k < stops.length; k++) {
			const first = k === 1;
			const last = k === stops.length - 1;
			out.push({
				id: `${run.id}-${String(k).padStart(2, '0')}`,
				start: at(stops[k - 1], first ? 0 : B.deck, first ? 0 : B.segment / 2),
				end: at(stops[k], last ? 0 : B.deck, last ? 0 : B.segment / 2),
				width: B.width,
				lookouts: []
			});
		}
	}
	return out;
}

function praiaLevel(
	heights: Float32Array,
	arrival: NonNullable<ZoneLevel['arrival']>,
	inside: Point & { yaw: number },
	heading: [number, number]
): ZoneLevel {
	const groundLocal = (x: number, z: number) => heightIn(heights, G.side, x, z);
	const at = (p: XZ, lift = 0): Point => {
		const [x, z] = local(p);
		return { x, y: groundLocal(x, z) + lift, z };
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

	// The boardwalk, its two lookouts and P4's plants.
	const boardwalks = boardwalkRuns(groundLocal);
	const subjects: PhotoSubject[] = [];
	const heroPlants: PlantSpot[] = [];
	for (const s of RESTINGA_SUBJECTS) {
		const p = at(s.at, s.lift);
		subjects.push({ id: `foto-${s.species}`, species: s.species, position: plain(p) });
		heroPlants.push({
			id: `planta-${s.species}`,
			species: s.species,
			...at(s.at),
			scale: 1.2,
			yawC: 1,
			yawS: 0
		});
		if (!s.lookout) continue;
		// On the run's deck segment level with the plant, framed from behind towards it.
		const [, lz] = local(s.at);
		const segment = boardwalks.find(
			(b) =>
				b.id.startsWith(s.lookout) && Math.min(b.start.z, b.end.z) <= lz && Math.max(b.start.z, b.end.z) >= lz
		);
		if (!segment) throw new Error(`no boardwalk at ${s.species}`);
		const t = (lz - segment.start.z) / (segment.end.z - segment.start.z);
		const position = {
			x: segment.start.x + (segment.end.x - segment.start.x) * t,
			y: segment.start.y + (segment.end.y - segment.start.y) * t,
			z: lz
		};
		// The camera stands behind the feet, away from the plant.
		const [bx, bz] = direction(p.x, p.z, position.x, position.z);
		segment.lookouts = [
			...segment.lookouts,
			{
				id: `mirante-${s.species}`,
				position,
				camera: {
					x: position.x + bx * BOARDWALK_LOOKOUT.cameraBack,
					y: position.y + BOARDWALK_LOOKOUT.cameraLift,
					z: position.z + bz * BOARDWALK_LOOKOUT.cameraBack
				},
				target: plain(p)
			}
		];
	}

	// The costão's lookout over the turtles, the turtles and the pools' creatures.
	const turtles: CreatureSpot[] = TURTLES.map((t) => {
		const [x, z] = local(t.at);
		const [yawC, yawS] = headingTo(x, z, ...local(COSTAO_LOOKOUT.at));
		return {
			id: t.id,
			species: 'tartaruga-verde',
			model: t.model,
			state: t.state,
			place: 'costao',
			x,
			y: WATER_LEVEL - TURTLE_DEPTH,
			z,
			yawC,
			yawS
		};
	});
	for (const t of turtles) subjects.push({ id: `foto-${t.id}`, species: t.species, position: plain(t) });
	const view = at(COSTAO_LOOKOUT.at);
	const [bx, bz] = direction(turtles[0].x, turtles[0].z, view.x, view.z);
	const costaoLookout: Lookout = {
		id: 'mirante-costao',
		position: view,
		camera: {
			x: view.x + bx * COSTAO_LOOKOUT.cameraBack,
			y: view.y + COSTAO_LOOKOUT.cameraLift,
			z: view.z + bz * COSTAO_LOOKOUT.cameraBack
		},
		target: plain(turtles[0])
	};
	const creatures: CreatureSpot[] = [
		...POOLS.map((pool): CreatureSpot => {
			const [x, z] = local(pool.at);
			const bed = POOL_WATER.surface - POOL_WATER.depth;
			return {
				id: `bicho-${pool.id}`,
				species: pool.species,
				model: pool.model,
				state: pool.species === 'peixe-de-poca' ? 'swimming' : 'resting',
				place: pool.id,
				x,
				y: pool.species === 'peixe-de-poca' ? bed + POOL_WATER.depth / 2 : bed,
				z,
				yawC: 1,
				yawS: 0
			};
		}),
		...turtles
	];

	// The pools: their water, "não pise" round each, and where to stand to look in (P2).
	const pools = POOLS.map((pool) => {
		const [x, z] = local(pool.at);
		return { pool, x, z, look: at(lookSpot(pool)) };
	});
	const basins: Basin[] = pools.map(({ pool, x, z }) => ({
		id: pool.id,
		a: [x, z],
		b: [x, z],
		radius: pool.radius,
		water: POOL_WATER.surface,
		wade: 0
	}));
	const fragile: FragileArea[] = [
		{
			id: 'restinga',
			kind: 'restinga',
			text: 'PRAIA_RESTINGA_FRAGIL',
			shape: 'polygon',
			points: (
				[
					[2, -150],
					[40, -150],
					[40, -10],
					[2, -10]
				] as XZ[]
			).map(local)
		},
		...pools.map(
			({ pool, x, z }): FragileArea => ({
				id: `nao-pise-${pool.id}`,
				kind: 'tide-pool',
				text: 'PRAIA_NAO_PISE',
				shape: 'circle',
				x,
				z,
				radius: pool.radius + POOL_WATER.noStep
			})
		)
	];

	const trash: Collectible[] = TRASH.map(([p, variant], k) => ({
		id: `lixo-${k + 1}`,
		kind: 'trash' as const,
		variant,
		mission: 1,
		radius: 1.2,
		on: '',
		...at(p)
	}));

	const spawn = {
		x: inside.x,
		y: inside.y,
		z: inside.z,
		yawC: heading[0],
		yawS: heading[1],
		yaw: inside.yaw
	};
	const start: StoryCheckpoint = {
		id: 'entrada',
		mission: 0,
		min: { x: inside.x - 2, y: inside.y - 0.5, z: inside.z - 2 },
		max: { x: inside.x + 2, y: inside.y + 3, z: inside.z + 2 },
		spawn: plain(inside),
		yaw: inside.yaw
	};
	const checkpoints = [
		checkpoint('praia', at(CHECKPOINTS.praia), 'north', 1),
		checkpoint('costao', at(CHECKPOINTS.costao), 'west', 3),
		checkpoint('restinga', at(CHECKPOINTS.restinga), 'south', 4)
	];

	const triggers: ZoneTrigger[] = [
		...pools.map(({ pool, look }) => trigger(`olhar-${pool.id}`, 'observation', look, 1.4, 2)),
		...pools.map(({ pool, x, z }) =>
			trigger(`nao-pise-${pool.id}`, 'fragile', { x, y: SHELF.y, z }, pool.radius + POOL_WATER.noStep, 2)
		),
		trigger('mirante-costao', 'lookout', view, 2.5, 3),
		trigger('resgate-tartaruga', 'radio', view, 4, 3)
	];

	const ramp = boardwalks[0].start;
	const targets = [at(TARGETS.praia), at(TARGETS.pocas), view, ramp].map(plain);
	const missions: ZoneMission[] = [
		{
			id: 1,
			key: 'limpeza-da-praia',
			name: PRAIA_MISSION_NAMES[0],
			requires: [],
			target: targets[0],
			count: trash.length,
			dialogue: [
				'PRAIA_INTRO_1',
				'PRAIA_INTRO_2',
				'PRAIA_P1_DONE',
				'FACT_LIXO_PLASTICO',
				'FACT_PLASTICO_NO_MAR'
			],
			triggers: trash.map((t) => t.id)
		},
		{
			id: 2,
			key: 'pocas-de-mare',
			name: PRAIA_MISSION_NAMES[1],
			requires: [1],
			target: targets[1],
			count: pools.length,
			dialogue: ['PRAIA_P2_INTRO', 'PRAIA_NAO_PISE', 'PRAIA_P2_DONE', 'FACT_COSTAO', 'FACT_POCAS_FRAGEIS'],
			triggers: pools.map(({ pool }) => `olhar-${pool.id}`)
		},
		{
			id: 3,
			key: 'tartaruga-no-costao',
			name: PRAIA_MISSION_NAMES[2],
			requires: [1],
			target: targets[2],
			count: 2,
			dialogue: [
				'PRAIA_P3_INTRO',
				'PRAIA_P3_ALERTA',
				'PRAIA_P3_DONE',
				'FACT_TARTARUGA_VERDE',
				'FACT_RESGATE'
			],
			triggers: ['mirante-costao', 'resgate-tartaruga']
		},
		{
			id: 4,
			key: 'restinga',
			name: PRAIA_MISSION_NAMES[3],
			requires: [1],
			target: targets[3],
			count: RESTINGA_SUBJECTS.length,
			dialogue: [
				'PRAIA_P4_INTRO',
				'PRAIA_RESTINGA_FRAGIL',
				'PRAIA_P4_DONE',
				'FACT_RESTINGA',
				'FACT_BROMELIA',
				'FACT_PITANGUEIRA',
				'FACT_CACTO'
			],
			triggers: RESTINGA_SUBJECTS.map((s) => `foto-${s.species}`)
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

	const sign = (s: { at: XZ; label: string }, facing: [number, number]) =>
		[at(s.at), facing, PRAIA_TEXT[s.label].text] as const;
	const landmarks: ZoneLandmark[] = [
		landmark(
			'mirante-costao',
			'lookout',
			view,
			headingTo(view.x, view.z, turtles[0].x, turtles[0].z),
			PRAIA_TEXT.LABEL_MIRANTE.text
		),
		landmark('placa-praia', 'zone-sign', ...sign(SIGNS.praia, HEADING.south), 2.2),
		landmark('placa-restinga', 'zone-sign', ...sign(SIGNS.restinga, HEADING.east), 2.2),
		landmark('placa-pocas', 'zone-sign', ...sign(SIGNS.pocas, HEADING.east), 2.2)
	];

	const trails: Trail[] = Object.entries(TRAILS).map(([id, points]) => ({
		id,
		halfWidth: TRAIL_HALF_WIDTH,
		points: points.map((p) => local(p) as [number, number])
	}));

	const content: ZoneContent = {
		// Filled after the planting: marks go on trunks by the trails where there are any.
		trailMarks: [],
		mechanics: {
			bridges: [],
			boardwalks,
			lookouts: [costaoLookout],
			cameraTraps: [],
			photoSubjects: subjects
		},
		homes: homesOf(heights),
		basins,
		fragile,
		creatures,
		plants: heroPlants,
		trashMaterials: { ...TRASH_MATERIALS },
		text: PRAIA_TEXT
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
		planting: [],
		pool: { x: 0, z: 0, water: WATER_LEVEL, axisX: 1, axisZ: 0, halfLength: 0, halfWidth: 0 },
		mirante: plain(view),
		handholds: [],
		arrival,
		content,
		checksum: 0
	};
}

function homesOf(heights: Float32Array): ZoneHome[] {
	return Object.entries(HOMES).map(([species, h]): ZoneHome => {
		const [x, z] = local(h.at);
		return {
			id: species,
			species,
			x,
			y: Math.max(WATER_LEVEL, heightIn(heights, G.side, x, z)),
			z,
			group: h.group,
			radius: h.radius,
			rarity: h.rarity,
			time: h.time,
			tree: null,
			fact: h.fact
		};
	});
}

/** The album species among the homes, in survival's AnimalHome shape (the rest are not in the album yet). */
function animalsOf(heights: Float32Array): AnimalHome[] {
	return ALBUM.filter((entry) => entry.species in HOMES).map((entry, id) => {
		const [x, z] = local(HOMES[entry.species].at);
		return {
			id,
			species: entry.species,
			zone: entry.zone,
			radius: HOMES[entry.species].radius,
			x,
			y: heightIn(heights, G.side, x, z),
			z
		};
	});
}

/** Everything the story needs reached on foot (the boardwalk's decks are checked as a chain in praia.test.ts). */
export function groundTargets(level: ZoneLevel): { id: string; x: number; z: number }[] {
	const content = level.content;
	return [
		...level.missions.map((m) => ({ id: `missao-${m.id}`, x: m.target.x, z: m.target.z })),
		...[level.start, ...level.checkpoints].map((c) => ({
			id: `checkpoint ${c.id}`,
			x: c.spawn.x,
			z: c.spawn.z
		})),
		...level.collectibles.map((c) => ({ id: c.id, x: c.x, z: c.z })),
		...level.triggers
			.filter((t) => t.kind !== 'fragile')
			.map((t) => ({ id: `gatilho ${t.id}`, x: t.x, z: t.z })),
		...runEnds(content?.mechanics.boardwalks ?? [])
	];
}

/** Where each boardwalk run meets the ground: its first start and its last end. */
export function runEnds(boardwalks: readonly BoardwalkSpec[]): { id: string; x: number; z: number }[] {
	return BOARDWALK.runs.flatMap((run) => {
		const parts = boardwalks.filter((b) => b.id.startsWith(`${run.id}-`));
		const first = parts[0];
		const last = parts[parts.length - 1];
		return [
			{ id: `${run.id} (início)`, x: first.start.x, z: first.start.z },
			{ id: `${run.id} (fim)`, x: last.end.x, z: last.end.z }
		];
	});
}

/** Ground kept free of trees, rocks and ground cover: every place the story uses. */
function reserveGameplay(clear: Uint8Array, level: ZoneLevel) {
	for (const p of groundTargets(level)) rectPaint(G, clear, p.x, p.z, 2.5, RESERVED);
	for (const l of level.landmarks) rectPaint(G, clear, l.x, l.z, 2.5, RESERVED);
	for (const p of level.content?.plants ?? []) rectPaint(G, clear, p.x, p.z, 2, RESERVED);
	for (const area of level.content?.fragile ?? [])
		if (area.shape === 'circle') rectPaint(G, clear, area.x, area.z, area.radius + 0.5, RESERVED);
	for (const b of level.content?.mechanics.boardwalks ?? [])
		for (let t = 0; t <= 1; t += 0.25)
			rectPaint(
				G,
				clear,
				b.start.x + (b.end.x - b.start.x) * t,
				b.start.z + (b.end.z - b.start.z) * t,
				1.6,
				RESERVED
			);
}

// --- Vegetation ------------------------------------------------------------------------

function plantTrees(
	zones: Uint8Array,
	flags: Uint8Array,
	clear: Uint8Array,
	slope: Float32Array,
	trails: XZ[][],
	awayFromPaths: (x: number, z: number, r: number) => boolean
): { kind: number; x: number; z: number; scale: number; yawC: number; yawS: number }[] {
	const rng = new Rng(subSeed(SEED, 1));
	const trees: { kind: number; x: number; z: number; scale: number; yawC: number; yawS: number }[] = [];
	const grow = (x: number, z: number, density: number) => {
		const q = rectCell(G, x, z);
		const zone = zones[q];
		if (clear[q] !== 0 || slope[q] > GROW_SLOPE || !(flags[q] & FLAG.walkable)) return;
		const restinga = zone === ZONE.restinga && x + OX >= 12;
		if (!restinga && zone !== ZONE.lowland && zone !== ZONE.slope) return;
		if (!awayFromPaths(x, z, MAX_TRUNK)) return;
		if (rng.next() >= (restinga ? density * RESTINGA_TREE_DENSITY : density)) return;
		const kind = rng.weighted(restinga ? TREE_MIX.restinga : TREE_MIX.forest);
		const scale = rng.range(0.85, 1.3);
		const [yawC, yawS] = rng.heading();
		trees.push({ kind, x, z, scale, yawC, yawS });
		rectPaint(G, clear, x, z, 1.2, OCCUPIED);
	};
	lineTrails(trails, TRAIL_TREES, rng, grow);
	const points = poissonDisk(rng, 1, 1, G.width - 1, G.depth - 1, TREE_SPACING);
	for (let k = 0; k < points.length; k += 2) grow(points[k], points[k + 1], 1);
	const edge = poissonDisk(rng, 1, 1, G.width - 1, G.depth - 1, EDGE_TREE_SPACING);
	for (let k = 0; k < edge.length; k += 2) {
		const x = edge[k];
		const z = edge[k + 1];
		const toEdge = Math.min(x, z, G.width - x, G.depth - z);
		const portal = G.depth - z < EDGE_BAND + 2 && Math.abs(x + OX - PORTAL_X) < 10;
		if (toEdge < EDGE_BAND && !portal && x + OX >= FOREST_X) grow(x, z, 1);
	}
	return trees;
}

/** Cactus and pitangueira over the restinga (PlantSpots: survival has no kind for them). */
function placePlants(
	heights: Float32Array,
	flags: Uint8Array,
	clear: Uint8Array,
	slope: Float32Array,
	awayFromPaths: (x: number, z: number, r: number) => boolean
): PlantSpot[] {
	const rng = new Rng(subSeed(SEED, 4));
	const R = RESTINGA_PLANTS.region;
	const [x0, z0] = local([R.x0, R.z0]);
	const [x1, z1] = local([R.x1, R.z1]);
	const points = poissonDisk(rng, x0, z0, x1, z1, RESTINGA_PLANTS.spacing);
	const species = Object.keys(RESTINGA_PLANTS.mix);
	const weights = Object.values(RESTINGA_PLANTS.mix);
	const out: PlantSpot[] = [];
	for (let k = 0; k < points.length; k += 2) {
		const x = points[k];
		const z = points[k + 1];
		const q = rectCell(G, x, z);
		if (clear[q] !== 0 || slope[q] > GROW_SLOPE || !(flags[q] & FLAG.walkable)) continue;
		if (!awayFromPaths(x, z, 0.6)) continue;
		const name = species[rng.weighted(weights)];
		const [yawC, yawS] = rng.heading();
		out.push({
			id: `planta-${out.length + 1}`,
			species: name,
			x,
			y: heightIn(heights, G.side, x, z),
			z,
			scale: rng.range(0.8, 1.2),
			yawC,
			yawS
		});
		rectPaint(G, clear, x, z, 1.5, OCCUPIED);
	}
	return out;
}

function placeRocks(
	zones: Uint8Array,
	flags: Uint8Array,
	clear: Uint8Array,
	slope: Float32Array,
	awayFromPaths: (x: number, z: number, r: number) => boolean
): { kind: number; x: number; z: number; scale: number; yawC: number; yawS: number }[] {
	const rng = new Rng(subSeed(SEED, 2));
	const rocks: { kind: number; x: number; z: number; scale: number; yawC: number; yawS: number }[] = [];
	const points = poissonDisk(rng, 1, 1, G.width - 1, G.depth - 1, ROCK_SPACING);
	for (let k = 0; k < points.length; k += 2) {
		const x = points[k];
		const z = points[k + 1];
		const q = rectCell(G, x, z);
		const zone = zones[q];
		if (clear[q] !== 0 || slope[q] > GROW_SLOPE || !(flags[q] & FLAG.walkable)) continue;
		const forest = zone === ZONE.lowland || zone === ZONE.slope;
		const shore = zone === ZONE.beach && x + OX <= -2;
		if (!forest && !shore) continue;
		if (rng.next() >= (forest ? 0.18 : 0.35)) continue;
		const kind = rng.weighted(forest ? [0.35, 0.4, 0.25] : [0.6, 0.4, 0]);
		const scale = kind === 0 ? rng.range(0.6, 1.4) : kind === 1 ? rng.range(0.5, 1) : rng.range(0.8, 1.3);
		const reach = kind === 0 ? 0.8 * scale : kind === 2 ? 1.25 * scale : 0.6 * scale;
		if (!awayFromPaths(x, z, reach)) continue;
		const [yawC, yawS] = rng.heading();
		rocks.push({ kind, x, z, scale, yawC, yawS });
		rectPaint(G, clear, x, z, 1.5, OCCUPIED);
	}
	return rocks;
}

function coverGround(
	zones: Uint8Array,
	flags: Uint8Array,
	clear: Uint8Array,
	slope: Float32Array,
	trails: XZ[][],
	boardwalk: [XZ, XZ][]
): { kind: number; x: number; z: number; scale: number; yawC: number; yawS: number }[] {
	const rng = new Rng(subSeed(SEED, 3));
	const out: { kind: number; x: number; z: number; scale: number; yawC: number; yawS: number }[] = [];
	const points = poissonDisk(rng, 1, 1, G.width - 1, G.depth - 1, DECORATION_SPACING);
	for (let k = 0; k < points.length; k += 2) {
		const x = points[k];
		const z = points[k + 1];
		const q = rectCell(G, x, z);
		const f = flags[q];
		const zone = zones[q];
		if (clear[q] & RESERVED || slope[q] > GROW_SLOPE || !(f & FLAG.walkable) || zone === ZONE.sea) continue;
		if (trails.some((t) => polylineDistance(t, x, z) < TRAIL_HALF_WIDTH + 0.4)) continue;
		if (boardwalk.some((b) => polylineDistance(b, x, z) < 1.2)) continue;
		const mix =
			zone === ZONE.beach
				? DECO_MIX.beach
				: zone === ZONE.highland
					? DECO_MIX.rock
					: zone === ZONE.restinga
						? DECO_MIX.restinga
						: DECO_MIX.forest;
		const sparse = zone === ZONE.beach ? SPARSE.beach : zone === ZONE.highland ? SPARSE.rock : 1;
		if (rng.next() >= sparse) continue;
		const kind = rng.weighted(mix);
		const scale = rng.range(0.6, 1.3);
		const [yawC, yawS] = rng.heading();
		out.push({ kind, x, z, scale, yawC, yawS });
	}
	return out;
}
