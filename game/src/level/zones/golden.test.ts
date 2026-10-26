import { describe, expect, it } from 'vitest';
import { checksumOf } from '../../survival/checksum.ts';
import { buildParkFresh } from './park.ts';
import { ZONE_IDS, ZONE_VERSION } from './spec.ts';

/**
 * Pinned per zone for ZONE_VERSION 1 (the Reserva: level/build.test.ts's pins,
 * which the adapter must keep). A change means a zone changed: bump
 * ZONE_VERSION (or STORY_VERSION for the Reserva) and re-pin. The same values
 * must come out of every engine (p20-zonas.md, cross-engine page).
 */
export const GOLDEN_ZONES: Record<string, [world: number, level: number]> = {
	reserva: [0x222da2a5, 0x23064a06],
	vale: [0x0c6c3db7, 0xe148edec],
	copa: [0x6b0f190a, 0x955b8576],
	praia: [0x4e8cea81, 0x81bdd4d6],
	manguezal: [0xf1d3e262, 0x4ce07c6a]
};

describe('golden zone checksums', () => {
	const park = buildParkFresh();
	it('keeps the zone version', () => {
		expect(ZONE_VERSION).toBe(1);
	});
	it.each([...ZONE_IDS])('%s', (id) => {
		const zone = park.get(id);
		if (!zone) throw new Error(id);
		expect(checksumOf(zone.world)).toBe(zone.world.checksum);
		expect(checksumOf(zone.level)).toBe(zone.level.checksum);
		expect([zone.world.checksum, zone.level.checksum].map((c) => `0x${c.toString(16)}`)).toEqual(
			GOLDEN_ZONES[id].map((c) => `0x${c.toString(16)}`)
		);
	});
});
