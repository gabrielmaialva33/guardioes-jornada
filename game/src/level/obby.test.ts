import { describe, expect, it } from 'vitest';
import { MAX_SLOPE } from '../engine/constants.ts';
import { jumpReach } from '../engine/graybox.ts';
import { heightAt } from '../survival/terrain.ts';
import { FLAG, GRID } from '../survival/types.ts';
import { buildStoryWorld, insideTop } from './build.ts';
import { direction, distance, insidePolygon, polygonEdgeDistance } from './geometry.ts';
import { LEDGES, PLATEAU, STONES } from './layout.ts';
import type { ObbyTop } from './types.ts';

const { world, level } = buildStoryWorld();
const [stones, ledges] = level.obbies;

/** Edge-to-edge gaps measured from the built positions, not from the builder's own numbers. */
function measuredGaps(o: typeof stones): { gap: number; rise: number }[] {
	const out: { gap: number; rise: number }[] = [];
	const ends = [
		{ x: o.takeoff.x, z: o.takeoff.z, y: o.takeoff.y, r: 0 },
		...o.pieces.map((p) => ({ x: p.x, z: p.z, y: p.y, r: p.radius })),
		{ x: o.landing.x, z: o.landing.z, y: o.landing.y, r: 0 }
	];
	// The ledges' landing is inside the rim, not at an edge: their last gap ends at ledge 6.
	const last = o.id === 'ledges' ? ends.length - 1 : ends.length;
	for (let k = 1; k < last; k++) {
		const a = ends[k - 1];
		const b = ends[k];
		out.push({ gap: distance(a.x, a.z, b.x, b.z) - a.r - b.r, rise: b.y - a.y });
	}
	return out;
}

describe('obby 1: river stones', () => {
	it('has 7 stones of radius 1.3 with tops 0.6 above the water', () => {
		expect(stones.pieces).toHaveLength(7);
		for (const p of stones.pieces) {
			expect(p.radius).toBe(1.3);
			expect(Math.abs(p.y - level.pool.water - 0.6)).toBeLessThanOrEqual(0.15 + 1e-9);
		}
	});

	it('keeps every gap at its LEVEL.md fraction of the flat reach and every rise within ±0.3', () => {
		const gaps = measuredGaps(stones);
		expect(gaps).toHaveLength(8);
		expect(stones.gaps.map((g) => g.fraction)).toEqual([0.45, 0.5, 0.55, 0.6, 0.55, 0.6, 0.65, 0.5]);
		gaps.forEach(({ gap, rise }, k) => {
			expect(gap).toBeCloseTo(STONES.gapFractions[k] * jumpReach(0), 6);
			expect(gap).toBeGreaterThanOrEqual(2.3);
			expect(gap).toBeLessThanOrEqual(3.4);
			expect(gap).toBeLessThan(jumpReach(rise));
			expect(Math.abs(rise)).toBeLessThanOrEqual(0.3 + 1e-9);
		});
	});

	it('zigzags ±1.6 u across the axis and sits in the water', () => {
		stones.pieces.forEach((p, k) => {
			const side = (p.x - stones.takeoff.x) * -stones.dirZ + (p.z - stones.takeoff.z) * stones.dirX;
			expect(side).toBeCloseTo(k % 2 === 0 ? -STONES.zigzag : STONES.zigzag, 6);
			expect(world.flags[Math.round(p.z) * GRID + Math.round(p.x)] & FLAG.river).toBeTruthy();
		});
	});
});

describe('obby 2: mirante ledges', () => {
	it('has 6 ledges 2.5 u across at y 7.5 to 15, taking off at y 6', () => {
		expect(ledges.pieces.map((p) => p.y)).toEqual([7.5, 9, 10.5, 12, 13.5, 15]);
		expect(ledges.pieces.map((p) => p.radius * 2)).toEqual(Array(6).fill(2.5));
		expect(ledges.takeoff.y).toBe(6);
		expect(
			heightAt(world.heights, ledges.takeoff.x - ledges.dirX, ledges.takeoff.z - ledges.dirZ)
		).toBeCloseTo(6, 2);
	});

	it('rises 1.5 u per jump over gaps of 0.45–0.6 of jumpReach(1.5)', () => {
		const gaps = measuredGaps(ledges);
		expect(gaps).toHaveLength(6);
		gaps.forEach(({ gap, rise }, k) => {
			expect(rise).toBeCloseTo(1.5, 9);
			expect(gap).toBeCloseTo(LEDGES.gapFractions[k] * jumpReach(1.5), 6);
			expect(gap / jumpReach(1.5)).toBeGreaterThanOrEqual(0.45 - 1e-9);
			expect(gap / jumpReach(1.5)).toBeLessThanOrEqual(0.6 + 1e-9);
		});
	});

	it('starts at LEVEL.md ledge 1, ends on the rim, and keeps every top clear of the ground', () => {
		expect([ledges.pieces[0].x, ledges.pieces[0].z]).toEqual(LEDGES.first);
		const top = ledges.pieces[5];
		expect(polygonEdgeDistance(PLATEAU, top.x, top.z)).toBeLessThan(1e-6);
		expect(insidePolygon(PLATEAU, ledges.landing.x, ledges.landing.z)).toBe(true);
		for (const p of ledges.pieces.slice(0, 5))
			for (let a = -1; a <= 1; a += 0.25)
				for (let b = -1; b <= 1; b += 0.25) {
					const x = p.x + p.radius * (a * p.yawC + b * p.yawS);
					const z = p.z + p.radius * (-a * p.yawS + b * p.yawC);
					expect(heightAt(world.heights, x, z)).toBeLessThanOrEqual(p.y + 1e-3);
				}
	});

	it('never drops a fall into the river', () => {
		for (const p of ledges.pieces)
			for (let dz = -8; dz <= 8; dz++)
				for (let dx = -8; dx <= 8; dx++) {
					const q = Math.round(p.z + dz) * GRID + Math.round(p.x + dx);
					expect(world.flags[q] & FLAG.river).toBe(0);
				}
	});
});

describe('mirante cliffs', () => {
	const tooSteep = Math.tan(MAX_SLOPE);
	const nearLedge = (x: number, z: number) =>
		ledges.pieces.slice(0, 5).some((p: ObbyTop) => insideTop(p, x, z, 1.5));

	it('makes the west face steeper than MAX_SLOPE except at the ledges', () => {
		const west = [PLATEAU[0], PLATEAU[4], PLATEAU[3]];
		let sampled = 0;
		for (let e = 0; e + 1 < west.length; e++) {
			const [ax, az] = west[e];
			const [bx, bz] = west[e + 1];
			const [ux, uz] = direction(ax, az, bx, bz);
			// Outward normal: the side away from the plateau.
			const out = insidePolygon(PLATEAU, (ax + bx) / 2 + uz, (az + bz) / 2 - ux) ? [-uz, ux] : [uz, -ux];
			const len = distance(ax, az, bx, bz);
			for (let s = 1; s < len - 1; s += 0.5) {
				const x = ax + ux * s;
				const z = az + uz * s;
				if (nearLedge(x + out[0], z + out[1])) continue;
				const top = heightAt(world.heights, x - out[0] * 0.5, z - out[1] * 0.5);
				const foot = heightAt(world.heights, x + out[0] * 1.5, z + out[1] * 1.5);
				expect((top - foot) / 2, `${x.toFixed(1)}, ${z.toFixed(1)}`).toBeGreaterThan(tooSteep);
				sampled++;
			}
		}
		expect(sampled).toBeGreaterThan(80);
	});
});
