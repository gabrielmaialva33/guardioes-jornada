/**
 * Joint layouts and poses for rigid node rigs: one Object3D per body part, no
 * skinning, like the Kenney Blocky Characters (R6-style) and Cube Pets. The
 * avatar uses it now; animals can reuse it with their own layout and keys.
 *
 * A pose stores six numbers per joint, relative to the node's rest transform:
 * - an Euler rotation in radians, YXZ order (yaw, then pitch, then roll), so a
 *   turned head never tilts sideways when it also looks up;
 * - a position offset as a fraction of the rig height, so the same keys fit the
 *   GLB at its native size or rescaled to the 3-unit avatar.
 *
 * Poses blend as weighted sums of those numbers. That is exact enough here
 * because every rigid R6 joint swings mostly about one axis and the keys never
 * cross ±180°, and it needs no quaternion sign fixes or normalization.
 *
 * Joint 0 is always the root: the body pivot at the feet, which also takes the
 * squash-and-stretch scale.
 */

/** Numbers per joint: rotation x, y, z, then offset x, y, z. */
export const JOINT_STRIDE = 6;

const DEG = Math.PI / 180;

export interface Layout<J extends string = string> {
	readonly joints: readonly J[];
	readonly index: Readonly<Record<J, number>>;
	/** Joint index on the other side of the body; centre joints map to themselves. */
	readonly mirror: Uint8Array;
}

/** Declares a rig's logical joints (root first) and its left/right pairs. */
export function defineLayout<const J extends string>(
	joints: readonly J[],
	pairs: readonly (readonly [J, J])[] = []
): Layout<J> {
	const index = {} as Record<J, number>;
	joints.forEach((joint, i) => {
		index[joint] = i;
	});
	const mirror = Uint8Array.from(joints, (_, i) => i);
	for (const [a, b] of pairs) {
		mirror[index[a]] = index[b];
		mirror[index[b]] = index[a];
	}
	return { joints, index, mirror };
}

/** The evaluated pose of a whole rig; reused every frame. */
export class Pose {
	readonly jointCount: number;
	/** jointCount × JOINT_STRIDE numbers, see the module comment. */
	readonly data: Float64Array;
	/** Root scale for squash and stretch, applied as (scaleXZ, scaleY, scaleXZ). */
	scaleY = 1;
	scaleXZ = 1;

	constructor(jointCount: number) {
		this.jointCount = jointCount;
		this.data = new Float64Array(jointCount * JOINT_STRIDE);
	}

	/** Back to the rest pose. */
	reset(): this {
		this.data.fill(0);
		this.scaleY = this.scaleXZ = 1;
		return this;
	}

	copy(other: Pose): this {
		this.data.set(other.data);
		this.scaleY = other.scaleY;
		this.scaleXZ = other.scaleXZ;
		return this;
	}
}

export type Vec3Tuple = readonly [number, number, number];

/** One joint in an authored key pose; omitted joints stay at rest. */
export interface JointKey {
	/** Rotation in degrees, YXZ order. */
	r?: Vec3Tuple;
	/** Offset as a fraction of the rig height. */
	p?: Vec3Tuple;
}

export type KeyPose<J extends string> = Partial<Record<J, JointKey>>;

/** Turns an authored key (degrees, per joint name) into packed pose numbers. Load time only. */
export function compileKey<J extends string>(layout: Layout<J>, key: KeyPose<J>): Float64Array {
	const out = new Float64Array(layout.joints.length * JOINT_STRIDE);
	for (const joint of layout.joints) {
		const value = key[joint];
		if (!value) continue;
		const at = layout.index[joint] * JOINT_STRIDE;
		if (value.r) for (let i = 0; i < 3; i++) out[at + i] = value.r[i] * DEG;
		if (value.p) for (let i = 0; i < 3; i++) out[at + 3 + i] = value.p[i];
	}
	return out;
}

/**
 * The same pose for the other side of the body: left and right joints swap, and
 * yaw, roll and sideways offset change sign. Load time only.
 */
export function mirrorKey(layout: Layout, key: Float64Array): Float64Array {
	const out = new Float64Array(key.length);
	for (let joint = 0; joint < layout.joints.length; joint++) {
		const from = joint * JOINT_STRIDE;
		const to = layout.mirror[joint] * JOINT_STRIDE;
		out[to] = key[from];
		out[to + 1] = -key[from + 1];
		out[to + 2] = -key[from + 2];
		out[to + 3] = -key[from + 3];
		out[to + 4] = key[from + 4];
		out[to + 5] = key[from + 5];
	}
	return out;
}
