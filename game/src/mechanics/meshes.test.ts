import { BoxGeometry, Ray, Vector3 } from 'three';
import { expect, it } from 'vitest';
import { Character } from '../engine/character.ts';
import { CompoundWorld } from '../engine/compound-world.ts';
import { SuspensionBridge } from './bridge.ts';
import { createBridgeMesh } from './meshes.ts';

it('moving plank collision follows the rendered deck and side rails block walking falls', () => {
	const b = new SuspensionBridge({
			id: 'b',
			start: { x: 0, y: 3, z: 0 },
			end: { x: 0, y: 3, z: 16 },
			width: 2,
			planks: 20
		}),
		mesh = createBridgeMesh(b);
	const world = new CompoundWorld(
		[{ geometry: new BoxGeometry(100, 1, 100).translate(0, -0.5, 0) }],
		[mesh.world]
	);
	const ray = new Ray(new Vector3(0, 10, 8.4), new Vector3(0, -1, 0));
	const initial = world.raycast(ray, 20);
	for (let i = 0; i < 120; i++) {
		b.step(1 / 60, { x: 0, y: 2.5, z: 8.4 }, 9.6, false);
		mesh.update();
	}
	const height = b.heightAt(0, 8.4);
	expect(world.raycast(ray, 20)).toBeCloseTo(10 - (height ?? 0), 4);
	expect(world.raycast(ray, 20)).toBeGreaterThan(initial ?? 0);
	const c = new Character(world, { x: 0, y: height ?? 3, z: 8.4 });
	for (let i = 0; i < 120; i++) c.step(1 / 60, { moveX: 1, moveZ: 0, jumpHeld: false, faceYaw: null });
	expect(c.position.x).toBeLessThan(0.6);
	expect(c.position.y).toBeGreaterThan(2);
	b.step(1 / 60, c.position, 0, true);
	mesh.update();
	expect(world.raycast(ray, 20)).toBeCloseTo(initial ?? 0, 4);
	mesh.dispose();
	world.dispose();
});
