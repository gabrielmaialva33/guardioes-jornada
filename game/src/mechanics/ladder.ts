import { axis, clamp, copy, distance, type Vec3, validPoint } from './common.ts';
export interface LadderSpec {
	id: string;
	base: Vec3;
	top: Vec3 /** Feet on the platform, clear of the ladder and rails. */;
	exit: Vec3;
	radius: number;
	/** World units; shared by the mesh and the avatar cadence. Defaults to 0.45. */
	rungSpacing?: number;
	/** Height of the first rung above base; defaults to 0.3 u. */
	rungOffset?: number;
}
/** Pure fixed-tick state. Points and output are feet positions; no renderer or clock ownership. */
export class Ladder {
	phase: 'idle' | 'climbing' | 'top' | 'bottom' | 'detached' = 'idle';
	readonly position: Vec3 = { x: 0, y: 0, z: 0 };
	cooldown = 0;
	readonly rungSpacing: number;
	readonly rungOffset: number;
	constructor(readonly spec: LadderSpec) {
		this.rungSpacing = spec.rungSpacing ?? 0.45;
		this.rungOffset = spec.rungOffset ?? 0.3;
		if (
			!Number.isFinite(this.rungSpacing) ||
			this.rungSpacing < 0.1 ||
			!Number.isFinite(this.rungOffset) ||
			this.rungOffset < 0 ||
			!validPoint(spec.base) ||
			!validPoint(spec.top) ||
			!validPoint(spec.exit) ||
			spec.top.y <= spec.base.y ||
			!Number.isFinite(spec.radius) ||
			spec.radius <= 0
		)
			throw new Error('Invalid ladder');
	}
	contains(p: Vec3) {
		return (
			Math.hypot(p.x - this.spec.base.x, p.z - this.spec.base.z) <= this.spec.radius &&
			p.y >= this.spec.base.y - 0.4 &&
			p.y <= this.spec.top.y + 0.4
		);
	}
	enter(p: Vec3) {
		if (
			this.cooldown > 0 ||
			this.phase === 'climbing' ||
			(!this.contains(p) && distance(p, this.spec.exit) > this.spec.radius)
		)
			return false;
		copy(this.position, this.spec.base);
		this.position.y = clamp(p.y, this.spec.base.y, this.spec.top.y);
		this.phase = 'climbing';
		return true;
	}
	step(dt: number, forward: number, jump: boolean, walkSpeed: number) {
		this.cooldown = Math.max(0, this.cooldown - dt);
		if (this.phase !== 'climbing') return;
		if (jump) {
			this.phase = 'detached';
			this.cooldown = 0.4;
			return;
		}
		const speed = axis(forward) * walkSpeed * 0.5;
		this.position.y = clamp(this.position.y + speed * dt, this.spec.base.y, this.spec.top.y);
		if (speed > 0 && this.position.y >= this.spec.top.y) {
			copy(this.position, this.spec.exit);
			this.phase = 'top';
			this.cooldown = 0.4;
		}
		if (speed < 0 && this.position.y <= this.spec.base.y) {
			this.phase = 'bottom';
			this.cooldown = 0.4;
		}
	}
}
