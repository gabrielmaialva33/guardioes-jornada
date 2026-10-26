import { describe, expect, it } from 'vitest';
import { SPIN, Spin } from './spin.ts';

/** Drags `pixels` to the right over `seconds` in 60 Hz moves; returns the release time. */
function drag(spin: Spin, pixels: number, seconds: number, start = 0): number {
	spin.down(0, start);
	const steps = Math.max(1, Math.round(seconds * 60));
	for (let i = 1; i <= steps; i++) spin.move((pixels * i) / steps, start + (seconds * i) / steps);
	return start + seconds;
}

function settle(spin: Spin, seconds = 10, dt = 1 / 60) {
	for (let t = 0; t < seconds; t += dt) spin.step(dt);
}

describe('Spin', () => {
	it('follows the finger while dragging', () => {
		const spin = new Spin();
		drag(spin, 130, 0.3);
		expect(spin.yaw).toBeCloseTo(130 * SPIN.perPixel);
		expect(spin.active).toBe(true);
		expect(spin.step(1 / 60)).toBe(false);
	});
	it('flings on release and coasts to a stop, independent of the frame rate', () => {
		const coast = (dt: number) => {
			const spin = new Spin();
			const end = drag(spin, 200, 0.2);
			spin.up(end);
			const speed = spin.velocity;
			const before = spin.yaw;
			let travelled = 0;
			let last = before;
			for (let t = 0; t < 8; t += dt) {
				spin.step(dt);
				travelled += spin.yaw - last;
				last = spin.yaw;
			}
			return { speed, travelled, spin };
		};
		const fast = coast(1 / 120);
		const slow = coast(1 / 30);
		expect(fast.speed).toBeCloseTo((200 * SPIN.perPixel) / 0.2, 0);
		expect(fast.spin.velocity).toBe(0);
		expect(fast.spin.active).toBe(false);
		// The whole coast is speed / friction, less the tail cut at the rest speed.
		expect(fast.travelled).toBeGreaterThan((fast.speed - SPIN.rest) / SPIN.friction - 1e-6);
		expect(fast.travelled).toBeLessThanOrEqual(fast.speed / SPIN.friction + 1e-6);
		expect(slow.travelled).toBeCloseTo(fast.travelled, 1);
	});
	it('does not fling after the finger stopped, nor with reduced motion', () => {
		const late = new Spin();
		const end = drag(late, 200, 0.2);
		late.up(end + SPIN.stale + 0.05);
		expect(late.velocity).toBe(0);
		const reduced = new Spin();
		reduced.inertia = false;
		reduced.up(drag(reduced, 200, 0.2));
		expect(reduced.velocity).toBe(0);
		expect(reduced.yaw).toBeCloseTo(200 * SPIN.perPixel);
	});
	it('caps the fling speed', () => {
		const spin = new Spin();
		spin.up(drag(spin, 4000, 0.05));
		expect(Math.abs(spin.velocity)).toBeLessThanOrEqual(SPIN.maxSpeed);
	});
	it('cancel stops without a fling', () => {
		const spin = new Spin();
		drag(spin, 200, 0.2);
		spin.cancel();
		expect(spin.active).toBe(false);
	});
	it('arrow keys turn one step, eased or at once', () => {
		const eased = new Spin();
		eased.turn(1, false);
		eased.turn(1, false);
		settle(eased);
		expect(eased.yaw).toBeCloseTo(2 * SPIN.keyStep);
		const instant = new Spin();
		instant.turn(-1, true);
		expect(instant.yaw).toBeCloseTo(-SPIN.keyStep);
		expect(instant.active).toBe(false);
	});
	it('faces a framing the short way round and wraps once at rest', () => {
		const spin = new Spin();
		spin.yaw = 2 * Math.PI * 3 + 0.1;
		spin.face(-0.2, false);
		settle(spin);
		expect(spin.yaw).toBeCloseTo(-0.2);
		const instant = new Spin();
		instant.yaw = Math.PI - 0.1;
		instant.face(-Math.PI + 0.1, true);
		expect(instant.yaw).toBeCloseTo(Math.PI + 0.1);
	});
	it('a drag interrupts a fling and a seek', () => {
		const spin = new Spin();
		spin.up(drag(spin, 300, 0.2));
		spin.step(1 / 60);
		spin.down(0, 1);
		expect(spin.velocity).toBe(0);
		spin.face(1, false);
		expect(spin.step(1 / 60)).toBe(false);
	});
});
