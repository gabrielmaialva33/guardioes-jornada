import { BoxGeometry } from 'three';
import { expect, it } from 'vitest';
import { PlayerController } from '../../engine/controller.ts';
import { InputModel } from '../../engine/input.ts';
import { type CollisionQuery, CollisionWorld } from '../../engine/world.ts';
import { DownProbe } from '../down-probe.ts';

it('runs the real character and camera against a structural streaming query without a nominal BVH', () => {
	const geometry = new BoxGeometry(30, 1, 30).translate(0, -0.5, 0);
	const world = new CollisionWorld([{ geometry }]);
	let casts = 0,
		rays = 0;
	const query: CollisionQuery = {
		shapecast(bounds, visit) {
			casts++;
			world.shapecast(bounds, visit);
		},
		raycast(ray, far) {
			rays++;
			return world.raycast(ray, far);
		}
	};
	const player = new PlayerController(query, { x: 0, y: 0.02, z: 0 });
	const input = new InputModel();
	for (let i = 0; i < 60; i++) player.update(1 / 60, input.sample(1 / 60));
	expect(player.character.grounded).toBe(true);
	expect(casts).toBeGreaterThan(0);
	expect(rays).toBeGreaterThan(0);
	expect(player.character.position.y).toBeCloseTo(0, 1);
	const probe = new DownProbe(query);
	probe.x = 0;
	probe.y = 1;
	probe.z = 0;
	probe.depth = 2;
	probe.sample();
	expect(probe.height).toBeCloseTo(0, 6);
	world.dispose();
	geometry.dispose();
});
