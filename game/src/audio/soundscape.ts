/**
 * The game's sounds, wired to the scene: one per mounted game, around a
 * GameAudio it owns.
 *
 * - Player: footsteps on the animator's foot contacts (surface.ts), jump and
 *   land from the controller (land louder with the landing speed), checkpoint,
 *   and a splash on the deep-water fall that leads to the respawn.
 * - Missions: story-cues.ts, compared on each story revision; dialogues duck
 *   the ambience (animals included) and music.
 * - Ambience, once the 'nature' category is decoded (a bed started earlier
 *   would keep its placeholder): the day forest bed, the river emitter on the
 *   river point nearest the listener, the waterfall at its landmark, the
 *   chainsaw at the illegal cutting while mission 2 is not done, and animal
 *   calls from their homes (the howler as the north-western landmark).
 *
 * `update` runs once per frame and allocates nothing on frames without a
 * sound event; it times itself (performance.now) for the debug overlay.
 */

import type { CheckpointEvent } from '../engine/checkpoints.ts';
import { JUMP_SPEED } from '../engine/constants.ts';
import type { StoryLevel } from '../level/types.ts';
import type { StudyAudioRuntime } from '../study/audio.ts';
import type { SurvivalWorld } from '../survival/types.ts';
import { riverSurfaceAt } from '../world-runtime/navigation.ts';
import type { SoundId } from './bank.ts';
import type { FootstepOptions, GameAudio, ListenerSource, LoopHandle, PlayOptions } from './engine.ts';
import { emptyMarks, readMarks, type StoryLike, storyCues } from './story-cues.ts';
import { createSurfaceSampler, fixtureSurface, type SurfaceSampler } from './surface.ts';

export interface SoundscapeMap {
	world: SurvivalWorld;
	level?: StoryLevel;
}

export interface SoundscapeOptions {
	audio: GameAudio;
	/** The map; null or omitted for the graybox fixture (player sounds and the forest bed only). */
	map?: SoundscapeMap | null;
	story?: StoryLike;
	random?: () => number;
	now?: () => number;
}

/** What one frame of the controller tells the sounds. */
export interface FrameSounds {
	readonly position: { readonly x: number; readonly y: number; readonly z: number };
	jumped: boolean;
	landed: boolean;
	landingSpeed: number;
	readonly events: readonly CheckpointEvent[];
}

/** An animal that calls from its home now and then, while the listener is within `range`. */
interface Caller {
	id: SoundId;
	x: number;
	y: number;
	z: number;
	range: number;
	/** Seconds between calls. */
	min: number;
	max: number;
	/** Seconds to the next call. */
	wait: number;
}

/** Calls per species (c-audio.md §3.5); the howler is heard across the map (its spatial max is 250). */
const CALLS: Record<string, { id: SoundId; range: number; min: number; max: number; lift: number }> = {
	bugio: { id: 'howler', range: 250, min: 40, max: 90, lift: 12 },
	muriqui: { id: 'muriqui', range: 60, min: 25, max: 60, lift: 9 },
	tucano: { id: 'toucan', range: 40, min: 20, max: 60, lift: 10 },
	'mico-leao-dourado': { id: 'tamarin', range: 25, min: 15, max: 40, lift: 6 }
};
/** The first call of each animal comes this many seconds after the ambience starts, at most. */
const FIRST_CALL = 12;
/** Landings slower than this fraction of a jump's take-off speed make no thud (stepping off a curb). */
const SOFT_LANDING = 0.25;
const TIMING_SAMPLES = 256;

export class Soundscape {
	readonly audio: GameAudio;
	readonly #map: SoundscapeMap | null;
	readonly #story: StoryLike | undefined;
	readonly #random: () => number;
	readonly #now: () => number;
	readonly #surface: SurfaceSampler;
	readonly #callers: Caller[] = [];
	readonly #marks = emptyMarks();
	readonly #next = emptyMarks();
	readonly #own: PlayOptions = { gain: 1, rate: 1 };
	readonly #at: PlayOptions = { x: 0, y: 0, z: 0, gain: 1, rate: 1 };
	readonly #riverAt = { x: 0, y: 0, z: 0 };
	readonly #step: FootstepOptions = { foot: 'left', intensity: 1 };
	readonly #waterfall: { x: number; y: number; z: number } | null;
	readonly #cutting: { x: number; y: number; z: number } | null;
	readonly #timings = new Float32Array(TIMING_SAMPLES);
	#timingCount = 0;
	#natureReady = false;
	#disposed = false;
	#bed: LoopHandle | null = null;
	#river: LoopHandle | null = null;
	#fall: LoopHandle | null = null;
	#chainsaw: LoopHandle | null = null;
	/** DEV-only Green Hell study sounds (game/src/study/audio.ts); never set in a build. */
	#study: StudyAudioRuntime | null = null;
	#releaseDuck: (() => void) | null = null;
	#combo = 0;
	#lastCollect = Number.NEGATIVE_INFINITY;
	#clock = 0;

	constructor(options: SoundscapeOptions) {
		this.audio = options.audio;
		this.#map = options.map ?? null;
		this.#story = options.story;
		this.#random = options.random ?? Math.random;
		this.#now = options.now ?? (() => performance.now());
		const map = this.#map;
		this.#surface = map ? createSurfaceSampler(map.world, map.level) : fixtureSurface;
		const landmark = (kind: string) => map?.level?.landmarks.find((l) => l.kind === kind);
		const fall = landmark('waterfall');
		const cutting = landmark('cutting');
		this.#waterfall = fall ? { x: fall.x, y: fall.y, z: fall.z } : null;
		this.#cutting = cutting ? { x: cutting.x, y: cutting.y + 1.5, z: cutting.z } : null;
		for (const home of map?.world.animals ?? []) {
			const call = CALLS[home.species];
			if (call)
				this.#callers.push({
					id: call.id,
					x: home.x,
					y: home.y + call.lift,
					z: home.z,
					range: call.range,
					min: call.min,
					max: call.max,
					wait: 0
				});
		}
		if (this.#story) readMarks(this.#story, this.#marks);
	}

	/** Essentials behind the loading screen; never fails the load. */
	preloadEssential(signal?: AbortSignal): Promise<void> {
		return this.audio.preload('essential', signal).catch(() => {});
	}

	/** After the first frame: decodes the nature sounds, then starts the beds and the animals. */
	startNature(signal?: AbortSignal): Promise<void> {
		return this.audio
			.preload('nature', signal)
			.catch(() => {})
			.then(() => {
				if (this.#disposed || signal?.aborted || this.#natureReady) return;
				this.#natureReady = true;
				this.#bed = this.audio.loop('forest-day', { fadeIn: 3 });
				const river = this.#map?.world.river.points[0];
				if (river)
					this.#river = this.audio.loop('river', { x: river.x, y: river.water, z: river.z, fadeIn: 2 });
				if (this.#waterfall) this.#fall = this.audio.loop('waterfall', { ...this.#waterfall, fadeIn: 2 });
				for (const caller of this.#callers) caller.wait = this.#random() * FIRST_CALL;
				// DEV only, behind the study gate (game/src/study/gate.ts): the local Green Hell study sounds
				// (tmp/, git-ignored). A build drops this branch.
				if (import.meta.env.DEV)
					void import('../study/audio.ts').then(({ startStudyAudio }) => {
						if (this.#disposed) return;
						this.#study = startStudyAudio({
							audio: this.audio,
							world: this.#map?.world,
							level: this.#map?.level,
							waterfall: this.#waterfall,
							ownBed: this.#bed,
							ownRiver: this.#river,
							ownFall: this.#fall
						});
					});
				this.syncStory();
			});
	}

	/** One frame: listener, player sounds, river emitter and animal calls. */
	update(
		dt: number,
		listener: ListenerSource,
		frame: FrameSounds,
		foot: 'left' | 'right' | null,
		run: number
	) {
		if (this.#disposed) return;
		const started = this.#now();
		this.#clock += dt;
		const audio = this.audio;
		audio.setListener(listener);
		const p = frame.position;
		if (foot) {
			this.#step.foot = foot;
			this.#step.intensity = 0.85 + 0.45 * run;
			audio.footstep(this.#surface(p.x, p.y, p.z), this.#step);
		}
		if (frame.jumped) this.#play('jump', 1, 1);
		if (frame.landed) {
			const impact = frame.landingSpeed / JUMP_SPEED;
			if (impact >= SOFT_LANDING) {
				const surface = this.#surface(p.x, p.y, p.z);
				if (surface !== 'water') this.#play('land', Math.min(1.3, 0.35 + 0.65 * impact), 1);
				this.#step.foot = 'left';
				this.#step.intensity = Math.min(1.5, surface === 'water' ? 1.4 : impact);
				audio.footstep(surface, this.#step);
			}
		}
		for (let k = 0; k < frame.events.length; k++) {
			const event = frame.events[k];
			if (event.type === 'checkpoint') this.#play('checkpoint', 1, 1);
			else if (
				event.type === 'fell' &&
				this.#map &&
				riverSurfaceAt(this.#map.world, p.x, p.z, this.#map.level?.pool) !== null
			)
				this.#play('splash', 1, 1);
		}
		if (this.#natureReady) {
			const e = listener.matrixWorld.elements;
			this.#ambience(dt, e);
			this.#study?.update(dt, e[12], e[13], e[14]);
		}
		const spent = this.#now() - started;
		this.#timings[this.#timingCount % TIMING_SAMPLES] = spent;
		this.#timingCount++;
	}

	/** Mission sounds and the dialogue duck; call after every story change (cheap when nothing changed). */
	syncStory() {
		const story = this.#story;
		if (this.#disposed) return;
		// Without a story (a map without missions) a cutting keeps its chainsaw.
		const cuttingActive = !!this.#cutting && this.#natureReady && !story?.completed(2);
		if (cuttingActive && !this.#chainsaw?.playing)
			this.#chainsaw = this.audio.loop('chainsaw', { ...this.#cutting, fadeIn: 2 });
		else if (!cuttingActive && this.#chainsaw) {
			this.#chainsaw.stop(2);
			this.#chainsaw = null;
		}
		if (!story) return;
		const next = readMarks(story, this.#next);
		const cues = storyCues(this.#marks, next);
		for (const cue of cues) {
			let rate = cue.rate;
			if (cue.id === 'collect' && cue.rate === 1) {
				// Combo: a semitone up per pick-up within 2 s, up to seven (c-audio.md §3.5).
				this.#combo = this.#clock - this.#lastCollect < 2 ? Math.min(7, this.#combo + 1) : 0;
				this.#lastCollect = this.#clock;
				rate = 2 ** (this.#combo / 12);
			}
			this.#play(cue.id, cue.gain, rate);
		}
		if (next.dialogue !== null && !this.#releaseDuck) this.#releaseDuck = this.audio.duck({ amount: 0.35 });
		else if (next.dialogue === null && this.#releaseDuck) {
			this.#releaseDuck();
			this.#releaseDuck = null;
		}
		Object.assign(this.#marks, next);
	}

	uiTap() {
		this.#play('ui-tap', 1, 1);
	}

	/** Mean, 95th percentile and maximum of the last 256 `update` calls, milliseconds. */
	timing(): { mean: number; p95: number; max: number; samples: number } {
		const n = Math.min(this.#timingCount, TIMING_SAMPLES);
		const sorted = Array.from(this.#timings.subarray(0, n)).sort((a, b) => a - b);
		const sum = sorted.reduce((total, value) => total + value, 0);
		return {
			mean: n ? sum / n : 0,
			p95: n ? sorted[Math.min(n - 1, Math.floor(n * 0.95))] : 0,
			max: n ? sorted[n - 1] : 0,
			samples: n
		};
	}

	/** Stops everything and closes the audio context. */
	dispose(): Promise<void> {
		if (this.#disposed) return this.audio.dispose();
		this.#disposed = true;
		this.#releaseDuck?.();
		this.#releaseDuck = null;
		this.#study?.dispose();
		this.#study = null;
		for (const loop of [this.#bed, this.#river, this.#fall, this.#chainsaw]) loop?.stop(0.1);
		this.#bed = this.#river = this.#fall = this.#chainsaw = null;
		return this.audio.dispose();
	}

	#play(id: SoundId, gain: number, rate: number) {
		const options = this.#own;
		options.gain = gain;
		options.rate = rate;
		this.audio.play(id, options);
	}

	#ambience(dt: number, e: ArrayLike<number>) {
		const lx = e[12];
		const lz = e[14];
		const map = this.#map;
		if (this.#river && map && nearestRiverPoint(map.world.river.points, lx, lz, this.#riverAt))
			// The river emitter sits on the centre-line point nearest the listener.
			this.#river.setPosition(this.#riverAt.x, this.#riverAt.y, this.#riverAt.z);
		for (let k = 0; k < this.#callers.length; k++) {
			const caller = this.#callers[k];
			caller.wait -= dt;
			if (caller.wait > 0) continue;
			caller.wait = caller.min + this.#random() * (caller.max - caller.min);
			const dx = caller.x - lx;
			const dz = caller.z - lz;
			if (dx * dx + dz * dz > caller.range * caller.range) continue;
			const at = this.#at;
			// A few units around the home, so a call does not always come from the same branch.
			at.x = caller.x + (this.#random() * 2 - 1) * 3;
			at.y = caller.y;
			at.z = caller.z + (this.#random() * 2 - 1) * 3;
			at.gain = 1;
			at.rate = 1;
			this.audio.play(caller.id, at);
		}
	}
}

/**
 * The point of the river centre-line nearest (x, z), written to `out` (y is the
 * water surface there). False when the river has fewer than two points.
 */
export function nearestRiverPoint(
	points: readonly { readonly x: number; readonly z: number; readonly water: number }[],
	x: number,
	z: number,
	out: { x: number; y: number; z: number }
): boolean {
	let best = Number.POSITIVE_INFINITY;
	for (let k = 1; k < points.length; k++) {
		const a = points[k - 1];
		const b = points[k];
		const dx = b.x - a.x;
		const dz = b.z - a.z;
		const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz || 1)));
		const px = a.x + t * dx;
		const pz = a.z + t * dz;
		const d = (x - px) * (x - px) + (z - pz) * (z - pz);
		if (d < best) {
			best = d;
			out.x = px;
			out.y = a.water + (b.water - a.water) * t;
			out.z = pz;
		}
	}
	return best < Number.POSITIVE_INFINITY;
}
