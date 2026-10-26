/**
 * Where the study fauna lives on the story map (LEVEL.md §3–§6, the 160 × 160
 * Reserva), as plain data: pure and deterministic, so the tests check it
 * without a renderer. Each wish names a target point and a habitat; the plan
 * snaps it to the nearest cell of that habitat (spiral search), and the
 * runtime keeps every step on the same habitat.
 *
 * Grids are the world's: cell (i, j) is the ground point (x = i, z = j) at
 * index j * grid + i.
 */
import type { StoryLevel } from '../level/types.ts';
import { FLAG, type SurvivalWorld, ZONE } from '../survival/types.ts';

/** Where an animal may stand. Every habitat is walkable, dry, off bridges and off the base pad. */
export type StudyHabitat = 'any' | 'bank' | 'forest' | 'open' | 'shore' | 'serra';

export type StudyBehaviourKind =
	/** Wanders and grazes around its home; alerts, then flees from the player. */
	| 'graze'
	/** Keeps an offset from its leader (a calf, a band), flees with it. */
	| 'follow'
	/** Walks back and forth between two ends (the tatu across the trail). */
	| 'cross'
	/** Walks away when the player comes within `avoid` (the puma, like our onça). */
	| 'shy'
	/** Stays on a perch (the toucan A/B). */
	| 'perch';

export interface StudyMember {
	/** Stable key, e.g. 'capivara-1'. */
	key: string;
	/** StudyAnimal id in catalog.ts. */
	species: string;
	/** Members of one group alert and flee together. */
	group: string;
	behaviour: StudyBehaviourKind;
	habitat: StudyHabitat;
	x: number;
	z: number;
	/** Perch height (perch behaviour); ground animals sample the ground. */
	y: number | null;
	yaw: number;
	homeX: number;
	homeZ: number;
	/** Wander radius around home, u. */
	radius: number;
	/** Index of the leader in the plan (follow), else -1. */
	leader: number;
	/** Offset from the leader in its frame: right, forward (u). */
	offsetX: number;
	offsetZ: number;
	/** Cross: the two ends. */
	ends: [number, number, number, number] | null;
	/** Size variation around the species height (0.9–1.05). */
	size: number;
	seed: number;
}

export interface StudyPlan {
	members: StudyMember[];
	/** Distance to the nearest river cell per grid cell, u (chamfer, ≈ Euclidean). */
	riverDistance: Float32Array;
}

/** An animal's limits on ground slope between neighbouring cells (WALK_SLOPE is 0.9). */
export const STUDY_SLOPE = 0.75;
/** Bank: dry ground within this band from the water, u. */
export const BANK_BAND = [1.5, 6] as const;
/** The puma walks away inside this radius (LEVEL.md §10 gives the onça 15 u). */
export const PUMA_AVOID = 15;

/** Small deterministic generator (mulberry32). */
export function studyRandom(seed: number) {
	let state = seed >>> 0;
	return () => {
		state = (state + 0x6d2b79f5) >>> 0;
		let t = state;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/** Two-pass chamfer distance (1, √2) from every river cell. */
export function riverDistanceField(world: SurvivalWorld): Float32Array {
	const n = world.grid;
	const d = new Float32Array(n * n).fill(1e6);
	for (let k = 0; k < n * n; k++) if (world.flags[k] & FLAG.river) d[k] = 0;
	const s = Math.SQRT2;
	for (let j = 0; j < n; j++)
		for (let i = 0; i < n; i++) {
			const k = j * n + i;
			let v = d[k];
			if (i > 0) v = Math.min(v, d[k - 1] + 1);
			if (j > 0) {
				v = Math.min(v, d[k - n] + 1);
				if (i > 0) v = Math.min(v, d[k - n - 1] + s);
				if (i < n - 1) v = Math.min(v, d[k - n + 1] + s);
			}
			d[k] = v;
		}
	for (let j = n - 1; j >= 0; j--)
		for (let i = n - 1; i >= 0; i--) {
			const k = j * n + i;
			let v = d[k];
			if (i < n - 1) v = Math.min(v, d[k + 1] + 1);
			if (j < n - 1) {
				v = Math.min(v, d[k + n] + 1);
				if (i < n - 1) v = Math.min(v, d[k + n + 1] + s);
				if (i > 0) v = Math.min(v, d[k + n - 1] + s);
			}
			d[k] = v;
		}
	return d;
}

const BLOCKED = FLAG.river | FLAG.crossing | FLAG.base;

/** True when an animal of `habitat` may stand at (x, z). */
export function habitatAt(
	world: SurvivalWorld,
	riverDistance: Float32Array,
	habitat: StudyHabitat,
	x: number,
	z: number
): boolean {
	const n = world.grid;
	const i = Math.round(x);
	const j = Math.round(z);
	if (i < 2 || j < 2 || i > n - 3 || j > n - 3) return false;
	const k = j * n + i;
	const flags = world.flags[k];
	if (!(flags & FLAG.walkable) || flags & BLOCKED) return false;
	const h = world.heights;
	const y = h[k];
	if (
		Math.abs(h[k + 1] - y) > STUDY_SLOPE ||
		Math.abs(h[k - 1] - y) > STUDY_SLOPE ||
		Math.abs(h[k + n] - y) > STUDY_SLOPE ||
		Math.abs(h[k - n] - y) > STUDY_SLOPE
	)
		return false;
	const river = riverDistance[k];
	if (river < 1.5) return false;
	switch (habitat) {
		case 'any':
			return true;
		case 'bank':
			return river <= BANK_BAND[1];
		case 'forest':
			return (flags & FLAG.forest) !== 0;
		case 'open':
			return (flags & (FLAG.cleared | FLAG.corridor)) !== 0;
		case 'shore': {
			const zone = world.zones[k];
			return zone === ZONE.beach || zone === ZONE.mangrove || zone === ZONE.restinga;
		}
		case 'serra':
			return x > 140 || world.zones[k] === ZONE.slope || world.zones[k] === ZONE.highland;
	}
}

/** The nearest cell of `habitat` to (x, z) within `reach` u, by a square spiral; null if none. */
export function findSpot(
	world: SurvivalWorld,
	riverDistance: Float32Array,
	habitat: StudyHabitat,
	x: number,
	z: number,
	reach = 24
): { x: number; z: number } | null {
	const cx = Math.round(x);
	const cz = Math.round(z);
	let best = null as { x: number; z: number; d: number } | null;
	for (let r = 0; r <= reach; r++) {
		for (let dz = -r; dz <= r; dz++)
			for (let dx = -r; dx <= r; dx++) {
				if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
				const px = cx + dx;
				const pz = cz + dz;
				if (!habitatAt(world, riverDistance, habitat, px, pz)) continue;
				const d = Math.hypot(px - x, pz - z);
				if (!best || d < best.d) best = { x: px, z: pz, d };
			}
		// The ring after the first hit can still hold a nearer diagonal; stop one ring later.
		if (best && r >= Math.ceil(best.d)) break;
	}
	return best ? { x: best.x, z: best.z } : null;
}

interface Wish {
	key: string;
	species: string;
	group: string;
	behaviour: StudyBehaviourKind;
	habitat: StudyHabitat;
	x: number;
	z: number;
	radius: number;
	leader?: string;
	offset?: [number, number];
	ends?: [number, number, number, number];
}

/**
 * The study population (brief P14 §2): a capivara family on the river bank, an
 * anta with her calf near the water in the south, a band of catetos in the west
 * fragment by the trilha, a tatu crossing the trilha, sapos-cururu by the river
 * stones, caranguejos on the restinga strip, a rare onça-parda at the serra
 * edge, a jabuti in the forest by the ponte trail and a tamanduá in the pasture.
 */
export const STUDY_WISHES: readonly Wish[] = [
	{
		key: 'capivara-0',
		species: 'Capybara',
		group: 'capivaras',
		behaviour: 'graze',
		habitat: 'bank',
		x: 70,
		z: 100,
		radius: 6
	},
	{
		key: 'capivara-1',
		species: 'Capybara',
		group: 'capivaras',
		behaviour: 'graze',
		habitat: 'bank',
		x: 68,
		z: 103,
		radius: 6
	},
	{
		key: 'capivara-2',
		species: 'Capybara',
		group: 'capivaras',
		behaviour: 'graze',
		habitat: 'bank',
		x: 72,
		z: 97,
		radius: 6
	},
	{
		key: 'anta',
		species: 'Tapir',
		group: 'antas',
		behaviour: 'graze',
		habitat: 'bank',
		x: 52,
		z: 146,
		radius: 8
	},
	{
		key: 'anta-filhote',
		species: 'Tapir_baby',
		group: 'antas',
		behaviour: 'follow',
		habitat: 'any',
		x: 50,
		z: 148,
		radius: 8,
		leader: 'anta',
		offset: [1.6, -2.4]
	},
	{
		key: 'cateto-0',
		species: 'Peccary',
		group: 'catetos',
		behaviour: 'graze',
		habitat: 'forest',
		x: 30,
		z: 64,
		radius: 9
	},
	{
		key: 'cateto-1',
		species: 'Peccary',
		group: 'catetos',
		behaviour: 'follow',
		habitat: 'forest',
		x: 28,
		z: 66,
		radius: 9,
		leader: 'cateto-0',
		offset: [-1.8, -1.6]
	},
	{
		key: 'cateto-2',
		species: 'Peccary',
		group: 'catetos',
		behaviour: 'follow',
		habitat: 'forest',
		x: 32,
		z: 66,
		radius: 9,
		leader: 'cateto-0',
		offset: [1.9, -2]
	},
	{
		key: 'cateto-3',
		species: 'Peccary',
		group: 'catetos',
		behaviour: 'follow',
		habitat: 'forest',
		x: 29,
		z: 68,
		radius: 9,
		leader: 'cateto-0',
		offset: [-0.6, -3.8]
	},
	{
		key: 'cateto-4',
		species: 'Peccary',
		group: 'catetos',
		behaviour: 'follow',
		habitat: 'forest',
		x: 31,
		z: 69,
		radius: 9,
		leader: 'cateto-0',
		offset: [1.2, -5.2]
	},
	{
		key: 'tatu',
		species: 'Armadillo',
		group: 'tatu',
		behaviour: 'cross',
		habitat: 'any',
		x: 44,
		z: 64,
		radius: 9,
		ends: [37, 61.5, 51, 66.5]
	},
	{
		key: 'sapo-0',
		species: 'CaneToad',
		group: 'sapos',
		behaviour: 'graze',
		habitat: 'bank',
		x: 83,
		z: 66,
		radius: 2.5
	},
	{
		key: 'sapo-1',
		species: 'CaneToad',
		group: 'sapos',
		behaviour: 'graze',
		habitat: 'bank',
		x: 85,
		z: 64,
		radius: 2.5
	},
	{
		key: 'sapo-2',
		species: 'CaneToad',
		group: 'sapos-leste',
		behaviour: 'graze',
		habitat: 'bank',
		x: 107,
		z: 86,
		radius: 2.5
	},
	{
		key: 'caranguejo-0',
		species: 'Crab',
		group: 'caranguejos',
		behaviour: 'graze',
		habitat: 'shore',
		x: 5,
		z: 140,
		radius: 4
	},
	{
		key: 'caranguejo-1',
		species: 'Crab',
		group: 'caranguejos',
		behaviour: 'graze',
		habitat: 'shore',
		x: 4,
		z: 144,
		radius: 4
	},
	{
		key: 'caranguejo-2',
		species: 'Crab',
		group: 'caranguejos',
		behaviour: 'graze',
		habitat: 'shore',
		x: 6,
		z: 147,
		radius: 4
	},
	{
		key: 'caranguejo-3',
		species: 'Crab',
		group: 'caranguejos',
		behaviour: 'graze',
		habitat: 'shore',
		x: 5,
		z: 151,
		radius: 4
	},
	{
		key: 'onca-parda',
		species: 'Puma',
		group: 'onca-parda',
		behaviour: 'shy',
		habitat: 'serra',
		x: 150,
		z: 24,
		radius: 10
	},
	{
		key: 'jabuti',
		species: 'RedFootedTortoise',
		group: 'jabuti',
		behaviour: 'graze',
		habitat: 'forest',
		x: 28,
		z: 110,
		radius: 3
	},
	{
		key: 'tamandua',
		species: 'GiantAnteater',
		group: 'tamandua',
		behaviour: 'graze',
		habitat: 'open',
		x: 60,
		z: 52,
		radius: 10
	}
];

/** Snap every wish to its habitat; members whose habitat is nowhere near are dropped. */
export function planStudyHerds(world: SurvivalWorld, _level?: StoryLevel, seed = 0x5eed14): StudyPlan {
	const riverDistance = riverDistanceField(world);
	const random = studyRandom(seed);
	const members: StudyMember[] = [];
	const index = new Map<string, number>();
	for (const wish of STUDY_WISHES) {
		const spot = findSpot(world, riverDistance, wish.habitat, wish.x, wish.z);
		if (!spot) continue;
		const leader = wish.leader ? (index.get(wish.leader) ?? -1) : -1;
		if (wish.leader && leader < 0) continue;
		const home = leader >= 0 ? members[leader] : null;
		index.set(wish.key, members.length);
		members.push({
			key: wish.key,
			species: wish.species,
			group: wish.group,
			behaviour: wish.behaviour,
			habitat: wish.habitat,
			x: spot.x,
			z: spot.z,
			y: null,
			yaw: random() * Math.PI * 2,
			homeX: home ? home.homeX : spot.x,
			homeZ: home ? home.homeZ : spot.z,
			radius: wish.radius,
			leader,
			offsetX: wish.offset?.[0] ?? 0,
			offsetZ: wish.offset?.[1] ?? 0,
			ends: wish.ends ?? null,
			size: 0.92 + random() * 0.12,
			seed: Math.floor(random() * 0xffffffff)
		});
	}
	return { members, riverDistance };
}

/**
 * A perched bird beside one of our tucano's perches, facing the same way: the
 * toucan A/B on one side (`side` 1), the arara-vermelha ("verify fit") on the other (−1).
 */
export function perchMember(
	key: string,
	species: string,
	perch: { x: number; y: number; z: number; yaw: number },
	side: number
): StudyMember {
	const x = perch.x + Math.cos(perch.yaw) * 1.4 * side;
	const z = perch.z - Math.sin(perch.yaw) * 1.4 * side;
	return {
		key,
		species,
		group: key,
		behaviour: 'perch',
		habitat: 'any',
		x,
		z,
		y: perch.y,
		yaw: perch.yaw,
		homeX: x,
		homeZ: z,
		radius: 0,
		leader: -1,
		offsetX: 0,
		offsetZ: 0,
		ends: null,
		size: 1,
		seed: key.length * 0x9e37 + species.length
	};
}

/**
 * Each group's home in the park (PARK.md §2 and §10) once those zones exist as
 * maps. Until then every group lives in the Reserva, at the spots above.
 */
export const PARK_HOMES: Readonly<Record<string, string>> = {
	capivaras: 'Manguezal, river banks',
	antas: 'Vale das Cachoeiras, by the pool',
	catetos: 'Copa das Árvores and the Vale',
	tatu: 'Reserva, on the trails',
	sapos: 'Vale das Cachoeiras, by the pool',
	'sapos-leste': 'Vale das Cachoeiras, by the pool',
	caranguejos: 'Manguezal, on the mud by the boardwalk',
	'onca-parda': 'Copa das Árvores (rare)',
	jabuti: 'Copa das Árvores, forest floor',
	tamandua: 'Reserva, the pasture',
	'tucano-estudo': 'Reserva, beside our tucano (A/B)',
	'arara-estudo': 'Reserva, beside our tucano (verify fit)'
};
