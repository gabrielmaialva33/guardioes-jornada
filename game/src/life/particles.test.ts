import { describe, expect, it } from 'vitest';
import { heightAt } from '../survival/terrain.ts';
import { FLAG } from '../survival/types.ts';
import { LIFE_TIERS } from './fauna.ts';
import { cameraAt, storyMap } from './fixtures.test-helper.ts';
import { BUTTERFLY_MAX } from './flocks.ts';
import { LIFE_SEED, planLife } from './homes.ts';
import { AmbientParticles, ParticleState } from './particles.ts';

const { world, level } = storyMap();
const plan = planLife(world, level);

function particles(limit: number, seed = LIFE_SEED, rates?: { leaf: number; pollen: number }) {
	return new AmbientParticles({
		canopy: plan.canopy,
		heights: world.heights,
		flags: world.flags,
		size: world.size,
		seed,
		limit,
		rates
	});
}

function at(system: AmbientParticles, x: number, z: number) {
	const f = system.frame;
	f.playerX = x;
	f.playerZ = z;
	f.playerY = heightAt(world.heights, x, z);
	f.camera = cameraAt([x, f.playerY + 4, z + 8], [x, f.playerY + 1, z]);
}

function run(system: AmbientParticles, seconds: number, hz = 60, each?: () => void) {
	system.frame.dt = 1 / hz;
	for (let i = 0; i < Math.round(seconds * hz); i++) {
		system.frame.time += 1 / hz;
		system.update();
		each?.();
	}
}

const FOREST: [number, number] = [18, 18];
const CLAREIRA: [number, number] = [112, 118];

describe('ambient particles: the ART.md §8 cap', () => {
	it('keeps leaves + pollen + every butterfly within 120 on low and 200 elsewhere', () => {
		expect(LIFE_TIERS.low.particles + BUTTERFLY_MAX).toBeLessThanOrEqual(120);
		expect(LIFE_TIERS.medium.particles + BUTTERFLY_MAX).toBeLessThanOrEqual(200);
		expect(LIFE_TIERS.high.particles + BUTTERFLY_MAX).toBeLessThanOrEqual(200);
	});

	it('never has more live particles than the limit, however fast they spawn', () => {
		for (const quality of ['low', 'medium', 'high'] as const) {
			const limit = LIFE_TIERS[quality].particles;
			const system = particles(limit, LIFE_SEED, { leaf: 5000, pollen: 5000 });
			// From the forest edge into the pasture: leaves and pollen both spawn.
			at(system, 46, 50);
			run(system, 3, 60, () => {
				expect(system.live).toBeLessThanOrEqual(limit);
				expect(system.mesh.count).toBe(system.live);
			});
			expect(system.peak).toBe(limit);
			// A tier drop: the particles over the new limit fade out in 120 ms, and it holds after.
			system.setLimit(20);
			run(system, 0.15);
			expect(system.live).toBeLessThanOrEqual(20);
			run(system, 5, 60, () => expect(system.live).toBeLessThanOrEqual(20));
			system.dispose();
		}
	});
});

describe('ambient particles: where they spawn and how they move', () => {
	const state = new ParticleState();

	it('drops leaves only from crowns and lets them fall to the ground', () => {
		const system = particles(80);
		at(system, ...FOREST);
		run(system, 6);
		expect(system.leaves).toBeGreaterThan(10);
		let landed = 0;
		for (let i = 0; i < system.live; i++) {
			system.read(i, state);
			expect(state.kind).toBe('leaf');
			const ground = heightAt(world.heights, state.x, state.z);
			expect(state.y).toBeGreaterThanOrEqual(ground);
			if (state.landed) {
				landed++;
				expect(state.y).toBeCloseTo(ground + 0.03, 1);
			}
		}
		// Fallen ones disappear after resting: they never pile up.
		run(system, 60);
		expect(system.live).toBeLessThanOrEqual(80);
		expect(landed + system.spawned).toBeGreaterThan(0);
	});

	it('floats pollen in the clareira, low over the open ground, and no leaves there', () => {
		const system = particles(80);
		at(system, ...CLAREIRA);
		run(system, 5);
		expect(system.pollen).toBeGreaterThan(10);
		for (let i = 0; i < system.live; i++) {
			system.read(i, state);
			const ground = heightAt(world.heights, state.x, state.z);
			if (state.kind === 'pollen') {
				const q = Math.round(state.z) * world.grid + Math.round(state.x);
				expect(state.y - ground).toBeLessThan(4);
				expect(state.y - ground).toBeGreaterThan(-0.5);
				expect(world.flags[q] & FLAG.river).toBe(0);
			}
		}
	});

	it('drifts downwind', () => {
		const system = particles(80, LIFE_SEED, { leaf: 0, pollen: 40 });
		at(system, ...CLAREIRA);
		run(system, 0.3);
		// Pollen lives 5–9 s: in the next half second none is removed and new ones are appended,
		// so the first n slots are the same particles.
		const n = system.live;
		expect(n).toBeGreaterThan(4);
		const before = Array.from({ length: n }, (_, i) => system.read(i, state).x);
		run(system, 0.5);
		let drift = 0;
		for (let i = 0; i < n; i++) drift += (system.read(i, state).x - before[i]) / n;
		// The sea breeze blows toward +x at about 0.55 × 1.1 u/s.
		expect(drift).toBeGreaterThan(0.1);
	});
});

describe('ambient particles: reduced motion', () => {
	it('stops spawning and fades out what is alive in 120 ms', () => {
		const system = particles(80);
		at(system, 46, 50);
		run(system, 4);
		expect(system.live).toBeGreaterThan(0);
		system.frame.reducedMotion = true;
		run(system, 0.15);
		expect(system.live).toBe(0);
		run(system, 5);
		expect(system.live).toBe(0);
		expect(system.mesh.count).toBe(0);
	});
});

describe('ambient particles: determinism', () => {
	function replay(seed: number) {
		const system = particles(80, seed);
		at(system, 46, 50);
		run(system, 8);
		const matrices = Array.from(system.mesh.instanceMatrix.array.slice(0, system.live * 16));
		system.dispose();
		return matrices;
	}

	it('replays the same particles from the same seed', () => {
		const a = replay(LIFE_SEED);
		expect(a.length).toBeGreaterThan(0);
		expect(replay(LIFE_SEED)).toEqual(a);
		expect(replay(LIFE_SEED + 1)).not.toEqual(a);
	});
});
