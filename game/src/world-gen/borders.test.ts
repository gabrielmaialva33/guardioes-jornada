import { describe, expect, it } from 'vitest';
import { Rng } from '../survival/random.ts';
import type { Placements } from '../survival/types.ts';
import { BIOME_COUNT } from './biomes.ts';
import { generateArea, generateChunk, heightWithApron, RIVER_STRIDE, type WorldChunk } from './chunk.ts';
import { CHUNK_SIDE, CHUNK_SIZE, isHandMade, WORLD_SEED } from './constants.ts';

const S = CHUNK_SIDE;
const SEEDS = [WORLD_SEED, 1, 0xdeadbeef];

/** Random procedural chunk pairs (cx, cz) and their east or south neighbour, near and far. */
function pairs(seed: number, count: number): [number, number, 'east' | 'south'][] {
	const rng = new Rng(seed);
	const out: [number, number, 'east' | 'south'][] = [];
	while (out.length < count) {
		const far = rng.next() < 0.3;
		const cx = far ? rng.int(8000) - 4000 : rng.int(40) - 12;
		const cz = far ? rng.int(8000) - 4000 : rng.int(40) - 20;
		const dir = rng.next() < 0.5 ? 'east' : 'south';
		const nx = dir === 'east' ? cx + 1 : cx;
		const nz = dir === 'south' ? cz + 1 : cz;
		if (!isHandMade(cx, cz) && !isHandMade(nx, nz)) out.push([cx, cz, dir]);
	}
	return out;
}

const bits = (v: number) => {
	const f = new Float32Array([v]);
	return new Uint32Array(f.buffer)[0];
};

/** Vertex k (0..40) of the shared edge in a and in b. */
function edge(dir: 'east' | 'south', k: number): [number, number] {
	return dir === 'east' ? [k * S + CHUNK_SIZE, k * S] : [CHUNK_SIZE * S + k, k];
}

function placementsNear(p: Placements<string>, test: (x: number, z: number) => boolean): string[] {
	const out: string[] = [];
	for (let k = 0; k < p.count; k++)
		if (test(p.x[k], p.z[k]))
			out.push(
				[p.kind[k], p.x[k], p.y[k], p.z[k], p.scale[k], p.yawC[k], p.yawS[k]].map((v) => bits(v)).join(':')
			);
	return out.sort();
}

function riverRows(c: WorldChunk): string[] {
	const rows: string[] = [];
	for (let k = 0; k < c.riverIds.length; k++)
		rows.push(
			`${c.riverIds[k]}:${c.riverFlags[k]}:${[...c.rivers.subarray(k * RIVER_STRIDE, (k + 1) * RIVER_STRIDE)].map(bits).join(',')}`
		);
	return rows;
}

describe('chunk borders', () => {
	it.each(SEEDS)('are bit-identical between neighbours (seed %i)', (seed) => {
		for (const [cx, cz, dir] of pairs(seed ^ 0x51ed, 24)) {
			const a = generateChunk(cx, cz, seed);
			const b = generateChunk(dir === 'east' ? cx + 1 : cx, dir === 'south' ? cz + 1 : cz, seed);
			const at = `${cx},${cz} ${dir}`;
			for (let k = 0; k < S; k++) {
				const [qa, qb] = edge(dir, k);
				expect(bits(a.heights[qa]), at).toBe(bits(b.heights[qb]));
				expect(a.zones[qa], at).toBe(b.zones[qb]);
				expect(a.flags[qa], at).toBe(b.flags[qb]);
				expect(a.biome[qa], at).toBe(b.biome[qb]);
				for (let w = 0; w < BIOME_COUNT; w++)
					expect(a.biomeWeights[qa * BIOME_COUNT + w], at).toBe(b.biomeWeights[qb * BIOME_COUNT + w]);
			}
			// Each apron holds the other chunk's next row or column in.
			for (let k = -1; k <= S; k++) {
				const [ai, aj, bi, bj] = dir === 'east' ? [S, k, 1, k] : [k, S, k, 1];
				const [bi2, bj2, ai2, aj2] = dir === 'east' ? [-1, k, S - 2, k] : [k, -1, k, S - 2];
				if (k >= 0 && k < S) {
					expect(bits(heightWithApron(a, ai, aj)), at).toBe(bits(heightWithApron(b, bi, bj)));
					expect(bits(heightWithApron(b, bi2, bj2)), at).toBe(bits(heightWithApron(a, ai2, aj2)));
				}
			}
			// The collision grid's shared edge too.
			const C = CHUNK_SIZE / 2 + 1;
			for (let k = 0; k < C; k++) {
				const qa = dir === 'east' ? k * C + C - 1 : (C - 1) * C + k;
				const qb = dir === 'east' ? k * C : k;
				expect(bits(a.collision.heights[qa]), at).toBe(bits(b.collision.heights[qb]));
			}
			// River segments whose water crosses the shared edge are listed by both, with the same bits.
			const line = dir === 'east' ? (cx + 1) * CHUNK_SIZE : (cz + 1) * CHUNK_SIZE;
			const crossing = (rows: string[], c: WorldChunk) =>
				rows.filter((_, k) => {
					const g = c.rivers.subarray(k * RIVER_STRIDE, (k + 1) * RIVER_STRIDE);
					const [lo, hi] =
						dir === 'east'
							? [Math.min(g[0], g[3]), Math.max(g[0], g[3])]
							: [Math.min(g[1], g[4]), Math.max(g[1], g[4])];
					return lo - g[6] <= line && hi + g[6] >= line;
				});
			expect(crossing(riverRows(a), a), at).toEqual(crossing(riverRows(b), b));
		}
	});

	it('place the same things near the seam as a two-chunk area does', () => {
		for (const [cx, cz, dir] of pairs(0x1234, 16)) {
			const a = generateChunk(cx, cz, WORLD_SEED);
			const nx = dir === 'east' ? cx + 1 : cx;
			const nz = dir === 'south' ? cz + 1 : cz;
			const b = generateChunk(nx, nz, WORLD_SEED);
			const area = generateArea(
				cx * CHUNK_SIZE,
				cz * CHUNK_SIZE,
				dir === 'east' ? 2 * CHUNK_SIZE : CHUNK_SIZE,
				dir === 'south' ? 2 * CHUNK_SIZE : CHUNK_SIZE,
				WORLD_SEED
			);
			const line = dir === 'east' ? nx * CHUNK_SIZE : nz * CHUNK_SIZE;
			const near = (x: number, z: number) => Math.abs((dir === 'east' ? x : z) - line) < 6;
			for (const family of ['trees', 'rocks', 'decorations'] as const) {
				const union = [...placementsNear(a[family], near), ...placementsNear(b[family], near)].sort();
				expect(union, `${cx},${cz} ${dir} ${family}`).toEqual(placementsNear(area[family], near));
				expect(new Set(union).size).toBe(union.length);
			}
		}
	});

	it('give every chunk an apron equal to the ring of a bigger area, corners included', () => {
		for (const [cx, cz] of [
			[4, 1],
			[4, -1],
			[3, 4],
			[5, 2],
			[-1, 0],
			[9, -6],
			[-700, 1500]
		]) {
			const c = generateChunk(cx, cz, WORLD_SEED);
			expect(c.apron).toHaveLength(168);
			const area = generateArea(cx * CHUNK_SIZE - 1, cz * CHUNK_SIZE - 1, S + 1, S + 1, WORLD_SEED);
			for (let j = -1; j <= S; j++)
				for (let i = -1; i <= S; i++)
					expect(bits(heightWithApron(c, i, j)), `${cx},${cz} (${i},${j})`).toBe(
						bits(area.heights[(j + 1) * area.sideX + i + 1])
					);
		}
	});

	it('stay bit-identical through the east stitch band', () => {
		const band: [number, number, 'east' | 'south'][] = [
			[3, -1, 'east'],
			[3, 4, 'east'],
			[4, -2, 'south'],
			[4, 4, 'south']
		];
		for (let cz = -1; cz <= 3; cz++) band.push([4, cz, 'east'], [4, cz, 'south']);
		for (const [cx, cz, dir] of band) {
			const a = generateChunk(cx, cz, WORLD_SEED);
			const b = generateChunk(dir === 'east' ? cx + 1 : cx, dir === 'south' ? cz + 1 : cz, WORLD_SEED);
			for (let k = 0; k < S; k++) {
				const [qa, qb] = edge(dir, k);
				expect(bits(a.heights[qa]), `${cx},${cz} ${dir}`).toBe(bits(b.heights[qb]));
			}
		}
	});
});
