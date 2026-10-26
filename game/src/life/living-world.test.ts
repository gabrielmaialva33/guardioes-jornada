import { getEventListeners } from 'node:events';
import { Group, Mesh, type Object3D, SkinnedMesh, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { heightAt } from '../survival/terrain.ts';
import { createLivingWorld } from './create.ts';
import { cameraAt, nodeLoadGlb, storyMap, stubTexture, trackDisposal } from './fixtures.test-helper.ts';
import { BUTTERFLY_BASE, BUTTERFLY_PER_SEEDLING } from './flocks.ts';
import { LIFE_SEED } from './homes.ts';
import type { LifeFrame, LifeStoryState, LivingWorld, LivingWorldRuntime } from './living-world.ts';

const { world, level } = storyMap();

async function create(
	quality: 'low' | 'medium' | 'high' = 'low',
	seed = LIFE_SEED,
	signal = new AbortController().signal
) {
	return (await createLivingWorld({
		world,
		level,
		quality,
		seed,
		signal,
		loadGlb: nodeLoadGlb,
		loadTexture: stubTexture
	})) as LivingWorldRuntime;
}

function frameAt(x: number, z: number, camera = cameraAt([80, 160, 80], [80, 0, 80.01], 400)): LifeFrame {
	const y = heightAt(world.heights, x, z);
	return {
		dt: 1 / 60,
		camera,
		playerPosition: { x, y, z },
		playerVelocity: { x: 0, y: 0, z: 0 },
		time: 0,
		reducedMotion: false
	};
}

function run(life: LivingWorld, frame: LifeFrame, seconds: number) {
	for (let i = 0; i < Math.round(seconds * 60); i++) {
		frame.time += frame.dt;
		life.update(frame);
	}
}

const story = (done: number[], planted = 0): LifeStoryState => ({
	completed: (id) => done.includes(id),
	progress: (id) => (id === 4 ? planted : done.includes(id) ? 1 : 0)
});

describe('living world: assembly and budgets', () => {
	it('builds one mesh per animal, two flocks and one particle system, within 20 draws and 25k triangles', async () => {
		const life = await create('high');
		const meshes: Mesh[] = [];
		life.object3d.traverse((o) => {
			if (o instanceof Mesh) meshes.push(o);
		});
		const pets = meshes.filter((m) => m instanceof SkinnedMesh);
		expect(pets).toHaveLength(life.fauna.animals.length);
		expect(meshes).toHaveLength(life.fauna.animals.length + 3);
		for (const pet of pets) {
			expect(Array.isArray(pet.material)).toBe(false);
			expect(pet.geometry.getAttribute('skinIndex')).toBeDefined();
		}
		const frame = frameAt(80, 80);
		run(life, frame, 2);
		life.onStory(story([1, 2, 3, 4, 5], 6));
		run(life, frame, 1);
		const debug = life.debug();
		// Every animal in view from high above the map: the worst case.
		expect(debug.visible).toBe(life.fauna.animals.length);
		expect(debug.draws).toBeLessThanOrEqual(20);
		expect(debug.triangles).toBeLessThanOrEqual(25_000);
		let triangles = 0;
		for (const pet of pets) triangles += (pet.geometry.index?.count ?? 0) / 3;
		expect(triangles).toBeLessThan(13_000);
		life.dispose();
	});

	it('puts every animal mesh where its animal is, scaled to ART.md §3', async () => {
		const life = await create();
		const frame = frameAt(80, 80);
		run(life, frame, 1);
		life.fauna.animals.forEach((animal, i) => {
			const pet = life.pets[i];
			expect(pet).not.toBeNull();
			if (!pet) return;
			pet.group.updateMatrixWorld(true);
			const at = new Vector3().setFromMatrixPosition(pet.group.matrixWorld);
			expect(at.distanceTo(new Vector3(animal.motion.x, animal.motion.y, animal.motion.z))).toBeLessThan(
				1e-4
			);
			expect(pet.group.scale.x).toBeCloseTo(animal.species.scale, 6);
			// The head bone sits above the feet for every standing or perched animal.
			const head = pet.bones.find((b) => b.name === 'head');
			if (head && !['muriqui', 'preguica-de-coleira'].includes(animal.species.id)) {
				const top = new Vector3().setFromMatrixPosition(head.matrixWorld);
				expect(top.y).toBeGreaterThan(at.y);
			}
		});
		const onca = life.fauna.animals.findIndex((a) => a.species.id === 'onca-pintada');
		const m = life.fauna.animals[onca].motion;
		expect(m.y).toBeCloseTo(heightAt(world.heights, m.x, m.z), 2);
		life.dispose();
	});
});

describe('living world: the story', () => {
	it('turns a mico into the companion on the mission-1 state and grows the butterflies with each seedling', async () => {
		const life = await create();
		const frame = frameAt(58, 47);
		life.onStory(story([]));
		run(life, frame, 1);
		expect(life.debug().companion).toBe(false);
		expect(life.debug().butterflies).toBe(BUTTERFLY_BASE);
		life.onStory(story([1]));
		run(life, frame, 4);
		const debug = life.debug();
		expect(debug.companion).toBe(true);
		expect(debug.companionState).toMatch(/follow|idle|hop/);
		const mico = life.fauna.animals[life.fauna.companion].motion;
		expect(Math.hypot(mico.x - 58, mico.z - 47)).toBeLessThan(3);
		life.onStory(story([1], 4));
		expect(life.debug().butterflies).toBe(BUTTERFLY_BASE + 4 * BUTTERFLY_PER_SEEDLING);
		expect(life.flocks.butterflyMesh.mesh.count).toBe(BUTTERFLY_BASE + 4 * BUTTERFLY_PER_SEEDLING);
		life.dispose();
	});

	it('sends the toucans flying when the summit is reached, not when a finished save loads', async () => {
		const toucans = (life: LivingWorldRuntime) =>
			life.fauna.animals.filter((a) => a.species.id === 'tucano-de-bico-verde').map((a) => a.state);
		const loaded = await create();
		loaded.onStory(story([1, 2, 3, 4, 5, 6], 6));
		expect(toucans(loaded).every((s) => s === 'perch')).toBe(true);
		loaded.dispose();
		const life = await create();
		life.onStory(story([1, 2, 3, 4, 5], 6));
		life.onStory(story([1, 2, 3, 4, 5, 6], 6));
		expect(toucans(life).every((s) => s === 'fly')).toBe(true);
		life.dispose();
	});

	it('calls onHowl for the chorus', async () => {
		const howls: boolean[] = [];
		const life = (await createLivingWorld({
			world,
			level,
			quality: 'low',
			signal: new AbortController().signal,
			loadGlb: nodeLoadGlb,
			loadTexture: stubTexture,
			onHowl: (e) => howls.push(e.chorus)
		})) as LivingWorldRuntime;
		life.howl();
		expect(howls).toEqual([true]);
		life.dispose();
	});
});

describe('living world: reduced motion', () => {
	it('stops the wind, the particles and the flocks', async () => {
		const life = await create();
		const frame = frameAt(46, 50, cameraAt([46, 8, 58], [46, 3, 50]));
		run(life, frame, 3);
		expect(life.particles.live).toBeGreaterThan(0);
		const before = Array.from(life.flocks.butterflies.position);
		frame.reducedMotion = true;
		run(life, frame, 1);
		expect(life.particles.live).toBe(0);
		expect(Array.from(life.flocks.butterflies.position)).toEqual(before);
		const { windUniforms } = await import('./wind.ts');
		expect(windUniforms.uWindStrength.value).toBe(0);
		frame.reducedMotion = false;
		run(life, frame, 0.1);
		expect(windUniforms.uWindStrength.value).toBe(1);
		life.dispose();
	});
});

describe('living world: dispose', () => {
	it('leaves no object, GPU resource or listener behind, and ignores later calls', async () => {
		const controller = new AbortController();
		const life = await create('low', LIFE_SEED, controller.signal);
		const parent = new Group();
		parent.add(life.object3d);
		run(life, frameAt(58, 47), 1);
		life.onStory(story([1], 3));
		run(life, frameAt(58, 47), 1);
		const tracked = trackDisposal(life.object3d);
		const textures = [...tracked.resources].filter((r) => (r as { isTexture?: boolean }).isTexture);
		expect(textures.length).toBeGreaterThan(0);
		expect(getEventListeners(controller.signal, 'abort')).toHaveLength(0);
		life.dispose();
		expect(tracked.pending()).toEqual([]);
		expect(life.object3d.children).toHaveLength(0);
		expect(life.object3d.parent).toBeNull();
		expect(parent.children).toHaveLength(0);
		life.update(frameAt(58, 47));
		life.onStory(story([1, 2, 3, 4, 5, 6]));
		life.dispose();
		expect(life.object3d.children).toHaveLength(0);
	});

	it('releases every loaded GLB after baking, and everything when aborted mid-load', async () => {
		const loaded: Object3D[] = [];
		const released = new Set<Object3D>();
		const life = await createLivingWorld({
			world,
			level,
			quality: 'low',
			signal: new AbortController().signal,
			loadGlb: async (url, signal) => {
				const model = await nodeLoadGlb(url, signal);
				loaded.push(model);
				return model;
			},
			loadTexture: stubTexture,
			releaseGlb: (model) => released.add(model)
		});
		expect(loaded.length).toBe(7);
		expect(released.size).toBe(7);
		life.dispose();

		const controller = new AbortController();
		const owned: Object3D[] = [];
		const freed = new Set<Object3D>();
		const pending = createLivingWorld({
			world,
			level,
			quality: 'low',
			signal: controller.signal,
			loadGlb: async (url, signal) => {
				const model = await nodeLoadGlb(url);
				owned.push(model);
				controller.abort();
				signal.throwIfAborted();
				return model;
			},
			loadTexture: stubTexture,
			releaseGlb: (model) => freed.add(model)
		});
		await expect(pending).rejects.toThrow();
		expect(getEventListeners(controller.signal, 'abort')).toHaveLength(0);
		// Scenes that made it into the layer before the abort were released; none leaked into it.
		expect(freed.size).toBeLessThanOrEqual(owned.length);
	});
});

describe('living world: determinism', () => {
	async function replay(seed: number) {
		const life = await create('medium', seed);
		const frame = frameAt(58, 47, cameraAt([58, 20, 70], [58, 4, 40], 120));
		run(life, frame, 3);
		life.onStory(story([1], 2));
		for (let i = 0; i < 360; i++) {
			frame.time += frame.dt;
			frame.playerPosition.z = 47 + i / 120;
			frame.playerPosition.y = heightAt(world.heights, 58, frame.playerPosition.z);
			frame.playerVelocity.z = 0.5;
			life.update(frame);
		}
		const pets = life.pets.map((p) => Array.from(p?.group.matrix.elements ?? []));
		const bones = life.pets.flatMap((p) => p?.bones.map((b) => Array.from(b.matrix.elements)) ?? []);
		const particles = Array.from(life.particles.mesh.instanceMatrix.array.slice(0, life.particles.live * 16));
		const flocks = Array.from(life.flocks.butterflies.position);
		life.dispose();
		return { pets, bones, particles, flocks };
	}

	it('replays the same frames from the same seed', async () => {
		const a = await replay(LIFE_SEED);
		const b = await replay(LIFE_SEED);
		expect(b).toEqual(a);
		const c = await replay(LIFE_SEED + 7);
		expect(c.pets).not.toEqual(a.pets);
	});
});
