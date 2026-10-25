import { BoxGeometry, Group, Mesh, Object3D, Quaternion, Vector3 } from 'three';
import { expect, it } from 'vitest';
import { AvatarAnimator, createAvatarInput } from './avatar-animator.ts';
import { JUMP, WALK } from './avatar-poses.ts';
import { AVATAR_LAYOUT, BLOCKY_RIG } from './joints.ts';
import { applyToRig, bindRig, restoreRig } from './rig.ts';
import { JOINT_STRIDE, Pose } from './skeleton.ts';
import { Playhead } from './track.ts';

/** The Kenney Blocky Characters 2.0 hierarchy and pivots, read from character-a.glb. */
function blocky(names: Partial<Record<string, string>> = {}) {
	const model = new Group();
	model.name = 'character-a';
	const node = (name: string, parent: Object3D, x: number, y: number, z: number) => {
		const object = new Object3D();
		object.name = names[name] ?? name;
		object.position.set(x, y, z);
		parent.add(object);
		return object;
	};
	const root = node('root', model, 0, 0, 0);
	node('leg-left', root, 0.2, 1, 0);
	node('leg-right', root, -0.2, 1, 0);
	const torso = node('torso', root, 0, 0.7, 0);
	node('arm-left', torso, 0.4, 1.1, -0.1);
	node('arm-right', torso, -0.4, 1.1, -0.1);
	node('head', torso, 0, 1.2, 0).scale.setScalar(0.1);
	return model;
}

const posed = (track: typeof WALK, time: number) => {
	const pose = new Pose(AVATAR_LAYOUT.joints.length);
	track.sampleInto(pose.data, new Playhead(time));
	return pose;
};

/** World position of a point one unit down a limb (its hand or foot). */
const tip = (model: Object3D, name: string) => {
	model.updateMatrixWorld(true);
	return model.getObjectByName(name)?.localToWorld(new Vector3(0, -1, 0)) ?? new Vector3();
};

it('binds every Kenney node by name', () => {
	const model = blocky();
	const rig = bindRig(model, AVATAR_LAYOUT, { ...BLOCKY_RIG, height: 2.7 });
	expect(rig.missing).toEqual([]);
	expect(rig.nodes.map((node) => node?.name)).toEqual(Object.values(BLOCKY_RIG.nodes));
});

it('swings limbs the way the key poses expect on the Kenney rig', () => {
	const model = blocky();
	const rig = bindRig(model, AVATAR_LAYOUT, BLOCKY_RIG);
	applyToRig(posed(WALK, 0), rig);
	expect(tip(model, 'leg-left').z).toBeGreaterThan(0.3);
	expect(tip(model, 'leg-right').z).toBeLessThan(-0.3);
	expect(tip(model, 'arm-left').z).toBeLessThan(-0.3);
	expect(tip(model, 'arm-right').z).toBeGreaterThan(0.3);

	applyToRig(posed(JUMP, 0), rig);
	const shoulder = 0.7 + 1.1;
	for (const arm of ['arm-left', 'arm-right']) expect(tip(model, arm).y).toBeGreaterThan(shoulder + 0.85);
	expect(tip(model, 'arm-left').x).toBeGreaterThan(0.4);
	expect(tip(model, 'arm-right').x).toBeLessThan(-0.4);
});

it('composes the pose over the rest transform and scales offsets by the rig height', () => {
	const model = blocky();
	const restTurn = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2);
	model.getObjectByName('torso')?.quaternion.copy(restTurn);
	const rig = bindRig(model, AVATAR_LAYOUT, { ...BLOCKY_RIG, height: 2.7 });
	const pose = new Pose(AVATAR_LAYOUT.joints.length);
	const torso = AVATAR_LAYOUT.index.torso * JOINT_STRIDE;
	pose.data[torso] = 0.5;
	pose.data[4] = 0.1;
	pose.scaleY = 0.9;
	pose.scaleXZ = 1 / Math.sqrt(0.9);
	applyToRig(pose, rig);

	const expected = restTurn.clone().multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), 0.5));
	expect(model.getObjectByName('torso')?.quaternion.angleTo(expected)).toBeCloseTo(0, 6);
	const root = model.getObjectByName('root');
	expect(root?.position.y).toBeCloseTo(0.27, 12);
	expect(root?.scale.y).toBeCloseTo(0.9, 12);
	expect(model.getObjectByName('head')?.scale.x).toBe(0.1);

	restoreRig(rig);
	expect(root?.position.y).toBe(0);
	expect(root?.scale.y).toBe(1);
	expect(model.getObjectByName('torso')?.quaternion.angleTo(restTurn)).toBeCloseTo(0, 6);
});

it('finds sanitized names, skips missing joints and falls back to the model for the root', () => {
	const model = blocky({ 'arm-left': 'arm_left', root: 'hips', head: 'hat' });
	const rig = bindRig(model, AVATAR_LAYOUT, {
		nodes: { ...BLOCKY_RIG.nodes, armL: 'arm left' },
		height: 2.7
	});
	expect(rig.missing).toEqual(['root', 'head']);
	expect(rig.nodes[0]).toBe(model);
	expect(rig.nodes[AVATAR_LAYOUT.index.armL]?.name).toBe('arm_left');
	expect(rig.nodes[AVATAR_LAYOUT.index.head]).toBe(null);
	expect(() => applyToRig(posed(WALK, 0.25), rig)).not.toThrow();
});

it('measures the rig height in model units when the config omits it', () => {
	const model = new Group();
	model.scale.setScalar(3 / 2.7);
	const body = new Mesh(new BoxGeometry(0.8, 2.7, 0.6));
	body.position.y = 1.35;
	model.add(body);
	expect(bindRig(model, AVATAR_LAYOUT, BLOCKY_RIG).height).toBeCloseTo(2.7, 6);
});

it('drives a bound rig from the animator', () => {
	const model = blocky();
	const rig = bindRig(model, AVATAR_LAYOUT, BLOCKY_RIG);
	const animator = new AvatarAnimator();
	const input = createAvatarInput();
	input.speed = 9.6;
	for (let i = 0; i < 25; i++) applyToRig(animator.update(1 / 60, input), rig);
	const legs = ['leg-left', 'leg-right'].map((name) => model.getObjectByName(name)?.quaternion.x ?? 0);
	expect(Math.abs(legs[0] - legs[1])).toBeGreaterThan(0.1);
});
