/**
 * Shared motion constants (see ART.md, section 7), so the avatar, the animals,
 * effects and UI feel like one game. The avatar's state timings are Roblox's
 * and live in src/animation/animate-timings.ts.
 */

/** Spring presets: frequency in Hz and damping ratio (1 = critically damped). */
export const SPRING = {
	/** Bodies and heads settling after a move. */
	body: { hz: 4, damping: 1 },
	/** Tails, ears, antennas and leaves: a little overshoot. */
	appendage: { hz: 3.5, damping: 0.6 },
	/** Quick pops (collect, checkpoint). */
	pop: { hz: 6, damping: 0.7 }
} as const;

/** Upper limits that keep every character in the same style. */
export const LIMITS = {
	/** Squash and stretch, as a fraction of the rest scale. */
	squash: 0.15,
	/** Longest anticipation before an action, in seconds. */
	anticipation: 0.08,
	/** Camera impulse on landings from high falls, in world units. */
	landingShake: 0.05
} as const;

/** Feedback and UI durations in seconds, matching the app's easing tokens. */
export const DURATION = {
	tap: 0.12,
	state: 0.2,
	reward: 0.32
} as const;

/** With reduced motion, decorative motion stops and essential transitions shorten to this. */
export const REDUCED_MOTION_DURATION = 0.12;
