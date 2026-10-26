/**
 * Logical joints of the Cube Pets bases (Kenney Cube Pets 2.0, CC0) and where
 * they live in game/src/assets/models/{monkey,tiger,koala,parrot}.glb
 * (assets-report.md §2; re-measured from the GLBs on 25/10/2026 after the head
 * split of commit d165b4a, see ModelMeasures).
 *
 * Every base is a rigid node tree facing +z, left side +x, feet at y = 0:
 *   root
 *   ├─ body (0, 0.181, 0)            bottom centre of the body block
 *   │  ├─ head (0, 0.625, 0.3125)    neck pivot on the block's front face; the face, ears, muzzle or bill
 *   │  ├─ tail                        monkey (0, 0.538, -0.525), tiger (0, 0.638, -0.548), parrot (0, 0.537, -0.495)
 *   │  └─ wing-left / wing-right      parrot only, (0.625 | -0.525, 0.463, 0.031), wings rest spread sideways
 *   └─ leg-front-left … leg-back-right   hips at (±0.25, 0.3, ±0.25); each leg is a 0.3 block hanging down
 * The parrot has only the two front legs, at z = 0. The koala has no tail.
 *
 * Both layouts share slots 0–3 (root, body, head, tail) and put the four limbs
 * in slots 4–7, so the animator handles them alike. The head is picked up by
 * name: an asset without one gets `head` in bindRig's `missing`, and the
 * animator then folds the head's share of a look into the body.
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

/** The four original Cube Pets bases, then the P23 species models (game/scripts/blender/models/bichos_mata.py). */
export const MODEL_IDS = [
	'monkey',
	'tiger',
	'koala',
	'parrot',
	'capivara',
	'anta',
	'cateto',
	'veado',
	'cachorro-do-mato',
	'onca-parda',
	'tapiti',
	'jaguatirica',
	'caranguejo',
	'tatu',
	'jabuti',
	'sapo',
	'passaro',
	'jacutinga',
	'colhereiro'
] as const;

export type ModelId = (typeof MODEL_IDS)[number];

/** Bird models (wings in slots 4–5, legs in 6–7). */
export const BIRD_MODELS: readonly ModelId[] = ['parrot', 'passaro', 'jacutinga', 'colhereiro'];

/**
 * Native measures of each base in its own units, from the GLB node translations
 * and mesh bounds. Measured on 25/10/2026 with three's GLTFLoader and
 * MeshoptDecoder in Node over every vertex in root space, rest pose
 * (~/.cache/agents/2026-10-25-trilha-secreta/p3-height/measure-glb.mjs).
 */
export interface ModelMeasures {
	/**
	 * Feet to the top of the head mesh: the rig height pose offsets are fractions
	 * of. The head split left these unchanged (the head was the top of the old
	 * one-piece body mesh).
	 */
	readonly height: number;
	/**
	 * Feet to the top of the silhouette in every posture, the reference species
	 * are scaled by (ART.md §3: by height, never by length). It is the head top
	 * (the toucan has no crest; the asset pipeline removes the parrot's). Tails are left out: the rest mesh curls them
	 * up (monkey to 1.61, tiger to 1.71), but every posture swings them down.
	 */
	readonly top: number;
	/** Height of the eyes (centre of the eye decals on the face). */
	readonly eyeY: number;
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
		top: 1.594,
		eyeY: 0.894,
		bodyLength: 1.326,
		totalLength: 1.781,
		hipZFront: 0.25,
		hipZBack: -0.25,
		tailPivot: [0, 0.71875, -0.525],
		tailTip: CURLED_TAIL_TIP,
		bodyCentre: [0, 0.6, 0.04]
	},
	tiger: {
		...PET_HIPS,
		height: 1.543,
		top: 1.543,
		eyeY: 0.984,
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
		top: 1.463,
		eyeY: 0.904,
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
		// The head and body blocks top out at 1.431 (the crest is removed in the asset pipeline).
		height: 1.431,
		top: 1.431,
		eyeY: 0.894,
		bodyLength: 1.433,
		// Bill tip to tail tip: the tail mesh reaches z -0.6 behind its pivot at -0.495.
		totalLength: 1.902,
		hipZFront: 0,
		hipZBack: 0,
		tailPivot: [0, 0.71875, -0.495],
		tailTip: [0, 0.8, -0.45],
		bodyCentre: [0, 0.62, 0.09]
	},
	// P23 models, measured the same way from the packed GLBs on 26/10/2026 (head pivot at the
	// neck; models without a tail get a pivot behind the rump and a zero tip, as the koala).
	/** Beaver reshaped: no tail, a deep blunt square muzzle, tiny ears, body 1.25x longer behind. */
	capivara: {
		...PET_HIPS,
		height: 1.53,
		top: 1.53,
		eyeY: 0.922,
		bodyLength: 1.711,
		totalLength: 1.711,
		hipY: 0.3,
		hipX: 0.25,
		hipZFront: 0.25,
		hipZBack: -0.34,
		legLength: 0.3,
		bodyY: 0.181,
		tailPivot: [0, 0.401, -0.69],
		tailTip: [0, 0, 0],
		bodyCentre: [0, 0.806, -0.234]
	},
	/** Pig reshaped: body 1.5x longer behind, the forward trunk, small rimmed ears (the top), the nape crest. */
	anta: {
		...PET_HIPS,
		height: 1.545,
		top: 1.545,
		eyeY: 0.922,
		bodyLength: 2.088,
		totalLength: 2.088,
		hipY: 0.3,
		hipX: 0.25,
		hipZFront: 0.25,
		hipZBack: -0.42,
		legLength: 0.3,
		bodyY: 0.181,
		tailPivot: [0, 0.401, -0.77],
		tailTip: [0, 0, 0],
		bodyCentre: [0, 0.826, -0.339]
	},
	/** Hog without tusks and back ridges; the top is the dorsal crest. */
	cateto: {
		...PET_HIPS,
		height: 1.516,
		top: 1.55,
		eyeY: 0.922,
		bodyLength: 1.46,
		totalLength: 1.46,
		hipY: 0.3,
		hipX: 0.25,
		hipZFront: 0.25,
		hipZBack: -0.25,
		legLength: 0.3,
		bodyY: 0.181,
		tailPivot: [0, 0.401, -0.6],
		tailTip: [0, 0, 0],
		bodyCentre: [0, 0.866, -0.156]
	},
	/** Deer with spike antlers instead of branched ones (the top is a spike tip). */
	veado: {
		...PET_HIPS,
		height: 1.653,
		top: 1.653,
		eyeY: 0.922,
		bodyLength: 1.635,
		totalLength: 1.635,
		hipY: 0.3,
		hipX: 0.25,
		hipZFront: 0.25,
		hipZBack: -0.25,
		legLength: 0.3,
		bodyY: 0.181,
		tailPivot: [0, 0.401, -0.6],
		tailTip: [0, 0, 0],
		bodyCentre: [0, 0.806, -0.194]
	},
	/** Fox recoloured: the ears are the top. */
	'cachorro-do-mato': {
		...PET_HIPS,
		height: 1.686,
		top: 1.686,
		eyeY: 0.922,
		bodyLength: 1.56,
		totalLength: 2.308,
		hipY: 0.3,
		hipX: 0.25,
		hipZFront: 0.25,
		hipZBack: -0.25,
		legLength: 0.3,
		bodyY: 0.181,
		tailPivot: [0, 0.719, -0.495],
		tailTip: [0, 0.393, -0.879],
		bodyCentre: [0, 0.902, -0.156]
	},
	/** Lion without the mane, body 1.2x longer behind. */
	'onca-parda': {
		...PET_HIPS,
		height: 1.503,
		top: 1.503,
		eyeY: 0.972,
		bodyLength: 1.546,
		totalLength: 2.009,
		hipY: 0.3,
		hipX: 0.25,
		hipZFront: 0.25,
		hipZBack: -0.3,
		legLength: 0.3,
		bodyY: 0.181,
		tailPivot: [0, 0.819, -0.658],
		tailTip: [0.07, 0.927, -0.295],
		bodyCentre: [0, 0.806, -0.219]
	},
	/** Bunny with ears shortened to 62%; the top is the ear tips. */
	tapiti: {
		...PET_HIPS,
		height: 1.672,
		top: 1.672,
		eyeY: 0.922,
		bodyLength: 1.395,
		totalLength: 1.395,
		hipY: 0.3,
		hipX: 0.25,
		hipZFront: 0.25,
		hipZBack: -0.25,
		legLength: 0.3,
		bodyY: 0.181,
		tailPivot: [0, 0.401, -0.6],
		tailTip: [0, 0, 0],
		bodyCentre: [0, 0.908, -0.189]
	},
	/** Cat with flat rosette patches. */
	jaguatirica: {
		...PET_HIPS,
		height: 1.586,
		top: 1.586,
		eyeY: 0.861,
		bodyLength: 1.327,
		totalLength: 1.806,
		hipY: 0.3,
		hipX: 0.25,
		hipZFront: 0.25,
		hipZBack: -0.25,
		legLength: 0.3,
		bodyY: 0.181,
		tailPivot: [0, 0.819, -0.548],
		tailTip: [-0.05, 0.855, -0.414],
		bodyCentre: [0, 0.857, -0.156]
	},
	/** Crab with four more static walking legs; width 2.34 with the claws. */
	caranguejo: {
		...PET_HIPS,
		height: 1.431,
		top: 1.431,
		eyeY: 0.922,
		bodyLength: 1.347,
		totalLength: 1.347,
		hipY: 0.3,
		hipX: 0.25,
		hipZFront: 0.25,
		hipZBack: -0.25,
		legLength: 0.3,
		bodyY: 0.181,
		tailPivot: [0, 0.401, -0.6],
		tailTip: [0, 0, 0],
		bodyCentre: [0, 0.739, -0.181]
	},
	/** Custom (bichos_mata.py): low, long; the top is the shell. */
	tatu: {
		...PET_HIPS,
		height: 0.886,
		top: 0.9,
		eyeY: 0.6,
		bodyLength: 2.4,
		totalLength: 3.275,
		hipY: 0.24,
		hipX: 0.26,
		hipZFront: 0.3,
		hipZBack: -0.36,
		legLength: 0.24,
		bodyY: 0.181,
		tailPivot: [0, 0.52, -1.08],
		tailTip: [0.025, -0.291, -0.888],
		bodyCentre: [0, 0.55, -0.22]
	},
	/** Custom: the top is the shell; the head node (rig height) is low in front. */
	jabuti: {
		...PET_HIPS,
		height: 0.62,
		top: 0.964,
		eyeY: 0.48,
		bodyLength: 2.03,
		totalLength: 2.03,
		hipY: 0.26,
		hipX: 0.42,
		hipZFront: 0.4,
		hipZBack: -0.4,
		legLength: 0.26,
		bodyY: 0.181,
		tailPivot: [0, 0.401, -0.75],
		tailTip: [0, 0, 0],
		bodyCentre: [0, 0.562, -0.06]
	},
	/** Custom: squat; the top is the parotoid glands. */
	sapo: {
		...PET_HIPS,
		height: 0.74,
		top: 0.78,
		eyeY: 0.52,
		bodyLength: 1.31,
		totalLength: 1.31,
		hipY: 0.3,
		hipX: 0.3,
		hipZFront: 0.3,
		hipZBack: -0.26,
		legLength: 0.3,
		bodyY: 0.181,
		tailPivot: [0, 0.401, -0.61],
		tailTip: [0, 0, 0],
		bodyCentre: [0, 0.46, -0.11]
	},
	/** Chick without its head tufts, with a tail: the saíra and the sabiá. */
	passaro: {
		...PET_HIPS,
		height: 1.431,
		top: 1.431,
		eyeY: 0.894,
		bodyLength: 1.35,
		totalLength: 1.835,
		hipY: 0.3,
		hipX: 0.25,
		hipZFront: 0,
		hipZBack: 0,
		legLength: 0.3,
		bodyY: 0.181,
		tailPivot: [0, 0.72, -0.5],
		tailTip: [-0.173, 0.182, -0.594],
		bodyCentre: [0, 0.806, -0.156]
	},
	/** Parrot with a cracid bill and dewlap; the top is the (white) crest. */
	jacutinga: {
		...PET_HIPS,
		height: 1.572,
		top: 1.681,
		eyeY: 0.894,
		bodyLength: 1.565,
		totalLength: 2.034,
		hipY: 0.3,
		hipX: 0.25,
		hipZFront: 0,
		hipZBack: 0,
		legLength: 0.3,
		bodyY: 0.181,
		tailPivot: [0, 0.719, -0.495],
		tailTip: [0, 0.737, -0.599],
		bodyCentre: [0, 0.931, -0.156]
	},
	/** Parrot with 3x longer, thinner legs (hips at 0.9) and the flat spoon bill: the colhereiro. */
	colhereiro: {
		...PET_HIPS,
		height: 2.031,
		top: 2.031,
		eyeY: 1.494,
		bodyLength: 2.071,
		totalLength: 2.54,
		hipY: 0.9,
		hipX: 0.25,
		hipZFront: 0,
		hipZBack: 0,
		legLength: 0.9,
		bodyY: 0.781,
		tailPivot: [0, 1.319, -0.495],
		tailTip: [0, 0.737, -0.599],
		bodyCentre: [0, 1.406, -0.156]
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

const quadrupedRig = (model: ModelId): RigConfig<QuadrupedJoint> => ({
	height: MODELS[model].height,
	nodes: QUADRUPED_NODES
});

const BIRD_NODES = {
	root: 'root',
	body: 'body',
	head: 'head',
	tail: 'tail',
	wingL: 'wing-left',
	wingR: 'wing-right',
	legL: 'leg-front-left',
	legR: 'leg-front-right'
} as const;

const birdRig = (model: ModelId): RigConfig<BirdJoint> => ({
	height: MODELS[model].height,
	nodes: BIRD_NODES
});

/** Joint maps per base; `height` is the native rig height pose offsets are fractions of. */
export const MODEL_RIGS: Readonly<Record<ModelId, RigConfig<QuadrupedJoint> | RigConfig<BirdJoint>>> & {
	readonly monkey: RigConfig<QuadrupedJoint>;
	readonly parrot: RigConfig<BirdJoint>;
} = {
	monkey: quadrupedRig('monkey'),
	tiger: quadrupedRig('tiger'),
	koala: quadrupedRig('koala'),
	parrot: birdRig('parrot'),
	capivara: quadrupedRig('capivara'),
	anta: quadrupedRig('anta'),
	cateto: quadrupedRig('cateto'),
	veado: quadrupedRig('veado'),
	'cachorro-do-mato': quadrupedRig('cachorro-do-mato'),
	'onca-parda': quadrupedRig('onca-parda'),
	tapiti: quadrupedRig('tapiti'),
	jaguatirica: quadrupedRig('jaguatirica'),
	caranguejo: quadrupedRig('caranguejo'),
	tatu: quadrupedRig('tatu'),
	jabuti: quadrupedRig('jabuti'),
	sapo: quadrupedRig('sapo'),
	passaro: birdRig('passaro'),
	jacutinga: birdRig('jacutinga'),
	colhereiro: birdRig('colhereiro')
};

export const isBird = (model: ModelId) => BIRD_MODELS.includes(model);

export const layoutOf = (model: ModelId) => (isBird(model) ? BIRD_LAYOUT : QUADRUPED_LAYOUT);
