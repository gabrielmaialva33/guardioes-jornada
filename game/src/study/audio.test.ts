import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ExtraSound, GameAudio, LoopHandle, PlayOptions } from '../audio/engine.ts';
import { FLAG, type SurvivalWorld } from '../survival/types.ts';
import {
	STUDY_AUDIO,
	type StudyAudioActor,
	type StudyAudioHost,
	startStudyAudio,
	studyHour,
	studyMix
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

/** Made-up paths: the real ones live only in the served catalog. */
const group = (id: string, count = 2): StudySoundGroup => ({
	kind: 'sound',
	id,
	role: 'call',
	note: '',
	files: Array.from({ length: count }, (_, k) => `audio/${id}-${k}.webm`)
});

const catalog = (ids: string[]): StudyCatalog => ({
	generatedAt: '',
	jobs: 0,
	animals: [],
	plants: [],
	sounds: ids.map((id) => group(id)),
	terrain: []
});

const ALL = [
	'jungle-day-bed',
	'swamp-day-bed',
	'jungle-night-bed',
	'crickets',
	'swamp-night-bed',
	'day-calls',
	'night-calls',
	'capybara-calls',
	'capybara-alarm',
	'peccary-calls',
	'peccary-alarm'
];

interface Played {
	url: string;
	sound: ExtraSound;
	at: PlayOptions;
}

/** A GameAudio that records the study's decodes, loops and one-shots. */
function fakeAudio() {
	const decoded: string[] = [];
	const loops: { url: string; sound: ExtraSound; gain: number; stopped: boolean; gains: number[] }[] = [];
	const played: Played[] = [];
	let playing = 0;
	const urlOf = new WeakMap<object, string>();
	const audio = {
		async decode(url: string) {
			decoded.push(url);
			const buffer = {};
			urlOf.set(buffer, url);
			return buffer as AudioBuffer;
		},
		loopBuffer(buffer: AudioBuffer, sound: ExtraSound, options: { gain?: number } = {}) {
			const loop = {
				url: urlOf.get(buffer) ?? '',
				sound,
				gain: options.gain ?? 1,
				stopped: false,
				gains: [] as number[]
			};
			loops.push(loop);
			return {
				id: 'extra',
				playing: true,
				stop: () => {
					loop.stopped = true;
				},
				setGain: (gain: number) => loop.gains.push(gain),
				setPosition: () => {}
			} as LoopHandle;
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
	return { audio, decoded, loops, played, end: () => (playing = 0) };
}

function ownBed() {
	const gains: number[] = [];
	const bed = {
		id: 'forest-day',
		playing: true,
		stop() {},
		setGain: (g: number) => gains.push(g),
		setPosition() {}
	};
	return { bed: bed as LoopHandle, gains };
}

/** A 64² world whose river runs along x = 10. */
function riverWorld(): SurvivalWorld {
	const grid = 64;
	const flags = new Uint8Array(grid * grid);
	for (let j = 0; j < grid; j++) flags[j * grid + 10] = FLAG.river;
	return { grid, flags } as unknown as SurvivalWorld;
}

async function start(host: Partial<StudyAudioHost> = {}, ids = ALL) {
	const fake = fakeAudio();
	const study = startStudyAudio({
		audio: fake.audio,
		search: STUDY,
		context: DEV_PAGE,
		random: () => 0,
		opus: true,
		catalog: async () => catalog(ids),
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

describe('gate', () => {
	it('follows the study gate (off with ?estudo=off and in automated runs) and stays off for &som=nosso', () => {
		const { audio } = fakeAudio();
		const host = { audio, context: DEV_PAGE, catalog: async () => catalog([]) };
		expect(startStudyAudio({ ...host, search: '?debug&estudo=off' })).toBeNull();
		expect(
			startStudyAudio({ ...host, search: '?debug', context: { ...DEV_PAGE, webdriver: true } })
		).toBeNull();
		expect(startStudyAudio({ ...host, search: `${STUDY}&som=nosso` })).toBeNull();
		const study = startStudyAudio({ ...host, search: STUDY });
		expect(study).not.toBeNull();
		study?.dispose();
	});

	it('reads the hour and the mix from the URL', () => {
		expect(studyHour('?hora=noite')).toBe('night');
		expect(studyHour('?hora=dia')).toBe('day');
		expect(studyMix('')).toBe('theirs');
		expect(studyMix('?som=ambos')).toBe('both');
		expect(studyMix('?som=nosso')).toBe('ours');
	});
});

describe('beds', () => {
	it('loops the day beds from the served catalog and mutes our forest bed', async () => {
		const own = ownBed();
		const { study, loops } = await start({ ownBed: own.bed });
		expect(loops.map((l) => l.url)).toEqual([
			`${STUDY_PREFIX}audio/jungle-day-bed-0.webm`,
			`${STUDY_PREFIX}audio/swamp-day-bed-0.webm`
		]);
		expect(loops.every((l) => l.sound.bus === 'ambience' && l.sound.priority === 9)).toBe(true);
		expect(own.gains).toEqual([0]);
		study.dispose();
		expect(loops.every((l) => l.stopped)).toBe(true);
		expect(own.gains).toEqual([0, 1]);
	});

	it('plays the night beds, layers ours with &som=ambos and takes the m4a twins without Opus', async () => {
		const own = ownBed();
		const { study, loops } = await start({
			ownBed: own.bed,
			search: `${STUDY}&hora=noite&som=ambos`,
			opus: false
		});
		expect(loops.map((l) => l.url)).toEqual([
			`${STUDY_PREFIX}audio/jungle-night-bed-0.m4a`,
			`${STUDY_PREFIX}audio/crickets-0.m4a`,
			`${STUDY_PREFIX}audio/swamp-night-bed-0.m4a`
		]);
		expect(own.gains).toEqual([]);
		study.dispose();
	});

	it('reports curated groups the catalog lacks and starts without them', async () => {
		const { study, loops } = await start({}, ['jungle-day-bed']);
		expect(loops).toHaveLength(1);
		expect(study.debug().missing).toContain('swamp-day-bed');
		expect(study.debug().missing).toContain('day-calls');
		study.dispose();
	});

	it('swells the swamp bed near the river and fades it away from it', async () => {
		const { study, loops } = await start({ world: riverWorld() });
		const swamp = loops.find((l) => l.url.includes('swamp'));
		expect(swamp?.gain).toBe(0);
		study.update(STUDY_AUDIO.riverEvery, 12, 0, 30);
		expect(swamp?.gains.at(-1)).toBe(1);
		study.update(STUDY_AUDIO.riverEvery, 10 + 17, 0, 30);
		expect(swamp?.gains.at(-1)).toBeCloseTo(0.5, 1);
		study.update(STUDY_AUDIO.riverEvery, 50, 0, 30);
		expect(swamp?.gains.at(-1)).toBe(0);
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

	it('sprinkles day calls in the canopy around the listener', async () => {
		const { study, played } = await start();
		study.update(STUDY_AUDIO.oneShotMin, 0, 0, 0);
		expect(played).toHaveLength(1);
		const [shot] = played;
		expect(shot.url).toContain('day-calls');
		expect(shot.sound).toMatchObject({ bus: 'animals', priority: 1 });
		expect(Math.hypot(shot.at.x ?? 0, shot.at.z ?? 0)).toBeCloseTo(STUDY_AUDIO.oneShotNear, 6);
		expect(shot.at.y).toBe(STUDY_AUDIO.oneShotLiftMin);
		study.dispose();
	});

	it('calls from where the animal stands, only within range, and keeps quiet while alert', async () => {
		let actor = capivara('idle');
		const { study, played, end } = await start({ actors: () => [actor] });
		study.update(0.01, 0, 0, 0);
		const calls = () => played.filter((p) => p.url.includes('capybara'));
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
