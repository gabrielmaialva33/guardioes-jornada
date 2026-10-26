import { describe, expect, it } from 'vitest';
import type { ManguezalContent } from '../level/zones/manguezal.ts';
import { buildParkFresh } from '../level/zones/park.ts';
import { ZONE_IDS, type ZoneId } from '../level/zones/spec.ts';
import { SOUNDS } from './bank.ts';
import { DEFAULT_SOUNDS, groundAt, nearestPoint, type ZoneSounds, zoneSounds } from './zone-sounds.ts';

const park = buildParkFresh();
const plan = (id: ZoneId): ZoneSounds => {
	const zone = park.get(id);
	if (!zone) throw new Error(id);
	return zoneSounds(id, zone.world, zone.level);
};
const zone = (id: ZoneId) => {
	const built = park.get(id);
	if (!built) throw new Error(id);
	return built;
};
const triples = (points: Float32Array) =>
	Array.from({ length: points.length / 3 }, (_, k) => [points[3 * k], points[3 * k + 1], points[3 * k + 2]]);

describe('zone sounds', () => {
	it('keeps the default soundscape in the Reserva', () => {
		expect(plan('reserva')).toEqual(DEFAULT_SOUNDS);
	});

	it('adds the far roar at the Vale’s waterfall, over the default bed, stream and near roar', () => {
		const vale = plan('vale');
		const fall = zone('vale').level.landmarks.find((l) => l.kind === 'waterfall');
		expect(fall).toBeTruthy();
		expect(vale.forest).toBe(1);
		expect(vale.river).toBe(true);
		expect(vale.fixed).toEqual([{ id: 'waterfall-far', x: fall?.x, y: fall?.y, z: fall?.z }]);
	});

	it('puts the canopy birds in the Copa, louder up on the walkway', () => {
		const copa = plan('copa');
		expect(copa.canopy?.id).toBe('canopy-birds');
		expect(copa.canopy?.low).toBeGreaterThan(0);
		expect(copa.canopy?.low).toBeLessThan(1);
		expect(copa.forest).toBe(1);
	});

	it('splits the Praia’s waterline into the costão and the beach', () => {
		const praia = plan('praia');
		const { world, level } = zone('praia');
		const [rocks, sand] = ['surf-rocks', 'surf-beach'].map((id) => praia.follow.find((f) => f.id === id));
		expect(rocks && sand).toBeTruthy();
		const rockPoints = triples(rocks?.points ?? new Float32Array());
		const sandPoints = triples(sand?.points ?? new Float32Array());
		expect(rockPoints.length).toBeGreaterThan(5);
		expect(sandPoints.length).toBeGreaterThan(rockPoints.length);
		for (const [, y] of [...rockPoints, ...sandPoints]) expect(y).toBe(world.waterLevel);
		// The costão's waterline hugs its rock, the lookout on top of it; the beach runs far along the coast.
		const lookout = level.landmarks.find((l) => l.kind === 'lookout');
		if (!lookout) throw new Error('no costão lookout');
		const far = (p: number[]) => Math.hypot(p[0] - lookout.x, p[2] - lookout.z);
		expect(Math.max(...rockPoints.map(far))).toBeLessThan(30);
		expect(Math.max(...sandPoints.map(far))).toBeGreaterThan(60);
		expect(praia.river).toBe(false);
	});

	it('floods the Manguezal with lapping and the clicks at the crab banks, without the forest or a stream', () => {
		const mangue = plan('manguezal');
		const { level } = zone('manguezal');
		const content = level.content as ManguezalContent;
		expect(mangue.forest).toBe(0);
		expect(mangue.river).toBe(false);
		expect(mangue.beds).toEqual(['mangrove-water']);
		expect(mangue.follow.map((f) => f.id)).toEqual(['mangrove-clicks']);
		expect(triples(mangue.follow[0].points)).toEqual(
			content.crabs.map((c) => [c.x, c.y, c.z].map(Math.fround))
		);
	});

	it('uses loops for beds and emitters, placed only where they stand or follow the listener', () => {
		for (const id of ZONE_IDS) {
			const p = plan(id);
			for (const bed of [...p.beds, ...(p.canopy ? [p.canopy.id] : [])]) {
				expect('loop' in SOUNDS[bed], bed).toBe(true);
				expect('spatial' in SOUNDS[bed], bed).toBe(false);
			}
			for (const { id: placed } of [...p.fixed, ...p.follow]) {
				expect('loop' in SOUNDS[placed], placed).toBe(true);
				expect('spatial' in SOUNDS[placed], placed).toBe(true);
			}
			// P15 §9: at most six loops at once, leaving voices for the player, the missions and the animals.
			const loops =
				(p.forest > 0 ? 1 : 0) + (p.river ? 1 : 0) + 1 + p.beds.length + p.fixed.length + p.follow.length;
			expect(loops + (p.canopy ? 1 : 0), id).toBeLessThanOrEqual(6);
		}
	});
});

describe('zone sound helpers', () => {
	it('finds the nearest point of a set', () => {
		const out = { x: 0, y: 0, z: 0 };
		expect(nearestPoint(new Float32Array(), 0, 0, out)).toBe(false);
		expect(nearestPoint(Float32Array.from([0, 1, 0, 10, 2, 10, 4, 3, 5]), 5, 6, out)).toBe(true);
		expect(out).toEqual({ x: 4, y: 3, z: 5 });
	});

	it('samples the ground on a zone’s own grid, wider than the Reserva’s', () => {
		const { world } = zone('praia');
		expect(world.grid).toBeGreaterThan(161);
		const i = 150;
		const j = 40;
		expect(groundAt(world, i, j)).toBeCloseTo(world.heights[j * world.grid + i], 5);
		expect(groundAt(world, i + 0.5, j)).toBeCloseTo(
			(world.heights[j * world.grid + i] + world.heights[j * world.grid + i + 1]) / 2,
			5
		);
	});
});
