/**
 * Sounds synthesized with Web Audio: no files to download, so they work
 * offline. Adapted from services/soundService.ts in the React app.
 */

export type Sound = 'tap' | 'open' | 'point' | 'unpoint' | 'mission' | 'achievement' | 'time-up';

let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
	if (typeof window === 'undefined' || !('AudioContext' in window)) return null;
	ctx ??= new AudioContext();
	if (ctx.state === 'suspended') void ctx.resume();
	return ctx;
}

function note(freq: number, start: number, duration: number, type: OscillatorType = 'sine', volume = 0.06) {
	if (!ctx) return;
	const osc = ctx.createOscillator();
	const gain = ctx.createGain();
	osc.connect(gain);
	gain.connect(ctx.destination);
	osc.type = type;
	osc.frequency.setValueAtTime(freq, start);
	gain.gain.setValueAtTime(volume, start);
	gain.gain.exponentialRampToValueAtTime(0.001, start + duration);
	osc.start(start);
	osc.stop(start + duration);
}

function glide(from: number, to: number, duration: number, type: OscillatorType = 'triangle') {
	if (!ctx) return;
	const now = ctx.currentTime;
	const osc = ctx.createOscillator();
	const gain = ctx.createGain();
	osc.connect(gain);
	gain.connect(ctx.destination);
	osc.type = type;
	osc.frequency.setValueAtTime(from, now);
	osc.frequency.linearRampToValueAtTime(to, now + duration);
	gain.gain.setValueAtTime(0.05, now);
	gain.gain.linearRampToValueAtTime(0, now + duration);
	osc.start(now);
	osc.stop(now + duration);
}

export function play(sound: Sound) {
	try {
		const a = audio();
		if (!a) return;
		const t = a.currentTime;
		switch (sound) {
			case 'tap':
				note(800, t, 0.08, 'sine', 0.04);
				break;
			case 'open':
				glide(300, 600, 0.15);
				break;
			case 'point':
				note(660, t, 0.07, 'triangle');
				note(990, t + 0.06, 0.12, 'triangle');
				break;
			case 'unpoint':
				glide(420, 260, 0.14);
				break;
			case 'mission':
				note(523.25, t, 0.12, 'triangle');
				note(659.25, t + 0.1, 0.12, 'triangle');
				note(783.99, t + 0.2, 0.3, 'triangle');
				break;
			case 'achievement':
				note(523.25, t, 0.1, 'square', 0.04);
				note(523.25, t + 0.1, 0.1, 'square', 0.04);
				note(523.25, t + 0.2, 0.1, 'square', 0.04);
				note(659.25, t + 0.3, 0.45, 'square', 0.04);
				note(523.25, t + 0.3, 0.45, 'sine');
				break;
			case 'time-up':
				note(880, t, 0.25, 'sine', 0.08);
				note(880, t + 0.35, 0.25, 'sine', 0.08);
				note(1174.66, t + 0.7, 0.5, 'sine', 0.08);
				break;
		}
	} catch {
		// Sound is decoration: if the browser blocks it, the journey goes on silently.
	}
}
