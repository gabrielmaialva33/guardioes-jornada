import { describe, expect, it } from 'vitest';
import { allFinite } from './fixtures.test-helper.ts';
import { Flock, type FlockKind } from './flock.ts';

const BOUNDS = [-6, 0.5, -4, 6, 3.5, 4] as const;

function inside(flock: Flock) {
	const b = flock.bounds;
	for (let i = 0; i < flock.count; i++)
		for (let k = 0; k < 3; k++) {
			const value = flock.position[i * 3 + k];
			if (value < b[k] - 1e-5 || value > b[k + 3] + 1e-5) return false;
		}
	return true;
}

describe('boids', () => {
	for (const kind of ['butterfly', 'bird'] as FlockKind[])
		for (const hz of [30, 120]) {
			it(`${kind}: stays inside its box with no NaN at ${hz} Hz`, () => {
				const flock = new Flock({ kind, count: 32, bounds: BOUNDS, seed: 7 });
				const { minSpeed, maxSpeed } = flock.params;
				for (let i = 0; i < 60 * hz; i++) {
					flock.update(1 / hz);
					expect(inside(flock)).toBe(true);
					expect(allFinite(flock.position) && allFinite(flock.velocity)).toBe(true);
				}
				for (let i = 0; i < flock.count; i++) {
					const v = flock.velocity;
					const speed = Math.hypot(v[i * 3], v[i * 3 + 1], v[i * 3 + 2]);
					expect(speed).toBeGreaterThanOrEqual(minSpeed - 1e-4);
					expect(speed).toBeLessThanOrEqual(maxSpeed + 1e-4);
				}
			});
		}

	it('keeps its agents apart and its birds aligned', () => {
		const flock = new Flock({ kind: 'bird', count: 24, bounds: [-15, 2, -15, 15, 8, 15], seed: 3 });
		for (let i = 0; i < 1200; i++) flock.update(1 / 60);
		let close = 0;
		let alignment = 0;
		let pairs = 0;
		const p = flock.position;
		const v = flock.velocity;
		for (let i = 0; i < flock.count; i++)
			for (let j = i + 1; j < flock.count; j++) {
				const d = Math.hypot(p[i * 3] - p[j * 3], p[i * 3 + 1] - p[j * 3 + 1], p[i * 3 + 2] - p[j * 3 + 2]);
				if (d < 0.2) close++;
				if (d < flock.params.neighbourRadius) {
					const vi = Math.hypot(v[i * 3], v[i * 3 + 1], v[i * 3 + 2]);
					const vj = Math.hypot(v[j * 3], v[j * 3 + 1], v[j * 3 + 2]);
					alignment +=
						(v[i * 3] * v[j * 3] + v[i * 3 + 1] * v[j * 3 + 1] + v[i * 3 + 2] * v[j * 3 + 2]) / (vi * vj);
					pairs++;
				}
			}
		expect(close).toBe(0);
		expect(pairs).toBeGreaterThan(0);
		expect(alignment / pairs).toBeGreaterThan(0.5);
	});

	it('recovers from bad input and survives huge or invalid frame times', () => {
		const flock = new Flock({ kind: 'butterfly', count: 8, bounds: BOUNDS, seed: 1 });
		flock.position[0] = Number.NaN;
		flock.velocity[4] = Number.POSITIVE_INFINITY;
		for (const dt of [Number.NaN, -1, 0, 10, Number.POSITIVE_INFINITY, 1 / 60]) flock.update(dt);
		expect(allFinite(flock.position) && allFinite(flock.velocity)).toBe(true);
		expect(inside(flock)).toBe(true);
	});

	it('writes orthonormal instance matrices facing the velocity', () => {
		const flock = new Flock({ kind: 'bird', count: 10, bounds: BOUNDS, seed: 2 });
		for (let i = 0; i < 90; i++) flock.update(1 / 60);
		const out = new Float32Array(flock.count * 16);
		flock.writeMatrices(out, { scale: 2 });
		for (let i = 0; i < flock.count; i++) {
			const m = out.subarray(i * 16, i * 16 + 16);
			const col = (c: number) => [m[c * 4] / 2, m[c * 4 + 1] / 2, m[c * 4 + 2] / 2];
			const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
			const [right, up, forward] = [col(0), col(1), col(2)];
			expect(dot(right, right)).toBeCloseTo(1, 5);
			expect(dot(up, up)).toBeCloseTo(1, 5);
			expect(dot(forward, forward)).toBeCloseTo(1, 5);
			expect(dot(right, up)).toBeCloseTo(0, 5);
			expect(dot(right, forward)).toBeCloseTo(0, 5);
			// Right-handed, wings level (right has no y), forward along the velocity.
			expect(right[1]).toBe(0);
			const v = flock.velocity.subarray(i * 3, i * 3 + 3);
			const speed = Math.hypot(v[0], v[1], v[2]);
			expect(dot(forward, [v[0] / speed, v[1] / speed, v[2] / speed])).toBeCloseTo(1, 5);
			expect(m[12]).toBeCloseTo(flock.position[i * 3], 5);
			expect(m[15]).toBe(1);
		}
	});
});
