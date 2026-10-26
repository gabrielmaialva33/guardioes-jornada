import { InstancedMesh, Matrix4, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import type { ZoneBuild } from '../../level/zones/zone.ts';
import { lookup, park } from './fixtures.test-helper.ts';
import { createWaterfallSpray } from './spray.ts';
import { chunkOf } from './types.ts';
import { SPRAY_OUT, WATERFALL_MODEL_DROP, waterfallsOf } from './waterfalls.ts';

describe('streamed waterfalls', () => {
	it("take the lip and the drop from each zone's waterfall landmark, the way from its river", () => {
		const seen: string[] = [];
		for (const [id, build] of park as ReadonlyMap<string, ZoneBuild>)
			for (const fall of waterfallsOf(build)) {
				const landmark = build.level.landmarks.find((l) => l.id === fall.id);
				if (!landmark) throw new Error(fall.id);
				seen.push(`${id}:${fall.id}`);
				expect([fall.x, fall.y, fall.z]).toEqual([
					landmark.x + build.offsetX,
					landmark.y,
					landmark.z + build.offsetZ
				]);
				expect(fall.height).toBe(landmark.height);
				expect(fall.foot).toBe(landmark.y - landmark.height);
				expect(Math.hypot(fall.flowX, fall.flowZ)).toBeCloseTo(1, 9);
				expect(Math.sin(fall.yaw)).toBeCloseTo(fall.flowX, 9);
				expect(Math.cos(fall.yaw)).toBeCloseTo(fall.flowZ, 9);
				expect(Math.hypot(fall.sprayX - fall.x, fall.sprayZ - fall.z)).toBeCloseTo(SPRAY_OUT, 9);
				// Downstream: the river's water is lower at the spray than at the lip.
				const r = build.world.river.points;
				const near = (x: number, z: number) =>
					r.reduce(
						(best, p, k) =>
							Math.hypot(p.x - x, p.z - z) < Math.hypot(r[best].x - x, r[best].z - z) ? k : best,
						0
					);
				expect(near(fall.sprayX - build.offsetX, fall.sprayZ - build.offsetZ)).toBeGreaterThanOrEqual(
					near(landmark.x, landmark.z)
				);
			}
		expect(seen.sort()).toEqual(['reserva:cachoeira', 'vale:cachoeira-grande']);
	});

	it("ride with their chunk: the model as scenery sized as asset-plan.ts sizes the Reserva's", () => {
		for (const build of [park.get('reserva'), park.get('vale')] as ZoneBuild[]) {
			const [fall] = waterfallsOf(build);
			const chunk = lookup(chunkOf(fall.x), chunkOf(fall.z));
			expect(chunk?.waterfalls?.map((f) => f.id)).toEqual([fall.id]);
			const scenery = chunk?.scenery;
			if (!scenery) throw new Error('the scenery placements');
			expect(scenery.count).toBe(1);
			expect([scenery.x[0], scenery.y[0], scenery.z[0]]).toEqual([
				Math.fround(fall.x),
				Math.fround(fall.foot),
				Math.fround(fall.z)
			]);
			expect(scenery.scale[0]).toBeCloseTo(fall.height / WATERFALL_MODEL_DROP, 6);
			expect(lookup(chunkOf(fall.x) + 1, chunkOf(fall.z))?.waterfalls ?? []).toEqual([]);
		}
		const [reserva] = waterfallsOf(park.get('reserva') as ZoneBuild);
		expect(reserva.height / WATERFALL_MODEL_DROP).toBeCloseTo(1.35, 12);
	});

	it("put waterfall-foam.ts's spray at the fall's own spray point", () => {
		const [fall] = waterfallsOf(park.get('vale') as ZoneBuild);
		const spray = createWaterfallSpray(fall);
		const mesh = spray.object.children[0] as InstancedMesh;
		expect(mesh).toBeInstanceOf(InstancedMesh);
		expect(mesh.count).toBe(24);
		const m = new Matrix4();
		mesh.getMatrixAt(0, m);
		const first = new Vector3().setFromMatrixPosition(m);
		expect(first.x).toBeCloseTo(fall.sprayX, 4);
		expect(first.y).toBeCloseTo(fall.foot + 0.12, 4);
		expect(first.z).toBeCloseTo(fall.sprayZ, 4);
		spray.dispose();
		expect(spray.object.children.length).toBe(0);
	});
});
