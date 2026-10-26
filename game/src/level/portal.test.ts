import { describe, expect, it } from 'vitest';
import { heightAt } from '../survival/terrain.ts';
import { FLAG, WALK_SLOPE } from '../survival/types.ts';
import { buildStoryWorld } from './build.ts';
import { polylineDistance } from './geometry.ts';
import {
	CHECKPOINT_FACING,
	FACING,
	MIRANTE_TOP,
	PLATEAU,
	PORTAL,
	RELIEF,
	TRAIL_HALF_WIDTH
} from './layout.ts';

const { world, level } = buildStoryWorld();
const n = world.grid;
const h = (x: number, z: number) => world.heights[z * n + x];
const { portal } = level;

describe('the east portal (F1)', () => {
	it('is gated by the mirante, mission 6, and labelled "Rumo à serra"', () => {
		expect(portal.requires).toBe('mirante');
		const mirante = level.missions.find((m) => m.key === 'mirante');
		expect(portal.mission).toBe(mirante?.id);
		expect(portal.mission).toBe(6);
		expect(portal.sign.label).toBe('Rumo à serra');
		expect(portal.sign.kind).toBe('portal-sign');
		// Data only: nothing new among the landmarks the runtime already draws and collides with.
		expect(level.landmarks.some((l) => l.kind === 'portal-sign')).toBe(false);
	});

	it('opens about 8 u of the east edge near z 70, inside the plateau’s z span', () => {
		const { gap } = portal;
		expect(gap.x).toBe(world.size);
		expect(gap.z1 - gap.z0).toBe(8);
		expect((gap.z0 + gap.z1) / 2).toBe(70);
		const zs = PLATEAU.map(([, z]) => z);
		expect(gap.z0).toBeGreaterThan(Math.min(...zs));
		expect(gap.z1).toBeLessThan(Math.max(...zs));
		expect(gap.y).toBe(RELIEF.plateauY);
	});

	it('carries the plateau’s top across the edge strip to x 160, flat and walkable, with no edge lip', () => {
		const { gap } = portal;
		for (let z = gap.z0; z <= gap.z1; z++)
			for (let x = PORTAL.fromX; x <= gap.x; x++) {
				expect(h(x, z), `${x},${z}`).toBe(RELIEF.plateauY);
				expect(world.flags[z * n + x] & FLAG.walkable, `${x},${z}`).toBeTruthy();
			}
		// Every step on the causeway and the plateau top around it, through its eased lip, is walkable
		// (the plateau's top ends at x 157; past it, outside the opening, is its east face).
		for (let z = gap.z0 - PORTAL.lipBlend; z <= gap.z1 + PORTAL.lipBlend; z++) {
			const last = z >= gap.z0 && z <= gap.z1 ? gap.x : 157;
			for (let x = PORTAL.fromX; x <= last; x++) {
				if (x < last)
					expect(Math.abs(h(x + 1, z) - h(x, z)), `${x}→${x + 1}, ${z}`).toBeLessThanOrEqual(WALK_SLOPE);
				const zLast = x > 157 ? gap.z1 : gap.z1 + PORTAL.lipBlend;
				if (z < zLast)
					expect(Math.abs(h(x, z + 1) - h(x, z)), `${x}, ${z}→${z + 1}`).toBeLessThanOrEqual(WALK_SLOPE);
			}
		}
	});

	it('keeps the east cliff and the edge strip everywhere else, the causeway’s flanks one-cell cliffs', () => {
		const { gap } = portal;
		for (let x = 158; x <= gap.x; x++) {
			expect(h(x, gap.z0) - h(x, gap.z0 - 1), `${x} north flank`).toBeGreaterThan(4);
			expect(h(x, gap.z1) - h(x, gap.z1 + 1), `${x} south flank`).toBeGreaterThan(4);
		}
		for (let z = 42; z < 98; z++) {
			if (z >= gap.z0 - 1 && z <= gap.z1 + 1) continue;
			for (const x of [158, 159, 160]) {
				expect(h(x, z), `${x},${z}`).toBeGreaterThan(9);
				expect(h(x, z), `${x},${z}`).toBeLessThan(10.5);
			}
			expect(h(157, z) - h(158, z), `${z} east face`).toBeGreaterThan(4);
		}
	});

	it('leads there by a trail spur from the mirante top checkpoint', () => {
		const spur = level.trails.find((t) => t.id === portal.trail);
		if (!spur) throw new Error('no portal trail');
		const top = level.checkpoints.find((c) => c.id === 'mirante-topo');
		expect(top?.spawn).toMatchObject({ x: MIRANTE_TOP[0], z: MIRANTE_TOP[1] });
		expect(top?.yaw).toBe(FACING[CHECKPOINT_FACING.mirante]);
		expect(spur.points[0]).toEqual([...MIRANTE_TOP]);
		const end = spur.points[spur.points.length - 1];
		expect(end[0]).toBe(portal.gap.x);
		expect(end[1]).toBeGreaterThanOrEqual(portal.gap.z0 + TRAIL_HALF_WIDTH);
		expect(end[1]).toBeLessThanOrEqual(portal.gap.z1 - TRAIL_HALF_WIDTH);
		// Along it, the ground never climbs or drops faster than WALK_SLOPE.
		for (let k = 1; k < spur.points.length; k++) {
			const [ax, az] = spur.points[k - 1];
			const [bx, bz] = spur.points[k];
			const len = Math.hypot(bx - ax, bz - az);
			for (let t = 0; t + 0.5 <= len; t += 0.5) {
				const x0 = ax + ((bx - ax) * t) / len;
				const z0 = az + ((bz - az) * t) / len;
				const x1 = ax + ((bx - ax) * (t + 0.5)) / len;
				const z1 = az + ((bz - az) * (t + 0.5)) / len;
				expect(
					Math.abs(heightAt(world.heights, x1, z1) - heightAt(world.heights, x0, z0))
				).toBeLessThanOrEqual(WALK_SLOPE * 0.5);
			}
		}
	});

	it('stands its posts in the opening, the gate between them, the sign beside the trail facing it', () => {
		const { gap, posts, gate, sign, inside, outside } = portal;
		for (const p of posts) {
			expect(p.z).toBeGreaterThan(gap.z0);
			expect(p.z).toBeLessThan(gap.z1);
			expect(gap.x - p.x).toBeLessThan(1);
			expect(p.y).toBe(RELIEF.plateauY);
			expect(p.height).toBeGreaterThan(2);
		}
		expect(posts[1].z - posts[0].z - posts[0].radius - posts[1].radius).toBeGreaterThan(6);
		expect(gate.from).toEqual({ x: posts[0].x, y: posts[0].y, z: posts[0].z });
		expect(gate.to).toEqual({ x: posts[1].x, y: posts[1].y, z: posts[1].z });
		const spur = level.trails.find((t) => t.id === portal.trail)?.points ?? [];
		const off = polylineDistance(spur, sign.x, sign.z);
		expect(off).toBeGreaterThan(TRAIL_HALF_WIDTH);
		expect(off).toBeLessThan(TRAIL_HALF_WIDTH + 3);
		// Faces west, towards the mirante top the trail comes from: front (yawS, yawC) = (−1, 0).
		expect([sign.yawS, sign.yawC]).toEqual([-1, 0]);
		expect(inside.yaw).toBe(FACING.west);
		expect(inside.x).toBeLessThan(gap.x);
		expect(outside.x).toBeGreaterThan(gap.x);
		// Nothing collides in the opening.
		for (const b of world.blocks)
			for (let k = 0; k < b.cylinders.length; k += 5) {
				const [x, , z] = b.cylinders.subarray(k, k + 3);
				expect(x >= PORTAL.fromX && z >= gap.z0 - 1 && z <= gap.z1 + 1, `${x},${z}`).toBe(false);
			}
	});
});
