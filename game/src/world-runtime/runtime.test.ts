import { Ray, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { generateWorld } from '../survival/generate.ts';
import { FLAG } from '../survival/types.ts';
import { buildMapCollision, deckGeometry } from './collision.ts';
import { MapCheckpoints, riverSurfaceAt } from './navigation.ts';
import { terrainChunk, terrainColor } from './terrain.ts';

const world = generateWorld(20261025);
describe('world terrain and physics adapter', () => {
	it('renders the complete 1 u grid in sixteen seamless upward-facing 40 u chunks', () => {
		let triangles = 0;
		for (const b of world.blocks) {
			const g = terrainChunk(world, b);
			const p = g.getAttribute('position'),
				n = g.getAttribute('normal');
			triangles += p.count / 3;
			expect(p.count).toBe(40 * 40 * 6);
			for (let i = 0; i < p.count; i++) {
				expect(p.getX(i)).toBeGreaterThanOrEqual(b.x0);
				expect(p.getX(i)).toBeLessThanOrEqual(b.x0 + 40);
				expect(p.getY(i)).toBe(world.heights[Math.round(p.getZ(i)) * world.grid + Math.round(p.getX(i))]);
				expect(n.getY(i)).toBeGreaterThan(0);
			}
			g.dispose();
		}
		expect(triangles).toBe(51200);
	});
	it('paths, standing forest and cleared pasture have distinct ramp colours', () => {
		const map = { ...world, flags: world.flags.slice() };
		const i = 30 * world.grid + 30;
		map.flags[i] = FLAG.forest;
		const forest = terrainColor(map, 30, 30);
		map.flags[i] = FLAG.cleared | FLAG.corridor;
		const pasture = terrainColor(map, 30, 30);
		expect(forest).not.toBe(pasture);
		expect(
			terrainColor(map, 30, 30, [
				{
					points: [
						[20, 30],
						[40, 30]
					],
					halfWidth: 2
				}
			])
		).not.toBe(pasture);
	});
	it('builds the existing BVH with elevated bridge tops and block colliders', () => {
		const collision = buildMapCollision(world);
		const c = world.crossings.find((c) => c.kind === 'bridge');
		if (!c) throw new Error('fixture-bridge');
		const x = (c.from.x + c.to.x) / 2,
			z = (c.from.z + c.to.z) / 2;
		const top = (c.from.y + c.to.y) / 2;
		expect(collision.raycast(new Ray(new Vector3(x, top + 5, z), new Vector3(0, -1, 0)), 6)).toBeCloseTo(
			5,
			3
		);
		expect(collision.triangles).toBeGreaterThan(12800);
		collision.dispose();
	});
	it('sloped decks have exactly their endpoint top heights', () => {
		const g = deckGeometry([10, 3, 20, 20, 5, 30, 1.5, 0.3]);
		const p = g.getAttribute('position');
		expect(Math.max(...Array.from({ length: p.count }, (_, i) => p.getY(i)))).toBeCloseTo(5);
		g.dispose();
	});
});
describe('water and safe checkpoints', () => {
	it('interpolates river water and excludes dry banks', () => {
		const a = world.river.points[2],
			b = world.river.points[3];
		expect(riverSurfaceAt(world, (a.x + b.x) / 2, (a.z + b.z) / 2)).toBeCloseTo((a.water + b.water) / 2);
		expect(riverSurfaceAt(world, -100, -100)).toBeNull();
	});
	it('deep feet trigger a delayed splash respawn, while bridge feet stay safe', () => {
		const start = {
			id: 'start',
			spawn: world.base.spawn,
			yaw: 0,
			min: { x: -1, y: -1, z: -1 },
			max: { x: 1, y: 1, z: 1 }
		};
		const tracker = new MapCheckpoints(world, start, [], -20);
		const river = world.river.points[3];
		expect(tracker.update(1 / 60, { x: river.x, y: river.water + 0.5, z: river.z })).toBeNull();
		expect(tracker.update(1 / 60, { x: river.x, y: river.water - 1, z: river.z })?.type).toBe('fell');
		let event: { checkpoint: { id: string } } | undefined;
		for (let n = 0; n < 90; n++) {
			const e = tracker.update(1 / 60, { x: river.x, y: river.water - 1, z: river.z });
			if (e?.type === 'respawn') {
				event = e;
				break;
			}
		}
		expect(event?.checkpoint.id).toBe('start');
	});
});
it('checkpoint touch keeps its id on reload and reset remembers the base', () => {
	const saved: string[] = [];
	const start = {
		id: 'start',
		spawn: world.base.spawn,
		yaw: 0,
		min: { x: -1, y: -1, z: -1 },
		max: { x: 1, y: 1, z: 1 }
	};
	const cp = {
		...start,
		id: 'bank',
		spawn: { x: 70, y: 20, z: 50 },
		min: { x: 69, y: 19, z: 49 },
		max: { x: 71, y: 21, z: 51 }
	};
	const tracker = new MapCheckpoints(world, start, [cp], -20, undefined, (c) => saved.push(c.id));
	expect(tracker.update(1 / 60, cp.spawn)?.type).toBe('checkpoint');
	expect(tracker.current.id).toBe('bank');
	expect(saved).toEqual(['bank']);
	tracker.reset();
	expect(saved).toEqual(['bank', 'start']);
});
it('the capsule sees every visible 1 u height sample, including cliff lips between coarse block samples', () => {
	const heights = new Float32Array(world.heights.length);
	heights[17 * world.grid + 17] = 3;
	const map = {
		...world,
		heights,
		blocks: world.blocks.map((b) => ({
			...b,
			heights: new Float32Array(b.heights.length),
			cylinders: new Float32Array(),
			boxes: new Float32Array(),
			decks: new Float32Array()
		}))
	};
	const collision = buildMapCollision(map);
	expect(collision.raycast(new Ray(new Vector3(17, 8, 17), new Vector3(0, -1, 0)), 10)).toBeCloseTo(5, 4);
	collision.dispose();
});
it('the capsule walks across a generated bridge without falling through its slope or block boundary', async () => {
	const { Character } = await import('../engine/character.ts');
	const c = world.crossings.find((c) => c.kind === 'bridge');
	if (!c) throw new Error('bridge-fixture');
	const collision = buildMapCollision(world);
	const player = new Character(collision, c.from);
	const dx = c.to.x - c.from.x,
		dz = c.to.z - c.from.z,
		length = Math.hypot(dx, dz);
	for (let i = 0; i < Math.floor((length / 9.6) * 60); i++) {
		player.step(1 / 60, { moveX: dx / length, moveZ: dz / length, jumpHeld: false, faceYaw: null });
		expect(player.position.y).toBeGreaterThan(c.water + 0.25);
	}
	expect(Math.hypot(player.position.x - c.to.x, player.position.z - c.to.z)).toBeLessThan(0.6);
	collision.dispose();
});
