/**
 * The game's audio engine on native WebAudio.
 *
 * Graph: voice source → voice gain → [equal-power PannerNode] → bus duck gain →
 * bus volume gain → parent bus → … → master duck → master volume → limiter →
 * destination. Buses: music, ambience, sfx, ui under master; animals under
 * ambience (BUS_PARENT). A bus's volume gain carries volume² × (muted ? 0 : 1);
 * its duck gain is the deepest active `duck()`.
 *
 * Lifecycle: the context is created at once (browsers start it suspended);
 * the first user gesture resumes it and plays one silent sample (iOS). The
 * gesture listeners stay, so a context the OS interrupted (a call on iOS)
 * comes back on the next tap. Hidden page or pagehide: suspend; visible again
 * or pageshow: resume. One-shots are dropped unless the context runs (no burst
 * of stale sounds on return); loops may start any time and are heard once
 * the context runs.
 *
 * Voices: at most `maxVoices` (16) sources at once, loops included. When full,
 * a new sound takes the voice of the lowest priority (oldest first, voices
 * already fading out before anything else) if that priority is not above its
 * own; otherwise the new sound is dropped.
 *
 * Sounds play their recorded files once their category is loaded, and their
 * procedural placeholder (synth.ts) until then.
 */
import {
	BUS_PARENT,
	BUSES,
	type Bus,
	type Category,
	type Codec,
	codecOrder,
	SOUND_IDS,
	SOUNDS,
	type SoundBank,
	type SoundDef,
	type SoundId,
	STEP_SOUND,
	type Surface,
	variantUrls
} from './bank.ts';
import { renderPlaceholder, SYNTH_RATE, SYNTH_VARIANTS } from './synth.ts';

export const MAX_VOICES = 16;
/** Fade of a stolen or stopped voice, seconds: short enough to free it fast, long enough not to click. */
const STEAL_FADE = 0.02;
/** Time constant of volume and mute changes, seconds. */
const VOLUME_TAU = 0.015;
/** Two footsteps closer than this (seconds) are one: guards a double trigger at a phase wrap. */
const STEP_COOLDOWN = 0.07;

export interface AudioSettings {
	/** Slider position per bus, 0–1 (the gain is its square). */
	volume: Record<Bus, number>;
	muted: Record<Bus, boolean>;
}

export const DEFAULT_SETTINGS: Readonly<AudioSettings> = {
	volume: { master: 1, music: 0.7, ambience: 0.8, animals: 1, sfx: 0.9, ui: 0.8 },
	muted: { master: false, music: false, ambience: false, animals: false, sfx: false, ui: false }
};

/** Where one-shots and loops can be placed; omitted means non-spatial (the player's own sounds). */
export interface Position {
	x: number;
	y: number;
	z: number;
}

export interface PlayOptions extends Partial<Position> {
	/** Extra linear gain on top of the bank's. */
	gain?: number;
	/** Extra playback-rate factor on top of the jitter. */
	rate?: number;
}

export interface LoopOptions extends Partial<Position> {
	gain?: number;
	/** Fade-in, seconds (default 1). */
	fadeIn?: number;
}

export interface FootstepOptions extends Partial<Position> {
	/** Foot that touched down (AvatarAnimator.footstep): the right one is a hair lower. */
	foot?: 'left' | 'right';
	/** 1 for a walk, about 1.3 for a run, lower for sneaking. */
	intensity?: number;
}

export interface DuckOptions {
	/** Gain the ducked buses drop to, 0–1 (default 0.35). */
	amount?: number;
	/** Buses to duck (default music and ambience). */
	buses?: readonly Bus[];
	/** Seconds to go down (default 0.15) and to come back (default 0.6). */
	attack?: number;
	release?: number;
}

export interface Voice {
	readonly id: SoundId;
	/** False once it ended, was stopped or was stolen. */
	readonly playing: boolean;
	stop(fade?: number): void;
}

export interface LoopHandle extends Voice {
	setGain(gain: number, fade?: number): void;
	setPosition(x: number, y: number, z: number): void;
}

/** A camera or any Object3D: its world matrix gives the listener's position and orientation. */
export interface ListenerSource {
	matrixWorld: { elements: ArrayLike<number> };
}

export type AudioState = 'unavailable' | 'locked' | 'running' | 'suspended' | 'closed';

export interface GameAudio {
	readonly state: AudioState;
	/** Voices currently allocated (including ones fading out). */
	readonly voices: number;
	/** Resumes the context from a user gesture; resolves true when it runs. */
	unlock(): Promise<boolean>;
	play(id: SoundId, options?: PlayOptions): Voice | null;
	loop(id: SoundId, options?: LoopOptions): LoopHandle | null;
	/** One foot contact on a surface; call it from the animation's contact events. */
	footstep(surface: Surface, options?: FootstepOptions): Voice | null;
	/** Call once per frame after the camera moved; allocates nothing. */
	setListener(source: ListenerSource): void;
	setBusVolume(bus: Bus, volume: number): void;
	mute(muted: boolean, bus?: Bus): void;
	/** Lowers buses (dialogue, radio); returns the release, safe to call twice. */
	duck(options?: DuckOptions): () => void;
	/** A copy of the current settings (for the preferences store). */
	settings(): AudioSettings;
	/**
	 * Renders a category's placeholders, then fetches and decodes its recorded
	 * files (placeholders play meanwhile). Call it behind the loading screen.
	 */
	preload(category: Category, signal?: AbortSignal): Promise<void>;
	/** Stops everything, removes the listeners and closes the context. Idempotent. */
	dispose(): Promise<void>;
}

/** The part of `document` the engine listens to. */
export interface PageLike {
	readonly hidden: boolean;
	addEventListener(type: string, listener: () => void, options?: AddEventListenerOptions): void;
}

/** The part of `window` the engine listens to (pagehide/pageshow). */
export interface WindowLike {
	addEventListener(type: string, listener: () => void, options?: AddEventListenerOptions): void;
}

export interface GameAudioOptions {
	/** Defaults to `new AudioContext({ latencyHint: 'interactive' })`; null means no audio. */
	createContext?: () => AudioContext | null;
	/** Visibility and gesture source (default `document`). */
	page?: PageLike | null;
	/** pagehide/pageshow source (default `window`). */
	window?: WindowLike | null;
	/** Codec probe (default an <audio> element's canPlayType). */
	canPlayType?: (type: string) => string;
	fetch?: (
		url: string,
		init: { signal: AbortSignal }
	) => Promise<{ ok: boolean; arrayBuffer(): Promise<ArrayBuffer> }>;
	/** Jitter and variant source, [0, 1) (default Math.random). */
	random?: () => number;
	/** Saved settings to start from (missing keys take the defaults). */
	settings?: Partial<{ volume: Partial<Record<Bus, number>>; muted: Partial<Record<Bus, boolean>> }>;
	onSettingsChange?: (settings: AudioSettings) => void;
	/** A recording failed in every codec; the placeholder keeps playing. */
	onLoadError?: (id: SoundId, error: unknown) => void;
	/** Overrides the bank (tests, demos). */
	bank?: SoundBank;
	maxVoices?: number;
}

interface BusNodes {
	duck: GainNode;
	volume: GainNode;
	duckTarget: number;
}

interface VoiceRecord {
	id: SoundId;
	priority: number;
	started: number;
	source: AudioBufferSourceNode;
	gain: GainNode;
	panner: PannerNode | null;
	/** Fading out: first in line to be stolen. */
	releasing: boolean;
	done: boolean;
}

interface DuckEntry {
	amount: number;
	buses: readonly Bus[];
}

const GESTURES = ['pointerdown', 'touchend', 'keydown', 'mousedown'] as const;

const clamp01 = (value: number) => (value > 0 ? Math.min(value, 1) : 0);

function defaultContext(): AudioContext | null {
	const scope = globalThis as {
		AudioContext?: typeof AudioContext;
		webkitAudioContext?: typeof AudioContext;
	};
	const Context = scope.AudioContext ?? scope.webkitAudioContext;
	if (!Context) return null;
	try {
		return new Context({ latencyHint: 'interactive' });
	} catch {
		return null;
	}
}

function defaultCanPlayType(): (type: string) => string {
	const doc = (globalThis as { document?: Document }).document;
	if (!doc) return () => '';
	const element = doc.createElement('audio');
	return (type) => element.canPlayType(type);
}

function readSettings(saved: GameAudioOptions['settings']): AudioSettings {
	const settings: AudioSettings = {
		volume: { ...DEFAULT_SETTINGS.volume },
		muted: { ...DEFAULT_SETTINGS.muted }
	};
	for (const bus of BUSES) {
		const volume = saved?.volume?.[bus];
		const muted = saved?.muted?.[bus];
		if (typeof volume === 'number' && Number.isFinite(volume)) settings.volume[bus] = clamp01(volume);
		if (typeof muted === 'boolean') settings.muted[bus] = muted;
	}
	return settings;
}

/** Stops and disconnects quietly: nodes may already be stopped or disconnected. */
function silence(record: VoiceRecord) {
	record.source.onended = null;
	try {
		record.source.stop();
	} catch {
		// Already stopped.
	}
	record.source.disconnect();
	record.gain.disconnect();
	record.panner?.disconnect();
}

class GameAudioEngine implements GameAudio {
	readonly #context: AudioContext | null;
	readonly #bank: SoundBank;
	readonly #random: () => number;
	readonly #maxVoices: number;
	readonly #codecs: Codec[];
	readonly #fetch: GameAudioOptions['fetch'];
	readonly #onSettingsChange: GameAudioOptions['onSettingsChange'];
	readonly #onLoadError: GameAudioOptions['onLoadError'];
	readonly #page: PageLike | null;
	readonly #settings: AudioSettings;
	readonly #buses = new Map<Bus, BusNodes>();
	readonly #voices: VoiceRecord[] = [];
	readonly #ducks = new Set<DuckEntry>();
	/** Recorded variants, once their category is decoded. */
	readonly #recorded = new Map<SoundId, AudioBuffer[]>();
	/** Placeholder variants, rendered on first use. */
	readonly #placeholders = new Map<SoundId, AudioBuffer[]>();
	readonly #loading = new Map<Category, Promise<void>>();
	/** Aborts the listeners and every load on dispose. */
	readonly #lifetime = new AbortController();
	/** Unlock samples still playing (one sample long; tracked so dispose leaves nothing behind). */
	readonly #silent = new Set<AudioBufferSourceNode>();
	#limiter: DynamicsCompressorNode | null = null;
	#unlocked = false;
	#pageHidden = false;
	#disposed: Promise<void> | null = null;
	#lastStep = Number.NEGATIVE_INFINITY;
	#lx = 0;
	#ly = 0;
	#lz = 0;

	constructor(options: GameAudioOptions) {
		this.#bank = options.bank ?? SOUNDS;
		this.#random = options.random ?? Math.random;
		this.#maxVoices = options.maxVoices ?? MAX_VOICES;
		this.#codecs = codecOrder(options.canPlayType ?? defaultCanPlayType());
		this.#fetch =
			options.fetch ?? (globalThis.fetch ? (url, init) => globalThis.fetch(url, init) : undefined);
		this.#onSettingsChange = options.onSettingsChange;
		this.#onLoadError = options.onLoadError;
		this.#settings = readSettings(options.settings);
		this.#context = (options.createContext ?? defaultContext)();
		this.#page =
			options.page === undefined ? ((globalThis as { document?: PageLike }).document ?? null) : options.page;
		const win =
			options.window === undefined
				? ((globalThis as { window?: WindowLike }).window ?? null)
				: options.window;
		if (!this.#context) return;
		this.#buildGraph(this.#context);
		this.#pageHidden = this.#page?.hidden ?? false;
		const listen = { signal: this.#lifetime.signal, passive: true };
		if (this.#page) {
			const page = this.#page;
			const onGesture = () => {
				if (!page.hidden && this.#context?.state !== 'running') void this.unlock();
			};
			for (const type of GESTURES) page.addEventListener(type, onGesture, listen);
			page.addEventListener('visibilitychange', () => (page.hidden ? this.#hide() : this.#show()), listen);
		}
		if (win) {
			win.addEventListener('pagehide', () => this.#hide(), listen);
			win.addEventListener(
				'pageshow',
				() => {
					if (!this.#page?.hidden) this.#show();
				},
				listen
			);
		}
	}

	get state(): AudioState {
		const context = this.#context;
		if (!context) return 'unavailable';
		if (this.#disposed || context.state === 'closed') return 'closed';
		if (!this.#unlocked) return 'locked';
		return context.state === 'running' ? 'running' : 'suspended';
	}

	get voices() {
		return this.#voices.length;
	}

	#buildGraph(context: AudioContext) {
		let output: AudioNode = context.destination;
		if (typeof context.createDynamicsCompressor === 'function') {
			// A gentle limiter: sixteen voices summed must not clip on phone speakers.
			const limiter = context.createDynamicsCompressor();
			limiter.threshold.value = -6;
			limiter.knee.value = 6;
			limiter.ratio.value = 12;
			limiter.attack.value = 0.003;
			limiter.release.value = 0.25;
			limiter.connect(output);
			output = limiter;
			this.#limiter = limiter;
		}
		for (const bus of BUSES) {
			const duck = context.createGain();
			const volume = context.createGain();
			duck.connect(volume);
			volume.connect(bus === 'master' ? output : (this.#buses.get(BUS_PARENT[bus]) as BusNodes).duck);
			volume.gain.value = this.#busGain(bus);
			this.#buses.set(bus, { duck, volume, duckTarget: 1 });
		}
	}

	#busGain(bus: Bus) {
		const volume = this.#settings.volume[bus];
		return this.#settings.muted[bus] ? 0 : volume * volume;
	}

	// --- Lifecycle ---------------------------------------------------------------

	unlock(): Promise<boolean> {
		const context = this.#context;
		if (!context || this.#disposed) return Promise.resolve(false);
		this.#unlocked = true;
		// Synchronously inside the gesture: iOS only honours resume() and a first start() there.
		const silent = context.createBufferSource();
		silent.buffer = context.createBuffer(1, 1, context.sampleRate);
		silent.connect(context.destination);
		this.#silent.add(silent);
		silent.onended = () => {
			silent.onended = null;
			silent.disconnect();
			this.#silent.delete(silent);
		};
		silent.start(0);
		if (this.#pageHidden) return Promise.resolve(false);
		return context.resume().then(
			() => context.state === 'running',
			() => false
		);
	}

	#hide() {
		this.#pageHidden = true;
		const context = this.#context;
		if (context && !this.#disposed && context.state === 'running') void context.suspend().catch(() => {});
	}

	#show() {
		this.#pageHidden = false;
		const context = this.#context;
		if (context && !this.#disposed && this.#unlocked && context.state !== 'running')
			void context.resume().catch(() => {});
	}

	dispose(): Promise<void> {
		if (!this.#disposed)
			this.#disposed = (async () => {
				this.#lifetime.abort();
				for (const record of this.#voices.splice(0)) {
					record.done = true;
					silence(record);
				}
				for (const silent of this.#silent) {
					silent.onended = null;
					try {
						silent.stop();
					} catch {
						// Already ended.
					}
					silent.disconnect();
				}
				this.#silent.clear();
				this.#ducks.clear();
				for (const { duck, volume } of this.#buses.values()) {
					duck.disconnect();
					volume.disconnect();
				}
				this.#buses.clear();
				this.#limiter?.disconnect();
				this.#recorded.clear();
				this.#placeholders.clear();
				const context = this.#context;
				if (context && context.state !== 'closed') await context.close().catch(() => {});
			})();
		return this.#disposed;
	}

	// --- Settings ----------------------------------------------------------------

	setBusVolume(bus: Bus, volume: number) {
		if (!Number.isFinite(volume)) return;
		this.#settings.volume[bus] = clamp01(volume);
		this.#applyBus(bus);
	}

	mute(muted: boolean, bus: Bus = 'master') {
		this.#settings.muted[bus] = muted;
		this.#applyBus(bus);
	}

	settings(): AudioSettings {
		return { volume: { ...this.#settings.volume }, muted: { ...this.#settings.muted } };
	}

	#applyBus(bus: Bus) {
		const nodes = this.#buses.get(bus);
		const context = this.#context;
		if (nodes && context) {
			const param = nodes.volume.gain;
			param.cancelScheduledValues(context.currentTime);
			param.setTargetAtTime(this.#busGain(bus), context.currentTime, VOLUME_TAU);
		}
		this.#onSettingsChange?.(this.settings());
	}

	duck(options: DuckOptions = {}): () => void {
		const entry: DuckEntry = {
			amount: clamp01(options.amount ?? 0.35),
			buses: options.buses ?? ['music', 'ambience']
		};
		const attack = options.attack ?? 0.15;
		const release = options.release ?? 0.6;
		this.#ducks.add(entry);
		this.#applyDucks(attack);
		let released = false;
		return () => {
			if (released) return;
			released = true;
			this.#ducks.delete(entry);
			this.#applyDucks(release);
		};
	}

	#applyDucks(seconds: number) {
		const context = this.#context;
		if (!context || this.#disposed) return;
		for (const [bus, nodes] of this.#buses) {
			let target = 1;
			for (const entry of this.#ducks) if (entry.buses.includes(bus)) target = Math.min(target, entry.amount);
			if (target === nodes.duckTarget) continue;
			nodes.duckTarget = target;
			const param = nodes.duck.gain;
			param.cancelScheduledValues(context.currentTime);
			// setTargetAtTime reaches ~95% after three time constants.
			param.setTargetAtTime(target, context.currentTime, Math.max(0.001, seconds / 3));
		}
	}

	// --- Listener ------------------------------------------------------------------

	setListener(source: ListenerSource) {
		const context = this.#context;
		if (!context || this.#disposed) return;
		const e = source.matrixWorld.elements;
		// Column 3 is the position, −column 2 the forward axis, column 1 up (three.js cameras look down −z).
		const x = e[12];
		const y = e[13];
		const z = e[14];
		this.#lx = x;
		this.#ly = y;
		this.#lz = z;
		const listener = context.listener;
		if (listener.positionX) {
			listener.positionX.value = x;
			listener.positionY.value = y;
			listener.positionZ.value = z;
			listener.forwardX.value = -e[8];
			listener.forwardY.value = -e[9];
			listener.forwardZ.value = -e[10];
			listener.upX.value = e[4];
			listener.upY.value = e[5];
			listener.upZ.value = e[6];
		} else {
			// Safari before 14.1: the deprecated setters, also allocation-free.
			listener.setPosition(x, y, z);
			listener.setOrientation(-e[8], -e[9], -e[10], e[4], e[5], e[6]);
		}
	}

	// --- Buffers -------------------------------------------------------------------

	#buffers(id: SoundId, def: SoundDef): AudioBuffer[] | null {
		const recorded = this.#recorded.get(id);
		if (recorded && recorded.length > 0) return recorded;
		if (def.files.length > 0) void this.preload(def.category);
		return this.#placeholder(id);
	}

	#placeholder(id: SoundId): AudioBuffer[] | null {
		const context = this.#context;
		if (!context) return null;
		let buffers = this.#placeholders.get(id);
		if (!buffers) {
			buffers = [];
			for (let variant = 0; variant < (SYNTH_VARIANTS[id] ?? 1); variant++) {
				const data = renderPlaceholder(id, variant);
				const buffer = context.createBuffer(1, data.length, SYNTH_RATE);
				buffer.getChannelData(0).set(data);
				buffers.push(buffer);
			}
			this.#placeholders.set(id, buffers);
		}
		return buffers;
	}

	preload(category: Category, signal?: AbortSignal): Promise<void> {
		const context = this.#context;
		if (!context || this.#disposed) return Promise.resolve();
		// Placeholders of the category are rendered now (a loading screen), not on first play:
		// the forest bed is about 17 s of samples.
		for (const id of SOUND_IDS) if (this.#bank[id].category === category) this.#placeholder(id);
		const fetcher = this.#fetch;
		if (!fetcher) return Promise.resolve();
		const running = this.#loading.get(category);
		if (running) return running;
		const abort = new AbortController();
		const stop = () => abort.abort();
		this.#lifetime.signal.addEventListener('abort', stop, { once: true });
		signal?.addEventListener('abort', stop, { once: true });
		if (signal?.aborted) stop();
		const job = (async () => {
			for (const id of SOUND_IDS) {
				const def = this.#bank[id];
				if (def.category !== category || def.files.length === 0 || this.#recorded.has(id)) continue;
				const buffers: AudioBuffer[] = [];
				for (const files of def.files) {
					let lastError: unknown = new Error('no playable codec');
					for (const url of variantUrls(files, this.#codecs)) {
						if (abort.signal.aborted) return;
						try {
							const response = await fetcher(url, { signal: abort.signal });
							if (!response.ok) throw new Error(`HTTP error for ${url}`);
							const bytes = await response.arrayBuffer();
							buffers.push(await context.decodeAudioData(bytes));
							lastError = null;
							break;
						} catch (error) {
							if (abort.signal.aborted) return;
							lastError = error;
						}
					}
					if (lastError !== null) this.#onLoadError?.(id, lastError);
				}
				if (buffers.length > 0 && !this.#disposed) this.#recorded.set(id, buffers);
			}
		})().finally(() => {
			this.#lifetime.signal.removeEventListener('abort', stop);
			signal?.removeEventListener('abort', stop);
			// An aborted or finished load may be asked for again (aborted ones resume, finished ones skip).
			this.#loading.delete(category);
		});
		this.#loading.set(category, job);
		return job;
	}

	// --- Voices --------------------------------------------------------------------

	/** Frees a voice for `priority` if the pool is full; false when nothing may be stolen. */
	#claim(priority: number): boolean {
		if (this.#voices.length < this.#maxVoices) return true;
		let victim: VoiceRecord | null = null;
		for (const record of this.#voices) {
			if (!victim) victim = record;
			else if (record.releasing !== victim.releasing) {
				if (record.releasing) victim = record;
			} else if (
				record.priority < victim.priority ||
				(record.priority === victim.priority && record.started < victim.started)
			)
				victim = record;
		}
		if (!victim || (!victim.releasing && victim.priority > priority)) return false;
		this.#forget(victim);
		this.#fadeAndStop(victim, STEAL_FADE);
		return true;
	}

	#forget(record: VoiceRecord) {
		const at = this.#voices.indexOf(record);
		if (at >= 0) this.#voices.splice(at, 1);
	}

	#ended(record: VoiceRecord) {
		if (record.done) return;
		record.done = true;
		this.#forget(record);
		record.source.onended = null;
		record.source.disconnect();
		record.gain.disconnect();
		record.panner?.disconnect();
	}

	#fadeAndStop(record: VoiceRecord, fade: number) {
		const context = this.#context;
		if (!context || record.done) return;
		record.releasing = true;
		const now = context.currentTime;
		const param = record.gain.gain;
		param.cancelScheduledValues(now);
		param.setValueAtTime(param.value, now);
		param.linearRampToValueAtTime(0, now + Math.max(0.005, fade));
		try {
			record.source.stop(now + Math.max(0.005, fade) + 0.01);
		} catch {
			this.#ended(record);
		}
	}

	#start(
		id: SoundId,
		def: SoundDef,
		gain: number,
		rate: number,
		position: Partial<Position> | undefined,
		loop: boolean,
		fadeIn: number
	): VoiceRecord | null {
		const context = this.#context as AudioContext;
		const buffers = this.#buffers(id, def);
		if (!buffers || buffers.length === 0) return null;
		const spatial = def.spatial && position && position.x !== undefined ? def.spatial : null;
		if (spatial && !loop) {
			const dx = (position?.x ?? 0) - this.#lx;
			const dy = (position?.y ?? 0) - this.#ly;
			const dz = (position?.z ?? 0) - this.#lz;
			if (dx * dx + dy * dy + dz * dz > spatial.max * spatial.max) return null;
		}
		if (!this.#claim(def.priority)) return null;
		const bus = this.#buses.get(def.bus);
		if (!bus) return null;

		const buffer = buffers.length === 1 ? buffers[0] : buffers[Math.floor(this.#random() * buffers.length)];
		const source = context.createBufferSource();
		source.buffer = buffer;
		source.playbackRate.value = rate;
		if (loop) {
			source.loop = true;
			// Recorded loops carry their seamless points (encoder padding); placeholders loop whole.
			if (def.loop && this.#recorded.has(id)) {
				source.loopStart = def.loop.start;
				source.loopEnd = def.loop.end;
			}
		}
		const voiceGain = context.createGain();
		const now = context.currentTime;
		if (fadeIn > 0) {
			voiceGain.gain.setValueAtTime(0, now);
			voiceGain.gain.linearRampToValueAtTime(gain, now + fadeIn);
		} else voiceGain.gain.value = gain;
		source.connect(voiceGain);
		let panner: PannerNode | null = null;
		if (spatial) {
			panner = context.createPanner();
			panner.panningModel = 'equalpower';
			panner.distanceModel = 'inverse';
			panner.refDistance = spatial.ref;
			panner.rolloffFactor = spatial.rolloff;
			panner.maxDistance = spatial.max;
			voiceGain.connect(panner);
			panner.connect(bus.duck);
			setPannerPosition(panner, position?.x ?? 0, position?.y ?? 0, position?.z ?? 0);
		} else voiceGain.connect(bus.duck);

		const record: VoiceRecord = {
			id,
			priority: def.priority,
			started: now,
			source,
			gain: voiceGain,
			panner,
			releasing: false,
			done: false
		};
		source.onended = () => this.#ended(record);
		source.start(now);
		this.#voices.push(record);
		return record;
	}

	/**
	 * One-shots need an unlocked, visible page and a running context: sounds
	 * requested while locked, hidden or not yet resumed are dropped (a suspended
	 * context would queue them and play them all at once on resume).
	 */
	#canPlay() {
		return (
			this.#context !== null &&
			!this.#disposed &&
			this.#unlocked &&
			!this.#pageHidden &&
			this.#context.state === 'running'
		);
	}

	play(id: SoundId, options: PlayOptions = {}): Voice | null {
		if (!this.#canPlay()) return null;
		const def = this.#bank[id];
		const random = this.#random;
		const semitones = (random() * 2 - 1) * def.pitchJitter;
		const decibels = (random() * 2 - 1) * def.gainJitter;
		const rate = 2 ** (semitones / 12) * (options.rate ?? 1);
		const gain = def.gain * 10 ** (decibels / 20) * (options.gain ?? 1);
		const record = this.#start(id, def, gain, rate, options, false, 0);
		return record ? this.#handle(record) : null;
	}

	footstep(surface: Surface, options: FootstepOptions = {}): Voice | null {
		if (!this.#canPlay()) return null;
		const context = this.#context as AudioContext;
		const own = options.x === undefined;
		// The player's steps are rate-limited; animals' (positioned) are not.
		if (own) {
			if (context.currentTime - this.#lastStep < STEP_COOLDOWN) return null;
			this.#lastStep = context.currentTime;
		}
		const intensity = Math.max(0, Math.min(1.5, options.intensity ?? 1));
		return this.play(STEP_SOUND[surface], {
			x: options.x,
			y: options.y,
			z: options.z,
			gain: 0.55 + 0.45 * intensity,
			rate: options.foot === 'right' ? 0.97 : 1
		});
	}

	loop(id: SoundId, options: LoopOptions = {}): LoopHandle | null {
		if (!this.#context || this.#disposed) return null;
		const def = this.#bank[id];
		const base = def.gain * (options.gain ?? 1);
		const record = this.#start(id, def, base, 1, options, true, Math.max(0, options.fadeIn ?? 1));
		if (!record) return null;
		const handle = this.#handle(record) as Voice & Partial<LoopHandle>;
		handle.setGain = (gain: number, fade = 0.3) => {
			const context = this.#context;
			if (!context || record.done || record.releasing) return;
			const now = context.currentTime;
			const param = record.gain.gain;
			param.cancelScheduledValues(now);
			param.setValueAtTime(param.value, now);
			param.linearRampToValueAtTime(def.gain * Math.max(0, gain), now + Math.max(0.005, fade));
		};
		handle.setPosition = (x: number, y: number, z: number) => {
			if (record.panner && !record.done) setPannerPosition(record.panner, x, y, z);
		};
		return handle as LoopHandle;
	}

	#handle(record: VoiceRecord): Voice {
		return {
			id: record.id,
			get playing() {
				return !record.done && !record.releasing;
			},
			stop: (fade = STEAL_FADE) => this.#fadeAndStop(record, fade)
		};
	}
}

function setPannerPosition(panner: PannerNode, x: number, y: number, z: number) {
	if (panner.positionX) {
		panner.positionX.value = x;
		panner.positionY.value = y;
		panner.positionZ.value = z;
	} else panner.setPosition(x, y, z);
}

/** The game's audio: buses, voices, placeholders and the page lifecycle. See the module comment. */
export function createGameAudio(options: GameAudioOptions = {}): GameAudio {
	return new GameAudioEngine(options);
}
