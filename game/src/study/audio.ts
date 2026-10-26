/**
 * Sound of the LOCAL-ONLY Green Hell study mode (P15): their ambience beds and
 * the picked animals' calls, over or instead of our T1 mix, to compare by ear.
 * The files come from the served catalog (data.ts) through the dev middleware;
 * this module keeps curation only (sound group ids, intervals, ranges), never a
 * path. Report: ~/.cache/agents/2026-10-25-trilha-secreta/p15-estudo-audio.md.
 *
 * - `&hora=noite`: the night beds (default: day).
 * - `&som=ambos`: their beds over ours; `&som=nosso`: ours only (study sounds
 *   off). Default: theirs, with our forest bed muted (our river, waterfall and
 *   animal calls stay).
 * - Beds (ambience bus, priority 9): the forest bed, crickets at night, and the
 *   swamp bed, which swells within 30 u of the river.
 * - One-shots (animals bus, placed): a random day or night call every 5–12 s,
 *   12–35 u away, up in the canopy.
 * - Calls: each study animal calls from where it stands now (the live study
 *   fauna, `globalThis.__estudo`) every `min`–`max` s within `range`; its group
 *   gives one alarm when it turns to alert, flee or hide.
 * - At most `maxOneShots` study one-shots at once, inside the shared 16-voice pool.
 *
 * Soundscape starts it behind `import.meta.env.DEV` with a dynamic import, so a
 * build never sees this module.
 */
import { ANIMAL_SPATIAL } from '../audio/bank.ts';
import type { ExtraSound, GameAudio, LoopHandle, PlayOptions, Voice } from '../audio/engine.ts';
import type { SurvivalWorld } from '../survival/types.ts';
import { loadStudyCatalog, type StudyCatalog } from './data.ts';
import { studyEnabled, studyUrl } from './gate.ts';
import { riverDistanceField } from './herds.ts';

export type StudyHour = 'day' | 'night';
/** Whose ambience plays: theirs (ours muted), both layered, or ours only. */
export type StudyMix = 'theirs' | 'both' | 'ours';

const currentSearch = () => (typeof location === 'undefined' ? '' : location.search);

/** `&hora=noite` for the night beds, day otherwise. */
export function studyHour(search: string = currentSearch()): StudyHour {
	return new URLSearchParams(search).get('hora') === 'noite' ? 'night' : 'day';
}

/** `&som=nosso|ambos`, theirs by default. */
export function studyMix(search: string = currentSearch()): StudyMix {
	const mix = new URLSearchParams(search).get('som');
	return mix === 'nosso' ? 'ours' : mix === 'ambos' ? 'both' : 'theirs';
}

export interface StudyBed {
	/** Sound group id in the curation. */
	id: string;
	/** Full within `riverNear` u of the river, silent past `riverFar`. */
	river?: boolean;
}

export const STUDY_BEDS: Readonly<Record<StudyHour, readonly StudyBed[]>> = {
	day: [{ id: 'jungle-day-bed' }, { id: 'swamp-day-bed', river: true }],
	night: [{ id: 'jungle-night-bed' }, { id: 'crickets' }, { id: 'swamp-night-bed', river: true }]
};

/** The random calls sprinkled around the listener. */
export const STUDY_ONESHOTS: Readonly<Record<StudyHour, string>> = { day: 'day-calls', night: 'night-calls' };

export interface StudyCall {
	idle: string;
	alarm?: string;
	/** Seconds between idle calls. */
	min: number;
	max: number;
	/** Calls only while the listener is this close, u. */
	range: number;
	/** Playback-rate factor (the tapir calf is a higher anta). */
	rate?: number;
}

/** Keyed by STUDY_PICKS id. The crab, jabuti and tamanduá have no sounds in the extraction. */
export const STUDY_CALLS: Readonly<Record<string, StudyCall>> = {
	Capybara: { idle: 'capybara-calls', alarm: 'capybara-alarm', min: 14, max: 35, range: 45 },
	Tapir: { idle: 'tapir-calls', alarm: 'tapir-alarm', min: 20, max: 50, range: 55 },
	Tapir_baby: { idle: 'tapir-calls', alarm: 'tapir-alarm', min: 25, max: 60, range: 45, rate: 1.25 },
	Peccary: { idle: 'peccary-calls', alarm: 'peccary-alarm', min: 8, max: 22, range: 45 },
	Armadillo: { idle: 'armadillo-calls', min: 12, max: 30, range: 25 },
	CaneToad: { idle: 'toad-calls', min: 6, max: 16, range: 35 },
	Puma: { idle: 'puma-calls', min: 60, max: 140, range: 60 },
	// The A/B toucan beside our tucano ('maybe' in the curation).
	Toucan: { idle: 'toucan-calls', min: 20, max: 60, range: 60 }
};

export const STUDY_AUDIO = {
	maxOneShots: 4,
	/** Seconds between sprinkled one-shots. */
	oneShotMin: 5,
	oneShotMax: 12,
	/** u from the listener, and up into the canopy. */
	oneShotNear: 12,
	oneShotFar: 35,
	oneShotLiftMin: 3,
	oneShotLiftMax: 9,
	/** u above an animal's feet its calls come from. */
	callLift: 0.6,
	riverNear: 4,
	riverFar: 30,
	/** Seconds between river-distance samples. */
	riverEvery: 0.25,
	bedFadeIn: 3,
	/** One alarm per group in this many seconds. */
	alarmCooldown: 10
} as const;

const BED: ExtraSound = { bus: 'ambience', priority: 9 };
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

export interface StudyAudioHost {
	audio: GameAudio;
	/** The map: river distance for the swamp bed. Null for the graybox fixture. */
	world?: SurvivalWorld | null;
	/** Our forest bed, muted while their beds play alone. */
	ownBed?: LoopHandle | null;
	search?: string;
	random?: () => number;
	/** WebM/Opus playable (else the `.m4a` twins). Default: asked of an <audio> element. */
	opus?: boolean;
	/** Tests: the catalog and the live actors. */
	catalog?: (signal: AbortSignal) => Promise<StudyCatalog>;
	actors?: () => readonly StudyAudioActor[] | null;
}

export interface StudyAudioDebug {
	hour: StudyHour;
	mix: StudyMix;
	ready: boolean;
	beds: string[];
	/** Curated group ids absent from the served catalog. */
	missing: string[];
	decoded: number;
	oneShots: number;
	played: { oneShots: number; calls: number; alarms: number };
	riverLevel: number;
}

/**
 * The study sounds, or null unless this is the dev server with
 * `?estudo=greenhell` (and not `&som=nosso`).
 */
export function startStudyAudio(host: StudyAudioHost): StudyAudioRuntime | null {
	if (!import.meta.env.DEV) return null;
	const search = host.search ?? currentSearch();
	if (!studyEnabled(search) || studyMix(search) === 'ours') return null;
	return new StudyAudioRuntime(host, search);
}

const liveActors = () =>
	(globalThis as { __estudo?: { actors?: readonly StudyAudioActor[] } }).__estudo?.actors ?? null;

const canPlayOpus = () =>
	typeof document !== 'undefined' &&
	document.createElement('audio').canPlayType('audio/webm; codecs="opus"') !== '';

interface MemberState {
	wait: number;
	state: string;
}

export class StudyAudioRuntime {
	readonly hour: StudyHour;
	readonly mix: StudyMix;
	readonly missing: string[] = [];
	readonly #audio: GameAudio;
	readonly #random: () => number;
	readonly #actors: () => readonly StudyAudioActor[] | null;
	readonly #opus: boolean;
	readonly #ownBed: LoopHandle | null;
	readonly #abort = new AbortController();
	/** Group id → file URLs (the served catalog's paths, codec chosen). */
	readonly #groups = new Map<string, readonly string[]>();
	readonly #pending = new Map<string, Promise<AudioBuffer | null>>();
	readonly #decoded = new Map<string, AudioBuffer>();
	readonly #beds: { bed: StudyBed; handle: LoopHandle }[] = [];
	readonly #shots: Voice[] = [];
	readonly #members = new Map<string, MemberState>();
	readonly #alarmAt = new Map<string, number>();
	readonly #at: PlayOptions = { x: 0, y: 0, z: 0, gain: 1, rate: 1 };
	readonly #played = { oneShots: 0, calls: 0, alarms: 0 };
	readonly #river: Float32Array | null;
	readonly #grid: number;
	#riverLevel = 0;
	#riverWait = 0;
	#oneShotWait: number;
	#clock = 0;
	#ready = false;
	#disposed = false;

	constructor(host: StudyAudioHost, search: string) {
		this.hour = studyHour(search);
		this.mix = studyMix(search);
		this.#audio = host.audio;
		this.#random = host.random ?? Math.random;
		this.#actors = host.actors ?? liveActors;
		this.#opus = host.opus ?? canPlayOpus();
		this.#ownBed = host.ownBed ?? null;
		this.#river = host.world ? riverDistanceField(host.world) : null;
		this.#grid = host.world?.grid ?? 0;
		this.#oneShotWait = STUDY_AUDIO.oneShotMin * this.#random();
		if (this.mix === 'theirs') this.#ownBed?.setGain(0, 2);
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
		this.#riverWait -= dt;
		if (this.#riverWait <= 0) {
			this.#riverWait = STUDY_AUDIO.riverEvery;
			this.#sampleRiver(x, z);
		}
		if (!this.#ready) return;
		let kept = 0;
		for (const voice of this.#shots) if (voice.playing) this.#shots[kept++] = voice;
		this.#shots.length = kept;
		this.#sprinkle(dt, x, y, z);
		this.#calls(dt, x, z);
	}

	debug(): StudyAudioDebug {
		return {
			hour: this.hour,
			mix: this.mix,
			ready: this.#ready,
			beds: this.#beds.map((b) => b.bed.id),
			missing: [...this.missing],
			decoded: this.#decoded.size,
			oneShots: this.#shots.length,
			played: { ...this.#played },
			riverLevel: Number(this.#riverLevel.toFixed(2))
		};
	}

	dispose() {
		if (this.#disposed) return;
		this.#disposed = true;
		this.#abort.abort();
		for (const { handle } of this.#beds) handle.stop(0.5);
		for (const voice of this.#shots) voice.stop(0.2);
		this.#beds.length = 0;
		this.#shots.length = 0;
		this.#ownBed?.setGain(1, 1);
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
		const beds = STUDY_BEDS[this.hour];
		const wanted = new Set([...beds.map((b) => b.id), STUDY_ONESHOTS[this.hour]]);
		for (const call of Object.values(STUDY_CALLS)) {
			wanted.add(call.idle);
			if (call.alarm) wanted.add(call.alarm);
		}
		for (const id of wanted) if (!this.#groups.get(id)?.length) this.missing.push(id);
		// One file of every one-shot group up front, so the first call has something to play.
		for (const id of wanted) {
			const urls = this.#groups.get(id);
			if (urls?.length && !beds.some((b) => b.id === id)) void this.#decode(this.#choose(urls));
		}
		await Promise.all(beds.map((bed) => this.#startBed(bed)));
		if (!this.#disposed) this.#ready = true;
	}

	async #startBed(bed: StudyBed) {
		const urls = this.#groups.get(bed.id);
		if (!urls?.length) return;
		const buffer = await this.#decode(this.#choose(urls));
		if (!buffer || this.#disposed) return;
		const gain = bed.river ? this.#riverLevel : 1;
		const handle = this.#audio.loopBuffer(buffer, BED, { gain, fadeIn: STUDY_AUDIO.bedFadeIn });
		if (handle) this.#beds.push({ bed, handle });
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

	#sampleRiver(x: number, z: number) {
		const river = this.#river;
		if (!river) return;
		const n = this.#grid;
		const i = Math.max(0, Math.min(n - 1, Math.round(x)));
		const j = Math.max(0, Math.min(n - 1, Math.round(z)));
		const distance = river[j * n + i];
		const { riverNear, riverFar } = STUDY_AUDIO;
		const level = Math.max(0, Math.min(1, (riverFar - distance) / (riverFar - riverNear)));
		if (Math.abs(level - this.#riverLevel) < 0.02) return;
		this.#riverLevel = level;
		for (const { bed, handle } of this.#beds) if (bed.river) handle.setGain(level, 0.6);
	}

	#sprinkle(dt: number, x: number, y: number, z: number) {
		this.#oneShotWait -= dt;
		if (this.#oneShotWait > 0) return;
		const random = this.#random;
		const s = STUDY_AUDIO;
		this.#oneShotWait = s.oneShotMin + random() * (s.oneShotMax - s.oneShotMin);
		const buffer = this.#buffer(STUDY_ONESHOTS[this.hour]);
		if (!buffer) return;
		const angle = random() * Math.PI * 2;
		const distance = s.oneShotNear + random() * (s.oneShotFar - s.oneShotNear);
		const lift = s.oneShotLiftMin + random() * (s.oneShotLiftMax - s.oneShotLiftMin);
		if (
			this.#fire(buffer, ONESHOT, x + Math.cos(angle) * distance, y + lift, z + Math.sin(angle) * distance, 1)
		)
			this.#played.oneShots++;
	}

	#calls(dt: number, x: number, z: number) {
		const actors = this.#actors();
		if (!actors) return;
		const random = this.#random;
		for (const actor of actors) {
			const call = STUDY_CALLS[actor.member.species];
			if (!call) continue;
			let member = this.#members.get(actor.member.key);
			if (!member) {
				member = { wait: random() * call.min, state: actor.state };
				this.#members.set(actor.member.key, member);
			}
			const alarmed = ALARM_STATES.has(actor.state);
			const turned = alarmed && !ALARM_STATES.has(member.state);
			member.state = actor.state;
			const dx = actor.x - x;
			const dz = actor.z - z;
			const near = dx * dx + dz * dz <= call.range * call.range;
			const y = actor.y + STUDY_AUDIO.callLift;
			if (turned && call.alarm && near) {
				const group = actor.member.group;
				if (this.#clock - (this.#alarmAt.get(group) ?? Number.NEGATIVE_INFINITY) < STUDY_AUDIO.alarmCooldown)
					continue;
				const buffer = this.#buffer(call.alarm);
				if (buffer && this.#fire(buffer, ALARM, actor.x, y, actor.z, call.rate ?? 1)) {
					this.#alarmAt.set(group, this.#clock);
					this.#played.alarms++;
					member.wait = Math.max(member.wait, call.min);
				}
				continue;
			}
			member.wait -= dt;
			if (member.wait > 0) continue;
			member.wait = call.min + random() * (call.max - call.min);
			// Alert, fleeing or hidden animals keep quiet.
			if (!near || alarmed) continue;
			const buffer = this.#buffer(call.idle);
			if (buffer && this.#fire(buffer, CALL, actor.x, y, actor.z, call.rate ?? 1)) this.#played.calls++;
		}
	}

	#fire(buffer: AudioBuffer, sound: ExtraSound, x: number, y: number, z: number, rate: number): boolean {
		if (this.#shots.length >= STUDY_AUDIO.maxOneShots) return false;
		const at = this.#at;
		at.x = x;
		at.y = y;
		at.z = z;
		at.rate = rate;
		const voice = this.#audio.playBuffer(buffer, sound, at);
		if (!voice) return false;
		this.#shots.push(voice);
		return true;
	}
}
