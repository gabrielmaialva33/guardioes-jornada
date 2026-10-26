/**
 * Tripwires between the streaming copies and the whole-map code they mirror.
 * When one of these fails, P32 (or anyone) changed the original: carry the
 * change over to the streaming side in the same landing.
 *
 * - terrain.ts terrainTint ↔ tint.ts windowTint (here): the streamed terrain's
 *   vertex colour. Mirror the change in windowTint, or make terrainTint read a
 *   window and hand it to streaming/worker.ts (createStreamHost's `tint`).
 * - shore.ts waterField / waterSurface ↔ water.ts (water.test.ts).
 * - paths.ts pathRibbon ↔ trails.ts (trails.test.ts: it calls pathRibbon itself).
 * - terrain.ts terrainChunk's vertex format ↔ terrain-mesh.ts (terrain-mesh.test.ts).
 */
import { Color } from 'three';
import { describe, expect, it } from 'vitest';
import type { ZoneBuild } from '../../level/zones/zone.ts';
import { terrainTint } from '../terrain.ts';
import { lookup, park } from './fixtures.test-helper.ts';
import { windowTint } from './tint.ts';
import { CHUNK_SIDE, CHUNK_SIZE, type StreamChunk } from './types.ts';
import { createWindow, fillWindow } from './window.ts';

describe('streaming copies stay in step with the whole-map code', () => {
	it("windowTint is terrain.ts terrainTint, bit for bit, on the Reserva's interior", () => {
		const reserva = park.get('reserva') as ZoneBuild;
		const ours = new Color();
		const theirs = new Color();
		let checked = 0;
		for (const [cx, cz] of [
			[1, 1],
			[1, 2],
			[2, 1],
			[2, 2]
		]) {
			const window = fillWindow(createWindow(), lookup(cx, cz) as StreamChunk, lookup);
			for (let j = 0; j < CHUNK_SIDE; j++)
				for (let i = 0; i < CHUNK_SIDE; i++) {
					const x = cx * CHUNK_SIZE + i;
					const z = cz * CHUNK_SIZE + j;
					terrainTint(reserva.world, x, z, [], theirs);
					windowTint(window, x, z, ours);
					// As the vertex colour attribute stores them.
					expect(
						[ours.r, ours.g, ours.b].map(Math.fround),
						`(${x}, ${z}): terrainTint changed; mirror it in streaming/tint.ts`
					).toEqual([theirs.r, theirs.g, theirs.b].map(Math.fround));
					checked++;
				}
		}
		expect(checked).toBe(4 * CHUNK_SIDE * CHUNK_SIDE);
	});
});
