/**
 * Walking distance over the story map: survival's walkSteps (8 neighbours,
 * WALK_SLOPE, no corner cutting) plus jump links, so the obbies count. A link
 * is one obby run, from the cell of its take-off to the cell of its landing;
 * every reached link restarts the walk from its landing, until nothing
 * improves. Steps add up in units, like walkSteps'.
 */
import { walkSteps } from '../survival/generate.ts';
import { floor } from '../survival/noise.ts';
import { GRID } from '../survival/types.ts';

export interface JumpLink {
	from: number;
	to: number;
	/** Path length in units. */
	length: number;
}

export const cellOf = (x: number, z: number) => floor(z + 0.5) * GRID + floor(x + 0.5);

/** Steps in units from `start` over walkable ground and the links (−1 where unreachable). */
export function stepsWithLinks(
	flags: Uint8Array,
	walkH: Float32Array,
	start: number,
	links: readonly JumpLink[]
): Int16Array {
	const steps = walkSteps(flags, walkH, start);
	const fromLanding = new Map<number, Int16Array>();
	for (let changed = true; changed; ) {
		changed = false;
		for (const link of links) {
			const at = steps[link.from];
			if (at < 0) continue;
			const cost = at + floor(link.length + 0.5);
			if (steps[link.to] >= 0 && steps[link.to] <= cost) continue;
			let after = fromLanding.get(link.to);
			if (after === undefined) {
				after = walkSteps(flags, walkH, link.to);
				fromLanding.set(link.to, after);
			}
			for (let q = 0; q < steps.length; q++)
				if (after[q] >= 0 && (steps[q] < 0 || cost + after[q] < steps[q])) {
					steps[q] = cost + after[q];
					changed = true;
				}
		}
	}
	return steps;
}
