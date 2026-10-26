import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ExtraSound, GameAudio, LoopHandle, PlayOptions } from '../audio/engine.ts';
import type { StoryLevel } from '../level/types.ts';
import { FLAG, type SurvivalWorld } from '../survival/types.ts';
import {
	STUDY_AUDIO,
	type StudyAudioActor,
	type StudyAudioHost,
	startStudyAudio,
	studyHour,
	studyLayers,
	studyMix,
	studyWeather
} from './audio.ts';
import type { StudyCatalog, StudySoundGroup } from './data.ts';
import { STUDY_PREFIX, type StudyContext } from './gate.ts';

const STUDY = '?debug';
/** The owner's dev browser: the study is on by default. */
const DEV_PAGE: StudyContext = {
	dev: true,
	browser: true,
	test: false,
	webdriver: false,
	softwareTest: false
};
const TICK = STUDY_AUDIO.sampleEvery;

/** Made-up paths: the real ones live only in the served catalog. */
const group = (id: string, names = [`${id}-0`, `${id}-1`]): StudySoundGroup => ({
	kind: 'sound',
	id,
	role: 'call',
	note: '',
	files: names.map((name) => `audio/${name}.webm`)
});

const IDS = [
	'jungle-day-bed',
	'swamp-day-bed',
	'birds-bed',
	'jungle-night-bed',
	'crickets',
	'swamp-night-bed',
	'stream',
	'lake',
	'thunder',
	'day-calls',
	'night-calls',
	'capybara-calls',
	'capybara-alarm',
	'peccary-calls',
	'peccary-alarm',
	'toad-calls',
	'toucan-calls',
	'jaguar-calls'
];

const catalog = (ids = IDS): StudyCatalog => ({
	generatedAt: '',
	jobs: 0,
	animals: [],
	plants: [],
	sounds: [
		...ids.map((id) => group(id)),
		group('rain', ['rain_light_loop', 'rain_strong_loop']),
		group('foliage-wind', ['palm_wind_light', 'palm_wind_medium', 'palm_wind_heavy']),
		group('wind', ['wind_light', 'wind_medium', 'wind_heavy']),
		group('waterfall', ['Waterfall_small_loop', 'Waterfall_big_loop'])
	],
	terrain: []
});

interface Loop {
	url: string;
	sound: ExtraSound;
	gain: number;
	at: { x?: number; y?: number; z?: number };
	stopped: boolean;
	gains: number[];
	positions: number[][];
}

/** A GameAudio that records the study's decodes, loops and one-shots. */
function fakeAudio() {
	const loops: Loop[] = [];
	const played: { url: string; sound: ExtraSound; at: PlayOptions }[] = [];
	let playing = 0;
	const urlOf = new WeakMap<object, string>();
	const audio = {
		async decode(url: string) {
			const buffer = {};
			urlOf.set(buffer, url);
			return buffer as AudioBuffer;
		},
		loopBuffer(buffer: AudioBuffer, sound: ExtraSound, options: PlayOptions = {}) {
			const { gain = 1, ...at } = options;
			const loop: Loop = {
				url: urlOf.get(buffer) ?? '',
				sound,
				gain,
				at,
				stopped: false,
				gains: [],
				positions: []
			};
			loops.push(loop);
			return {
				id: 'extra',
				get playing() {
					return !loop.stopped;
				},
				stop: () => {
					loop.stopped = true;
				},
				setGain: (g: number) => loop.gains.push(g),
				setPosition: (x: number, y: number, z: number) => loop.positions.push([x, y, z])
			} as unknown as LoopHandle;
		},
		playBuffer(buffer: AudioBuffer, sound: ExtraSound, at: PlayOptions = {}) {
			played.push({ url: urlOf.get(buffer) ?? '', sound, at: { ...at } });
			playing++;
			return {
				id: 'extra' as const,
				get playing() {
					return playing > 0;
				},
				stop: () => {}
			};
		}
	} as unknown as GameAudio;
	const live = () => loops.filter((l) => !l.stopped);
	const names = () => live().map((l) => l.url.replace(`${STUDY_PREFIX}audio/`, ''));
	return { audio, loops, live, names, played, end: () => (playing = 0) };
}

function ours() {
	const stopped: string[] = [];
	const handle = (name: string) =>
		({
			id: name,
			playing: true,
			stop: () => stopped.push(name),
			setGain() {},
			setPosition() {}
		}) as unknown as LoopHandle;
	return { ownBed: handle('bed'), ownRiver: handle('river'), ownFall: handle('fall'), stopped };
}

/** A 64² world whose river runs along x = 10 (water at y 1), with our onça at (40, 0, 40). */
function riverWorld(): SurvivalWorld {
	const grid = 64;
	const flags = new Uint8Array(grid * grid);
	for (let j = 0; j < grid; j++) flags[j * grid + 10] = FLAG.river;
	return {
		grid,
		flags,
		river: {
			points: [
				{ x: 10, z: 0, water: 1 },
				{ x: 10, z: 63, water: 1 }
			]
		},
		animals: [{ species: 'onca-pintada', x: 40, y: 0, z: 40 }]
	} as unknown as SurvivalWorld;
}

async function start(host: Partial<StudyAudioHost> = {}, sounds = catalog()) {
	const fake = fakeAudio();
	const study = startStudyAudio({
		audio: fake.audio,
		search: STUDY,
		context: DEV_PAGE,
		random: () => 0,
		opus: true,
		catalog: async () => sounds,
		actors: () => null,
		...host
	});
	if (!study) throw new Error('study audio did not start');
	await vi.waitFor(() => expect(study.ready).toBe(true));
	return { study, ...fake };
}

afterEach(() => {
	delete (globalThis as { __estudoSom?: unknown }).__estudoSom;
});

describe('gate and URL', () => {
	it('follows the study gate (off with ?estudo=off and in automated runs) and stays off for &som=nosso', () => {
		const { audio } = fakeAudio();
		const host = { audio, context: DEV_PAGE, catalog: async () => catalog() };
		expect(startStudyAudio({ ...host, search: '?debug&estudo=off' })).toBeNull();
		expect(
			startStudyAudio({ ...host, search: '?debug', context: { ...DEV_PAGE, webdriver: true } })
		).toBeNull();
		expect(startStudyAudio({ ...host, search: `${STUDY}&som=nosso` })).toBeNull();
		const study = startStudyAudio({ ...host, search: STUDY });
		expect(study).not.toBeNull();
		study?.dispose();
	});

	it('reads the hour, the weather and the mix', () => {
		expect([studyHour(''), studyHour('?hora=entardecer'), studyHour('?hora=noite')]).toEqual([
			'day',
			'dusk',
			'night'
		]);
		expect([studyWeather(''), studyWeather('?tempo=chuva'), studyWeather('?tempo=chuva-forte')]).toEqual([
			'clear',
			'rain',
			'storm'
		]);
		expect([studyMix(''), studyMix('?som=ambos'), studyMix('?som=nosso')]).toEqual([
			'theirs',
			'both',
			'ours'
		]);
	});

	it('layers every hour and weather, with unique keys', () => {
		const keys = (hour: Parameters<typeof studyLayers>[0], weather: Parameters<typeof studyLayers>[1]) =>
			studyLayers(hour, weather).map((l) => l.key);
		expect(keys('day', 'clear')).toEqual([
			'forest',
			'swamp',
			'birds',
			'foliage',
			'wind-high',
			'stream',
			'waterfall',
			'lake'
		]);
		expect(keys('night', 'clear')).toEqual([
			'forest-night',
			'crickets',
			'swamp',
			'wind-high',
			'stream',
			'waterfall',
			'lake'
		]);
		expect(keys('dusk', 'storm')).toContain('rain');
		for (const hour of ['day', 'dusk', 'night'] as const)
			for (const weather of ['clear', 'rain', 'storm'] as const) {
				const all = keys(hour, weather);
				expect(new Set(all).size).toBe(all.length);
			}
		expect(studyLayers('day', 'storm').find((l) => l.key === 'rain')?.variant).toBe('strong');
	});
});

describe('layers', () => {
	it('plays the day beds from the served catalog and stops our forest bed', async () => {
		const own = ours();
		const { study, names, live } = await start(own);
		study.update(TICK, 0, 0, 0);
		expect(names()).toEqual(['jungle-day-bed-0.webm', 'birds-bed-0.webm', 'palm_wind_light.webm']);
		expect(live().every((l) => l.sound.bus === 'ambience' && l.sound.priority === 9)).toBe(true);
		expect(live().find((l) => l.url.includes('birds'))?.sound.gain).toBe(0.7);
		expect(own.stopped).toEqual(['bed']);
		study.dispose();
		expect(live()).toHaveLength(0);
	});

	it('blends day and night at dusk, layers ours with &som=ambos and takes the m4a twins without Opus', async () => {
		const own = ours();
		const { study, names } = await start({
			...own,
			search: `${STUDY}&hora=entardecer&som=ambos`,
			opus: false
		});
		study.update(TICK, 0, 0, 0);
		expect(names()).toEqual([
			'jungle-day-bed-0.m4a',
			'jungle-night-bed-0.m4a',
			'crickets-0.m4a',
			'palm_wind_light.m4a'
		]);
		expect(own.stopped).toEqual([]);
		study.dispose();
	});

	it('picks the variant files for heavy rain and thunders now and then', async () => {
		const { study, names, played } = await start({ search: `${STUDY}&hora=noite&tempo=chuva-forte` });
		study.update(TICK, 0, 0, 0);
		expect(names()).toContain('rain_strong_loop.webm');
		expect(names()).toContain('palm_wind_heavy.webm');
		study.update(STUDY_AUDIO.thunderMax, 0, 0, 0);
		const thunder = played.filter((p) => p.url.includes('thunder'));
		expect(thunder).toHaveLength(1);
		expect(thunder[0].sound).toMatchObject({ bus: 'ambience', gain: STUDY_AUDIO.thunderGain });
		expect(study.debug().played.thunder).toBe(1);
		study.dispose();
	});

	it('swells the swamp near the river, puts their stream on it and stops both away from it', async () => {
		const own = ours();
		const { study, live } = await start({ ...own, world: riverWorld() });
		const swamp = () => live().find((l) => l.url.includes('swamp'));
		const stream = () => live().find((l) => l.url.includes('stream'));
		study.update(TICK, 12, 0, 30);
		expect(swamp()?.gain).toBe(1);
		expect(stream()?.at).toEqual({ x: 10, y: 1, z: 30, fadeIn: STUDY_AUDIO.bedFadeIn });
		expect(stream()?.sound.spatial?.max).toBe(35);
		expect(own.stopped).toEqual(['bed', 'river']);
		study.update(TICK, 27, 0, 40);
		expect(swamp()?.gains.at(-1)).toBeCloseTo(0.5, 1);
		expect(stream()?.positions.at(-1)).toEqual([10, 1, 40]);
		study.update(TICK, 60, 0, 40);
		expect(swamp()?.gains.at(-1)).toBe(0);
		expect(stream()).toBeUndefined();
		study.update(TICK, 60, 0, 40);
		expect(swamp()).toBeUndefined();
		study.dispose();
	});

	it('places their waterfall at ours and the lake at the pool, within reach only, and the open wind up high', async () => {
		const own = ours();
		const level = { pool: { x: 100, z: 0, water: 2 } } as unknown as StoryLevel;
		const { study, live, names } = await start({ ...own, level, waterfall: { x: 0, y: 5, z: 0 } });
		study.update(TICK, 0, 0, 0);
		expect(live().find((l) => l.url.includes('Waterfall'))).toMatchObject({
			url: `${STUDY_PREFIX}audio/Waterfall_big_loop.webm`,
			at: { x: 0, y: 5, z: 0 }
		});
		expect(own.stopped).toContain('fall');
		expect(names()).not.toContain('lake-0.webm');
		study.update(TICK, 90, 15, 0);
		expect(names()).toContain('lake-0.webm');
		expect(names()).not.toContain('Waterfall_big_loop.webm');
		expect(names()).toContain('wind_light.webm');
		study.dispose();
	});

	it('reports curated groups the catalog lacks and plays without them', async () => {
		const { study, names } = await start(
			{},
			{ ...catalog(['jungle-day-bed']), sounds: [group('jungle-day-bed')] }
		);
		study.update(TICK, 0, 0, 0);
		expect(names()).toEqual(['jungle-day-bed-0.webm']);
		expect(study.debug().missing).toEqual(expect.arrayContaining(['birds-bed', 'day-calls', 'stream']));
		study.dispose();
	});
});

describe('one-shots and calls', () => {
	const capivara = (state: string, x = 5, z = 0): StudyAudioActor => ({
		member: { key: 'capivara-1', species: 'Capybara', group: 'capivaras' },
		state,
		x,
		y: 1,
		z
	});

	it('sprinkles day calls in the canopy around the listener, half as often in the rain', async () => {
		const { study, played } = await start();
		study.update(STUDY_AUDIO.oneShotMin, 0, 0, 0);
		expect(played).toHaveLength(1);
		const [shot] = played;
		expect(shot.url).toContain('day-calls');
		expect(shot.sound).toMatchObject({ bus: 'animals', priority: 1 });
		expect(Math.hypot(shot.at.x ?? 0, shot.at.z ?? 0)).toBeCloseTo(STUDY_AUDIO.oneShotNear, 6);
		expect(shot.at.y).toBe(STUDY_AUDIO.oneShotLiftMin);
		study.dispose();

		const wet = await start({ search: `${STUDY}&tempo=chuva` });
		wet.study.update(0.01, 0, 0, 0);
		wet.end();
		wet.study.update(STUDY_AUDIO.oneShotMin * 2 - 0.1, 0, 0, 0);
		expect(wet.played).toHaveLength(1);
		wet.study.update(0.2, 0, 0, 0);
		expect(wet.played).toHaveLength(2);
		wet.study.dispose();
	});

	it('calls from where the animal stands, only within range, and keeps quiet while alert', async () => {
		let actor = capivara('idle');
		const { study, played, end } = await start({ actors: () => [actor] });
		const calls = () => played.filter((p) => p.url.includes('capybara'));
		study.update(0.01, 0, 0, 0);
		expect(calls().map((p) => p.url)).toEqual([`${STUDY_PREFIX}audio/capybara-calls-0.webm`]);
		expect(calls()[0].at).toMatchObject({ x: 5, y: 1 + STUDY_AUDIO.callLift, z: 0, rate: 1 });
		expect(calls()[0].sound.priority).toBe(2);
		end();
		actor = capivara('idle', 200, 0);
		study.update(40, 0, 0, 0);
		expect(calls()).toHaveLength(1);
		study.dispose();
	});

	it('gives one alarm per group when it turns to flee, then waits for the cooldown', async () => {
		let state = 'idle';
		const second = (): StudyAudioActor => ({
			...capivara(state, 6, 1),
			member: { ...capivara(state).member, key: 'capivara-2' }
		});
		const { study, played, end } = await start({ actors: () => [capivara(state), second()] });
		study.update(0.01, 0, 0, 0);
		end();
		const alarms = () => played.filter((p) => p.url.includes('capybara-alarm'));
		state = 'flee';
		study.update(0.01, 0, 0, 0);
		expect(alarms()).toHaveLength(1);
		expect(alarms()[0].sound.priority).toBe(3);
		end();
		state = 'idle';
		study.update(0.01, 0, 0, 0);
		state = 'alert';
		study.update(0.01, 0, 0, 0);
		expect(alarms()).toHaveLength(1);
		state = 'idle';
		study.update(STUDY_AUDIO.alarmCooldown, 0, 0, 0);
		end();
		state = 'flee';
		study.update(0.01, 0, 0, 0);
		expect(alarms()).toHaveLength(2);
		study.dispose();
	});

	it('keeps the toucan asleep at night and voices our onça from its home', async () => {
		const toucan: StudyAudioActor = {
			member: { key: 'toucan-1', species: 'Toucan', group: 'toucan' },
			state: 'perch',
			x: 2,
			y: 8,
			z: 0
		};
		const { study, played, end } = await start({
			search: `${STUDY}&hora=noite`,
			world: riverWorld(),
			actors: () => [toucan]
		});
		for (let k = 0; k < 6; k++) {
			study.update(60, 40, 0, 30);
			end();
		}
		expect(played.filter((p) => p.url.includes('toucan'))).toHaveLength(0);
		const jaguar = played.filter((p) => p.url.includes('jaguar'));
		expect(jaguar.length).toBeGreaterThan(0);
		expect(jaguar[0].at).toMatchObject({ x: 40, y: STUDY_AUDIO.callLift, z: 40 });
		study.dispose();
	});

	it('never has more than maxOneShots study one-shots at once', async () => {
		const herd = Array.from({ length: 8 }, (_, k) => ({
			member: { key: `cateto-${k}`, species: 'Peccary', group: 'catetos' },
			state: 'idle',
			x: k,
			y: 0,
			z: 2
		}));
		const { study, played } = await start({ actors: () => herd });
		for (let k = 0; k < 5; k++) study.update(30, 0, 0, 0);
		expect(played).toHaveLength(STUDY_AUDIO.maxOneShots);
		expect(study.debug().oneShots).toBe(STUDY_AUDIO.maxOneShots);
		study.dispose();
	});
});
