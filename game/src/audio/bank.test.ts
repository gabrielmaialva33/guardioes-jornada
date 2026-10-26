import { readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { chooseAudioCodec } from '../../protocol.ts';
import {
	BUS_PARENT,
	BUSES,
	CODEC_TYPES,
	codecOrder,
	recordedFiles,
	SOUND_IDS,
	SOUNDS,
	STEP_SOUND,
	SURFACES,
	variantUrls
} from './bank.ts';
import { SYNTH_LOOPS, SYNTH_VARIANTS } from './synth.ts';

/** canPlayType answers of some real browsers (MIME type → answer). */
const BROWSERS: Record<string, Record<string, string>> = {
	chromeAndroid: { [CODEC_TYPES.webm]: 'probably', [CODEC_TYPES.m4a]: 'probably' },
	oldSafari: { [CODEC_TYPES.webm]: '', [CODEC_TYPES.m4a]: 'maybe' },
	firefox: { [CODEC_TYPES.webm]: 'probably', [CODEC_TYPES.m4a]: 'maybe' }
};

describe('codec choice', () => {
	it('prefers Opus in WebM, then AAC, every "probably" before any "maybe"', () => {
		expect(codecOrder((t) => BROWSERS.chromeAndroid[t])).toEqual(['webm', 'm4a']);
		expect(codecOrder((t) => BROWSERS.oldSafari[t])).toEqual(['m4a']);
		expect(codecOrder((t) => BROWSERS.firefox[t])).toEqual(['webm', 'm4a']);
		expect(codecOrder((t) => (t === CODEC_TYPES.m4a ? 'probably' : 'maybe'))).toEqual(['m4a', 'webm']);
		expect(codecOrder(() => '')).toEqual([]);
		expect(
			codecOrder(() => {
				throw new Error('no audio element');
			})
		).toEqual([]);
	});

	it('lists a variant’s URLs in codec order, skipping missing exports', () => {
		expect(variantUrls({ m4a: 'a.m4a', webm: 'a.webm' }, ['webm', 'm4a'])).toEqual(['a.webm', 'a.m4a']);
		expect(variantUrls({ webm: 'a.webm' }, ['m4a'])).toEqual([]);
	});

	it('puts first the codec the launcher downloads into the offline pack', () => {
		for (const answers of Object.values(BROWSERS))
			expect(codecOrder((t) => answers[t])[0]).toBe(chooseAudioCodec((t) => answers[t]));
		expect(chooseAudioCodec(() => '')).toBeNull();
	});
});

describe('sound bank', () => {
	it('gives every id a placeholder, a sane gain and jitter, and a real bus', () => {
		for (const id of SOUND_IDS) {
			const def = SOUNDS[id];
			expect(SYNTH_VARIANTS[id], id).toBeGreaterThanOrEqual(1);
			expect(def.gain, id).toBeGreaterThan(0);
			expect(def.gain, id).toBeLessThanOrEqual(1);
			expect(def.pitchJitter, id).toBeLessThanOrEqual(2);
			expect(def.gainJitter, id).toBeLessThanOrEqual(3);
			expect(['music', 'ambience', 'animals', 'sfx', 'ui']).toContain(def.bus);
		}
	});

	it('has a step sound for every surface, all positionable', () => {
		for (const surface of SURFACES) {
			const def = SOUNDS[STEP_SOUND[surface]];
			expect(def.category).toBe('essential');
			expect('spatial' in def && def.spatial).toBeTruthy();
		}
	});
});

describe('recorded files', () => {
	const folder = new URL('../assets/audio/', import.meta.url);
	const onDisk = readdirSync(folder).filter((name) => /\.(webm|m4a)$/.test(name));

	it('builds every bus after its parent', () => {
		for (const bus of BUSES)
			if (bus !== 'master') expect(BUSES.indexOf(BUS_PARENT[bus])).toBeLessThan(BUSES.indexOf(bus));
	});

	it('pairs every variant with a WebM and an M4A, and leaves no file unused', () => {
		const used = new Set<string>();
		for (const id of SOUND_IDS) {
			const files = SOUNDS[id].files;
			files.forEach((variant, n) => {
				expect(variant.webm, `${id}-${n + 1}`).toMatch(new RegExp(`${id}-${n + 1}\\.webm`));
				expect(variant.m4a, `${id}-${n + 1}`).toMatch(new RegExp(`${id}-${n + 1}\\.m4a`));
				used.add(`${id}-${n + 1}.webm`);
				used.add(`${id}-${n + 1}.m4a`);
			});
		}
		expect(onDisk.filter((name) => !used.has(name))).toEqual([]);
		expect(used.size).toBe(onDisk.length);
	});

	it('gives every id a recording (the trail step since wave 1.1)', () => {
		expect(SOUND_IDS.filter((id) => SOUNDS[id].files.length === 0)).toEqual([]);
		expect(SOUNDS['step-soil'].files).toHaveLength(4);
	});

	it('gives recorded loops their loop points, and only loops', () => {
		for (const id of SOUND_IDS) {
			const def = SOUNDS[id];
			const loop = 'loop' in def ? def.loop : undefined;
			expect(Boolean(loop), id).toBe(SYNTH_LOOPS.has(id));
			if (loop) expect(loop.end).toBeGreaterThan(loop.start);
		}
	});

	it('drops variants whose files are missing, so the placeholder plays', () => {
		const urls = new Map([
			['owl-1.webm', '/a/owl-1.webm'],
			['owl-1.m4a', '/a/owl-1.m4a'],
			['owl-3.m4a', '/a/owl-3.m4a']
		]);
		expect(recordedFiles('owl', 3, urls)).toEqual([
			{ webm: '/a/owl-1.webm', m4a: '/a/owl-1.m4a' },
			{ m4a: '/a/owl-3.m4a' }
		]);
		expect(recordedFiles('bat', 2, urls)).toEqual([]);
	});
});
