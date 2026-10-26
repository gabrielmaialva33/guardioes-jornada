import { MeshBasicMaterial } from 'three';
import { describe, expect, it } from 'vitest';
import { PARK_ZONES, ZONE_IDS } from '../../level/zones/spec.ts';
import type { ZoneBuild } from '../../level/zones/zone.ts';
import { pathRibbon } from '../paths.ts';
import { park } from './fixtures.test-helper.ts';
import { squareWorld } from './square.ts';
import { RibbonMeshPool, type RibbonPiece, zoneRibbons } from './trails.ts';
import { CHUNK_SIZE, chunkIdX, chunkIdZ } from './types.ts';

/** Triangles as sorted keys: world centroid and the trail side, to 1e-3. */
function keys(triangles: number[][]): string[] {
	return triangles.map((t) => t.map((v) => v.toFixed(3)).join(',')).sort();
}

describe('streamed trail ribbons', () => {
	it("are paths.ts pathRibbon's triangles, each in exactly one chunk, nothing added or lost", () => {
		for (const id of ZONE_IDS) {
			const build = park.get(id) as ZoneBuild;
			const pieces = zoneRibbons(build);
			const spec = PARK_ZONES[id];
			// The reference: the zone's whole ribbon, its triangles bucketed by the chunk of their centroid.
			const world = build.width === build.depth ? build.world : squareWorld(build);
			const g = pathRibbon(world, build.level.trails);
			const position = g.getAttribute('position');
			const trail = g.getAttribute('trail');
			const reference = new Map<number, number[][]>();
			for (let v = 0; v < position.count; v += 3) {
				const x = (position.getX(v) + position.getX(v + 1) + position.getX(v + 2)) / 3 + build.offsetX;
				const y = (position.getY(v) + position.getY(v + 1) + position.getY(v + 2)) / 3;
				const z = (position.getZ(v) + position.getZ(v + 1) + position.getZ(v + 2)) / 3 + build.offsetZ;
				const cx = Math.floor(x / CHUNK_SIZE);
				const cz = Math.floor(z / CHUNK_SIZE);
				if (cx < spec.cx0 || cx > spec.cx1 || cz < spec.cz0 || cz > spec.cz1) continue;
				const key = (cx + 32768) * 65536 + cz + 32768;
				const list = reference.get(key) ?? [];
				list.push([x, y, z, trail.getX(v), trail.getX(v + 1), trail.getX(v + 2)]);
				reference.set(key, list);
			}
			g.dispose();
			expect([...pieces.keys()].sort(), id).toEqual([...reference.keys()].sort());
			for (const [key, piece] of pieces) {
				const x0 = chunkIdX(key) * CHUNK_SIZE;
				const z0 = chunkIdZ(key) * CHUNK_SIZE;
				const ours: number[][] = [];
				for (let v = 0; v < piece.count; v += 3) {
					const p = piece.position;
					const t = piece.trail;
					for (let k = 0; k < 9; k++) expect(Number.isFinite(p[v * 3 + k])).toBe(true);
					// Chunk-local: inside the chunk's square.
					expect(p[v * 3]).toBeGreaterThanOrEqual(-1e-4);
					expect(p[v * 3]).toBeLessThanOrEqual(CHUNK_SIZE + 1e-4);
					ours.push([
						(p[v * 3] + p[v * 3 + 3] + p[v * 3 + 6]) / 3 + x0,
						(p[v * 3 + 1] + p[v * 3 + 4] + p[v * 3 + 7]) / 3,
						(p[v * 3 + 2] + p[v * 3 + 5] + p[v * 3 + 8]) / 3 + z0,
						t[v * 2],
						t[v * 2 + 2],
						t[v * 2 + 4]
					]);
				}
				expect(keys(ours), `${id} ${key}`).toEqual(keys(reference.get(key) ?? []));
			}
		}
	});

	it('cover every zone with trails, the wide ones (Praia, Manguezal) without a NaN', () => {
		for (const id of ZONE_IDS) {
			const pieces = zoneRibbons(park.get(id) as ZoneBuild);
			expect(pieces.size, id).toBeGreaterThan(0);
			for (const piece of pieces.values()) {
				expect(Number.isFinite(piece.minY) && Number.isFinite(piece.maxY)).toBe(true);
				expect(piece.count % 3).toBe(0);
			}
		}
	});

	it('reuse pooled meshes, growing a buffer only for a bigger piece', () => {
		const pool = new RibbonMeshPool(new MeshBasicMaterial());
		const pieces = [...zoneRibbons(park.get('reserva') as ZoneBuild).values()].sort(
			(a, b) => a.count - b.count
		);
		const small = pieces[0] as RibbonPiece;
		const big = pieces[pieces.length - 1] as RibbonPiece;
		const mesh = pool.acquire(big, 40, 80);
		const geometry = mesh.geometry;
		expect(geometry.drawRange.count).toBe(big.count);
		expect(geometry.getAttribute('trail').itemSize).toBe(2);
		expect(Object.keys(geometry.attributes).sort()).toEqual(['color', 'normal', 'position', 'trail']);
		expect(mesh.position.toArray()).toEqual([40, 0, 80]);
		pool.release(mesh);
		const again = pool.acquire(small, 0, 0);
		expect(again).toBe(mesh);
		expect(again.geometry).toBe(geometry);
		expect(again.geometry.drawRange.count).toBe(small.count);
		expect(pool.size).toBe(1);
		pool.dispose();
	});
});
