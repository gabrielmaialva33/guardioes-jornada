import { BoxGeometry } from 'three';
import { expect, it } from 'vitest';
import { PlayerController } from '../engine/controller.ts';
import { InputModel } from '../engine/input.ts';
import { CollisionWorld } from '../engine/world.ts';
import { Ladder } from './ladder.ts';
import { ParkTraversal } from './traversal.ts';
import { Zipline } from './zipline.ts';

const world = new CollisionWorld([{ geometry: new BoxGeometry(200, 1, 200).translate(0, -0.5, 0) }]);
const ladder = () =>
	new Ladder({
		id: 'l',
		base: { x: 0, y: 0, z: 0 },
		top: { x: 0, y: 6, z: 0 },
		exit: { x: 0, y: 6, z: 2 },
		radius: 0.8
	});
it('controller uses the same bounded fixed ticks for climbing and consumes jump once', () => {
	const l = ladder(),
		drive = new ParkTraversal({ ladders: [l] }),
		p = new PlayerController(world, { x: 0, y: 0, z: 0 }, { traversal: drive }),
		input = new InputModel();
	input.keyDown('KeyW');
	for (let i = 0; i < 60; i++) p.update(1 / 60, input.sample(1 / 60));
	expect(p.character.position.y).toBeCloseTo(4.8);
	expect(drive.mode).toBe('ladder');
	input.keyDown('Space');
	p.update(1 / 60, input.sample(1 / 60));
	expect(drive.mode).toBe('walk');
	expect(p.character.velocity.y).toBeGreaterThan(0);
	expect(p.update(5, input.sample(1 / 60)).ticks).toBe(4);
});
it('queues contextual action and jump across a render frame without a physics tick', () => {
	const z = new Zipline({ id: 'z', start: { x: 0, y: 8, z: 0 }, end: { x: 0, y: 0, z: 40 } }),
		drive = new ParkTraversal({ ziplines: [z] }),
		p = new PlayerController(world, z.spec.start, { traversal: drive }),
		input = new InputModel();
	input.tapButton('action');
	p.update(1 / 240, input.sample(1 / 240));
	expect(drive.mode).toBe('walk');
	p.update(1 / 60, input.sample(1 / 60));
	expect(drive.mode).toBe('zipline');
	input.keyDown('Space');
	for (let i = 0; i < 30; i++) p.update(1 / 60, input.sample(1 / 60));
	expect(drive.mode).toBe('zipline');
	p.respawnAt({
		id: 'home',
		spawn: { x: 20, y: 0, z: 0 },
		yaw: 0,
		min: { x: 19, y: 0, z: -1 },
		max: { x: 21, y: 3, z: 1 }
	});
	expect(drive.mode).toBe('walk');
	expect(p.character.position.x).toBe(20);
});
it('zipline is locked until the host unlocks it', () => {
	const z = new Zipline({ id: 'z', start: { x: 0, y: 8, z: 0 }, end: { x: 0, y: 0, z: 40 } }),
		drive = new ParkTraversal({ ziplines: [z], ziplineUnlocked: () => false }),
		p = new PlayerController(world, z.spec.start, { traversal: drive }),
		input = new InputModel();
	input.tapButton('action');
	p.update(1 / 60, input.sample(1 / 60));
	expect(drive.mode).toBe('walk');
});
