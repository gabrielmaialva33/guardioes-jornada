/**
 * The spray at a streamed waterfall's foot: waterfall-foam.ts's batch (its
 * shader, wind and look uniforms), one per fall. Main thread only.
 */
import type { StoryLevel } from '../../level/types.ts';
import { createWaterfallFoam } from '../waterfall-foam.ts';
import { SPRAY_OUT, type StreamWaterfall } from './waterfalls.ts';

/**
 * waterfall-foam.ts's spray batch for one fall. That module reads the first
 * 'waterfall' landmark of a level and rises SPRAY_OUT u west of it at its
 * foot; the landmark handed over here makes that point the fall's own spray
 * point, whichever way it runs.
 */
export function createWaterfallSpray(fall: StreamWaterfall) {
	const landmark = {
		id: fall.id,
		kind: 'waterfall' as const,
		label: '',
		silhouette: false,
		x: fall.sprayX + SPRAY_OUT,
		y: fall.foot + 1,
		z: fall.sprayZ,
		yawC: 1,
		yawS: 0,
		height: 1
	};
	// createWaterfallFoam reads `landmarks` alone.
	return createWaterfallFoam({ landmarks: [landmark] } as unknown as StoryLevel);
}
