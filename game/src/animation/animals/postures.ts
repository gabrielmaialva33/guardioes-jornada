/**
 * Static key poses per species, on the shared 8-slot layouts (rigs.ts).
 *
 * Each posture has a key (rotations in degrees; offsets in model units, turned
 * into fractions of the rig height here) and a root pivot and anchor. The root
 * offset is never stored in the key: the animator computes it so the pivot (a
 * point of the model, such as the feet, the gripping hand or the tail tip) lands
 * on the anchor (a point of the placed group, such as the branch) after the
 * root rotation. Crossfading two postures that share a pivot therefore rotates
 * the body about it instead of sliding through the support.
 *
 * Dynamic postures (brachiation, sloth limbs, wingbeats) start from these keys
 * and are adjusted every update by the animator.
 */
import { compileKey, JOINT_STRIDE, type JointKey, type Layout, type Vec3Tuple } from '../skeleton.ts';
import { BIRD_LAYOUT, JOINT_COUNT, MODELS, type ModelId, QUADRUPED_LAYOUT } from './rigs.ts';
import { SPECIES, type SpeciesId } from './species.ts';

export const POSTURES = [
	'stand',
	'sit',
	'lie',
	'hang-arm',
	'hang-tail',
	'feed-hang',
	'hang-under',
	'hang-curl',
	'howl',
	'perch',
	'fly',
	'roost'
] as const;

export type Posture = (typeof POSTURES)[number];

export const POSTURE_COUNT = POSTURES.length;

export const POSTURE_INDEX = Object.fromEntries(POSTURES.map((posture, i) => [posture, i])) as Readonly<
	Record<Posture, number>
>;

/** Postures in which the animal hangs below its support. */
export const SUSPENDED: readonly Posture[] = [
	'hang-arm',
	'hang-tail',
	'feed-hang',
	'hang-under',
	'hang-curl'
];

type QuadrupedSlot = 'root' | 'body' | 'tail' | 'legFL' | 'legFR' | 'legBL' | 'legBR';
type BirdSlot = 'root' | 'body' | 'tail' | 'wingL' | 'wingR' | 'legL' | 'legR';

interface PostureDef<S extends string> {
	/** Rotations in degrees (YXZ) and offsets in model units; the root takes rotation only. */
	readonly key: Partial<Record<S, JointKey>>;
	/** Model point the root rotates about, model units. Default: the origin (feet). */
	readonly pivot?: Vec3Tuple;
	/** Where the pivot ends up in the placed group, model units. Default: the pivot itself. */
	readonly anchor?: Vec3Tuple;
}

export interface PostureSet {
	/** Packed key per posture (null when the species never takes it). Root offsets are 0. */
	readonly keys: readonly (Float64Array | null)[];
	/** Pivot and anchor per posture, 3 numbers each, as fractions of the rig height. */
	readonly pivots: Float64Array;
	readonly anchors: Float64Array;
	/** The rig height the fractions refer to. */
	readonly height: number;
}

const mirrorPair = (deg: Vec3Tuple): Vec3Tuple => [deg[0], -deg[1], -deg[2]];
const mirrorOffset = (p: Vec3Tuple): Vec3Tuple => [-p[0], p[1], p[2]];

/** Same joint key for both sides of a pair, mirrored (yaw, roll and x offset flip). */
function pair<A extends string, B extends string>(left: A, right: B, key: JointKey) {
	const mirrored: JointKey = {
		r: key.r ? mirrorPair(key.r) : undefined,
		p: key.p ? mirrorOffset(key.p) : undefined
	};
	return { [left]: key, [right]: mirrored } as Record<A | B, JointKey>;
}

const legs = (front: JointKey, hind: JointKey) => ({
	...pair('legFL', 'legFR', front),
	...pair('legBL', 'legBR', hind)
});

// --- Quadrupeds (monkey, tiger, koala bases) ----------------------------------

/** Standing on all fours; the tail trails down and back (rest mesh curls up). */
const QUAD_STAND = (tail: number): PostureDef<QuadrupedSlot> => ({ key: { tail: { r: [tail, 0, 0] } } });

/** Primate sit: trunk raised, hind feet forward, hands held in front of the chest. */
const PRIMATE_SIT: PostureDef<QuadrupedSlot> = {
	key: {
		body: { r: [-30, 0, 0], p: [0, 0.02, -0.06] },
		tail: { r: [-125, 0, 0] },
		...legs({ r: [-40, 0, 0], p: [0, 0.22, 0.12] }, { r: [-80, 0, 0], p: [0, -0.08, 0.08] })
	}
};

/** Lying prone along a branch, limbs and tail hanging down either side. */
const PRIMATE_LIE: PostureDef<QuadrupedSlot> = {
	key: {
		body: { r: [2, 0, 0], p: [0, -0.16, 0] },
		tail: { r: [-170, 0, 0] },
		...legs({ r: [0, 0, 12], p: [0.18, -0.2, 0.05] }, { r: [0, 0, 12], p: [0.18, -0.2, -0.05] })
	}
};

/** Cat sit: rump down, chest up on straight forelegs, hind legs folded under. */
const CAT_SIT: PostureDef<QuadrupedSlot> = {
	key: {
		body: { r: [-20, 0, 0], p: [0, -0.05, 0] },
		tail: { r: [-120, 0, 0] },
		...legs({ r: [4, 0, 0] }, { r: [-75, 0, 0], p: [0, -0.1, 0.05] })
	}
};

/** Cat resting "sphinx": body on the ground, forelegs ahead, tail along the ground. */
const CAT_LIE: PostureDef<QuadrupedSlot> = {
	key: {
		body: { r: [3, 0, 0], p: [0, -0.17, 0] },
		tail: { r: [-95, 0, 0] },
		...legs({ r: [-82, 0, 0], p: [0, -0.18, 0.04] }, { r: [-70, 0, 8], p: [0.04, -0.17, 0.02] })
	}
};

/**
 * Howl (bugio): head thrown up, chest out, tail down for balance. The throat sac
 * pulses come from the howl layer in the animator.
 */
const HOWL: PostureDef<QuadrupedSlot> = {
	key: {
		body: { r: [-32, 0, 0], p: [0, 0.04, -0.06] },
		tail: { r: [-150, 0, 0] },
		...legs({ r: [-20, 0, 0], p: [0, 0.12, 0.06] }, { r: [-30, 0, 0], p: [0, -0.04, 0.04] })
	}
};

/** Hanging from the hand (muriqui). The animator rewrites root, arms and pivot every update. */
const HANG_ARM: PostureDef<QuadrupedSlot> = {
	key: {
		root: { r: [-90, 0, 0] },
		tail: { r: [-60, 0, 0] },
		...legs({ r: [-90, 0, 0] }, { r: [80, 0, 6] })
	}
};

/** Tail tip of the curled Cube Pets tail rotated by `tailX` (deg), in root space. */
function tailTip(model: ModelId, tailX: number): Vec3Tuple {
	const { tailPivot, tailTip: tip } = MODELS[model];
	const a = (tailX * Math.PI) / 180;
	const y = tip[1] * Math.cos(a) - tip[2] * Math.sin(a);
	const z = tip[1] * Math.sin(a) + tip[2] * Math.cos(a);
	return [tailPivot[0], tailPivot[1] + y, tailPivot[2] + z];
}

/** Hanging head-down by the tail alone, both hands free to feed (muriqui). */
const HANG_TAIL = (model: ModelId): PostureDef<QuadrupedSlot> => ({
	key: {
		root: { r: [90, 0, 0] },
		tail: { r: [-65, 0, 0] },
		...legs({ r: [-80, 0, 10] }, { r: [85, 0, 8] })
	},
	pivot: tailTip(model, -65),
	anchor: [0, 0, 0]
});

/**
 * Feeding suspension (bugio): hind feet and tail keep the branch, the body swings
 * down in front of it and the hands reach for leaves [C86].
 */
const FEED_HANG = (model: ModelId): PostureDef<QuadrupedSlot> => {
	const hindFeet: Vec3Tuple = [0, 0, MODELS[model].hipZBack];
	return {
		key: {
			root: { r: [115, 0, 0] },
			tail: { r: [-30, 0, 0] },
			...legs({ r: [-80, 0, 12] }, { r: [0, 0, 4] })
		},
		pivot: hindFeet,
		anchor: hindFeet
	};
};

/**
 * Hanging below a branch on all four limbs, back to the ground (sloth). The roll
 * turns the animal upside down; the pitch levels the long forelimbs' and the
 * shorter hindlimbs' feet on the branch. The pivot is the feet's midpoint and
 * the anchor the group origin (the underside of the branch).
 */
function hangUnder(species: SpeciesId, curl: boolean): PostureDef<QuadrupedSlot> {
	const { limbScale, model } = SPECIES[species];
	const m = MODELS[model];
	const front = m.hipY - m.legLength * limbScale.front;
	const hind = m.hipY - m.legLength * limbScale.hind;
	const level = (Math.atan2(hind - front, m.hipZFront - m.hipZBack) * 180) / Math.PI;
	const pivot: Vec3Tuple = [0, (front + hind) / 2, 0];
	return {
		key: curl
			? {
					root: { r: [level, 0, 180] },
					body: { r: [8, 0, 0], p: [0, -0.06, 0] },
					...legs({ r: [18, 0, 4] }, { r: [-18, 0, 4] })
				}
			: { root: { r: [level, 0, 180] }, ...legs({ r: [0, 0, 3] }, { r: [0, 0, 3] }) },
		pivot,
		anchor: [0, 0, 0]
	};
}

// --- Birds (parrot base) -------------------------------------------------------

const WINGS_FOLDED = -72;

const PERCH: PostureDef<BirdSlot> = {
	key: {
		tail: { r: [-55, 0, 0] },
		...pair('wingL', 'wingR', { r: [0, 0, WINGS_FOLDED] })
	}
};

/** Wings spread, feet drawn up forward in flight (Van Tyne 1929); rotates about the body centre. */
const FLY = (model: ModelId): PostureDef<BirdSlot> => ({
	key: {
		tail: { r: [-82, 0, 0] },
		...pair('wingL', 'wingR', { r: [0, 0, 6] }),
		...pair('legL', 'legR', { r: [-70, 0, 0], p: [0, 0.1, 0] })
	},
	pivot: MODELS[model].bodyCentre,
	anchor: MODELS[model].bodyCentre
});

/** Roosting: tail folded up over the back (Kricher 1989), wings tucked, sitting low. */
const ROOST: PostureDef<BirdSlot> = {
	key: {
		body: { p: [0, -0.08, 0] },
		tail: { r: [55, 0, 0] },
		...pair('wingL', 'wingR', { r: [0, 0, WINGS_FOLDED - 4] }),
		...pair('legL', 'legR', { p: [0, -0.06, 0] })
	}
};

/** Wing angle (deg) folded against the body, used by the flap layer. */
export const WING_FOLDED = WINGS_FOLDED;
/** Wing angle (deg) spread in the 'fly' key. */
export const WING_SPREAD = 6;

type PostureTable<S extends string> = Partial<Record<Posture, PostureDef<S>>>;

function quadrupedTable(species: SpeciesId): PostureTable<QuadrupedSlot> {
	const model = SPECIES[species].model;
	switch (species) {
		case 'mico-leao-dourado':
			// The tamarin's tail is not prehensile: no suspended posture exists for it.
			return { stand: QUAD_STAND(-105), sit: PRIMATE_SIT, lie: PRIMATE_LIE };
		case 'muriqui':
			return { 'hang-arm': HANG_ARM, 'hang-tail': HANG_TAIL(model) };
		case 'bugio-ruivo':
			return {
				stand: QUAD_STAND(-120),
				sit: PRIMATE_SIT,
				lie: PRIMATE_LIE,
				howl: HOWL,
				'feed-hang': FEED_HANG(model)
			};
		case 'onca-pintada':
			// The jaguar carries its tail low with the tip turned up.
			return { stand: QUAD_STAND(-112), sit: CAT_SIT, lie: CAT_LIE };
		case 'preguica-de-coleira':
			return { 'hang-under': hangUnder(species, false), 'hang-curl': hangUnder(species, true) };
		default:
			return {};
	}
}

function birdTable(species: SpeciesId): PostureTable<BirdSlot> {
	const model = SPECIES[species].model;
	return { perch: PERCH, fly: FLY(model), roost: ROOST };
}

function compileTable<S extends string>(
	layout: Layout<S>,
	table: Partial<Record<Posture, PostureDef<S>>>,
	height: number
): PostureSet {
	const keys: (Float64Array | null)[] = [];
	const pivots = new Float64Array(POSTURE_COUNT * 3);
	const anchors = new Float64Array(POSTURE_COUNT * 3);
	POSTURES.forEach((posture, i) => {
		const def = table[posture];
		if (!def) {
			keys.push(null);
			return;
		}
		const scaled: Partial<Record<S, JointKey>> = {};
		for (const joint of Object.keys(def.key) as S[]) {
			const value = def.key[joint];
			if (!value) continue;
			scaled[joint] = {
				r: value.r,
				p: value.p ? [value.p[0] / height, value.p[1] / height, value.p[2] / height] : undefined
			};
		}
		const key = compileKey(layout, scaled);
		// The root offset is computed from the pivot; a stray one in a key is dropped.
		key[3] = key[4] = key[5] = 0;
		keys.push(key);
		const pivot = def.pivot ?? [0, 0, 0];
		const anchor = def.anchor ?? pivot;
		for (let k = 0; k < 3; k++) {
			pivots[i * 3 + k] = pivot[k] / height;
			anchors[i * 3 + k] = anchor[k] / height;
		}
	});
	return { keys, pivots, anchors, height };
}

/** Compiles the postures one species can take. Load time only. */
export function buildPostures(species: SpeciesId): PostureSet {
	const { model } = SPECIES[species];
	const height = MODELS[model].height;
	if (model === 'parrot') return compileTable(BIRD_LAYOUT, birdTable(species), height);
	return compileTable(QUADRUPED_LAYOUT, quadrupedTable(species), height);
}

/** Postures a species can take, in POSTURES order. */
export function posturesOf(species: SpeciesId): Posture[] {
	const set = buildPostures(species);
	return POSTURES.filter((_, i) => set.keys[i] !== null);
}

/** Width of a packed key, for callers that blend keys themselves. */
export const KEY_WIDTH = JOINT_COUNT * JOINT_STRIDE;

export { QUADRUPED_LAYOUT };
