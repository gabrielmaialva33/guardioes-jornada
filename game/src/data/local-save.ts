export const GAME_SAVE_KEY = 'guardioes-secret-trail-save';
export const AVATAR_PARTS = ['skin', 'hair', 'shirt', 'pants', 'shoes'] as const;
export type AvatarPart = (typeof AVATAR_PARTS)[number];
export type AvatarColors = Record<AvatarPart, string>;
export const HAIR_STYLE_IDS = ['curto', 'longo', 'rabo', 'coque', 'black-power', 'trancas', 'bone'] as const;
export type HairStyleId = (typeof HAIR_STYLE_IDS)[number];
export interface AvatarProfile {
	hairStyle?: HairStyleId;
	style: 'classic' | 'kenney';
	colors: AvatarColors;
	face: 'smile' | 'neutral';
	kenneySkin: string;
}
export interface SaveStorage {
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
}
const hex = /^#[0-9a-f]{6}$/i;
function record(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}
export function decodeAvatarProfile(value: unknown): AvatarProfile | null {
	if (
		!record(value) ||
		(value.style !== 'classic' && value.style !== 'kenney') ||
		typeof value.kenneySkin !== 'string' ||
		!/^[a-r]$/.test(value.kenneySkin) ||
		!record(value.colors)
	)
		return null;
	const colors = {} as AvatarColors;
	for (const part of AVATAR_PARTS) {
		const color = value.colors[part] ?? (part === 'shoes' ? '#4f5c55' : undefined);
		if (typeof color !== 'string' || !hex.test(color)) return null;
		colors[part] = color.toLowerCase();
	}
	if (value.face !== undefined && value.face !== 'smile' && value.face !== 'neutral') return null;
	return {
		hairStyle: HAIR_STYLE_IDS.find((id) => id === value.hairStyle) ?? 'curto',
		style: value.style,
		kenneySkin: value.kenneySkin,
		colors,
		face: value.face === 'neutral' ? 'neutral' : 'smile'
	};
}
function nativeStorage(): SaveStorage | undefined {
	try {
		return globalThis.localStorage;
	} catch {
		return undefined;
	}
}
/** Device save, independent of the pack ID. Older cached packs preserve sections they do not understand. */
export function createLocalSave(
	defaultAvatar: AvatarProfile,
	storage: SaveStorage | undefined = nativeStorage()
) {
	const read = (): { doc: Record<string, unknown>; writable: boolean } => {
		try {
			const text = storage?.getItem(GAME_SAVE_KEY);
			if (!text) return { doc: { format: 1 }, writable: !!storage };
			const value: unknown = JSON.parse(text);
			return record(value) && value.format === 1
				? { doc: value, writable: true }
				: { doc: {}, writable: false };
		} catch {
			return { doc: {}, writable: false };
		}
	};
	return {
		checkpoint(mapKey: string): string | null {
			const checkpoints = read().doc.checkpoints;
			const value = record(checkpoints) ? checkpoints[mapKey] : null;
			return typeof value === 'string' && value.length <= 100 ? value : null;
		},
		setCheckpoint(mapKey: string, id: string): boolean {
			if (!mapKey || mapKey.length > 150 || !id || id.length > 100) return false;
			const { doc, writable } = read();
			if (!writable) return false;
			const checkpoints = record(doc.checkpoints) ? doc.checkpoints : {};
			try {
				storage?.setItem(
					GAME_SAVE_KEY,
					JSON.stringify({ ...doc, checkpoints: { ...checkpoints, [mapKey]: id } })
				);
				return true;
			} catch {
				return false;
			}
		},
		avatar(): AvatarProfile {
			return (
				decodeAvatarProfile(read().doc.avatar) ?? { ...defaultAvatar, colors: { ...defaultAvatar.colors } }
			);
		},
		setAvatar(profile: AvatarProfile): boolean {
			const clean = decodeAvatarProfile(profile);
			if (!clean) return false;
			// Re-read on each write; never replace newer survival/progress sections with a stale envelope.
			const { doc, writable } = read();
			if (!writable) return false;
			try {
				storage?.setItem(GAME_SAVE_KEY, JSON.stringify({ ...doc, avatar: clean }));
				return true;
			} catch {
				return false;
			}
		}
	};
}
