import { describe, expect, it } from 'vitest';
import { SPRING } from '../../style/motion.ts';
import { DampedSpring } from './damped-spring.ts';

describe('DampedSpring (style/motion.ts presets)', () => {
	it('takes its frequency from the preset times the tempo', () => {
		const spring = new DampedSpring(SPRING.appendage, 0.5);
		expect(spring.omega).toBeCloseTo(2 * Math.PI * 3.5 * 0.5, 12);
		expect(spring.zeta).toBe(0.6);
	});

	for (const [name, preset] of Object.entries(SPRING))
		it(`${name}: two half steps equal one full step toward a held target`, () => {
			const a = new DampedSpring(preset);
			const b = new DampedSpring(preset);
			a.reset(1);
			b.reset(1);
			a.velocity = b.velocity = -2;
			a.step(0, 0.1);
			b.step(0, 0.05);
			b.step(0, 0.05);
			expect(b.value).toBeCloseTo(a.value, 12);
			expect(b.velocity).toBeCloseTo(a.velocity, 12);
		});

	it('a body spring never overshoots; an appendage overshoots by e^(−ζπ/√(1−ζ²))', () => {
		const body = new DampedSpring(SPRING.body);
		const tail = new DampedSpring(SPRING.appendage);
		let bodyMax = 0;
		let tailMax = 0;
		for (let i = 0; i < 600; i++) {
			bodyMax = Math.max(bodyMax, body.step(1, 1 / 120));
			tailMax = Math.max(tailMax, tail.step(1, 1 / 120));
		}
		expect(bodyMax).toBeLessThanOrEqual(1 + 1e-12);
		const zeta = SPRING.appendage.damping;
		expect(tailMax - 1).toBeCloseTo(Math.exp((-zeta * Math.PI) / Math.sqrt(1 - zeta * zeta)), 2);
	});

	it('stays finite and settles for any dt, and kicks peak near the requested amount', () => {
		const spring = new DampedSpring(SPRING.pop);
		spring.reset(3);
		for (const dt of [5, 0, -1, Number.NaN, 1 / 30]) spring.step(0, dt);
		expect(Number.isFinite(spring.value)).toBe(true);
		expect(Math.abs(spring.value)).toBeLessThan(1e-6);
		const critical = new DampedSpring({ hz: 4, damping: 1 });
		critical.kick(0.15);
		let peak = 0;
		for (let i = 0; i < 240; i++) peak = Math.max(peak, critical.step(0, 1 / 240));
		expect(peak).toBeCloseTo(0.15, 3);
	});
});
