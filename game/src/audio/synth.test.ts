import { describe, expect, it } from 'vitest';
import { SOUND_IDS, type SoundId } from './bank.ts';
import { renderPlaceholder, SYNTH_LOOPS, SYNTH_RATE, SYNTH_TRIM_DB, SYNTH_VARIANTS } from './synth.ts';

const LOOPS: SoundId[] = [...SYNTH_LOOPS];

function peak(samples: Float32Array) {
	let max = 0;
	for (const s of samples) max = Math.max(max, Math.abs(s));
	return max;
}

function rms(samples: Float32Array, from = 0, to = samples.length) {
	let sum = 0;
	for (let i = from; i < to; i++) sum += samples[i] * samples[i];
	return Math.sqrt(sum / (to - from));
}

describe('procedural placeholders', () => {
	it('renders every variant of every id: finite, audible, peak 0.8 lowered by its trim', () => {
		for (const id of SOUND_IDS)
			for (let v = 0; v < SYNTH_VARIANTS[id]; v++) {
				const out = renderPlaceholder(id, v);
				expect(out.length, id).toBeGreaterThan(0.04 * SYNTH_RATE);
				expect(
					out.every((s) => Number.isFinite(s)),
					id
				).toBe(true);
				// Normalised to 0.8, then trimmed; the 3 ms edge fades may shave a peak that sits in them.
				const ceiling = 0.8 * 10 ** (SYNTH_TRIM_DB[id] / 20);
				expect(SYNTH_TRIM_DB[id], id).toBeLessThanOrEqual(0);
				expect(peak(out), id).toBeLessThanOrEqual(ceiling + 1e-6);
				expect(peak(out), id).toBeGreaterThan(ceiling * 0.6);
			}
	});

	it('keeps one-shots short and loops long', () => {
		for (const id of SOUND_IDS) {
			const seconds = renderPlaceholder(id).length / SYNTH_RATE;
			if (LOOPS.includes(id)) expect(seconds, id).toBeGreaterThanOrEqual(6);
			else expect(seconds, id).toBeLessThanOrEqual(1.7);
		}
	});

	it('is deterministic, and its variants differ', () => {
		expect(renderPlaceholder('step-leaves', 1)).toEqual(renderPlaceholder('step-leaves', 1));
		expect(renderPlaceholder('step-leaves', 0)).not.toEqual(renderPlaceholder('step-leaves', 1));
	});

	it('starts and ends one-shots at silence (no click)', () => {
		for (const id of SOUND_IDS) {
			if (LOOPS.includes(id)) continue;
			const out = renderPlaceholder(id);
			expect(Math.abs(out[0]), id).toBeLessThan(1e-6);
			expect(Math.abs(out[out.length - 1]), id).toBeLessThan(1e-6);
		}
	});

	it('loops without a seam: the jump from the last sample to the first is ordinary', () => {
		for (const id of LOOPS) {
			const out = renderPlaceholder(id);
			let largest = 0;
			for (let i = 1; i < out.length; i++) largest = Math.max(largest, Math.abs(out[i] - out[i - 1]));
			expect(Math.abs(out[0] - out[out.length - 1]), id).toBeLessThanOrEqual(largest);
			// No level dip or bump around the seam either.
			const edge = Math.round(0.25 * SYNTH_RATE);
			const seam = Math.sqrt((rms(out, 0, edge) ** 2 + rms(out, out.length - edge, out.length) ** 2) / 2);
			expect(seam / rms(out), id).toBeGreaterThan(0.5);
			expect(seam / rms(out), id).toBeLessThan(2);
		}
	});
});
