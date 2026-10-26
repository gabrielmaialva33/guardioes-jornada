import { describe, expect, it } from 'vitest';
import { floor } from '../survival/noise.ts';
import { BIOME, BIOME_COUNT, BIOME_RANK, BIOMES, biomeWeights, RANK_COUNT } from './biomes.ts';
import { generateChunk, type WorldChunk } from './chunk.ts';
import { CHUNK_SIZE, layerSeeds, WORLD_SEED } from './constants.ts';
import { BAIXADA_FOOT, COSTAO_FOOT, CREST_S, coastX, PLANALTO_S, serraFoot } from './macro.ts';

const layers = layerSeeds(WORLD_SEED);

/** z rows far from the Reserva at a costão and in a wide baixada, found by sweeping the macro. */
function findZ(test: (foot: number) => boolean, from: number): number {
	for (let z = from; z < from + 40000; z += 40) if (test(serraFoot(z, layers))) return z + 20;
	throw new Error('no such z');
}
const COSTAO_Z = findZ((f) => f < COSTAO_FOOT + 8, 3000);
const BAIXADA_Z = findZ((f) => f > BAIXADA_FOOT - 20, 3000);

interface Sample {
	x: number;
	biome: number;
	weights: Uint8Array;
}

/** The generated row of vertices at z from the sea to well into the planalto. */
function transect(z: number): Sample[] {
	const coast = coastX(z, layers);
	const x0 = floor((coast - 160) / CHUNK_SIZE);
	const x1 = floor((coast + serraFoot(z, layers) + PLANALTO_S + 240) / CHUNK_SIZE);
	const cz = floor(z / CHUNK_SIZE);
	const j = z - cz * CHUNK_SIZE;
	const out: Sample[] = [];
	for (let cx = x0; cx <= x1; cx++) {
		const c: WorldChunk = generateChunk(cx, cz, WORLD_SEED);
		expect(c.handMade).toBe(false);
		for (let i = 0; i < CHUNK_SIZE; i++) {
			const q = j * c.grid + i;
			out.push({
				x: c.x0 + i,
				biome: c.biome[q],
				weights: c.biomeWeights.subarray(q * BIOME_COUNT, (q + 1) * BIOME_COUNT)
			});
		}
	}
	return out;
}

const rankWeight = (w: Uint8Array, rank: number) => {
	let sum = 0;
	for (let b = 0; b < BIOME_COUNT; b++) if (BIOME_RANK[b] === rank) sum += w[b];
	return sum;
};

describe('biomes', () => {
	it.each([
		['next to the Reserva', -60],
		['at a costão', COSTAO_Z],
		['in a wide baixada', BAIXADA_Z]
	])(
		'follow the ladder west to east %s (z %i): sea → coast → baixada → submontana → montana → alto-montana/campo → planalto',
		(_, z) => {
			const row = transect(z);
			const ranks = row.map((s) => BIOME_RANK[s.biome]);
			for (let k = 1; k < ranks.length; k++)
				expect(ranks[k], `x ${row[k].x}`).toBeGreaterThanOrEqual(ranks[k - 1]);
			expect(new Set(ranks).size).toBe(RANK_COUNT);
			// Every rank holds for a while (no one-vertex slivers).
			for (let r = 0; r < RANK_COUNT; r++) expect(ranks.filter((v) => v === r).length).toBeGreaterThan(12);
			const seen = new Set(row.map((s) => s.biome));
			expect(seen.has(BIOME.restinga) || seen.has(BIOME.mangue)).toBe(true);
			expect(seen.has(BIOME.altoMontana) || seen.has(BIOME.campo)).toBe(true);
		}
	);

	it('blend over 20–40 u where the macro is calibrated (no hard borders)', () => {
		const row = transect(-60);
		for (let r = 0; r + 1 < RANK_COUNT; r++) {
			const first = row.findIndex((s) => rankWeight(s.weights, r + 1) > 0);
			let last = -1;
			row.forEach((s, k) => {
				if (rankWeight(s.weights, r) > 0) last = k;
			});
			const width = row[last].x - row[first].x;
			expect(width, `rank ${r} → ${r + 1}`).toBeGreaterThanOrEqual(18);
			expect(width, `rank ${r} → ${r + 1}`).toBeLessThanOrEqual(40);
		}
	});

	it('weigh every vertex to exactly 255, the dominant biome among the weighted ones', () => {
		for (const [cx, cz] of [
			[-1, -2],
			[6, 9],
			[20, 30],
			[-500, 77]
		]) {
			const c = generateChunk(cx, cz, WORLD_SEED);
			for (let q = 0; q < c.biome.length; q++) {
				let sum = 0;
				for (let b = 0; b < BIOME_COUNT; b++) sum += c.biomeWeights[q * BIOME_COUNT + b];
				expect(sum).toBe(255);
				expect(c.biomeWeights[q * BIOME_COUNT + c.biome[q]]).toBeGreaterThan(0);
			}
		}
	});

	it('split the coast into beach, restinga and mangue, and the heights into alto-montana and campo', () => {
		const w = new Float64Array(BIOME_COUNT);
		expect(biomeWeights(-2, -200, Number.POSITIVE_INFINITY, 0, w)).toBe(BIOME.beach);
		expect(biomeWeights(20, -200, Number.POSITIVE_INFINITY, 0, w)).toBe(BIOME.restinga);
		expect(biomeWeights(20, -200, 4, 0, w)).toBe(BIOME.mangue);
		expect(biomeWeights(200, CREST_S, Number.POSITIVE_INFINITY, 0.2, w)).toBe(BIOME.altoMontana);
		expect(biomeWeights(200, CREST_S, Number.POSITIVE_INFINITY, 0.9, w)).toBe(BIOME.campo);
		expect(biomeWeights(200, PLANALTO_S + 100, Number.POSITIVE_INFINITY, 0.9, w)).toBe(BIOME.planalto);
		let total = 0;
		for (const v of w) total += v;
		expect(total).toBeCloseTo(1, 12);
		expect(BIOMES).toHaveLength(BIOME_COUNT);
	});

	it('grow mangroves at river mouths and campos on the crest somewhere', () => {
		const counts = new Uint32Array(BIOME_COUNT);
		for (let cz = -30; cz < 30; cz += 3)
			for (let cx = -3; cx < 25; cx += 2) {
				const c = generateChunk(cx, cz, WORLD_SEED);
				for (const b of c.biome) counts[b]++;
			}
		for (let b = 0; b < BIOME_COUNT; b++) expect(counts[b], BIOMES[b]).toBeGreaterThan(0);
	});
});
