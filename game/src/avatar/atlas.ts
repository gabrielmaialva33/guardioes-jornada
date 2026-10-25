import {
	AVATAR_PARTS,
	type AvatarColors,
	type AvatarPart,
	type AvatarProfile,
	decodeAvatarProfile,
	HAIR_STYLE_IDS,
	type HairStyleId
} from '../data/local-save.ts';
import { ACCENT } from '../style/palette.ts';
export type PixelRect = readonly [number, number, number, number];
export interface HairStyle {
	id: HairStyleId;
	name: string;
	mesh: string | null;
	tint: 'hair' | 'shirt';
}
export interface AvatarPreset {
	hairStyle: HairStyleId;
	id: string;
	name: string;
	colors: AvatarColors;
	face: AvatarProfile['face'];
}
export interface AvatarAtlas {
	version: 1 | 2;
	hairStyles: HairStyle[];
	size: 64;
	uvSource: string;
	slots: Record<AvatarPart, PixelRect[]>;
	paintOrder: AvatarPart[];
	face: { rect: PixelRect; decals: Record<AvatarProfile['face'], string[]> };
	presets: AvatarPreset[];
}
function invalid(): never {
	throw new Error('avatar-atlas-invalid');
}
function object(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid();
	return value as Record<string, unknown>;
}
function rect(value: unknown): PixelRect {
	if (
		!Array.isArray(value) ||
		value.length !== 4 ||
		!value.every((n): n is number => typeof n === 'number' && Number.isInteger(n))
	)
		return invalid();
	const [x, y, w, h] = value;
	if (x < 0 || y < 0 || w < 1 || h < 1 || x + w > 64 || y + h > 64) return invalid();
	return [x, y, w, h];
}
function part(value: unknown): value is AvatarPart {
	return typeof value === 'string' && AVATAR_PARTS.some((part) => part === value);
}
export function decodeAvatarAtlas(input: unknown): AvatarAtlas {
	const value = object(input);
	if ((value.version !== 1 && value.version !== 2) || value.size !== 64 || typeof value.uvSource !== 'string')
		return invalid();
	const hairStyles: HairStyle[] =
		value.version === 1
			? [{ id: 'curto', name: 'Curto', mesh: null, tint: 'hair' }]
			: (() => {
					if (!Array.isArray(value.hairStyles) || value.hairStyles.length < 1 || value.hairStyles.length > 32)
						return invalid();
					const styles = value.hairStyles.map((raw) => {
						const s = object(raw),
							id = HAIR_STYLE_IDS.find((id) => id === s.id);
						if (
							!id ||
							typeof s.name !== 'string' ||
							!s.name.trim() ||
							s.name.length > 64 ||
							(s.mesh !== null && (typeof s.mesh !== 'string' || !/^[\w-]{1,48}$/.test(s.mesh))) ||
							(s.tint !== undefined && s.tint !== 'hair' && s.tint !== 'shirt')
						)
							return invalid();
						return {
							id,
							name: s.name,
							mesh: s.mesh as string | null,
							tint: s.tint === 'shirt' ? ('shirt' as const) : ('hair' as const)
						};
					});
					if (
						new Set(styles.map((s) => s.id)).size !== styles.length ||
						!styles.some((s) => s.id === 'curto' && s.mesh === null)
					)
						return invalid();
					return styles;
				})();
	const rawSlots = object(value.slots);
	const slots = {} as AvatarAtlas['slots'];
	for (const part of AVATAR_PARTS) {
		const data = rawSlots[part] ?? (part === 'shoes' ? [] : undefined);
		if (!Array.isArray(data)) return invalid();
		slots[part] = data.map(rect);
	}
	const order = value.paintOrder;
	if (!Array.isArray(order) || order.length !== 5 || !order.every(part) || new Set(order).size !== 5)
		return invalid();
	const rawFace = object(value.face),
		rawDecals = object(rawFace.decals);
	const decals = {} as AvatarAtlas['face']['decals'];
	for (const id of ['smile', 'neutral'] as const) {
		const rows = rawDecals[id];
		if (
			!Array.isArray(rows) ||
			rows.length < 1 ||
			rows.length > 64 ||
			!rows.every((row): row is string => typeof row === 'string' && /^[.kwm]{1,64}$/.test(row)) ||
			!rows.every((row) => row.length === rows[0].length)
		)
			return invalid();
		decals[id] = [...rows];
	}
	const rawPresets = value.presets;
	if (!Array.isArray(rawPresets) || rawPresets.length !== 18) return invalid();
	const presets = rawPresets.map((raw) => {
		const p = object(raw);
		const profile = decodeAvatarProfile({
			style: 'classic',
			kenneySkin: 'a',
			face: p.face,
			hairStyle: p.hairStyle,
			colors: Object.fromEntries(AVATAR_PARTS.map((part) => [part, p[part]]))
		});
		if (
			!profile ||
			!hairStyles.some((s) => s.id === (p.hairStyle ?? 'curto')) ||
			typeof p.id !== 'string' ||
			!/^[\w-]{1,48}$/.test(p.id) ||
			typeof p.name !== 'string' ||
			!p.name.trim() ||
			p.name.length > 64
		)
			return invalid();
		if ([profile.colors.shirt, profile.colors.pants, profile.colors.shoes].includes(ACCENT.gold))
			return invalid();
		return {
			id: p.id,
			name: p.name,
			colors: profile.colors,
			face: profile.face,
			hairStyle: profile.hairStyle ?? 'curto'
		};
	});
	if (new Set(presets.map((p) => p.id)).size !== 18) return invalid();
	return {
		version: value.version,
		hairStyles,
		size: 64,
		uvSource: value.uvSource,
		slots,
		paintOrder: [...order],
		face: { rect: rect(rawFace.rect), decals },
		presets
	};
}
const FACE_COLORS = { k: '#1e1e24', w: '#f4f4ef', m: '#5a2e2e' } as const;
function rgb(hex: string): readonly [number, number, number] {
	const n = Number.parseInt(hex.slice(1), 16);
	return [n >> 16, (n >> 8) & 255, n & 255];
}
/** Pure pixels are testable without a DOM. Canvas uploads happen only after a profile change. */
export function composePixels(
	atlas: AvatarAtlas,
	colors: AvatarColors,
	face: AvatarProfile['face']
): Uint8ClampedArray<ArrayBuffer> {
	const pixels = new Uint8ClampedArray(64 * 64 * 4);
	const paint = (x: number, y: number, color: readonly [number, number, number]) => {
		const i = (y * 64 + x) * 4;
		pixels[i] = color[0];
		pixels[i + 1] = color[1];
		pixels[i + 2] = color[2];
		pixels[i + 3] = 255;
	};
	for (const part of atlas.paintOrder) {
		const color = rgb(colors[part]);
		for (const [x, y, w, h] of atlas.slots[part])
			for (let py = y; py < y + h; py++) for (let px = x; px < x + w; px++) paint(px, py, color);
	}
	const rows = atlas.face.decals[face];
	const [x, y, w, h] = atlas.face.rect;
	for (let py = 0; py < h; py++)
		for (let px = 0; px < w; px++) {
			const symbol = rows[Math.floor((py * rows.length) / h)][Math.floor((px * rows[0].length) / w)];
			if (symbol === 'k' || symbol === 'w' || symbol === 'm') paint(x + px, y + py, rgb(FACE_COLORS[symbol]));
		}
	return pixels;
}
