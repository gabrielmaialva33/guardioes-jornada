import { expect, it } from 'vitest';
import produced from '../assets/skins/avatar-regions.json';
import fixture from './atlas.fixture.json';
import { composePixels, decodeAvatarAtlas } from './atlas.ts';

it('validates the v1 atlas/presets and rejects out-of-bounds or ambiguous input', () => {
	const atlas = decodeAvatarAtlas(fixture);
	expect(atlas.presets).toHaveLength(18);
	expect(() => decodeAvatarAtlas({ ...fixture, version: 2 })).toThrow();
	expect(() =>
		decodeAvatarAtlas({ ...fixture, slots: { ...fixture.slots, hair: [[63, 0, 2, 2]] } })
	).toThrow();
	expect(() => decodeAvatarAtlas({ ...fixture, paintOrder: ['skin', 'skin'] })).toThrow();
	expect(() =>
		decodeAvatarAtlas({
			...fixture,
			face: { ...fixture.face, decals: { smile: ['not-valid'], neutral: ['...'] } }
		})
	).toThrow();
});
it('paints in declared order, then draws the nearest-neighbour face while preserving transparent cells', () => {
	const data = {
		...fixture,
		slots: {
			skin: [[0, 0, 64, 64]],
			shirt: [[20, 20, 2, 2]],
			pants: [[30, 30, 2, 2]],
			shoes: [],
			hair: [[0, 0, 2, 2]]
		},
		face: { rect: [0, 0, 2, 2], decals: { smile: ['k.', '.m'], neutral: ['..', '..'] } }
	};
	const atlas = decodeAvatarAtlas(data);
	const colors = { skin: '#112233', shirt: '#223344', pants: '#334455', shoes: '#445566', hair: '#556677' };
	const pixels = composePixels(atlas, colors, 'smile');
	const pixel = (x: number, y: number) => Array.from(pixels.slice((y * 64 + x) * 4, (y * 64 + x) * 4 + 4));
	expect(pixel(0, 0)).toEqual([30, 30, 36, 255]);
	expect(pixel(1, 0)).toEqual([85, 102, 119, 255]);
	expect(pixel(1, 1)).toEqual([90, 46, 46, 255]);
	expect(pixel(20, 20)).toEqual([34, 51, 68, 255]);
	expect(pixel(30, 30)).toEqual([51, 68, 85, 255]);
	expect(pixel(63, 63)).toEqual([17, 34, 51, 255]);
});

it('consumes the produced v1 atlas with eighteen diverse presets', () => {
	const atlas = decodeAvatarAtlas(produced);
	expect(atlas.presets).toHaveLength(18);
	expect(new Set(atlas.presets.map((p) => p.colors.skin)).size).toBeGreaterThan(8);
});
it('accepts the v2 hair contract and gives v1 presets their painted short style', () => {
	const atlas = decodeAvatarAtlas(fixture);
	expect(atlas.hairStyles.map((s) => s.id)).toEqual(['curto']);
	expect(atlas.presets[0].hairStyle).toBe('curto');
	const styles = [
		{ id: 'curto', name: 'Curto', mesh: null },
		{ id: 'longo', name: 'Longo', mesh: 'hair-long' }
	];
	const v2 = decodeAvatarAtlas({
		...fixture,
		version: 2,
		hairStyles: styles,
		presets: fixture.presets.map((p) => ({ ...p, hairStyle: 'longo' }))
	});
	expect(v2.presets[0].hairStyle).toBe('longo');
	expect(() =>
		decodeAvatarAtlas({
			...fixture,
			version: 2,
			hairStyles: styles,
			presets: fixture.presets.map((p) => ({ ...p, hairStyle: 'missing' }))
		})
	).toThrow();
});
