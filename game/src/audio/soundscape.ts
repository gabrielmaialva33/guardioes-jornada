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
 * - Zones (zone-sounds.ts): a park zone's map names its `zone`, which adds its
 *   beds (the Vale's far waterfall, the Copa's canopy birds, the Praia's surf,
 *   the Manguezal's water and clicks) and drops the forest bed or the river
 *   where they do not belong.
 * - Zone changes (`setMap`): the same engine, voice cap and buses; the old
 *   zone's loops fade out (about 1 s, at once with reduced motion) while they
 *   keep their place in the world, and the new zone's fade in. A load started
 *   for an older map is dropped when it lands (a generation count).
 *
 * The listener and the player arrive in park (world) coordinates and are moved
 * into the map's local frame by its origin (ZoneBuild.offsetX/offsetZ); the
 * maps, their emitters and the engine's listener are all zone-local.
 *
 * `update` runs once per frame and allocates nothing on frames without a
 * sound event; it times itself (performance.now) for the debug overlay.
 */

import type { CheckpointEvent } from '../engine/checkpoints.ts';
import { JUMP_SPEED } from '../engine/constants.ts';
import type { StoryLevel } from '../level/types.ts';
import type { ZoneId } from '../level/zones/spec.ts';
import type { ZoneLevel } from '../level/zones/zone.ts';
import type { StudyAudioRuntime } from '../study/audio.ts';
import type { SurvivalWorld } from '../survival/types.ts';
import { riverSurfaceAt } from '../world-runtime/navigation.ts';
import type { SoundId } from './bank.ts';
import type { FootstepOptions, GameAudio, ListenerSource, LoopHandle, PlayOptions } from './engine.ts';
import { emptyMarks, readMarks, type StoryLike, storyCues } from './story-cues.ts';
import { createSurfaceSampler, fixtureSurface, type SurfaceSampler } from './surface.ts';
import { DEFAULT_SOUNDS, groundAt, nearestPoint, type ZoneSounds, zoneSounds } from './zone-sounds.ts';

/** The Reserva's map, or a park zone's (its world and level in the zone's local frame, like the listener). */
export type SoundscapeMap =
	| { world: SurvivalWorld; level?: StoryLevel; zone?: undefined }
	| { world: SurvivalWorld; level?: ZoneLevel; zone: ZoneId };

/** World position of a map's local origin (a zone's north-west corner); the Reserva alone is at 0, 0. */
export interface MapOrigin {
	x: number;
	z: number;
}

export interface SoundscapeOptions {
	audio: GameAudio;
	/** The map; null or omitted for the graybox fixture (player sounds and the forest bed only). */
	map?: SoundscapeMap | null;
	origin?: MapOrigin;
	story?: StoryLike;
	random?: () => number;
	now?: () => number;
	/** Whether zone changes cut instead of crossfading (default: the prefers-reduced-motion query). */
	reducedMotion?: () => boolean;
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

/** A loop this soundscape owns and where it plays (zone-local), so a zone change can keep it in place while it fades. */
interface Owned {
	loop: LoopHandle;
	x: number;
	y: number;
	z: number;
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
/** Seconds the old zone's loops fade out and the new zone's fade in. */
const CROSSFADE = 1;

const prefersReducedMotion = () =>
	globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

export class Soundscape {
	readonly audio: GameAudio;
	readonly #story: StoryLike | undefined;
	readonly #random: () => number;
	readonly #now: () => number;
	readonly #reducedMotion: () => boolean;
	#map: SoundscapeMap | null = null;
	#surface: SurfaceSampler = fixtureSurface;
	#plan: ZoneSounds = DEFAULT_SOUNDS;
	#waterfall: { x: number; y: number; z: number } | null = null;
	#cutting: { x: number; y: number; z: number } | null = null;
	readonly #callers: Caller[] = [];
	readonly #origin: MapOrigin = { x: 0, z: 0 };
	/** The listener's world matrix moved into the map's frame (rewritten every frame). */
	readonly #local = new Float64Array(16);
	readonly #listener: ListenerSource = { matrixWorld: { elements: this.#local } };
	/** Bumped by every `setMap`: a nature load that lands for an older generation is dropped. */
	#generation = 0;
	#natureWanted = false;
	#natureSignal: AbortSignal | undefined;
	readonly #marks = emptyMarks();
	readonly #next = emptyMarks();
	readonly #own: PlayOptions = { gain: 1, rate: 1 };
	readonly #at: PlayOptions = { x: 0, y: 0, z: 0, gain: 1, rate: 1 };
	readonly #riverAt = { x: 0, y: 0, z: 0 };
	readonly #followAt = { x: 0, y: 0, z: 0 };
	/** Every loop of the current map: what a zone change fades out and dispose stops. */
	readonly #owned: Owned[] = [];
	readonly #followers: { owned: Owned; points: Float32Array }[] = [];
	readonly #step: FootstepOptions = { foot: 'left', intensity: 1 };
	readonly #timings = new Float32Array(TIMING_SAMPLES);
	#timingCount = 0;
	#natureReady = false;
	#disposed = false;
	#bed: LoopHandle | null = null;
	#river: Owned | null = null;
	#fall: LoopHandle | null = null;
	#chainsaw: Owned | null = null;
	#canopy: LoopHandle | null = null;
	#canopyGain = 0;
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
		this.#reducedMotion = options.reducedMotion ?? prefersReducedMotion;
		this.#origin.x = options.origin?.x ?? 0;
		this.#origin.z = options.origin?.z ?? 0;
		this.#configure(options.map ?? null);
		if (this.#story) readMarks(this.#story, this.#marks);
	}

	/**
	 * Moves the sounds to another map (a zone change): the old map's loops fade
	 * out where they were, the new map's start once the nature sounds are
	 * decoded (at once when they already are). Mission marks and the dialogue
	 * duck carry over. Safe while a load is running and before `startNature`.
	 */
	setMap(map: SoundscapeMap | null, origin?: MapOrigin) {
		if (this.#disposed) return;
		this.#generation++;
		const x = origin?.x ?? 0;
		const z = origin?.z ?? 0;
		// The old emitters stay where they were in the world while they fade: move them into the new frame.
		const dx = this.#origin.x - x;
		const dz = this.#origin.z - z;
		const fade = this.#reducedMotion() ? 0 : CROSSFADE;
		this.#study?.dispose();
		this.#study = null;
		for (const owned of this.#owned) {
			owned.loop.setPosition(owned.x + dx, owned.y, owned.z + dz);
			owned.loop.stop(fade);
		}
		this.#owned.length = 0;
		this.#followers.length = 0;
		this.#bed = this.#river = this.#fall = this.#chainsaw = this.#canopy = null;
		this.#origin.x = x;
		this.#origin.z = z;
		this.#configure(map);
		this.#natureReady = false;
		if (this.#natureWanted) void this.#loadNature(fade);
	}

	#configure(map: SoundscapeMap | null) {
		this.#map = map;
		this.#surface = map ? createSurfaceSampler(map.world, map.level) : fixtureSurface;
		this.#plan = map?.zone ? zoneSounds(map.zone, map.world, map.level) : DEFAULT_SOUNDS;
		const landmarks: readonly { kind: string; x: number; y: number; z: number }[] =
			map?.level?.landmarks ?? [];
		const landmark = (kind: string) => landmarks.find((l) => l.kind === kind);
		const fall = landmark('waterfall');
		const cutting = landmark('cutting');
		this.#waterfall = fall ? { x: fall.x, y: fall.y, z: fall.z } : null;
		this.#cutting = cutting ? { x: cutting.x, y: cutting.y + 1.5, z: cutting.z } : null;
		this.#callers.length = 0;
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
	}

	/** Essentials behind the loading screen; never fails the load. */
	preloadEssential(signal?: AbortSignal): Promise<void> {
		return this.audio.preload('essential', signal).catch(() => {});
	}

	/** After the first frame: decodes the nature sounds, then starts the beds and the animals. */
	startNature(signal?: AbortSignal): Promise<void> {
		this.#natureWanted = true;
		this.#natureSignal = signal;
		return this.#loadNature(null);
	}

	/** Decodes the nature sounds, then starts the current map's ambience; `fade` null keeps the first start's fades. */
	#loadNature(fade: number | null): Promise<void> {
		const generation = this.#generation;
		const signal = this.#natureSignal;
		return this.audio
			.preload('nature', signal)
			.catch(() => {})
			.then(() => {
				if (this.#disposed || signal?.aborted || this.#natureReady || generation !== this.#generation) return;
				this.#natureReady = true;
				this.#startAmbience(fade, generation);
			});
	}

	#startAmbience(fade: number | null, generation: number) {
		const plan = this.#plan;
		const bedFade = fade ?? 3;
		const emitterFade = fade ?? 2;
		if (plan.forest > 0)
			this.#bed = this.#hold(this.audio.loop('forest-day', { gain: plan.forest, fadeIn: bedFade }));
		const river = plan.river ? this.#map?.world.river.points[0] : undefined;
		if (river) this.#river = this.#place('river', river.x, river.water, river.z, emitterFade);
		const fall = this.#waterfall;
		if (fall) this.#fall = this.#place('waterfall', fall.x, fall.y, fall.z, emitterFade)?.loop ?? null;
		for (const id of plan.beds) this.#hold(this.audio.loop(id, { fadeIn: bedFade }));
		for (const at of plan.fixed) this.#place(at.id, at.x, at.y, at.z, emitterFade);
		for (const { id, points } of plan.follow) {
			const owned = this.#place(id, points[0], points[1], points[2], emitterFade);
			if (owned) this.#followers.push({ owned, points });
		}
		if (plan.canopy) {
			this.#canopyGain = plan.canopy.low;
			this.#canopy = this.#hold(this.audio.loop(plan.canopy.id, { gain: this.#canopyGain, fadeIn: bedFade }));
		}
		for (const caller of this.#callers) caller.wait = this.#random() * FIRST_CALL;
		// DEV only, behind the study gate (game/src/study/gate.ts): the local Green Hell study sounds
		// (tmp/, git-ignored). A build drops this branch.
		if (import.meta.env.DEV)
			void import('../study/audio.ts').then(({ startStudyAudio }) => {
				if (this.#disposed || generation !== this.#generation) return;
				this.#study = startStudyAudio({
					audio: this.audio,
					world: this.#map?.world,
					level: this.#map && !this.#map.zone ? this.#map.level : undefined,
					waterfall: this.#waterfall,
					ownBed: this.#bed,
					ownRiver: this.#river?.loop ?? null,
					ownFall: this.#fall
				});
			});
		this.syncStory();
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
		const local = this.#toLocal(listener);
		audio.setListener(local);
		const p = frame.position;
		const px = p.x - this.#origin.x;
		const pz = p.z - this.#origin.z;
		if (foot) {
			this.#step.foot = foot;
			this.#step.intensity = 0.85 + 0.45 * run;
			audio.footstep(this.#surface(px, p.y, pz), this.#step);
		}
		if (frame.jumped) this.#play('jump', 1, 1);
		if (frame.landed) {
			const impact = frame.landingSpeed / JUMP_SPEED;
			if (impact >= SOFT_LANDING) {
				const surface = this.#surface(px, p.y, pz);
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
				riverSurfaceAt(this.#map.world, px, pz, this.#map.level?.pool) !== null
			)
				this.#play('splash', 1, 1);
		}
		if (this.#natureReady) {
			const e = local.matrixWorld.elements;
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
		const cutting = this.#cutting;
		if (cutting && cuttingActive && !this.#chainsaw?.loop.playing) {
			if (this.#chainsaw) this.#disown(this.#chainsaw);
			this.#chainsaw = this.#place('chainsaw', cutting.x, cutting.y, cutting.z, 2);
		} else if (!cuttingActive && this.#chainsaw) {
			this.#chainsaw.loop.stop(2);
			this.#disown(this.#chainsaw);
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
		for (const { loop } of this.#owned) loop.stop(0.1);
		this.#bed = this.#river = this.#fall = this.#chainsaw = this.#canopy = null;
		this.#owned.length = 0;
		this.#followers.length = 0;
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
			move(this.#river, this.#riverAt);
		for (let k = 0; k < this.#followers.length; k++) {
			const follower = this.#followers[k];
			if (nearestPoint(follower.points, lx, lz, this.#followAt)) move(follower.owned, this.#followAt);
		}
		const canopy = this.#plan.canopy;
		if (this.#canopy && canopy && map) {
			const height = e[13] - groundAt(map.world, lx, lz);
			const up = Math.max(0, Math.min(1, (height - canopy.above) / canopy.rise));
			const gain = canopy.low + (1 - canopy.low) * up;
			// Only real changes reach the audio graph (a ramp per frame would pile up automation events).
			if (Math.abs(gain - this.#canopyGain) > 0.02) {
				this.#canopyGain = gain;
				this.#canopy.setGain(gain, 0.5);
			}
		}
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

	/** The listener's matrix with its translation moved into the map's frame (no allocation). */
	#toLocal(listener: ListenerSource): ListenerSource {
		const e = listener.matrixWorld.elements;
		const local = this.#local;
		for (let k = 0; k < 16; k++) local[k] = e[k];
		local[12] -= this.#origin.x;
		local[14] -= this.#origin.z;
		return this.#listener;
	}

	#hold(loop: LoopHandle | null): LoopHandle | null {
		if (loop) this.#owned.push({ loop, x: 0, y: 0, z: 0 });
		return loop;
	}

	#place(id: SoundId, x: number, y: number, z: number, fadeIn: number): Owned | null {
		const loop = this.audio.loop(id, { x, y, z, fadeIn });
		if (!loop) return null;
		const owned = { loop, x, y, z };
		this.#owned.push(owned);
		return owned;
	}

	#disown(owned: Owned) {
		const at = this.#owned.indexOf(owned);
		if (at >= 0) this.#owned.splice(at, 1);
	}
}

/** Moves an owned emitter, remembering where it is. */
function move(owned: Owned, to: { x: number; y: number; z: number }) {
	owned.x = to.x;
	owned.y = to.y;
	owned.z = to.z;
	owned.loop.setPosition(to.x, to.y, to.z);
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
