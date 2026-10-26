import { describe, expect, it } from 'vitest';
import { createAnimal } from './animal.ts';
import { AnimalAnimator } from './animal-animator.ts';
import { allFinite, run, straight } from './fixtures.test-helper.ts';
import { GROUND, GROUND_SPECIES, GROUND_STATES, type GroundSpecies, Herd } from './ground.ts';
import {
	froudeSpeed,
	froudeStride,
	GRAVITY_UNITS,
	gameHeight,
	MEASURES,
	P23_SPECIES,
	UNIT_METRES
} from './measures.ts';
import { AnimalMotion, createAnimalWorld } from './motion.ts';
import { ONCA_STATES } from './onca.ts';
import { posturesOf } from './postures.ts';
import { JOINT_COUNT, LIMB_BL, LIMB_FL, MODELS } from './rigs.ts';
import { derivedGait, hipHeight, resolveSpeciesId, SPECIES } from './species.ts';
import { TUCANO_STATES } from './tucano.ts';

const STRIDE = 6;

/** A closed square loop of side `side` at height y, starting at the origin, every unit a point. */
function square(side: number, y = 0): number[] {
	const out: number[] = [];
	for (let k = 0; k < side; k++) out.push(k, y, 0);
	for (let k = 0; k < side; k++) out.push(side, y, k);
	for (let k = side; k > 0; k--) out.push(k, y, side);
	for (let k = side; k > 0; k--) out.push(0, y, k);
	return out;
}

describe('P23 sizes and gaits come from measures.ts (ART.md §3, AJ83)', () => {
	it('draws each species ×1.5 life size: height × 1.5 / 0.47 m per unit', () => {
		for (const id of P23_SPECIES) {
			const s = SPECIES[id];
			expect(s.size, id).toBeCloseTo((MEASURES[id].height * 1.5) / UNIT_METRES, 9);
			expect(s.size, id).toBeCloseTo(gameHeight(MEASURES[id].height), 9);
			expect(s.scale * MODELS[s.model].top, id).toBeCloseTo(s.size, 9);
			expect(s.name, id).toBe(MEASURES[id].name);
			expect(s.scientific, id).toBe(MEASURES[id].scientific);
		}
		// Bigger animals stay below the avatar's 3 u, the jaguar's rule of ART.md §3 for all.
		for (const id of P23_SPECIES) expect(SPECIES[id].size, id).toBeLessThan(3);
	});

	it('takes speed √(F g h) and stride 2.3 h F^0.3 at its Froude numbers, h its drawn hip', () => {
		expect(GRAVITY_UNITS).toBeCloseTo(9.81 / 0.47, 9);
		for (const id of P23_SPECIES) {
			const m = MEASURES[id];
			const g = derivedGait(id);
			const hip = hipHeight(SPECIES[id]);
			expect(g.hip, id).toBeCloseTo(hip, 9);
			for (const [measure, derived] of [
				[m.walk, g.walk],
				[m.run, g.run]
			] as const) {
				if (measure === null) {
					expect(derived).toBeNull();
					continue;
				}
				expect(derived?.speed, id).toBeCloseTo(
					measure.speed ?? Math.sqrt(measure.froude * GRAVITY_UNITS * hip),
					9
				);
				expect(derived?.stride, id).toBeCloseTo(measure.stride ?? 2.3 * hip * measure.froude ** 0.3, 9);
				expect(froudeSpeed(measure.froude, hip) ** 2 / (GRAVITY_UNITS * hip), id).toBeCloseTo(
					measure.froude,
					9
				);
				expect(froudeStride(1, hip) / hip).toBeCloseTo(2.3, 9);
			}
			// The animator strides by the same numbers.
			const s = SPECIES[id];
			if (g.walk) {
				expect(s.stride.slowSpeed, id).toBeCloseTo(g.walk.speed, 9);
				expect(s.stride.slowStride, id).toBeCloseTo(g.walk.stride, 9);
			}
			if (g.run) expect(s.stride.fastSpeed, id).toBeCloseTo(g.run.speed, 9);
		}
	});

	it('walks below F 0.5 and gallops above 2.5, the transitions AJ83 found', () => {
		for (const id of P23_SPECIES) {
			const m = MEASURES[id];
			if (m.walk && m.walk.kind !== 'hop') expect(m.walk.froude, id).toBeLessThan(0.5);
			if (m.run?.kind === 'gallop') expect(m.run.froude, id).toBeGreaterThanOrEqual(2.5);
			if (m.run?.kind === 'trot') {
				expect(m.run.froude, id).toBeGreaterThan(0.5);
				expect(m.run.froude, id).toBeLessThan(2.5);
			}
		}
	});

	it('uses the footfalls of its gait kind', () => {
		expect(SPECIES['caranguejo-uca'].walk?.sideways).toBe(true);
		expect(SPECIES['sapo-cururu'].walk?.arc).toBeGreaterThan(0);
		expect(SPECIES.tapiti.run?.arc).toBeGreaterThan(0);
		for (const d of SPECIES['jabuti-tinga'].walk?.duty ?? []) expect(d).toBeGreaterThanOrEqual(0.8);
		// Trot: diagonal pairs together.
		const trot = SPECIES['cachorro-do-mato'].run;
		expect(trot?.touchdown[0]).toBe(trot?.touchdown[3]);
		expect(trot?.touchdown[1]).toBe(trot?.touchdown[2]);
		// A bird steps with its two legs only.
		const wader = SPECIES.colhereiro.walk;
		expect(wader?.touchdown[2]).not.toBe(wader?.touchdown[3]);
	});
});

describe('P23 animators', () => {
	function walk(id: GroundSpecies, speed: number, seconds = 1.2) {
		const animator = new AnimalAnimator(id);
		const motion = new AnimalMotion();
		motion.posture = 'stand';
		const poses: Float64Array[] = [];
		for (let t = 0; t < seconds; t += 1 / 60) {
			motion.beginUpdate();
			motion.speed = speed;
			motion.distance = speed / 60;
			animator.update(1 / 60, motion);
			poses.push(Float64Array.from(animator.pose.data));
		}
		return { animator, poses };
	}

	it('moves only a bird’s legs when it walks, never its wings', () => {
		const { poses } = walk('colhereiro', SPECIES.colhereiro.stride.slowSpeed);
		const range = (slot: number, axis: number) => {
			const v = poses.map((p) => p[slot * STRIDE + axis]);
			return Math.max(...v) - Math.min(...v);
		};
		expect(range(LIMB_FL, 2)).toBeLessThan(1e-9);
		expect(range(LIMB_FL, 0)).toBeLessThan(1e-9);
		expect(range(LIMB_BL, 0)).toBeGreaterThan(0.2);
	});

	it('swings a crab’s legs across its body, not fore and aft', () => {
		const { poses } = walk('caranguejo-uca', SPECIES['caranguejo-uca'].stride.slowSpeed);
		const range = (axis: number) => {
			const v = poses.map((p) => p[LIMB_FL * STRIDE + axis]);
			return Math.max(...v) - Math.min(...v);
		};
		expect(range(2)).toBeGreaterThan(0.2);
		expect(range(0)).toBeLessThan(1e-9);
	});

	it('lifts a hopping toad off the ground at its own walking speed', () => {
		const { animator, poses } = walk('sapo-cururu', SPECIES['sapo-cururu'].stride.slowSpeed, 2);
		const rootY = poses.map((p) => p[4]);
		expect(Math.max(...rootY) - Math.min(...rootY)).toBeGreaterThan(0.05);
		expect(allFinite(animator.pose.data)).toBe(true);
	});

	it('has the posture for every state its behaviour can take', () => {
		for (const id of GROUND_SPECIES) {
			const postures = posturesOf(id);
			const t = GROUND[id];
			expect(postures, id).toContain('stand');
			expect(postures, id).toContain('alert');
			if (t.choose.graze > 0) expect(postures, id).toContain('graze');
			if (t.choose.rest > 0) expect(postures, id).toContain('lie');
			if (t.choose.sit > 0) expect(postures, id).toContain('sit');
			if (t.reaction === 'hide') expect(postures, id).toContain('withdraw');
		}
		expect(posturesOf('capivara')).toContain('swim');
		expect(posturesOf('anta')).toContain('swim');
		for (const id of ['saira-sete-cores', 'sabia-laranjeira', 'jacutinga'] as const)
			expect(posturesOf(id)).toEqual(expect.arrayContaining(['perch', 'fly', 'roost', 'graze']));
		expect(JOINT_COUNT).toBe(8);
	});
});

describe('P23 behaviours', () => {
	it('are calm: no state of attack, and the cats keep the onça’s states', () => {
		const aggressive = /stalk|chase|hunt|pounce|attack|charge|ambush|growl|roar|snarl|bite/;
		for (const state of [...GROUND_STATES, ...TUCANO_STATES, ...ONCA_STATES])
			expect(state).not.toMatch(aggressive);
		for (const id of ['onca-parda', 'jaguatirica'] as const) {
			const cat = createAnimal(id, { seed: 2, route: square(20), loop: true });
			expect(cat.behaviour.states).toEqual(ONCA_STATES);
			// A smaller cat walks slower than the onça by dynamic similarity.
			expect(cat.behaviour.tuning.walkSpeed).toBeLessThan(1.8);
		}
	});

	it('flee (or leave) along their route when the player comes close, never stepping toward', () => {
		for (const id of GROUND_SPECIES) {
			const tuning = GROUND[id];
			if (tuning.reaction === 'hide') continue;
			const animal = createAnimal(id, { seed: 7, route: straight(120, 0), start: 60 });
			const world = createAnimalWorld();
			world.playerX = 0;
			world.playerZ = 60 - tuning.reactRadius - 6;
			// The player walks to 2 u inside its reaction radius of where it stood, and waits there.
			const stop = 60 - tuning.reactRadius + 2;
			let fled = false;
			let lastZ = animal.motion.z;
			run(animal, 12, 60, world, () => {
				if (world.playerZ < stop) world.playerZ += 0.06;
				const step = animal.motion.z - lastZ;
				lastZ = animal.motion.z;
				if (animal.state === 'flee') {
					fled = true;
					expect(step, id).toBeGreaterThanOrEqual(-1e-9);
				}
				expect(allFinite(animal.pose.data), id).toBe(true);
			});
			expect(fled, id).toBe(true);
			// It got away: farther than where the player stopped.
			expect(animal.motion.z - stop, id).toBeGreaterThan(tuning.reactRadius - 2);
		}
	});

	it('the veado-mateiro flees at 15 u and not before', () => {
		const make = () => createAnimal('veado-mateiro', { seed: 3, route: straight(200, 0), start: 100 });
		const far = make();
		const world = createAnimalWorld();
		world.playerZ = 100 - 15.5;
		run(far, 5, 60, world);
		expect(far.state).not.toBe('flee');
		expect(far.state).toBe('alert');
		const near = make();
		world.playerZ = 100 - 14.5;
		let fled = false;
		run(near, 2, 60, world, () => {
			fled ||= near.state === 'flee';
		});
		expect(fled).toBe(true);
		expect(GROUND['veado-mateiro'].reactRadius).toBe(15);
	});

	it('hides: the jabuti withdraws into its shell, the crab backs into its burrow, and both come out again', () => {
		for (const id of ['jabuti-tinga', 'caranguejo-uca'] as const) {
			const animal = createAnimal(id, { seed: 4, route: square(4), loop: true });
			const world = createAnimalWorld();
			const home = animal.motion;
			world.playerX = home.x + 1;
			world.playerZ = home.z + 1;
			run(animal, 3, 60, world);
			expect(animal.state, id).toBe('hide');
			expect(animal.motion.posture, id).toBe('withdraw');
			expect(animal.behaviour.hidden, id).toBeCloseTo(1, 6);
			if (id === 'caranguejo-uca') expect(animal.motion.y).toBeLessThan(-SPECIES[id].size);
			world.playerX = 100;
			run(animal, 20, 60, world);
			expect(animal.state, id).not.toBe('hide');
			expect(animal.behaviour.hidden, id).toBe(0);
		}
	});

	it('swims where its route is in water, with a slow bob at the waterline', () => {
		const route = square(10, -0.5);
		const water = Array.from({ length: route.length / 3 }, (_, k) => (route[k * 3 + 2] > 5 ? 1 : 0));
		const capivara = createAnimal('capivara', { seed: 9, route, loop: true, water });
		const world = createAnimalWorld();
		world.playerX = 500;
		// Dusk: the capybara's active hours (crepuscular), so it moves round its loop.
		world.light = 'dusk';
		let swam = 0;
		let walked = 0;
		run(capivara, 120, 30, world, () => {
			const m = capivara.motion;
			if (capivara.behaviour.swimming) {
				swam++;
				expect(m.posture === 'swim' || m.posture === 'withdraw').toBe(true);
				expect(Math.abs(m.y + 0.5)).toBeLessThan(0.02 * SPECIES.capivara.size + 1e-9);
				expect(m.eat).toBe(0);
			} else walked++;
		});
		expect(swam).toBeGreaterThan(0);
		expect(walked).toBeGreaterThan(0);
	});

	it('moves as a herd: followers keep their places while the leader walks, and all flee together', () => {
		const herd = new Herd();
		const band = [0, 1, 2, 3, 4].map((i) =>
			createAnimal('cateto', {
				seed: 20 + i,
				route: square(14),
				loop: true,
				herd,
				offset: -1.4 * i,
				start: 0
			})
		);
		const world = createAnimalWorld();
		world.playerX = 500;
		const length = band[0].behaviour.route.length;
		let worst = 0;
		let moving = 0;
		for (let frame = 0; frame < 60 * 60; frame++) {
			for (const animal of band) animal.update(1 / 60, world);
			const leader = band[0].behaviour;
			if (leader.state === 'move' && leader.stateTime > 2) {
				moving++;
				for (let i = 1; i < band.length; i++) {
					let gap = leader.cursor.s - 1.4 * i - band[i].behaviour.cursor.s;
					gap -= length * Math.round(gap / length);
					worst = Math.max(worst, Math.abs(gap));
				}
			}
		}
		expect(moving).toBeGreaterThan(0);
		expect(worst).toBeLessThan(1.5);
		// A child near the last one: the leader turns the band away and everyone runs.
		const last = band[4].motion;
		world.playerX = last.x + 2;
		world.playerZ = last.z;
		const fled = new Set<number>();
		for (let frame = 0; frame < 120; frame++)
			band.forEach((animal, i) => {
				animal.update(1 / 60, world);
				if (animal.state === 'flee') fled.add(i);
			});
		expect(fled.size).toBe(5);
		const direction = band[0].behaviour.cursor.direction;
		for (const animal of band) expect(animal.behaviour.cursor.direction).toBe(direction);
	});

	it('rests by day when nocturnal, and is active at night', () => {
		const resting = (light: 'day' | 'night') => {
			const tapiti = createAnimal('tapiti', { seed: 5, route: square(8), loop: true });
			const world = createAnimalWorld();
			world.playerX = 500;
			world.light = light;
			let rest = 0;
			let total = 0;
			run(tapiti, 600, 10, world, () => {
				total++;
				if (tapiti.state === 'rest') rest++;
			});
			return rest / total;
		};
		expect(resting('day')).toBeGreaterThan(resting('night') + 0.2);
	});
});

describe('the colhereiro', () => {
	it('feeds walking slowly through the shallows, sweeping its bill side to side', () => {
		const bird = createAnimal('colhereiro', { seed: 3, route: straight(80, 0), start: 40 });
		const world = createAnimalWorld();
		world.playerX = 500;
		const yaws: number[] = [];
		let walked = 0;
		run(bird, 300, 30, world, () => {
			if (bird.state !== 'graze' || bird.behaviour.stateTime < 1) return;
			yaws.push(bird.motion.lookYaw);
			walked += bird.motion.distance;
			expect(bird.motion.posture).toBe('graze');
		});
		expect(yaws.length).toBeGreaterThan(30);
		expect(Math.max(...yaws)).toBeGreaterThan(0.4);
		expect(Math.min(...yaws)).toBeLessThan(-0.4);
		// It keeps walking while it feeds.
		expect(walked).toBeGreaterThan(1);
	});

	it('flies in at dusk, one after another, and lands on its wading line', () => {
		const herd = new Herd();
		const flock = [0, 1, 2].map((i) =>
			createAnimal('colhereiro', { seed: 9 + i, route: straight(40, 0), start: 20, herd, offset: -1.5 * i })
		);
		const world = createAnimalWorld();
		world.playerX = 500;
		for (const bird of flock) run(bird, 2, 60, world);
		world.light = 'dusk';
		const flew = new Set<number>();
		let highest = 0;
		for (let frame = 0; frame < 60 * 20; frame++)
			flock.forEach((bird, i) => {
				bird.update(1 / 60, world);
				if (bird.state === 'arrive' && bird.motion.posture === 'fly') {
					flew.add(i);
					highest = Math.max(highest, bird.motion.y);
				}
			});
		expect(flew.size).toBe(3);
		expect(highest).toBeGreaterThan(5);
		for (const bird of flock) {
			expect(bird.state).not.toBe('arrive');
			expect(bird.motion.x).toBeCloseTo(0, 6);
			expect(bird.motion.y).toBeCloseTo(0, 6);
		}
		// The scene can call it too (a mission beat): staggered by rank.
		herd.arrive();
		expect(flock[1].behaviour.arriving).toBeGreaterThan(flock[0].behaviour.arriving);
	});

	it('answers to its old id, guara', () => {
		expect(resolveSpeciesId('guara')).toBe('colhereiro');
		expect(resolveSpeciesId('colhereiro')).toBe('colhereiro');
		expect(resolveSpeciesId('nope')).toBeNull();
		expect(SPECIES.colhereiro.scientific).toBe('Platalea ajaja');
		expect(SPECIES.colhereiro.size).toBeCloseTo(gameHeight(0.8), 9);
	});
});

describe('P23 perching birds', () => {
	const PERCHES = [
		{ x: 0, y: 0, z: 0, yaw: 0, halfLength: 1, ground: true },
		{ x: 6, y: 5, z: 2, yaw: 1, halfLength: 0.4 },
		{ x: -5, y: 0, z: 4, yaw: 2, halfLength: 1, ground: true }
	];

	it('the sabiá hops and pecks on the lawn, sings up a branch, and flies off when approached', () => {
		const sabia = createAnimal('sabia-laranjeira', { seed: 12, perches: PERCHES });
		const world = createAnimalWorld();
		world.playerX = 500;
		const seen = new Set<string>();
		let sangOnGround = false;
		run(sabia, 600, 30, world, () => {
			seen.add(sabia.state);
			if (sabia.state === 'sing' && sabia.behaviour.onGround) sangOnGround = true;
			if (sabia.state === 'peck') expect(sabia.motion.posture).toBe('graze');
		});
		for (const state of ['perch', 'hop', 'peck', 'fly', 'sing']) expect(seen.has(state), state).toBe(true);
		expect(sangOnGround).toBe(false);
		// A child walks up to it: it leaves for the perch farthest from them.
		const shy = createAnimal('sabia-laranjeira', { seed: 13, perches: PERCHES, start: 0 });
		world.playerX = 1;
		world.playerZ = 1;
		run(shy, 4, 60, world);
		expect(shy.behaviour.flights).toBeGreaterThan(0);
		expect(shy.behaviour.perch).toBe(1);
	});

	it('flaps faster when smaller (estimates by mass), and the toucan is unchanged', () => {
		const rate = (id: 'tucano-de-bico-verde' | 'saira-sete-cores' | 'jacutinga') =>
			createAnimal(id, { seed: 1, perches: PERCHES }).behaviour.tuning.flapRate;
		expect(rate('tucano-de-bico-verde')).toBe(6);
		expect(rate('saira-sete-cores')).toBeGreaterThan(rate('tucano-de-bico-verde'));
		expect(rate('jacutinga')).toBeLessThan(rate('tucano-de-bico-verde'));
	});
});
