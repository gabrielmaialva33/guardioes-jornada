/**
 * Biomes of the endless Mata Atlântica (WORLD.md §1, f-mundo-infinito.md
 * §3.4, §4.6): the real altitudinal and coastal order of the Floresta
 * Ombrófila Densa (IBGE 2012, 16–24°S bands) with stylized heights, as
 * weights that sum to 1 and blend over 24–30 u, never hard borders.
 *
 * The ladder reads the macro layer only: the coast distance e for the sea,
 * the coast and the baixada, and the distance s past the serra foot for the
 * rest, at the s where the macro height crosses WORLD.md's 8, 24 and 44 u
 * (macro.ts serraRise). Both grow with x at every z, so the order along any
 * west-to-east line is always sea → coast → baixada → submontana → montana →
 * alto-montana/campo → planalto. Within a rank, the coast splits into beach,
 * restinga and manguezal (near deep river mouths), and the heights into
 * sheltered alto-montana and exposed campo de altitude.
 *
 * Species, rock and ground-cover tables per biome await the biologist review
 * (WORLD.md §7, F4); biomes without models yet borrow existing species
 * (f-mundo-infinito.md §4.13).
 */
import {
	DECORATION_KINDS,
	type DecorationKind,
	TREE_SPECIES,
	type TreeSpecies,
	ZONE
} from '../survival/types.ts';
import { CREST_S, PLANALTO_S } from './macro.ts';
import { smooth as smoothstep } from './math.ts';

export const BIOMES = [
	'sea',
	'beach',
	'restinga',
	'mangue',
	'baixada',
	'submontana',
	'montana',
	'alto-montana',
	'campo',
	'planalto'
] as const;
export type Biome = (typeof BIOMES)[number];
export const BIOME = {
	sea: 0,
	beach: 1,
	restinga: 2,
	mangue: 3,
	baixada: 4,
	submontana: 5,
	montana: 6,
	altoMontana: 7,
	campo: 8,
	planalto: 9
} as const;
export const BIOME_COUNT = BIOMES.length;
/** Position in the west-to-east order; biomes of one rank are alternatives at the same place in it. */
export const BIOME_RANK: readonly number[] = [0, 1, 1, 1, 2, 3, 4, 5, 5, 6];
export const RANK_COUNT = 7;
/**
 * The survival zone each biome shows as, for the runtime's existing tints and
 * tables (survival/types.ts ZONE): the three forest bands are "slope", the
 * campo is "highland" and the araucária planalto is forest again.
 */
export const BIOME_ZONE: readonly number[] = [
	ZONE.sea,
	ZONE.beach,
	ZONE.restinga,
	ZONE.mangrove,
	ZONE.lowland,
	ZONE.slope,
	ZONE.slope,
	ZONE.slope,
	ZONE.highland,
	ZONE.slope
];
/** Biomes whose ground is forest or pasture (FLAG.forest / FLAG.cleared); the rest is open. */
export const WOODED: readonly boolean[] = [false, false, true, true, true, true, true, true, false, true];
/** Biomes where human pressure may have opened pasture (WORLD.md §1: high near the coast). */
export const GRAZED: readonly boolean[] = [false, false, true, false, true, true, true, false, false, true];

/** The ladder's edges: (centre, half width) of each blend, in e or s. */
const COAST_E = 10;
const BAIXADA_E = 45;
/** s where the macro height is 8, 24 and 44 u. */
const SUBMONTANA_S = -2;
const MONTANA_S = 60;
const HIGH_S = 175;
const BLEND_HALF = 15;

/**
 * Weights of every biome at a point, summing to 1, into `out`; returns the
 * dominant biome: the rank with the largest total weight (ranks swap once each
 * along a west-to-east line, so the dominant order is the ladder's), then its
 * heaviest member; ties go west. `estuary` is the distance to the nearest deep
 * river near sea level (manguezal); `exposure` in [0, 1] separates campo
 * (exposed) from alto-montana.
 */
export function biomeWeights(
	e: number,
	s: number,
	estuary: number,
	exposure: number,
	out: Float64Array
): number {
	const toCoast = smoothstep(COAST_E - 28, COAST_E - 8, e);
	const toBaixada = smoothstep(BAIXADA_E - BLEND_HALF, BAIXADA_E + BLEND_HALF, e);
	const toSubmontana = smoothstep(SUBMONTANA_S - 12, SUBMONTANA_S + 12, s);
	const toMontana = smoothstep(MONTANA_S - BLEND_HALF, MONTANA_S + BLEND_HALF, s);
	const toHigh = smoothstep(HIGH_S - BLEND_HALF, HIGH_S + BLEND_HALF, s);
	const toPlanalto = smoothstep(PLANALTO_S - BLEND_HALF, PLANALTO_S + BLEND_HALF, s);
	const coast = toCoast - toBaixada;
	const mangue = estuary < 30 ? (1 - smoothstep(12, 30, estuary)) * (1 - smoothstep(40, 90, e)) : 0;
	const beach = 1 - smoothstep(-6, 14, e);
	const high = toHigh - toPlanalto;
	const campo = smoothstep(0.4, 0.6, exposure);
	const sea = 1 - toCoast;
	const baixada = toBaixada - toSubmontana;
	const submontana = toSubmontana - toMontana;
	const montana = toMontana - toHigh;
	out[BIOME.sea] = sea;
	out[BIOME.beach] = coast * (1 - mangue) * beach;
	out[BIOME.restinga] = coast * (1 - mangue) * (1 - beach);
	out[BIOME.mangue] = coast * mangue;
	out[BIOME.baixada] = baixada;
	out[BIOME.submontana] = submontana;
	out[BIOME.montana] = montana;
	out[BIOME.altoMontana] = high * (1 - campo);
	out[BIOME.campo] = high * campo;
	out[BIOME.planalto] = toPlanalto;
	let rank = 0;
	let top = sea;
	if (coast > top) [rank, top] = [1, coast];
	if (baixada > top) [rank, top] = [2, baixada];
	if (submontana > top) [rank, top] = [3, submontana];
	if (montana > top) [rank, top] = [4, montana];
	if (high > top) [rank, top] = [5, high];
	if (toPlanalto > top) rank = 6;
	switch (rank) {
		case 0:
			return BIOME.sea;
		case 1: {
			let best: number = BIOME.beach;
			if (out[BIOME.restinga] > out[best]) best = BIOME.restinga;
			if (out[BIOME.mangue] > out[best]) best = BIOME.mangue;
			return best;
		}
		case 2:
			return BIOME.baixada;
		case 3:
			return BIOME.submontana;
		case 4:
			return BIOME.montana;
		case 5:
			return out[BIOME.campo] > out[BIOME.altoMontana] ? BIOME.campo : BIOME.altoMontana;
		default:
			return BIOME.planalto;
	}
}

/** Whether `exposure` matters at s (only the alto-montana/campo rank reads it). */
export const needsExposure = (s: number) => s > HIGH_S - BLEND_HALF && s < PLANALTO_S + BLEND_HALF;

/** Exposure from a noise value n in [−1, 1]: patches of campo, more of it right on the crest. */
export function exposureOf(n: number, s: number): number {
	const d = s - CREST_S;
	return 0.5 + 0.5 * n + 0.25 * (1 - smoothstep(0, 50, d < 0 ? -d : d));
}

/** Writes the weights as bytes summing to exactly 255 (the remainder goes to the heaviest). */
export function quantizeWeights(w: Float64Array, out: Uint8Array, offset: number) {
	let total = 0;
	let heaviest = 0;
	for (let b = 0; b < BIOME_COUNT; b++) {
		total += w[b];
		if (w[b] > w[heaviest]) heaviest = b;
	}
	const scale = 255 / total;
	let sum = 0;
	for (let b = 0; b < BIOME_COUNT; b++) {
		const q = (w[b] * scale + 0.5) | 0;
		out[offset + b] = q;
		sum += q;
	}
	out[offset + heaviest] += 255 - sum;
}

/**
 * A biome drawn from a vertex's byte weights by a roll in [0, 255): the
 * dithered species choice of Ghost of Tsushima (f-mundo-infinito.md §3.4), so
 * biomes interpenetrate across their blend.
 */
export function drawBiome(weights: Uint8Array, offset: number, roll: number): number {
	let acc = 0;
	for (let b = 0; b < BIOME_COUNT; b++) {
		acc += weights[offset + b];
		if (roll < acc) return b;
	}
	return BIOME_COUNT - 1;
}

const treeMix = (mix: Partial<Record<TreeSpecies, number>>) => TREE_SPECIES.map((s) => mix[s] ?? 0);
const decoMix = (mix: Partial<Record<DecorationKind, number>>) => DECORATION_KINDS.map((k) => mix[k] ?? 0);

/** Relative tree species weights per biome (WORLD.md §1 flora; alto-montana and campo borrow until F4). */
export const TREE_MIX: readonly (readonly number[])[] = [
	treeMix({}),
	treeMix({ jeriva: 1 }),
	treeMix({ jeriva: 3, embauba: 1 }),
	treeMix({ 'mangue-vermelho': 1 }),
	treeMix({ jucara: 2, embauba: 1, 'ipe-amarelo': 2, 'ipe-rosa': 1, 'pau-brasil': 2, jequitiba: 1 }),
	treeMix({ jucara: 3, xaxim: 2, embauba: 1, jequitiba: 1 }),
	treeMix({ jequitiba: 2, xaxim: 2, jucara: 2 }),
	treeMix({ xaxim: 2, jucara: 1, embauba: 1 }),
	treeMix({ xaxim: 1, araucaria: 1 }),
	treeMix({ araucaria: 5, xaxim: 1, embauba: 1 })
];
/** Share of blue-noise points that grow a tree, per biome (survival's TREE_DENSITY where it overlaps). */
export const TREE_DENSITY: readonly number[] = [0, 0.06, 0.4, 0.55, 0.85, 0.8, 0.75, 0.55, 0.03, 0.55];
/** Tree scale range per biome: low twisted trees in the alto-montana. */
export const TREE_SCALE: readonly (readonly [number, number])[] = [
	[0.8, 1.3],
	[0.7, 1.1],
	[0.7, 1.1],
	[0.8, 1.2],
	[0.8, 1.3],
	[0.8, 1.3],
	[0.85, 1.35],
	[0.55, 0.8],
	[0.6, 0.9],
	[0.85, 1.3]
];
/** Pasture: lone pioneer embaúbas (survival's pasture mix and density). */
export const PASTURE_TREES = treeMix({ embauba: 1 });
export const PASTURE_DENSITY = 0.04;
/** Share of the points left without a tree that hold a rock, per biome; near rivers it is RIVER_ROCKS. */
export const ROCK_SHARE: readonly number[] = [0, 0.3, 0.15, 0, 0.25, 0.4, 0.5, 0.5, 0.12, 0.25];
export const RIVER_ROCKS = 0.6;
/** Ground cover per biome over DECORATION_KINDS; the sea and the mangue have none. */
export const DECO_MIX: readonly (readonly number[])[] = [
	decoMix({}),
	decoMix({ 'beach-grass': 1 }),
	decoMix({ grass: 1, bush: 2, bromelia: 2 }),
	decoMix({}),
	decoMix({ flower: 1, bush: 2, fern: 2, bromelia: 1 }),
	decoMix({ bush: 1, fern: 3, bromelia: 2 }),
	decoMix({ bush: 1, fern: 3, bromelia: 2 }),
	decoMix({ grass: 1, bush: 1, fern: 2, bromelia: 3 }),
	decoMix({ grass: 3, flower: 2 }),
	decoMix({ grass: 2, flower: 1, bush: 1, fern: 1 })
];
export const PASTURE_DECO = decoMix({ grass: 3, flower: 1 });
