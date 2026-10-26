/**
 * Zone 'copa', the Copa das Árvores (PARK.md §4.2, P31), built from the
 * control points of copa-layout.ts on the zone pipeline (zone.ts):
 *
 * 1. Ground: the skeleton (a forest floor of 30–40) stitched to the Vale and
 *    the Praia (zoneGround), with flat pads under the stair, the tower and
 *    Vovó Jequitibá. The Copa has no river.
 * 2. The canopy walkway as data: the stair, its access and a 24-sided loop,
 *    each a BoardwalkSpec of game/src/mechanics (contiguous, the loop closed),
 *    4 u over the ground, with four lookouts aimed into the old forest the loop
 *    rings, where the photo subjects of C2 sit in the crowns.
 * 3. The observation tower and its LadderSpec (the props' ladder nodes), Vovó
 *    Jequitibá and its six fallen seeds, missions C1–C4, checkpoints, trails
 *    and their marks, animal homes and the mature forest.
 *
 * The walkway, the stair and the tower stand over the ground: their colliders
 * come from the mechanics' meshes and the props, not from this grid, so the
 * ground's reachability (baseSteps) is the forest floor's, and copa.test.ts
 * checks the raised parts as a graph. Pure and deterministic (survival/
 * random.ts's rules), Worker-safe; the output is zone-local (x − 160, z + 160).
 */
import type { BoardwalkSpec, Lookout } from '../../mechanics/boardwalk.ts';
import type { LadderSpec } from '../../mechanics/ladder.ts';
import type { PhotoSubject } from '../../mechanics/photo.ts';
import { checksumOf } from '../../survival/checksum.ts';
import { collisionBlocks, type Item, pack, paint } from '../../survival/generate.ts';
import { floor } from '../../survival/noise.ts';
import { poissonDisk } from '../../survival/poisson.ts';
import { Rng, subSeed } from '../../survival/random.ts';
import { heightAt } from '../../survival/terrain.ts';
import {
	ALBUM,
	type AnimalHome,
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
import { distance, headingTo, polylineDistance } from '../geometry.ts';
import { cellOf, stepsWithLinks } from '../reach.ts';
import type { Collectible, StoryCheckpoint, Trail } from '../types.ts';
import {
	FACING,
	type Facing,
	HEADING,
	placeTrailMarks,
	type SeedSpot,
	type Stair,
	type ZoneContent,
	type ZoneHome,
	type ZoneLandmark,
	type ZoneMission,
	type ZoneTrigger
} from './content.ts';
import {
	ANIMALS,
	CHECKPOINTS,
	DECORATION_SPACING,
	LOOKOUT_VIEW,
	LOOKOUTS,
	ROCK_SPACING,
	SIGNS,
	STAIR,
	TOWER,
	TRAIL_CLEARANCE,
	TRAIL_HALF_WIDTH,
	TRAIL_MARKS,
	TRAILS,
	TREE_SPACING,
	VIEW_LANE,
	VOVO,
	VOVO_TARGET,
	WALKWAY,
	WALKWAY_CLEARANCE,
	WAYPOINTS
} from './copa-layout.ts';
import { COPA_MISSION_NAMES, COPA_TEXT } from './copa-text.ts';
import {
	CELLS,
	countAll,
	FENCE_MARGIN,
	fenceEdges,
	flatten,
	GROW_SLOPE,
	lineTrails,
	N,
	OCCUPIED,
	RESERVED,
	slopeOf,
	type TrailTrees,
	weightsOf
} from './kit.ts';
import { PARK_SEED, PARK_ZONES, SEAMS, type XZ, ZONE_VERSION, type ZoneId } from './spec.ts';
import { type ZoneBuild, type ZoneLevel, zoneArrival, zoneGround } from './zone.ts';

const SPEC = PARK_ZONES.copa;
const OX = SPEC.x0;
const OZ = SPEC.z0;
const SEED = subSeed(PARK_SEED, 0x0c0a);
/** The Copa's way out to the Vale (spec.ts SEAMS 'vale-copa'), the one gap in its rails. */
const VALE_CROSSING = SEAMS.find((s) => s.fixed === 'vale' && s.zone === 'copa')?.crossings[0] ?? [0, -1];

// --- The 24-gon (exact: its vertices need only √2, √3 and √6) ---------------------------------

const R2 = Math.sqrt(2);
const R3 = Math.sqrt(3);
const R6 = Math.sqrt(6);
const C15 = (R6 + R2) / 4;
const S15 = (R6 - R2) / 4;
/** (cos, sin) of 0°, 15°, …, 75°; the other quadrants turn these by 90°. */
const QUADRANT: readonly [number, number][] = [
	[1, 0],
	[C15, S15],
	[R3 / 2, 0.5],
	[R2 / 2, R2 / 2],
	[0.5, R3 / 2],
	[S15, C15]
];

/** The unit vector at k · 15° (from +x towards +z). */
export function unit24(k: number): [number, number] {
	const m = ((k % 24) + 24) % 24;
	let [c, s] = QUADRANT[m % 6];
	for (let r = 0; r < floor(m / 6); r++) [c, s] = [-s, c];
	return [c, s];
}

/** The loop's vertex k in world coordinates. */
export function loopVertex(k: number): XZ {
	const [c, s] = unit24(k);
	return [WALKWAY.centre[0] + WALKWAY.radius * c, WALKWAY.centre[1] + WALKWAY.radius * s];
}

/** The lookout on segment k (vertex k to k + 1): its midpoint, the unit towards the ring's centre, and its subject. */
function lookoutPlace(k: number): { mid: XZ; inward: XZ; subject: XZ } {
	const [ax, az] = loopVertex(k);
	const [bx, bz] = loopVertex(k + 1);
	const mx = (ax + bx) / 2;
	const mz = (az + bz) / 2;
	const dx = WALKWAY.centre[0] - mx;
	const dz = WALKWAY.centre[1] - mz;
	const d = Math.sqrt(dx * dx + dz * dz);
	const ix = dx / d;
	const iz = dz / d;
	return {
		mid: [mx, mz],
		inward: [ix, iz],
		subject: [mx + ix * LOOKOUT_VIEW.inward, mz + iz * LOOKOUT_VIEW.inward]
	};
}

/** Where each animal lives: by its lookout, or given. */
function animalAt(species: string): XZ {
	const given = ANIMALS[species].at;
	if (given) return given;
	const lookout = LOOKOUTS.find((l) => l.subject === species);
	if (!lookout) throw new Error(`no place for ${species}`);
	return lookoutPlace(lookout.segment).subject;
}

/** The tower's ladder points in world (x, z): the props' nodes along the tower's front. */
function towerPoint(along: number): XZ {
	return [TOWER.at[0] + TOWER.front[0] * along, TOWER.at[1] + TOWER.front[1] * along];
}

// --- Terrain -----------------------------------------------------------------------------

const STAIR_PAD: XZ = [(STAIR.foot[0] + STAIR.head[0]) / 2, (STAIR.foot[1] + STAIR.head[1]) / 2];

/** The flat pads, each at the skeleton's height at its centre: the stair, the tower, Vovó's foot. */
function pads(ground: (x: number, z: number) => number): [XZ, number, number, number][] {
	return [
		[STAIR_PAD, ground(STAIR_PAD[0], STAIR_PAD[1]), STAIR.pad.r0, STAIR.pad.r1],
		[TOWER.at, ground(TOWER.at[0], TOWER.at[1]), TOWER.pad.r0, TOWER.pad.r1],
		[VOVO.at, ground(VOVO.at[0], VOVO.at[1]), VOVO.flat.r0, VOVO.flat.r1]
	];
}

// --- The build ---------------------------------------------------------------------------

/** The mature forest's mix: the park's oldest trees, tall and close. */
const TREE_MIX = weightsOf({
	jequitiba: 4,
	xaxim: 3,
	embauba: 2.5,
	jucara: 2.5,
	'ipe-rosa': 0.6,
	'pau-brasil': 0.6,
	araucaria: 0.4
});
/** Ground cover over DECORATION_KINDS (grass, flower, bush, fern, bromelia, beach-grass). */
const DECO_MIX = {
	forest: [0.1, 0.3, 2, 4.5, 3.5, 0],
	clearing: [2, 1.5, 1, 2, 1, 0]
};
const SCALE = { min: 0.95, max: 1.35 } as const;
/** Largest generated trunk (jequitibá 0.45 × 1.35). */
const MAX_TRUNK = 0.61;
/** Trunks keep this from a lookout's position (its 3.8 u platform), and from the tower's centre. */
const LOOKOUT_CLEARANCE = 2.9;
const TOWER_CLEARANCE = 5.5;
const EDGE_BAND = 4;
const EDGE_TREE_SPACING = 3.6;
const TRAIL_TREES: TrailTrees = { step: 5.5, offset: 3.55, spread: 0.8, density: 0.9 };

/** Builds zone 'copa' after the Vale and the Praia (its south and west seams). */
export function buildCopaZone(built: ReadonlyMap<ZoneId, ZoneBuild>): ZoneBuild {
	const problems: string[] = [];
	const { width, depth, ground, band } = zoneGround('copa', built);
	if (width !== N - 1 || depth !== N - 1) throw new Error('the Copa must be 160 × 160');
	const keep = band.seam;
	const skeleton = (x: number, z: number) => {
		const i = floor(x - OX + 0.5);
		const j = floor(z - OZ + 0.5);
		return ground[j * N + i];
	};
	const flats = pads(skeleton);
	for (let q = 0; q < CELLS; q++) {
		if (keep[q]) continue;
		const i = q % N;
		const x = OX + i;
		const z = OZ + (q - i) / N;
		let h = ground[q];
		for (const [at, y, r0, r1] of flats) h = flatten(h, x, z, at, y, r0, r1);
		ground[q] = h;
	}
	const heights = Float32Array.from(ground);
	const slope = slopeOf(heights);
	const local = ([x, z]: XZ): XZ => [x - OX, z - OZ];
	const groundAt = ([x, z]: XZ) => heightAt(heights, x - OX, z - OZ);

	// Zones and flags: forest, rock where too steep, clearings at Vovó, the tower and the stair.
	const zones = new Uint8Array(CELLS);
	const flags = new Uint8Array(CELLS);
	for (let q = 0; q < CELLS; q++) {
		const i = q % N;
		const x = OX + i;
		const z = OZ + (q - i) / N;
		zones[q] = slope[q] > GROW_SLOPE ? ZONE.highland : ZONE.slope;
		let f = FLAG.walkable;
		const cleared =
			distance(x, z, VOVO.at[0], VOVO.at[1]) <= VOVO.clearing ||
			distance(x, z, TOWER.at[0], TOWER.at[1]) <= TOWER.pad.r1 - 1 ||
			distance(x, z, STAIR_PAD[0], STAIR_PAD[1]) <= STAIR.pad.r1 - 1;
		if (cleared) f |= FLAG.cleared;
		else if (zones[q] === ZONE.slope) f |= FLAG.forest;
		flags[q] = f;
	}
	fenceEdges(
		flags,
		OX,
		OZ,
		(x, z) => SPEC.z1 - z < FENCE_MARGIN && x >= VALE_CROSSING[0] && x <= VALE_CROSSING[1]
	);

	// Arrival and the forest floor's reachability.
	const { arrival, inside, heading } = zoneArrival('copa', heights, N);
	const steps = stepsWithLinks(flags, heights, cellOf(inside.x, inside.z), []);

	// The raised parts and the story.
	const level = copaLevel(heights, groundAt, local, arrival, inside, heading);
	const clear = new Uint8Array(CELLS);
	reserveGameplay(clear, level);

	// Vegetation.
	const trails = level.trails.map((t) => t.points as XZ[]);
	const content = level.content as ZoneContent;
	const walkway = walkwayLine(content);
	const lookouts = content.mechanics.boardwalks.flatMap((b) => b.lookouts);
	const lanes = lookouts.map((l): [XZ, XZ] => [
		[l.position.x, l.position.z],
		[l.target.x, l.target.z]
	]);
	const bugio = local(animalAt('bugio'));
	const towerLocal = local(TOWER.at);
	const awayFromPaths = (x: number, z: number, r: number) =>
		trails.every((t) => polylineDistance(t, x, z) >= TRAIL_CLEARANCE + r) &&
		polylineDistance(walkway, x, z) >= WALKWAY_CLEARANCE + r &&
		lookouts.every((l) => distance(x, z, l.position.x, l.position.z) >= LOOKOUT_CLEARANCE + r) &&
		lanes.every((lane) => polylineDistance(lane, x, z) >= VIEW_LANE + r) &&
		distance(x, z, towerLocal[0], towerLocal[1]) >= TOWER_CLEARANCE + r;
	const trees = plantTrees(zones, flags, clear, slope, trails, awayFromPaths, bugio);
	content.trailMarks = placeTrailMarks(level.trails, trees, (x, z) => heightAt(heights, x, z), TRAIL_MARKS);
	const rocks = placeRocks(flags, clear, slope, awayFromPaths);
	const decorations = coverGround(flags, clear, slope, trails);
	const treeSet = pack(TREE_SPECIES, trees, heights);
	const rockSet = pack(ROCK_KINDS, rocks, heights);
	const decoSet = pack(DECORATION_KINDS, decorations, heights);
	const blocks = collisionBlocks(heights, treeSet, rockSet, []);

	for (const p of groundTargets(level)) if (steps[cellOf(p.x, p.z)] < 0) problems.push(`${p.id} unreachable`);

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
		grid: N,
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
			lookout: lookouts.length,
			ladder: mechanics.ladders?.length ?? 0,
			stair: mechanics.stairs?.length ?? 0,
			photoSubject: mechanics.photoSubjects?.length ?? 0,
			seed: content.seeds?.length ?? 0
		}),
		checksum: 0
	};
	world.checksum = checksumOf(world);
	level.checksum = checksumOf(level);
	return {
		id: 'copa',
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

/** The walkway's centre line, stair head to the loop and once round (zone-local). */
export function walkwayLine(content: ZoneContent): XZ[] {
	const [first, ...rest] = content.mechanics.boardwalks;
	return [[first.start.x, first.start.z], ...[first, ...rest].map((b): XZ => [b.end.x, b.end.z])];
}

// --- Story data ------------------------------------------------------------------------

function copaLevel(
	heights: Float32Array,
	groundAt: (p: XZ) => number,
	local: (p: XZ) => XZ,
	arrival: NonNullable<ZoneLevel['arrival']>,
	inside: Point & { yaw: number },
	heading: [number, number]
): ZoneLevel {
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

	// The walkway: the stair, the access to the loop, the loop's 24 segments (4 u over the ground at each vertex).
	const deck = (p: XZ): Point => at(p, WALKWAY.deck);
	const stairFoot = at(STAIR.foot);
	const stairHead = { ...at(STAIR.head), y: stairFoot.y + WALKWAY.deck };
	const subjects: PhotoSubject[] = [];
	const lookoutOf = (k: number): Lookout[] => {
		const spot = LOOKOUTS.find((l) => l.segment === ((k % 24) + 24) % 24);
		if (!spot) return [];
		const place = lookoutPlace(spot.segment);
		const a = deck(loopVertex(spot.segment));
		const b = deck(loopVertex(spot.segment + 1));
		const [px, pz] = local(place.mid);
		const position = { x: px, y: (a.y + b.y) / 2, z: pz };
		const target = at(place.subject, ANIMALS[spot.subject].lift);
		return [
			{
				id: `mirante-${spot.subject}`,
				position,
				camera: {
					x: px - place.inward[0] * LOOKOUT_VIEW.cameraBack,
					y: position.y + LOOKOUT_VIEW.cameraLift,
					z: pz - place.inward[1] * LOOKOUT_VIEW.cameraBack
				},
				target: plain(target)
			}
		];
	};
	const start = WALKWAY.startVertex;
	const boardwalks: BoardwalkSpec[] = [
		{
			id: 'passarela-acesso',
			start: plain(stairHead),
			end: deck(loopVertex(start)),
			width: WALKWAY.width,
			lookouts: []
		}
	];
	for (let j = 0; j < WALKWAY.sides; j++) {
		const k = start + j;
		boardwalks.push({
			id: `passarela-${String(j + 1).padStart(2, '0')}`,
			start: deck(loopVertex(k)),
			end: deck(loopVertex(k + 1)),
			width: WALKWAY.width,
			lookouts: lookoutOf(k)
		});
	}
	const lookouts = boardwalks.flatMap((b) => b.lookouts);
	for (const species of Object.keys(ANIMALS)) {
		const p = at(animalAt(species), ANIMALS[species].lift);
		subjects.push({ id: `foto-${species}`, species, position: plain(p) });
	}
	const stairs: Stair[] = [
		{
			id: 'escada-passarela',
			bottom: stairFoot,
			top: stairHead,
			width: STAIR.width,
			boardwalk: 'passarela-acesso'
		}
	];

	// The tower and its ladder (the props' nodes along its front).
	const towerBase = at(TOWER.at);
	const [lbx, lbz] = local(towerPoint(TOWER.ladder.base));
	const [lex, lez] = local(towerPoint(TOWER.ladder.exit));
	const ladder: LadderSpec = {
		id: 'torre-observacao',
		base: { x: lbx, y: towerBase.y, z: lbz },
		top: { x: lbx, y: towerBase.y + TOWER.ladder.top, z: lbz },
		exit: { x: lex, y: towerBase.y + TOWER.ladder.top, z: lez },
		radius: TOWER.ladder.radius
	};

	// Vovó Jequitibá's seeds: six round her trunk, one every 60°.
	const seeds: SeedSpot[] = [];
	for (let k = 0; k < VOVO.seeds.count; k++) {
		const [c, s] = unit24(2 + 4 * k);
		const p = at([VOVO.at[0] + VOVO.seeds.radius * c, VOVO.at[1] + VOVO.seeds.radius * s]);
		seeds.push({ id: `semente-${k + 1}`, species: 'jequitiba', mission: 3, radius: VOVO.seeds.pick, ...p });
	}

	const spawn = {
		x: inside.x,
		y: inside.y,
		z: inside.z,
		yawC: heading[0],
		yawS: heading[1],
		yaw: inside.yaw
	};
	const startCheckpoint: StoryCheckpoint = {
		id: 'entrada',
		mission: 0,
		min: { x: inside.x - 2, y: inside.y - 0.5, z: inside.z - 2 },
		max: { x: inside.x + 2, y: inside.y + 3, z: inside.z + 2 },
		spawn: plain(inside),
		yaw: inside.yaw
	};
	const checkpoints = [
		checkpoint('escada', at(CHECKPOINTS.escada), 'north', 1),
		checkpoint('vovo', at(CHECKPOINTS.vovo), 'southEast', 3),
		checkpoint('torre', at(CHECKPOINTS.torre), 'east', 4)
	];

	// C1's waypoints on the deck: only someone on it passes them (the ground is 4 u below).
	const waypoints: ZoneTrigger[] = [];
	for (let j = 0; j < WALKWAY.sides; j += WAYPOINTS.every) {
		const p = deck(loopVertex(start + j));
		waypoints.push(trigger(`passarela-${waypoints.length + 1}`, 'walkway', p, WAYPOINTS.radius, 1, 2));
	}
	const towerTop = plain(ladder.exit);
	const triggers: ZoneTrigger[] = [
		...waypoints,
		...seeds.map((s) => trigger(s.id, 'planting', s, s.radius, 3)),
		trigger('torre-topo', 'mirante', towerTop, 2, 4, 2)
	];

	const targets = [stairFoot, lookouts[0].position, at(VOVO_TARGET), ladder.base].map(plain);
	const missions: ZoneMission[] = [
		{
			id: 1,
			key: 'passarela-nas-copas',
			name: COPA_MISSION_NAMES[0],
			requires: [],
			target: targets[0],
			count: waypoints.length,
			dialogue: ['COPA_INTRO_1', 'COPA_INTRO_2', 'COPA_C1_DONE', 'FACT_VIDA_NAS_COPAS'],
			triggers: waypoints.map((w) => w.id)
		},
		{
			id: 2,
			key: 'fotos-do-alto',
			name: COPA_MISSION_NAMES[1],
			requires: [1],
			target: targets[1],
			count: subjects.length,
			dialogue: ['COPA_C2_INTRO', 'COPA_C2_HINT', 'COPA_C2_DONE', 'FACT_OBSERVACAO'],
			triggers: subjects.map((s) => s.id)
		},
		{
			id: 3,
			key: 'vovo-jequitiba',
			name: COPA_MISSION_NAMES[2],
			requires: [1],
			target: targets[2],
			count: seeds.length,
			dialogue: ['COPA_C3_INTRO', 'COPA_C3_DONE', 'FACT_ARVORE_MATRIZ', 'FACT_JEQUITIBA'],
			triggers: seeds.map((s) => s.id)
		},
		{
			id: 4,
			key: 'a-torre',
			name: COPA_MISSION_NAMES[3],
			requires: [1],
			target: targets[3],
			count: 1,
			dialogue: ['COPA_C4_INTRO', 'COPA_C4_SAFETY', 'COPA_C4_DONE', 'FACT_TORRE'],
			triggers: ['torre-topo']
		}
	];

	const collectibles: Collectible[] = missions.map((m) => ({
		id: `folha-missao-${m.id}`,
		kind: 'gold-leaf' as const,
		variant: '',
		mission: m.id,
		radius: 1.2,
		on: '',
		...m.target
	}));

	const vovo = at(VOVO.at);
	const towerHeading = headingTo(0, 0, TOWER.front[0], TOWER.front[1]);
	const landmarks: ZoneLandmark[] = [
		landmark(
			'vovo-jequitiba',
			'jequitiba',
			vovo,
			HEADING.south,
			COPA_TEXT.LABEL_VOVO.text,
			VOVO.height,
			true
		),
		landmark('torre', 'tower', towerBase, towerHeading, COPA_TEXT.LABEL_TORRE.text, TOWER.height, true),
		landmark(
			'placa-copa',
			'zone-sign',
			at(SIGNS.copa.at),
			HEADING.south,
			COPA_TEXT[SIGNS.copa.label].text,
			2.2
		),
		landmark(
			'placa-passarela',
			'zone-sign',
			at(SIGNS.passarela.at),
			HEADING.south,
			COPA_TEXT[SIGNS.passarela.label].text,
			2.2
		)
	];

	const trails: Trail[] = Object.entries(TRAILS).map(([id, points]) => ({
		id,
		halfWidth: TRAIL_HALF_WIDTH,
		points: points.map((p) => local(p) as [number, number])
	}));

	const content: ZoneContent = {
		// Filled after the planting: marks go on trunks by the trails.
		trailMarks: [],
		mechanics: {
			bridges: [],
			boardwalks,
			lookouts: [],
			cameraTraps: [],
			ladders: [ladder],
			stairs,
			photoSubjects: subjects
		},
		homes: homesOf(heights, groundAt),
		basins: [],
		seeds,
		text: COPA_TEXT
	};

	return {
		version: ZONE_VERSION,
		spawn,
		start: startCheckpoint,
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
		mirante: towerTop,
		handholds: [],
		arrival,
		content,
		checksum: 0
	};
}

const RARITY: Record<string, ZoneHome['rarity']> = {
	tucano: 'uncommon',
	saira: 'common',
	preguica: 'uncommon',
	'mico-leao-dourado': 'rare',
	bugio: 'rare'
};
const FACT: Record<string, string> = {
	tucano: 'FACT_TUCANO',
	saira: 'FACT_SAIRA',
	preguica: 'FACT_PREGUICA',
	'mico-leao-dourado': 'FACT_MICO',
	bugio: 'FACT_BUGIO'
};

function homesOf(heights: Float32Array, groundAt: (p: XZ) => number): ZoneHome[] {
	return Object.entries(ANIMALS).map(([species, a]): ZoneHome => {
		const p = animalAt(species);
		const point = { x: p[0] - OX, y: groundAt(p), z: p[1] - OZ };
		return {
			id: species,
			species,
			...point,
			group: a.group,
			radius: a.radius,
			rarity: RARITY[species],
			// By day, the bugios too: they howl when groups meet, at any hour.
			time: 'day',
			tree: { x: point.x, y: heightAt(heights, point.x, point.z), z: point.z },
			fact: FACT[species]
		};
	});
}

/** The album species among the homes, in survival's AnimalHome shape (the saíra is not in the album yet). */
function animalsOf(heights: Float32Array): AnimalHome[] {
	return ALBUM.filter((entry) => entry.species in ANIMALS).map((entry, id) => {
		const [wx, wz] = animalAt(entry.species);
		const x = wx - OX;
		const z = wz - OZ;
		return {
			id,
			species: entry.species,
			zone: entry.zone,
			radius: ANIMALS[entry.species].radius,
			x,
			y: heightAt(heights, x, z),
			z
		};
	});
}

/** Everything the story needs on the forest floor (the deck and the tower top are checked as a graph). */
export function groundTargets(level: ZoneLevel): { id: string; x: number; z: number }[] {
	const content = level.content;
	return [
		...level.missions
			.filter((m) => m.key !== 'fotos-do-alto')
			.map((m) => ({ id: `missao-${m.id}`, x: m.target.x, z: m.target.z })),
		...[level.start, ...level.checkpoints].map((c) => ({
			id: `checkpoint ${c.id}`,
			x: c.spawn.x,
			z: c.spawn.z
		})),
		...(content?.seeds ?? []).map((s) => ({ id: s.id, x: s.x, z: s.z })),
		...(content?.mechanics.stairs ?? []).map((s) => ({ id: s.id, x: s.bottom.x, z: s.bottom.z })),
		...(content?.mechanics.ladders ?? []).map((l) => ({ id: l.id, x: l.base.x, z: l.base.z }))
	];
}

/** Ground kept free of trees, rocks and ground cover: every place the story uses on the floor. */
function reserveGameplay(clear: Uint8Array, level: ZoneLevel) {
	for (const p of groundTargets(level)) paint(clear, p.x, p.z, 2.5, RESERVED);
	for (const l of level.landmarks) if (l.kind !== 'jequitiba') paint(clear, l.x, l.z, 2.5, RESERVED);
	const stair = level.content?.mechanics.stairs?.[0];
	if (stair)
		for (let t = 0; t <= 1; t += 0.25)
			paint(
				clear,
				stair.bottom.x + (stair.top.x - stair.bottom.x) * t,
				stair.bottom.z + (stair.top.z - stair.bottom.z) * t,
				2,
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
	awayFromPaths: (x: number, z: number, r: number) => boolean,
	bugio: XZ
): Item[] {
	const rng = new Rng(subSeed(SEED, 1));
	const trees: Item[] = [];
	const species = (name: string) => TREE_SPECIES.indexOf(name as TreeSpecies);
	const special = (name: string, [wx, wz]: XZ, scale: number) => {
		const [yawC, yawS] = rng.heading();
		const x = wx - OX;
		const z = wz - OZ;
		trees.push({ kind: species(name), x, z, scale, yawC, yawS });
		paint(clear, x, z, 2.5 + scale, OCCUPIED);
	};
	special('jequitiba', VOVO.at, VOVO.scale);
	for (const [name, a] of Object.entries(ANIMALS)) special(a.tree[0], animalAt(name), a.tree[1]);
	const grow = (x: number, z: number, density: number) => {
		const q = cellOf(x, z);
		const f = flags[q];
		if (clear[q] !== 0 || slope[q] > GROW_SLOPE || zones[q] !== ZONE.slope) return;
		if (f & FLAG.cleared || !(f & FLAG.walkable)) return;
		if (!awayFromPaths(x, z, MAX_TRUNK)) return;
		// The bugios' giant keeps its crown to itself.
		if (distance(x, z, bugio[0], bugio[1]) < 4) return;
		if (rng.next() >= density) return;
		const kind = rng.weighted(TREE_MIX);
		const scale = rng.range(SCALE.min, SCALE.max);
		const [yawC, yawS] = rng.heading();
		trees.push({ kind, x, z, scale, yawC, yawS });
		paint(clear, x, z, 1.2, OCCUPIED);
	};
	lineTrails(trails, TRAIL_TREES, rng, grow);
	const points = poissonDisk(rng, 1, 1, N - 2, N - 2, TREE_SPACING);
	for (let k = 0; k < points.length; k += 2) grow(points[k], points[k + 1], 1);
	const edge = poissonDisk(rng, 1, 1, N - 2, N - 2, EDGE_TREE_SPACING);
	for (let k = 0; k < edge.length; k += 2) {
		const x = edge[k];
		const z = edge[k + 1];
		const toEdge = Math.min(x, z, N - 1 - x, N - 1 - z);
		const way = N - 1 - z < EDGE_BAND + 2 && x + OX > VALE_CROSSING[0] - 6 && x + OX < VALE_CROSSING[1] + 6;
		if (toEdge < EDGE_BAND && !way) grow(x, z, 1);
	}
	return trees;
}

function placeRocks(
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
		if (clear[q] !== 0 || slope[q] > GROW_SLOPE || !(flags[q] & FLAG.walkable) || flags[q] & FLAG.cleared)
			continue;
		if (rng.next() >= 0.3) continue;
		// An old forest's floor: fallen trunks as often as boulders.
		const kind = rng.weighted([0.3, 0.3, 0.4]);
		const scale = kind === 0 ? rng.range(0.7, 1.5) : kind === 1 ? rng.range(0.5, 1) : rng.range(0.9, 1.4);
		const reach = kind === 0 ? 0.8 * scale : kind === 2 ? 1.25 * scale : 0.6 * scale;
		if (!awayFromPaths(x, z, reach)) continue;
		const [yawC, yawS] = rng.heading();
		rocks.push({ kind, x, z, scale, yawC, yawS });
		paint(clear, x, z, 1.5, OCCUPIED);
	}
	return rocks;
}

function coverGround(flags: Uint8Array, clear: Uint8Array, slope: Float32Array, trails: XZ[][]): Item[] {
	const rng = new Rng(subSeed(SEED, 3));
	const out: Item[] = [];
	const points = poissonDisk(rng, 1, 1, N - 2, N - 2, DECORATION_SPACING);
	for (let k = 0; k < points.length; k += 2) {
		const x = points[k];
		const z = points[k + 1];
		const q = cellOf(x, z);
		const f = flags[q];
		if (clear[q] & RESERVED || slope[q] > GROW_SLOPE || !(f & FLAG.walkable)) continue;
		if (trails.some((t) => polylineDistance(t, x, z) < TRAIL_HALF_WIDTH + 0.4)) continue;
		const kind = rng.weighted(f & FLAG.cleared ? DECO_MIX.clearing : DECO_MIX.forest);
		const scale = rng.range(0.7, 1.4);
		const [yawC, yawS] = rng.heading();
		out.push({ kind, x, z, scale, yawC, yawS });
	}
	return out;
}
