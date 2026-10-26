import { GRAVITY } from '../engine/constants.ts';
import { copy, distance, type Vec3, validPoint } from './common.ts';
export interface ZiplineSpec {
	id: string /** Rider feet at each station; the visual cable is 3 u higher. */;
	start: Vec3;
	end: Vec3;
}
export class Zipline {
	phase: 'idle' | 'riding' | 'arrived' = 'idle';
	readonly position: Vec3 = { x: 0, y: 0, z: 0 };
	readonly length: number;
	progress = 0;
	speed = 0;
	constructor(readonly spec: ZiplineSpec) {
		this.length = distance(spec.start, spec.end);
		if (!validPoint(spec.start) || !validPoint(spec.end) || this.length < 1 || spec.start.y <= spec.end.y)
			throw new Error('Zipline needs a downhill segment');
		copy(this.position, spec.start);
	}
	get remaining() {
		return this.length - this.progress;
	}
	start(unlocked: boolean) {
		if (!unlocked || this.phase === 'riding') return false;
		this.phase = 'riding';
		this.progress = 0;
		this.speed = 2;
		copy(this.position, this.spec.start);
		return true;
	}
	/** Jump is intentionally not an input: the rider stays attached until arrival. */
	step(dt: number) {
		if (this.phase !== 'riding') return;
		const gravity = (GRAVITY * (this.spec.start.y - this.spec.end.y)) / this.length;
		const brakeLimit = Math.sqrt(2 * 10 * Math.max(0, this.remaining));
		this.speed = Math.min(
			11,
			this.speed + (gravity - 0.07 * this.speed * this.speed) * dt,
			this.remaining <= 6 ? Math.max(0.7, brakeLimit) : 11
		);
		this.progress = Math.min(this.length, this.progress + this.speed * dt);
		const t = this.progress / this.length;
		this.position.x = this.spec.start.x + (this.spec.end.x - this.spec.start.x) * t;
		this.position.y = this.spec.start.y + (this.spec.end.y - this.spec.start.y) * t;
		this.position.z = this.spec.start.z + (this.spec.end.z - this.spec.start.z) * t;
		if (this.progress >= this.length) {
			copy(this.position, this.spec.end);
			this.speed = 0;
			this.phase = 'arrived';
		}
	}
}
