import { expect, it } from 'vitest';
import { buildZone } from '../../level/zones/park.ts';
import { GroundClipmap } from './ground-clipmap.ts';
import { cutZone } from './zone-cut.ts';

it('publishes path/shade pixels and origin atomically, and reuses its two small textures after moving', () => {
	const zone = buildZone('vale'),
		chunks = cutZone(zone, new Map([['vale', zone]])).chunks;
	const field = new GroundClipmap(64, 160);
	const texture = field.paths,
		shade = field.shade;
	field.request(200, 80, chunks, 1);
	expect(field.revision).toBe(0);
	for (let i = 0; i < 300 && field.revision !== 1; i++) field.step(0.2);
	expect(field.revision).toBe(1);
	expect(field.origin.x).toBe(120);
	expect(field.pathPixels.some((v) => v < 200)).toBe(true);
	expect(field.shadePixels.some((v) => v < 255)).toBe(true);
	const before = field.pathPixels.slice();
	field.request(600, 80, [], 2);
	field.step(0);
	expect(field.origin.x).toBe(120);
	expect(field.pathPixels).toEqual(before);
	for (let i = 0; i < 300 && field.revision !== 2; i++) field.step(0.2);
	expect(field.origin.x).toBe(520);
	expect(field.paths).toBe(texture);
	expect(field.shade).toBe(shade);
	expect(field.pathPixels.every((v) => v === 255)).toBe(true);
	field.dispose();
	field.dispose();
});
