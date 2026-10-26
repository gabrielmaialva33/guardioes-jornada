import { BoxGeometry, MeshLambertMaterial } from 'three';
import { describe, expect, it } from 'vitest';
import { InstancePool } from '../../render/index.ts';
import { DECORATION_KINDS, ROCK_KINDS, TREE_SPECIES } from '../../survival/types.ts';
import { generateChunk } from '../../world-gen/chunk.ts';
import { fromWorldChunk } from './generated.ts';
import {
	ChunkPlacements,
	PER_CHUNK_MAX,
	type PlacementRoute,
	ringCapacity,
	ringSlots,
	ToroidalBlockGrid,
	WINDOW_MAX
} from './slots.ts';
import type { StreamChunk } from './types.ts';

const chunk = (cx: number, cz: number) => fromWorldChunk(generateChunk(cx, cz)) as StreamChunk;

function setup(side = 7) {
	const grid = new ToroidalBlockGrid(side);
	const pool = (capacity: number) =>
		new InstancePool([{ geometry: new BoxGeometry(), material: new MeshLambertMaterial() }], {
			capacity,
			grid
		});
	// Two pools per tree (near and far, as the runtime's LOD pairs), one for the rest.
	const pools = [pool(4000), pool(4000), pool(8000)];
	const route: PlacementRoute = {
		pools,
		route(family, _kind, _chunk, _i, out) {
			if (family !== 'tree') {
				out[0] = 2;
				return 1;
			}
			out[0] = 0;
			out[1] = 1;
			return 2;
		},
		scale: (pool) => (pool === 1 ? 2 : 1)
	};
	return { grid, pools, placements: new ChunkPlacements(grid, route, 8) };
}

describe('placement slots', () => {
	it('gives every chunk of a ring with its slack its own block slot', () => {
		for (const radius of [2, 3]) {
			const side = 2 * (radius + 1) + 1;
			const grid = new ToroidalBlockGrid(side);
			for (const [fx, fz] of [
				[0, 0],
				[-13, 7],
				[52_000, -40_000]
			]) {
				const slots = new Set<number>();
				for (let dz = -(radius + 1); dz <= radius + 1; dz++)
					for (let dx = -(radius + 1); dx <= radius + 1; dx++) slots.add(grid.slotOf(fx + dx, fz + dz));
				expect(slots.size).toBe(side * side);
			}
			expect(ringSlots(radius)).toBe(side * side);
		}
	});

	it("routes a chunk's placements into the pools under its slot, and removes them all", () => {
		const { grid, pools, placements } = setup();
		const a = chunk(30, -2);
		const b = chunk(31, -2);
		const added = placements.add(a) + placements.add(b);
		expect(added).toBe(
			2 * a.trees.count +
				a.rocks.count +
				a.decorations.count +
				2 * b.trees.count +
				b.rocks.count +
				b.decorations.count
		);
		expect(placements.live).toBe(added);
		const slotA = grid.slotOf(a.cx, a.cz);
		expect(pools[0].blockMembers(slotA)).toBe(a.trees.count);
		expect(pools[2].blockMembers(slotA)).toBe(a.rocks.count + a.decorations.count);
		expect(grid.bounds[slotA].isEmpty()).toBe(false);
		// The block bounds hold every instance origin of the chunk.
		const box = grid.bounds[slotA];
		for (let k = 0; k < a.trees.count; k++) {
			expect(a.trees.x[k]).toBeGreaterThanOrEqual(box.min.x);
			expect(a.trees.x[k]).toBeLessThanOrEqual(box.max.x);
		}
		expect(placements.removeChunk(a)).toBe(2 * a.trees.count + a.rocks.count + a.decorations.count);
		expect(grid.bounds[slotA].isEmpty()).toBe(true);
		expect(pools[0].blockMembers(slotA)).toBe(0);
		expect(placements.removeChunk(a)).toBe(0);
		expect(placements.live).toBe(2 * b.trees.count + b.rocks.count + b.decorations.count);
		// A chunk one ring-width away takes the same slot over cleanly.
		const c = chunk(30 + grid.side, -2);
		expect(grid.slotOf(c.cx, c.cz)).toBe(slotA);
		placements.add(c);
		expect(placements.owner(slotA)).toBe(c.key);
		expect(placements.dropped).toBe(0);
	});

	it('tells the route each id as it goes in, and each chunk before its ids go out', () => {
		const { grid, pools, placements } = setup();
		const events: string[] = [];
		const live = new Map<number, [number, number][]>();
		placements.route.added = (family, kind, chunk, i, pool, id) => {
			// Right after addPlaced: the id is already live in its pool.
			expect(pools[pool].has(id)).toBe(true);
			events.push(`+${chunk.key}:${family}:${kind}:${i}:${pool}:${id}`);
			const ids = live.get(chunk.key) ?? [];
			ids.push([pool, id]);
			live.set(chunk.key, ids);
		};
		placements.route.removed = (chunk) => {
			// Before removal: every id the chunk was given is still live.
			for (const [pool, id] of live.get(chunk.key) ?? []) expect(pools[pool].has(id)).toBe(true);
			events.push(`-${chunk.key}`);
			live.delete(chunk.key);
		};
		const a = chunk(40, 7);
		const b = chunk(41, 7);
		placements.add(a);
		const first = events.filter((e) => e.startsWith(`+${a.key}:`));
		expect(first.length).toBe(2 * a.trees.count + a.rocks.count + a.decorations.count);
		placements.add(b);
		// Release a, then take it straight back: the same ids for the same placements, in order.
		events.length = 0;
		placements.removeChunk(a);
		expect(events).toEqual([`-${a.key}`]);
		for (const [pool, id] of first.map((e) => e.split(':').slice(-2).map(Number)))
			expect(pools[pool].has(id)).toBe(false);
		placements.add(a);
		expect(events.slice(1)).toEqual(first);
		// A chunk taking an occupied slot: the old owner hears removed() first.
		events.length = 0;
		const c = chunk(40 + grid.side, 7);
		placements.add(c);
		expect(events[0]).toBe(`-${a.key}`);
		expect(events.slice(1).every((e) => e.startsWith(`+${c.key}:`))).toBe(true);
		// No hooks: the same adds and removes, silently.
		placements.route.added = undefined;
		placements.route.removed = undefined;
		expect(placements.removeChunk(c)).toBeGreaterThan(0);
	});

	it('sizes pools from the measured tables, never above the strict bound', () => {
		for (const key of Object.keys(WINDOW_MAX.low)) {
			expect(WINDOW_MAX.low[key]).toBeLessThanOrEqual(ringSlots(2) * PER_CHUNK_MAX[key]);
			expect(WINDOW_MAX.high[key]).toBeLessThanOrEqual(ringSlots(3) * PER_CHUNK_MAX[key]);
			expect(WINDOW_MAX.high[key]).toBeGreaterThanOrEqual(WINDOW_MAX.low[key]);
		}
		expect(ringCapacity(['tree:jucara'], 2)).toBe(Math.ceil(WINDOW_MAX.low['tree:jucara'] * 1.25));
		expect(ringCapacity(['tree:jucara', 'tree:xaxim'], 3)).toBe(
			Math.ceil(WINDOW_MAX.high['tree:jucara'] * 1.25) + Math.ceil(WINDOW_MAX.high['tree:xaxim'] * 1.25)
		);
		// Every kind the world can place has a row.
		for (const [family, kinds] of [
			['tree', TREE_SPECIES],
			['rock', ROCK_KINDS],
			['decoration', DECORATION_KINDS]
		] as const)
			for (const k of kinds) {
				expect(PER_CHUNK_MAX[`${family}:${k}`]).toBeGreaterThan(0);
				expect(WINDOW_MAX.low[`${family}:${k}`]).toBeGreaterThan(0);
			}
	});
});
