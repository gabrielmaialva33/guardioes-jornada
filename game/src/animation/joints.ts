/**
 * The avatar's logical joints and the map from them to GLB node names.
 *
 * Names and pivots of game/src/assets/models/avatar.glb (Kenney Blocky
 * Characters 2.0 character-a without its clips, assets-report.md §1): the same
 * as Kenney's, with the head's 0.1 scale baked into its mesh. A different rig
 * only needs another RigConfig; bindRig keeps each node's own rest transform.
 *
 * Hierarchy and pivots, native units (2.7 tall, feet at 0, facing +z, left side +x):
 *   root (feet)
 *   ├─ leg-left  (0.2, 1, 0)    hip
 *   ├─ leg-right (-0.2, 1, 0)   hip
 *   └─ torso     (0, 0.7, 0)    waist, below the torso block
 *      ├─ arm-left  (0.4, 1.1, -0.1)   shoulder
 *      ├─ arm-right (-0.4, 1.1, -0.1)  shoulder
 *      └─ head      (0, 1.2, 0)        neck
 *
 * Rotation signs on that rig (the pose keys in avatar-poses.ts rely on them):
 * - x < 0 swings a limb forward and up, x > 0 back; x > 0 pitches the root,
 *   torso and head forward;
 * - y > 0 turns toward the character's left (+x);
 * - z > 0 raises the left arm or leg sideways and rolls centre joints to the
 *   character's right; the right side mirrors it (z < 0 raises the right arm).
 */
import { defineLayout } from './skeleton.ts';

export const AVATAR_JOINTS = ['root', 'torso', 'head', 'armL', 'armR', 'legL', 'legR'] as const;

export type AvatarJoint = (typeof AVATAR_JOINTS)[number];

export const AVATAR_LAYOUT = defineLayout(AVATAR_JOINTS, [
	['armL', 'armR'],
	['legL', 'legR']
]);

/** Where each logical joint lives in a loaded model. Works for any layout (animals too). */
export interface RigConfig<J extends string = string> {
	/**
	 * Node name per logical joint, as authored in the GLB. GLTFLoader's sanitized
	 * form (spaces to underscores) is also tried. A missing root falls back to the
	 * model itself; other missing joints are skipped.
	 */
	readonly nodes: Readonly<Record<J, string>>;
	/**
	 * Rig height in the model's own units; pose offsets are fractions of it.
	 * Measured from the model's bounds when omitted (Kenney: 2.7).
	 */
	readonly height?: number;
}

/** avatar.glb and every Kenney Blocky Characters 2.0 model (the 18 skins are textures). */
export const BLOCKY_RIG: RigConfig<AvatarJoint> = {
	height: 2.7,
	nodes: {
		root: 'root',
		torso: 'torso',
		head: 'head',
		armL: 'arm-left',
		armR: 'arm-right',
		legL: 'leg-left',
		legR: 'leg-right'
	}
};
