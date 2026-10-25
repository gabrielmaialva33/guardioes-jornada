import { describe, expect, it } from 'vitest';
import { poissonDisk } from './poisson.ts';
import { BRASILIA_UTC_OFFSET_MINUTES, dayKey, fnv1a, Rng, seedOfTheDay, subSeed } from './random.ts';

/** The POC's generator (physics.ts), kept verbatim as the reference. */
function mulberry32(seed: number) {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

describe('seedOfTheDay', () => {
	const instants = [
		'2026-10-25T00:00:00Z',
		'2026-10-25T02:59:59Z',
		'2026-10-25T12:00:00Z',
		'2026-10-25T23:59:59.999Z'
	].map((iso) => new Date(iso));

	it('is the same in every time zone', () => {
		const saved = process.env.TZ;
		const seeds = new Set<number>();
		const localDays = new Set<number>();
		try {
			for (const zone of [
				'UTC',
				'America/Sao_Paulo',
				'America/Noronha',
				'America/Rio_Branco',
				'Asia/Kolkata',
				'Pacific/Kiritimati',
				'Pacific/Pago_Pago'
			]) {
				process.env.TZ = zone;
				for (const instant of instants) {
					seeds.add(seedOfTheDay(instant));
					localDays.add(instant.getDate());
					expect(dayKey(instant)).toBe('2026-10-25');
				}
			}
		} finally {
			if (saved === undefined) delete process.env.TZ;
			else process.env.TZ = saved;
		}
		expect(seeds.size).toBe(1);
		// The zone switch did take effect: local calendar days differed.
		expect(localDays.size).toBeGreaterThan(1);
	});

	it('turns at UTC midnight, or at a fixed offset', () => {
		expect(seedOfTheDay(new Date('2026-10-25T23:59:59Z'))).not.toBe(
			seedOfTheDay(new Date('2026-10-26T00:00:00Z'))
		);
		// 22:00 of 25/10 in Brasília is already 26/10 in UTC.
		const evening = new Date('2026-10-26T01:00:00Z');
		expect(dayKey(evening)).toBe('2026-10-26');
		expect(dayKey(evening, BRASILIA_UTC_OFFSET_MINUTES)).toBe('2026-10-25');
		expect(seedOfTheDay(evening, BRASILIA_UTC_OFFSET_MINUTES)).toBe(
			seedOfTheDay(new Date('2026-10-25T12:00:00Z'))
		);
	});

	it('changes every day', () => {
		const seeds = new Set<number>();
		const start = Date.UTC(2026, 0, 1);
		for (let day = 0; day < 366; day++) seeds.add(seedOfTheDay(new Date(start + day * 86_400_000)));
		expect(seeds.size).toBe(366);
	});
});

describe('Rng', () => {
	it('is the POC mulberry32', () => {
		const reference = mulberry32(20261025);
		const rng = new Rng(20261025);
		for (let k = 0; k < 1000; k++) expect(rng.next()).toBe(reference());
	});

	it('separates streams and hashes strings', () => {
		const streams = new Set<number>();
		for (let k = 0; k < 64; k++) streams.add(subSeed(12345, k));
		expect(streams.size).toBe(64);
		expect(subSeed(1, 3)).not.toBe(subSeed(2, 3));
		// FNV-1a 32-bit reference values.
		expect(fnv1a('')).toBe(0x811c9dc5);
		expect(fnv1a('a')).toBe(0xe40c292c);
	});

	it('draws weighted indices and unit headings', () => {
		const rng = new Rng(7);
		const hits = [0, 0, 0];
		for (let k = 0; k < 3000; k++) hits[rng.weighted([1, 0, 3])]++;
		expect(hits[1]).toBe(0);
		expect(hits[2] / hits[0]).toBeGreaterThan(2.5);
		for (let k = 0; k < 100; k++) {
			const [c, s] = rng.heading();
			expect(c * c + s * s).toBeCloseTo(1, 12);
		}
	});
});

describe('poissonDisk', () => {
	it('keeps points at least r apart inside the box', () => {
		const points = poissonDisk(new Rng(3), 0, 0, 60, 40, 4);
		expect(points.length / 2).toBeGreaterThan(60);
		for (let a = 0; a < points.length; a += 2) {
			expect(points[a]).toBeGreaterThanOrEqual(0);
			expect(points[a]).toBeLessThan(60);
			expect(points[a + 1]).toBeLessThan(40);
			for (let b = a + 2; b < points.length; b += 2)
				expect((points[a] - points[b]) ** 2 + (points[a + 1] - points[b + 1]) ** 2).toBeGreaterThanOrEqual(
					16
				);
		}
	});
});
