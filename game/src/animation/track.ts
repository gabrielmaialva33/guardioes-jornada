/**
 * Key poses over time, sampled straight into a blend target with a weight, so
 * blending N tracks costs N samples and no scratch pose.
 *
 * - A looping track is a cycle: its key times are fractions in [0, 1) and it is
 *   sampled by phase (a distance-driven stride or time / period).
 * - A one-shot track (emotes) has key times in seconds and holds its last key.
 *
 * Cubic tracks use uniform Catmull-Rom between keys (Rosen's "cubic between key
 * poses", no velocity jumps at the keys); smooth tracks ease in and out of every
 * key, which keeps holds still and suits pose-to-pose gestures.
 */
import { JOINT_STRIDE, type Layout } from './skeleton.ts';

export type Interpolation = 'cubic' | 'smooth';

export interface TrackOptions {
	loop: boolean;
	interpolation: Interpolation;
	/**
	 * Seconds per cycle at 1× for loops (time-driven loops divide by it), or the
	 * duration of a one-shot track, which must be at least its last key time.
	 */
	period: number;
}

export class Track {
	readonly keyCount: number;
	readonly width: number;
	readonly loop: boolean;
	readonly cubic: boolean;
	readonly period: number;
	readonly #keys: Float64Array;
	readonly #times: Float64Array;

	constructor(
		layout: Layout,
		keys: readonly Float64Array[],
		times: readonly number[],
		options: TrackOptions
	) {
		const width = layout.joints.length * JOINT_STRIDE;
		if (keys.length === 0 || keys.length !== times.length) throw new Error('Track needs one time per key');
		for (let i = 0; i < keys.length; i++) {
			if (keys[i].length !== width) throw new Error('Track key does not match the layout');
			if (i > 0 && !(times[i] > times[i - 1])) throw new Error('Track times must increase');
		}
		if (options.loop && (times[0] !== 0 || times[times.length - 1] >= 1))
			throw new Error('Loop times are fractions in [0, 1) starting at 0');
		this.keyCount = keys.length;
		this.width = width;
		this.loop = options.loop;
		this.cubic = options.interpolation === 'cubic';
		this.period = options.period;
		this.#keys = new Float64Array(keys.length * width);
		keys.forEach((key, i) => {
			this.#keys.set(key, i * width);
		});
		this.#times = Float64Array.from(times);
	}

	/**
	 * Adds `weight` × the pose at `time` into `out`: a cycle fraction (any real,
	 * wrapped) for loops, seconds (clamped) for one-shot tracks.
	 */
	sampleInto(out: Float64Array, time: number, weight: number) {
		if (!(weight > 0)) return;
		const keys = this.#keys;
		const times = this.#times;
		const n = this.keyCount;
		const width = this.width;
		if (n === 1 || !Number.isFinite(time)) {
			for (let k = 0; k < width; k++) out[k] += weight * keys[k];
			return;
		}

		let t = time;
		if (this.loop) t -= Math.floor(t);
		else if (t <= times[0]) t = times[0];
		else if (t >= times[n - 1]) {
			const last = (n - 1) * width;
			for (let k = 0; k < width; k++) out[k] += weight * keys[last + k];
			return;
		}

		let i = 0;
		while (i < n - 1 && t >= times[i + 1]) i++;
		const next = i + 1 < n ? i + 1 : 0;
		const end = i + 1 < n ? times[i + 1] : 1;
		const span = end - times[i];
		const u = span > 0 ? (t - times[i]) / span : 0;
		const a = i * width;
		const b = next * width;

		if (!this.cubic) {
			const s = u * u * (3 - 2 * u);
			const wa = weight * (1 - s);
			const wb = weight * s;
			for (let k = 0; k < width; k++) out[k] += wa * keys[a + k] + wb * keys[b + k];
			return;
		}

		const before = (this.loop ? (i - 1 + n) % n : Math.max(i - 1, 0)) * width;
		const after = (this.loop ? (next + 1) % n : Math.min(next + 1, n - 1)) * width;
		const u2 = u * u;
		const u3 = u2 * u;
		const w0 = weight * 0.5 * (-u3 + 2 * u2 - u);
		const w1 = weight * 0.5 * (3 * u3 - 5 * u2 + 2);
		const w2 = weight * 0.5 * (-3 * u3 + 4 * u2 + u);
		const w3 = weight * 0.5 * (u3 - u2);
		for (let k = 0; k < width; k++)
			out[k] += w0 * keys[before + k] + w1 * keys[a + k] + w2 * keys[b + k] + w3 * keys[after + k];
	}
}
