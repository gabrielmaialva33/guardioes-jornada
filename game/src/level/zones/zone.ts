/**
 * A zone of the park as data: the same SurvivalWorld + StoryLevel shapes as
 * level/build.ts buildStoryWorld, in zone-local coordinates (the zone's
 * north-west corner is (0, 0)), plus the zone's world offset.
 *
 * Shapes: `world.size` is the zone's width (x) and `world.grid` its row
 * stride (width + 1); `heights` holds (width + 1) × (depth + 1) samples, so a
 * zone wider than deep (Praia, Manguezal: 200 × 160) has `depth` rows + 1. A
 * square zone (the Reserva, Vale, Copa: 160 × 160) is exactly the Reserva's
 * shape. `world.blocks` holds one CollisionBlock per 40 u chunk, row-major.
 *
 * Skeleton zones (P20) carry relief, rivers, zones and flags, collision,
 * their entry and spawn; no missions, props or vegetation yet. Zones with
 * content (the Vale, P25: vale.ts) start from the same ground and arrival.
 * Pure and deterministic (survival/random.ts's rules).
 */
import { checksumOf } from '../../survival/checksum.ts';
import { clamp, floor } from '../../survival/noise.ts';
import {
	BLOCK_SIZE,
	COLLISION_STEP,
	type CollisionBlock,
	DECORATION_KINDS,
	FLAG,
	type Placements,
	type Point,
	ROCK_KINDS,
	type SurvivalWorld,
	TREE_SPECIES,
	WADE_LIMIT,
	WALK_SLOPE,
	WATER_LEVEL,
	ZONE
} from '../../survival/types.ts';
import { insidePolygon } from '../geometry.ts';
import type { Portal, StoryCheckpoint, StoryLevel } from '../types.ts';
import { type BandResult, type BandSide, stitchBands } from './band.ts';
import type { ZoneContent, ZoneLandmark, ZoneMission, ZoneTrigger } from './content.ts';
import { carveRiver, stationsIn } from './river.ts';
import { coastLine, skeletonHeight } from './skeleton.ts';
import {
	COSTAO,
	ENTRIES,
	MANGUE,
	PARK_SEED,
	PARK_ZONES,
	RESTINGA,
	SEAMS,
	type Side,
	type XZ,
	ZONE_VERSION,
	type ZoneId,
	type ZoneSpec
} from './spec.ts';

/** How a skeleton zone is entered: the opening on its edge (zone-local) and what opens it. */
export interface ZoneArrival {
	id: string;
	/** Mission key of the Reserva that opens it ('mirante', mission 6). */
	requires: string;
	label: string;
	/** The opening: on `side`, at local x (west/east) or z (north/south) `at`, from `from` to `to` along it. */
	gap: { side: Side; at: number; from: number; to: number; y: number };
	/** Just inside, facing into the zone (engine yaw). */
	inside: Point & { yaw: number };
}

/**
 * StoryLevel in a zone's local coordinates. The Reserva's carries its F1
 * `portal`; the other zones carry their `arrival` instead (level/types.ts
 * Portal only names the east portal: a wider Portal type is pB's call).
 * Zone missions, triggers and landmarks widen the Reserva's keys and kinds
 * (content.ts), and a zone with content adds it under `content`.
 */
export type ZoneLevel = Omit<StoryLevel, 'portal' | 'missions' | 'triggers' | 'landmarks'> & {
	missions: ZoneMission[];
	triggers: ZoneTrigger[];
	landmarks: ZoneLandmark[];
	portal?: Portal;
	arrival?: ZoneArrival;
	content?: ZoneContent;
};

export interface ZoneBuild {
	id: ZoneId;
	spec: ZoneSpec;
	/** World position of the zone's local origin (its north-west corner). */
	offsetX: number;
	offsetZ: number;
	/** Extent in units: x and z. */
	width: number;
	depth: number;
	world: SurvivalWorld;
	level: ZoneLevel;
	/** Stitching diagnostics (skeleton zones). */
	band?: Omit<BandResult, 'seam'>;
}

/** World height of a built zone's vertex at world (x, z), both integers on its grid. */
export function zoneHeight(build: ZoneBuild, x: number, z: number): number {
	const { world, offsetX, offsetZ } = build;
	return world.heights[(z - offsetZ) * world.grid + x - offsetX];
}

/** The fixed zone's heights along a seam, one per unit from seam.from. */
export function seamProfile(fixed: ZoneBuild, seamIndex: number): Float32Array {
	const seam = SEAMS[seamIndex];
	const out = new Float32Array(seam.to - seam.from + 1);
	const vertical = seam.side === 'west' || seam.side === 'east';
	for (let k = 0; k < out.length; k++) {
		const along = seam.from + k;
		out[k] = vertical ? zoneHeight(fixed, seam.at, along) : zoneHeight(fixed, along, seam.at);
	}
	return out;
}

/** Engine yaw (0 faces +z, south) of each way into a zone: from the west you face east, and so on. */
// biome-ignore lint/suspicious/noApproximativeNumericConstant: the determinism scan allows no Math member but the exact operations; this literal is Math.PI's exact double (as level/layout.ts).
const PI = 3.141592653589793;
const FACING_IN: Record<Side, number> = { west: PI / 2, east: -PI / 2, north: 0, south: PI };

/** A zone's ground before the river: its skeleton stitched to the zones built before (world vertex (x0 + i, z0 + j) at j · side + i). */
export interface ZoneGround {
	spec: ZoneSpec;
	width: number;
	depth: number;
	side: number;
	ground: Float64Array;
	band: BandResult;
}

export function zoneGround(
	id: Exclude<ZoneId, 'reserva'>,
	built: ReadonlyMap<ZoneId, ZoneBuild>
): ZoneGround {
	const spec = PARK_ZONES[id];
	const width = spec.x1 - spec.x0;
	const depth = spec.z1 - spec.z0;
	const side = width + 1;
	const ground = new Float64Array(side * (depth + 1));
	for (let j = 0; j <= depth; j++)
		for (let i = 0; i <= width; i++) ground[j * side + i] = skeletonHeight(id, spec.x0 + i, spec.z0 + j);
	const sides: BandSide[] = [];
	SEAMS.forEach((seam, k) => {
		if (seam.zone !== id) return;
		const fixed = built.get(seam.fixed);
		if (!fixed) throw new Error(`zone ${id} needs ${seam.fixed} built first`);
		sides.push({ seam, profile: seamProfile(fixed, k) });
	});
	const band = stitchBands(ground, spec.x0, spec.z0, width, depth, sides);
	return { spec, width, depth, side, ground, band };
}

/** How a zone is entered (spec.ts ENTRIES), on its final heights: the opening, the spawn just inside and its heading. */
export function zoneArrival(
	id: Exclude<ZoneId, 'reserva'>,
	heights: Float32Array,
	side: number
): { arrival: ZoneArrival; inside: Point & { yaw: number }; heading: [number, number] } {
	const spec = PARK_ZONES[id];
	const entry = ENTRIES[id];
	const toLocal = ([x, z]: XZ): XZ => [x - spec.x0, z - spec.z0];
	const at = (p: XZ): Point => {
		const [lx, lz] = toLocal(p);
		return { x: lx, y: heightIn(heights, side, lx, lz), z: lz };
	};
	const inside = { ...at(entry.inside), yaw: FACING_IN[entry.side] };
	const vertical = entry.side === 'west' || entry.side === 'east';
	const [ex, ez] = toLocal(entry.at);
	const arrival: ZoneArrival = {
		id,
		requires: entry.requires,
		label: entry.label,
		gap: {
			side: entry.side,
			at: vertical ? ex : ez,
			from: (vertical ? ez : ex) - 4,
			to: (vertical ? ez : ex) + 4,
			y: at(entry.at).y
		},
		inside
	};
	return { arrival, inside, heading: HEADING_IN[entry.side] };
}

/** Builds a skeleton zone from the already built zones its seams read (spec.ts BUILD_ORDER). */
export function buildSkeletonZone(
	id: Exclude<ZoneId, 'reserva'>,
	built: ReadonlyMap<ZoneId, ZoneBuild>
): ZoneBuild {
	// Relief: the skeleton, stitched to the zones built before, then the park river.
	const { spec, width, depth, side, ground, band } = zoneGround(id, built);
	const n = side * (depth + 1);
	const river = carveRiver(ground, spec.x0, spec.z0, width, depth, band.seam);
	const heights = Float32Array.from(ground);

	// Zones and flags.
	const zones = new Uint8Array(n);
	const flags = new Uint8Array(n);
	for (let j = 0; j <= depth; j++)
		for (let i = 0; i <= width; i++) {
			const q = j * side + i;
			const x = spec.x0 + i;
			const z = spec.z0 + j;
			const h = heights[q];
			const shore = x - coastLine(z);
			const wet = river.wet[q] === 1;
			const zone = wet
				? ZONE.river
				: h < WATER_LEVEL
					? ZONE.sea
					: id === 'praia' && h > 2 && insidePolygon(COSTAO, x, z)
						? ZONE.highland
						: id === 'manguezal' && h <= 1.5 && insidePolygon(MANGUE, x, z)
							? ZONE.mangrove
							: (id === 'praia' || id === 'manguezal') && shore < 2
								? ZONE.beach
								: insidePolygon(RESTINGA, x, z) || ((id === 'praia' || id === 'manguezal') && shore < 40)
									? ZONE.restinga
									: x >= 110
										? ZONE.slope
										: ZONE.lowland;
			zones[q] = zone;
			let f = 0;
			if (wet) f |= FLAG.river;
			else if (h > WADE_LIMIT) f |= FLAG.walkable;
			if (
				!wet &&
				h >= WATER_LEVEL &&
				(zone === ZONE.lowland || zone === ZONE.slope || zone === ZONE.mangrove)
			)
				f |= FLAG.forest;
			flags[q] = f;
		}

	// Arrival: the opening on the zone's edge, and a spawn just inside it.
	const { arrival, inside, heading: spawnHeading } = zoneArrival(id, heights, side);

	const steps = walkStepsRect(
		flags,
		heights,
		width,
		depth,
		floor(inside.z + 0.5) * side + floor(inside.x + 0.5)
	);
	const stations = stationsIn(spec.x0, spec.z0, spec.x1, spec.z1);
	const world: SurvivalWorld = {
		generatorVersion: ZONE_VERSION,
		seed: PARK_SEED,
		attempt: 1,
		worldSeed: PARK_SEED,
		problems: band.unresolved > 0 ? [`${band.unresolved} band vertices over the slope limit`] : [],
		size: width,
		grid: side,
		waterLevel: WATER_LEVEL,
		heights,
		zones,
		flags,
		baseSteps: steps,
		highlandHeight: Number.POSITIVE_INFINITY,
		river: {
			points: stations.map((s) => ({ x: s.x - spec.x0, z: s.z - spec.z0, water: s.water })),
			halfWidth: stations.reduce((m, s) => Math.max(m, s.halfWidth), 0),
			depth: stations.reduce((m, s) => Math.max(m, s.depth), 0)
		},
		crossings: [],
		base: {
			x: inside.x,
			y: inside.y,
			z: inside.z,
			yawC: spawnHeading[0],
			yawS: spawnHeading[1],
			radius: 0,
			spawn: { x: inside.x, y: inside.y, z: inside.z },
			pieces: []
		},
		pois: [],
		threats: [],
		corridor: { cells: [], length: 0, fromSize: 0, toSize: 0, joinsTwoLargest: false },
		animals: [],
		cameraSpots: [],
		resources: [],
		trees: emptyPlacements(TREE_SPECIES),
		rocks: emptyPlacements(ROCK_KINDS),
		decorations: emptyPlacements(DECORATION_KINDS),
		blocks: collisionBlocks(heights, width, depth),
		counts: emptyCounts(),
		checksum: 0
	};
	world.checksum = checksumOf(world);

	const start: StoryCheckpoint = {
		id: 'chegada',
		mission: 0,
		min: { x: inside.x - 2, y: inside.y - 0.5, z: inside.z - 2 },
		max: { x: inside.x + 2, y: inside.y + 3, z: inside.z + 2 },
		spawn: { x: inside.x, y: inside.y, z: inside.z },
		yaw: inside.yaw
	};
	const level: ZoneLevel = {
		version: ZONE_VERSION,
		spawn: {
			x: inside.x,
			y: inside.y,
			z: inside.z,
			yawC: spawnHeading[0],
			yawS: spawnHeading[1],
			yaw: inside.yaw
		},
		start,
		checkpoints: [],
		killY: -6,
		missions: [],
		obbies: [],
		collectibles: [],
		triggers: [],
		landmarks: [],
		trails: [],
		planting: [],
		pool: { x: 0, z: 0, water: WATER_LEVEL, axisX: 1, axisZ: 0, halfLength: 0, halfWidth: 0 },
		mirante: { x: inside.x, y: inside.y, z: inside.z },
		handholds: [],
		arrival,
		checksum: 0
	};
	level.checksum = checksumOf(level);
	return {
		id,
		spec,
		offsetX: spec.x0,
		offsetZ: spec.z0,
		width,
		depth,
		world,
		level,
		band: { unresolved: band.unresolved, updates: band.updates, where: band.where }
	};
}

/** Unit headings (yawC, yawS) of each way in, matching FACING_IN (front = (yawS, yawC)). */
const HEADING_IN: Record<Side, [number, number]> = {
	west: [0, 1],
	east: [0, -1],
	north: [1, 0],
	south: [-1, 0]
};

/** Bilinear height at local (lx, lz) of a grid `side` samples wide, clamped to it. */
export function heightIn(heights: Float32Array, side: number, lx: number, lz: number): number {
	const rows = heights.length / side;
	const cx = clamp(lx, 0, side - 1);
	const cz = clamp(lz, 0, rows - 1);
	const i = Math.min(side - 2, floor(cx));
	const j = Math.min(rows - 2, floor(cz));
	const tx = cx - i;
	const tz = cz - j;
	const q = j * side + i;
	return (
		(heights[q] + (heights[q + 1] - heights[q]) * tx) * (1 - tz) +
		(heights[q + side] + (heights[q + side + 1] - heights[q + side]) * tx) * tz
	);
}

export function emptyPlacements<K extends string>(kinds: readonly K[]): Placements<K> {
	return {
		kinds,
		count: 0,
		kind: new Uint8Array(0),
		block: new Uint8Array(0),
		x: new Float32Array(0),
		y: new Float32Array(0),
		z: new Float32Array(0),
		scale: new Float32Array(0),
		yawC: new Float32Array(0),
		yawS: new Float32Array(0)
	};
}

/** Every count key the runtime sizes pools by, at zero (survival generate.ts countAll's keys). */
export function emptyCounts(): Record<string, number> {
	const counts: Record<string, number> = { instances: 0 };
	for (const s of TREE_SPECIES) counts[`tree:${s}`] = 0;
	for (const r of ROCK_KINDS) counts[`rock:${r}`] = 0;
	for (const d of DECORATION_KINDS) counts[`decoration:${d}`] = 0;
	return counts;
}

/** survival collisionBlocks for a rectangle: one block per 40 u chunk, ground every COLLISION_STEP u. */
export function collisionBlocks(heights: Float32Array, width: number, depth: number): CollisionBlock[] {
	const side = width + 1;
	const blocksX = width / BLOCK_SIZE;
	const blocksZ = depth / BLOCK_SIZE;
	const per = BLOCK_SIZE / COLLISION_STEP + 1;
	const out: CollisionBlock[] = [];
	for (let bz = 0; bz < blocksZ; bz++)
		for (let bx = 0; bx < blocksX; bx++) {
			const x0 = bx * BLOCK_SIZE;
			const z0 = bz * BLOCK_SIZE;
			const ground = new Float32Array(per * per);
			for (let b = 0; b < per; b++)
				for (let a = 0; a < per; a++)
					ground[b * per + a] = heights[(z0 + b * COLLISION_STEP) * side + x0 + a * COLLISION_STEP];
			let minY = Number.POSITIVE_INFINITY;
			let maxY = Number.NEGATIVE_INFINITY;
			for (let j = z0; j <= z0 + BLOCK_SIZE; j++)
				for (let i = x0; i <= x0 + BLOCK_SIZE; i++) {
					minY = Math.min(minY, heights[j * side + i]);
					maxY = Math.max(maxY, heights[j * side + i]);
				}
			out.push({
				index: bz * blocksX + bx,
				bx,
				bz,
				x0,
				z0,
				minY,
				maxY,
				heights: ground,
				cylinders: new Float32Array(0),
				boxes: new Float32Array(0),
				decks: new Float32Array(0)
			});
		}
	return out;
}

/**
 * survival walkSteps on a rectangle: steps in half units over walkable
 * vertices and their 8 neighbours (2 straight, 3 diagonal), a rise of at most
 * WALK_SLOPE per unit of run, no corner cutting; −1 where unreachable.
 */
export function walkStepsRect(
	flags: Uint8Array,
	heights: Float32Array,
	width: number,
	depth: number,
	start: number
): Int16Array {
	const side = width + 1;
	const n = side * (depth + 1);
	const far = 0x7fffffff;
	const half = new Int32Array(n).fill(far);
	const walkable = (q: number) => (flags[q] & FLAG.walkable) !== 0;
	const buckets: number[][] = [[], [], [], []];
	if (walkable(start)) {
		half[start] = 0;
		buckets[0].push(start);
	}
	let pending = buckets[0].length;
	for (let d = 0; pending > 0; d++) {
		const bucket = buckets[d & 3];
		for (let k = 0; k < bucket.length; k++) {
			const q = bucket[k];
			if (half[q] !== d) continue;
			const i = q % side;
			const j = (q - i) / side;
			for (let dz = -1; dz <= 1; dz++)
				for (let dx = -1; dx <= 1; dx++) {
					if (dx === 0 && dz === 0) continue;
					const a = i + dx;
					const b = j + dz;
					if (a < 0 || b < 0 || a > width || b > depth) continue;
					const o = b * side + a;
					const diagonal = dx !== 0 && dz !== 0;
					if (!walkable(o) || (diagonal && !(walkable(j * side + a) && walkable(b * side + i)))) continue;
					if (Math.abs(heights[o] - heights[q]) > WALK_SLOPE * (diagonal ? 1.41 : 1)) continue;
					const next = d + (diagonal ? 3 : 2);
					if (next < half[o]) {
						half[o] = next;
						buckets[next & 3].push(o);
						pending++;
					}
				}
		}
		pending -= bucket.length;
		bucket.length = 0;
	}
	const steps = new Int16Array(n);
	for (let q = 0; q < n; q++) steps[q] = half[q] === far ? -1 : Math.min(32767, (half[q] + 1) >> 1);
	return steps;
}
