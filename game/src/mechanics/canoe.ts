import { axis, clamp, copy, distance, type Vec3, validPoint } from './common.ts';
export interface Landing {
	id: string;
	water: Vec3;
	exit: Vec3;
}
export interface CanoeSpec {
	id: string;
	channel: readonly Vec3[] /** Includes a 1 u hull clearance. */;
	halfWidth: number;
	landings: readonly Landing[];
	currentSpeed?: number;
}
/** A polyline channel, with a current along the nearest segment and a clamped circular hull. */
export class Canoe {
	phase: 'moored' | 'rowing' = 'moored';
	readonly position: Vec3 = { x: 0, y: 0, z: 0 };
	yaw = 0;
	speed = 0;
	stroke = 0;
	readonly current: Vec3 = { x: 0, y: 0, z: 0 };
	readonly #nearest: Vec3 = { x: 0, y: 0, z: 0 };
	constructor(readonly spec: CanoeSpec) {
		if (
			spec.channel.length < 2 ||
			spec.landings.length < 1 ||
			!Number.isFinite(spec.halfWidth) ||
			spec.halfWidth <= 1 ||
			spec.channel.some((p) => !validPoint(p))
		)
			throw new Error('Invalid canoe channel');
		for (let i = 1; i < spec.channel.length; i++)
			if (
				Math.hypot(spec.channel[i].x - spec.channel[i - 1].x, spec.channel[i].z - spec.channel[i - 1].z) <
				0.01
			)
				throw new Error('Degenerate channel segment');
		copy(this.position, spec.landings[0].water);
		this.#project(this.position);
		this.yaw = Math.atan2(this.current.x, this.current.z);
	}
	board(p: Vec3) {
		if (this.phase === 'rowing' || distance(p, this.position) > 3) return false;
		for (const l of this.spec.landings)
			if (distance(p, l.exit) <= 3 && distance(this.position, l.water) <= 3) {
				this.phase = 'rowing';
				return true;
			}
		return false;
	}
	leave() {
		if (this.phase !== 'rowing') return false;
		for (const l of this.spec.landings)
			if (distance(this.position, l.water) <= 2.5) {
				copy(this.position, l.exit);
				this.phase = 'moored';
				this.speed = 0;
				return true;
			}
		return false;
	}
	/** Put the hull back on its water anchor after the avatar has copied the dismount feet. */
	moor() {
		if (this.phase !== 'moored') return;
		for (const l of this.spec.landings)
			if (distance(this.position, l.exit) < 0.01) {
				copy(this.position, l.water);
				return;
			}
	}
	distanceFromChannel(p: Vec3) {
		this.#project(p);
		return Math.hypot(p.x - this.#nearest.x, p.z - this.#nearest.z);
	}
	step(dt: number, forward: number, turn: number) {
		if (this.phase !== 'rowing') return;
		this.yaw -= axis(turn) * 1.5 * dt;
		this.speed += (axis(forward) * 4 - this.speed) * (1 - Math.exp(-4 * dt));
		this.stroke += Math.abs(axis(forward)) * dt * 5;
		this.#project(this.position);
		const flow = clamp(this.spec.currentSpeed ?? 0.35, 0, 0.8);
		this.position.x += (Math.sin(this.yaw) * this.speed + this.current.x * flow) * dt;
		this.position.z += (Math.cos(this.yaw) * this.speed + this.current.z * flow) * dt;
		const d = this.distanceFromChannel(this.position),
			limit = this.spec.halfWidth - 1;
		if (d > limit) {
			const k = limit / d;
			this.position.x = this.#nearest.x + (this.position.x - this.#nearest.x) * k;
			this.position.z = this.#nearest.z + (this.position.z - this.#nearest.z) * k;
		}
		this.position.y = this.#nearest.y;
	}
	#project(p: Vec3) {
		let best = Infinity;
		const channel = this.spec.channel;
		for (let i = 1; i < channel.length; i++) {
			const a = channel[i - 1],
				b = channel[i],
				x = b.x - a.x,
				z = b.z - a.z,
				len = x * x + z * z;
			const t = clamp(((p.x - a.x) * x + (p.z - a.z) * z) / len, 0, 1),
				nx = a.x + x * t,
				nz = a.z + z * t,
				d = (p.x - nx) ** 2 + (p.z - nz) ** 2;
			if (d >= best) continue;
			best = d;
			this.#nearest.x = nx;
			this.#nearest.y = a.y + (b.y - a.y) * t;
			this.#nearest.z = nz;
			const norm = Math.sqrt(len);
			this.current.x = x / norm;
			this.current.z = z / norm;
		}
	}
}
