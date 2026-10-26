import { Ray, Vector3 } from 'three';
import { expect, it } from 'vitest';
import { buildStoryWorld } from '../../level/build.ts';
import { createParkBoundary } from './boundary.ts';

it('opens only the authored portal gaps in the Reserva, leaving gate state to ParkRuntime', () => {
	const { level } = buildStoryWorld(),
		boundary = createParkBoundary(level);
	const p = level.portal;
	const ray = new Ray(
		new Vector3(p.inside.x, p.gap.y + 1, (p.gap.from + p.gap.to) / 2),
		new Vector3(1, 0, 0)
	);
	expect(boundary.raycast(ray, 20)).toBeNull();
	ray.origin.z = p.gap.from - 3;
	expect(boundary.raycast(ray, 20)).not.toBeNull();
	// The Vale's far east edge remains closed to the future F2 world.
	ray.origin.set(317, 25, 100);
	expect(boundary.raycast(ray, 10)).not.toBeNull();
	boundary.dispose();
});
