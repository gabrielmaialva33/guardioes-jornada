/**
 * Procedural placeholders: every sound id rendered in plain JavaScript into a
 * mono Float32Array (oscillators, filtered noise, exponential envelopes) at
 * SYNTH_RATE. The engine wraps the samples in an AudioBuffer the first time an
 * id plays, so placeholders and recordings share one playback path (voice cap,
 * jitter, buses, panner).
 *
 * Rendering is deterministic: a seeded generator per (id, variant). Loops are
 * rendered a little longer and their tail cross-faded into their head
 * (equal power), so the whole buffer loops without a click.
 */
import type { SoundId } from './bank.ts';

/** Placeholder sample rate: half of 44.1 kHz is plenty for noise and chirps under 5 kHz. */
export const SYNTH_RATE = 22050;
/** Peak every placeholder is normalised to, before its trim (SYNTH_TRIM_DB); the bank's gain sets the mix. */
const PEAK = 0.8;
const TAU = Math.PI * 2;

/** mulberry32: small, fast and good enough for noise. */
function generator(seed: number): () => number {
	let state = seed >>> 0;
	return () => {
		state = (state + 0x6d2b79f5) >>> 0;
		let t = state;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/** RBJ cookbook biquad; `set` may be called while running for sweeps. */
class Biquad {
	#b0 = 0;
	#b1 = 0;
	#b2 = 0;
	#a1 = 0;
	#a2 = 0;
	#x1 = 0;
	#x2 = 0;
	#y1 = 0;
	#y2 = 0;
	readonly #type: 'lowpass' | 'highpass' | 'bandpass';

	constructor(type: 'lowpass' | 'highpass' | 'bandpass', frequency: number, q: number) {
		this.#type = type;
		this.set(frequency, q);
	}

	set(frequency: number, q: number) {
		const w = (TAU * Math.min(frequency, SYNTH_RATE * 0.45)) / SYNTH_RATE;
		const cos = Math.cos(w);
		const alpha = Math.sin(w) / (2 * q);
		const a0 = 1 + alpha;
		if (this.#type === 'lowpass') {
			this.#b0 = (1 - cos) / 2 / a0;
			this.#b1 = (1 - cos) / a0;
			this.#b2 = this.#b0;
		} else if (this.#type === 'highpass') {
			this.#b0 = (1 + cos) / 2 / a0;
			this.#b1 = -(1 + cos) / a0;
			this.#b2 = this.#b0;
		} else {
			this.#b0 = alpha / a0;
			this.#b1 = 0;
			this.#b2 = -alpha / a0;
		}
		this.#a1 = (-2 * cos) / a0;
		this.#a2 = (1 - alpha) / a0;
	}

	run(x: number): number {
		const y =
			this.#b0 * x + this.#b1 * this.#x1 + this.#b2 * this.#x2 - this.#a1 * this.#y1 - this.#a2 * this.#y2;
		this.#x2 = this.#x1;
		this.#x1 = x;
		this.#y2 = this.#y1;
		this.#y1 = y;
		return y;
	}
}

const samples = (seconds: number) => new Float32Array(Math.ceil(seconds * SYNTH_RATE));

/** Attack-then-exponential-decay envelope at time t (s) after `start`. */
function envelope(t: number, start: number, attack: number, tau: number): number {
	const local = t - start;
	if (local < 0) return 0;
	if (local < attack) return local / attack;
	return Math.exp(-(local - attack) / tau);
}

/** Adds a sine whose frequency glides exponentially from f0 to f1 over `glide` s. */
function addTone(
	out: Float32Array,
	start: number,
	f0: number,
	f1: number,
	glide: number,
	amp: number,
	attack: number,
	tau: number
) {
	let phase = 0;
	const first = Math.floor(start * SYNTH_RATE);
	for (let i = first; i < out.length; i++) {
		const local = (i - first) / SYNTH_RATE;
		const k = glide > 0 ? Math.min(1, local / glide) : 1;
		phase += (TAU * f0 * (f1 / f0) ** k) / SYNTH_RATE;
		const env = envelope(local, 0, attack, tau);
		if (local > attack && env < 1e-4) break;
		out[i] += Math.sin(phase) * amp * env;
	}
}

/** Adds filtered white noise; `freq(t)` may sweep the filter (updated every 32 samples). */
function addNoise(
	out: Float32Array,
	random: () => number,
	filter: Biquad | null,
	freq: ((t: number) => number) | null,
	q: number,
	amp: number,
	gate: (t: number) => number
) {
	for (let i = 0; i < out.length; i++) {
		const t = i / SYNTH_RATE;
		if (filter && freq && (i & 31) === 0) filter.set(freq(t), q);
		const white = random() * 2 - 1;
		out[i] += (filter ? filter.run(white) : white) * amp * gate(t);
	}
}

/** Sparse clicks (leaf litter, gravel): impulses with decaying density, through a band-pass. */
function addCrackle(
	out: Float32Array,
	random: () => number,
	center: number,
	density: number,
	tau: number,
	amp: number
) {
	const band = new Biquad('bandpass', center, 1.2);
	for (let i = 0; i < out.length; i++) {
		const t = i / SYNTH_RATE;
		const chance = (density / SYNTH_RATE) * Math.exp(-t / tau);
		const impulse = random() < chance ? (random() * 2 - 1) * 4 : 0;
		out[i] += band.run(impulse) * amp;
	}
}

function normalise(out: Float32Array): Float32Array {
	let peak = 0;
	for (let i = 0; i < out.length; i++) peak = Math.max(peak, Math.abs(out[i]));
	if (peak > 0) {
		const k = PEAK / peak;
		for (let i = 0; i < out.length; i++) out[i] *= k;
	}
	// A 3 ms fade at both ends: no click when a one-shot starts or is cut.
	const fade = Math.min(out.length >> 1, Math.round(0.003 * SYNTH_RATE));
	for (let i = 0; i < fade; i++) {
		out[i] *= i / fade;
		out[out.length - 1 - i] *= i / fade;
	}
	return out;
}

/** Folds the last `overlap` seconds onto the head (equal power) and drops them: a click-free loop. */
function seamless(long: Float32Array, overlap: number): Float32Array {
	const x = Math.round(overlap * SYNTH_RATE);
	const n = long.length - x;
	const out = long.slice(0, n);
	for (let i = 0; i < x; i++) {
		const k = (i / x) * (Math.PI / 2);
		out[i] = long[i] * Math.sin(k) + long[n + i] * Math.cos(k);
	}
	return out;
}

function loopNormalise(out: Float32Array): Float32Array {
	let peak = 0;
	for (let i = 0; i < out.length; i++) peak = Math.max(peak, Math.abs(out[i]));
	if (peak > 0) for (let i = 0; i < out.length; i++) out[i] *= PEAK / peak;
	return out;
}

// --- Recipes -------------------------------------------------------------------

type Recipe = (random: () => number, variant: number) => Float32Array;

const RECIPES: Readonly<Record<SoundId, Recipe>> = {
	'step-soil': (random, v) => {
		const out = samples(0.14);
		addNoise(out, random, new Biquad('lowpass', 650 + v * 60, 0.7), null, 0.7, 1, (t) =>
			envelope(t, 0, 0.002, 0.025)
		);
		addTone(out, 0, 95 + v * 6, 55, 0.05, 0.6, 0.002, 0.03);
		addCrackle(out, random, 2600, 400, 0.02, 0.25);
		return out;
	},
	'step-grass': (random, v) => {
		const out = samples(0.18);
		addNoise(out, random, new Biquad('bandpass', 3000, 0.8), null, 0.8, 1, (t) =>
			Math.max(envelope(t, 0, 0.006, 0.03), 0.7 * envelope(t, 0.035 + v * 0.006, 0.006, 0.035))
		);
		addNoise(out, random, new Biquad('lowpass', 500, 0.7), null, 0.7, 0.35, (t) =>
			envelope(t, 0, 0.002, 0.02)
		);
		return out;
	},
	'step-leaves': (random, v) => {
		const out = samples(0.24);
		addCrackle(out, random, 2400 + v * 200, 900, 0.06, 1);
		addNoise(out, random, new Biquad('lowpass', 1500, 0.7), null, 0.7, 0.3, (t) =>
			envelope(t, 0, 0.004, 0.05)
		);
		return out;
	},
	'step-rock': (random, v) => {
		const out = samples(0.11);
		addNoise(out, random, new Biquad('highpass', 3000, 0.7), null, 0.7, 0.8, (t) =>
			envelope(t, 0, 0.0005, 0.002)
		);
		addNoise(out, random, new Biquad('bandpass', 1800 + v * 150, 4), null, 4, 1.4, (t) =>
			envelope(t, 0, 0.001, 0.012)
		);
		addTone(out, 0, 950 + v * 40, 900, 0.02, 0.2, 0.001, 0.02);
		addTone(out, 0, 120, 90, 0.02, 0.35, 0.001, 0.015);
		return out;
	},
	'step-wood': (random, v) => {
		const out = samples(0.2);
		const detune = 1 + (v - 1) * 0.04;
		addTone(out, 0, 210 * detune, 200 * detune, 0.03, 0.6, 0.001, 0.05);
		addTone(out, 0, 460 * detune, 455 * detune, 0.03, 0.3, 0.001, 0.03);
		addTone(out, 0, 780 * detune, 780 * detune, 0, 0.15, 0.001, 0.02);
		addNoise(out, random, new Biquad('highpass', 2000, 0.7), null, 0.7, 0.4, (t) =>
			envelope(t, 0, 0.0005, 0.003)
		);
		return out;
	},
	'step-water': (random, v) => {
		const out = samples(0.26);
		addNoise(
			out,
			random,
			new Biquad('lowpass', 2500, 0.8),
			(t) => 2500 * (600 / 2500) ** Math.min(1, t / 0.2),
			0.8,
			1,
			(t) => envelope(t, 0, 0.004, 0.05)
		);
		addTone(out, 0.03 + v * 0.01, 350 + v * 50, 900 + v * 80, 0.06, 0.35, 0.003, 0.03);
		return out;
	},
	jump: (random) => {
		const out = samples(0.24);
		addNoise(
			out,
			random,
			new Biquad('bandpass', 600, 1.5),
			(t) => 600 * (2200 / 600) ** Math.min(1, t / 0.15),
			1.5,
			1,
			(t) => envelope(t, 0, 0.02, 0.06)
		);
		addTone(out, 0, 260, 420, 0.1, 0.15, 0.01, 0.05);
		return out;
	},
	land: (random) => {
		const out = samples(0.28);
		addTone(out, 0, 78, 48, 0.08, 1, 0.002, 0.06);
		addNoise(out, random, new Biquad('lowpass', 500, 0.7), null, 0.7, 0.6, (t) =>
			envelope(t, 0, 0.002, 0.04)
		);
		addCrackle(out, random, 2200, 300, 0.04, 0.2);
		return out;
	},
	splash: (random, v) => {
		const out = samples(0.75);
		addNoise(
			out,
			random,
			new Biquad('lowpass', 4000, 0.8),
			(t) => 4000 * (700 / 4000) ** Math.min(1, t / 0.5),
			0.8,
			1,
			(t) => envelope(t, 0, 0.005, 0.15)
		);
		for (let b = 0; b < 5; b++) {
			const start = 0.05 + random() * 0.35;
			const f0 = 400 + random() * 500 + v * 30;
			addTone(out, start, f0, f0 * 2, 0.04, 0.25, 0.002, 0.03);
		}
		return out;
	},
	collect: () => {
		const out = samples(0.7);
		// "Plim": E6 then B6, each a bell-ish sine with two inharmonic partials.
		for (const [start, f] of [
			[0, 1318.5],
			[0.07, 1975.5]
		] as const) {
			addTone(out, start, f, f, 0, 0.35, 0.002, 0.14);
			addTone(out, start, f * 2.76, f * 2.76, 0, 0.1, 0.002, 0.05);
			addTone(out, start, f * 5.4, f * 5.4, 0, 0.04, 0.001, 0.02);
		}
		return out;
	},
	checkpoint: () => {
		const out = samples(1.7);
		// C major arpeggio C5 E5 G5 C6, soft bells.
		const notes = [523.25, 659.25, 783.99, 1046.5];
		notes.forEach((f, k) => {
			const start = k * 0.09;
			addTone(out, start, f, f, 0, 0.22, 0.004, 0.45);
			addTone(out, start, f * 2.01, f * 2.01, 0, 0.08, 0.004, 0.2);
			addTone(out, start, f * 3, f * 3, 0, 0.03, 0.002, 0.08);
		});
		return out;
	},
	'ui-tap': (random) => {
		const out = samples(0.07);
		addTone(out, 0, 1100, 900, 0.03, 0.4, 0.001, 0.012);
		addNoise(out, random, new Biquad('highpass', 4000, 0.7), null, 0.7, 0.2, (t) =>
			envelope(t, 0, 0.0003, 0.001)
		);
		return out;
	},
	'radio-call': (random) => {
		const out = samples(0.24);
		const click = (at: number) =>
			addNoise(out, random, new Biquad('highpass', 2500, 0.7), null, 0.7, 1, (t) =>
				envelope(t, at, 0.0003, 0.002)
			);
		click(0);
		// Squelch: band-limited hiss with a fast flutter, between the two clicks.
		addNoise(out, random, new Biquad('bandpass', 2000, 2), null, 2, 0.5, (t) =>
			t > 0.01 && t < 0.17 ? 0.7 + 0.3 * Math.sin(TAU * 37 * t) : 0
		);
		click(0.17);
		return out;
	},
	'forest-day': (random) => {
		const length = 16;
		const overlap = 0.6;
		const out = samples(length + overlap);
		// Wind: brown-ish noise under a slow swell (two incommensurate sines).
		const wind = new Biquad('lowpass', 900, 0.6);
		const body = new Biquad('lowpass', 250, 0.6);
		for (let i = 0; i < out.length; i++) {
			const t = i / SYNTH_RATE;
			const swell = 0.6 + 0.25 * Math.sin(TAU * 0.07 * t) + 0.15 * Math.sin(TAU * 0.13 * t + 1.3);
			const white = random() * 2 - 1;
			out[i] += (wind.run(white) * 0.5 + body.run(white) * 1.2) * swell;
		}
		// Leaves high in the canopy: hiss gated by a slow, cubed swell.
		addNoise(out, random, new Biquad('bandpass', 3500, 0.9), null, 0.9, 0.08, (t) => {
			const s = 0.5 + 0.5 * Math.sin(TAU * 0.19 * t + 0.4);
			return s * s * s;
		});
		// Sparse bird-like chirps: 7 groups, away from the loop seam.
		for (let g = 0; g < 7; g++) {
			const at = 0.8 + (g + random() * 0.8) * ((length - 2.6) / 7);
			const base = 2400 + random() * 1400;
			const span = 500 + random() * 900;
			const count = 2 + Math.floor(random() * 3);
			const gap = 0.09 + random() * 0.05;
			const amp = 0.25 + random() * 0.15;
			for (let c = 0; c < count; c++) {
				const start = at + c * gap;
				const duration = 0.06 + random() * 0.04;
				let phase = 0;
				const first = Math.floor(start * SYNTH_RATE);
				const last = Math.min(out.length, first + Math.floor(duration * SYNTH_RATE));
				for (let i = first; i < last; i++) {
					const u = (i - first) / (last - first);
					phase += (TAU * (base + span * Math.sin(Math.PI * u))) / SYNTH_RATE;
					const window = Math.sin(Math.PI * u);
					out[i] += Math.sin(phase) * amp * window * window;
				}
			}
		}
		return loopNormalise(seamless(out, overlap));
	},
	river: (random) => {
		const length = 6;
		const overlap = 0.5;
		const out = samples(length + overlap);
		const low = new Biquad('lowpass', 900, 0.7);
		const mid = new Biquad('bandpass', 2200, 0.7);
		// Slow random flow: smoothed noise at a few hertz.
		const flow = new Biquad('lowpass', 3, 0.7);
		for (let i = 0; i < out.length; i++) {
			const white = random() * 2 - 1;
			const swell = 1 + Math.max(-0.6, Math.min(0.6, flow.run(random() * 2 - 1) * 40));
			out[i] += (low.run(white) * 0.9 + mid.run(white) * 0.35) * swell;
		}
		// Gurgles.
		for (let b = 0; b < 14; b++) {
			const start = 0.2 + random() * (length - 0.6);
			const f0 = 250 + random() * 300;
			addTone(out, start, f0, f0 * 1.8, 0.05, 0.05, 0.004, 0.03);
		}
		return loopNormalise(seamless(out, overlap));
	},
	waterfall: (random) => {
		const length = 8;
		const overlap = 0.6;
		const out = samples(length + overlap);
		// Dense falling water: bright hiss over a low roar, with a slow, shallow swell.
		const hiss = new Biquad('bandpass', 2600, 0.5);
		const roar = new Biquad('lowpass', 350, 0.7);
		for (let i = 0; i < out.length; i++) {
			const t = i / SYNTH_RATE;
			const swell = 0.85 + 0.1 * Math.sin(TAU * 0.11 * t) + 0.05 * Math.sin(TAU * 0.29 * t + 2);
			const white = random() * 2 - 1;
			out[i] += (hiss.run(white) * 0.7 + roar.run(white) * 1.4) * swell;
		}
		return loopNormalise(seamless(out, overlap));
	},
	chainsaw: (random) => {
		const length = 6;
		const overlap = 0.5;
		const out = samples(length + overlap);
		// A two-stroke engine far away: a buzzy sawtooth whose speed rises and falls, muffled by distance.
		const muffle = new Biquad('lowpass', 1200, 0.7);
		const air = new Biquad('lowpass', 2500, 0.7);
		let phase = 0;
		for (let i = 0; i < out.length; i++) {
			const t = i / SYNTH_RATE;
			// Two revs per loop: idle at 70 Hz, cutting at 130 Hz.
			const rev = Math.max(0, Math.sin((TAU * t) / (length / 2)));
			const frequency = 70 + 60 * rev * rev;
			phase = (phase + frequency / SYNTH_RATE) % 1;
			const saw = phase * 2 - 1;
			out[i] += muffle.run(saw * (0.5 + 0.5 * rev)) + air.run(random() * 2 - 1) * 0.12;
		}
		return loopNormalise(seamless(out, overlap));
	},
	'mission-complete': () => {
		const out = samples(1.6);
		// G major run G5 B5 D6, then a held G6 chord (G, B, D) of soft bells.
		[783.99, 987.77, 1174.66].forEach((f, k) => {
			addTone(out, k * 0.11, f, f, 0, 0.2, 0.004, 0.18);
			addTone(out, k * 0.11, f * 2.01, f * 2.01, 0, 0.06, 0.004, 0.08);
		});
		for (const f of [1567.98, 1975.53, 2349.32]) {
			addTone(out, 0.36, f, f, 0, 0.16, 0.006, 0.4);
			addTone(out, 0.36, f * 2.76, f * 2.76, 0, 0.03, 0.004, 0.12);
		}
		return out;
	},
	badge: () => {
		const out = samples(1.3);
		// A quick pentatonic sparkle upward (C6 D6 E6 G6 A6 C7) and a shimmer on top.
		[1046.5, 1174.66, 1318.51, 1567.98, 1760, 2093].forEach((f, k) => {
			addTone(out, k * 0.06, f, f, 0, 0.18, 0.002, 0.12);
			addTone(out, k * 0.06, f * 2.76, f * 2.76, 0, 0.04, 0.002, 0.05);
		});
		addTone(out, 0.36, 2093, 2093, 0, 0.12, 0.01, 0.35);
		addTone(out, 0.36, 3135.96, 3135.96, 0, 0.06, 0.01, 0.3);
		return out;
	},
	howler: (random, v) => {
		const out = samples(1.6);
		// A deep, throaty roar: a buzzy 110 Hz source through two vocal-tract formants, pulsing a few times a second.
		const low = new Biquad('bandpass', 500 + v * 40, 2.5);
		const high = new Biquad('bandpass', 1100, 3);
		let phase = 0;
		for (let i = 0; i < out.length; i++) {
			const t = i / SYNTH_RATE;
			phase = (phase + (105 + 10 * Math.sin(TAU * 0.8 * t)) / SYNTH_RATE) % 1;
			const buzz = phase * 2 - 1 + (random() * 2 - 1) * 0.35;
			const pulse = 0.55 + 0.45 * Math.sin(TAU * (2.6 + v * 0.3) * t) ** 2;
			const swell = Math.min(1, t / 0.25) * Math.min(1, (1.6 - t) / 0.4);
			out[i] += (low.run(buzz) * 1.2 + high.run(buzz) * 0.5) * pulse * swell;
		}
		return out;
	},
	muriqui: (random, v) => {
		const out = samples(1.4);
		// The "neigh": a run of short whistled chirps gliding down, a little breath under each.
		for (let c = 0; c < 6; c++) {
			const start = 0.05 + c * (0.2 + v * 0.02) + random() * 0.03;
			const f0 = 2600 - c * 120 + random() * 200;
			addTone(out, start, f0, f0 * 0.6, 0.12, 0.35, 0.01, 0.06);
			addTone(out, start, f0 * 2, f0 * 1.2, 0.12, 0.08, 0.01, 0.04);
		}
		addNoise(out, random, new Biquad('bandpass', 2000, 1.5), null, 1.5, 0.08, (t) =>
			Math.max(0, 1 - t / 1.35)
		);
		return out;
	},
	toucan: (random, v) => {
		const out = samples(1);
		// Croaked "kree-ok" calls: a pulsed nasal tone around 2.4 kHz, twice.
		for (const start of [0.05, 0.5 + v * 0.05]) {
			const band = new Biquad('bandpass', 2400, 4);
			let phase = 0;
			const first = Math.floor(start * SYNTH_RATE);
			const last = Math.min(out.length, first + Math.floor(0.28 * SYNTH_RATE));
			for (let i = first; i < last; i++) {
				const u = (i - first) / (last - first);
				phase += (TAU * (620 - 120 * u)) / SYNTH_RATE;
				const rasp = Math.sign(Math.sin(phase)) * 0.6 + (random() * 2 - 1) * 0.4;
				out[i] += band.run(rasp) * Math.sin(Math.PI * u) * 2.5;
			}
		}
		return out;
	},
	tamarin: (_random, v) => {
		const out = samples(1.5);
		// Long call: clear whistles rising from 5 to 7 kHz, then a trill.
		for (let c = 0; c < 4; c++) {
			const start = 0.05 + c * 0.22;
			const f0 = 5000 + c * 400 + v * 150;
			addTone(out, start, f0, f0 * 1.15, 0.15, 0.3, 0.02, 0.07);
		}
		const first = Math.floor(0.95 * SYNTH_RATE);
		let phase = 0;
		for (let i = first; i < out.length; i++) {
			const local = (i - first) / SYNTH_RATE;
			const f = 6500 + 500 * Math.sin(TAU * 18 * local);
			phase += (TAU * f) / SYNTH_RATE;
			out[i] += Math.sin(phase) * 0.25 * envelope(local, 0, 0.03, 0.15);
		}
		return out;
	}
};

/** Variants rendered per id (picked at random per play, before the pitch jitter). */
export const SYNTH_VARIANTS: Readonly<Record<SoundId, number>> = {
	'step-soil': 3,
	'step-grass': 3,
	'step-leaves': 3,
	'step-rock': 3,
	'step-wood': 3,
	'step-water': 3,
	jump: 1,
	land: 1,
	splash: 2,
	collect: 1,
	checkpoint: 1,
	'ui-tap': 1,
	'radio-call': 1,
	'forest-day': 1,
	river: 1,
	waterfall: 1,
	chainsaw: 1,
	'mission-complete': 1,
	badge: 1,
	howler: 2,
	muriqui: 2,
	toucan: 2,
	tamarin: 2
};

/**
 * Per-id attenuation (dB) that brings a placeholder to the loudness of its
 * recording (measured with the same BS.1770 metric: short-term for one-shots,
 * integrated for loops), so a file that fails to load does not come back
 * louder than the mix expects. Only cuts: a placeholder quieter than its
 * recording stays at its normalised peak.
 */
export const SYNTH_TRIM_DB: Readonly<Record<SoundId, number>> = {
	'step-soil': 0,
	'step-grass': -11,
	'step-leaves': 0,
	'step-rock': 0,
	'step-wood': -6,
	'step-water': -4.5,
	jump: 0,
	land: -0.5,
	splash: -7.5,
	collect: -7,
	checkpoint: 0,
	'ui-tap': -9,
	'radio-call': 0,
	'forest-day': -5.5,
	river: -10,
	waterfall: -13.5,
	chainsaw: -8,
	'mission-complete': -0.5,
	badge: -1,
	howler: -1,
	muriqui: -9,
	toucan: -5,
	tamarin: -11
};

/** Ids that are loops: rendered seamless and normalised as a whole. */
export const SYNTH_LOOPS: ReadonlySet<SoundId> = new Set<SoundId>([
	'forest-day',
	'river',
	'waterfall',
	'chainsaw'
]);

function seedOf(id: SoundId, variant: number): number {
	let hash = 0x811c9dc5;
	for (let i = 0; i < id.length; i++) hash = Math.imul(hash ^ id.charCodeAt(i), 0x01000193);
	return (hash ^ Math.imul(variant + 1, 0x9e3779b1)) >>> 0;
}

/** Renders one variant of an id's placeholder: mono samples at SYNTH_RATE. */
export function renderPlaceholder(id: SoundId, variant = 0): Float32Array {
	const out = RECIPES[id](generator(seedOf(id, variant)), variant);
	const level = SYNTH_LOOPS.has(id) ? out : normalise(out);
	const trim = 10 ** (SYNTH_TRIM_DB[id] / 20);
	if (trim !== 1) for (let i = 0; i < level.length; i++) level[i] *= trim;
	return level;
}
