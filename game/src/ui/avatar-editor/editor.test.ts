import { describe, expect, it } from 'vitest';
import { AVATAR_ATLAS, AVATAR_PRESETS, DEFAULT_AVATAR, KENNEY_SKINS } from '../../avatar/catalog.ts';
import { AVATAR_PARTS, type AvatarProfile } from '../../data/local-save.ts';
import { ACCENT } from '../../style/palette.ts';
import {
	buildSwatches,
	CLASSIC_OPTION_ID,
	cloneProfile,
	EDITOR_TABS,
	faceOptions,
	framingFor,
	GOLD_MESSAGE,
	goldForbidden,
	gridMove,
	hairOptions,
	hairViewFor,
	isReservedGold,
	presetOptions,
	presetSelected,
	profileKey,
	sameProfile,
	selectPreset,
	setColor,
	setFace,
	setHairStyle,
	setKenneySkin,
	skinOptions,
	tabMove,
	thumbnailKey,
	useClassic
} from './editor.ts';

const draft = (): AvatarProfile => cloneProfile(DEFAULT_AVATAR);

describe('tabs and framing', () => {
	it('has the six Roblox-style categories in order', () => {
		expect(EDITOR_TABS.map((tab) => tab.id)).toEqual(['presets', 'skin', 'face', 'hair', 'clothes', 'skins']);
		expect(EDITOR_TABS.map((tab) => tab.label)).toEqual([
			'Prontos',
			'Pele',
			'Rosto',
			'Cabelo',
			'Roupas',
			'Skins'
		]);
	});
	it('frames the head for face and hair, the whole body for the rest', () => {
		expect(framingFor('face')).toBe('head');
		expect(framingFor('hair')).toBe('head');
		for (const tab of ['presets', 'skin', 'clothes', 'skins'] as const) expect(framingFor(tab)).toBe('body');
	});
});

describe('draft and apply semantics', () => {
	it('edits a copy: the saved profile is never mutated', () => {
		const saved = cloneProfile(DEFAULT_AVATAR);
		const copy = cloneProfile(saved);
		const edited = setColor(copy, 'shirt', '#3e9ccf').draft;
		expect(saved.colors.shirt).toBe(DEFAULT_AVATAR.colors.shirt);
		expect(copy.colors.shirt).toBe(DEFAULT_AVATAR.colors.shirt);
		expect(edited.colors.shirt).toBe('#3e9ccf');
		expect(edited.colors).not.toBe(copy.colors);
	});
	it('every classic choice returns to the classic style; a skin keeps the classic choices underneath', () => {
		const skin = setKenneySkin(draft(), 'c');
		expect(skin.style).toBe('kenney');
		expect(skin.kenneySkin).toBe('c');
		expect(skin.colors).toEqual(DEFAULT_AVATAR.colors);
		expect(setFace(skin, 'neutral').style).toBe('classic');
		expect(setHairStyle(skin, 'rabo').style).toBe('classic');
		expect(setColor(skin, 'skin', '#8c583a').draft.style).toBe('classic');
		expect(selectPreset(skin, AVATAR_PRESETS[3]).style).toBe('classic');
		expect(useClassic(skin)).toEqual({ ...skin, style: 'classic' });
	});
	it('a preset sets colours, face and hair, and reads as selected', () => {
		const preset = AVATAR_PRESETS[4];
		const next = selectPreset(draft(), preset);
		expect(next.colors).toEqual(preset.colors);
		expect(next.colors).not.toBe(preset.colors);
		expect(next.face).toBe(preset.face);
		expect(next.hairStyle).toBe(preset.hairStyle);
		expect(presetSelected(next, preset)).toBe(true);
		expect(presetSelected(setColor(next, 'pants', '#6b4f3a').draft, preset)).toBe(false);
		expect(presetSelected(setKenneySkin(next, 'a'), preset)).toBe(false);
	});
	it('profile keys ignore classic choices hidden under a skin', () => {
		const a = setKenneySkin(draft(), 'b');
		const b = setKenneySkin(setColor(draft(), 'shirt', '#2f7fb0').draft, 'b');
		expect(profileKey(a)).toBe(profileKey(b));
		expect(sameProfile(a, b)).toBe(false);
		expect(profileKey(draft())).not.toBe(profileKey(setHairStyle(draft(), 'coque')));
		expect(thumbnailKey('head', a)).not.toBe(thumbnailKey('body', a));
	});
});

describe('the gold rule', () => {
	it('refuses the objectives gold, and colours too close to tell apart, on shirt, pants and shoes', () => {
		for (const part of ['shirt', 'pants', 'shoes'] as const) {
			for (const gold of [ACCENT.gold, ACCENT.gold.toUpperCase(), '#ffd167', '#f8cc62']) {
				const result = setColor(draft(), part, gold);
				expect(result.message).toBe(GOLD_MESSAGE);
				expect(result.changed).toBe(false);
				expect(result.draft.colors[part]).toBe(DEFAULT_AVATAR.colors[part]);
			}
		}
	});
	it('allows gold on skin and hair, and ipê-amarelo on clothes', () => {
		expect(goldForbidden('hair', ACCENT.gold)).toBe(false);
		expect(goldForbidden('skin', ACCENT.gold)).toBe(false);
		expect(isReservedGold(ACCENT.ipeAmarelo)).toBe(false);
		const result = setColor(draft(), 'shirt', ACCENT.ipeAmarelo);
		expect(result.message).toBe('');
		expect(result.draft.colors.shirt).toBe(ACCENT.ipeAmarelo);
	});
	it('ignores malformed colours', () => {
		expect(setColor(draft(), 'shirt', 'red').changed).toBe(false);
	});
});

describe('swatches', () => {
	const swatches = buildSwatches(AVATAR_PRESETS);
	it('never offers gold on clothes and offers every preset colour', () => {
		for (const part of ['shirt', 'pants', 'shoes'] as const)
			expect(swatches[part].some((s) => isReservedGold(s.hex))).toBe(false);
		for (const preset of AVATAR_PRESETS)
			for (const part of AVATAR_PARTS)
				expect(swatches[part].map((s) => s.hex)).toContain(preset.colors[part].toLowerCase());
	});
	it('names every swatch in Portuguese, skin tones by number', () => {
		for (const part of AVATAR_PARTS)
			for (const swatch of swatches[part]) expect(swatch.name).toMatch(/^[\p{L} -]+( \d+)?$/u);
		expect(swatches.skin[0].name).toBe('Tom de pele 1');
		expect(new Set(swatches.shirt.map((s) => s.hex)).size).toBe(swatches.shirt.length);
	});
	it('keeps at most two greens among the shirts (ART.md)', () => {
		const greens = swatches.shirt.filter((s) => s.name.startsWith('Verde'));
		expect(greens.length).toBeLessThanOrEqual(2);
	});
});

describe('grid options', () => {
	it('each option thumbnail shows the draft after picking it', () => {
		const base = setColor(draft(), 'hair', '#c9a27a').draft;
		const hair = hairOptions(base, AVATAR_ATLAS.hairStyles);
		expect(hair).toHaveLength(AVATAR_ATLAS.hairStyles.length);
		const rabo = hair.find((option) => option.id === 'rabo');
		expect(rabo?.label).toBe('Cabelo rabo de cavalo');
		expect(rabo?.profile.hairStyle).toBe('rabo');
		expect(rabo?.profile.colors.hair).toBe('#c9a27a');
		expect(rabo?.framing).toBe('head');
		expect(hair.filter((option) => option.selected).map((option) => option.id)).toEqual([base.hairStyle]);
	});
	it('hair styles that hang at the back (ponytail, braids, bun) get a back view; the rest stay front', () => {
		const hair = hairOptions(draft(), AVATAR_ATLAS.hairStyles);
		const back = hair.filter((option) => option.view === 'back').map((option) => option.id);
		expect(back.sort()).toEqual(['coque', 'rabo', 'trancas']);
		for (const option of hair) if (option.view !== 'back') expect(option.view).toBe('front');
		expect(hairViewFor('longo')).toBe('front');
		expect(hairViewFor('unknown')).toBe('front');
		const rabo = hair.find((option) => option.id === 'rabo');
		if (!rabo) throw new Error('rabo');
		// A separate cache entry from the front picture of the same look; front keys are unchanged.
		expect(thumbnailKey('head', rabo.profile, 'back')).not.toBe(thumbnailKey('head', rabo.profile));
		expect(thumbnailKey('head', rabo.profile, 'front')).toBe(thumbnailKey('head', rabo.profile));
		expect(faceOptions(draft()).every((option) => option.view === undefined)).toBe(true);
	});
	it('faces frame the head; presets and skins the body', () => {
		expect(faceOptions(draft()).map((o) => [o.label, o.framing, o.selected])).toEqual([
			['Rosto com sorriso', 'head', DEFAULT_AVATAR.face === 'smile'],
			['Rosto neutro', 'head', DEFAULT_AVATAR.face === 'neutral']
		]);
		const presets = presetOptions(draft(), AVATAR_PRESETS);
		expect(presets).toHaveLength(18);
		expect(presets[0].label).toBe(`Visual ${AVATAR_PRESETS[0].name}`);
		expect(presets.every((o) => o.framing === 'body')).toBe(true);
	});
	it('skins start with the way back to the classic colours', () => {
		const ids = Object.keys(KENNEY_SKINS);
		const options = skinOptions(setKenneySkin(draft(), 'd'), ids);
		expect(options).toHaveLength(19);
		expect(options[0].id).toBe(CLASSIC_OPTION_ID);
		expect(options[0].profile.style).toBe('classic');
		expect(options.filter((o) => o.selected).map((o) => o.id)).toEqual(['d']);
		expect(options[4].label).toBe('Skin D');
		expect(skinOptions(draft(), ids)[0].selected).toBe(true);
	});
	it('thumbnail keys repeat only for identical looks', () => {
		const keys = presetOptions(draft(), AVATAR_PRESETS).map((o) => thumbnailKey(o.framing, o.profile));
		expect(new Set(keys).size).toBe(18);
	});
});

describe('keyboard', () => {
	it('tab list arrows wrap; Home and End jump', () => {
		expect(tabMove('ArrowRight', 5, 6)).toBe(0);
		expect(tabMove('ArrowLeft', 0, 6)).toBe(5);
		expect(tabMove('Home', 3, 6)).toBe(0);
		expect(tabMove('End', 1, 6)).toBe(5);
		expect(tabMove('Enter', 1, 6)).toBeNull();
	});
	it('grid arrows move by item and by row, stopping at the top and bottom', () => {
		// 4 columns, 10 items: rows 0–3, 4–7, 8–9.
		expect(gridMove('ArrowRight', 3, 10, 4)).toBe(4);
		expect(gridMove('ArrowRight', 9, 10, 4)).toBe(0);
		expect(gridMove('ArrowLeft', 0, 10, 4)).toBe(9);
		expect(gridMove('ArrowDown', 1, 10, 4)).toBe(5);
		expect(gridMove('ArrowDown', 6, 10, 4)).toBe(6);
		expect(gridMove('ArrowUp', 5, 10, 4)).toBe(1);
		expect(gridMove('ArrowUp', 2, 10, 4)).toBe(2);
		expect(gridMove('End', 2, 10, 4)).toBe(9);
		expect(gridMove('a', 2, 10, 4)).toBeNull();
		expect(gridMove('ArrowDown', 0, 3, 0)).toBe(1);
	});
});
