/**
 * Rivers on a directed lattice (Scheidegger 1967, after Dodds & Rothman 2000;
 * f-mundo-infinito.md §3.3, §4.7): one node per 80 u cell at a hashed spot,
 * each draining to one of its three west neighbours (towards the sea), picked
 * by hash. Flow accumulation is the count of upstream nodes; it is bounded
 * because nodes past the serra crest belong to no coastal river, so it stays
 * local in an endless world. Every node, link and water height is a pure
 * function of its cell and the seed (the memo only saves time), so rivers are
 * continuous across chunks by construction.
 *
 * Water falls along every river: a node's surface is the lower of its own
 * target (macro.ts riverWaterTarget, under the ground around it) and each
 * upstream node's surface minus MIN_DROP, down to the sea.
 *
 * The Reserva and its stitch band are the lattice cells (0..2, 0..2). In the
 * default 'detour' mode they hold no node and rivers go around them. The
 * 'pinned' mode (F2, not used by generateChunk yet) turns two of those cells
 * into the Reserva river's ends: the waterfall at (132, 30), fed from the east
 * by cell (3, 0), and the mouth at (28, 160), draining south-west to the sea;
 * the link between them is the hand-made river and is never carved.
 */
import { clamp, floor } from '../survival/noise.ts';
import { WATER_LEVEL } from '../survival/types.ts';
import type { LayerSeeds } from './constants.ts';
import { cellHash, cellUnit } from './hash.ts';
import {
	CREST_S,
	coastX,
	type MacroFields,
	macroFields,
	newMacroPoint,
	riverWaterTarget,
	samplePoint,
	serraFoot
} from './macro.ts';
import { smooth } from './math.ts';

export const RIVER_CELL = 80;
/** Cell i spans [RIVER_ORIGIN + i·RIVER_CELL, + RIVER_CELL): cells 0..2 cover the Reserva plus its band, [−40, 200). */
export const RIVER_ORIGIN = -40;
/** Nodes sit at least this far inside their cell, so a link always runs west. */
const INSET = 16;
const SPAN = RIVER_CELL - 2 * INSET;

/**
 * Upstream nodes (itself included) for a visible, wadeable stream, and for a
 * deep river. In the serra every node is a spring (f-mundo-infinito.md §4.7:
 * shallow streams from accumulation 1 there), elsewhere streams need two.
 */
export const STREAM_ACC = 2;
/** Past this distance from the serra foot a node of accumulation 1 already has a stream. */
const SPRING_S = 20;
export const RIVER_ACC = 5;
export const STREAM_DEPTH = 0.35;
export const RIVER_DEPTH = 1.4;
/** Banks rise at this many u per u from the bed (under WALK_SLOPE). */
export const BANK_SLOPE = 0.6;
/** The banks are carved fully within CARVE_NEAR of the centre line and fade out by CARVE_FAR. */
export const CARVE_NEAR = 18;
export const CARVE_FAR = 30;
/** Water falls at least this much along every link. */
const MIN_DROP = 0.01;
/** Surface where a river reaches the sea. */
const SINK_WATER = WATER_LEVEL - 0.3;
/** A link this steep is a waterfall or rapids candidate (a set piece in F3). */
const FALL_DROP = 4;
const FALL_GRADIENT = 0.15;

/** Bits of a chunk's riverFlags. */
export const RIVER_FLAG = {
	/** Not wadeable (RIVER_DEPTH). */
	deep: 1,
	/** Part of a steep link: waterfall or rapids candidate. */
	fall: 2
} as const;
/** Each link is drawn as RIVER_PIECES segments; a segment's piece index is (flags >> RIVER_PIECE_SHIFT) & 3, 0 upstream. */
export const RIVER_PIECES = 4;
export const RIVER_PIECE_SHIFT = 2;

export type ReserveRiverMode = 'detour' | 'pinned';

export const NODE_KIND = {
	/** No river: inside the Reserva's cells, or past the crest. */
	off: 0,
	/** On land between the coast and the crest: drains west. */
	flow: 1,
	/** In the sea: where rivers end. */
	sink: 2,
	/** One of the Reserva river's pinned ends ('pinned' mode). */
	pin: 3
} as const;

/**
 * The Reserva river's ends (layout.ts RIVER, WATERFALL, RIVER_SURFACE), in
 * lattice cells; world-gen.test.ts checks them against the level.
 */
export const RESERVE_RIVER = {
	waterfall: { i: 2, j: 0, x: 132, z: 30, water: 3 },
	mouth: { i: 0, j: 2, x: 28, z: 160, water: WATER_LEVEL },
	/** The east neighbour that feeds the waterfall. */
	feeder: { i: 3, j: 0 },
	/** Where the mouth drains: south-west, out to sea. */
	sea: { i: -1, j: 3 }
} as const;

export interface RiverNode {
	i: number;
	j: number;
	x: number;
	z: number;
	kind: number;
	/** Downstream cell (flow and pin nodes). */
	di: number;
	dj: number;
	/** The link downstream is the Reserva's hand-made river. */
	internal: boolean;
	/** riverWaterTarget at the node (or the pin's height). */
	target: number;
	/** Distance past the serra foot (0 for pins and sinks). */
	s: number;
	/** Upstream nodes, itself included. */
	acc: number;
	/** Water surface. */
	water: number;
	flowDone: boolean;
}

/** One straight piece of river: a quarter of a lattice link, along its hashed meander. */
export interface RiverSegment {
	/** Stable id of the link: (i << 16) | (j & 0xffff) of its upstream node. */
	id: number;
	/** id · RIVER_PIECES + piece: a total order for ties. */
	order: number;
	flags: number;
	ax: number;
	az: number;
	aw: number;
	bx: number;
	bz: number;
	bw: number;
	/** Half width of the water surface. */
	half: number;
	depth: number;
	/** Half width of the flat bed. */
	bed: number;
	dx: number;
	dz: number;
	len2: number;
	/** Deep and near sea level: what grows a manguezal around it. */
	estuary: boolean;
}

export const riverColumn = (x: number) => floor((x - RIVER_ORIGIN) / RIVER_CELL);
export const riverRow = (z: number) => floor((z - RIVER_ORIGIN) / RIVER_CELL);
const cellKey = (i: number, j: number) => (i + 32768) * 65536 + (j + 32768);
/** The Reserva and its band. */
const reserveCell = (i: number, j: number) => i >= 0 && i <= 2 && j >= 0 && j <= 2;

export class RiverLattice {
	readonly seed: number;
	readonly mode: ReserveRiverMode;
	readonly #layers: LayerSeeds;
	readonly #fields: MacroFields;
	readonly #nodes = new Map<number, RiverNode>();
	readonly #point = newMacroPoint();

	constructor(seed: number, mode: ReserveRiverMode = 'detour') {
		this.seed = seed;
		this.mode = mode;
		this.#fields = macroFields(seed);
		this.#layers = this.#fields.layers;
	}

	/** Memoized nodes; clearing never changes a result. */
	get cached(): number {
		return this.#nodes.size;
	}

	clear() {
		this.#nodes.clear();
	}

	#pin(i: number, j: number) {
		if (this.mode !== 'pinned') return null;
		const { waterfall, mouth } = RESERVE_RIVER;
		if (i === waterfall.i && j === waterfall.j) return waterfall;
		if (i === mouth.i && j === mouth.j) return mouth;
		return null;
	}

	/** Can a node in column `fromI` drain into cell (i, j)? */
	#accepts(i: number, j: number, fromI: number): boolean {
		if (!reserveCell(i, j)) return true;
		const { waterfall } = RESERVE_RIVER;
		return this.mode === 'pinned' && i === waterfall.i && j === waterfall.j && fromI === waterfall.i + 1;
	}

	/** Position, kind and downstream cell of (i, j). */
	#base(i: number, j: number): RiverNode {
		const key = cellKey(i, j);
		const known = this.#nodes.get(key);
		if (known) return known;
		const seed = this.#layers.river;
		const pin = this.#pin(i, j);
		const x = pin ? pin.x : RIVER_ORIGIN + i * RIVER_CELL + INSET + SPAN * cellUnit(i, j, seed);
		const z = pin ? pin.z : RIVER_ORIGIN + j * RIVER_CELL + INSET + SPAN * cellUnit(j, i, seed ^ 0x5bd1e995);
		const node: RiverNode = {
			i,
			j,
			x,
			z,
			kind: NODE_KIND.off,
			di: i,
			dj: j,
			internal: false,
			target: 0,
			s: 0,
			acc: 0,
			water: SINK_WATER,
			flowDone: false
		};
		if (pin) {
			node.kind = NODE_KIND.pin;
			node.target = pin.water;
			const { mouth, sea } = RESERVE_RIVER;
			const isMouth = pin === mouth;
			node.di = isMouth ? sea.i : mouth.i;
			node.dj = isMouth ? sea.j : mouth.j;
			node.internal = !isMouth;
		} else if (!reserveCell(i, j)) {
			const p = samplePoint(
				x,
				z,
				coastX(z, this.#layers),
				serraFoot(z, this.#layers),
				this.#fields,
				this.#point
			);
			if (p.e < 0) {
				node.kind = NODE_KIND.sink;
				node.target = SINK_WATER;
			} else if (p.s <= CREST_S) {
				node.kind = NODE_KIND.flow;
				node.s = p.s;
				node.target = riverWaterTarget(p);
				this.#downstream(node);
			}
		}
		if (this.#nodes.size > 60000) this.#nodes.clear();
		this.#nodes.set(key, node);
		return node;
	}

	/** One of the three west neighbours by hash, avoiding the Reserva; straight along the column if all three are in it. */
	#downstream(node: RiverNode) {
		const { i, j } = node;
		const { feeder, waterfall } = RESERVE_RIVER;
		if (this.mode === 'pinned' && i === feeder.i && j === feeder.j) {
			node.di = waterfall.i;
			node.dj = waterfall.j;
			return;
		}
		const h = cellHash(i, j, this.#layers.river ^ 0x68e31da4);
		const first = (h % 3) - 1;
		const turn = (h >>> 8) & 1 ? 1 : -1;
		for (const delta of [first, first === 0 ? turn : 0, first === 0 ? -turn : -first]) {
			if (this.#accepts(i - 1, j + delta, i)) {
				node.di = i - 1;
				node.dj = j + delta;
				return;
			}
		}
		node.di = i;
		node.dj = j + (j < 1 ? -1 : j > 1 ? 1 : turn);
	}

	/** The node with its flow accumulation and water surface. */
	node(i: number, j: number): RiverNode {
		const node = this.#base(i, j);
		if (node.flowDone) return node;
		let acc = 1;
		let water = node.kind === NODE_KIND.sink ? SINK_WATER : node.target;
		const visit = (ui: number, uj: number) => {
			const up = this.#base(ui, uj);
			if (up.kind !== NODE_KIND.flow && up.kind !== NODE_KIND.pin) return;
			if (up.di !== i || up.dj !== j) return;
			this.node(ui, uj);
			acc += up.acc;
			water = Math.min(water, up.water - MIN_DROP);
		};
		if (node.kind !== NODE_KIND.off) {
			for (let dj = -1; dj <= 1; dj++) visit(i + 1, j + dj);
			visit(i, j - 1);
			visit(i, j + 1);
			const { waterfall, mouth } = RESERVE_RIVER;
			if (node.kind === NODE_KIND.pin && i === mouth.i && j === mouth.j) visit(waterfall.i, waterfall.j);
		}
		node.acc = acc;
		node.water = water;
		node.flowDone = true;
		return node;
	}

	/**
	 * Visible river segments (links of nodes with at least STREAM_ACC, or any serra node) whose
	 * box grown by `reach` overlaps [x0, x1] × [z0, z1], sorted by `order`.
	 */
	segmentsNear(x0: number, z0: number, x1: number, z1: number, reach: number): RiverSegment[] {
		const out: RiverSegment[] = [];
		// Links reach one column west and one row aside, plus the meanders: a spare cell each way.
		const i0 = riverColumn(x0 - reach) - 2;
		const i1 = riverColumn(x1 + reach) + 2;
		const j0 = riverRow(z0 - reach) - 3;
		const j1 = riverRow(z1 + reach) + 3;
		const jitter = this.#layers.river ^ 0x2545f491;
		for (let i = i0; i <= i1; i++)
			for (let j = j0; j <= j1; j++) {
				const a = this.node(i, j);
				if ((a.kind !== NODE_KIND.flow && a.kind !== NODE_KIND.pin) || a.internal) continue;
				if (a.acc < (a.s > SPRING_S ? 1 : STREAM_ACC)) continue;
				const b = this.node(a.di, a.dj);
				const deep = a.acc >= RIVER_ACC;
				const half = deep ? Math.min(7, 2.6 + 0.8 * Math.sqrt(a.acc)) : 1.6 + 0.25 * a.acc;
				const depth = deep ? RIVER_DEPTH : STREAM_DEPTH;
				const lx = b.x - a.x;
				const lz = b.z - a.z;
				const len = Math.sqrt(lx * lx + lz * lz);
				const drop = a.water - b.water;
				const fall = drop > FALL_DROP && drop > FALL_GRADIENT * len;
				const id = (i << 16) | (j & 0xffff);
				const flags = (deep ? RIVER_FLAG.deep : 0) | (fall ? RIVER_FLAG.fall : 0);
				const estuary = deep && b.water <= 0.2;
				// Meanders: the midpoint, then the quarter points, pushed sideways by hash.
				const px = -lz / len;
				const pz = lx / len;
				const side = Math.min(18, 0.15 * len) * 2 * (cellUnit(i, j, jitter) - 0.5);
				const mx = (a.x + b.x) / 2 + px * side;
				const mz = (a.z + b.z) / 2 + pz * side;
				const small = Math.min(8, 0.07 * len) * 2;
				const q1 = small * (cellUnit(j, i, jitter) - 0.5);
				const q3 = small * (cellUnit(i ^ 0x5555, j, jitter) - 0.5);
				const xs = [a.x, (a.x + mx) / 2 + px * q1, mx, (mx + b.x) / 2 + px * q3, b.x];
				const zs = [a.z, (a.z + mz) / 2 + pz * q1, mz, (mz + b.z) / 2 + pz * q3, b.z];
				for (let k = 0; k < RIVER_PIECES; k++) {
					const g = segment(
						id,
						flags | (k << RIVER_PIECE_SHIFT),
						xs[k],
						zs[k],
						a.water + ((b.water - a.water) * k) / RIVER_PIECES,
						xs[k + 1],
						zs[k + 1],
						a.water + ((b.water - a.water) * (k + 1)) / RIVER_PIECES,
						half,
						depth,
						estuary
					);
					if (
						Math.min(g.ax, g.bx) - reach <= x1 &&
						Math.max(g.ax, g.bx) + reach >= x0 &&
						Math.min(g.az, g.bz) - reach <= z1 &&
						Math.max(g.az, g.bz) + reach >= z0
					)
						out.push(g);
				}
			}
		return out.sort((p, q) => p.order - q.order);
	}
}

function segment(
	id: number,
	flags: number,
	ax: number,
	az: number,
	aw: number,
	bx: number,
	bz: number,
	bw: number,
	half: number,
	depth: number,
	estuary: boolean
): RiverSegment {
	const dx = bx - ax;
	const dz = bz - az;
	return {
		id,
		order: id * RIVER_PIECES + ((flags >> RIVER_PIECE_SHIFT) & 3),
		flags,
		ax,
		az,
		aw,
		bx,
		bz,
		bw,
		half,
		depth,
		bed: half - depth / BANK_SLOPE,
		dx,
		dz,
		len2: Math.max(1e-9, dx * dx + dz * dz),
		estuary
	};
}

/** What the rivers do at one point. */
export interface RiverSample {
	/** Ground after carving. */
	height: number;
	/** Half width minus distance of the wettest segment: > 0 within its water's width. */
	wet: number;
	/** That segment's surface here, and its depth. */
	water: number;
	depth: number;
	/** Distance to the nearest estuary centre line (Infinity beyond CARVE_FAR). */
	estuary: number;
}

export function newRiverSample(): RiverSample {
	return {
		height: 0,
		wet: Number.NEGATIVE_INFINITY,
		water: WATER_LEVEL,
		depth: 0,
		estuary: Number.POSITIVE_INFINITY
	};
}

/**
 * Carves `ground` at (x, z): the lowest of the per-segment banks, each faded
 * out by CARVE_FAR. A minimum of continuous functions stays continuous (the
 * nearest segment alone would leave a step where two rivers' banks meet), and
 * a segment farther than CARVE_FAR returns `ground` exactly, so any superset
 * of the segments within reach gives the same bits.
 */
export function carve(
	x: number,
	z: number,
	ground: number,
	segments: readonly RiverSegment[],
	out: RiverSample
): RiverSample {
	let height = ground;
	let wet = Number.NEGATIVE_INFINITY;
	let order = Number.POSITIVE_INFINITY;
	let water = WATER_LEVEL;
	let depth = 0;
	let estuary = Number.POSITIVE_INFINITY;
	for (const g of segments) {
		const px = x - g.ax;
		const pz = z - g.az;
		const t = clamp((px * g.dx + pz * g.dz) / g.len2, 0, 1);
		const ex = px - t * g.dx;
		const ez = pz - t * g.dz;
		const d = Math.sqrt(ex * ex + ez * ez);
		if (d >= CARVE_FAR) continue;
		const surface = g.aw + (g.bw - g.aw) * t;
		const bank = surface - g.depth + BANK_SLOPE * Math.max(0, d - g.bed);
		if (bank < ground) {
			const carved = ground + (bank - ground) * (1 - smooth(CARVE_NEAR, CARVE_FAR, d));
			if (carved < height) height = carved;
		}
		const w = g.half - d;
		if (w > wet || (w === wet && g.order < order)) {
			wet = w;
			order = g.order;
			water = surface;
			depth = g.depth;
		}
		if (g.estuary && d < estuary) estuary = d;
	}
	out.height = height;
	out.wet = wet;
	out.water = water;
	out.depth = depth;
	out.estuary = estuary;
	return out;
}

const lattices = new Map<string, RiverLattice>();

/** The shared lattice of a seed and mode (one per Worker). */
export function riverLattice(seed: number, mode: ReserveRiverMode = 'detour'): RiverLattice {
	const key = `${seed}:${mode}`;
	let lattice = lattices.get(key);
	if (!lattice) {
		if (lattices.size > 8) lattices.clear();
		lattice = new RiverLattice(seed, mode);
		lattices.set(key, lattice);
	}
	return lattice;
}

/** Forgets every memoized node (tests: generation must not depend on what was built before). */
export function clearRiverCaches() {
	lattices.clear();
}
