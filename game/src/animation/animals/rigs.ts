/**
 * Logical joints of the Cube Pets bases (Kenney Cube Pets 2.0, CC0) and where
 * they live in game/src/assets/models/{monkey,tiger,koala,parrot}.glb
 * (assets-report.md §2, re-read from the GLBs on 25/10/2026).
 *
 * Every base is a rigid node tree facing +z, left side +x, feet at y = 0:
 *   root
 *   ├─ body (0, 0.181, 0)            bottom centre of the body block; the head is part of this mesh
 *   │  ├─ tail                        monkey (0, 0.538, -0.525), tiger (0, 0.638, -0.548), parrot (0, 0.537, -0.495)
 *   │  ├─ wing-left / wing-right      parrot only, (0.625 | -0.525, 0.463, 0.031), wings rest spread sideways
 *   │  └─ Group                       parrot only: the crest (not animated; a toucan has none, see the report)
 *   └─ leg-front-left … leg-back-right   hips at (±0.25, 0.3, ±0.25); each leg is a 0.3 block hanging down
 * The parrot has only the two front legs, at z = 0. The koala has no tail.
 *
 * Both layouts share slots 0–3 (root, body, head, tail) and put the four limbs
 * in slots 4–7, so the animator handles them alike. `head` has no node in these
 * models: bindRig lists it in `missing` and the animator folds look-at into the
 * body. If the assets split a head node out of `body`, it is picked up by name.
 *
 * Rotation signs (same as the avatar's joints.ts): x < 0 swings a limb's tip
 * forward and pitches the body nose up; y > 0 turns left; z > 0 raises the left
 * wing or limb sideways.
 */
import type { RigConfig } from '../joints.ts';
import { defineLayout } from '../skeleton.ts';

export const QUADRUPED_JOINTS = ['root', 'body', 'head', 'tail', 'legFL', 'legFR', 'legBL', 'legBR'] as const;
export type QuadrupedJoint = (typeof QUADRUPED_JOINTS)[number];
export const QUADRUPED_LAYOUT = defineLayout(QUADRUPED_JOINTS, [
	['legFL', 'legFR'],
	['legBL', 'legBR']
]);

export const BIRD_JOINTS = ['root', 'body', 'head', 'tail', 'wingL', 'wingR', 'legL', 'legR'] as const;
export type BirdJoint = (typeof BIRD_JOINTS)[number];
export const BIRD_LAYOUT = defineLayout(BIRD_JOINTS, [
	['wingL', 'wingR'],
	['legL', 'legR']
]);

/** Joint count of both layouts. */
export const JOINT_COUNT = 8;

/** Shared slot indices. */
export const ROOT = 0;
export const BODY = 1;
export const HEAD = 2;
export const TAIL = 3;
/** Quadruped limbs (front left, front right, back left, back right); for birds 4–5 are wings, 6–7 legs. */
export const LIMB_FL = 4;
export const LIMB_FR = 5;
export const LIMB_BL = 6;
export const LIMB_BR = 7;

export type ModelId = 'monkey' | 'tiger' | 'koala' | 'parrot';

/** Native measures of each base in its own units, from the GLB node translations and mesh bounds. */
export interface ModelMeasures {
	/** Feet to the top of the body mesh (the rig height pose offsets are fractions of). */
	readonly height: number;
	/** Nose to rump along z, tail excluded. */
	readonly bodyLength: number;
	/** Nose to tail tip along z (birds are measured bill to tail). */
	readonly totalLength: number;
	/** Hip height and the hips' x and z (front, back); a leg hangs `legLength` below its hip. */
	readonly hipY: number;
	readonly hipX: number;
	readonly hipZFront: number;
	readonly hipZBack: number;
	readonly legLength: number;
	/** Body pivot height (bottom of the body block). */
	readonly bodyY: number;
	/** Tail pivot in root space, and the tail tip in the tail's own space. */
	readonly tailPivot: readonly [number, number, number];
	readonly tailTip: readonly [number, number, number];
	/** Centre of the body block in root space. */
	readonly bodyCentre: readonly [number, number, number];
}

const PET_HIPS = { hipY: 0.3, hipX: 0.25, legLength: 0.3, bodyY: 0.18125 } as const;
// The monkey and tiger tails share one mesh: bounds x ±0.1, y -0.155..0.891, z -0.555..0,
// a tail that curls up and back; its tip is near the top of that box.
const CURLED_TAIL_TIP = [0, 0.85, -0.4] as const;

export const MODELS: Readonly<Record<ModelId, ModelMeasures>> = {
	monkey: {
		...PET_HIPS,
		height: 1.594,
		bodyLength: 1.326,
		totalLength: 1.788,
		hipZFront: 0.25,
		hipZBack: -0.25,
		tailPivot: [0, 0.71875, -0.525],
		tailTip: CURLED_TAIL_TIP,
		bodyCentre: [0, 0.6, 0.04]
	},
	tiger: {
		...PET_HIPS,
		height: 1.543,
		bodyLength: 1.421,
		totalLength: 1.899,
		hipZFront: 0.25,
		hipZBack: -0.25,
		tailPivot: [0, 0.81875, -0.548],
		tailTip: CURLED_TAIL_TIP,
		bodyCentre: [0, 0.6, 0.09]
	},
	koala: {
		...PET_HIPS,
		height: 1.463,
		bodyLength: 1.389,
		totalLength: 1.389,
		hipZFront: 0.25,
		hipZBack: -0.25,
		tailPivot: [0, 0.4, -0.6],
		tailTip: [0, 0, 0],
		bodyCentre: [0, 0.6, 0.07]
	},
	parrot: {
		...PET_HIPS,
		height: 1.431,
		bodyLength: 1.433,
		// Bill tip to tail tip: the tail mesh reaches z -0.6 behind its pivot at -0.495.
		totalLength: 1.902,
		hipZFront: 0,
		hipZBack: 0,
		tailPivot: [0, 0.71875, -0.495],
		tailTip: [0, 0.8, -0.45],
		bodyCentre: [0, 0.62, 0.09]
	}
};

const QUADRUPED_NODES = {
	root: 'root',
	body: 'body',
	head: 'head',
	tail: 'tail',
	legFL: 'leg-front-left',
	legFR: 'leg-front-right',
	legBL: 'leg-back-left',
	legBR: 'leg-back-right'
} as const;

/** Joint maps per base; `height` is the native rig height pose offsets are fractions of. */
export const MODEL_RIGS: {
	readonly monkey: RigConfig<QuadrupedJoint>;
	readonly tiger: RigConfig<QuadrupedJoint>;
	readonly koala: RigConfig<QuadrupedJoint>;
	readonly parrot: RigConfig<BirdJoint>;
} = {
	monkey: { height: MODELS.monkey.height, nodes: QUADRUPED_NODES },
	tiger: { height: MODELS.tiger.height, nodes: QUADRUPED_NODES },
	koala: { height: MODELS.koala.height, nodes: QUADRUPED_NODES },
	parrot: {
		height: MODELS.parrot.height,
		nodes: {
			root: 'root',
			body: 'body',
			head: 'head',
			tail: 'tail',
			wingL: 'wing-left',
			wingR: 'wing-right',
			legL: 'leg-front-left',
			legR: 'leg-front-right'
		}
	}
};

export const isBird = (model: ModelId) => model === 'parrot';

export const layoutOf = (model: ModelId) => (isBird(model) ? BIRD_LAYOUT : QUADRUPED_LAYOUT);
