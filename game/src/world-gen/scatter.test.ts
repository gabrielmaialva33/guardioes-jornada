import { describe, expect, it } from 'vitest';
import { poissonDisk } from '../survival/poisson.ts';
import { Rng } from '../survival/random.ts';
import type { Placements } from '../survival/types.ts';
import { DECO_SPACING, generateArea, generateChunk, TREE_SPACING } from './chunk.ts';
import { CHUNK_SIZE, WORLD_SEED } from './constants.ts';
import { blueNoise } from './scatter.ts';

const keys = (flat: number[]) => {
	const out: string[] = [];
	for (let k = 0; k < flat.length; k += 3) out.push(`${flat[k]},${flat[k + 1]},${flat[k + 2]}`);
	return out.sort();
};

function minDistance(xs: number[], zs: number[]): number {
	let best = Number.POSITIVE_INFINITY;
	for (let a = 0; a < xs.length; a++)
		for (let b = a + 1; b < xs.length; b++) {
			const dx = xs[a] - xs[b];
			const dz = zs[a] - zs[b];
			best = Math.min(best, dx * dx + dz * dz);
		}
	return Math.sqrt(best);
}

const items = (p: Placements<string>) =>
	Array.from({ length: p.count }, (_, k) =>
		[p.kind[k], p.x[k], p.y[k], p.z[k], p.scale[k], p.yawC[k], p.yawS[k]].join(':')
	);

describe('seamless scattering', () => {
	it.each([
		[TREE_SPACING, 0, 0],
		[DECO_SPACING, -400, 1200],
		[3, 123456, -98765]
	])('blue noise r = %f: the union of 40 u chunks is the whole area, no duplicates', (r, ox, oz) => {
		const seed = 0x5eed + r * 100;
		const whole = blueNoise(seed, r, ox, oz, ox + 160, oz + 120);
		const union: number[] = [];
		for (let b = 0; b < 3; b++)
			for (let a = 0; a < 4; a++)
				blueNoise(seed, r, ox + a * 40, oz + b * 40, ox + a * 40 + 40, oz + b * 40 + 40, union);
		expect(keys(union)).toEqual(keys(whole));
		expect(new Set(keys(union)).size).toBe(union.length / 3);
		const xs = whole.filter((_, k) => k % 3 === 0);
		const zs = whole.filter((_, k) => k % 3 === 1);
		expect(minDistance(xs, zs)).toBeGreaterThanOrEqual(r);
		// About half as dense as Bridson's maximal sampling (f-mundo-infinito.md §3.5 measured 52%).
		const bridson = poissonDisk(new Rng(seed), ox, oz, ox + 160, oz + 120, r).length / 2;
		expect(xs.length / bridson).toBeGreaterThan(0.45);
		expect(xs.length / bridson).toBeLessThan(0.65);
	});

	it('beats per-chunk Bridson, which breaks the spacing at the seams', () => {
		const points: number[] = [];
		for (let b = 0; b < 3; b++)
			for (let a = 0; a < 3; a++)
				points.push(...poissonDisk(new Rng(a * 7 + b), a * 40, b * 40, a * 40 + 40, b * 40 + 40, 3.8));
		const xs = points.filter((_, k) => k % 2 === 0);
		const zs = points.filter((_, k) => k % 2 === 1);
		expect(minDistance(xs, zs)).toBeLessThan(3.8);
	});

	it.each([
		[5, -3],
		[-1, 7],
		[12, 25],
		[700, -300]
	])(
		'chunk placements around (%i, %i) union to the 3 × 3 area, with the spacing kept across seams',
		(cx, cz) => {
			const area = generateArea(cx * CHUNK_SIZE, cz * CHUNK_SIZE, 3 * CHUNK_SIZE, 3 * CHUNK_SIZE, WORLD_SEED);
			const union = { trees: [] as string[], rocks: [] as string[], decorations: [] as string[] };
			const solid: [number[], number[]] = [[], []];
			const deco: [number[], number[]] = [[], []];
			for (let b = 0; b < 3; b++)
				for (let a = 0; a < 3; a++) {
					const c = generateChunk(cx + a, cz + b, WORLD_SEED);
					for (const family of ['trees', 'rocks', 'decorations'] as const)
						union[family].push(...items(c[family]));
					for (const p of [c.trees, c.rocks]) {
						solid[0].push(...p.x);
						solid[1].push(...p.z);
					}
					deco[0].push(...c.decorations.x);
					deco[1].push(...c.decorations.z);
				}
			for (const family of ['trees', 'rocks', 'decorations'] as const) {
				expect(union[family].sort(), family).toEqual(items(area[family]).sort());
				expect(new Set(union[family]).size).toBe(union[family].length);
			}
			// Float32 storage rounds the positions by at most a few µu.
			expect(minDistance(...solid)).toBeGreaterThan(TREE_SPACING - 1e-3);
			expect(minDistance(...deco)).toBeGreaterThan(DECO_SPACING - 1e-3);
		}
	);

	it('sorts each chunk family by kind', () => {
		const c = generateChunk(6, -2, WORLD_SEED);
		for (const p of [c.trees, c.rocks, c.decorations])
			for (let k = 1; k < p.count; k++) expect(p.kind[k]).toBeGreaterThanOrEqual(p.kind[k - 1]);
		expect(c.trees.count + c.decorations.count).toBeGreaterThan(0);
	});
});
