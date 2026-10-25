/**
 * The avatar's key poses: about 25 keys for the whole Animate set (Rosen's
 * "~13 keyframes for the whole character", plus emotes), in degrees and
 * fractions of the rig height. Signs follow the rig notes in joints.ts.
 *
 * Locomotion, climb and swim cycles are driven by distance: each has a stride
 * (studs per cycle) equal to the speed at which Roblox plays that clip at 1×
 * times the cycle's period, so the cadence matches Animate's timewarp wherever
 * one clip plays alone (run at 1.25× at 16 studs/s) and never slides on the spot.
 * Idle, fall and swim-idle loop on time; emotes are one-shot.
 */
import { ANIMATE } from './animate-timings.ts';
import { AVATAR_LAYOUT, type AvatarJoint } from './joints.ts';
import { compileKey, type KeyPose, mirrorKey } from './skeleton.ts';
import { type Interpolation, Track } from './track.ts';

type Key = KeyPose<AvatarJoint>;

const key = (pose: Key) => compileKey(AVATAR_LAYOUT, pose);
const mirror = (pose: Float64Array) => mirrorKey(AVATAR_LAYOUT, pose);

/** A loop over evenly spaced keys (or the given cycle fractions). */
function cycle(
	keys: Float64Array[],
	period: number,
	interpolation: Interpolation = 'cubic',
	times?: number[]
) {
	const at = times ?? keys.map((_, i) => i / keys.length);
	return new Track(AVATAR_LAYOUT, keys, at, { loop: true, interpolation, period });
}

/** A one-shot gesture from [seconds, key] pairs; it ends on its last key. */
function gesture(keys: [number, Float64Array][]) {
	const times = keys.map(([time]) => time);
	return new Track(
		AVATAR_LAYOUT,
		keys.map(([, pose]) => pose),
		times,
		{ loop: false, interpolation: 'smooth', period: times[times.length - 1] }
	);
}

const REST = key({});

// --- Idle --------------------------------------------------------------------

/** Relaxed stance with a slow sway; the breathing layer adds the rest. */
const IDLE_A = key({
	torso: { r: [1, 0, -1] },
	head: { r: [-1, 3, 0] },
	armL: { r: [2, 0, 4] },
	armR: { r: [-1, 0, -3] }
});
const IDLE_B = key({
	torso: { r: [1, 0, 1] },
	head: { r: [-1, -2, 0] },
	armL: { r: [-1, 0, 3] },
	armR: { r: [2, 0, -4] }
});
const STANCE = key({ armL: { r: [0, 0, 3] }, armR: { r: [0, 0, -3] } });
const LOOK_LEFT = key({
	torso: { r: [0, 8, 0] },
	head: { r: [-4, 30, 0] },
	armL: { r: [0, 0, 3] },
	armR: { r: [0, 0, -3] }
});
const LOOK_RIGHT = key({
	torso: { r: [0, -6, 0] },
	head: { r: [-2, -28, 0] },
	armL: { r: [0, 0, 3] },
	armR: { r: [0, 0, -3] }
});

/** Idle variants in ANIMATE.idleWeights order: the main loop, then the rare look-around fidget. */
export const IDLE_VARIANTS = [
	cycle([IDLE_A, IDLE_B], 4),
	cycle(
		[STANCE, LOOK_LEFT, LOOK_LEFT, LOOK_RIGHT, LOOK_RIGHT, STANCE],
		3.2,
		'smooth',
		[0, 0.15, 0.38, 0.5, 0.72, 0.88]
	)
] as const;

// --- Walk and run ------------------------------------------------------------
// Phase 0 is the left foot planted ahead, 0.25 the right leg passing, 0.5 the
// right foot ahead, 0.75 the left passing. Arms swing against the legs and the
// torso twists the opposite shoulder forward; the head counter-turns.

const WALK_REACH = key({
	root: { p: [0, -0.012, 0] },
	torso: { r: [3, 4, 0] },
	head: { r: [0, -4, 0] },
	armL: { r: [30, 0, 3] },
	armR: { r: [-30, 0, -3] },
	legL: { r: [-34, 0, 0] },
	legR: { r: [30, 0, 0] }
});
const WALK_PASS = key({
	root: { p: [0, 0.018, 0] },
	torso: { r: [3, 0, 0] },
	armL: { r: [0, 0, 3] },
	armR: { r: [0, 0, -3] },
	legL: { r: [4, 0, 0] },
	legR: { r: [-4, 0, 0] }
});
const RUN_REACH = key({
	root: { p: [0, -0.02, 0] },
	torso: { r: [10, 6, 0] },
	head: { r: [-6, -6, 0] },
	armL: { r: [55, 0, 6] },
	armR: { r: [-60, 0, -6] },
	legL: { r: [-55, 0, 0] },
	legR: { r: [45, 0, 0] }
});
const RUN_PASS = key({
	root: { p: [0, 0.035, 0] },
	torso: { r: [10, 0, 0] },
	head: { r: [-6, 0, 0] },
	armL: { r: [5, 0, 6] },
	armR: { r: [-5, 0, -6] },
	legL: { r: [15, 0, 0] },
	legR: { r: [-20, 0, 0] }
});

/** Cycle periods at 1×: one full cycle is two steps (Kenney's walk and sprint clips). */
export const WALK = cycle([WALK_REACH, WALK_PASS, mirror(WALK_REACH), mirror(WALK_PASS)], 2 / 3);
export const RUN = cycle([RUN_REACH, RUN_PASS, mirror(RUN_REACH), mirror(RUN_PASS)], 0.5);

// --- Air ---------------------------------------------------------------------

/** Roblox's jump: both arms straight up, about 160° at the shoulders, legs nearly straight. */
export const JUMP = cycle(
	[
		key({
			torso: { r: [-4, 0, 0] },
			head: { r: [-8, 0, 0] },
			armL: { r: [-160, 0, 8] },
			armR: { r: [-160, 0, -8] },
			legL: { r: [-8, 0, 0] },
			legR: { r: [6, 0, 0] }
		})
	],
	1
);

const FALL_A = key({
	torso: { r: [-3, 0, 0] },
	head: { r: [-6, 0, 0] },
	armL: { r: [-140, 0, 32] },
	armR: { r: [-152, 0, -22] },
	legL: { r: [-14, 0, 3] },
	legR: { r: [8, 0, -3] }
});

/** Arms up and open, flailing a little until the feet touch down. */
export const FALL = cycle([FALL_A, mirror(FALL_A)], 0.7);

// --- Climb, swim, sit ------------------------------------------------------------

const CLIMB_A = key({
	torso: { r: [8, 0, 0] },
	head: { r: [-12, 0, 0] },
	armL: { r: [-165, 0, 8] },
	armR: { r: [-95, 0, -8] },
	legL: { r: [-50, 0, 0] },
	legR: { r: [8, 0, 0] }
});

/** Hand over hand, the opposite knee up; phase follows the vertical distance. */
export const CLIMB = cycle([CLIMB_A, mirror(CLIMB_A)], 1);

// The swimmer lies 72° forward about the feet; the root offset puts the body's
// middle back where it stands, so the capsule still covers it.
const SWIM_A = key({
	root: { r: [72, 0, 0], p: [0, 0.345, -0.476] },
	torso: { r: [0, 10, 0] },
	head: { r: [-45, -8, 0] },
	armL: { r: [-170, 0, 12] },
	armR: { r: [25, 0, -10] },
	legL: { r: [-14, 0, 0] },
	legR: { r: [12, 0, 0] }
});

/** Front crawl, one stroke per side; phase follows the distance swum. */
export const SWIM = cycle([SWIM_A, mirror(SWIM_A)], 1.2);

/** Treading water upright, sculling with both arms. */
export const SWIM_IDLE = cycle(
	[
		key({
			root: { r: [10, 0, 0] },
			head: { r: [-8, 0, 0] },
			armL: { r: [-35, 0, 55] },
			armR: { r: [-35, 0, -55] },
			legL: { r: [-20, 0, 4] },
			legR: { r: [12, 0, -4] }
		}),
		key({
			root: { r: [10, 0, 0] },
			head: { r: [-8, 0, 0] },
			armL: { r: [-25, 0, 30] },
			armR: { r: [-25, 0, -30] },
			legL: { r: [12, 0, 4] },
			legR: { r: [-20, 0, -4] }
		})
	],
	1.6
);

/** Kenney's sit: hips down 0.2 of 2.7, legs straight ahead, hands on the knees. */
export const SIT = cycle(
	[
		key({
			root: { p: [0, -0.074, 0] },
			torso: { r: [-4, 0, 0] },
			armL: { r: [-28, 0, 5] },
			armR: { r: [-28, 0, -5] },
			legL: { r: [-90, 0, 3] },
			legR: { r: [-90, 0, -3] }
		})
	],
	1
);

// --- Emotes ------------------------------------------------------------------

const WAVE_UP = (roll: number) =>
	key({ head: { r: [0, 0, 4] }, armL: { r: [5, 0, 4] }, armR: { r: [-10, 0, roll] } });

const CHEER_UP = (lift: number, spread: number) =>
	key({
		root: { p: [0, lift, 0] },
		torso: { r: [-6, 0, 0] },
		head: { r: [-14, 0, 0] },
		armL: { r: [0, 0, spread] },
		armR: { r: [0, 0, -spread] },
		legL: { r: [-6, 0, 4] },
		legR: { r: [4, 0, -4] }
	});

const POINTING = key({
	torso: { r: [0, 10, 0] },
	head: { r: [0, -8, 0] },
	armL: { r: [8, 0, 3] },
	armR: { r: [-90, 0, -4] }
});

export const EMOTE_IDS = ['wave', 'cheer', 'point'] as const;

export type EmoteId = (typeof EMOTE_IDS)[number];

/** Roblox's non-looping emotes: they play once and fade back to idle. */
export const EMOTES: Readonly<Record<EmoteId, Track>> = {
	wave: gesture([
		[0, REST],
		[0.25, WAVE_UP(-150)],
		[0.5, WAVE_UP(-165)],
		[0.8, WAVE_UP(-135)],
		[1.1, WAVE_UP(-165)],
		[1.4, WAVE_UP(-135)],
		[1.75, WAVE_UP(-155)],
		[2.2, REST]
	]),
	cheer: gesture([
		[0, REST],
		[
			0.15,
			key({
				root: { p: [0, -0.015, 0] },
				torso: { r: [8, 0, 0] },
				armL: { r: [10, 0, 10] },
				armR: { r: [10, 0, -10] }
			})
		],
		[0.4, CHEER_UP(0.05, 160)],
		[0.65, CHEER_UP(0, 120)],
		[0.9, CHEER_UP(0.03, 165)],
		[1.15, CHEER_UP(0, 160)],
		[1.5, REST]
	]),
	point: gesture([
		[0, REST],
		[0.25, POINTING],
		[1.2, POINTING],
		[1.6, REST]
	])
};

// --- Strides -----------------------------------------------------------------

/** Studs per cycle; the cycle runs at 1× at each clip's native Animate speed. */
export const WALK_STRIDE = ANIMATE.walkNativeSpeed * WALK.period;
export const RUN_STRIDE = ANIMATE.runNativeSpeed * RUN.period;
export const CLIMB_STRIDE = ANIMATE.climbNativeSpeed * CLIMB.period;
export const SWIM_STRIDE = ANIMATE.swimNativeSpeed * SWIM.period;
