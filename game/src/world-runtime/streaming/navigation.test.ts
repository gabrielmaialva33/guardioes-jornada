import { expect, it } from 'vitest';
import { buildStoryWorld } from '../../level/build.ts';
import { buildZone } from '../../level/zones/park.ts';
import { lightAt, sampleHeight, sampleWater, streamSelection } from './navigation.ts';
import { chunkId } from './types.ts';
import { cutZone } from './zone-cut.ts';

it('selects park streaming and valid standalone zones without stealing graybox/survival fixtures', () => {
	expect(streamSelection('')).toEqual({ enabled: true, zone: null });
	expect(streamSelection('?debug&zone=vale')).toEqual({ enabled: true, zone: 'vale' });
	expect(streamSelection('?zone=unknown')).toEqual({ enabled: true, zone: null });
	expect(streamSelection('?graybox')).toEqual({ enabled: false, zone: null });
	expect(streamSelection('?world=survival')).toEqual({ enabled: false, zone: null });
});

it('samples loaded heights bilinearly in world coordinates and never fabricates pending ground', () => {
	const zone = buildZone('vale');
	const chunks = new Map(cutZone(zone, new Map([['vale', zone]])).chunks.map((c) => [c.key, c]));
	const lookup = (x: number, z: number) => chunks.get(chunkId(x, z));
	const x = zone.offsetX + 33.25,
		z = zone.offsetZ + 52.5;
	const h = zone.world.heights,
		g = zone.world.grid,
		i = 52 * g + 33;
	const expected = (h[i] * 0.75 + h[i + 1] * 0.25) * 0.5 + (h[i + g] * 0.75 + h[i + g + 1] * 0.25) * 0.5;
	expect(sampleHeight(lookup, x, z)).toBeCloseTo(expected, 6);
	expect(sampleHeight(lookup, -1000, -1000)).toBeNull();
});

it('uses the authored pool and river in global coordinates for respawn and wading', () => {
	const { level } = buildStoryWorld();
	const zone = buildZone('reserva');
	const chunks = new Map(cutZone(zone, new Map([['reserva', zone]])).chunks.map((c) => [c.key, c]));
	const lookup = (x: number, z: number) => chunks.get(chunkId(x, z));
	expect(sampleWater(lookup, level.pool.x, level.pool.z)).toBeCloseTo(level.pool.water, 6);
	expect(sampleWater(lookup, -1000, -1000)).toBeNull();
});

it('has a deterministic day/dusk/night cycle and supports frozen debug/golden light', () => {
	expect(lightAt(0)).toBe('day');
	expect(lightAt(16 * 60)).toBe('dusk');
	expect(lightAt(18 * 60)).toBe('night');
	expect(lightAt(24 * 60)).toBe('day');
	expect(lightAt(-1)).toBe('night');
	expect(lightAt(5, 'night')).toBe('night');
	expect(lightAt(5, 'bad')).toBe('day');
});
