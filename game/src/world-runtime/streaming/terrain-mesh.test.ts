import { MeshBasicMaterial, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { buildPark } from '../../level/zones/park.ts';
import { ZONE_IDS } from '../../level/zones/spec.ts';
import type { ZoneBuild } from '../../level/zones/zone.ts';
import { generateChunk } from '../../world-gen/chunk.ts';
import { terrainChunk } from '../terrain.ts';
import { fromWorldChunk } from './generated.ts';
import {
	buildTerrainRows,
	createTerrainAttributes,
	type PoolShape,
	TERRAIN_INDEX,
	type TerrainAttributes,
	TerrainMeshPool
} from './terrain-mesh.ts';
import { CHUNK_SIDE, CHUNK_VERTICES, type StreamChunk } from './types.ts';
import { createWindow, fillWindow } from './window.ts';
import { cutZone } from './zone-cut.ts';

const park = buildPark();
const zoneChunks = new Map<string, StreamChunk>();
for (const id of ZONE_IDS)
	for (const c of cutZone(park.get(id) as ZoneBuild, park).chunks) zoneChunks.set(`${c.cx},${c.cz}`, c);
const generated = new Map<string, StreamChunk | null>();
const lookup = (cx: number, cz: number): StreamChunk | null => {
	const zone = zoneChunks.get(`${cx},${cz}`);
	if (zone) return zone;
	const key = `${cx},${cz}`;
	if (!generated.has(key)) generated.set(key, fromWorldChunk(generateChunk(cx, cz)));
	return generated.get(key) ?? null;
};

/** The ring's terrain input for (cx, cz): its window and the rivers of its 3 × 3. */
function build(cx: number, cz: number, local = false): TerrainAttributes {
	const chunk = lookup(cx, cz) as StreamChunk;
	const rivers: number[] = [];
	let pool: PoolShape | null = null;
	for (let dz = -1; dz <= 1; dz++)
		for (let dx = -1; dx <= 1; dx++) {
			const c = lookup(cx + dx, cz + dz);
			if (!c) continue;
			rivers.push(...c.rivers);
			const p = c.story?.level.pool;
			if (p && p.halfLength > 0 && !pool && c.story)
				pool = { ...p, x: p.x + c.story.offsetX, z: p.z + c.story.offsetZ };
		}
	const out = createTerrainAttributes();
	const input = {
		window: fillWindow(createWindow(), chunk, lookup),
		x0: chunk.x0,
		z0: chunk.z0,
		waterLevel: chunk.waterLevel,
		rivers: Float32Array.from(rivers),
		pool,
		local
	};
	// Row by row, as the main thread would: the result must not depend on the slicing.
	for (let j = 0; j < CHUNK_SIDE; j += 7) buildTerrainRows(input, out, j, Math.min(CHUNK_SIDE, j + 7));
	return out;
}

const vertex = (a: TerrainAttributes, i: number, j: number) => {
	const v = j * CHUNK_SIDE + i;
	return [
		...a.position.subarray(v * 3, v * 3 + 3),
		...a.normal.subarray(v * 3, v * 3 + 3),
		...a.color.subarray(v * 3, v * 3 + 3),
		...a.shore.subarray(v * 2, v * 2 + 2)
	];
};

describe('streamed terrain mesh', () => {
	it("keeps terrain.ts terrainChunk's vertex format, positions, normals and index", () => {
		const reserva = park.get('reserva') as ZoneBuild;
		const reference = terrainChunk(reserva.world, { x0: 40, z0: 40 });
		const ours = build(1, 1);
		const names = Object.keys(reference.attributes).sort();
		expect(names).toEqual(['color', 'normal', 'position', 'shore']);
		for (const name of names) {
			const attribute = reference.getAttribute(name);
			expect(attribute.count).toBe(CHUNK_VERTICES);
			expect(ours[name as keyof TerrainAttributes].length).toBe(CHUNK_VERTICES * attribute.itemSize);
		}
		expect(Array.from(reference.getIndex()?.array ?? [])).toEqual(Array.from(TERRAIN_INDEX));
		expect(ours.position).toEqual(reference.getAttribute('position').array);
		expect(ours.normal).toEqual(reference.getAttribute('normal').array);
	});

	it('is seamless across chunk edges: generated, zone to zone, and park to generated', () => {
		const pairs: [number, number, number, number][] = [
			[10, 3, 11, 3],
			[10, 3, 10, 4],
			[3, 1, 4, 1],
			[-1, 1, 0, 1],
			[1, 3, 1, 4],
			[5, -1, 5, 0],
			[8, 2, 7, 2]
		];
		for (const [ax, az, bx, bz] of pairs) {
			const a = build(ax, az);
			const b = build(bx, bz);
			const east = bx > ax ? 1 : bx < ax ? -1 : 0;
			const south = bz > az ? 1 : bz < az ? -1 : 0;
			for (let k = 0; k < CHUNK_SIDE; k++) {
				const [ai, aj] = east === 1 ? [40, k] : east === -1 ? [0, k] : south === 1 ? [k, 40] : [k, 0];
				const [bi, bj] = east === 1 ? [0, k] : east === -1 ? [40, k] : south === 1 ? [k, 0] : [k, 40];
				expect(vertex(b, bi, bj)).toEqual(vertex(a, ai, aj));
			}
		}
	});

	it('writes finite colours and shores, the same every time and in local or world space', () => {
		for (const [cx, cz] of [
			[2, 2],
			[30, -7],
			[-1, -2]
		]) {
			const a = build(cx, cz);
			const b = build(cx, cz, true);
			expect(b.normal).toEqual(a.normal);
			expect(b.color).toEqual(a.color);
			expect(b.shore).toEqual(a.shore);
			for (const v of a.color) expect(v >= 0 && v < 1.5).toBe(true);
			for (const v of a.shore) expect(Number.isFinite(v)).toBe(true);
			expect(b.position[0]).toBe(0);
			expect(b.position[3 * (CHUNK_VERTICES - 1)]).toBe(40);
		}
	});

	it('reuses pooled meshes and bounds them by their height range', () => {
		const pool = new TerrainMeshPool(new MeshBasicMaterial());
		const chunk = lookup(2, 2) as StreamChunk;
		const attributes = build(2, 2, true);
		const a = pool.acquire(attributes, chunk.x0, chunk.z0, chunk.minY, chunk.maxY);
		expect(a.position.toArray()).toEqual([chunk.x0, 0, chunk.z0]);
		const sphere = a.geometry.boundingSphere;
		const p = new Vector3();
		const positions = a.geometry.getAttribute('position');
		for (let v = 0; v < CHUNK_VERTICES; v += 17)
			expect(sphere?.containsPoint(p.fromBufferAttribute(positions, v))).toBe(true);
		pool.release(a);
		const b = pool.acquire(build(3, 3, true), 120, 120, 0, 10);
		expect(b).toBe(a);
		expect(pool.size).toBe(1);
		pool.dispose();
	});
});
