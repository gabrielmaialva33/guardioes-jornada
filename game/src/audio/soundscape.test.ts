import { describe, expect, it } from 'vitest';
import { AUDIO_BUSES } from '../data/local-save.ts';
import type { CheckpointEvent } from '../engine/checkpoints.ts';
import { JUMP_SPEED } from '../engine/constants.ts';
import { buildStoryWorld } from '../level/build.ts';
import { TRAILS } from '../level/layout.ts';
import { StoryGame } from '../missions/story.ts';
import { heightAt } from '../survival/terrain.ts';
import { BUSES, type SoundId, type Surface } from './bank.ts';
import { DEFAULT_SETTINGS, type GameAudio, type LoopHandle } from './engine.ts';
import { type FrameSounds, Soundscape } from './soundscape.ts';

const { world, level } = buildStoryWorld();

interface Call {
	kind: 'play' | 'step' | 'loop' | 'duck' | 'release' | 'stop';
	id: string;
	x?: number;
	y?: number;
	z?: number;
	gain?: number;
	rate?: number;
	intensity?: number;
}

/** A GameAudio that records what it is asked to do (option objects are copied: the soundscape reuses them). */
function recorder() {
	const calls: Call[] = [];
	const loops = new Map<string, { playing: boolean; position: [number, number, number] }>();
	let listener = 0;
	const audio: GameAudio = {
		state: 'running',
		voices: 0,
		unlock: async () => true,
		play(id, options = {}) {
			calls.push({ kind: 'play', id, ...options });
			return null;
		},
		footstep(surface, options = {}) {
			calls.push({ kind: 'step', id: surface, intensity: options.intensity });
			return null;
		},
		loop(id, options = {}) {
			calls.push({ kind: 'loop', id, x: options.x, y: options.y, z: options.z });
			const state = {
				playing: true,
				position: [options.x ?? 0, options.y ?? 0, options.z ?? 0] as [number, number, number]
			};
			loops.set(id, state);
			const handle: LoopHandle = {
				id,
				get playing() {
					return state.playing;
				},
				stop() {
					state.playing = false;
					calls.push({ kind: 'stop', id });
				},
				setGain() {},
				setPosition(x, y, z) {
					state.position = [x, y, z];
				}
			};
			return handle;
		},
		setListener() {
			listener++;
		},
		setBusVolume() {},
		mute() {},
		duck() {
			calls.push({ kind: 'duck', id: '' });
			return () => calls.push({ kind: 'release', id: '' });
		},
		settings: () => ({ volume: { ...DEFAULT_SETTINGS.volume }, muted: { ...DEFAULT_SETTINGS.muted } }),
		preload: async () => {},
		dispose: async () => {}
	};
	return { audio, calls, loops, listeners: () => listener };
}

/** A camera-like listener at (x, y, z): only the translation column is read. */
function listenerAt(x: number, y: number, z: number) {
	const elements = new Float32Array(16);
	elements[0] = elements[5] = elements[10] = elements[15] = 1;
	elements[12] = x;
	elements[13] = y;
	elements[14] = z;
	return { matrixWorld: { elements } };
}

function frameAt(
	x: number,
	z: number,
	y = heightAt(world.heights, x, z)
): FrameSounds & { events: CheckpointEvent[] } {
	return { position: { x, y, z }, jumped: false, landed: false, landingSpeed: 0, events: [] };
}

function setup(story?: StoryGame) {
	const rec = recorder();
	let seed = 1;
	const random = () => {
		seed = (seed * 16807) % 2147483647;
		return (seed - 1) / 2147483646;
	};
	const sound = new Soundscape({ audio: rec.audio, map: { world, level }, story, random });
	return { ...rec, sound };
}

const plays = (calls: Call[], id: SoundId) => calls.filter((c) => c.kind === 'play' && c.id === id);
const steps = (calls: Call[]) => calls.filter((c) => c.kind === 'step').map((c) => c.id as Surface);

describe('player sounds', () => {
	const [tx, tz] = TRAILS.trilha[1] as [number, number];
	const listener = listenerAt(tx, 5, tz);

	it('plays a footstep on each foot contact, on the surface under the feet, louder when running', () => {
		const { sound, calls } = setup();
		sound.update(1 / 60, listener, frameAt(tx, tz), null, 0);
		expect(steps(calls)).toEqual([]);
		sound.update(1 / 60, listener, frameAt(tx, tz), 'left', 0);
		sound.update(1 / 60, listener, frameAt(tx, tz), 'right', 1);
		expect(steps(calls)).toEqual(['soil', 'soil']);
		const [walk, run] = calls.filter((c) => c.kind === 'step');
		expect(run.intensity).toBeGreaterThan(walk.intensity ?? 0);
	});

	it('plays the jump, and a landing that grows with the landing speed', () => {
		const { sound, calls } = setup();
		const frame = frameAt(tx, tz);
		frame.jumped = true;
		sound.update(1 / 60, listener, frame, null, 0);
		expect(plays(calls, 'jump')).toHaveLength(1);
		const land = (speed: number) => {
			const f = frameAt(tx, tz);
			f.landed = true;
			f.landingSpeed = speed;
			sound.update(1 / 60, listener, f, null, 0);
		};
		land(JUMP_SPEED * 0.1);
		expect(plays(calls, 'land')).toHaveLength(0);
		land(JUMP_SPEED * 0.6);
		land(JUMP_SPEED * 1.4);
		const [soft, hard] = plays(calls, 'land');
		expect(hard.gain).toBeGreaterThan(soft.gain ?? 0);
		expect(steps(calls)).toEqual(['soil', 'soil']);
	});

	it('lands in the river with a water step and no thud', () => {
		const { sound, calls } = setup();
		const p = world.river.points[4];
		const f = frameAt(p.x, p.z, p.water - 0.3);
		f.landed = true;
		f.landingSpeed = JUMP_SPEED;
		sound.update(1 / 60, listener, f, null, 0);
		expect(plays(calls, 'land')).toHaveLength(0);
		expect(steps(calls)).toEqual(['water']);
	});

	it('plays the checkpoint, and the splash only for a fall into the water', () => {
		const { sound, calls } = setup();
		const checkpoint = level.checkpoints[0];
		const reached = frameAt(tx, tz);
		reached.events.push({ type: 'checkpoint', checkpoint });
		sound.update(1 / 60, listener, reached, null, 0);
		expect(plays(calls, 'checkpoint')).toHaveLength(1);
		const offCliff = frameAt(tx, tz);
		offCliff.events.push({ type: 'fell' });
		sound.update(1 / 60, listener, offCliff, null, 0);
		expect(plays(calls, 'splash')).toHaveLength(0);
		const p = world.river.points[4];
		const intoRiver = frameAt(p.x, p.z, p.water - 2);
		intoRiver.events.push({ type: 'fell' }, { type: 'respawn', checkpoint });
		sound.update(1 / 60, listener, intoRiver, null, 0);
		expect(plays(calls, 'splash')).toHaveLength(1);
	});

	it('updates the listener every frame and asks for nothing else on a quiet frame', () => {
		const { sound, calls, listeners } = setup();
		for (let k = 0; k < 10; k++) sound.update(1 / 60, listener, frameAt(tx, tz), null, 0);
		expect(listeners()).toBe(10);
		expect(calls).toEqual([]);
		expect(sound.timing().samples).toBe(10);
	});
});

describe('ambience', () => {
	it('starts the beds only once the nature sounds are decoded, at their places', async () => {
		const { sound, calls, loops } = setup();
		const quiet = listenerAt(40, 5, 80);
		sound.update(1 / 60, quiet, frameAt(40, 80), null, 0);
		expect(calls.filter((c) => c.kind === 'loop')).toEqual([]);
		await sound.startNature();
		const loopIds = calls.filter((c) => c.kind === 'loop').map((c) => c.id);
		expect(loopIds).toEqual(['forest-day', 'river', 'waterfall', 'chainsaw']);
		const fall = calls.find((c) => c.id === 'waterfall');
		expect([fall?.x, fall?.z]).toEqual([132, 30]);
		const cutting = level.landmarks.find((l) => l.kind === 'cutting');
		expect(calls.find((c) => c.id === 'chainsaw')).toMatchObject({ x: cutting?.x, z: cutting?.z });
		// The river emitter follows the centre-line point nearest the listener.
		const p = world.river.points[5];
		sound.update(1 / 60, listenerAt(p.x + 10, 5, p.z), frameAt(40, 80), null, 0);
		const [x, , z] = loops.get('river')?.position ?? [0, 0, 0];
		expect(Math.hypot(x - (p.x + 10), z - p.z)).toBeLessThanOrEqual(10.01);
		expect(Math.hypot(x - p.x, z - p.z)).toBeLessThan(10);
	});

	it('calls the howler from its home every 40–90 s, and the toucan only when near', async () => {
		const { sound, calls } = setup();
		await sound.startNature();
		const howler = world.animals.find((a) => a.species === 'bugio');
		const toucan = world.animals.find((a) => a.species === 'tucano');
		if (!howler || !toucan) throw new Error('animal homes');
		const atHowler = listenerAt(howler.x, 5, howler.z);
		for (let t = 0; t < 300; t += 0.5) sound.update(0.5, atHowler, frameAt(howler.x, howler.z), null, 0);
		const howls = plays(calls, 'howler');
		expect(howls.length).toBeGreaterThanOrEqual(300 / 90);
		expect(howls.length).toBeLessThanOrEqual(1 + 300 / 40);
		for (const howl of howls)
			expect(Math.hypot((howl.x ?? 0) - howler.x, (howl.z ?? 0) - howler.z)).toBeLessThan(5);
		// The toucan's home is far from the howler's: no toucan calls there.
		expect(plays(calls, 'toucan')).toHaveLength(0);
		const atToucan = listenerAt(toucan.x, 5, toucan.z);
		for (let t = 0; t < 120; t += 0.5) sound.update(0.5, atToucan, frameAt(toucan.x, toucan.z), null, 0);
		expect(plays(calls, 'toucan').length).toBeGreaterThan(0);
	});
});

describe('missions', () => {
	const spot = (id: string) => {
		const p = [...level.triggers, ...level.collectibles, ...level.landmarks].find((p) => p.id === id);
		if (!p) throw new Error(id);
		return p;
	};

	it('maps the story events to sounds, ducks dialogues and silences the chainsaw after mission 2', async () => {
		const story = new StoryGame(level, { persist: () => true, badge: () => {} });
		const { sound, calls } = setup(story);
		await sound.startNature();
		story.act(spot('iara'));
		sound.syncStory();
		expect(calls.filter((c) => c.kind === 'duck')).toHaveLength(1);
		story.choose('start', spot('iara'));
		sound.syncStory();
		expect(calls.filter((c) => c.kind === 'release')).toHaveLength(1);

		for (const fruit of level.collectibles.filter((c) => c.kind === 'jucara-fruit')) {
			story.act(fruit);
			sound.syncStory();
		}
		const collects = plays(calls, 'collect');
		expect(collects).toHaveLength(5);
		// Pick-ups in a row climb in pitch.
		expect(collects[4].rate).toBeGreaterThan(collects[0].rate ?? 0);
		const corridor = level.planting.filter((p) => p.mission === 1);
		for (const cell of corridor) {
			story.act(cell);
			sound.syncStory();
		}
		expect(plays(calls, 'land')).toHaveLength(corridor.length - 1);
		expect(plays(calls, 'mission-complete')).toHaveLength(1);
		story.closeDialogue();
		sound.syncStory();

		const hide = spot('observacao');
		story.act(hide);
		sound.syncStory();
		expect(plays(calls, 'radio-call')).toHaveLength(1);
		expect(calls.some((c) => c.kind === 'stop' && c.id === 'chainsaw')).toBe(false);
		story.choose('report-logger', hide);
		sound.syncStory();
		expect(plays(calls, 'mission-complete')).toHaveLength(2);
		expect(calls.some((c) => c.kind === 'stop' && c.id === 'chainsaw')).toBe(true);

		// A restart brings mission 2 back, and with it the chainsaw.
		story.restart();
		sound.syncStory();
		expect(calls.filter((c) => c.kind === 'loop' && c.id === 'chainsaw')).toHaveLength(2);
		await sound.dispose();
		expect(calls.filter((c) => c.kind === 'stop').map((c) => c.id)).toEqual(
			expect.arrayContaining(['forest-day', 'river', 'waterfall', 'chainsaw'])
		);
	});
});

it('saves the same buses the engine has', () => {
	expect([...AUDIO_BUSES]).toEqual([...BUSES]);
});
