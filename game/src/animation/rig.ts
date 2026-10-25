/**
 * The only three.js part of the animation module: finds a rig's nodes once and
 * writes poses into them. Each joint ends at its rest transform composed with
 * the pose (rest rotation × pose rotation, rest position + offset × height), so
 * the GLB keeps its own pivots. Bones are Object3Ds too, so a rigid SkinnedMesh
 * with the same names works unchanged.
 */
import { Box3, Euler, type Object3D, PropertyBinding, Quaternion, Vector3 } from 'three';
import type { RigConfig } from './joints.ts';
import { JOINT_STRIDE, type Layout, type Pose } from './skeleton.ts';

export interface RigBinding {
	/** Node per logical joint, in layout order; null when the model lacks it. */
	readonly nodes: readonly (Object3D | null)[];
	readonly restPositions: readonly Vector3[];
	readonly restQuaternions: readonly Quaternion[];
	readonly restScales: readonly Vector3[];
	/** Rig height in model units: pose offsets are multiplied by it. */
	readonly height: number;
	/** Logical joints whose node was not found. */
	readonly missing: readonly string[];
}

const euler = new Euler(0, 0, 0, 'YXZ');
const rotation = new Quaternion();

/**
 * Resolves the joint map on a loaded model and records the rest transforms.
 * Call once per model (load time: it allocates), before any pose is applied.
 */
export function bindRig<J extends string>(
	model: Object3D,
	layout: Layout<J>,
	config: RigConfig<J>
): RigBinding {
	const missing: string[] = [];
	const nodes = layout.joints.map((joint, i) => {
		const name = config.nodes[joint];
		const node = model.getObjectByName(name) ?? model.getObjectByName(PropertyBinding.sanitizeNodeName(name));
		if (node) return node;
		missing.push(joint);
		// Joint 0 is the root: without a node of its own the model itself takes bob, bank and squash.
		return i === 0 ? model : null;
	});
	return {
		nodes,
		restPositions: nodes.map((node) => (node ? node.position.clone() : new Vector3())),
		restQuaternions: nodes.map((node) => (node ? node.quaternion.clone() : new Quaternion())),
		restScales: nodes.map((node) => (node ? node.scale.clone() : new Vector3(1, 1, 1))),
		height: config.height ?? measureHeight(model),
		missing
	};
}

/** Writes a pose into the bound nodes. No allocation. */
export function applyToRig(pose: Pose, rig: RigBinding) {
	const data = pose.data;
	const height = rig.height;
	const count = Math.min(pose.jointCount, rig.nodes.length);
	for (let joint = 0; joint < count; joint++) {
		const node = rig.nodes[joint];
		if (node === null) continue;
		const at = joint * JOINT_STRIDE;
		euler.set(data[at], data[at + 1], data[at + 2], 'YXZ');
		node.quaternion.multiplyQuaternions(rig.restQuaternions[joint], rotation.setFromEuler(euler));
		const rest = rig.restPositions[joint];
		node.position.set(
			rest.x + data[at + 3] * height,
			rest.y + data[at + 4] * height,
			rest.z + data[at + 5] * height
		);
	}
	const root = rig.nodes[0];
	if (root) {
		const rest = rig.restScales[0];
		root.scale.set(rest.x * pose.scaleXZ, rest.y * pose.scaleY, rest.z * pose.scaleXZ);
	}
}

/** Puts every bound node back at rest (before rebinding, or for a static preview). */
export function restoreRig(rig: RigBinding) {
	rig.nodes.forEach((node, joint) => {
		if (!node) return;
		node.position.copy(rig.restPositions[joint]);
		node.quaternion.copy(rig.restQuaternions[joint]);
		node.scale.copy(rig.restScales[joint]);
	});
}

/** Height of the model's bounds in its own units (its world scale divided out). */
function measureHeight(model: Object3D): number {
	model.updateWorldMatrix(true, true);
	const box = new Box3().setFromObject(model);
	const scale = model.getWorldScale(new Vector3()).y;
	const height = (box.max.y - box.min.y) / (scale || 1);
	return Number.isFinite(height) && height > 0 ? height : 1;
}
