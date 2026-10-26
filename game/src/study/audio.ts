/**
 * Sound of the LOCAL-ONLY Green Hell study mode (P15): every fitting ambience
 * bed and animal call of the extraction, over or instead of our T1 mix, to
 * compare by ear. The files come from the served catalog (data.ts) through the
 * dev middleware; this module keeps curation only (sound group ids, clip-name
 * variants, intervals, ranges), never a path.
 * Report: ~/.cache/agents/2026-10-25-trilha-secreta/p15-estudo-audio.md.
 *
 * URL (on top of the study gate, gate.ts):
 * - `&hora=dia|entardecer|noite` (day by default). The extraction has no dusk
 *   material: dusk blends the day and night layers.
 * - `&tempo=chuva|chuva-forte`: the rain bed and a stronger canopy wind; fewer
 *   calls (frogs call more); distant thunder now and then in heavy rain.
 * - `&som=ambos`: their layers over ours; `&som=nosso`: ours only (study sounds
 *   off). Default: theirs, so our forest bed, river and waterfall stop once
 *   their counterparts play (freeing the voices; our animal calls stay).
 *
 * Layers (studyLayers): the forest bed of the hour, the swamp bed that swells
 * within 30 u of the river, birds by day, crickets at dusk and night, the palm
 * wind in the canopy, the open wind above the treetops (the mirante), their
 * stream on the river point nearest the listener, their waterfall at our
 * waterfall and the still lake at the stones pool. A layer whose level is 0
 * (far from its water, low ground) is stopped so it holds no voice.
 *
 * One-shots (animals bus, placed): a random day or night call every 5–12 s,
 * 12–35 u away up in the canopy. Calls: each study animal calls from where it
 * stands now (the live study fauna, `globalThis.__estudo`) at its own rate for
 * the hour and the weather, within `range`; its group gives one alarm when it
 * turns to alert, flee or hide. Our onça calls with their jaguar idles from its
 * home. At most `maxOneShots` study one-shots at once, in the shared 16 voices.
 *
 * Soundscape starts it behind `import.meta.env.DEV` with a dynamic import, so a
 * build never sees this module.
 */
import { ANIMAL_SPATIAL, SOUNDS, type Spatial } from '../audio/bank.ts';
import type { ExtraSound, GameAudio, LoopHandle, PlayOptions, Voice } from '../audio/engine.ts';
import { nearestRiverPoint } from '../audio/soundscape.ts';
import type { StoryLevel } from '../level/types.ts';
import type { SurvivalWorld } from '../survival/types.ts';
import { loadStudyCatalog, type StudyCatalog } from './data.ts';
import { type StudyContext, studyEnabled, studyUrl } from './gate.ts';
import { riverDistanceField } from './herds.ts';

export type StudyHour = 'day' | 'dusk' | 'night';
export type StudyWeather = 'clear' | 'rain' | 'storm';
/** Whose ambience plays: theirs (ours stopped), both layered, or ours only. */
export type StudyMix = 'theirs' | 'both' | 'ours';

const currentSearch = () => (typeof location === 'undefined' ? '' : location.search);

/** `&hora=entardecer|noite`, day otherwise. */
export function studyHour(search: string = currentSearch()): StudyHour {
	const hour = new URLSearchParams(search).get('hora');
	return hour === 'noite' ? 'night' : hour === 'entardecer' ? 'dusk' : 'day';
}

/** `&tempo=chuva|chuva-forte`, clear otherwise. */
export function studyWeather(search: string = currentSearch()): StudyWeather {
	const weather = new URLSearchParams(search).get('tempo');
	return weather === 'chuva-forte' ? 'storm' : weather === 'chuva' ? 'rain' : 'clear';
}

/** `&som=nosso|ambos`, theirs by default. */
export function studyMix(search: string = currentSearch()): StudyMix {
	const mix = new URLSearchParams(search).get('som');
	return mix === 'nosso' ? 'ours' : mix === 'ambos' ? 'both' : 'theirs';
}

export interface StudyLayer {
	/** Unique within a mix. */
	key: string;
	/** Sound group id in the curation. */
	id: string;
	/** Plays the file whose name contains this (light, heavy, big…); any file otherwise. */
	variant?: string;
	gain: number;
	/** `river`: full within `riverNear` u of the river, silent past `riverFar`. `high`: full above the treetops. */
	drive?: 'river' | 'high';
	/** Placed on the river point nearest the listener, at our waterfall or at the stones pool. */
	at?: 'river' | 'waterfall' | 'pool';
}

/** The looping layers for an hour and a weather. */
export function studyLayers(hour: StudyHour, weather: StudyWeather): StudyLayer[] {
	const layers: StudyLayer[] = [];
	if (hour === 'day')
		layers.push(
			{ key: 'forest', id: 'jungle-day-bed', gain: 1 },
			{ key: 'swamp', id: 'swamp-day-bed', gain: 1, drive: 'river' },
			{ key: 'birds', id: 'birds-bed', gain: 0.7 }
		);
	else if (hour === 'dusk')
		layers.push(
			{ key: 'forest', id: 'jungle-day-bed', gain: 0.55 },
			{ key: 'forest-night', id: 'jungle-night-bed', gain: 0.6 },
			{ key: 'crickets', id: 'crickets', gain: 0.5 },
			{ key: 'swamp', id: 'swamp-night-bed', gain: 0.8, drive: 'river' }
		);
	else
		layers.push(
			{ key: 'forest-night', id: 'jungle-night-bed', gain: 1 },
			{ key: 'crickets', id: 'crickets', gain: 1 },
			{ key: 'swamp', id: 'swamp-night-bed', gain: 1, drive: 'river' }
		);
	const wind = weather === 'storm' ? 'heavy' : weather === 'rain' ? 'medium' : 'light';
	if (weather !== 'clear')
		// Strong rain measures -14.5 LUFS at the source: halved so it does not bury the forest.
		layers.push({
			key: 'rain',
			id: 'rain',
			variant: weather === 'storm' ? 'strong' : 'light',
			gain: weather === 'storm' ? 0.5 : 1
		});
	// Still nights keep the canopy quiet.
	if (hour !== 'night' || weather !== 'clear')
		layers.push({ key: 'foliage', id: 'foliage-wind', variant: wind, gain: weather === 'clear' ? 0.5 : 0.8 });
	layers.push(
		{ key: 'wind-high', id: 'wind', variant: wind, gain: 0.8, drive: 'high' },
		{ key: 'stream', id: 'stream', gain: 1, at: 'river' },
		// The big fall measures -10.4 LUFS, about 15 dB over ours: -12 dB keeps the A/B listenable.
		{ key: 'waterfall', id: 'waterfall', variant: 'big', gain: 0.25, at: 'waterfall' },
		{ key: 'lake', id: 'lake', gain: 0.8, at: 'pool' }
	);
	return layers;
}

/** The random calls sprinkled around the listener; dusk mixes both. */
export const STUDY_ONESHOTS: Readonly<Record<StudyHour, readonly string[]>> = {
	day: ['day-calls'],
	dusk: ['day-calls', 'night-calls'],
	night: ['night-calls']
};

export interface StudyCall {
	idle: string;
	alarm?: string;
	/** Seconds between idle calls at rate 1. */
	min: number;
	max: number;
	/** Calls only while the listener is this close, u. */
	range: number;
	/** Playback-rate factor (the tapir calf is a higher anta). */
	pitch?: number;
	/** Call rate per hour (default 1; 0 is asleep). */
	hours?: Partial<Record<StudyHour, number>>;
	/** Call rate in the rain (default `WET_RATE`); heavy rain takes 0.6 of it. */
	wet?: number;
}

const WET_RATE = 0.6;

/** Keyed by STUDY_PICKS id. The crab, jabuti and tamanduá have no sounds in the extraction. */
export const STUDY_CALLS: Readonly<Record<string, StudyCall>> = {
	Capybara: {
		idle: 'capybara-calls',
		alarm: 'capybara-alarm',
		min: 14,
		max: 35,
		range: 45,
		hours: { dusk: 1.3, night: 0.6 }
	},
	Tapir: { idle: 'tapir-calls', alarm: 'tapir-alarm', min: 20, max: 50, range: 55, hours: { night: 1.5 } },
	Tapir_baby: {
		idle: 'tapir-calls',
		alarm: 'tapir-alarm',
		min: 25,
		max: 60,
		range: 45,
		pitch: 1.25,
		hours: { night: 1.5 }
	},
	Peccary: {
		idle: 'peccary-calls',
		alarm: 'peccary-alarm',
		min: 8,
		max: 22,
		range: 45,
		hours: { night: 0.5 }
	},
	Armadillo: { idle: 'armadillo-calls', min: 12, max: 30, range: 25, hours: { day: 0.5, night: 1.5 } },
	CaneToad: { idle: 'toad-calls', min: 6, max: 16, range: 35, hours: { day: 0.5, night: 2 }, wet: 1.5 },
	Puma: { idle: 'puma-calls', min: 60, max: 140, range: 60, hours: { day: 0.6, dusk: 1.5 } },
	// The A/B toucan beside our tucano ('maybe' in the curation); asleep at night.
	Toucan: { idle: 'toucan-calls', min: 20, max: 60, range: 60, hours: { dusk: 0.5, night: 0 } }
};

/** Our own animals voiced by their calls, from their homes (`world.animals`). */
export const STUDY_HOME_CALLS: Readonly<Record<string, StudyCall>> = {
	// Their jaguar idles and lurks (no growls); the curation marks the onça as ours already.
	'onca-pintada': { idle: 'jaguar-calls', min: 70, max: 160, range: 70, hours: { day: 0.6, dusk: 1.5 } }
};

export const STUDY_AUDIO = {
	maxOneShots: 4,
	/** Seconds between sprinkled one-shots in clear weather (×2 in rain, ×3 in heavy rain). */
	oneShotMin: 5,
	oneShotMax: 12,
	/** u from the listener, and up into the canopy. */
	oneShotNear: 12,
	oneShotFar: 35,
	oneShotLiftMin: 3,
	oneShotLiftMax: 9,
	/** Seconds between distant thunders in heavy rain. */
	thunderMin: 35,
	thunderMax: 80,
	thunderGain: 0.7,
	/** u above an animal's feet its calls come from. */
	callLift: 0.6,
	riverNear: 4,
	riverFar: 30,
	/** Listener height (u) where the open wind starts, and where it is full (the mirante top is 15). */
	highFrom: 9,
	highFull: 15,
	/** Seconds between layer samples (river distance, height, water culling). */
	sampleEvery: 0.25,
	/** A stopped layer restarts above this level. */
	restartLevel: 0.05,
	bedFadeIn: 3,
	/** One alarm per group in this many seconds. */
	alarmCooldown: 10
} as const;

const LAKE_SPATIAL: Spatial = { ref: 4, rolloff: 1.2, max: 40 };
const LAYER_SPATIAL: Readonly<Record<NonNullable<StudyLayer['at']>, Spatial>> = {
	river: SOUNDS.river.spatial ?? LAKE_SPATIAL,
	waterfall: SOUNDS.waterfall.spatial ?? LAKE_SPATIAL,
	pool: LAKE_SPATIAL
};
const BED: ExtraSound = { bus: 'ambience', priority: 9 };
const THUNDER: ExtraSound = { bus: 'ambience', priority: 3, gain: STUDY_AUDIO.thunderGain };
const ONESHOT: ExtraSound = { bus: 'animals', priority: 1, spatial: ANIMAL_SPATIAL };
const CALL: ExtraSound = { bus: 'animals', priority: 2, spatial: ANIMAL_SPATIAL };
const ALARM: ExtraSound = { bus: 'animals', priority: 3, spatial: ANIMAL_SPATIAL };

/** States in which a study animal stops idling and its group may give an alarm (fauna.ts). */
const ALARM_STATES: ReadonlySet<string> = new Set(['alert', 'flee', 'hide']);

/** What this reads of a live study actor (fauna.ts StudyActor). */
export interface StudyAudioActor {
	readonly member: { readonly key: string; readonly species: string; readonly group: string };
	readonly state: string;
	readonly x: number;
	readonly y: number;
	readonly z: number;
}

interface Point {
	x: number;
	y: number;
	z: number;
}

export interface StudyAudioHost {
	audio: GameAudio;
	/** The map: the river, the pool and our animals' homes. Null for the graybox fixture. */
	world?: SurvivalWorld | null;
	level?: StoryLevel | null;
	/** Our waterfall emitter (the Soundscape's), where theirs plays. */
	waterfall?: Point | null;
	/** Our loops, stopped in the `theirs` mix once their counterparts play. */
	ownBed?: LoopHandle | null;
	ownRiver?: LoopHandle | null;
	ownFall?: LoopHandle | null;
	search?: string;
	/** The gate's context (tests); default: this page's. */
	context?: StudyContext;
	random?: () => number;
	/** WebM/Opus playable (else the `.m4a` twins). Default: asked of an <audio> element. */
	opus?: boolean;
	/** Tests: the catalog and the live actors. */
	catalog?: (signal: AbortSignal) => Promise<StudyCatalog>;
	actors?: () => readonly StudyAudioActor[] | null;
}

export interface StudyAudioDebug {
	hour: StudyHour;
	weather: StudyWeather;
	mix: StudyMix;
	ready: boolean;
	/** Layers playing now, with their level. */
	layers: Record<string, number>;
	/** Curated group ids absent from the served catalog. */
	missing: string[];
	decoded: number;
	oneShots: number;
	played: { oneShots: number; calls: number; alarms: number; thunder: number };
}

/**
 * The study sounds, or null unless the study gate is open (gate.ts: on by default
 * on the dev server, `?estudo=off` closes it) and the mix is not `&som=nosso`.
 */
export function startStudyAudio(host: StudyAudioHost): StudyAudioRuntime | null {
	if (!import.meta.env.DEV) return null;
	const search = host.search ?? currentSearch();
	if (!studyEnabled(search, host.context) || studyMix(search) === 'ours') return null;
	return new StudyAudioRuntime(host, search);
}

const liveActors = () =>
	(globalThis as { __estudo?: { actors?: readonly StudyAudioActor[] } }).__estudo?.actors ?? null;

const canPlayOpus = () =>
	typeof document !== 'undefined' &&
	document.createElement('audio').canPlayType('audio/webm; codecs="opus"') !== '';

interface LayerState {
	layer: StudyLayer;
	urls: readonly string[];
	handle: LoopHandle | null;
	level: number;
	/** The emitter, for placed layers. */
	at: Point | null;
}

interface CallerState {
	wait: number;
	state: string;
}

/** Our onça (and any home caller) as a fixed actor. */
interface HomeActor extends StudyAudioActor {
	readonly call: StudyCall;
}

export class StudyAudioRuntime {
	readonly hour: StudyHour;
	readonly weather: StudyWeather;
	readonly mix: StudyMix;
	readonly missing: string[] = [];
	readonly #audio: GameAudio;
	readonly #random: () => number;
	readonly #actors: () => readonly StudyAudioActor[] | null;
	readonly #opus: boolean;
	readonly #host: StudyAudioHost;
	readonly #abort = new AbortController();
	/** Group id → file URLs (the served catalog's paths, codec chosen). */
	readonly #groups = new Map<string, readonly string[]>();
	readonly #pending = new Map<string, Promise<AudioBuffer | null>>();
	readonly #decoded = new Map<string, AudioBuffer>();
	readonly #layers: LayerState[];
	readonly #homes: HomeActor[] = [];
	readonly #shots: Voice[] = [];
	readonly #callers = new Map<string, CallerState>();
	readonly #alarmAt = new Map<string, number>();
	readonly #at: PlayOptions = { x: 0, y: 0, z: 0, gain: 1, rate: 1 };
	readonly #played = { oneShots: 0, calls: 0, alarms: 0, thunder: 0 };
	readonly #river: Float32Array | null;
	readonly #grid: number;
	readonly #riverAt: Point = { x: 0, y: 0, z: 0 };
	/** Interval factor of the sprinkled one-shots for the weather. */
	readonly #sparse: number;
	#sampleWait = 0;
	#oneShotWait: number;
	#thunderWait: number;
	#clock = 0;
	#ready = false;
	#disposed = false;

	constructor(host: StudyAudioHost, search: string) {
		this.hour = studyHour(search);
		this.weather = studyWeather(search);
		this.mix = studyMix(search);
		this.#host = host;
		this.#audio = host.audio;
		this.#random = host.random ?? Math.random;
		this.#actors = host.actors ?? liveActors;
		this.#opus = host.opus ?? canPlayOpus();
		this.#river = host.world ? riverDistanceField(host.world) : null;
		this.#grid = host.world?.grid ?? 0;
		this.#sparse = this.weather === 'storm' ? 3 : this.weather === 'rain' ? 2 : 1;
		this.#oneShotWait = STUDY_AUDIO.oneShotMin * this.#random();
		this.#thunderWait = STUDY_AUDIO.thunderMin * (0.5 + this.#random());
		const pool = host.level?.pool;
		const waterfall = host.waterfall ?? null;
		this.#layers = studyLayers(this.hour, this.weather).map((layer) => ({
			layer,
			urls: [],
			handle: null,
			level: 0,
			at:
				layer.at === 'waterfall'
					? waterfall
					: layer.at === 'pool'
						? pool
							? { x: pool.x, y: pool.water, z: pool.z }
							: null
						: layer.at === 'river'
							? this.#riverAt
							: null
		}));
		for (const home of host.world?.animals ?? []) {
			const call = STUDY_HOME_CALLS[home.species];
			if (call)
				this.#homes.push({
					member: { key: `home-${this.#homes.length}`, species: home.species, group: home.species },
					state: 'idle',
					x: home.x,
					y: home.y,
					z: home.z,
					call
				});
		}
		void this.#start(host.catalog ?? loadStudyCatalog);
		(globalThis as { __estudoSom?: StudyAudioRuntime }).__estudoSom = this;
	}

	get ready() {
		return this.#ready;
	}

	/** One frame, with the listener's position. */
	update(dt: number, x: number, y: number, z: number) {
		if (this.#disposed) return;
		this.#clock += dt;
		if (!this.#ready) return;
		this.#sampleWait -= dt;
		if (this.#sampleWait <= 0) {
			this.#sampleWait = STUDY_AUDIO.sampleEvery;
			this.#sampleLayers(x, y, z);
		}
		let kept = 0;
		for (const voice of this.#shots) if (voice.playing) this.#shots[kept++] = voice;
		this.#shots.length = kept;
		this.#sprinkle(dt, x, y, z);
		this.#thunder(dt);
		const actors = this.#actors();
		if (actors) this.#calls(actors, null, dt, x, z);
		if (this.#homes.length) this.#calls(this.#homes, this.#homes, dt, x, z);
	}

	debug(): StudyAudioDebug {
		const layers: Record<string, number> = {};
		for (const state of this.#layers)
			if (state.handle) layers[state.layer.key] = Number(state.level.toFixed(2));
		return {
			hour: this.hour,
			weather: this.weather,
			mix: this.mix,
			ready: this.#ready,
			layers,
			missing: [...this.missing],
			decoded: this.#decoded.size,
			oneShots: this.#shots.length,
			played: { ...this.#played }
		};
	}

	/** Stops the study sounds. Our stopped loops stay stopped: this only runs when the Soundscape is disposed. */
	dispose() {
		if (this.#disposed) return;
		this.#disposed = true;
		this.#abort.abort();
		for (const state of this.#layers) {
			state.handle?.stop(0.5);
			state.handle = null;
		}
		for (const voice of this.#shots) voice.stop(0.2);
		this.#shots.length = 0;
		const global = globalThis as { __estudoSom?: StudyAudioRuntime };
		if (global.__estudoSom === this) delete global.__estudoSom;
	}

	async #start(load: (signal: AbortSignal) => Promise<StudyCatalog>) {
		let catalog: StudyCatalog;
		try {
			catalog = await load(this.#abort.signal);
		} catch (error) {
			if (!this.#disposed) console.warn('[estudo] study sounds: no catalog', error);
			return;
		}
		if (this.#disposed) return;
		for (const group of catalog.sounds ?? [])
			this.#groups.set(
				group.id,
				group.files.map((f) => this.#url(f))
			);
		const wanted = new Set([...this.#layers.map((s) => s.layer.id), ...STUDY_ONESHOTS[this.hour]]);
		if (this.weather === 'storm') wanted.add('thunder');
		for (const call of [...Object.values(STUDY_CALLS), ...this.#homes.map((h) => h.call)]) {
			wanted.add(call.idle);
			if (call.alarm) wanted.add(call.alarm);
		}
		for (const id of wanted) if (!this.#groups.get(id)?.length) this.missing.push(id);
		for (const state of this.#layers) state.urls = this.#variant(state.layer);
		// One file of every one-shot group up front, so the first call has something to play.
		const layerIds = new Set(this.#layers.map((s) => s.layer.id));
		for (const id of wanted) {
			const urls = this.#groups.get(id);
			if (urls?.length && !layerIds.has(id)) void this.#decode(this.#choose(urls));
		}
		// Every layer's file decodes now; each starts when its level first rises (#sampleLayers).
		await Promise.all(this.#layers.map((s) => (s.urls.length ? this.#decode(s.urls[0]) : null)));
		if (!this.#disposed) this.#ready = true;
	}

	/** The layer's file: one matching its variant, else a random one of the group. */
	#variant(layer: StudyLayer): readonly string[] {
		const urls = this.#groups.get(layer.id) ?? [];
		if (!urls.length) return urls;
		const variant = layer.variant?.toLowerCase();
		const matching = variant ? urls.filter((url) => url.toLowerCase().includes(variant)) : [];
		return [this.#choose(matching.length ? matching : urls)];
	}

	#url(path: string) {
		return studyUrl(this.#opus ? path : path.replace(/\.webm$/i, '.m4a'));
	}

	#choose(urls: readonly string[]) {
		return urls[Math.min(urls.length - 1, Math.floor(this.#random() * urls.length))];
	}

	#decode(url: string): Promise<AudioBuffer | null> {
		let pending = this.#pending.get(url);
		if (!pending) {
			pending = this.#audio.decode(url, this.#abort.signal).then((buffer) => {
				if (buffer) this.#decoded.set(url, buffer);
				return buffer;
			});
			this.#pending.set(url, pending);
		}
		return pending;
	}

	/** A random decoded file of the group (its decode started if not yet), or any decoded one, or null. */
	#buffer(id: string): AudioBuffer | null {
		const urls = this.#groups.get(id);
		if (!urls?.length) return null;
		const url = this.#choose(urls);
		const buffer = this.#decoded.get(url);
		if (buffer) return buffer;
		void this.#decode(url);
		for (const other of urls) {
			const ready = this.#decoded.get(other);
			if (ready) return ready;
		}
		return null;
	}

	#riverLevel(x: number, z: number) {
		const river = this.#river;
		if (!river) return 0;
		const n = this.#grid;
		const i = Math.max(0, Math.min(n - 1, Math.round(x)));
		const j = Math.max(0, Math.min(n - 1, Math.round(z)));
		const { riverNear, riverFar } = STUDY_AUDIO;
		return Math.max(0, Math.min(1, (riverFar - river[j * n + i]) / (riverFar - riverNear)));
	}

	#sampleLayers(x: number, y: number, z: number) {
		const points = this.#host.world?.river.points;
		const onRiver = !!points && nearestRiverPoint(points, x, z, this.#riverAt);
		const { highFrom, highFull } = STUDY_AUDIO;
		const high = Math.max(0, Math.min(1, (y - highFrom) / (highFull - highFrom)));
		const river = this.#riverLevel(x, z);
		for (const state of this.#layers) {
			const { layer, at } = state;
			let level = 1;
			if (layer.drive === 'river') level = river;
			else if (layer.drive === 'high') level = high;
			if (layer.at) {
				// Placed water: heard within its reach (the panner does the distance), else stopped.
				const reach = LAYER_SPATIAL[layer.at].max;
				const placed = at !== null && (layer.at !== 'river' || onRiver);
				level = placed && (at.x - x) ** 2 + (at.y - y) ** 2 + (at.z - z) ** 2 < reach * reach ? 1 : 0;
			}
			this.#setLevel(state, level);
		}
	}

	#setLevel(state: LayerState, level: number) {
		const { layer } = state;
		if (state.handle && !state.handle.playing) state.handle = null;
		if (!state.handle) {
			if (level < STUDY_AUDIO.restartLevel) return;
			const buffer = state.urls.length ? this.#decoded.get(state.urls[0]) : undefined;
			if (!buffer) return;
			const sound = layer.at ? { ...BED, spatial: LAYER_SPATIAL[layer.at] } : BED;
			const at = state.at;
			state.handle = this.#audio.loopBuffer(
				buffer,
				{ ...sound, gain: layer.gain },
				{
					gain: level,
					fadeIn: STUDY_AUDIO.bedFadeIn,
					...(layer.at && at ? { x: at.x, y: at.y, z: at.z } : {})
				}
			);
			state.level = level;
			if (state.handle && this.mix === 'theirs') this.#replaceOurs(layer);
			return;
		}
		if (layer.at === 'river') state.handle.setPosition(state.at?.x ?? 0, state.at?.y ?? 0, state.at?.z ?? 0);
		if (level === 0 && (layer.at || state.level === 0)) {
			// Out of reach (or silent twice in a row): free the voice; it restarts when the level rises.
			state.handle.stop(1);
			state.handle = null;
			state.level = 0;
			return;
		}
		if (Math.abs(level - state.level) < 0.02) return;
		state.level = level;
		state.handle.setGain(level, 0.6);
	}

	/** Theirs only: our counterpart stops once theirs plays (forest bed, river, waterfall). */
	#replaceOurs(layer: StudyLayer) {
		const host = this.#host;
		const ours =
			layer.key === 'forest' || layer.key === 'forest-night'
				? 'ownBed'
				: layer.key === 'stream'
					? 'ownRiver'
					: layer.key === 'waterfall'
						? 'ownFall'
						: null;
		if (!ours) return;
		host[ours]?.stop(2);
		host[ours] = null;
	}

	#sprinkle(dt: number, x: number, y: number, z: number) {
		this.#oneShotWait -= dt;
		if (this.#oneShotWait > 0) return;
		const random = this.#random;
		const s = STUDY_AUDIO;
		this.#oneShotWait = (s.oneShotMin + random() * (s.oneShotMax - s.oneShotMin)) * this.#sparse;
		const groups = STUDY_ONESHOTS[this.hour];
		const buffer = this.#buffer(groups[Math.min(groups.length - 1, Math.floor(random() * groups.length))]);
		if (!buffer) return;
		const angle = random() * Math.PI * 2;
		const distance = s.oneShotNear + random() * (s.oneShotFar - s.oneShotNear);
		const lift = s.oneShotLiftMin + random() * (s.oneShotLiftMax - s.oneShotLiftMin);
		if (
			this.#fire(buffer, ONESHOT, x + Math.cos(angle) * distance, y + lift, z + Math.sin(angle) * distance, 1)
		)
			this.#played.oneShots++;
	}

	#thunder(dt: number) {
		if (this.weather !== 'storm') return;
		this.#thunderWait -= dt;
		if (this.#thunderWait > 0) return;
		const s = STUDY_AUDIO;
		this.#thunderWait = s.thunderMin + this.#random() * (s.thunderMax - s.thunderMin);
		const buffer = this.#buffer('thunder');
		if (buffer && this.#fire(buffer, THUNDER, 0, 0, 0, 1)) this.#played.thunder++;
	}

	/** The call rate of a species now (0 = asleep). */
	#rate(call: StudyCall) {
		const hour = call.hours?.[this.hour] ?? 1;
		const wet = call.wet ?? WET_RATE;
		return hour * (this.weather === 'storm' ? wet * 0.6 : this.weather === 'rain' ? wet : 1);
	}

	#calls(
		actors: readonly StudyAudioActor[],
		homes: readonly HomeActor[] | null,
		dt: number,
		x: number,
		z: number
	) {
		const random = this.#random;
		for (let k = 0; k < actors.length; k++) {
			const actor = actors[k];
			const call = homes ? homes[k].call : STUDY_CALLS[actor.member.species];
			if (!call) continue;
			let caller = this.#callers.get(actor.member.key);
			if (!caller) {
				caller = { wait: random() * call.min, state: actor.state };
				this.#callers.set(actor.member.key, caller);
			}
			const alarmed = ALARM_STATES.has(actor.state);
			const turned = alarmed && !ALARM_STATES.has(caller.state);
			caller.state = actor.state;
			const dx = actor.x - x;
			const dz = actor.z - z;
			const near = dx * dx + dz * dz <= call.range * call.range;
			const y = actor.y + STUDY_AUDIO.callLift;
			const pitch = call.pitch ?? 1;
			if (turned && call.alarm && near) {
				const group = actor.member.group;
				if (this.#clock - (this.#alarmAt.get(group) ?? Number.NEGATIVE_INFINITY) < STUDY_AUDIO.alarmCooldown)
					continue;
				const buffer = this.#buffer(call.alarm);
				if (buffer && this.#fire(buffer, ALARM, actor.x, y, actor.z, pitch)) {
					this.#alarmAt.set(group, this.#clock);
					this.#played.alarms++;
					caller.wait = Math.max(caller.wait, call.min);
				}
				continue;
			}
			caller.wait -= dt;
			if (caller.wait > 0) continue;
			const rate = this.#rate(call);
			// Asleep: check again later.
			if (rate <= 0) {
				caller.wait = call.max;
				continue;
			}
			caller.wait = (call.min + random() * (call.max - call.min)) / rate;
			// Alert, fleeing or hidden animals keep quiet.
			if (!near || alarmed) continue;
			const buffer = this.#buffer(call.idle);
			if (buffer && this.#fire(buffer, CALL, actor.x, y, actor.z, pitch)) this.#played.calls++;
		}
	}

	#fire(buffer: AudioBuffer, sound: ExtraSound, x: number, y: number, z: number, rate: number): boolean {
		if (this.#shots.length >= STUDY_AUDIO.maxOneShots) return false;
		const at = this.#at;
		at.x = x;
		at.y = y;
		at.z = z;
		at.rate = rate;
		// Thunder is not placed: without `spatial` the engine ignores the position.
		const voice = this.#audio.playBuffer(buffer, sound, at);
		if (!voice) return false;
		this.#shots.push(voice);
		return true;
	}
}
