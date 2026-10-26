/**
 * Test fixtures for the streaming tests: the park cut into chunks once,
 * generated chunks on demand, and a chunk's build as the Worker makes it
 * (window, bodies, water field, terrain and water attributes). Only imported
 * by *.test.ts files.
 */
import { buildPark } from '../../level/zones/park.ts';
import { ZONE_IDS } from '../../level/zones/spec.ts';
import type { ZoneBuild } from '../../level/zones/zone.ts';
import { generateChunk } from '../../world-gen/chunk.ts';
import { fromWorldChunk } from './generated.ts';
import { buildTerrainRows, createTerrainAttributes, type TerrainAttributes } from './terrain-mesh.ts';
import { CHUNK_SIDE, type StreamChunk } from './types.ts';
import {
	buildWaterMesh,
	createWaterAttributes,
	createWaterField,
	FIELD_SIDE,
	fillWaterField,
	gatherBodies,
	type WaterAttributes,
	type WaterBodies,
	type WaterField
} from './water.ts';
import { createWindow, type FieldWindow, fillWindow } from './window.ts';
import { cutZone } from './zone-cut.ts';

export const park = buildPark();
const zoneChunks = new Map<string, StreamChunk>();
for (const id of ZONE_IDS)
	for (const c of cutZone(park.get(id) as ZoneBuild, park).chunks) zoneChunks.set(`${c.cx},${c.cz}`, c);
const generated = new Map<string, StreamChunk | null>();

/** Any chunk: the park's cut, else the generator's. */
export function lookup(cx: number, cz: number): StreamChunk | null {
	const key = `${cx},${cz}`;
	const zone = zoneChunks.get(key);
	if (zone) return zone;
	if (!generated.has(key)) generated.set(key, fromWorldChunk(generateChunk(cx, cz)));
	return generated.get(key) ?? null;
}

export interface ChunkBuild {
	chunk: StreamChunk;
	window: FieldWindow;
	bodies: WaterBodies;
	field: WaterField;
	terrain: TerrainAttributes;
	water: WaterAttributes;
}

/** (cx, cz) built as the Worker builds it, the ring's inputs included. */
export function buildChunk(cx: number, cz: number, local = false): ChunkBuild {
	const chunk = lookup(cx, cz) as StreamChunk;
	const window = fillWindow(createWindow(), chunk, lookup);
	const bodies = gatherBodies(chunk, lookup, window);
	const field = fillWaterField(bodies, window, createWaterField());
	const terrain = createTerrainAttributes();
	const input = {
		window,
		x0: chunk.x0,
		z0: chunk.z0,
		waterLevel: chunk.waterLevel,
		rivers: bodies.rivers,
		pool: bodies.pools[0] ?? null,
		bodies,
		local
	};
	buildTerrainRows(input, terrain, 0, CHUNK_SIDE, undefined, field);
	const water = buildWaterMesh(field, chunk.x0, chunk.z0, local, createWaterAttributes());
	return { chunk, window, bodies, field, terrain, water };
}

/** The field's (height, distance, depth) at chunk vertex (i, j), i and j in 0..40. */
export function fieldAt(f: WaterField, i: number, j: number): [number, number, number] {
	const k = (j + 1) * FIELD_SIDE + i + 1;
	return [f.height[k], f.distance[k], f.depth[k]];
}

/** Which of a chunk's 40 × 40 cells its water mesh covers (merged quads expanded). */
export function waterCoverage(w: WaterAttributes): Uint8Array {
	const out = new Uint8Array(40 * 40);
	for (let k = 0; k < w.count; k += 6) {
		const a = w.index[k];
		const d = w.index[k + 5];
		const i0 = a % CHUNK_SIDE;
		const j0 = Math.floor(a / CHUNK_SIDE);
		const i1 = d % CHUNK_SIDE;
		const j1 = Math.floor(d / CHUNK_SIDE);
		for (let j = j0; j < j1; j++) for (let i = i0; i < i1; i++) out[j * 40 + i]++;
	}
	return out;
}

/** The seam pairs of P34 (seven kinds), plus water across them: river mouths, coast, tide-pool shelf. */
export const SEAMS: readonly (readonly [number, number, number, number, string])[] = [
	[10, 3, 11, 3, 'generated east-west'],
	[10, 3, 10, 4, 'generated north-south'],
	[3, 1, 4, 1, 'Reserva | Vale'],
	[-1, 1, 0, 1, 'generated | Reserva'],
	[1, 3, 1, 4, 'Reserva | Manguezal'],
	[5, -1, 5, 0, 'Copa | Vale'],
	[8, 2, 7, 2, 'generated | Vale'],
	[3, 0, 4, 0, 'Reserva | Vale, the river'],
	[0, 3, 0, 4, 'Reserva | Manguezal, the river mouth'],
	[-1, 0, -1, -1, 'generated | Praia'],
	[-2, -2, -1, -2, 'generated sea | Praia sea'],
	[-1, 5, -2, 5, 'Manguezal | generated, flooded'],
	[-1, -2, -1, -3, 'Praia, the sea and the tide-pool shelf'],
	[8, 6, 9, 6, 'generated, a river']
];
