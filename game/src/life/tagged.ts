/**
 * Frame times as tagged numbers, so the per-frame path can hand them to the
 * fauna module's number-taking calls (Animal.frame, Flock.update) without V8
 * boxing a new heap number per call (p3-animals.md, V8 rules 1 and 6).
 *
 * DT_TAGGED[q] is q / DT_STEPS seconds, stored in an array of generic
 * elements: reading it yields the same heap number every time, and passing it
 * on allocates nothing. Frame times are rounded to 0.1 ms, far below anything
 * visible; rounding to nearest keeps the long-run clock unbiased.
 *
 *   const dtTagged = DT_TAGGED[Math.round(dt * DT_STEPS)];
 */
export const DT_STEPS = 10_000;
/** Longest frame time the layer integrates, seconds (the fauna module clamps to the same). */
export const DT_MAX = 0.25;

export const DT_TAGGED: number[] = (() => {
	// Starting with an object makes the array's elements generic (tagged), and they stay so.
	const out: unknown[] = [{}];
	for (let q = 0; q <= DT_MAX * DT_STEPS; q++) out[q] = q / DT_STEPS;
	return out as number[];
})();
