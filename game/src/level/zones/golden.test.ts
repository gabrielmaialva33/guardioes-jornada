import { describe, expect, it } from 'vitest';
import { checksumOf } from '../../survival/checksum.ts';
import { buildParkFresh } from './park.ts';
import { ZONE_IDS, ZONE_VERSION } from './spec.ts';

/**
 * Pinned per zone for ZONE_VERSION 2 (the Reserva: level/build.test.ts's pins,
 * which the adapter must keep). A change means a zone changed: bump
 * ZONE_VERSION (or STORY_VERSION for the Reserva) and re-pin. The same values
 * must come out of every engine (p20-zonas.md, p25-vale.md: cross-engine page).
 * Version 2 is the zone-content wave, unshipped: the Vale (P25), the Copa
 * (P31), the Praia (P33) and the Manguezal (pB's P30) re-pin without a bump
 * while the zones fill in. Checked
 * facts and their sources (p27-fatos-guia.md) are text only: they move the
 * level halves alone, without a bump. The sloths' broadleaf crowns and the
 * bugios' daytime howling (the same check) re-pin the Vale and the Copa.
 */
export const GOLDEN_ZONES: Record<string, [world: number, level: number]> = {
	reserva: [0xdc12d197, 0x15eafb12],
	vale: [0xd73a9db0, 0xc917cb9e],
	copa: [0xc2f6aed5, 0xcebcfd3c],
	praia: [0xc993ece7, 0xbe5404c2],
	manguezal: [0xdcf2ef02, 0x5a4fcb8c]
};

describe('golden zone checksums', () => {
	const park = buildParkFresh();
	it('keeps the zone version', () => {
		expect(ZONE_VERSION).toBe(2);
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
