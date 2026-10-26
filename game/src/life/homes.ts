/**
 * Where everything alive lives, derived once from the map (pure data, no
 * three): the animals' routes at their homes (world.animals, LEVEL.md §10),
 * the flock boxes and the canopy and clearing grids the particles spawn from.
 * Deterministic from the world, the level and a seed.
 *
 * Trees are the world's placements; their crowns come from the measured GLBs
 * (CROWNS, model units × the placement scale). Animals only use species that
 * render as a real model (Crown.model).
 */
import { MURIQUI_HOLDS, type Perch, SPECIES, type SpeciesId } from '../animation/animals/index.ts';
import type { StoryLevel } from '../level/types.ts';
import { heightAt } from '../survival/terrain.ts';
import { FLAG, type SurvivalWorld, type TreeSpecies } from '../survival/types.ts';
import { LifeRng, subSeed } from './rng.ts';

/** Default seed of the layer (golden frames and tests use it). */
export const LIFE_SEED = 20261025;

const TAU = Math.PI * 2;

/**
 * One crown, model units. The seven staging-v2 trees (game/src/assets/models/trees/tree-<species>.glb,
 * edited CC BY models, REPORT-trees.md §1) were measured on their lod0 node: the foliage is the
 * geometry whose UVs fall in the trees atlas' leaf and frond cells, `base` is its 5th height
 * percentile (a few drooping cards aside), `top` the tree's height and `radius` the 95th percentile of
 * the foliage's distance from the trunk axis. Araucária, embaúba and xaxim keep the custom-*.glb
 * measures (vertex radius per height band).
 */
export interface Crown {
	/** Height where the leaf mass starts (the lowest branches) and its top. */
	readonly base: number;
	readonly top: number;
	/** Leaf radius around the trunk. */
	readonly radius: number;
	/** True when world-runtime draws the species as its model (false: a grey placeholder pillar). */
	readonly model: boolean;
}

export const CROWNS: Readonly<Record<TreeSpecies, Crown>> = {
	// Emergent umbrella crown at 13.6–18 (its widest cards reach 10 u out at 15 u up).
	jequitiba: { base: 13.6, top: 18, radius: 7.1, model: true },
	// Two tiers: a first ring of branches at 9–10 (radius 3), the main platter at 11–13 (radius 5.5).
	araucaria: { base: 9.3, top: 13.4, radius: 5.4, model: true },
	embauba: { base: 7, top: 10.5, radius: 4, model: true },
	// Palm: fronds from 7.5 u, fruit bunches hanging below them.
	jucara: { base: 7.5, top: 10, radius: 4.2, model: true },
	// A low, wide blossom crown: leaf cards from about 3.4 u.
	'ipe-rosa': { base: 3.4, top: 10.5, radius: 4.8, model: true },
	'ipe-amarelo': { base: 5, top: 11, radius: 4.8, model: true },
	xaxim: { base: 2.5, top: 5.8, radius: 3.4, model: true },
	'pau-brasil': { base: 3.6, top: 10, radius: 4.4, model: true },
	jeriva: { base: 6.6, top: 11, radius: 3.8, model: true },
	// Stilt roots below, a small crown from 4.2 u.
	'mangue-vermelho': { base: 4.2, top: 8, radius: 2.6, model: true }
};

/** World.animals species (the survival album) to the fauna module's species. */
const ALBUM_TO_SPECIES: Readonly<Record<string, SpeciesId>> = {
	'mico-leao-dourado': 'mico-leao-dourado',
	bugio: 'bugio-ruivo',
	muriqui: 'muriqui',
	preguica: 'preguica-de-coleira',
	tucano: 'tucano-de-bico-verde',
	'onca-pintada': 'onca-pintada'
};

/** Population per home [design]: small groups, so a frame never animates more than the tier cap. */
export const POPULATION: Readonly<Record<SpeciesId, number>> = {
	'mico-leao-dourado': 4,
	'bugio-ruivo': 3,
	muriqui: 2,
	'preguica-de-coleira': 1,
	'tucano-de-bico-verde': 2,
	'onca-pintada': 1,
	// P23 (RESERVA_HOMES): a capybara family, a tapir with her calf, a peccary band, the
	// rare forest carnivores alone, crabs at their burrows, a small flock of spoonbills.
	capivara: 3,
	anta: 1,
	'anta-filhote': 1,
	cateto: 5,
	'veado-mateiro': 1,
	'cachorro-do-mato': 1,
	'onca-parda': 1,
	tapiti: 2,
	jaguatirica: 1,
	'caranguejo-uca': 4,
	'tatu-galinha': 1,
	'jabuti-tinga': 1,
	'sapo-cururu': 2,
	'saira-sete-cores': 2,
	'sabia-laranjeira': 1,
	jacutinga: 1,
	colhereiro: 3
};

/**
 * Where the P23 species live in the Reserva for now (PARK.md §4–§5 zones come later),
 * as the brief places them: capivaras on the river bank, the anta in the south by the
 * water, a cateto band and the jabuti on the forest floor, the tatu on a forest trail,
 * toads on the stones pool's shore, crabs on the mud by the river mouth (south-west),
 * the veado at a forest edge, tapitis at the clareira, and the rare cachorro-do-mato,
 * jaguatirica and onça-parda in the south-east forest. Birds: saíras in the north
 * fragment's canopy, a sabiá on the lawn by the base and the ipê-amarelo, the jacutinga
 * in the juçara palms, colhereiros wading at the restinga edge by the river mouth.
 */
export type ReservaHome =
	| { kind: 'bank'; species: SpeciesId; at: number; side: 1 | -1; along: number; across: number }
	| { kind: 'wade'; species: SpeciesId; at: number; side: 1 | -1; length: number }
	| { kind: 'floor'; species: SpeciesId; x: number; z: number; radius: number; flag: number }
	| { kind: 'trail'; species: SpeciesId; trail: string; from: number; to: number }
	| { kind: 'burrows'; species: SpeciesId; at: number; side: 1 | -1 }
	| { kind: 'canopy'; species: SpeciesId; x: number; z: number }
	| { kind: 'lawn'; species: SpeciesId; x: number; z: number }
	| { kind: 'palms'; species: SpeciesId; x: number; z: number };

export const RESERVA_HOMES: readonly ReservaHome[] = [
	// River arc fractions: 0 at the waterfall (132, 30), 1 at the mouth (28, 160); side 1 = west bank.
	{ kind: 'bank', species: 'capivara', at: 0.6, side: 1, along: 7, across: 3 },
	{ kind: 'bank', species: 'anta', at: 0.86, side: -1, along: 7.5, across: 3 },
	{ kind: 'floor', species: 'cateto', x: 16, z: 62, radius: 8, flag: FLAG.forest },
	{ kind: 'floor', species: 'veado-mateiro', x: 32, z: 52, radius: 7, flag: 0 },
	{ kind: 'floor', species: 'cachorro-do-mato', x: 150, z: 132, radius: 6, flag: FLAG.forest },
	{ kind: 'floor', species: 'onca-parda', x: 126, z: 151, radius: 7.5, flag: FLAG.forest },
	{ kind: 'floor', species: 'tapiti', x: 106, z: 112, radius: 3.5, flag: 0 },
	{ kind: 'floor', species: 'jaguatirica', x: 151, z: 112, radius: 5, flag: FLAG.forest },
	{ kind: 'floor', species: 'jabuti-tinga', x: 86, z: 120, radius: 3, flag: FLAG.forest },
	{ kind: 'floor', species: 'sapo-cururu', x: 104, z: 66, radius: 1.6, flag: 0 },
	{ kind: 'trail', species: 'tatu-galinha', trail: 'ponte', from: 0.55, to: 0.8 },
	{ kind: 'burrows', species: 'caranguejo-uca', at: 0.95, side: 1 },
	// The colhereiros wade the shallows at the restinga edge by the river mouth (the Manguezal later).
	{ kind: 'wade', species: 'colhereiro', at: 0.94, side: 1, length: 9 },
	{ kind: 'canopy', species: 'saira-sete-cores', x: 40, z: 28 },
	{ kind: 'lawn', species: 'sabia-laranjeira', x: 34, z: 76 },
	{ kind: 'palms', species: 'jacutinga', x: 90, z: 30 }
];

/** Swimmers float with this share of their height under the waterline (head and back out). */
const DRAFT: Partial<Record<SpeciesId, number>> = { capivara: 0.62, anta: 0.55, 'anta-filhote': 0.55 };

export interface TreeRef {
	index: number;
	kind: TreeSpecies;
	x: number;
	/** Ground under the trunk. */
	y: number;
	z: number;
	scale: number;
}

export interface AnimalPlan {
	/** Stable id, e.g. 'mico-0'. */
	key: string;
	species: SpeciesId;
	/** The world.animals home it belongs to. */
	homeX: number;
	homeZ: number;
	seed: number;
	/** Route in world points, packed x, y, z (branch top, branch underside, handholds or trail); null for perches. */
	route: number[] | null;
	loop: boolean;
	perches: Perch[] | null;
	/** Start arc length (routes) or handhold / perch index. */
	start: number;
	/** Lives in the trees (true) or on the ground (the onça). */
	arboreal: boolean;
	/** Ground species: per route point, 1 where it swims (null: never). */
	water?: number[] | null;
	/** Herd index into LifePlan.herds (-1: alone) and its place along the route relative to the leader, u. */
	herd?: number;
	offset?: number;
	/** The tree it lives in, when it has one. */
	tree: TreeRef | null;
}

export type Box = [number, number, number, number, number, number];

export interface FlockPlan {
	/** Before and after the story beat that changes it (same box when nothing changes). */
	bounds: Box;
	after: Box;
}

/** Coarse grids (CANOPY_CELL u cells) over the map for the particles. */
export interface CanopyGrid {
	cell: number;
	side: number;
	/** World height of the crown's underside and top over the cell; 0 where no crown covers it. */
	low: Float32Array;
	high: Float32Array;
}

export interface LifePlan {
	seed: number;
	size: number;
	animals: AnimalPlan[];
	/** Number of herds (AnimalPlan.herd indexes them). */
	herds: number;
	/** Index into `animals` of the mico that becomes the companion after mission 1, or -1. */
	companion: number;
	/** The onça walks away inside this radius (LEVEL.md §10: 15 u). */
	oncaAvoidRadius: number;
	butterflies: FlockPlan;
	birds: FlockPlan;
	canopy: CanopyGrid;
}

export const CANOPY_CELL = 2;

// --- helpers (load time: allocation is fine here) -------------------------------------

function treeAt(world: SurvivalWorld, i: number): TreeRef {
	const t = world.trees;
	return { index: i, kind: t.kinds[t.kind[i]], x: t.x[i], y: t.y[i], z: t.z[i], scale: t.scale[i] };
}

/** Modelled trees within `radius` of (x, z), nearest first, optionally of some species. */
function nearTrees(
	world: SurvivalWorld,
	x: number,
	z: number,
	radius: number,
	kinds?: readonly TreeSpecies[]
): TreeRef[] {
	const out: { ref: TreeRef; d: number }[] = [];
	const t = world.trees;
	for (let i = 0; i < t.count; i++) {
		const kind = t.kinds[t.kind[i]];
		if (!CROWNS[kind].model || (kinds && !kinds.includes(kind))) continue;
		const d = Math.hypot(t.x[i] - x, t.z[i] - z);
		if (d <= radius) out.push({ ref: treeAt(world, i), d });
	}
	out.sort((a, b) => a.d - b.d || a.ref.index - b.ref.index);
	return out.map((o) => o.ref);
}

/**
 * A branch inside a crown along the bearing `angle` (yaw: 0 = +z), from
 * `from` to `to` of the crown radius out from the trunk, at `height` (model
 * units) plus a `rise` toward the tip (world u). Four points, world space.
 */
function branch(tree: TreeRef, angle: number, from: number, to: number, height: number, rise: number) {
	const crown = CROWNS[tree.kind];
	const s = tree.scale;
	const out: number[] = [];
	for (let k = 0; k < 4; k++) {
		const u = k / 3;
		const r = (from + (to - from) * u) * crown.radius * s;
		out.push(tree.x + Math.sin(angle) * r, tree.y + height * s + rise * u, tree.z + Math.cos(angle) * r);
	}
	return out;
}

function maxGround(world: SurvivalWorld, box: Box) {
	let low = Number.POSITIVE_INFINITY;
	let high = Number.NEGATIVE_INFINITY;
	for (let x = Math.max(0, Math.floor(box[0])); x <= Math.min(world.size, Math.ceil(box[3])); x++)
		for (let z = Math.max(0, Math.floor(box[2])); z <= Math.min(world.size, Math.ceil(box[5])); z++) {
			const h = world.heights[z * world.grid + x];
			low = Math.min(low, h);
			high = Math.max(high, h);
		}
	return { low: Number.isFinite(low) ? low : 0, high: Number.isFinite(high) ? high : 0 };
}

const flagAt = (world: SurvivalWorld, x: number, z: number) => {
	const i = Math.min(world.grid - 1, Math.max(0, Math.round(x)));
	const j = Math.min(world.grid - 1, Math.max(0, Math.round(z)));
	return world.flags[j * world.grid + i];
};

// --- species ---------------------------------------------------------------------------

const BROADLEAF: readonly TreeSpecies[] = ['jequitiba', 'ipe-rosa', 'ipe-amarelo', 'embauba', 'pau-brasil'];
const SLOTH_TREES: readonly TreeSpecies[] = BROADLEAF.filter((kind) => kind !== 'embauba');
const MICO_TREES: readonly TreeSpecies[] = [
	'jequitiba',
	'ipe-rosa',
	'ipe-amarelo',
	'embauba',
	'pau-brasil',
	'jucara'
];

/** Branch tops in the crowns near a home, round-robin over the nearest trees, a new bearing each time. */
function canopyRoutes(
	world: SurvivalWorld,
	homeX: number,
	homeZ: number,
	count: number,
	kinds: readonly TreeSpecies[],
	rng: LifeRng,
	treesUsed: number
): { route: number[]; tree: TreeRef | null }[] {
	let trees = nearTrees(world, homeX, homeZ, 16, kinds);
	if (trees.length === 0) trees = nearTrees(world, homeX, homeZ, 24);
	const out: { route: number[]; tree: TreeRef | null }[] = [];
	const n = Math.max(1, Math.min(treesUsed, trees.length));
	const bearings = trees.map(() => rng.range(0, TAU));
	for (let i = 0; i < count; i++) {
		const tree = trees[i % n];
		if (!tree) {
			// No tree at all (a bare survival home): a short branch-height line at the home.
			const y = heightAt(world.heights, homeX, homeZ) + 6;
			out.push({ route: [homeX - 1.5, y, homeZ, homeX + 1.5, y, homeZ], tree: null });
			continue;
		}
		const k = Math.floor(i / n);
		const angle = bearings[i % n] + k * 2.4;
		const crown = CROWNS[tree.kind];
		// On top of a branch at the bottom of the leaf mass, toward its rim: the crowns are closed
		// volumes, so an animal deeper inside would be hidden from the trail below.
		out.push({ route: branch(tree, angle, 0.55, 0.95, crown.base + 0.15, 0.25), tree });
	}
	return out;
}

/** The muriqui handholds: the level's row, and a second row beside it for the second animal. */
function handholdRows(world: SurvivalWorld, level: StoryLevel | undefined, homeX: number, homeZ: number) {
	let row: number[];
	if (level && level.handholds.length >= 2) row = level.handholds.flatMap((p) => [p.x, p.y, p.z]);
	else {
		// No authored row: a straight row through the home at canopy height, spaced within MURIQUI_HOLDS.
		const spacing = (MURIQUI_HOLDS.min + MURIQUI_HOLDS.max) / 2;
		row = [];
		for (let k = -4; k <= 4; k++) {
			const x = homeX + k * spacing;
			row.push(x, heightAt(world.heights, x, homeZ) + 10, homeZ);
		}
	}
	const n = row.length / 3;
	const dx = row[(n - 1) * 3] - row[0];
	const dz = row[(n - 1) * 3 + 2] - row[2];
	const length = Math.hypot(dx, dz) || 1;
	// 1.6 u to the side, still inside the row's crowns (radius ≥ 3.9 u at the row's scale).
	const ox = (-dz / length) * 1.6;
	const oz = (dx / length) * 1.6;
	const beside: number[] = [];
	for (let k = 0; k < n; k++) beside.push(row[k * 3] + ox, row[k * 3 + 1], row[k * 3 + 2] + oz);
	return [row, beside];
}

function slothBranch(world: SurvivalWorld, homeX: number, homeZ: number, rng: LifeRng) {
	const tree =
		// The maned sloth browses young leaves of many broadleaf trees, not embaúbas in particular
		// (ICMBio sheet, p27-fatos-guia.md), so it lives in a big broadleaf crown.
		nearTrees(world, homeX, homeZ, 24, SLOTH_TREES)[0] ?? nearTrees(world, homeX, homeZ, 24, BROADLEAF)[0];
	if (!tree) {
		const y = heightAt(world.heights, homeX, homeZ) + 7;
		return { route: [homeX - 1, y, homeZ, homeX + 1, y + 0.2, homeZ], tree: null };
	}
	// The underside of one of the lowest branches, where the claws hook (behaviour contract).
	const crown = CROWNS[tree.kind];
	return { route: branch(tree, rng.range(0, TAU), 0.12, 0.62, crown.base - 0.1, 0.25), tree };
}

function toucanPerches(world: SurvivalWorld, homeX: number, homeZ: number, rng: LifeRng) {
	let trees = nearTrees(world, homeX, homeZ, 24, ['araucaria']);
	if (trees.length < 2) trees = [...trees, ...nearTrees(world, homeX, homeZ, 24, BROADLEAF)].slice(0, 3);
	const perches: Perch[] = [];
	const used: TreeRef[] = [];
	for (const tree of trees.slice(0, 3)) {
		const s = tree.scale;
		const a = rng.range(0, TAU);
		if (tree.kind === 'araucaria') {
			// The first ring of branches (9–10, radius ≤ 3) and the rim of the main platter (11–13).
			perches.push({
				x: tree.x + Math.sin(a) * 2.3 * s,
				y: tree.y + 9.8 * s,
				z: tree.z + Math.cos(a) * 2.3 * s,
				yaw: a,
				halfLength: 0.45
			});
			const b = a + 2.3;
			perches.push({
				x: tree.x + Math.sin(b) * 4.4 * s,
				y: tree.y + 12.3 * s,
				z: tree.z + Math.cos(b) * 4.4 * s,
				yaw: b,
				halfLength: 0.5
			});
		} else {
			const crown = CROWNS[tree.kind];
			perches.push({
				x: tree.x + Math.sin(a) * 0.7 * crown.radius * s,
				y: tree.y + (crown.base + 0.2) * s,
				z: tree.z + Math.cos(a) * 0.7 * crown.radius * s,
				yaw: a,
				halfLength: 0.5
			});
		}
		used.push(tree);
		if (used.length >= 2 && perches.length >= 4) break;
	}
	if (perches.length === 0) {
		const y = heightAt(world.heights, homeX, homeZ) + 8;
		perches.push({ x: homeX, y, z: homeZ, yaw: 0, halfLength: 0.5 });
	}
	return { perches, trees: used };
}

/**
 * The onça's trail: a closed loop around its home, searched over a small set
 * of ellipses for the one that keeps farthest from every trunk while staying
 * on walkable, dry, gentle ground inside the map. Points every ~1 u, on the
 * ground (the trail is the feet).
 */
export function oncaLoop(world: SurvivalWorld, homeX: number, homeZ: number): number[] {
	const trunks = nearTrees(world, homeX, homeZ, 26).map((t) => [t.x, t.z, 0.6 * t.scale] as const);
	const margin = 4;
	let best: { cx: number; cz: number; a: number; b: number; r: number; score: number } | null = null;
	for (const dx of [0, -3, 3])
		for (const dz of [0, -3, 3])
			for (const a of [7.5, 6, 9])
				for (const squash of [1, 0.7])
					for (const r of [0, Math.PI / 4, Math.PI / 2, (3 * Math.PI) / 4]) {
						const cx = homeX + dx;
						const cz = homeZ + dz;
						const b = a * squash;
						let score = Number.POSITIVE_INFINITY;
						let previous = Number.NaN;
						for (let k = 0; k <= 32; k++) {
							const u = (k / 32) * TAU;
							const lx = Math.sin(u) * a;
							const lz = Math.cos(u) * b;
							const x = cx + lx * Math.cos(r) + lz * Math.sin(r);
							const z = cz - lx * Math.sin(r) + lz * Math.cos(r);
							if (x < margin || z < margin || x > world.size - margin || z > world.size - margin) {
								score = Number.NEGATIVE_INFINITY;
								break;
							}
							const flags = flagAt(world, x, z);
							if (flags & FLAG.river || !(flags & FLAG.walkable)) {
								score = Number.NEGATIVE_INFINITY;
								break;
							}
							const h = heightAt(world.heights, x, z);
							const step = (TAU * Math.max(a, b)) / 32;
							if (Number.isFinite(previous) && Math.abs(h - previous) / step > 0.6) {
								score = Number.NEGATIVE_INFINITY;
								break;
							}
							previous = h;
							for (const [tx, tz, tr] of trunks) score = Math.min(score, Math.hypot(tx - x, tz - z) - tr);
						}
						if (best === null || score > best.score) best = { cx, cz, a, b, r, score };
					}
	const loop = best ?? { cx: homeX, cz: homeZ, a: 6, b: 6, r: 0, score: 0 };
	const perimeter =
		Math.PI * (3 * (loop.a + loop.b) - Math.sqrt((3 * loop.a + loop.b) * (loop.a + 3 * loop.b)));
	const count = Math.max(12, Math.ceil(perimeter));
	const out: number[] = [];
	for (let k = 0; k < count; k++) {
		const u = (k / count) * TAU;
		const lx = Math.sin(u) * loop.a;
		const lz = Math.cos(u) * loop.b;
		const x = loop.cx + lx * Math.cos(loop.r) + lz * Math.sin(loop.r);
		const z = loop.cz - lx * Math.sin(loop.r) + lz * Math.cos(loop.r);
		out.push(x, heightAt(world.heights, x, z), z);
	}
	return out;
}

// --- P23 routes (load time) ---------------------------------------------------------------

interface RiverPoint {
	x: number;
	z: number;
	/** Water surface there, and the unit tangent downstream. */
	surface: number;
	tx: number;
	tz: number;
}

/** The river's centre line at arc fraction `t` (0 at the waterfall, 1 at the mouth). */
function riverAt(world: SurvivalWorld, t: number): RiverPoint {
	const pts = world.river.points;
	const lengths = [0];
	for (let i = 1; i < pts.length; i++)
		lengths.push(lengths[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z));
	const target = Math.min(1, Math.max(0, t)) * lengths[lengths.length - 1];
	let i = 1;
	while (i < pts.length - 1 && lengths[i] < target) i++;
	const a = pts[i - 1];
	const b = pts[i];
	const span = lengths[i] - lengths[i - 1] || 1;
	const u = Math.min(1, Math.max(0, (target - lengths[i - 1]) / span));
	return {
		x: a.x + (b.x - a.x) * u,
		z: a.z + (b.z - a.z) * u,
		surface: a.water + (b.water - a.water) * u,
		tx: (b.x - a.x) / span,
		tz: (b.z - a.z) / span
	};
}

/** Distance from (x, z) to the river's centre line and the surface at the nearest point. */
function riverNear(world: SurvivalWorld, x: number, z: number) {
	const pts = world.river.points;
	let distance = Number.POSITIVE_INFINITY;
	let surface = world.waterLevel;
	for (let i = 1; i < pts.length; i++) {
		const a = pts[i - 1];
		const b = pts[i];
		const dx = b.x - a.x;
		const dz = b.z - a.z;
		const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz || 1)));
		const d = Math.hypot(x - a.x - t * dx, z - a.z - t * dz);
		if (d < distance) {
			distance = d;
			surface = a.water + (b.water - a.water) * t;
		}
	}
	return { distance, surface };
}

/** Points of a closed ellipse about every `step` u (at least 12): semi-axis `a` along `yaw` (0 = +z), `b` across. */
function ellipse(cx: number, cz: number, a: number, b: number, yaw: number, step = 1): [number, number][] {
	const perimeter = Math.PI * (3 * (a + b) - Math.sqrt((3 * a + b) * (a + 3 * b)));
	const count = Math.max(12, Math.ceil(perimeter / step));
	const out: [number, number][] = [];
	const ca = Math.cos(yaw);
	const sa = Math.sin(yaw);
	for (let k = 0; k < count; k++) {
		const u = (k / count) * TAU;
		const along = Math.cos(u) * a;
		const across = Math.sin(u) * b;
		out.push([cx + along * sa + across * ca, cz + along * ca - across * sa]);
	}
	return out;
}

const dry = (world: SurvivalWorld, x: number, z: number) => {
	const f = flagAt(world, x, z);
	return (f & FLAG.walkable) !== 0 && (f & FLAG.river) === 0;
};

/** Packs (x, z) points with their ground height. */
const onGround = (world: SurvivalWorld, pts: [number, number][]) =>
	pts.flatMap(([x, z]) => [x, heightAt(world.heights, x, z), z]);

/** True when a closed path stays inside the map on dry, walkable ground of `flag` (0: any) with gentle steps. */
function walkablePath(world: SurvivalWorld, pts: [number, number][], flag: number) {
	const margin = 3;
	for (let k = 0; k < pts.length; k++) {
		const [x, z] = pts[k];
		if (x < margin || z < margin || x > world.size - margin || z > world.size - margin) return false;
		if (!dry(world, x, z) || (flag && !(flagAt(world, x, z) & flag))) return false;
		const [nx, nz] = pts[(k + 1) % pts.length];
		const step = Math.hypot(nx - x, nz - z) || 1;
		if (Math.abs(heightAt(world.heights, nx, nz) - heightAt(world.heights, x, z)) / step > 0.6) return false;
	}
	return true;
}

/**
 * A walking loop around a home on the forest floor or open ground: the ellipse of about
 * `radius` with the most clearance from trunks that passes walkablePath (oncaLoop's
 * search, sized per species). Returns its centre, semi-axes and turn.
 */
function floorLoop(world: SurvivalWorld, homeX: number, homeZ: number, radius: number, flag: number) {
	const trunks = nearTrees(world, homeX, homeZ, radius + 18).map((t) => [t.x, t.z, 0.6 * t.scale] as const);
	let best: { cx: number; cz: number; a: number; b: number; r: number; score: number } | null = null;
	const shift = Math.max(1.5, radius * 0.4);
	for (const dx of [0, -shift, shift])
		for (const dz of [0, -shift, shift])
			for (const a of [radius, radius * 0.8, radius * 1.2])
				for (const squash of [0.7, 1])
					for (const r of [0, Math.PI / 4, Math.PI / 2, (3 * Math.PI) / 4]) {
						const cx = homeX + dx;
						const cz = homeZ + dz;
						const pts = ellipse(cx, cz, a, a * squash, r);
						if (!walkablePath(world, pts, flag)) continue;
						let score = Number.POSITIVE_INFINITY;
						for (const [x, z] of pts)
							for (const [tx, tz, tr] of trunks) score = Math.min(score, Math.hypot(tx - x, tz - z) - tr);
						if (best === null || score > best.score) best = { cx, cz, a, b: a * squash, r, score };
					}
	return best ?? { cx: homeX, cz: homeZ, a: radius, b: radius * 0.7, r: 0, score: 0 };
}

/**
 * A loop on a river bank, half in the water (the capivaras' and the anta's): centred on the
 * waterline at arc fraction `at`, on `side` (1: the west/north bank), long along the river.
 * Points deep enough to swim sit at the waterline minus the swimmer's draft and are marked 1.
 */
function bankLoop(
	world: SurvivalWorld,
	home: Extract<ReservaHome, { kind: 'bank' }>,
	inset: number,
	size: number,
	draft: number
) {
	const half = world.river.halfWidth;
	let found: { route: number[]; water: number[] } | null = null;
	for (const shift of [0, 0.02, -0.02, 0.04, -0.04, 0.06, -0.06]) {
		const r = riverAt(world, home.at + shift);
		const nx = -r.tz * home.side;
		const nz = r.tx * home.side;
		const cx = r.x + nx * half;
		const cz = r.z + nz * half;
		const yaw = Math.atan2(r.tx, r.tz);
		const pts = ellipse(cx, cz, home.along + inset, home.across + inset, yaw);
		const route: number[] = [];
		const water: number[] = [];
		let ok = true;
		for (const [x, z] of pts) {
			const ground = heightAt(world.heights, x, z);
			const near = riverNear(world, x, z);
			const wet = (flagAt(world, x, z) & FLAG.river) !== 0 || near.distance < half;
			if (wet && near.surface - ground > draft * size * 0.8) {
				// Swimming: at the waterline less the draft, never below the bed.
				route.push(x, Math.max(ground, near.surface - draft * size), z);
				water.push(1);
				continue;
			}
			if (!wet && !dry(world, x, z)) ok = false;
			// On the bank, or wading in the shallows: feet on the ground.
			route.push(x, ground, z);
			water.push(0);
		}
		if (ok && insideMap(world, pts)) {
			found = { route, water };
			break;
		}
	}
	return found;
}

const insideMap = (world: SurvivalWorld, pts: [number, number][]) =>
	pts.every(([x, z]) => x > 3 && z > 3 && x < world.size - 3 && z < world.size - 3);

/**
 * A wading line along the river's edge (the colhereiros): open, `length` long, centred at arc
 * fraction `at` on `side`, each point moved across until the water there is at most 0.3 u
 * deep (feet on the bed). `lane` shifts it toward (−) or away from (+) the water.
 */
function wadeLine(world: SurvivalWorld, home: Extract<ReservaHome, { kind: 'wade' }>, lane: number) {
	const half = world.river.halfWidth;
	const total = riverLength(world);
	const out: number[] = [];
	const steps = Math.max(4, Math.round(home.length));
	for (let k = 0; k <= steps; k++) {
		const t = home.at + ((k / steps - 0.5) * home.length) / total;
		const r = riverAt(world, t);
		const nx = -r.tz * home.side;
		const nz = r.tx * home.side;
		let x = r.x + nx * half;
		let z = r.z + nz * half;
		for (let d = half - 2; d <= half + 2; d += 0.25) {
			const px = r.x + nx * (d + lane);
			const pz = r.z + nz * (d + lane);
			if (r.surface - heightAt(world.heights, px, pz) <= 0.3) {
				x = px;
				z = pz;
				break;
			}
		}
		out.push(x, heightAt(world.heights, x, z), z);
	}
	return out;
}

function riverLength(world: SurvivalWorld) {
	const pts = world.river.points;
	let length = 0;
	for (let i = 1; i < pts.length; i++) length += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
	return length;
}

/** A trail stretch between arc fractions `from` and `to`, a point about every unit, on the ground. */
function trailStretch(world: SurvivalWorld, level: StoryLevel, id: string, from: number, to: number) {
	const trail = level.trails.find((t) => (t as { id?: string }).id === id);
	if (!trail) return null;
	const pts = trail.points;
	const lengths = [0];
	for (let i = 1; i < pts.length; i++)
		lengths.push(lengths[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
	const total = lengths[lengths.length - 1];
	const at = (s: number): [number, number] => {
		let i = 1;
		while (i < pts.length - 1 && lengths[i] < s) i++;
		const u = Math.min(1, Math.max(0, (s - lengths[i - 1]) / (lengths[i] - lengths[i - 1] || 1)));
		return [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * u, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * u];
	};
	const out: [number, number][] = [];
	const s0 = from * total;
	const s1 = to * total;
	const n = Math.max(2, Math.ceil(s1 - s0));
	for (let k = 0; k <= n; k++) out.push(at(s0 + ((s1 - s0) * k) / n));
	return onGround(world, out);
}

/** Small perches at the lower rim of the crowns near a home (saíras): two per tree, two trees. */
function rimPerches(
	world: SurvivalWorld,
	x: number,
	z: number,
	kinds: readonly TreeSpecies[],
	rng: LifeRng,
	depth: number
) {
	let near = nearTrees(world, x, z, 20, kinds);
	if (near.length === 0) near = nearTrees(world, x, z, 30);
	// Two trees whose crowns do not overlap, so each perch belongs to one crown.
	const trees: TreeRef[] = [];
	for (const tree of near) {
		const r = CROWNS[tree.kind].radius * tree.scale;
		if (trees.every((t) => Math.hypot(t.x - tree.x, t.z - tree.z) > r + CROWNS[t.kind].radius * t.scale))
			trees.push(tree);
		if (trees.length === 2) break;
	}
	const perches: Perch[] = [];
	for (const tree of trees) {
		const crown = CROWNS[tree.kind];
		const s = tree.scale;
		for (const k of [0, 1]) {
			const a = rng.range(0, TAU) + k * 2.4;
			perches.push({
				x: tree.x + Math.sin(a) * depth * crown.radius * s,
				y: tree.y + (crown.base + 0.15) * s,
				z: tree.z + Math.cos(a) * depth * crown.radius * s,
				yaw: a + Math.PI / 2,
				halfLength: 0.35
			});
		}
	}
	return { perches, trees };
}

/** P23 animals at RESERVA_HOMES (story map only). */
function planP23(world: SurvivalWorld, level: StoryLevel, seed: number, animals: AnimalPlan[]) {
	let herds = 0;
	for (const home of RESERVA_HOMES) {
		const species = home.species;
		const count = POPULATION[species];
		const rng = new LifeRng(subSeed(seed, 0x2300 + animals.length));
		const size = SPECIES[species].size;
		const homeXZ = (): [number, number] => {
			switch (home.kind) {
				case 'bank':
				case 'wade':
				case 'burrows': {
					const r = riverAt(world, home.at);
					return [
						r.x - r.tz * home.side * world.river.halfWidth,
						r.z + r.tx * home.side * world.river.halfWidth
					];
				}
				case 'trail':
					return [Number.NaN, Number.NaN];
				default:
					return [home.x, home.z];
			}
		};
		let [homeX, homeZ] = homeXZ();
		const push = (
			plan: Omit<AnimalPlan, 'key' | 'species' | 'homeX' | 'homeZ' | 'seed'>,
			as: SpeciesId = species
		) => {
			const index = animals.filter((a) => a.species === as).length;
			animals.push({
				key: `${as}-${index}`,
				species: as,
				homeX,
				homeZ,
				seed: subSeed(seed, animals.length + 1),
				...plan
			});
		};
		const ground = { loop: true, perches: null, arboreal: false, tree: null } as const;
		switch (home.kind) {
			case 'bank': {
				// The family (or the anta with her calf) on concentric loops, swimming where the loop dips into the river.
				const members: SpeciesId[] =
					species === 'anta'
						? ['anta', ...Array<SpeciesId>(POPULATION['anta-filhote']).fill('anta-filhote')]
						: Array(count).fill(species);
				const herd = members.length > 1 ? herds++ : -1;
				members.forEach((as, i) => {
					const lane = i === 0 ? 0 : (i % 2 === 1 ? -1 : 1) * 0.9 * Math.ceil(i / 2);
					const built = bankLoop(world, home, lane, SPECIES[as].size, DRAFT[as] ?? 0.5);
					if (!built) return;
					push({ ...ground, route: built.route, water: built.water, start: 0, herd, offset: -1.6 * i }, as);
				});
				break;
			}
			case 'floor': {
				const loop = floorLoop(world, home.x, home.z, home.radius, home.flag);
				const herd = count > 1 && species === 'cateto' ? herds++ : -1;
				for (let i = 0; i < count; i++) {
					// A band walks concentric loops (herd); others share the loop, spread along it.
					const lane = herd >= 0 ? (i === 0 ? 0 : (i % 2 === 1 ? -1 : 1) * 0.8 * Math.ceil(i / 2)) : 0;
					const a = Math.max(0.8, loop.a + lane);
					const b = Math.max(0.6, loop.b + lane);
					const route = onGround(world, ellipse(loop.cx, loop.cz, a, b, loop.r, size < 1 ? 0.5 : 1));
					const length = Math.PI * (3 * (a + b) - Math.sqrt((3 * a + b) * (a + 3 * b)));
					push({
						...ground,
						route,
						start: herd >= 0 ? 0 : (i / count) * length + rng.range(0, 1),
						herd,
						offset: herd >= 0 ? -1.4 * i : 0
					});
				}
				break;
			}
			case 'trail': {
				const route = trailStretch(world, level, home.trail, home.from, home.to);
				if (!route) break;
				homeX = route[Math.floor(route.length / 6) * 3];
				homeZ = route[Math.floor(route.length / 6) * 3 + 2];
				for (let i = 0; i < count; i++) push({ ...ground, route, loop: false, start: rng.range(0, 4) });
				break;
			}
			case 'burrows': {
				// Each crab at its own burrow on the mud above the waterline, scuttling round a tiny loop.
				for (let i = 0; i < count; i++) {
					const r = riverAt(world, home.at + (i - (count - 1) / 2) * 0.012);
					const nx = -r.tz * home.side;
					const nz = r.tx * home.side;
					const d = world.river.halfWidth + 1.4 + (i % 2) * 0.8;
					const route = onGround(
						world,
						ellipse(r.x + nx * d, r.z + nz * d, 0.9, 0.6, Math.atan2(r.tx, r.tz), 0.3)
					);
					push({ ...ground, route, start: rng.range(0, 3) });
				}
				break;
			}
			case 'wade': {
				const herd = count > 1 ? herds++ : -1;
				for (let i = 0; i < count; i++) {
					const lane = i === 0 ? 0 : i % 2 === 1 ? -0.7 : 0.7;
					push({
						...ground,
						route: wadeLine(world, home, lane),
						loop: false,
						start: home.length / 2,
						herd,
						offset: -1.5 * i
					});
				}
				break;
			}
			case 'canopy': {
				const { perches, trees } = rimPerches(world, home.x, home.z, BROADLEAF, rng, 0.65);
				for (let i = 0; i < count; i++)
					push({
						route: null,
						loop: false,
						perches,
						start: (i * 2) % Math.max(1, perches.length),
						arboreal: true,
						tree: trees[i % Math.max(1, trees.length)] ?? null
					});
				break;
			}
			case 'lawn': {
				// Ground perches on the lawn by the base, and the ipê-amarelo's lower branches.
				const perches: Perch[] = [];
				for (const [dx, dz, yaw] of [
					[0, 0, 0.4],
					[3.5, 2, 1.9],
					[-2.5, 3.2, -0.8]
				] as const) {
					const x = home.x + dx;
					const z = home.z + dz;
					if (dry(world, x, z))
						perches.push({ x, y: heightAt(world.heights, x, z), z, yaw, halfLength: 1, ground: true });
				}
				const { perches: high, trees } = rimPerches(world, home.x, home.z, ['ipe-amarelo'], rng, 0.55);
				perches.push(...high.slice(0, 2));
				for (let i = 0; i < count; i++)
					push({ route: null, loop: false, perches, start: 0, arboreal: true, tree: trees[0] ?? null });
				break;
			}
			case 'palms': {
				// Under the fronds of the juçara palms, where the fruit bunches hang.
				const palms = nearTrees(world, home.x, home.z, 60, ['jucara']).slice(0, 3);
				const perches: Perch[] = palms.map((tree) => {
					const a = rng.range(0, TAU);
					const crown = CROWNS[tree.kind];
					return {
						x: tree.x + Math.sin(a) * 0.35 * crown.radius * tree.scale,
						y: tree.y + (crown.base - 0.2) * tree.scale,
						z: tree.z + Math.cos(a) * 0.35 * crown.radius * tree.scale,
						yaw: a + Math.PI / 2,
						halfLength: 0.4
					};
				});
				if (perches.length === 0) {
					const fallback = rimPerches(world, home.x, home.z, BROADLEAF, rng, 0.6);
					perches.push(...fallback.perches);
				}
				if (palms[0]) {
					homeX = palms[0].x;
					homeZ = palms[0].z;
				}
				for (let i = 0; i < count; i++)
					push({ route: null, loop: false, perches, start: 0, arboreal: true, tree: palms[0] ?? null });
				break;
			}
		}
	}
	return herds;
}

/** Crown underside and top heights per CANOPY_CELL cell, from every modelled tree. */
export function canopyGrid(world: SurvivalWorld): CanopyGrid {
	const side = Math.ceil(world.size / CANOPY_CELL);
	const low = new Float32Array(side * side);
	const high = new Float32Array(side * side);
	const t = world.trees;
	for (let i = 0; i < t.count; i++) {
		const crown = CROWNS[t.kinds[t.kind[i]]];
		if (!crown.model) continue;
		const s = t.scale[i];
		const r = crown.radius * s * 0.85;
		const bottom = t.y[i] + crown.base * s;
		const top = t.y[i] + crown.top * s;
		const x0 = Math.max(0, Math.floor((t.x[i] - r) / CANOPY_CELL));
		const x1 = Math.min(side - 1, Math.floor((t.x[i] + r) / CANOPY_CELL));
		const z0 = Math.max(0, Math.floor((t.z[i] - r) / CANOPY_CELL));
		const z1 = Math.min(side - 1, Math.floor((t.z[i] + r) / CANOPY_CELL));
		for (let gz = z0; gz <= z1; gz++)
			for (let gx = x0; gx <= x1; gx++) {
				const cx = (gx + 0.5) * CANOPY_CELL;
				const cz = (gz + 0.5) * CANOPY_CELL;
				if (Math.hypot(cx - t.x[i], cz - t.z[i]) > r) continue;
				const q = gz * side + gx;
				low[q] = low[q] === 0 ? bottom : Math.min(low[q], bottom);
				high[q] = Math.max(high[q], top);
			}
	}
	return { cell: CANOPY_CELL, side, low, high };
}

/** The whole plan. Load time only (allocates). */
export function planLife(world: SurvivalWorld, level?: StoryLevel, seed: number = LIFE_SEED): LifePlan {
	const animals: AnimalPlan[] = [];
	let companion = -1;
	const homes = world.animals
		.map((home) => ({ home, species: ALBUM_TO_SPECIES[home.species] }))
		.filter((h): h is { home: (typeof world.animals)[number]; species: SpeciesId } => !!h.species);
	for (const { home, species } of homes) {
		const rng = new LifeRng(subSeed(seed, 0x100 + animals.length + home.id * 31));
		const count = POPULATION[species];
		const push = (plan: Omit<AnimalPlan, 'key' | 'species' | 'homeX' | 'homeZ' | 'seed'>) => {
			const index = animals.filter((a) => a.species === species).length;
			animals.push({
				key: `${species.split('-')[0]}-${index}`,
				species,
				homeX: home.x,
				homeZ: home.z,
				seed: subSeed(seed, animals.length + 1),
				...plan
			});
		};
		const along = (route: number[]) => {
			let length = 0;
			for (let k = 3; k < route.length; k += 3)
				length += Math.hypot(
					route[k] - route[k - 3],
					route[k + 1] - route[k - 2],
					route[k + 2] - route[k - 1]
				);
			return length;
		};
		switch (species) {
			case 'mico-leao-dourado':
				for (const { route, tree } of canopyRoutes(world, home.x, home.z, count, MICO_TREES, rng, 3)) {
					if (companion < 0) companion = animals.length;
					push({
						route,
						loop: false,
						perches: null,
						start: rng.range(0, along(route)),
						arboreal: true,
						tree
					});
				}
				break;
			case 'bugio-ruivo':
				for (const { route, tree } of canopyRoutes(world, home.x, home.z, count, BROADLEAF, rng, 2))
					push({
						route,
						loop: false,
						perches: null,
						start: rng.range(0, along(route)),
						arboreal: true,
						tree
					});
				break;
			case 'muriqui': {
				const rows = handholdRows(world, level, home.x, home.z);
				for (let i = 0; i < count; i++) {
					const route = rows[i % rows.length];
					// Opposite ends, so the two never start on the same hold.
					push({
						route,
						loop: false,
						perches: null,
						start: i % 2 === 0 ? 0 : route.length / 3 - 1,
						arboreal: true,
						tree: null
					});
				}
				break;
			}
			case 'preguica-de-coleira':
				for (let i = 0; i < count; i++) {
					const { route, tree } = slothBranch(world, home.x, home.z, rng);
					push({
						route,
						loop: false,
						perches: null,
						start: rng.range(0, along(route)),
						arboreal: true,
						tree
					});
				}
				break;
			case 'tucano-de-bico-verde': {
				const { perches, trees } = toucanPerches(world, home.x, home.z, rng);
				for (let i = 0; i < count; i++)
					push({
						route: null,
						loop: false,
						perches,
						start: (i * 2) % perches.length,
						arboreal: true,
						tree: trees[i % Math.max(1, trees.length)] ?? null
					});
				break;
			}
			case 'onca-pintada': {
				const route = oncaLoop(world, home.x, home.z);
				for (let i = 0; i < count; i++)
					push({
						route,
						loop: true,
						perches: null,
						start: rng.range(0, along(route)),
						arboreal: false,
						tree: null
					});
				break;
			}
		}
	}

	// The P23 species at their Reserva homes (the story map; survival maps keep the album's homes).
	const herds = level ? planP23(world, level, seed, animals) : 0;

	// Butterflies over the clareira (the level's landmark), else over the base clearing.
	const marker = level?.landmarks.find((l) => l.kind === 'butterflies');
	const bx = marker?.x ?? world.base.x;
	const bz = marker?.z ?? world.base.z;
	const half = marker ? 8.5 : 6;
	const meadow: Box = [bx - half, 0, bz - half, bx + half, 0, bz + half];
	const meadowGround = maxGround(world, meadow);
	// Low over the flowers, at a child's eye height (the avatar's eyes are 2.6 u up).
	meadow[1] = meadowGround.low + 0.5;
	meadow[4] = Math.max(meadowGround.low + 3.1, meadowGround.high + 1.2);

	// Small birds (saíras) over the micos' fragment; once the corridor is planted they cross it.
	const anchor = homes.find((h) => h.species === 'mico-leao-dourado')?.home ?? world.base;
	const corridorEnd =
		level?.planting.filter((p) => p.mission === 1).reduce((z, p) => Math.max(z, p.z), 0) ?? 0;
	const north: Box = [anchor.x - 18, 0, anchor.z - 22, anchor.x + 18, 0, anchor.z + 2];
	const across: Box = [
		anchor.x - 22,
		0,
		anchor.z - 22,
		anchor.x + 14,
		0,
		Math.max(anchor.z + 2, corridorEnd + 12)
	];
	const canopyTop = maxGround(world, across).high + 8;
	for (const box of [north, across]) {
		box[1] = canopyTop;
		box[4] = canopyTop + 5;
	}

	return {
		seed,
		size: world.size,
		animals,
		herds,
		companion,
		oncaAvoidRadius: level?.triggers.find((t) => t.kind === 'onca')?.radius ?? 15,
		butterflies: { bounds: meadow, after: meadow },
		birds: { bounds: north, after: across },
		canopy: canopyGrid(world)
	};
}
