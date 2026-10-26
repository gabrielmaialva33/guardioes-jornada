/**
 * Pure logic of the avatar editor: its tabs, the draft and what each choice does
 * to it, the gold rule, the colour swatches, the thumbnail options of each tab
 * and the keyboard moves of its tab list and grids. No DOM, no three.js.
 *
 * Draft semantics (as the old AvatarChooser): the editor edits a copy of the
 * saved profile; "Usar este personagem" hands the copy to the game, "Cancelar"
 * drops it. Every classic choice (preset, colour, face, hair) turns the draft
 * back to the classic style; picking a Kenney skin turns it to the skin style
 * and keeps the classic choices underneath, so going back restores them.
 */
import type { AvatarPreset, HairStyle } from '../../avatar/atlas.ts';
import {
	AVATAR_PARTS,
	type AvatarPart,
	type AvatarProfile,
	type HairStyleId
} from '../../data/local-save.ts';
import { ACCENT, RAMPS } from '../../style/palette.ts';

export type TabId = 'presets' | 'skin' | 'face' | 'hair' | 'clothes' | 'skins';
/** Where the preview camera looks: the whole body on the pedestal, or the head. */
export type FramingId = 'body' | 'head';
export type TabIcon = 'presets' | 'skin' | 'face' | 'hair' | 'clothes' | 'skins';

export interface EditorTab {
	readonly id: TabId;
	/** Short label under the icon. */
	readonly label: string;
	/** Full name: the tab's accessible name and the panel heading. */
	readonly title: string;
	readonly icon: TabIcon;
	readonly framing: FramingId;
}

/** Roblox's flow: face and hair look at the head, everything else at the whole body. */
export const EDITOR_TABS: readonly EditorTab[] = [
	{ id: 'presets', label: 'Prontos', title: 'Visuais prontos', icon: 'presets', framing: 'body' },
	{ id: 'skin', label: 'Pele', title: 'Cor da pele', icon: 'skin', framing: 'body' },
	{ id: 'face', label: 'Rosto', title: 'Rosto', icon: 'face', framing: 'head' },
	{ id: 'hair', label: 'Cabelo', title: 'Cabelo', icon: 'hair', framing: 'head' },
	{ id: 'clothes', label: 'Roupas', title: 'Roupas', icon: 'clothes', framing: 'body' },
	{ id: 'skins', label: 'Skins', title: 'Skins da Kenney', icon: 'skins', framing: 'body' }
];

export function framingFor(tab: TabId): FramingId {
	return EDITOR_TABS.find((t) => t.id === tab)?.framing ?? 'body';
}

// --- Draft ----------------------------------------------------------------------

export function cloneProfile(profile: AvatarProfile): AvatarProfile {
	return { ...profile, hairStyle: profile.hairStyle ?? 'curto', colors: { ...profile.colors } };
}

/** What the avatar shows: the classic choices are invisible under a Kenney skin. */
export function profileKey(profile: AvatarProfile): string {
	if (profile.style === 'kenney') return `k:${profile.kenneySkin}`;
	return `c:${AVATAR_PARTS.map((part) => profile.colors[part].toLowerCase()).join(':')}:${profile.face}:${profile.hairStyle ?? 'curto'}`;
}

/** Same saved data, including the classic choices kept under a skin. */
export function sameProfile(a: AvatarProfile, b: AvatarProfile): boolean {
	return (
		a.style === b.style &&
		a.kenneySkin === b.kenneySkin &&
		a.face === b.face &&
		(a.hairStyle ?? 'curto') === (b.hairStyle ?? 'curto') &&
		AVATAR_PARTS.every((part) => a.colors[part].toLowerCase() === b.colors[part].toLowerCase())
	);
}

export const GOLD_MESSAGE = 'O dourado fica reservado aos objetivos da trilha.';
/** Parts that may never wear the objectives' gold (ART.md, Avatar). */
export const CLOTHES = ['shirt', 'pants', 'shoes'] as const satisfies readonly AvatarPart[];
/**
 * RGB distance under which a colour reads as the objectives' gold. Ipê-amarelo
 * (#f2c94c, 30 away) stays allowed: it is a preset shirt.
 */
export const GOLD_TOLERANCE = 20;

function rgb(hex: string): [number, number, number] | null {
	if (!/^#[0-9a-f]{6}$/i.test(hex)) return null;
	const n = Number.parseInt(hex.slice(1), 16);
	return [n >> 16, (n >> 8) & 255, n & 255];
}

/** ACCENT.gold itself or a colour a child could not tell from it. */
export function isReservedGold(hex: string): boolean {
	const color = rgb(hex);
	const gold = rgb(ACCENT.gold);
	if (!color || !gold) return false;
	const dr = color[0] - gold[0],
		dg = color[1] - gold[1],
		db = color[2] - gold[2];
	return Math.sqrt(dr * dr + dg * dg + db * db) < GOLD_TOLERANCE;
}

export function goldForbidden(part: AvatarPart, hex: string): boolean {
	return (CLOTHES as readonly AvatarPart[]).includes(part) && isReservedGold(hex);
}

export interface EditResult {
	draft: AvatarProfile;
	/** Status text for the child; '' when the change went through. */
	message: string;
	changed: boolean;
}

export function setColor(draft: AvatarProfile, part: AvatarPart, hex: string): EditResult {
	const value = hex.toLowerCase();
	if (!rgb(value)) return { draft, message: '', changed: false };
	if (goldForbidden(part, value)) return { draft, message: GOLD_MESSAGE, changed: false };
	const next: AvatarProfile = {
		...draft,
		style: 'classic',
		colors: { ...draft.colors, [part]: value }
	};
	return { draft: next, message: '', changed: !sameProfile(next, draft) };
}

export function selectPreset(draft: AvatarProfile, preset: AvatarPreset): AvatarProfile {
	return {
		...draft,
		style: 'classic',
		colors: { ...preset.colors },
		face: preset.face,
		hairStyle: preset.hairStyle
	};
}

export function presetSelected(draft: AvatarProfile, preset: AvatarPreset): boolean {
	return (
		draft.style === 'classic' &&
		draft.face === preset.face &&
		(draft.hairStyle ?? 'curto') === preset.hairStyle &&
		AVATAR_PARTS.every((part) => draft.colors[part].toLowerCase() === preset.colors[part].toLowerCase())
	);
}

export function setFace(draft: AvatarProfile, face: AvatarProfile['face']): AvatarProfile {
	return { ...draft, style: 'classic', face, colors: { ...draft.colors } };
}

export function setHairStyle(draft: AvatarProfile, hairStyle: HairStyleId): AvatarProfile {
	return { ...draft, style: 'classic', hairStyle, colors: { ...draft.colors } };
}

export function setKenneySkin(draft: AvatarProfile, kenneySkin: string): AvatarProfile {
	return { ...draft, style: 'kenney', kenneySkin, colors: { ...draft.colors } };
}

export function useClassic(draft: AvatarProfile): AvatarProfile {
	return { ...draft, style: 'classic', colors: { ...draft.colors } };
}

// --- Swatches -------------------------------------------------------------------

export interface Swatch {
	readonly hex: string;
	readonly name: string;
}

const RAMP_NAMES: Readonly<Record<string, string>> = {
	[RAMPS.water[0]]: 'Azul-rio',
	[RAMPS.water[1]]: 'Azul-lagoa',
	[RAMPS.water[2]]: 'Azul-céu',
	[RAMPS.water[3]]: 'Azul-claro',
	[RAMPS.wood[0]]: 'Madeira escura',
	[RAMPS.wood[1]]: 'Madeira',
	[RAMPS.wood[2]]: 'Madeira clara',
	[RAMPS.wood[3]]: 'Bege',
	[RAMPS.soil[0]]: 'Terra escura',
	[RAMPS.soil[1]]: 'Terra',
	[RAMPS.soil[2]]: 'Terra clara',
	[RAMPS.soil[3]]: 'Areia',
	[RAMPS.rock[0]]: 'Pedra escura',
	[RAMPS.rock[1]]: 'Pedra',
	[RAMPS.rock[2]]: 'Pedra clara',
	[RAMPS.rock[3]]: 'Cinza-claro',
	[RAMPS.leaf[0]]: 'Verde-mata',
	[RAMPS.leaf[1]]: 'Verde-folha',
	[RAMPS.leaf[2]]: 'Verde',
	[RAMPS.leaf[3]]: 'Verde-claro',
	[ACCENT.ipeAmarelo]: 'Amarelo-ipê',
	[ACCENT.ipeRosa]: 'Rosa-ipê'
};

const HAIR_NAMES: Readonly<Record<string, string>> = {
	'#241c18': 'Preto',
	'#2a201c': 'Castanho bem escuro',
	'#3b281e': 'Castanho-escuro',
	'#5a4232': 'Castanho',
	'#5e4330': 'Castanho-avermelhado',
	'#8a6448': 'Castanho-claro',
	'#a8805c': 'Loiro-escuro',
	'#c9a27a': 'Loiro',
	[RAMPS.water[2]]: 'Azul-céu',
	[ACCENT.ipeRosa]: 'Rosa-ipê'
};

function luminance(hex: string): number {
	const c = rgb(hex);
	return c ? 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2] : 0;
}

function unique(values: readonly string[]): string[] {
	return [...new Set(values.map((value) => value.toLowerCase()))];
}

/**
 * The colours offered per part, in display order. Clothes come from the ART.md
 * ramps (water, ipê accents, wood, soil, rock, two greens at most), skins and
 * hair from the presets; every preset colour is always offered, so a preset
 * shows as a selected swatch. Gold never appears on clothes.
 */
export function buildSwatches(presets: readonly AvatarPreset[]): Readonly<Record<AvatarPart, Swatch[]>> {
	const from = (part: AvatarPart) => presets.map((preset) => preset.colors[part]);
	const lists: Record<AvatarPart, string[]> = {
		skin: unique(from('skin')).sort((a, b) => luminance(b) - luminance(a)),
		hair: [
			...unique(from('hair')).sort((a, b) => luminance(a) - luminance(b)),
			RAMPS.water[2],
			ACCENT.ipeRosa
		],
		shirt: [
			...RAMPS.water,
			ACCENT.ipeAmarelo,
			ACCENT.ipeRosa,
			...RAMPS.wood,
			...RAMPS.soil,
			...RAMPS.rock,
			RAMPS.leaf[1],
			RAMPS.leaf[2],
			...from('shirt')
		],
		pants: [RAMPS.water[0], RAMPS.water[1], ...RAMPS.wood, ...RAMPS.soil, ...RAMPS.rock, ...from('pants')],
		shoes: [...RAMPS.rock, ...RAMPS.wood, ...RAMPS.soil, ...from('shoes')]
	};
	const result = {} as Record<AvatarPart, Swatch[]>;
	for (const part of AVATAR_PARTS) {
		const hexes = unique(lists[part]).filter((hex) => !goldForbidden(part, hex));
		result[part] = hexes.map((hex, i) => ({
			hex,
			name:
				part === 'skin'
					? `Tom de pele ${i + 1}`
					: ((part === 'hair' ? HAIR_NAMES[hex] : undefined) ?? RAMP_NAMES[hex] ?? `Cor ${i + 1}`)
		}));
	}
	return result;
}

export const PART_LABELS: Readonly<Record<AvatarPart, string>> = {
	skin: 'Pele',
	hair: 'Cabelo',
	shirt: 'Camiseta',
	pants: 'Calça',
	shoes: 'Sapatos'
};

// --- Thumbnail options ------------------------------------------------------------

/** One grid item: what the avatar would look like with it, and how it is announced. */
export interface EditorOption {
	readonly id: string;
	readonly label: string;
	/** The draft after picking this option; its thumbnail shows exactly this profile. */
	readonly profile: AvatarProfile;
	readonly framing: FramingId;
	readonly selected: boolean;
}

/** One cache entry per framing and visible look: the same look is never rendered twice. */
export function thumbnailKey(framing: FramingId, profile: AvatarProfile): string {
	return `${framing}|${profileKey(profile)}`;
}

export function presetOptions(draft: AvatarProfile, presets: readonly AvatarPreset[]): EditorOption[] {
	return presets.map((preset) => ({
		id: preset.id,
		label: `Visual ${preset.name}`,
		profile: selectPreset(draft, preset),
		framing: 'body',
		selected: presetSelected(draft, preset)
	}));
}

export const FACES: readonly { id: AvatarProfile['face']; label: string }[] = [
	{ id: 'smile', label: 'Rosto com sorriso' },
	{ id: 'neutral', label: 'Rosto neutro' }
];

export function faceOptions(draft: AvatarProfile): EditorOption[] {
	return FACES.map((face) => ({
		id: face.id,
		label: face.label,
		profile: setFace(draft, face.id),
		framing: 'head',
		selected: draft.style === 'classic' && draft.face === face.id
	}));
}

export function hairOptions(draft: AvatarProfile, styles: readonly HairStyle[]): EditorOption[] {
	return styles.map((style) => ({
		id: style.id,
		label: `Cabelo ${style.name.toLowerCase()}`,
		profile: setHairStyle(draft, style.id),
		framing: 'head',
		selected: draft.style === 'classic' && (draft.hairStyle ?? 'curto') === style.id
	}));
}

export const CLASSIC_OPTION_ID = 'classic';

/** "Cores clássicas" first (back to the classic choices), then every Kenney skin. */
export function skinOptions(draft: AvatarProfile, skins: readonly string[]): EditorOption[] {
	return [
		{
			id: CLASSIC_OPTION_ID,
			label: 'Cores clássicas, sem skin',
			profile: useClassic(draft),
			framing: 'body',
			selected: draft.style === 'classic'
		},
		...skins.map(
			(id): EditorOption => ({
				id,
				label: `Skin ${id.toUpperCase()}`,
				profile: setKenneySkin(draft, id),
				framing: 'body',
				selected: draft.style === 'kenney' && draft.kenneySkin === id
			})
		)
	];
}

// --- Keyboard -----------------------------------------------------------------------

/** Horizontal tab list: arrows wrap, Home and End jump. Null for any other key. */
export function tabMove(key: string, index: number, count: number): number | null {
	if (count < 1) return null;
	if (key === 'ArrowRight') return (index + 1) % count;
	if (key === 'ArrowLeft') return (index - 1 + count) % count;
	if (key === 'Home') return 0;
	if (key === 'End') return count - 1;
	return null;
}

/**
 * Radio grid with `columns` per row: left and right walk the reading order and
 * wrap, up and down move a row and stop at the edges, Home and End jump.
 */
export function gridMove(key: string, index: number, count: number, columns: number): number | null {
	if (count < 1) return null;
	const cols = Math.max(1, Math.floor(columns));
	switch (key) {
		case 'ArrowRight':
			return (index + 1) % count;
		case 'ArrowLeft':
			return (index - 1 + count) % count;
		case 'ArrowDown':
			return index + cols < count ? index + cols : index;
		case 'ArrowUp':
			return index - cols >= 0 ? index - cols : index;
		case 'Home':
			return 0;
		case 'End':
			return count - 1;
		default:
			return null;
	}
}
