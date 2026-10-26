import { Group, PerspectiveCamera } from 'three';
import { expect, it, vi } from 'vitest';
import type { LifeFrame, LivingWorld } from '../../life/index.ts';
import { offsetLife, offsetLifeBindings } from './life-offset.ts';

it('translates zone life rendering, actors and both camera and player input consistently', () => {
	let observed: LifeFrame | undefined;
	const base = {
		object3d: new Group(),
		actors: [{ id: 1, position: { x: 4, y: 2, z: 8 }, eyeHeight: 1, active: true, companion: false }],
		update: (frame: LifeFrame) => {
			observed = frame;
		},
		onStory: vi.fn(),
		setQuality: vi.fn(),
		howl: vi.fn(),
		debug: vi.fn(),
		dispose: vi.fn()
	} satisfies LivingWorld;
	const life = offsetLife(base, 160, -160);
	expect(life.object3d.position.x).toBe(160);
	expect(life.actors[0].position.z).toBe(-152);
	const camera = new PerspectiveCamera();
	camera.position.set(180, 10, -140);
	camera.updateMatrixWorld();
	life.update({
		dt: 1 / 60,
		time: 0,
		camera,
		playerPosition: { x: 170, y: 3, z: -150 },
		playerVelocity: { x: 2, y: 0, z: 3 },
		reducedMotion: true,
		light: 'dusk'
	});
	expect(observed?.playerPosition).toEqual({ x: 10, y: 3, z: 10 });
	expect(observed?.camera.matrixWorld.elements[12]).toBe(20);
	expect(observed?.light).toBe('dusk');
	expect(camera.position.x).toBe(180);
	life.dispose();
	life.dispose();
	expect(base.dispose).toHaveBeenCalledTimes(1);
});

it('translates local blob positions and howl events to global coordinates once at the boundary', () => {
	const set = vi.fn(),
		howl = vi.fn();
	const bindings = offsetLifeBindings(160, -160, { add: () => 1, set, hide: vi.fn(), remove: vi.fn() }, howl);
	bindings.blobs?.set(1, 4, 2, 8, 0.5);
	expect(set).toHaveBeenCalledWith(1, 164, 2, -152, 0.5, undefined);
	bindings.onHowl?.({ x: 4, y: 2, z: 8, index: 0, chorus: false });
	expect(howl).toHaveBeenCalledWith(expect.objectContaining({ x: 164, z: -152 }));
});
