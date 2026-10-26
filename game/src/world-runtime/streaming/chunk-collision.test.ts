import { Box3, Ray, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { buildPark } from '../../level/zones/park.ts';
import type { ZoneBuild } from '../../level/zones/zone.ts';
import { generateChunk } from '../../world-gen/chunk.ts';
import { buildMapCollision } from '../collision.ts';
import {
	ChunkCollider,
	type CollisionData,
	type CollisionInput,
	CompoundCollision,
	collisionData,
	collisionTransferables
} from './chunk-collision.ts';
import { fromWorldChunk } from './generated.ts';
import type { StreamChunk } from './types.ts';
import { cutZone } from './zone-cut.ts';

const park = buildPark();
const reserva = park.get('reserva') as ZoneBuild;
const cut = cutZone(reserva, park);
const input = (c: StreamChunk): CollisionInput => ({
	x0: c.x0,
	z0: c.z0,
	heights: c.heights,
	cylinders: c.collision.cylinders,
	boxes: c.collision.boxes,
	decks: c.collision.decks
});
const down = (x: number, z: number) => new Ray(new Vector3(x, 200, z), new Vector3(0, -1, 0));

describe('chunk collision', () => {
	it('answers raycasts as buildMapCollision does, chunk by chunk', () => {
		const whole = buildMapCollision(reserva.world);
		const ring = new CompoundCollision();
		for (const c of cut.chunks) ring.add(ChunkCollider.build(input(c)));
		expect(ring.size).toBe(16);
		let hits = 0;
		// Interior points only: the whole map adds edge rails, the ring leaves edges to its neighbours.
		for (let z = 2.3; z < 158; z += 3.7)
			for (let x = 2.1; x < 158; x += 3.3) {
				const a = whole.raycast(down(x, z), 400);
				const b = ring.raycast(down(x, z), 400);
				expect(b).not.toBeNull();
				expect(b as number).toBeCloseTo(a as number, 4);
				hits++;
			}
		expect(hits).toBeGreaterThan(1500);
		// Sideways through trunks and logs: the same first hit.
		for (let z = 5; z < 155; z += 10) {
			const ray = new Ray(new Vector3(1, 0, z), new Vector3(1, 0, 0));
			for (const y of [0.5, 1.5, 3]) {
				ray.origin.set(1, y + (reserva.world.heights[Math.round(z) * 161 + 1] ?? 0), z);
				const a = whole.raycast(ray, 150);
				const b = ring.raycast(ray, 150);
				if (a === null) expect(b).toBeNull();
				else expect(b as number).toBeCloseTo(a, 4);
			}
		}
		whole.dispose();
	});

	it('visits the triangles of every chunk a shapecast touches', () => {
		const ring = new CompoundCollision();
		const parts = cut.chunks.filter((c) => c.cx <= 1 && c.cz <= 1).map((c) => ChunkCollider.build(input(c)));
		for (const p of parts) ring.add(p);
		const corner = new Box3(new Vector3(39, -50, 39), new Vector3(41, 100, 41));
		let visited = 0;
		ring.shapecast(corner, () => visited++);
		let each = 0;
		for (const p of parts) p.shapecast(corner, () => each++);
		expect(visited).toBe(each);
		expect(visited).toBeGreaterThanOrEqual(4 * 2);
		const far = new Box3(new Vector3(500, 0, 500), new Vector3(501, 1, 501));
		visited = 0;
		ring.shapecast(far, () => visited++);
		expect(visited).toBe(0);
		expect(ring.remove(parts[0])).toBe(true);
		expect(ring.remove(parts[0])).toBe(false);
		expect(ring.size).toBe(3);
	});

	it('travels to the main thread as transferred buffers and rebuilds the same BVH', () => {
		const chunk = fromWorldChunk(generateChunk(12, -4)) as StreamChunk;
		const data = collisionData(input(chunk));
		const local = new ChunkCollider(collisionData(input(chunk)));
		const copy = structuredClone(data, { transfer: collisionTransferables(data) }) as CollisionData;
		expect(data.position.byteLength).toBe(0);
		const moved = new ChunkCollider(copy);
		expect(moved.triangles).toBe(local.triangles);
		expect(moved.box.equals(local.box)).toBe(true);
		for (let k = 0; k < 40; k++) {
			const x = chunk.x0 + 0.5 + k;
			const z = chunk.z0 + 0.25 + k * 0.9;
			expect(moved.raycast(down(x, z), 400)).toBe(local.raycast(down(x, z), 400));
		}
		moved.dispose();
		local.dispose();
	});
});
