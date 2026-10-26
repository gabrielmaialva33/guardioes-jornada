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
/** Sound buses with a saved volume and mute (audio/bank.ts BUSES; kept here so the save does not load the bank). */
export const AUDIO_BUSES = ['master', 'music', 'ambience', 'animals', 'sfx', 'ui'] as const;
export type AudioBusKey = (typeof AUDIO_BUSES)[number];
export interface AudioPreferences {
	version: 1;
	volume: Partial<Record<AudioBusKey, number>>;
	muted: Partial<Record<AudioBusKey, boolean>>;
}
/** Keeps only known buses, volumes in 0–1 and boolean mutes; null when there is nothing usable. */
export function decodeAudioPreferences(value: unknown): AudioPreferences | null {
	if (!record(value) || value.version !== 1) return null;
	const volume: AudioPreferences['volume'] = {};
	const muted: AudioPreferences['muted'] = {};
	for (const bus of AUDIO_BUSES) {
		const level = record(value.volume) ? value.volume[bus] : undefined;
		const off = record(value.muted) ? value.muted[bus] : undefined;
		if (typeof level === 'number' && Number.isFinite(level)) volume[bus] = Math.min(1, Math.max(0, level));
		if (typeof off === 'boolean') muted[bus] = off;
	}
	return { version: 1, volume, muted };
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
		story(): unknown {
			return read().doc.story;
		},
		setStory(value: unknown): boolean {
			const { doc, writable } = read();
			if (!writable || !record(value) || value.version !== 1) return false;
			if (
				record(doc.story) &&
				((typeof doc.story.version === 'number' && doc.story.version > 1) ||
					(typeof doc.story.levelVersion === 'number' &&
						typeof value.levelVersion === 'number' &&
						doc.story.levelVersion > value.levelVersion))
			)
				return false;
			try {
				storage?.setItem(GAME_SAVE_KEY, JSON.stringify({ ...doc, story: value }));
				return true;
			} catch {
				return false;
			}
		},
		audio(): AudioPreferences | null {
			return decodeAudioPreferences(read().doc.audio);
		},
		setAudio(value: Omit<AudioPreferences, 'version'>): boolean {
			const clean = decodeAudioPreferences({ ...value, version: 1 });
			const { doc, writable } = read();
			if (!clean || !writable) return false;
			try {
				storage?.setItem(GAME_SAVE_KEY, JSON.stringify({ ...doc, audio: clean }));
				return true;
			} catch {
				return false;
			}
		},
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
