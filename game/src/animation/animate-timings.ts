/**
 * Roblox's default Animate script, as numbers. Speeds are in studs/s (convert
 * with STUD), times in seconds, at HipHeight scale 1.
 *
 * Sources: the R15 Animate in Roblox-Client-Tracker a020070 (client v0.744,
 * 2026-10-21), summarized in roblox-gameplay.md, "Conferência com o PlayerModule
 * atual", and animacoes.md §2 for the swim hysteresis, idle re-roll and emotes.
 */
export const ANIMATE = {
	/** onRunning: above this the walk/run blend plays, at or below it idle (speedThreshold). */
	speedThreshold: 0.75,
	/** Fades into idle and into walk/run. */
	idleFade: 0.2,
	walkFade: 0.2,
	/**
	 * setRunSpeed: runSpeed = speed × 1.25 / 16. Walk alone up to runSpeed 0.5
	 * (6.4 studs/s, where the walk clip plays at 1×), a linear crossfade up to
	 * 1.0 (12.8 studs/s, run at 1×), run alone above, sped up by runSpeed: the
	 * default 16 studs/s plays only run, at 1.25×.
	 */
	walkNativeSpeed: 6.4,
	runNativeSpeed: 12.8,
	/** The jump pose fades in over 0.1 s and holds jumpDuration before fall may start. */
	jumpFade: 0.1,
	jumpDuration: 0.31,
	/** fallTransitionTime. */
	fallFade: 0.2,
	/** Climb fades in over 0.1 s and plays at speed / 5. */
	climbFade: 0.1,
	climbNativeSpeed: 5,
	/** Swim and swim-idle fade over 0.4 s; swim plays at speed / 10, with 1.025 / 0.975 hysteresis. */
	swimFade: 0.4,
	swimNativeSpeed: 10,
	swimEnterSpeed: 1.025,
	swimExitSpeed: 0.975,
	sitFade: 0.5,
	/** EMOTE_TRANSITION_TIME; emotes start only while standing still. */
	emoteFade: 0.1,
	/** Idle re-rolls its variant at the end of each loop, and a finished emote returns to idle, over this. */
	loopFade: 0.15,
	/** R6 idle variants: the main loop and the rare one, weighted 9 : 1. */
	idleWeights: [9, 1]
} as const;
