import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { applyToRig } from '../rig.ts';
import { AnimalAnimator } from './animal-animator.ts';
import { instance, pointOf } from './fixtures.test-helper.ts';
import { AnimalMotion } from './motion.ts';
import { MODELS } from './rigs.ts';
import { SPECIES, type SpeciesId } from './species.ts';

/** Drives the animator into a posture for `seconds` and applies it to the real node tree at the origin. */
function posed(species: SpeciesId, setup: (motion: AnimalMotion) => void, seconds = 1.5) {
	const params = SPECIES[species];
	const { holder, rig } = instance(species, params.model);
	const animator = new AnimalAnimator(species, { hasHead: rig.hasHead });
	const motion = new AnimalMotion();
	for (let t = 0; t < seconds; t += 1 / 60) {
		motion.beginUpdate();
		setup(motion);
		animator.update(1 / 60, motion);
	}
	applyToRig(animator.pose, rig.binding);
	holder.scale.setScalar(rig.scale);
	holder.updateMatrixWorld(true);
	return { holder, rig, animator };
}

const LEGS = ['leg-front-left', 'leg-front-right', 'leg-back-left', 'leg-back-right'];

describe('binding the real Cube Pets nodes', () => {
	it('finds every node but the head (and the koala tail), and stretches long limbs once', () => {
		for (const species of [
			'mico-leao-dourado',
			'muriqui',
			'onca-pintada',
			'tucano-de-bico-verde'
		] as SpeciesId[]) {
			const { rig } = instance(species, SPECIES[species].model);
			expect(rig.binding.missing).toEqual(['head']);
			expect(rig.hasHead).toBe(false);
		}
		const sloth = instance('preguica-de-coleira', 'koala');
		expect(sloth.rig.binding.missing).toEqual(['head', 'tail']);
		expect(sloth.scene.getObjectByName('leg-front-left')?.scale.y).toBeCloseTo(1.8, 9);
		expect(sloth.scene.getObjectByName('leg-back-left')?.scale.y).toBeCloseTo(1.4, 9);
		const muriqui = instance('muriqui', 'monkey');
		expect(muriqui.scene.getObjectByName('leg-front-right')?.scale.y).toBeCloseTo(2.2, 9);
	});

	it('scales each species to its ART.md size', () => {
		expect(SPECIES['onca-pintada'].scale * MODELS.tiger.bodyLength).toBeCloseTo(3, 9);
		expect(SPECIES['mico-leao-dourado'].scale * MODELS.monkey.bodyLength).toBeCloseTo(0.9, 9);
		expect(SPECIES['tucano-de-bico-verde'].scale * MODELS.parrot.totalLength).toBeCloseTo(0.9, 9);
	});
});

describe('where hands, feet and tails land', () => {
	it('standing quadrupeds keep all four feet on the ground', () => {
		for (const species of ['mico-leao-dourado', 'onca-pintada', 'bugio-ruivo'] as SpeciesId[]) {
			const { holder } = posed(species, (m) => {
				m.posture = 'stand';
			});
			for (const leg of LEGS) expect(Math.abs(pointOf(holder, leg).y)).toBeLessThan(0.02);
		}
	});

	it('a walking cat swings its legs in opposition and keeps its feet near the ground', () => {
		const { holder } = posed(
			'onca-pintada',
			(m) => {
				m.posture = 'stand';
				m.speed = 2.2;
				m.distance = 2.2 / 60;
			},
			1.3
		);
		const feet = LEGS.map((leg) => pointOf(holder, leg));
		for (const foot of feet) expect(foot.y).toBeGreaterThan(-0.05);
		expect(Math.max(...feet.map((f) => f.y))).toBeLessThan(0.25);
	});

	it('the brachiating muriqui grips its handhold at every swing angle, body below', () => {
		for (const [swing, grip] of [
			[0, 1],
			[0.7, 1],
			[-0.7, -1],
			[1.1, -1]
		]) {
			const { holder } = posed('muriqui', (m) => {
				m.posture = 'hang-arm';
				m.swing = swing;
				m.tilt = swing * 0.8;
				m.grip = grip;
			});
			const hand = pointOf(holder, grip > 0 ? 'leg-front-left' : 'leg-front-right');
			expect(hand.length()).toBeLessThan(0.02);
			expect(pointOf(holder, 'body', [0, 0.7, 0]).y).toBeLessThan(-0.2);
		}
	});

	it('the muriqui hanging by its tail has the tail tip on the branch and its head down', () => {
		const { holder } = posed('muriqui', (m) => {
			m.posture = 'hang-tail';
			m.feeding = true;
		});
		const tip = pointOf(holder, 'tail', MODELS.monkey.tailTip);
		expect(tip.length()).toBeLessThan(0.05);
		const head = pointOf(holder, 'body', [0, 0.7, 0.6]);
		const rump = pointOf(holder, 'body', [0, 0.7, -0.6]);
		expect(head.y).toBeLessThan(rump.y);
	});

	it('the sloth hangs below the branch with all four claws on it', () => {
		const { holder } = posed('preguica-de-coleira', (m) => {
			m.posture = 'hang-under';
		});
		for (const leg of LEGS) expect(Math.abs(pointOf(holder, leg).y)).toBeLessThan(0.03);
		expect(pointOf(holder, 'body', [0, 0.7, 0]).y).toBeLessThan(-0.5);
	});

	it('a sloth limb reaching ahead still hooks the branch where the behaviour put it', () => {
		const reach = 0.3;
		const { holder } = posed('preguica-de-coleira', (m) => {
			m.posture = 'hang-under';
			m.limbReach[0] = reach;
		});
		const foot = pointOf(holder, 'leg-front-left');
		const hip = pointOf(holder, 'leg-front-left', [0, 0, 0]);
		expect(Math.abs(foot.y)).toBeLessThan(0.05);
		expect(foot.z - hip.z).toBeGreaterThan(0.2 * reach * SPECIES['preguica-de-coleira'].scale);
	});

	it('the feeding howler keeps its hind feet where it stood and hangs below the branch', () => {
		const standing = posed('bugio-ruivo', (m) => {
			m.posture = 'stand';
		});
		const before = pointOf(standing.holder, 'leg-back-left');
		const { holder } = posed('bugio-ruivo', (m) => {
			m.posture = 'feed-hang';
			m.feeding = true;
		});
		expect(pointOf(holder, 'leg-back-left').distanceTo(before)).toBeLessThan(0.02);
		expect(pointOf(holder, 'body', [0, 0.7, 0]).y).toBeLessThan(0);
	});

	it('the toucan perches on its feet with wings folded, and spreads and beats them in flight', () => {
		const perched = posed('tucano-de-bico-verde', (m) => {
			m.posture = 'perch';
		});
		for (const leg of ['leg-front-left', 'leg-front-right'])
			expect(Math.abs(pointOf(perched.holder, leg).y)).toBeLessThan(0.02);
		const wingTip = (holder: ReturnType<typeof posed>['holder']) =>
			pointOf(holder, 'wing-left', [0.45, 0, 0]);
		const folded = wingTip(perched.holder);
		const shoulder = pointOf(perched.holder, 'wing-left', [0, 0, 0]);
		expect(folded.y).toBeLessThan(shoulder.y);
		const strokes = [0.25, 0.75].map((beat) =>
			wingTip(
				posed(
					'tucano-de-bico-verde',
					(m) => {
						m.posture = 'fly';
						m.flap = 1;
						m.flapRate = 6;
					},
					1 + beat / 6
				).holder
			)
		);
		expect(strokes[0].y - strokes[1].y).toBeGreaterThan(0.2);
	});

	it('a turned look rotates the body (no head node) within the species limit', () => {
		const { holder } = posed('mico-leao-dourado', (m) => {
			m.posture = 'stand';
			m.lookYaw = 2;
		});
		const nose = pointOf(holder, 'body', [0, 0.7, 0.7]).sub(pointOf(holder, 'body', [0, 0.7, 0]));
		const yaw = Math.atan2(nose.x, nose.z);
		const species = SPECIES['mico-leao-dourado'];
		expect(yaw).toBeGreaterThan(0.1);
		expect(yaw).toBeLessThanOrEqual(species.lookYaw * species.bodyLook + 1e-6);
		void Vector3;
	});
});
