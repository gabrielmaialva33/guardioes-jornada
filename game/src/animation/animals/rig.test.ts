import { Euler, type Object3D, Quaternion, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { AVATAR_HEIGHT } from '../../engine/constants.ts';
import { applyToRig } from '../rig.ts';
import { AnimalAnimator } from './animal-animator.ts';
import { instance, meshBounds, pointOf } from './fixtures.test-helper.ts';
import { AnimalMotion } from './motion.ts';
import { HEAD, MODELS, type ModelId } from './rigs.ts';
import { SPECIES, SPECIES_IDS, type SpeciesId } from './species.ts';

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
	it('finds every node, the head at the neck included (the koala has no tail), and stretches long limbs once', () => {
		for (const species of [
			'mico-leao-dourado',
			'muriqui',
			'onca-pintada',
			'tucano-de-bico-verde'
		] as SpeciesId[]) {
			const { rig } = instance(species, SPECIES[species].model);
			expect(rig.binding.missing).toEqual([]);
			expect(rig.hasHead).toBe(true);
			const head = rig.binding.nodes[HEAD];
			expect(head?.name).toBe('head');
			expect(head?.parent?.name).toBe('body');
			expect(head?.position.toArray()).toEqual([0, 0.625, 0.3125]);
		}
		const sloth = instance('preguica-de-coleira', 'koala');
		expect(sloth.rig.binding.missing).toEqual(['tail']);
		expect(sloth.rig.hasHead).toBe(true);
		expect(sloth.scene.getObjectByName('leg-front-left')?.scale.y).toBeCloseTo(
			SPECIES['preguica-de-coleira'].limbScale.front,
			9
		);
		expect(sloth.scene.getObjectByName('leg-back-left')?.scale.y).toBeCloseTo(
			SPECIES['preguica-de-coleira'].limbScale.hind,
			9
		);
		const muriqui = instance('muriqui', 'monkey');
		expect(muriqui.scene.getObjectByName('leg-front-right')?.scale.y).toBeCloseTo(
			SPECIES.muriqui.limbScale.front,
			9
		);
	});

	it('MODELS holds the measures of the meshes: head top, silhouette top and body length', async () => {
		const near = (got: number, want: number) => expect(Math.abs(got - want)).toBeLessThan(1e-3);
		for (const model of ['monkey', 'tiger', 'koala', 'parrot'] as ModelId[]) {
			const boxes = await meshBounds(model);
			const m = MODELS[model];
			const legs = Object.keys(boxes).filter((name) => name.startsWith('leg-'));
			near(Math.min(...legs.map((name) => boxes[name].min.y)), 0);
			// The rig height: feet to the top of the head node's mesh.
			near(boxes.head.max.y, m.height);
			// The scale reference: everything but the tail, which every posture swings down.
			const still = Object.keys(boxes).filter((name) => name !== 'tail');
			near(Math.max(...still.map((name) => boxes[name].max.y)), m.top);
			// Nose (bill) to rump: the head and body blocks, wings and crest aside.
			const torso = ['head', 'body', ...legs];
			near(
				Math.max(...torso.map((name) => boxes[name].max.z)) -
					Math.min(...torso.map((name) => boxes[name].min.z)),
				m.bodyLength
			);
		}
	});

	it('scales each species by its ART.md height, feet to the top of the head', () => {
		const heights: Record<SpeciesId, number> = {
			'mico-leao-dourado': 0.9,
			'bugio-ruivo': 1.4,
			muriqui: 1.7,
			'preguica-de-coleira': 1.4,
			'onca-pintada': 2.2,
			'tucano-de-bico-verde': 0.9
		};
		for (const id of SPECIES_IDS) {
			const species = SPECIES[id];
			const model = MODELS[species.model];
			expect(species.scale * model.top).toBeCloseTo(heights[id], 9);
			expect(species.length).toBeCloseTo(species.scale * model.bodyLength, 9);
			expect(species.eyeHeight).toBeCloseTo(species.scale * model.eyeY, 9);
		}
		// A jaguar stays well below the avatar's head (ART.md §3): the standing cat's head top, in the node tree.
		const { holder } = posed('onca-pintada', (m) => {
			m.posture = 'stand';
		});
		const node = (name: string) => holder.getObjectByName(name) as Object3D;
		const neck = node('body').position.y + node('head').position.y;
		const top = pointOf(holder, 'head', [0, MODELS.tiger.top - neck, 0]);
		expect(top.y).toBeCloseTo(2.2, 2);
		expect(top.y).toBeLessThan(0.75 * AVATAR_HEIGHT);
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

	it('a turned look splits between the body (bodyLook) and the head, up to the species limit', () => {
		for (const id of ['mico-leao-dourado', 'onca-pintada', 'bugio-ruivo'] as SpeciesId[]) {
			const species = SPECIES[id];
			const { holder } = posed(
				id,
				(m) => {
					m.posture = 'stand';
					m.lookYaw = 2;
				},
				3
			);
			const facing = (name: string) => {
				const ahead = pointOf(holder, name, [0, 0, 1]).sub(pointOf(holder, name, [0, 0, 0]));
				return Math.atan2(ahead.x, ahead.z);
			};
			expect(facing('body')).toBeCloseTo(species.lookYaw * species.bodyLook, 3);
			expect(facing('head')).toBeCloseTo(species.lookYaw, 3);
		}
	});

	it('a raised look pitches the body by its share and the head by the rest', () => {
		const species = SPECIES['onca-pintada'];
		const { holder } = posed(
			'onca-pintada',
			(m) => {
				m.posture = 'stand';
				m.lookPitch = 1;
			},
			3
		);
		const pitch = (name: string) => {
			const ahead = pointOf(holder, name, [0, 0, 1]).sub(pointOf(holder, name, [0, 0, 0]));
			return Math.atan2(ahead.y, ahead.z);
		};
		expect(pitch('body')).toBeCloseTo(species.lookPitch * species.bodyLook, 3);
		expect(pitch('head')).toBeCloseTo(species.lookPitch, 3);
	});

	it('the toucan cocks its head to look with one eye, by headTilt of the look', () => {
		const species = SPECIES['tucano-de-bico-verde'];
		const { holder } = posed(
			'tucano-de-bico-verde',
			(m) => {
				m.posture = 'perch';
				m.lookYaw = 2;
			},
			3
		);
		const head = holder.getObjectByName('head') as Object3D;
		const up = new Vector3(0, 1, 0).applyQuaternion(head.getWorldQuaternion(new Quaternion()));
		const ahead = pointOf(holder, 'head', [0, 0, 1]).sub(pointOf(holder, 'head', [0, 0, 0]));
		expect(Math.atan2(ahead.x, ahead.z)).toBeCloseTo(species.lookYaw, 3);
		expect(Math.acos(up.y)).toBeCloseTo(species.lookYaw * species.headTilt, 3);
	});

	it('without a head node, a look turns only the body, by its share', () => {
		const species = SPECIES['mico-leao-dourado'];
		const { holder, rig } = instance('mico-leao-dourado', 'monkey');
		const animator = new AnimalAnimator('mico-leao-dourado', { hasHead: false });
		const motion = new AnimalMotion();
		for (let t = 0; t < 3; t += 1 / 60) {
			motion.posture = 'stand';
			motion.lookYaw = 2;
			animator.update(1 / 60, motion);
		}
		applyToRig(animator.pose, rig.binding);
		holder.updateMatrixWorld(true);
		const ahead = pointOf(holder, 'head', [0, 0, 1]).sub(pointOf(holder, 'head', [0, 0, 0]));
		expect(Math.atan2(ahead.x, ahead.z)).toBeCloseTo(species.lookYaw * species.bodyLook, 3);
	});

	it('hanging by the tail, the head turns and the body share turns the animal about the tail tip', () => {
		const species = SPECIES.muriqui;
		const { holder } = posed(
			'muriqui',
			(m) => {
				m.posture = 'hang-tail';
				m.feeding = true;
				m.lookYaw = 0.8;
			},
			3
		);
		expect(pointOf(holder, 'tail', MODELS.monkey.tailTip).length()).toBeLessThan(0.05);
		const relative = (holder.getObjectByName('body') as Object3D)
			.getWorldQuaternion(new Quaternion())
			.invert()
			.multiply((holder.getObjectByName('head') as Object3D).getWorldQuaternion(new Quaternion()));
		expect(new Euler().setFromQuaternion(relative, 'YXZ').y).toBeCloseTo(0.8 * (1 - species.bodyLook), 3);
	});

	it('the howling bugio pumps its head, not its body', () => {
		const at = (seconds: number) => {
			const { holder } = posed(
				'bugio-ruivo',
				(m) => {
					m.posture = 'howl';
					m.howl = 1;
				},
				seconds
			);
			const quaternion = (name: string) =>
				(holder.getObjectByName(name) as Object3D).getWorldQuaternion(new Quaternion());
			return { body: quaternion('body'), head: quaternion('head') };
		};
		// Half a breath group apart (howlRate 1.4/s).
		const a = at(2);
		const b = at(2 + 0.5 / 1.4);
		expect(a.body.angleTo(b.body)).toBeLessThan(1e-6);
		expect(a.head.angleTo(b.head)).toBeGreaterThan(3 * (Math.PI / 180));
	});
});
