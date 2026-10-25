import { describe, expect, it } from 'vitest';
import { type AnyAnimal, createAnimal } from './animal.ts';
import { holds, straight } from './fixtures.test-helper.ts';
import { AnimationLod } from './lod.ts';
import { createAnimalWorld } from './motion.ts';
import { HEAD } from './rigs.ts';
import { SPECIES_IDS, type SpeciesId } from './species.ts';

const PERCHES = [
	{ x: 0, y: 6, z: 0, yaw: 0, halfLength: 0.6 },
	{ x: 6, y: 7, z: 2, yaw: 1, halfLength: 0.5 }
];

function make(species: SpeciesId): AnyAnimal {
	const lod = { nearDistance: 12, farInterval: 3 };
	switch (species) {
		case 'muriqui': {
			const muriqui = createAnimal(species, { seed: 31, route: holds(12, 1.15, 8), lod });
			muriqui.behaviour.brachiate(6);
			return muriqui;
		}
		case 'tucano-de-bico-verde': {
			const tucano = createAnimal(species, { seed: 31, perches: PERCHES, lod });
			tucano.behaviour.flyTo(1);
			return tucano;
		}
		case 'onca-pintada':
			return createAnimal(species, { seed: 31, route: [0, 0, 0, 30, 0, 0, 30, 0, 30], loop: true, lod });
		case 'mico-leao-dourado':
			return createAnimal(species, { seed: 31, route: straight(10, 3), lod });
		default:
			return createAnimal(species, { seed: 31, route: straight(10, 5), lod });
	}
}

/** Runs `frames` frames at 60 Hz with the camera at distance(frame). Returns the animal. */
function play(species: SpeciesId, frames: number, distance: (frame: number) => number) {
	const animal = make(species);
	const world = createAnimalWorld();
	world.playerX = 200;
	for (let frame = 1; frame <= frames; frame++) animal.frame(1 / 60, world, distance(frame), true);
	return animal;
}

function maxDifference(a: AnyAnimal, b: AnyAnimal) {
	let rotation = 0;
	let head = 0;
	let offset = 0;
	for (let i = 0; i < a.pose.data.length; i++) {
		const d = Math.abs(a.pose.data[i] - b.pose.data[i]);
		if (i % 6 >= 3) offset = Math.max(offset, d);
		else if (Math.floor(i / 6) === HEAD) head = Math.max(head, d);
		else rotation = Math.max(rotation, d);
	}
	const placement = Math.hypot(a.motion.x - b.motion.x, a.motion.y - b.motion.y, a.motion.z - b.motion.z);
	return { rotation, head, offset, placement, yaw: Math.abs(a.motion.yaw - b.motion.yaw) };
}

describe('animation LOD', () => {
	// 9 s: long enough for several decisions, hand switches, a flight and limb moves.
	const FRAMES = 540;

	for (const species of SPECIES_IDS) {
		it(`${species}: updating every 3rd frame ends in the same pose as every frame`, () => {
			const full = play(species, FRAMES, () => 5);
			const far = play(species, FRAMES, () => 20);
			const mixed = play(species, FRAMES, (frame) => (Math.floor(frame / 47) % 2 ? 20 : 5));
			expect(far.lod.tier).toBe('far');
			for (const other of [far, mixed]) {
				expect(other.state).toBe(full.state);
				const d = maxDifference(full, other);
				// Within 1.5° per joint and 2 mm-scale offsets; placement within 2 cm of world.
				expect(d.rotation).toBeLessThan(0.026);
				// The head carries the larger share of a glance (1 − bodyLook), and the look
				// spring sees a glance that lands mid-update one LOD step late: 2.6°.
				expect(d.head).toBeLessThan(0.045);
				expect(d.offset).toBeLessThan(0.004);
				expect(d.placement).toBeLessThan(0.04);
				expect(d.yaw).toBeLessThan(0.02);
			}
		});
	}

	it('freezes offscreen: no time accumulates and the pose does not change', () => {
		const animal = make('onca-pintada');
		const world = createAnimalWorld();
		for (let i = 0; i < 60; i++) animal.frame(1 / 60, world, 5, true);
		const pose = Float64Array.from(animal.pose.data);
		const x = animal.motion.x;
		for (let i = 0; i < 600; i++) expect(animal.frame(1 / 60, world, 5, false)).toBe(false);
		expect(animal.lod.tier).toBe('frozen');
		expect(Array.from(animal.pose.data)).toEqual(Array.from(pose));
		expect(animal.motion.x).toBe(x);
		expect(animal.lod.pending).toBe(0);
		// Back on screen: one normal frame of time, not ten seconds.
		expect(animal.frame(1 / 60, world, 5, true)).toBe(true);
		expect(animal.lod.dt).toBeCloseTo(1 / 60, 12);
	});

	it('never freezes a companion, and hands accumulated time over when the rate changes', () => {
		const lod = new AnimationLod({ keepAlive: true, farInterval: 3 });
		let total = 0;
		for (let i = 0; i < 9; i++) if (lod.tick(1 / 60, 50, false)) total += lod.dt;
		expect(lod.tier).toBe('far');
		expect(total).toBeCloseTo(9 / 60, 12);
		lod.tick(1 / 60, 50, false);
		lod.tick(1 / 60, 50, false);
		// Near again: the next update carries the two skipped frames plus this one.
		expect(lod.tick(1 / 60, 3, true)).toBe(true);
		expect(lod.dt).toBeCloseTo(3 / 60, 12);
	});

	it('staggers far animals over frames', () => {
		const counts = [0, 0, 0];
		const lods = [0, 1, 2].map((slot) => new AnimationLod({ slot, farInterval: 3 }));
		for (let frame = 0; frame < 3; frame++)
			lods.forEach((lod, i) => {
				if (lod.tick(1 / 60, 20, true)) counts[i] = frame;
			});
		expect(new Set(counts).size).toBe(3);
	});
});
