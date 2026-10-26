/**
 * Helpers the zones with content share (the Vale, the Copa, the Praia): the
 * jump numbers, small terrain shapers, survival-style counts, the edge rails
 * and the trees that line a trail. Square 160 u zones only where a helper says
 * so (the Reserva's grid, survival's GRID); the `Rect` helpers serve any zone
 * (the Praia's 200 × 160). Pure and exact (survival/random.ts).
 */
import { GRAVITY, JUMP_SPEED, WALK_SPEED } from '../../engine/constants.ts';
import { floor } from '../../survival/noise.ts';
import type { Rng } from '../../survival/random.ts';
import {
	BLOCK_SIZE,
	type CollisionBlock,
	DECORATION_KINDS,
	FLAG,
	GRID,
	type Placements,
	RESOURCE_KINDS,
	ROCK_KINDS,
	THREAT_KINDS,
	TREE_SPECIES,
	type TreeSpecies
} from '../../survival/types.ts';
import { smooth } from '../../world-gen/math.ts';
import { arcLengths, distance } from '../geometry.ts';
import type { XZ } from './spec.ts';
import { collisionBlocks, heightIn, type ZoneLevel } from './zone.ts';

/** survival's grid: a square zone is the Reserva's shape, 161 vertices a side. */
export const N = GRID;
export const CELLS = N * N;

/** Scratch bits of a placement `clear` mask (level/build.ts): ground kept for the story, ground a trunk or rock took. */
export const RESERVED = 1;
export const OCCUPIED = 2;
/** Largest trunk the trail clearances allow for (jequitibá 0.45 × 1.3). */
export const MAX_TRUNK = 0.6;
/** Steepest ground anything grows on (survival generate.ts). */
export const GROW_SLOPE = 1.3;
/** Vertices this close to a zone's edge are behind its rail (level/layout.ts FENCE_MARGIN). */
export const FENCE_MARGIN = 2;

/** engine/graybox.ts jumpReach, the same arithmetic without three.js (vale.test.ts checks they agree). */
export function jumpReach(rise = 0): number {
	const discriminant = JUMP_SPEED * JUMP_SPEED - 2 * GRAVITY * rise;
	return discriminant < 0 ? 0 : (WALK_SPEED * (JUMP_SPEED + Math.sqrt(discriminant))) / GRAVITY;
}

/** Linear from (x0, y0) to (x1, y1), flat beyond. */
export function ramp(x: number, x0: number, x1: number, y0: number, y1: number): number {
	if (x <= x0) return y0;
	if (x >= x1) return y1;
	return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
}

/** Flat at y within r0 of a point, blending back to h by r1 (level/build.ts flattenDisk). */
export function flatten(
	h: number,
	x: number,
	z: number,
	[cx, cz]: XZ,
	y: number,
	r0: number,
	r1: number
): number {
	const d = distance(x, z, cx, cz);
	return d >= r1 ? h : y + (h - y) * smooth(r0, r1, d);
}

/** Visits every vertex of a square zone within r (plus a cell) of local (x, z). */
export function forCells(x: number, z: number, r: number, visit: (q: number, i: number, j: number) => void) {
	for (let j = Math.max(0, floor(z - r)); j <= Math.min(N - 1, floor(z + r) + 1); j++)
		for (let i = Math.max(0, floor(x - r)); i <= Math.min(N - 1, floor(x + r) + 1); i++)
			visit(j * N + i, i, j);
}

/** Rise per unit at each vertex of a square zone, from central differences (level/build.ts slopeOf). */
export function slopeOf(heights: Float32Array): Float32Array {
	const slope = new Float32Array(CELLS);
	for (let j = 0; j < N; j++)
		for (let i = 0; i < N; i++) {
			const hx = heights[j * N + Math.min(N - 1, i + 1)] - heights[j * N + Math.max(0, i - 1)];
			const hz = heights[Math.min(N - 1, j + 1) * N + i] - heights[Math.max(0, j - 1) * N + i];
			slope[j * N + i] = Math.sqrt(hx * hx + hz * hz) / 2;
		}
	return slope;
}

/** Relative weights over TREE_SPECIES. */
export const weightsOf = (mix: Partial<Record<TreeSpecies, number>>) => TREE_SPECIES.map((s) => mix[s] ?? 0);

/**
 * The rails along a square zone's edges: vertices within FENCE_MARGIN of an
 * edge stop being walkable, but where `open(worldX, worldZ)` says a way goes through.
 */
export function fenceEdges(
	flags: Uint8Array,
	ox: number,
	oz: number,
	open: (x: number, z: number) => boolean
) {
	for (let q = 0; q < CELLS; q++) {
		const i = q % N;
		const j = (q - i) / N;
		if (Math.min(i, j, N - 1 - i, N - 1 - j) >= FENCE_MARGIN) continue;
		if (!open(ox + i, oz + j)) flags[q] &= ~FLAG.walkable;
	}
}

/** Trees lining the trails: one every `step` u on each side, `offset` to `offset + spread` from the centre line. */
export interface TrailTrees {
	step: number;
	offset: number;
	spread: number;
	density: number;
}

/** Offers `grow` a spot every rule.step u on both sides of each trail, from rule.step / 2 in. */
export function lineTrails(
	trails: readonly (readonly XZ[])[],
	rule: TrailTrees,
	rng: Rng,
	grow: (x: number, z: number, density: number) => void
) {
	for (const trail of trails) {
		const arcs = arcLengths(trail);
		const length = arcs[arcs.length - 1];
		for (let along = rule.step / 2; along < length; along += rule.step) {
			let k = 1;
			while (k < arcs.length - 1 && arcs[k] < along) k++;
			const [ax, az] = trail[k - 1];
			const [bx, bz] = trail[k];
			const span = arcs[k] - arcs[k - 1];
			const t = (along - arcs[k - 1]) / span;
			const dx = (bx - ax) / span;
			const dz = (bz - az) / span;
			for (const side of [-1, 1]) {
				const off = side * (rule.offset + rule.spread * rng.next());
				grow(ax + (bx - ax) * t - dz * off, az + (bz - az) * t + dx * off, rule.density);
			}
		}
	}
}

/**
 * Survival's count keys (generate.ts countAll's, as level/build.ts gives
 * them), the story's, then the zone's own `extra` counts in their order.
 */
export function countAll(
	treeKinds: Uint8Array,
	rockKinds: Uint8Array,
	decoKinds: Uint8Array,
	treeBlocks: Uint8Array,
	level: ZoneLevel,
	animals: number,
	extra: Record<string, number>
): Record<string, number> {
	const counts: Record<string, number> = {};
	const tally = (prefix: string, kinds: readonly string[], of: ArrayLike<number>) => {
		for (const kind of kinds) counts[`${prefix}:${kind}`] = 0;
		for (let k = 0; k < of.length; k++) counts[`${prefix}:${kinds[of[k]]}`]++;
	};
	tally('tree', TREE_SPECIES, treeKinds);
	tally('rock', ROCK_KINDS, rockKinds);
	tally('decoration', DECORATION_KINDS, decoKinds);
	tally('threat', THREAT_KINDS, []);
	tally('resource', RESOURCE_KINDS, []);
	counts.poi = 0;
	counts.planting = level.planting.length;
	counts.camera = 0;
	counts.animal = animals;
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
	counts['obby:stone'] = level.obbies.reduce(
		(n, o) => n + o.pieces.filter((p) => p.piece === 'stone').length,
		0
	);
	counts['obby:ledge'] = 0;
	for (const [key, n] of Object.entries(extra)) counts[key] = n;
	return counts;
}

// --- Any zone's rectangle ------------------------------------------------------------------

/** A zone's grid: (width + 1) × (depth + 1) vertices, one 40 u collision block per chunk, row-major. */
export interface Rect {
	width: number;
	depth: number;
	side: number;
	cells: number;
	blocksX: number;
}

export function rectOf(width: number, depth: number): Rect {
	return { width, depth, side: width + 1, cells: (width + 1) * (depth + 1), blocksX: width / BLOCK_SIZE };
}

/** The vertex nearest local (x, z). */
export const rectCell = (g: Rect, x: number, z: number) => floor(z + 0.5) * g.side + floor(x + 0.5);

/** The collision block holding local (x, z) (survival generate.ts blockOf, any rectangle). */
export const rectBlock = (g: Rect, x: number, z: number) =>
	Math.min(g.depth / BLOCK_SIZE - 1, Math.max(0, floor(z / BLOCK_SIZE))) * g.blocksX +
	Math.min(g.blocksX - 1, Math.max(0, floor(x / BLOCK_SIZE)));

/** Marks every vertex within r of local (x, z) with `bit` (survival generate.ts paint). */
export function rectPaint(g: Rect, mask: Uint8Array, x: number, z: number, r: number, bit: number) {
	const r2 = r * r;
	for (let j = Math.max(0, floor(z - r)); j <= Math.min(g.depth, floor(z + r) + 1); j++)
		for (let i = Math.max(0, floor(x - r)); i <= Math.min(g.width, floor(x + r) + 1); i++)
			if ((i - x) * (i - x) + (j - z) * (j - z) <= r2) mask[j * g.side + i] |= bit;
}

/** Rise per unit at each vertex, from central differences (level/build.ts slopeOf, any rectangle). */
export function rectSlope(g: Rect, heights: Float32Array): Float32Array {
	const slope = new Float32Array(g.cells);
	const { side, width, depth } = g;
	for (let j = 0; j <= depth; j++)
		for (let i = 0; i <= width; i++) {
			const hx = heights[j * side + Math.min(width, i + 1)] - heights[j * side + Math.max(0, i - 1)];
			const hz = heights[Math.min(depth, j + 1) * side + i] - heights[Math.max(0, j - 1) * side + i];
			slope[j * side + i] = Math.sqrt(hx * hx + hz * hz) / 2;
		}
	return slope;
}

/** fenceEdges for any rectangle. */
export function rectFence(
	g: Rect,
	flags: Uint8Array,
	ox: number,
	oz: number,
	open: (x: number, z: number) => boolean
) {
	for (let q = 0; q < g.cells; q++) {
		const i = q % g.side;
		const j = (q - i) / g.side;
		if (Math.min(i, j, g.width - i, g.depth - j) >= FENCE_MARGIN) continue;
		if (!open(ox + i, oz + j)) flags[q] &= ~FLAG.walkable;
	}
}

/** Placements sorted by block, then kind (survival generate.ts pack, any rectangle). */
export function rectPack<K extends string>(
	g: Rect,
	kinds: readonly K[],
	items: { kind: number; x: number; z: number; scale: number; yawC: number; yawS: number }[],
	heights: Float32Array
): Placements<K> {
	const keys = items.map((it) => rectBlock(g, it.x, it.z) * 256 + it.kind);
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
		out.y[w] = heightIn(heights, g.side, it.x, it.z);
		out.z[w] = it.z;
		out.scale[w] = it.scale;
		out.yawC[w] = it.yawC;
		out.yawS[w] = it.yawS;
	}
	return out;
}

/** survival generate.ts's trunk collider radius per species at scale 1 and its height (not exported there). */
export const TRUNK_RADIUS: Record<TreeSpecies, number> = {
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
export const TRUNK_HEIGHT = 3.5;

/**
 * Collision blocks for any rectangle (survival generate.ts collisionBlocks):
 * the ground every COLLISION_STEP u, trunks and boulders as cylinders, logs as
 * boxes; stones never collide.
 */
export function rectBlocks(
	g: Rect,
	heights: Float32Array,
	trees: Placements<TreeSpecies>,
	rocks: Placements<(typeof ROCK_KINDS)[number]>
): CollisionBlock[] {
	const blocks = collisionBlocks(heights, g.width, g.depth);
	const cylinders: number[][] = blocks.map(() => []);
	const boxes: number[][] = blocks.map(() => []);
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
	for (const block of blocks) {
		block.cylinders = Float32Array.from(cylinders[block.index]);
		block.boxes = Float32Array.from(boxes[block.index]);
	}
	return blocks;
}
