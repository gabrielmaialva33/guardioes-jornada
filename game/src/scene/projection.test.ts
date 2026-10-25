import { PerspectiveCamera, Vector3 } from 'three';
import { expect, it } from 'vitest';
import { CAMERA_DEFAULT_DISTANCE, CAMERA_FOV } from '../engine/constants.ts';
import { horizontalFov, verticalFov } from './projection.ts';

it('keeps the 16:9 horizontal view on narrow screens, with continuous resize', () => {
	const target = horizontalFov(CAMERA_FOV, 16 / 9);
	for (const aspect of [412 / 915, 1, 4 / 3, 16 / 9])
		expect(horizontalFov(verticalFov(aspect), aspect)).toBeCloseTo(target);
	expect(verticalFov(915 / 412)).toBe(CAMERA_FOV);
	expect(verticalFov(412 / 915)).toBeCloseTo(140.21, 0);
});
it('frames the fixed-distance avatar at about a quarter in landscape and smaller in portrait', () => {
	const height = (aspect: number) => {
		const camera = new PerspectiveCamera(verticalFov(aspect), aspect, 0.1, 70);
		const top = new Vector3(0, 1.5, -CAMERA_DEFAULT_DISTANCE).project(camera);
		const bottom = new Vector3(0, -1.5, -CAMERA_DEFAULT_DISTANCE).project(camera);
		return (top.y - bottom.y) / 2;
	};
	expect(height(915 / 412)).toBeGreaterThan(0.25);
	expect(height(915 / 412)).toBeLessThan(0.3);
	expect(height(412 / 915)).toBeLessThan(0.08);
});
