/**
 * One 40 u chunk of the endless world as data, in the shapes the runtime
 * already reads from survival/types.ts for a block: 1 u heights, zones and
 * flags, placements per family sorted by kind, a CollisionBlock and a
 * checksum, plus the biome weights and the river segments. Typed arrays only,
 * each on its own buffer, so a Worker can post a chunk with every buffer in
 * the transfer list (chunkTransferables).
 *
 * Every vertex and every placement is a pure function of its world position
 * and the seed (macro.ts, rivers.ts, biomes.ts, scatter.ts); generateArea of
 * a bigger rectangle gives exactly the union of its chunks, which is what the
 * border, order and scatter tests compare.
 */
import { clamp, fbm, floor } from '../survival/noise.ts';
import { Rng } from '../survival/random.ts';
import {
	type CollisionBlock,
	DECORATION_KINDS,
	type DecorationKind,
	FLAG,
	type Placements,
	ROCK_KINDS,
	type RockKind,
	TREE_SPECIES,
	type TreeSpecies,
	WADE_LIMIT,
	WATER_LEVEL,
	ZONE
} from '../survival/types.ts';
import {
	BIOME_COUNT,
	BIOME_ZONE,
	biomeWeights,
	DECO_MIX,
	drawBiome,
	exposureOf,
	GRAZED,
	needsExposure,
	PASTURE_DECO,
	PASTURE_DENSITY,
	PASTURE_TREES,
	quantizeWeights,
	RIVER_ROCKS,
	ROCK_SHARE,
	TREE_DENSITY,
	TREE_MIX,
	TREE_SCALE,
	WOODED
} from './biomes.ts';
import {
	CHUNK_SIDE,
	CHUNK_SIZE,
	COLLISION_SIDE,
	DETAIL_VERSION,
	isHandMade,
	type LayerSeeds,
	MACRO_VERSION,
	WORLD_SEED
} from './constants.ts';
import { chunkChecksum } from './checksum.ts';
import { coastX, macroFields, newMacroPoint, samplePoint, serraFoot } from './macro.ts';
import { CARVE_FAR, carve, newRiverSample, type RiverSegment, riverLattice } from './rivers.ts';
import { blueNoise } from './scatter.ts';

/** Floats per river segment in WorldChunk.rivers: ax, az, aWater, bx, bz, bWater, halfWidth, depth. */
export const RIVER_STRIDE = 8;
/** Minimum distance between trees and rocks (one layer, so they never overlap), and between decorations. */
export const TREE_SPACING = 3.8;
export const DECO_SPACING = 2.6;
/** Decorations keep this far from any tree-layer point. */
const DECO_CLEARANCE = 1;
/** Steepest ground a tree grows on (survival's). */
const TREE_SLOPE = 1.3;
/** Collision sizes, as survival/generate.ts collisionBlocks. */
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

export interface WorldChunk {
	macroVersion: number;
	detailVersion: number;
	seed: number;
	cx: number;
	cz: number;
	/** World position of vertex (0, 0): (cx · 40, cz · 40). */
	x0: number;
	z0: number;
	size: number;
	/** Samples per side (41), 0 for a hand-made chunk. */
	grid: number;
	/**
	 * A Reserva chunk: its data is level/build.ts's, never generated, and every
	 * array here is empty. F2 blends the band around it.
	 */
	handMade: boolean;
	waterLevel: number;
	/** grid² ground heights, row-major: index j · grid + i is (x0 + i, z0 + j). Edges equal the neighbours'. */
	heights: Float32Array;
	/** grid² survival ZONE values (biomes.ts BIOME_ZONE, or river). */
	zones: Uint8Array;
	/** grid² survival FLAG bits (walkable, river, cleared, forest). */
	flags: Uint8Array;
	/** grid² dominant biome (biomes.ts BIOMES). */
	biome: Uint8Array;
	/** grid² × BIOME_COUNT weights, vertex-major; each vertex sums to 255. */
	biomeWeights: Uint8Array;
	/** River segments whose water reaches the chunk, RIVER_STRIDE floats each. */
	rivers: Float32Array;
	/** Stable link id of each segment (rivers.ts RiverSegment.id). */
	riverIds: Int32Array;
	/** rivers.ts RIVER_FLAG bits of each segment. */
	riverFlags: Uint8Array;
	trees: Placements<TreeSpecies>;
	rocks: Placements<RockKind>;
	decorations: Placements<DecorationKind>;
	/** Collision in survival's shape: bx, bz are cx, cz; index is 0 (the runtime assigns its slot). */
	collision: CollisionBlock;
	checksum: number;
}

/** A rectangle's worth of generated data (a chunk, or the reference area of the tests). */
export interface Area {
	x0: number;
	z0: number;
	/** Samples per side. */
	sideX: number;
	sideZ: number;
	heights: Float32Array;
	zones: Uint8Array;
	flags: Uint8Array;
	biome: Uint8Array;
	biomeWeights: Uint8Array;
	segments: RiverSegment[];
	trees: Placements<TreeSpecies>;
	rocks: Placements<RockKind>;
	decorations: Placements<DecorationKind>;
}

interface Item {
	kind: number;
	x: number;
	z: number;
	scale: number;
	yawC: number;
	yawS: number;
}

/** The chunk at (cx, cz) for a world seed: a pure function of the three. */
export function generateChunk(cx: number, cz: number, seed: number = WORLD_SEED): WorldChunk {
	const x0 = cx * CHUNK_SIZE;
	const z0 = cz * CHUNK_SIZE;
	if (isHandMade(cx, cz)) return finish(handMadeChunk(cx, cz, seed));
	const area = generateArea(x0, z0, CHUNK_SIZE, CHUNK_SIZE, seed);
	const rivers = area.segments.filter((g) => touches(g, x0, z0, x0 + CHUNK_SIZE, z0 + CHUNK_SIZE));
	const river = new Float32Array(rivers.length * RIVER_STRIDE);
	rivers.forEach((g, k) => {
		river.set([g.ax, g.az, g.aw, g.bx, g.bz, g.bw, g.half, g.depth], k * RIVER_STRIDE);
	});
	return finish({
		macroVersion: MACRO_VERSION,
		detailVersion: DETAIL_VERSION,
		seed,
		cx,
		cz,
		x0,
		z0,
		size: CHUNK_SIZE,
		grid: CHUNK_SIDE,
		handMade: false,
		waterLevel: WATER_LEVEL,
		heights: area.heights,
		zones: area.zones,
		flags: area.flags,
		biome: area.biome,
		biomeWeights: area.biomeWeights,
		rivers: river,
		riverIds: Int32Array.from(rivers, (g) => g.id),
		riverFlags: Uint8Array.from(rivers, (g) => g.flags),
		trees: area.trees,
		rocks: area.rocks,
		decorations: area.decorations,
		collision: collisionOf(cx, cz, area),
		checksum: 0
	});
}

function finish(chunk: WorldChunk): WorldChunk {
	chunk.checksum = chunkChecksum(chunk);
	return chunk;
}

/** Water of the segment, grown by its half width, overlaps the closed box. */
function touches(g: RiverSegment, x0: number, z0: number, x1: number, z1: number) {
	return (
		Math.min(g.ax, g.bx) - g.half <= x1 &&
		Math.max(g.ax, g.bx) + g.half >= x0 &&
		Math.min(g.az, g.bz) - g.half <= z1 &&
		Math.max(g.az, g.bz) + g.half >= z0
	);
}

function handMadeChunk(cx: number, cz: number, seed: number): WorldChunk {
	const x0 = cx * CHUNK_SIZE;
	const z0 = cz * CHUNK_SIZE;
	return {
		macroVersion: MACRO_VERSION,
		detailVersion: DETAIL_VERSION,
		seed,
		cx,
		cz,
		x0,
		z0,
		size: CHUNK_SIZE,
		grid: 0,
		handMade: true,
		waterLevel: WATER_LEVEL,
		heights: new Float32Array(0),
		zones: new Uint8Array(0),
		flags: new Uint8Array(0),
		biome: new Uint8Array(0),
		biomeWeights: new Uint8Array(0),
		rivers: new Float32Array(0),
		riverIds: new Int32Array(0),
		riverFlags: new Uint8Array(0),
		trees: pack(TREE_SPECIES, [], new Float32Array(0), 0, 0, 0),
		rocks: pack(ROCK_KINDS, [], new Float32Array(0), 0, 0, 0),
		decorations: pack(DECORATION_KINDS, [], new Float32Array(0), 0, 0, 0),
		collision: {
			index: 0,
			bx: cx,
			bz: cz,
			x0,
			z0,
			minY: 0,
			maxY: 0,
			heights: new Float32Array(0),
			cylinders: new Float32Array(0),
			boxes: new Float32Array(0),
			decks: new Float32Array(0)
		},
		checksum: 0
	};
}

/**
 * Everything in [x0, x0 + width] × [z0, z0 + depth] (vertices on the closed
 * rectangle, placements in the half-open one). Generation order, the size of
 * the rectangle and earlier calls never change a value.
 */
export function generateArea(x0: number, z0: number, width: number, depth: number, seed: number): Area {
	const fields = macroFields(seed);
	const layers = fields.layers;
	const sideX = width + 1;
	const sideZ = depth + 1;
	const n = sideX * sideZ;
	const heights = new Float32Array(n);
	const zones = new Uint8Array(n);
	const flags = new Uint8Array(n);
	const biome = new Uint8Array(n);
	const weights = new Uint8Array(n * BIOME_COUNT);
	/** Half width minus distance to the wettest river, for the rocks by the water. */
	const wetness = new Float32Array(n);
	const x1 = x0 + width;
	const z1 = z0 + depth;
	const segments = riverLattice(seed).segmentsNear(x0, z0, x1, z1, CARVE_FAR + 1);
	fields.prepare(x0, z0, x1, z1);
	const p = newMacroPoint();
	const r = newRiverSample();
	const w = new Float64Array(BIOME_COUNT);
	for (let j = 0; j < sideZ; j++) {
		const z = z0 + j;
		const coast = coastX(z, layers);
		const foot = serraFoot(z, layers);
		for (let i = 0; i < sideX; i++) {
			const x = x0 + i;
			const q = j * sideX + i;
			samplePoint(x, z, coast, foot, fields, p);
			carve(x, z, p.ground, segments, r);
			const h = r.height;
			heights[q] = h;
			wetness[q] = r.wet;
			const exposure = needsExposure(p.s) ? exposureOf(fields.exposure.at(x, z), p.s) : 0;
			const b = biomeWeights(p.e, p.s, r.estuary, exposure, w);
			quantizeWeights(w, weights, q * BIOME_COUNT);
			biome[q] = b;
			// Seaward of the beach the water is the sea's, even where a river's last link runs out.
			const inWater = r.wet > 0 && h < r.water && !(p.e < 0 && h < WATER_LEVEL);
			zones[q] = inWater ? ZONE.river : h < WATER_LEVEL ? ZONE.sea : BIOME_ZONE[b];
			let f = 0;
			if (inWater) f = FLAG.river | (r.depth < 0.5 ? FLAG.walkable : 0);
			else if (h > WADE_LIMIT) f = FLAG.walkable;
			if (!inWater && h >= WATER_LEVEL && WOODED[b])
				f |= GRAZED[b] && pasture(x, z, p.e, p.reserve, layers) ? FLAG.cleared : FLAG.forest;
			flags[q] = f;
		}
	}

	// Trees and rocks share one blue-noise layer, so they never overlap; decorations keep clear of it.
	const layer = blueNoise(
		layers.trees,
		TREE_SPACING,
		x0 - DECO_CLEARANCE,
		z0 - DECO_CLEARANCE,
		x1 + 1,
		z1 + 1
	);
	const trees: Item[] = [];
	const rocks: Item[] = [];
	// Nearest vertex from world coordinates, so a chunk and a bigger area pick the same one.
	const at = (x: number, z: number) => (floor(z + 0.5) - z0) * sideX + floor(x + 0.5) - x0;
	for (let k = 0; k < layer.length; k += 3) {
		const x = layer[k];
		const z = layer[k + 1];
		if (x < x0 || x >= x1 || z < z0 || z >= z1) continue;
		const q = at(x, z);
		const f = flags[q];
		if (f & FLAG.river || heights[q] < WATER_LEVEL) continue;
		const rng = new Rng(layer[k + 2] ^ layers.species);
		const b = drawBiome(weights, q * BIOME_COUNT, rng.next() * 255);
		const pasture = (f & FLAG.cleared) !== 0;
		const density = pasture ? PASTURE_DENSITY : TREE_DENSITY[b];
		const roll = rng.next();
		if (roll < density && f & FLAG.walkable && slopeAt(heights, sideX, x0, z0, x, z) <= TREE_SLOPE) {
			const kind = rng.weighted(pasture ? PASTURE_TREES : TREE_MIX[b]);
			const [lo, hi] = TREE_SCALE[b];
			const scale = rng.range(lo, hi);
			const [yawC, yawS] = rng.heading();
			trees.push({ kind, x, z, scale, yawC, yawS });
			continue;
		}
		const share = wetness[q] > -9 ? RIVER_ROCKS : ROCK_SHARE[b];
		if (rng.next() >= share) continue;
		const forest = (f & FLAG.forest) !== 0;
		const kind = rng.weighted(forest ? [0.35, 0.4, 0.25] : [0.45, 0.55, 0]);
		const scale = kind === 0 ? rng.range(0.7, 1.5) : kind === 1 ? rng.range(0.5, 1) : rng.range(0.8, 1.3);
		const [yawC, yawS] = rng.heading();
		rocks.push({ kind, x, z, scale, yawC, yawS });
	}

	const decorations: Item[] = [];
	const deco = blueNoise(layers.decorations, DECO_SPACING, x0, z0, x1, z1);
	const clear2 = DECO_CLEARANCE * DECO_CLEARANCE;
	for (let k = 0; k < deco.length; k += 3) {
		const x = deco[k];
		const z = deco[k + 1];
		const q = at(x, z);
		const f = flags[q];
		if (!(f & FLAG.walkable) || f & FLAG.river) continue;
		let near = false;
		for (let t = 0; t < layer.length && !near; t += 3) {
			const dx = layer[t] - x;
			const dz = layer[t + 1] - z;
			near = dx * dx + dz * dz < clear2;
		}
		if (near) continue;
		const rng = new Rng(deco[k + 2] ^ layers.species);
		const b = drawBiome(weights, q * BIOME_COUNT, rng.next() * 255);
		const mix = f & FLAG.cleared ? PASTURE_DECO : DECO_MIX[b];
		if (!mix.some((m) => m > 0)) continue;
		const kind = rng.weighted(mix);
		const scale = rng.range(0.6, 1.3);
		const [yawC, yawS] = rng.heading();
		decorations.push({ kind, x, z, scale, yawC, yawS });
	}

	return {
		x0,
		z0,
		sideX,
		sideZ,
		heights,
		zones,
		flags,
		biome,
		biomeWeights: weights,
		segments,
		trees: pack(TREE_SPECIES, trees, heights, sideX, x0, z0),
		rocks: pack(ROCK_KINDS, rocks, heights, sideX, x0, z0),
		decorations: pack(DECORATION_KINDS, decorations, heights, sideX, x0, z0)
	};
}

/**
 * Pasture patches: human pressure is high near the coast and around the
 * Reserva and falls into the serra (WORLD.md §1, f-mundo-infinito.md §4.6).
 */
function pasture(x: number, z: number, e: number, reserve: number, layers: LayerSeeds): boolean {
	const coast = 1 - clamp((e - 60) / 300, 0, 1);
	const home = 1 - clamp(reserve / 600, 0, 1);
	const pressure = 0.8 * coast * coast + 0.2 * home;
	return fbm(x * 0.03, z * 0.03, layers.pressure, 2) < -0.55 + 0.6 * pressure;
}

/**
 * Rise per unit of the bilinear ground at world (x, z), from its own cell (no
 * neighbour chunk needed). Cell and fraction come from world coordinates, so
 * every rectangle holding the point computes the same bits.
 */
function slopeAt(heights: Float32Array, side: number, x0: number, z0: number, x: number, z: number): number {
	const fx = floor(x);
	const fz = floor(z);
	const tx = x - fx;
	const tz = z - fz;
	const q = (fz - z0) * side + fx - x0;
	const a = heights[q];
	const b = heights[q + 1];
	const c = heights[q + side];
	const d = heights[q + side + 1];
	const gx = (b - a) * (1 - tz) + (d - c) * tz;
	const gz = (c - a) * (1 - tx) + (d - b) * tx;
	return Math.sqrt(gx * gx + gz * gz);
}

/**
 * Bilinear ground height at world (x, z) inside a grid `side` samples wide
 * whose vertex 0 is (x0, z0); the point must lie in the grid's half-open
 * rectangle. Same bits in any grid that holds the point.
 */
export function heightIn(
	heights: Float32Array,
	side: number,
	x0: number,
	z0: number,
	x: number,
	z: number
): number {
	const fx = floor(x);
	const fz = floor(z);
	const tx = x - fx;
	const tz = z - fz;
	const q = (fz - z0) * side + fx - x0;
	return (
		(heights[q] + (heights[q + 1] - heights[q]) * tx) * (1 - tz) +
		(heights[q + side] + (heights[q + side + 1] - heights[q + side]) * tx) * tz
	);
}

/** Items as parallel typed arrays sorted by kind, then generation order (rows of cells, west to east). */
function pack<K extends string>(
	kinds: readonly K[],
	items: Item[],
	heights: Float32Array,
	side: number,
	x0: number,
	z0: number
): Placements<K> {
	const order = items.map((_, k) => k).sort((a, b) => items[a].kind - items[b].kind || a - b);
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
		out.x[w] = it.x;
		out.y[w] = heightIn(heights, side, x0, z0, it.x, it.z);
		out.z[w] = it.z;
		out.scale[w] = it.scale;
		out.yawC[w] = it.yawC;
		out.yawS[w] = it.yawS;
	}
	return out;
}

/** survival/generate.ts collisionBlocks for one chunk: ground every 2 u, trunk and boulder cylinders, log boxes. */
function collisionOf(cx: number, cz: number, area: Area): CollisionBlock {
	const { heights, sideX, trees, rocks } = area;
	const ground = new Float32Array(COLLISION_SIDE * COLLISION_SIDE);
	const step = (sideX - 1) / (COLLISION_SIDE - 1);
	for (let b = 0; b < COLLISION_SIDE; b++)
		for (let a = 0; a < COLLISION_SIDE; a++)
			ground[b * COLLISION_SIDE + a] = heights[b * step * sideX + a * step];
	let minY = Number.POSITIVE_INFINITY;
	let maxY = Number.NEGATIVE_INFINITY;
	for (const h of heights) {
		minY = Math.min(minY, h);
		maxY = Math.max(maxY, h);
	}
	const cylinders: number[] = [];
	const boxes: number[] = [];
	for (let k = 0; k < trees.count; k++) {
		const s = trees.scale[k];
		cylinders.push(
			trees.x[k],
			trees.y[k] - 0.3,
			trees.z[k],
			TRUNK_RADIUS[TREE_SPECIES[trees.kind[k]]] * s,
			TRUNK_HEIGHT * s
		);
	}
	for (let k = 0; k < rocks.count; k++) {
		const s = rocks.scale[k];
		if (rocks.kind[k] === 0) cylinders.push(rocks.x[k], rocks.y[k] - 0.3, rocks.z[k], 0.8 * s, 1.1 * s);
		else if (rocks.kind[k] === 2)
			boxes.push(
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
	return {
		index: 0,
		bx: cx,
		bz: cz,
		x0: area.x0,
		z0: area.z0,
		minY,
		maxY,
		heights: ground,
		cylinders: Float32Array.from(cylinders),
		boxes: Float32Array.from(boxes),
		decks: new Float32Array(0)
	};
}
