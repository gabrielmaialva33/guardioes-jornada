/**
 * Where everything alive lives, derived once from the map (pure data, no
 * three): the animals' routes at their homes (world.animals, LEVEL.md §10),
 * the flock boxes and the canopy and clearing grids the particles spawn from.
 * Deterministic from the world, the level and a seed.
 *
 * Trees are the world's placements; their crowns come from the measured GLBs
 * (CROWNS, model units × the placement scale). Animals only use species that
 * render as a real model today: pau-brasil, jerivá and mangue-vermelho are
 * still grey pillars in world-runtime, so nothing perches on them.
 */
import { MURIQUI_HOLDS, type Perch, type SpeciesId } from '../animation/animals/index.ts';
import type { StoryLevel } from '../level/types.ts';
import { heightAt } from '../survival/terrain.ts';
import { FLAG, type SurvivalWorld, type TreeSpecies } from '../survival/types.ts';
import { LifeRng, subSeed } from './rng.ts';

/** Default seed of the layer (golden frames and tests use it). */
export const LIFE_SEED = 20261025;

const TAU = Math.PI * 2;

/** One crown, model units (measured from game/src/assets/models/custom-*.glb, vertex radius per height band). */
export interface Crown {
	/** Height where the leaf mass starts (the lowest branches) and its top. */
	readonly base: number;
	readonly top: number;
	/** Widest leaf radius. */
	readonly radius: number;
	/** True when world-runtime draws the species as its model (false: a grey placeholder pillar). */
	readonly model: boolean;
}

export const CROWNS: Readonly<Record<TreeSpecies, Crown>> = {
	jequitiba: { base: 13, top: 18, radius: 6.5, model: true },
	// Two tiers: a first ring of branches at 9–10 (radius 3), the main platter at 11–13 (radius 5.5).
	araucaria: { base: 9.3, top: 13.4, radius: 5.4, model: true },
	embauba: { base: 7, top: 10.5, radius: 4, model: true },
	jucara: { base: 4, top: 8, radius: 3.8, model: true },
	'ipe-rosa': { base: 6.3, top: 10.2, radius: 5.4, model: true },
	'ipe-amarelo': { base: 6.3, top: 10.2, radius: 5.4, model: true },
	xaxim: { base: 2.5, top: 5.8, radius: 3.4, model: true },
	'pau-brasil': { base: 6.4, top: 10.9, radius: 5.5, model: false },
	jeriva: { base: 6.8, top: 10.7, radius: 3.9, model: false },
	'mangue-vermelho': { base: 5, top: 8.5, radius: 4.3, model: false }
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
	'onca-pintada': 1
};

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

const BROADLEAF: readonly TreeSpecies[] = ['jequitiba', 'ipe-rosa', 'ipe-amarelo', 'embauba'];
const MICO_TREES: readonly TreeSpecies[] = ['jequitiba', 'ipe-rosa', 'ipe-amarelo', 'embauba', 'jucara'];

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
		nearTrees(world, homeX, homeZ, 8, ['embauba'])[0] ?? nearTrees(world, homeX, homeZ, 24, BROADLEAF)[0];
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
		companion,
		oncaAvoidRadius: level?.triggers.find((t) => t.kind === 'onca')?.radius ?? 15,
		butterflies: { bounds: meadow, after: meadow },
		birds: { bounds: north, after: across },
		canopy: canopyGrid(world)
	};
}
