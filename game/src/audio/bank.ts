/**
 * The sound bank: every sound id with its bus, loading category, mixing
 * defaults and its recorded files. Ids, buses and groups follow c-audio.md
 * (the pesquisa C sound list: A = locomotion, B = feedback, C = missions,
 * D = ambience, E = animals); the codes are in the comments below.
 *
 * Files: mono, `<id>-<n>.webm` (Opus) and `<id>-<n>.m4a` (AAC) per variant in
 * `src/assets/audio/` (sources, licences and processing in CREDITS.md). The
 * offline pack holds only one of them per device: the launcher downloads the
 * codec `chooseAudioCodec` (protocol.ts) picks, and `codecOrder` puts that same
 * codec first, so a device only fetches what it holds. If fetching or decoding
 * fails the other playable codec is tried (it needs the network), and with none
 * left the procedural placeholder (synth.ts) stays. A file missing from the
 * folder just drops out: an id without files plays its placeholder.
 *
 * Loudness: the files are normalised per mix group (effects about −16 LUFS
 * short-term, UI −20, animals −20, beds −24 integrated, no peak above −1 dBTP),
 * so `gain` below is the mix, not a level fix.
 */

import { AUDIO_CODEC_TYPES, type AudioCodec, audioCodecOrder } from '../../protocol.ts';

/** Volume buses. Animals sit under ambience: the "Natureza" slider moves both, and a duck of one ducks both. */
export type Bus = 'master' | 'music' | 'ambience' | 'animals' | 'sfx' | 'ui';
/** Parents before children (the engine builds them in this order). */
export const BUSES: readonly Bus[] = ['master', 'music', 'ambience', 'animals', 'sfx', 'ui'];
export const BUS_PARENT: Readonly<Record<Exclude<Bus, 'master'>, Bus>> = {
	music: 'master',
	ambience: 'master',
	animals: 'ambience',
	sfx: 'master',
	ui: 'master'
};

/**
 * Loading groups of c-audio.md §3.7: `essential` ships with the game pack
 * (about 90 KB of Opus), `nature` (beds, mission loops, animals, about 380 KB)
 * downloads after the first playable frame, `music` only if the owner adds it.
 */
export type Category = 'essential' | 'nature' | 'music';

/** Ground the avatar (or an animal) steps on. */
export type Surface = 'soil' | 'grass' | 'leaves' | 'rock' | 'wood' | 'water';
export const SURFACES: readonly Surface[] = ['soil', 'grass', 'leaves', 'rock', 'wood', 'water'];

export type Codec = AudioCodec;

/** MIME types probed with canPlayType. */
export const CODEC_TYPES = AUDIO_CODEC_TYPES;

/** One recorded variant of a sound: a URL per codec it was exported to. */
export type SoundFiles = Partial<Record<Codec, string>>;

export interface Spatial {
	/** Distance (units) up to which the sound plays at full gain. */
	ref: number;
	/** Inverse-distance rolloff factor. */
	rolloff: number;
	/** Beyond this distance a one-shot is not started at all (saves a voice). */
	max: number;
}

export interface SoundDef {
	bus: Exclude<Bus, 'master'>;
	category: Category;
	/** Recorded variants; empty when no file exists (the placeholder plays). */
	files: readonly SoundFiles[];
	/** Base linear gain. */
	gain: number;
	/** Random pitch per play, ± semitones. */
	pitchJitter: number;
	/** Random gain per play, ± dB. */
	gainJitter: number;
	/** Voice stealing: a new sound may take the voice of one with lower or equal priority. */
	priority: number;
	/** Loops: seconds into the file where the seamless loop starts and ends (encoder padding). */
	loop?: { start: number; end: number };
	/** Present when the sound can be placed in the world (PannerNode, equal-power). */
	spatial?: Spatial;
}

/** Encoded files in src/assets/audio, by file name (Vite emits each one as an asset URL). */
const AUDIO_URLS = new Map(
	Object.entries(
		import.meta.glob<string>('../assets/audio/*.{webm,m4a}', {
			eager: true,
			query: '?url',
			import: 'default'
		})
	).map(([path, url]) => [path.slice(path.lastIndexOf('/') + 1), url])
);

/**
 * The variants `<id>-1` … `<id>-<count>` found in `urls` (file name → URL),
 * each with the codecs that exist; variants with no file at all are left out.
 */
export function recordedFiles(
	id: string,
	count: number,
	urls: ReadonlyMap<string, string> = AUDIO_URLS
): SoundFiles[] {
	const variants: SoundFiles[] = [];
	for (let n = 1; n <= count; n++) {
		const files: SoundFiles = {};
		for (const codec of ['webm', 'm4a'] as const) {
			const url = urls.get(`${id}-${n}.${codec}`);
			if (url) files[codec] = url;
		}
		if (files.webm || files.m4a) variants.push(files);
	}
	return variants;
}

const STEP_SPATIAL: Spatial = { ref: 2, rolloff: 1.5, max: 25 };
/** Common animals (c-audio.md §3.3): full level within 4 u, out of reach past 70 u. */
export const ANIMAL_SPATIAL: Spatial = { ref: 4, rolloff: 1.5, max: 70 };

/** A footstep: the steps are normalised per surface, so these gains even the surfaces out. */
function step(gain: number, files: readonly SoundFiles[]): SoundDef {
	return {
		bus: 'sfx',
		category: 'essential',
		files,
		gain,
		pitchJitter: 1.5,
		gainJitter: 2.5,
		priority: 4,
		spatial: STEP_SPATIAL
	};
}

function animal(
	gain: number,
	files: readonly SoundFiles[],
	priority = 2,
	spatial = ANIMAL_SPATIAL
): SoundDef {
	return {
		bus: 'animals',
		category: 'nature',
		files,
		gain,
		// About ±4% (c-audio.md §3.5): keeps the species recognisable.
		pitchJitter: 0.7,
		gainJitter: 2,
		priority,
		spatial
	};
}

export const SOUNDS = {
	// A1 SecureSubset (dirt, foley pit), A2 Kenney Impact Sounds, A3 iliana22, A4 congusbongus/Ali_6868 (gravel), A5 Kenney, A6 congusbongus/EminYILDIRIM.
	'step-soil': step(0.8, recordedFiles('step-soil', 4)),
	'step-grass': step(1, recordedFiles('step-grass', 3)),
	'step-leaves': step(0.55, recordedFiles('step-leaves', 4)),
	'step-rock': step(0.55, recordedFiles('step-rock', 4)),
	'step-wood': step(0.75, recordedFiles('step-wood', 4)),
	'step-water': step(0.7, recordedFiles('step-water', 4)),
	// A8 Kenney Digital Audio.
	jump: {
		bus: 'sfx',
		category: 'essential',
		files: recordedFiles('jump', 3),
		gain: 0.45,
		pitchJitter: 1,
		gainJitter: 1.5,
		priority: 5
	},
	// A9 Kenney Impact Sounds.
	land: {
		bus: 'sfx',
		category: 'essential',
		files: recordedFiles('land', 4),
		gain: 0.6,
		pitchJitter: 1,
		gainJitter: 1.5,
		priority: 5
	},
	// A10 vero.marengere.
	splash: {
		bus: 'sfx',
		category: 'essential',
		files: recordedFiles('splash', 3),
		gain: 0.9,
		pitchJitter: 1.5,
		gainJitter: 1.5,
		priority: 5,
		spatial: { ref: 3, rolloff: 1.2, max: 40 }
	},
	// B2 Kenney Interface (the juçara fruit; the combo pitch is the caller's `rate`).
	collect: {
		bus: 'sfx',
		category: 'essential',
		files: recordedFiles('collect', 2),
		gain: 0.8,
		pitchJitter: 0.3,
		gainJitter: 1,
		priority: 7
	},
	// B1 Kenney Interface + Music Jingles.
	checkpoint: {
		bus: 'sfx',
		category: 'essential',
		files: recordedFiles('checkpoint', 1),
		gain: 0.6,
		pitchJitter: 0,
		gainJitter: 0,
		priority: 8
	},
	// B5 Kenney Music Jingles (steel).
	'mission-complete': {
		bus: 'sfx',
		category: 'essential',
		files: recordedFiles('mission-complete', 1),
		gain: 0.7,
		pitchJitter: 0,
		gainJitter: 0,
		priority: 8
	},
	// B6 Kenney Music Jingles (pizzicato).
	badge: {
		bus: 'sfx',
		category: 'essential',
		files: recordedFiles('badge', 1),
		gain: 0.7,
		pitchJitter: 0,
		gainJitter: 0,
		priority: 8
	},
	// B7 Kenney Interface.
	'ui-tap': {
		bus: 'ui',
		category: 'essential',
		files: recordedFiles('ui-tap', 1),
		gain: 0.6,
		pitchJitter: 0.5,
		gainJitter: 1,
		priority: 6
	},
	// C1 bruce965 (roger beep) + JovianSounds (squelch).
	'radio-call': {
		bus: 'ui',
		category: 'essential',
		files: recordedFiles('radio-call', 1),
		gain: 0.7,
		pitchJitter: 0,
		gainJitter: 0.5,
		priority: 7
	},
	// D1 MeliaRoger (Serrinha do Alambari, morning).
	'forest-day': {
		bus: 'ambience',
		category: 'nature',
		files: recordedFiles('forest-day', 1),
		gain: 0.8,
		pitchJitter: 0,
		gainJitter: 0,
		priority: 9,
		loop: { start: 0, end: 24 }
	},
	// D2 minian89; the emitter follows the nearest bank point.
	river: {
		bus: 'ambience',
		category: 'nature',
		files: recordedFiles('river', 1),
		gain: 0.8,
		pitchJitter: 0,
		gainJitter: 0,
		priority: 9,
		loop: { start: 0, end: 4.85 },
		spatial: { ref: 3, rolloff: 1.2, max: 35 }
	},
	// D3 ricardoemfield (Rio Catarina, SC), at the waterfall landmark.
	waterfall: {
		bus: 'ambience',
		category: 'nature',
		files: recordedFiles('waterfall', 1),
		gain: 0.8,
		pitchJitter: 0,
		gainJitter: 0,
		priority: 9,
		loop: { start: 0, end: 15 },
		spatial: { ref: 6, rolloff: 1.2, max: 70 }
	},
	// C4 FunWithSound: the illegal logging of mission 2, heard from afar.
	chainsaw: {
		bus: 'sfx',
		category: 'nature',
		files: recordedFiles('chainsaw', 1),
		gain: 0.7,
		pitchJitter: 0,
		gainJitter: 0,
		priority: 9,
		loop: { start: 0, end: 9 },
		spatial: { ref: 20, rolloff: 1, max: 200 }
	},
	// E1 howler monkey (bugio-ruivo): the landmark call, heard from far away.
	howler: animal(0.8, recordedFiles('howler', 2), 3, { ref: 15, rolloff: 1, max: 250 }),
	// E3 muriqui, E4 green-billed toucan, E2 black lion tamarin (stand-in for the golden lion tamarin, same genus).
	muriqui: animal(0.8, recordedFiles('muriqui', 2)),
	toucan: animal(0.8, recordedFiles('toucan', 2)),
	tamarin: animal(0.8, recordedFiles('tamarin', 2))
} as const satisfies Record<string, SoundDef>;

export type SoundId = keyof typeof SOUNDS;
export type SoundBank = Readonly<Record<SoundId, SoundDef>>;
export const SOUND_IDS = Object.keys(SOUNDS) as SoundId[];

/** The step sound of each surface. */
export const STEP_SOUND: Readonly<Record<Surface, SoundId>> = {
	soil: 'step-soil',
	grass: 'step-grass',
	leaves: 'step-leaves',
	rock: 'step-rock',
	wood: 'step-wood',
	water: 'step-water'
};

/**
 * The codecs this browser can play, best first (protocol.ts `audioCodecOrder`):
 * the first is the one the launcher downloaded into the offline pack.
 */
export function codecOrder(canPlayType: (type: string) => string): Codec[] {
	return audioCodecOrder(canPlayType);
}

/** The URLs to try for one variant, in codec order; empty when none is playable. */
export function variantUrls(files: SoundFiles, codecs: readonly Codec[]): string[] {
	const urls: string[] = [];
	for (const codec of codecs) {
		const url = files[codec];
		if (url) urls.push(url);
	}
	return urls;
}
