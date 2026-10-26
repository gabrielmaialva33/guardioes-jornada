import { describe, expect, it } from 'vitest';
import {
	type CameraPlacement,
	easeInOutCubic,
	FOV_DEG,
	FRAMING_SECONDS,
	FRAMINGS,
	FramingTween,
	fitDistance,
	placeCamera
} from './framing.ts';

const DEG = Math.PI / 180;

/** Half the visible height and width at the target's distance. */
function visible(distance: number, aspect: number) {
	const half = Math.tan((FOV_DEG * DEG) / 2) * distance;
	return { height: half * 2, width: half * 2 * aspect };
}

describe('fitDistance', () => {
	it('keeps the whole framing in view at phone landscape, portrait and desktop aspects', () => {
		for (const aspect of [320 / 328, 328 / 290, 430 / 600, 0.5, 2]) {
			for (const framing of Object.values(FRAMINGS)) {
				const view = visible(fitDistance(framing, aspect), aspect);
				expect(view.height).toBeGreaterThanOrEqual(framing.height - 1e-9);
				expect(view.width).toBeGreaterThanOrEqual(framing.width - 1e-9);
			}
		}
	});
	it('brings the camera much closer for the head', () => {
		expect(fitDistance(FRAMINGS.head, 1)).toBeLessThan(fitDistance(FRAMINGS.body, 1) / 2);
	});
	it('survives a zero-size canvas', () => {
		expect(Number.isFinite(fitDistance(FRAMINGS.body, 0))).toBe(true);
	});
});

describe('placeCamera', () => {
	it('puts the camera in front (+z), above the target by the pitch', () => {
		const out: CameraPlacement = { x: 1, y: 1, z: 1, targetY: 0 };
		placeCamera(FRAMINGS.head, 1, out);
		const distance = fitDistance(FRAMINGS.head, 1);
		expect(out.x).toBe(0);
		expect(out.z).toBeCloseTo(Math.cos(FRAMINGS.head.pitch) * distance);
		expect(out.y).toBeGreaterThan(FRAMINGS.head.targetY);
		expect(out.targetY).toBe(FRAMINGS.head.targetY);
	});
});

describe('FramingTween', () => {
	it('eases from body to head over FRAMING_SECONDS', () => {
		const tween = new FramingTween(FRAMINGS.body);
		tween.set(FRAMINGS.head, false);
		expect(tween.moving).toBe(true);
		expect(tween.current.targetY).toBeCloseTo(FRAMINGS.body.targetY);
		tween.step(FRAMING_SECONDS / 2);
		const halfway = (FRAMINGS.body.targetY + FRAMINGS.head.targetY) / 2;
		expect(tween.current.targetY).toBeCloseTo(halfway, 5);
		let guard = 0;
		while (tween.step(1 / 60) && guard++ < 1000);
		expect(tween.moving).toBe(false);
		expect(tween.current).toEqual(FRAMINGS.head);
	});
	it('cuts at once with reduced motion', () => {
		const tween = new FramingTween(FRAMINGS.body);
		tween.set(FRAMINGS.head, true);
		expect(tween.moving).toBe(false);
		expect(tween.current).toEqual(FRAMINGS.head);
		expect(tween.step(1 / 60)).toBe(false);
	});
	it('starts a new tween from wherever the camera is', () => {
		const tween = new FramingTween(FRAMINGS.body);
		tween.set(FRAMINGS.head, false);
		tween.step(FRAMING_SECONDS / 3);
		const mid = tween.current.targetY;
		tween.set(FRAMINGS.body, false);
		expect(tween.current.targetY).toBe(mid);
		tween.step(1 / 60);
		expect(Math.abs(tween.current.targetY - mid)).toBeLessThan(0.05);
	});
	it('ignores bad time steps', () => {
		const tween = new FramingTween(FRAMINGS.body);
		tween.set(FRAMINGS.head, false);
		tween.step(Number.NaN);
		tween.step(-1);
		expect(tween.current.targetY).toBeCloseTo(FRAMINGS.body.targetY);
	});
	it('eases in and out', () => {
		expect(easeInOutCubic(0)).toBe(0);
		expect(easeInOutCubic(0.5)).toBeCloseTo(0.5);
		expect(easeInOutCubic(1)).toBe(1);
		expect(easeInOutCubic(0.1)).toBeLessThan(0.1);
		expect(easeInOutCubic(2)).toBe(1);
	});
});
