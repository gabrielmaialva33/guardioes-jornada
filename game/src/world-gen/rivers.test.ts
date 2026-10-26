import { describe, expect, it } from 'vitest';
import { FLAG, WATER_LEVEL, ZONE } from '../survival/types.ts';
import { generateChunk } from './chunk.ts';
import { WORLD_SEED } from './constants.ts';
import { parkDistance } from './park.ts';
import {
	NODE_KIND,
	RIVER_ACC,
	RIVER_FLAG,
	RIVER_PIECE_SHIFT,
	RIVER_PIECES,
	RiverLattice,
	type RiverSegment
} from './rivers.ts';

/** A big area west of the crest, around the Reserva and into a wide baixada. */
const AREA = { x0: -300, z0: -1600, x1: 1300, z1: 1600 };

function linksIn(lattice: RiverLattice) {
	const segments = lattice.segmentsNear(AREA.x0, AREA.z0, AREA.x1, AREA.z1, 0);
	const links = new Map<number, RiverSegment[]>();
	for (const g of segments) {
		const list = links.get(g.id) ?? [];
		list.push(g);
		links.set(g.id, list);
	}
	return { segments, links };
}

const inside = (x: number, z: number) => x >= AREA.x0 && x <= AREA.x1 && z >= AREA.z0 && z <= AREA.z1;

describe('lattice rivers', () => {
	const lattice = new RiverLattice(WORLD_SEED);
	const { segments, links } = linksIn(lattice);

	it('has wadeable streams and deep rivers', () => {
		expect(links.size).toBeGreaterThan(60);
		const deep = segments.filter((g) => g.flags & RIVER_FLAG.deep).length;
		expect(deep).toBeGreaterThan(20);
		expect(segments.length - deep).toBeGreaterThan(20);
	});

	it('draws each link as connected pieces, every one downhill', () => {
		for (const [id, list] of links) {
			list.sort((a, b) => a.order - b.order);
			for (let k = 0; k < list.length; k++) {
				const g = list[k];
				expect(g.aw, `${id}`).toBeGreaterThan(g.bw);
				const next = list[k + 1];
				if (next && next.order === g.order + 1) {
					expect(next.ax).toBe(g.bx);
					expect(next.az).toBe(g.bz);
					expect(next.aw).toBe(g.bw);
				}
			}
		}
	});

	it('flows from every link to the sea or out of the area, always downhill', () => {
		let toSea = 0;
		let out = 0;
		for (const id of links.keys()) {
			let i = id >> 16;
			let j = (id << 16) >> 16;
			let water = Number.POSITIVE_INFINITY;
			for (let steps = 0; ; steps++) {
				expect(steps).toBeLessThan(64);
				const node = lattice.node(i, j);
				expect(node.water).toBeLessThan(water);
				water = node.water;
				if (node.kind === NODE_KIND.sink) {
					expect(node.water).toBeLessThanOrEqual(WATER_LEVEL);
					toSea++;
					break;
				}
				expect(node.kind).toBe(NODE_KIND.flow);
				if (!inside(node.x, node.z)) {
					out++;
					break;
				}
				// The downstream link starts where this one ends, and is visible too.
				const down = lattice.node(node.di, node.dj);
				const last = (links.get(id) ?? []).find((g) => (g.flags >> RIVER_PIECE_SHIFT) % RIVER_PIECES === 3);
				if (i === id >> 16 && j === (id << 16) >> 16 && last) {
					expect(last.bx).toBe(down.x);
					expect(last.bz).toBe(down.z);
				}
				if (down.kind === NODE_KIND.flow) expect(down.acc).toBeGreaterThan(node.acc);
				i = node.di;
				j = node.dj;
			}
		}
		expect(toSea).toBeGreaterThan(links.size / 2);
		expect(toSea + out).toBe(links.size);
	});

	it('keeps clear of the park, whose river is the zones’ own', () => {
		for (const g of segments)
			for (let t = 0; t <= 1; t += 1 / 64) {
				const x = g.ax + (g.bx - g.ax) * t;
				const z = g.az + (g.bz - g.az) * t;
				expect(parkDistance(x, z), `${x},${z}`).toBeGreaterThan(g.half);
			}
		// No node in the park or its band; the Reserva's cells among them.
		for (let i = -1; i <= 4; i++)
			for (let j = -2; j <= 4; j++)
				if (lattice.excluded(i, j)) expect(lattice.node(i, j).kind).toBe(NODE_KIND.off);
		for (let i = 0; i <= 2; i++) for (let j = 0; j <= 2; j++) expect(lattice.excluded(i, j)).toBe(true);
	});

	it('counts accumulation from the crest down and widens with it', () => {
		const accs = [...links.keys()].map((id) => lattice.node(id >> 16, (id << 16) >> 16).acc);
		expect(Math.max(...accs)).toBeGreaterThanOrEqual(RIVER_ACC * 2);
		for (const g of segments) {
			const acc = lattice.node(g.id >> 16, (g.id << 16) >> 16).acc;
			expect(g.half).toBeGreaterThan(acc >= RIVER_ACC ? 3 : 1.5);
			expect(g.bed).toBeGreaterThan(0.5);
		}
	});

	it('carves water into the chunks under its surface', () => {
		let wet = 0;
		for (let cz = -10; cz < 10; cz++)
			for (const cx of [-2, 5, 8, 11]) {
				const c = generateChunk(cx, cz, WORLD_SEED);
				for (let q = 0; q < c.zones.length; q++)
					if (c.zones[q] === ZONE.river) {
						wet++;
						expect(c.flags[q] & FLAG.river).toBe(FLAG.river);
					}
			}
		expect(wet).toBeGreaterThan(500);
	});
});
