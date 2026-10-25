import { describe, expect, it } from 'vitest';
import { type AnyAnimal, createAnimal } from './animal.ts';
import { allFinite, holds, run, straight } from './fixtures.test-helper.ts';
import { MICO_STATES } from './mico.ts';
import { createAnimalWorld } from './motion.ts';
import { MURIQUI_HOLDS } from './muriqui.ts';
import { ONCA, ONCA_STATES } from './onca.ts';
import { POSTURES, posturesOf, SUSPENDED } from './postures.ts';
import { SLOTH_LIMB_ORDER } from './preguica.ts';
import { SPECIES, SPECIES_IDS, type SpeciesId } from './species.ts';
import { TUCANO } from './tucano.ts';

const PERCHES = [
	{ x: 0, y: 6, z: 0, yaw: Math.PI / 2, halfLength: 0.6 },
	{ x: 7, y: 7, z: 3, yaw: 0, halfLength: 0.5 },
	{ x: -5, y: 5.5, z: 6, yaw: 1, halfLength: 0.4 }
];

function make(species: SpeciesId, seed = 1): AnyAnimal {
	switch (species) {
		case 'mico-leao-dourado':
			return createAnimal(species, { seed, route: straight(8, 4) });
		case 'muriqui':
			return createAnimal(species, { seed, route: holds(10, 1.15, 8), start: 0 });
		case 'tucano-de-bico-verde':
			return createAnimal(species, { seed, perches: PERCHES });
		case 'onca-pintada':
			return createAnimal(species, { seed, route: [0, 0, 0, 20, 0, 0, 20, 0, 20, 0, 0, 20], loop: true });
		default:
			return createAnimal(species, { seed, route: straight(6, 5) });
	}
}

describe('scale (ART.md §3)', () => {
	it('matches the art direction heights', () => {
		const expected: Record<SpeciesId, number> = {
			'mico-leao-dourado': 0.9,
			'bugio-ruivo': 1.4,
			muriqui: 1.7,
			'preguica-de-coleira': 1.4,
			'onca-pintada': 2.2,
			'tucano-de-bico-verde': 0.9
		};
		for (const id of SPECIES_IDS) expect(SPECIES[id].size).toBe(expected[id]);
	});

	it('keeps the spring tempo physical: √(L_mico / L) of the real scaled body length', () => {
		const mico = SPECIES['mico-leao-dourado'];
		expect(mico.tempo).toBe(1);
		for (const id of SPECIES_IDS) {
			// The sloth's extra ×0.4 is behavioural (species.ts).
			const behavioural = id === 'preguica-de-coleira' ? 0.4 : 1;
			expect(SPECIES[id].tempo).toBeCloseTo(behavioural * Math.sqrt(mico.length / SPECIES[id].length), 9);
		}
		// Larger bodies are slower.
		expect(SPECIES['onca-pintada'].tempo).toBeLessThan(SPECIES['bugio-ruivo'].tempo);
	});
});

describe('mico-leão-dourado', () => {
	it('has no hanging state or suspended posture: its tail is not prehensile', () => {
		for (const state of MICO_STATES) expect(state).not.toMatch(/hang|tail|suspend|brachiat/);
		for (const posture of posturesOf('mico-leao-dourado')) expect(SUSPENDED).not.toContain(posture);
	});

	it('never enters a tail hang over a long, busy simulation', () => {
		for (const companion of [false, true]) {
			const mico = createAnimal('mico-leao-dourado', { seed: 3, route: straight(8, 4), companion });
			const world = createAnimalWorld();
			const seen = new Set<string>();
			run(mico, 240, 60, world, (t) => {
				world.playerX = 6 * Math.sin(t * 0.3);
				world.playerZ = 4 * Math.cos(t * 0.2);
				world.playerJumped = Math.floor(t * 60) % 300 === 0;
				seen.add(mico.state);
				expect(SUSPENDED).not.toContain(mico.motion.posture);
				expect(mico.animator.weights[POSTURES.indexOf('hang-tail')]).toBe(0);
			});
			for (const state of seen) expect(MICO_STATES).toContain(state);
		}
	});
});

describe('onça-pintada', () => {
	it('has only calm states: no stalking, crouching, chasing or attacking', () => {
		expect([...ONCA_STATES]).toEqual(['idle', 'move', 'sit', 'rest']);
		const aggressive = /stalk|crouch|chase|hunt|pounce|attack|charge|ambush|growl|roar|snarl|bite/;
		for (const state of ONCA_STATES) expect(state).not.toMatch(aggressive);
		for (const posture of posturesOf('onca-pintada')) expect(posture).not.toMatch(aggressive);
	});

	it('walks away from a player who comes close, never toward', () => {
		const onca = createAnimal('onca-pintada', { seed: 5, route: straight(200, 0), start: 20 });
		const world = createAnimalWorld();
		let closest = Number.POSITIVE_INFINITY;
		world.playerX = 0;
		world.playerZ = 0;
		let lastX = onca.motion.x;
		let lastZ = onca.motion.z;
		run(onca, 30, 60, world, () => {
			// The player walks straight at the jaguar and stands there.
			const m = onca.motion;
			const dx = world.playerX - m.x;
			const dz = world.playerZ - m.z;
			const distance = Math.hypot(dx, dz);
			if (distance > 3) {
				world.playerX -= (dx / distance) * 0.05;
				world.playerZ -= (dz / distance) * 0.05;
			}
			const stepX = m.x - lastX;
			const stepZ = m.z - lastZ;
			if (distance < ONCA.avoidRadius) expect(stepX * dx + stepZ * dz).toBeLessThanOrEqual(1e-9);
			closest = Math.min(closest, distance);
			lastX = m.x;
			lastZ = m.z;
			expect(ONCA_STATES).toContain(onca.state);
		});
		expect(closest).toBeLessThan(ONCA.avoidRadius);
	});
});

describe('bugio-ruivo', () => {
	it('hangs by tail and feet only while feeding, and never brachiates', () => {
		expect(posturesOf('bugio-ruivo')).not.toContain('hang-arm');
		const bugio = createAnimal('bugio-ruivo', { seed: 11, route: straight(6, 5) });
		let fed = false;
		let howled = false;
		run(bugio, 900, 30, createAnimalWorld(), () => {
			const m = bugio.motion;
			if (m.posture === 'feed-hang') {
				expect(bugio.state).toBe('feed-hang');
				expect(m.feeding).toBe(true);
				fed = true;
			}
			if (m.feeding) expect(m.posture).toBe('feed-hang');
			if (bugio.state === 'howl') howled = true;
		});
		expect(fed).toBe(true);
		expect(howled).toBe(true);
	});

	it('spends most of its time resting', () => {
		const bugio = createAnimal('bugio-ruivo', { seed: 2, route: straight(6, 5) });
		let resting = 0;
		let total = 0;
		run(bugio, 1800, 10, createAnimalWorld(), () => {
			total++;
			if (bugio.state === 'rest') resting++;
		});
		expect(resting / total).toBeGreaterThan(0.5);
	});
});

describe('muriqui', () => {
	it('documents handhold spacing from its arm: 1.0–1.25 u apart, never more than 1.33 u', () => {
		expect(MURIQUI_HOLDS.arm).toBeCloseTo(0.768, 3);
		expect(MURIQUI_HOLDS.min).toBeCloseTo(1, 1);
		expect(MURIQUI_HOLDS.max).toBeCloseTo(1.25, 2);
		expect(MURIQUI_HOLDS.reach).toBeCloseTo(1.33, 2);
		expect(MURIQUI_HOLDS.limit).toBeCloseTo(1.6, 2);
	});

	it('brachiates along its handholds and hangs by the tail to feed', () => {
		const muriqui = createAnimal('muriqui', { seed: 4, route: holds(10, 1.15, 8) });
		const anchors = new Set<number>();
		let tailHang = false;
		run(muriqui, 300, 30, createAnimalWorld(), () => {
			anchors.add(muriqui.behaviour.anchor);
			if (muriqui.state === 'tail-hang') {
				expect(muriqui.motion.posture).toBe('hang-tail');
				expect(muriqui.motion.feeding).toBe(true);
				tailHang = true;
			}
		});
		expect(muriqui.behaviour.switches).toBeGreaterThan(4);
		expect(anchors.size).toBeGreaterThan(3);
		expect(tailHang).toBe(true);
	});
});

describe('preguiça-de-coleira', () => {
	it('moves one limb at a time, in the order LH, LF, RH, RF, and creeps forward', () => {
		const sloth = createAnimal('preguica-de-coleira', { seed: 8, route: straight(30, 6) });
		const order: number[] = [];
		let previous = -1;
		let maxInAir = 0;
		const start = sloth.behaviour.cursor.s;
		run(sloth, 600, 30, createAnimalWorld(), () => {
			const b = sloth.behaviour;
			maxInAir = Math.max(maxInAir, b.limbsInAir);
			if (b.moving >= 0 && b.moving !== previous) order.push(b.moving);
			previous = b.moving;
			expect(sloth.motion.posture === 'hang-under' || sloth.motion.posture === 'hang-curl').toBe(true);
		});
		expect(maxInAir).toBe(1);
		expect(order.length).toBeGreaterThan(4);
		const at = order.indexOf(SLOTH_LIMB_ORDER[0]);
		expect(order.slice(at, at + 4)).toEqual([...SLOTH_LIMB_ORDER]);
		expect(Math.abs(sloth.behaviour.cursor.s - start)).toBeGreaterThan(0.3);
	});

	it('is mostly still', () => {
		const sloth = createAnimal('preguica-de-coleira', { seed: 9, route: straight(30, 6) });
		let moving = 0;
		let total = 0;
		run(sloth, 1200, 10, createAnimalWorld(), () => {
			total++;
			if (sloth.behaviour.moving >= 0) moving++;
		});
		expect(moving / total).toBeLessThan(0.35);
	});
});

describe('tucano-de-bico-verde', () => {
	it('perches, hops and flies in flap bursts with a closed-wing drop before each glide', () => {
		const tucano = createAnimal('tucano-de-bico-verde', { seed: 6, perches: PERCHES });
		const sequence: string[] = [];
		let closedOutsideGlide = false;
		run(tucano, 240, 60, createAnimalWorld(), () => {
			const state = tucano.state;
			if (sequence[sequence.length - 1] !== state) sequence.push(state);
			const m = tucano.motion;
			if (m.wingsClosed > 0 && state !== 'glide') closedOutsideGlide = true;
			if (state === 'perch' || state === 'hop') {
				const b = tucano.behaviour;
				expect(Math.abs(b.offset)).toBeLessThanOrEqual(PERCHES[b.perch].halfLength + 1e-9);
			}
		});
		expect(closedOutsideGlide).toBe(false);
		expect(tucano.behaviour.flights).toBeGreaterThan(2);
		expect(tucano.behaviour.hops).toBeGreaterThan(2);
		// Every glide follows a flap burst.
		sequence.forEach((state, i) => {
			if (state === 'glide') expect(sequence[i - 1]).toBe('fly');
		});
		expect(TUCANO.beats[0]).toBeGreaterThanOrEqual(6);
	});
});

describe('robustness', () => {
	it('stays finite with bad frame times and bad world values, in every species', () => {
		for (const id of SPECIES_IDS) {
			const animal = make(id);
			const world = createAnimalWorld();
			for (const dt of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, 5, 1 / 60, 0.25]) {
				world.playerX = dt === 5 ? Number.NaN : 3;
				world.playerVx = dt === 0.25 ? Number.POSITIVE_INFINITY : Number.NaN;
				world.groundY = Number.NaN;
				for (let i = 0; i < 30; i++) animal.update(dt, world);
				expect(allFinite(animal.pose.data)).toBe(true);
				expect(Number.isFinite(animal.pose.scaleY) && Number.isFinite(animal.pose.scaleXZ)).toBe(true);
				const m = animal.motion;
				expect(allFinite([m.x, m.y, m.z, m.yaw])).toBe(true);
			}
			const sum = animal.animator.weights.reduce((a, b) => a + b, 0);
			expect(sum).toBeCloseTo(1, 9);
		}
	});
});
