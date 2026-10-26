import { describe, expect, it, vi } from 'vitest';
import { SOUND_IDS, SOUNDS, type SoundBank, type SoundDef, type SoundId } from './bank.ts';
import { createGameAudio, type GameAudioOptions } from './engine.ts';
import {
	FakeAudioContext,
	type FakeGain,
	FakePage,
	type FakePanner,
	type FakeSource
} from './fake-audio.test-helper.ts';
import { SYNTH_RATE, SYNTH_VARIANTS } from './synth.ts';

function setup(options: Partial<GameAudioOptions> = {}) {
	const context = new FakeAudioContext();
	const page = new FakePage();
	const win = new FakePage();
	const audio = createGameAudio({
		createContext: () => context as unknown as AudioContext,
		page,
		window: win,
		canPlayType: () => '',
		fetch: () => Promise.reject(new Error('offline')),
		...options
	});
	return { audio, context, page, win };
}

async function unlocked(options: Partial<GameAudioOptions> = {}) {
	const env = setup(options);
	await env.audio.unlock();
	return env;
}

/** The voice gain a source feeds, and what that gain feeds. */
const gainOf = (source: FakeSource) => [...source.outputs][0] as FakeGain;
const lastSource = (context: FakeAudioContext) => context.sources[context.sources.length - 1];
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('lifecycle', () => {
	it('starts locked, drops one-shots until unlocked, then plays', async () => {
		const { audio, context } = setup();
		expect(audio.state).toBe('locked');
		expect(audio.play('jump')).toBeNull();
		expect(context.sources).toHaveLength(0);
		expect(await audio.unlock()).toBe(true);
		expect(audio.state).toBe('running');
		// The silent sample iOS needs, started inside the gesture.
		expect(context.sources[0].startedAt).toBe(0);
		expect(context.sources[0].buffer?.length).toBe(1);
		expect(audio.play('jump')?.playing).toBe(true);
	});

	it('unlocks on the first gesture, and again after an interruption', async () => {
		const { audio, context, page } = setup();
		page.fire('pointerdown');
		await flush();
		expect(audio.state).toBe('running');
		context.state = 'interrupted';
		page.fire('touchend');
		await flush();
		expect(context.state).toBe('running');
		// A gesture while running does nothing.
		const resumes = context.calls.filter((c) => c === 'resume').length;
		page.fire('keydown');
		await flush();
		expect(context.calls.filter((c) => c === 'resume')).toHaveLength(resumes);
	});

	it('drops one-shots while an unlocked context is not running, so a resume plays no backlog', async () => {
		const { audio, context } = await unlocked();
		context.state = 'interrupted';
		expect(audio.play('collect')).toBeNull();
		expect(audio.footstep('grass')).toBeNull();
		// Loops may still start; they are heard once the context runs again.
		expect(audio.loop('forest-day')).not.toBeNull();
		context.state = 'running';
		expect(audio.play('collect')).not.toBeNull();
	});

	it('suspends when hidden or on pagehide and resumes on return', async () => {
		const { audio, context, page, win } = await unlocked();
		page.hidden = true;
		page.fire('visibilitychange');
		await flush();
		expect(context.state).toBe('suspended');
		expect(audio.state).toBe('suspended');
		expect(audio.play('collect')).toBeNull();
		page.hidden = false;
		page.fire('visibilitychange');
		await flush();
		expect(context.state).toBe('running');
		win.fire('pagehide');
		await flush();
		expect(context.state).toBe('suspended');
		win.fire('pageshow');
		await flush();
		expect(context.state).toBe('running');
		expect(audio.play('collect')).not.toBeNull();
	});

	it('does not resume a never-unlocked context when the page comes back', async () => {
		const { context, page } = setup();
		page.hidden = true;
		page.fire('visibilitychange');
		page.hidden = false;
		page.fire('visibilitychange');
		await flush();
		expect(context.calls).not.toContain('resume');
	});

	it('works as a silent no-op without WebAudio', async () => {
		const audio = createGameAudio({ createContext: () => null, page: null, window: null });
		expect(audio.state).toBe('unavailable');
		expect(await audio.unlock()).toBe(false);
		expect(audio.play('jump')).toBeNull();
		expect(audio.loop('forest-day')).toBeNull();
		expect(audio.footstep('grass')).toBeNull();
		audio.setListener({ matrixWorld: { elements: new Float32Array(16) } });
		audio.duck()();
		await audio.preload('nature');
		await audio.dispose();
	});

	it('dispose stops every voice, leaves nothing scheduled and removes every listener', async () => {
		vi.useFakeTimers();
		try {
			const { audio, context, page, win } = await unlocked();
			audio.loop('forest-day');
			audio.loop('river', { x: 3, y: 0, z: 2 });
			for (let k = 0; k < 6; k++) audio.play('step-grass');
			const release = audio.duck();
			expect(page.listeners).toBeGreaterThan(0);
			await audio.dispose();
			expect(context.live()).toEqual([]);
			expect(context.sources.every((s) => s.onended === null)).toBe(true);
			expect(context.nodes.every((n) => n.disconnected || n.outputs.size === 0)).toBe(true);
			expect(context.calls).toContain('close');
			expect(audio.state).toBe('closed');
			expect(audio.voices).toBe(0);
			expect(page.listeners).toBe(0);
			expect(win.listeners).toBe(0);
			expect(vi.getTimerCount()).toBe(0);
			// Everything after dispose is inert.
			release();
			expect(audio.play('jump')).toBeNull();
			expect(audio.loop('forest-day')).toBeNull();
			expect(await audio.unlock()).toBe(false);
			await audio.dispose();
			expect(context.calls.filter((c) => c === 'close')).toHaveLength(1);
		} finally {
			vi.useRealTimers();
		}
	});
});

describe('voices', () => {
	it('never exceeds 16 voices, stealing the oldest of the lowest priority', async () => {
		const { audio, context } = await unlocked();
		const bed = audio.loop('forest-day');
		for (let k = 0; k < 40; k++) {
			context.currentTime = k * 0.01;
			audio.play('step-soil');
			expect(audio.voices).toBeLessThanOrEqual(16);
		}
		expect(audio.voices).toBe(16);
		// The bed (priority 9) survived 39 lower-priority steals.
		expect(bed?.playing).toBe(true);
		const stolen = context.sources.filter((s) => s.stoppedAt !== null);
		expect(stolen.length).toBeGreaterThan(0);
		// Stolen voices fade over ~20 ms instead of cutting.
		const fade = gainOf(stolen[0]).gain.events.find((e) => e.type === 'linear');
		expect(fade?.value).toBe(0);
	});

	it('drops a new sound when every voice outranks it', async () => {
		const { audio } = await unlocked({ maxVoices: 2 });
		expect(audio.play('checkpoint')).not.toBeNull();
		expect(audio.play('checkpoint')).not.toBeNull();
		expect(audio.play('step-rock')).toBeNull();
		expect(audio.voices).toBe(2);
		// Equal priority steals the oldest.
		expect(audio.play('checkpoint')).not.toBeNull();
		expect(audio.voices).toBe(2);
	});

	it('takes fading voices first', async () => {
		const { audio } = await unlocked({ maxVoices: 2 });
		const first = audio.play('checkpoint');
		audio.play('checkpoint');
		first?.stop(0.5);
		expect(first?.playing).toBe(false);
		// A step (priority 2) may take the voice that is already fading.
		expect(audio.play('step-rock')).not.toBeNull();
		expect(audio.voices).toBe(2);
	});

	it('frees the voice and its nodes when a source ends', async () => {
		const { audio, context } = await unlocked();
		const voice = audio.play('collect');
		const source = lastSource(context);
		expect(audio.voices).toBe(1);
		source.end();
		expect(audio.voices).toBe(0);
		expect(voice?.playing).toBe(false);
		expect(source.disconnected).toBe(true);
		expect(gainOf(source)).toBeUndefined();
	});
});

describe('one-shots', () => {
	it('keeps pitch and gain jitter inside the bank ranges', async () => {
		for (const extreme of [0, 0.999999]) {
			const { audio, context } = await unlocked({ random: () => extreme });
			audio.play('step-grass');
			const source = lastSource(context);
			const gain = gainOf(source).gain.value;
			const def = SOUNDS['step-grass'];
			const semitones = Math.log2(source.playbackRate.value) * 12;
			const decibels = 20 * Math.log10(gain / def.gain);
			expect(Math.abs(semitones)).toBeLessThanOrEqual(def.pitchJitter + 1e-6);
			expect(Math.abs(decibels)).toBeLessThanOrEqual(def.gainJitter + 1e-6);
			expect(Math.abs(semitones)).toBeGreaterThan(def.pitchJitter * 0.99);
		}
		const { audio, context } = await unlocked();
		for (let k = 0; k < 200; k++) {
			audio.play('jump')?.stop(0);
			const rate = lastSource(context).playbackRate.value;
			expect(rate).toBeGreaterThanOrEqual(2 ** (-SOUNDS.jump.pitchJitter / 12) - 1e-9);
			expect(rate).toBeLessThanOrEqual(2 ** (SOUNDS.jump.pitchJitter / 12) + 1e-9);
		}
	});

	it('plays the placeholder: a mono buffer at the synth rate, cached per id', async () => {
		const { audio, context } = await unlocked();
		audio.play('collect');
		audio.play('collect');
		const [a, b] = context.sources.slice(-2);
		expect(a.buffer).toBe(b.buffer);
		expect(a.buffer?.numberOfChannels).toBe(1);
		expect(a.buffer?.sampleRate).toBe(SYNTH_RATE);
		expect(a.loop).toBe(false);
	});

	it('places spatial sounds with an equal-power, inverse-distance panner and culls far ones', async () => {
		const { audio, context } = await unlocked();
		audio.setListener({ matrixWorld: { elements: translation(10, 2, -4) } });
		expect(audio.play('splash', { x: 12, y: 0, z: -4 })).not.toBeNull();
		const panner = [...gainOf(lastSource(context)).outputs][0] as FakePanner;
		expect(panner.kind).toBe('panner');
		expect(panner.panningModel).toBe('equalpower');
		expect(panner.distanceModel).toBe('inverse');
		expect(panner.refDistance).toBe(SOUNDS.splash.spatial.ref);
		expect([panner.positionX.value, panner.positionY.value, panner.positionZ.value]).toEqual([12, 0, -4]);
		// 50 u away is past the splash's 40 u: no voice spent.
		expect(audio.play('splash', { x: 60, y: 2, z: -4 })).toBeNull();
		// Without a position the same sound is non-spatial.
		audio.play('splash');
		expect([...gainOf(lastSource(context)).outputs][0].kind).toBe('gain');
		expect(context.nodes.some((n) => n.kind === 'panner' && (n as FakePanner).panningModel === 'HRTF')).toBe(
			false
		);
	});

	it('moves the listener from the camera matrix', async () => {
		const { audio, context } = await unlocked();
		const nodes = context.nodes.length;
		// A camera at (1, 2, 3) turned to look down +x: forward = −z column = (1, 0, 0).
		const m = new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, -1, 0, 0, 0, 1, 2, 3, 1]);
		audio.setListener({ matrixWorld: { elements: m } });
		const l = context.listener;
		expect([l.positionX.value, l.positionY.value, l.positionZ.value]).toEqual([1, 2, 3]);
		expect([l.forwardX.value, l.forwardY.value, l.forwardZ.value]).toEqual([1, -0, -0]);
		expect([l.upX.value, l.upY.value, l.upZ.value]).toEqual([0, 1, 0]);
		expect(context.nodes.length).toBe(nodes);
	});
});

describe('footsteps', () => {
	it('plays the surface sound, a hair lower for the right foot', async () => {
		const { audio, context } = await unlocked({ random: () => 0.5 });
		for (const [surface, id] of [
			['soil', 'step-soil'],
			['water', 'step-water']
		] as const) {
			context.currentTime += 1;
			expect(audio.footstep(surface, { foot: 'left' })?.id).toBe(id);
		}
		context.currentTime += 1;
		audio.footstep('rock', { foot: 'right' });
		expect(lastSource(context).playbackRate.value).toBeCloseTo(0.97, 6);
	});

	it('merges two contacts closer than 70 ms, but not positioned (animal) steps', async () => {
		const { audio, context } = await unlocked();
		context.currentTime = 1;
		expect(audio.footstep('grass')).not.toBeNull();
		context.currentTime = 1.03;
		expect(audio.footstep('grass')).toBeNull();
		expect(audio.footstep('grass', { x: 1, y: 0, z: 1 })).not.toBeNull();
		context.currentTime = 1.2;
		expect(audio.footstep('grass')).not.toBeNull();
	});

	it('runs louder than it walks', async () => {
		const { audio, context } = await unlocked({ random: () => 0.5 });
		audio.footstep('leaves', { intensity: 0.5 });
		const soft = gainOf(lastSource(context)).gain.value;
		context.currentTime = 1;
		audio.footstep('leaves', { intensity: 1.3 });
		expect(gainOf(lastSource(context)).gain.value).toBeGreaterThan(soft);
	});
});

describe('loops', () => {
	it('loops gaplessly with a fade-in, and fades out on stop', async () => {
		const { audio, context } = setup();
		// Loops may start before the unlock: they are heard once the context runs.
		const bed = audio.loop('forest-day', { fadeIn: 2 });
		const source = lastSource(context);
		expect(source.loop).toBe(true);
		const events = gainOf(source).gain.events;
		expect(events[0]).toMatchObject({ type: 'set', value: 0 });
		expect(events[1]).toMatchObject({ type: 'linear', value: SOUNDS['forest-day'].gain, time: 2 });
		context.currentTime = 5;
		bed?.stop(1.5);
		expect(bed?.playing).toBe(false);
		expect(gainOf(source).gain.events.at(-1)).toMatchObject({ type: 'linear', value: 0, time: 6.5 });
		expect(source.stoppedAt).toBeGreaterThan(6.5);
	});

	it('uses the recorded loop points of a decoded file', async () => {
		const bank = withFiles('river', [{ webm: 'river.webm' }], { loop: { start: 0.02, end: 5.98 } });
		const { audio, context } = await unlocked({
			bank,
			canPlayType: () => 'probably',
			fetch: okFetch()
		});
		await audio.preload('nature');
		audio.loop('river', { x: 0, y: 0, z: 5 });
		const source = lastSource(context);
		expect(source.buffer?.sampleRate).toBe(context.sampleRate);
		expect([source.loopStart, source.loopEnd]).toEqual([0.02, 5.98]);
	});

	it('moves and re-levels a positioned loop', async () => {
		const { audio, context } = await unlocked();
		const river = audio.loop('river', { x: 0, y: 0, z: 0 });
		const panner = [...gainOf(lastSource(context)).outputs][0] as FakePanner;
		river?.setPosition(4, 1, -2);
		expect([panner.positionX.value, panner.positionY.value, panner.positionZ.value]).toEqual([4, 1, -2]);
		river?.setGain(0.5, 0.2);
		expect(gainOf(lastSource(context)).gain.value).toBeCloseTo(SOUNDS.river.gain * 0.5, 6);
	});
});

describe('buses', () => {
	it('applies volume² and mute per bus and reports every change', async () => {
		const changes: unknown[] = [];
		const { audio, context } = await unlocked({
			settings: { volume: { music: 0.5, sfx: 7 }, muted: { ui: true } },
			onSettingsChange: (s) => changes.push(s)
		});
		expect(audio.settings().volume.music).toBe(0.5);
		expect(audio.settings().volume.sfx).toBe(1);
		expect(audio.settings().muted.ui).toBe(true);
		audio.play('collect');
		const sfxDuck = [...gainOf(lastSource(context)).outputs][0] as FakeGain;
		const sfxVolume = [...sfxDuck.outputs][0] as FakeGain;
		expect(sfxVolume.gain.value).toBe(1);
		audio.setBusVolume('sfx', 0.5);
		expect(sfxVolume.gain.value).toBeCloseTo(0.25, 9);
		audio.mute(true, 'sfx');
		expect(sfxVolume.gain.value).toBe(0);
		audio.mute(false, 'sfx');
		expect(sfxVolume.gain.value).toBeCloseTo(0.25, 9);
		expect(changes).toHaveLength(3);
		// Mutating the returned copy changes nothing.
		audio.settings().volume.sfx = 0;
		expect(audio.settings().volume.sfx).toBe(0.5);
	});

	it('ducks music and ambience to the deepest active duck and restores them', async () => {
		const { audio, context } = await unlocked();
		audio.loop('forest-day');
		const ambienceDuck = [...gainOf(lastSource(context)).outputs][0] as FakeGain;
		audio.play('ui-tap');
		const uiDuck = [...gainOf(lastSource(context)).outputs][0] as FakeGain;
		const radio = audio.duck({ amount: 0.5 });
		expect(ambienceDuck.gain.value).toBe(0.5);
		const dialogue = audio.duck({ amount: 0.2 });
		expect(ambienceDuck.gain.value).toBe(0.2);
		expect(uiDuck.gain.value).toBe(1);
		dialogue();
		expect(ambienceDuck.gain.value).toBe(0.5);
		radio();
		radio();
		expect(ambienceDuck.gain.value).toBe(1);
	});

	it('routes animals through the ambience bus, so its volume and ducks reach them', async () => {
		const { audio, context } = await unlocked({ settings: { volume: { ambience: 0.5 } } });
		audio.play('toucan', { x: 0, y: 0, z: 2 });
		const panner = [...gainOf(lastSource(context)).outputs][0] as FakePanner;
		const animalsDuck = [...panner.outputs][0] as FakeGain;
		const animalsVolume = [...animalsDuck.outputs][0] as FakeGain;
		const ambienceDuck = [...animalsVolume.outputs][0] as FakeGain;
		const ambienceVolume = [...ambienceDuck.outputs][0] as FakeGain;
		expect(animalsVolume.gain.value).toBe(1);
		expect(ambienceVolume.gain.value).toBeCloseTo(0.25, 9);
		const release = audio.duck({ amount: 0.4 });
		expect(ambienceDuck.gain.value).toBe(0.4);
		release();
		audio.mute(true, 'animals');
		expect(animalsVolume.gain.value).toBe(0);
	});
});

describe('loading', () => {
	it('fetches the first playable codec, falls back on a decode failure, and keeps the placeholder on total failure', async () => {
		const requested: string[] = [];
		const bank = withFiles('collect', [{ webm: 'plim.webm', m4a: 'plim.m4a' }]);
		const errors: SoundId[] = [];
		const { audio, context } = await unlocked({
			bank,
			canPlayType: (type) => (type.includes('webm') ? 'maybe' : type.includes('mp4') ? 'probably' : ''),
			fetch: okFetch(requested),
			onLoadError: (id) => errors.push(id)
		});
		// 'probably' (AAC) before 'maybe' (WebM).
		context.decodeFails = (bytes) => new TextDecoder().decode(bytes) === 'plim.m4a';
		await audio.preload('essential');
		expect(requested).toEqual(['plim.m4a', 'plim.webm']);
		expect(errors).toEqual([]);
		audio.play('collect');
		expect(lastSource(context).buffer?.sampleRate).toBe(context.sampleRate);

		const none = await unlocked({
			bank,
			canPlayType: () => 'maybe',
			fetch: okFetch(),
			onLoadError: (id) => errors.push(id)
		});
		none.context.decodeFails = () => true;
		await none.audio.preload('essential');
		expect(errors).toEqual(['collect']);
		none.audio.play('collect');
		expect(lastSource(none.context).buffer?.sampleRate).toBe(SYNTH_RATE);
	});

	it('fetches only the codec the offline pack holds while it decodes', async () => {
		for (const [answers, codec] of [
			[{ webm: 'probably', mp4: 'probably' }, 'webm'],
			[{ webm: '', mp4: 'maybe' }, 'm4a']
		] as const) {
			const requested: string[] = [];
			const { audio } = await unlocked({
				canPlayType: (type) => (type.includes('webm') ? answers.webm : answers.mp4),
				fetch: okFetch(requested)
			});
			await audio.preload('essential');
			await audio.preload('nature');
			expect(requested.length).toBe(SOUND_IDS.reduce((sum, id) => sum + SOUNDS[id].files.length, 0));
			expect(requested.every((url) => url.endsWith(`.${codec}`))).toBe(true);
		}
	});

	it('stops loading when its signal or the engine aborts, and can load again later', async () => {
		const bank = withFiles('collect', [{ webm: 'a.webm' }, { webm: 'b.webm' }]);
		const requested: string[] = [];
		const { audio, context } = await unlocked({
			bank,
			canPlayType: () => 'probably',
			fetch: okFetch(requested)
		});
		const controller = new AbortController();
		const job = audio.preload('essential', controller.signal);
		controller.abort();
		await job;
		expect(context.decoded).toBe(0);
		await audio.preload('essential');
		expect(context.decoded).toBe(2);
		expect(requested).toEqual(['a.webm', 'a.webm', 'b.webm']);
	});

	it('renders the placeholders of a category on preload', async () => {
		const { audio, context } = await unlocked();
		const before = context.buffers.length;
		await audio.preload('essential');
		const essential = SOUND_IDS.filter((id) => SOUNDS[id].category === 'essential');
		const variants = essential.reduce((sum, id) => sum + SYNTH_VARIANTS[id], 0);
		expect(context.buffers.length - before).toBe(variants);
		expect(audio.footstep('grass')).not.toBeNull();
		expect(context.buffers.length - before).toBe(variants);
	});

	it('plays the real bank’s files once decoded, and placeholders where a file fails', async () => {
		const requested: string[] = [];
		const { audio, context } = await unlocked({ canPlayType: () => 'probably', fetch: okFetch(requested) });
		// Every toucan file fails to decode; the howler's decode.
		context.decodeFails = (bytes) => new TextDecoder().decode(bytes).includes('toucan');
		await audio.preload('nature');
		expect(requested.some((url) => url.endsWith('howler-1.webm'))).toBe(true);
		// WebM first; AAC only where the WebM failed.
		expect(requested.some((url) => url.endsWith('howler-1.m4a'))).toBe(false);
		expect(requested.some((url) => url.endsWith('toucan-1.m4a'))).toBe(true);
		audio.play('howler');
		expect(lastSource(context).buffer?.sampleRate).toBe(context.sampleRate);
		audio.play('toucan');
		expect(lastSource(context).buffer?.sampleRate).toBe(SYNTH_RATE);
	});
});

function translation(x: number, y: number, z: number) {
	return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1]);
}

/** The bank with no files except `files` for `id` (so loads only fetch what a test names). */
function withFiles(id: SoundId, files: { webm?: string; m4a?: string }[], extra: object = {}): SoundBank {
	const bank: Record<SoundId, SoundDef> = { ...SOUNDS };
	for (const other of SOUND_IDS) bank[other] = { ...SOUNDS[other], files: [] };
	bank[id] = { ...SOUNDS[id], files, ...extra };
	return bank;
}

/** A fetch whose body is the URL's bytes (so the fake decoder can fail per URL). */
function okFetch(requested: string[] = []): GameAudioOptions['fetch'] {
	return async (url, init) => {
		requested.push(url);
		if (init.signal.aborted) throw new DOMException('aborted', 'AbortError');
		await Promise.resolve();
		if (init.signal.aborted) throw new DOMException('aborted', 'AbortError');
		return {
			ok: true,
			arrayBuffer: async () => new TextEncoder().encode(url).buffer as ArrayBuffer
		};
	};
}

describe('extra sounds (buffers outside the bank)', () => {
	it('decodes a file, and gives null on a failure, an abort or no audio', async () => {
		const requested: string[] = [];
		const { audio, context } = await unlocked({ fetch: okFetch(requested) });
		const buffer = await audio.decode('bed.webm');
		expect(buffer).not.toBeNull();
		expect(requested).toEqual(['bed.webm']);
		context.decodeFails = () => true;
		expect(await audio.decode('broken.webm')).toBeNull();
		const abort = new AbortController();
		abort.abort();
		expect(await audio.decode('late.webm', abort.signal)).toBeNull();
		const silent = createGameAudio({ createContext: () => null, page: null, window: null });
		expect(await silent.decode('bed.webm')).toBeNull();
	});

	it('plays one-shots and loops on the chosen bus, placed when asked, as voice "extra"', async () => {
		const { audio, context } = await unlocked();
		const buffer = context.createBuffer(2, 4800, 48000) as unknown as AudioBuffer;
		const spatial = { ref: 4, rolloff: 1.5, max: 70 };
		const voice = audio.playBuffer(buffer, { bus: 'animals', gain: 0.5, spatial }, { x: 3, y: 0, z: 0 });
		expect(voice?.id).toBe('extra');
		const source = lastSource(context);
		expect(source.buffer).toBe(buffer as unknown as FakeSource['buffer']);
		expect(gainOf(source).gain.value).toBe(0.5);
		const panner = [...gainOf(source).outputs][0] as FakePanner;
		expect(panner.kind).toBe('panner');
		expect(panner.positionX.value).toBe(3);
		// Past its max distance nothing starts.
		expect(audio.playBuffer(buffer, { bus: 'animals', spatial }, { x: 500, y: 0, z: 0 })).toBeNull();
		const bed = audio.loopBuffer(buffer, { bus: 'ambience', gain: 0.8, priority: 9 }, { fadeIn: 0 });
		expect(bed?.id).toBe('extra');
		expect(lastSource(context).loop).toBe(true);
		bed?.setGain(0.5, 0.1);
		const param = gainOf(lastSource(context)).gain;
		expect(param.events.at(-1)?.value).toBeCloseTo(0.4, 9);
	});

	it('shares the 16-voice pool and its stealing with the bank', async () => {
		const { audio, context } = await unlocked();
		const buffer = context.createBuffer(1, 4800, 48000) as unknown as AudioBuffer;
		for (let k = 0; k < 16; k++) audio.loop('forest-day');
		expect(audio.voices).toBe(16);
		// Priority 1 cannot take a bed's voice (9)…
		expect(audio.playBuffer(buffer, { bus: 'animals' })).toBeNull();
		// …priority 9 takes the oldest one.
		expect(audio.loopBuffer(buffer, { bus: 'ambience', priority: 9 })).not.toBeNull();
		expect(audio.voices).toBeLessThanOrEqual(16);
	});

	it('drops extra one-shots while locked, like bank sounds', async () => {
		const { audio, context } = setup();
		const buffer = context.createBuffer(1, 4800, 48000) as unknown as AudioBuffer;
		expect(audio.playBuffer(buffer, { bus: 'sfx' })).toBeNull();
		expect(audio.loopBuffer(buffer, { bus: 'ambience' })).not.toBeNull();
	});
});
