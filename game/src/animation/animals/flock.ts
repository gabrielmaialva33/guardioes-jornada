/**
 * Boids on the CPU for butterflies and small birds (Reynolds 1987, "Flocks,
 * herds and schools", SIGGRAPH): separation, alignment and cohesion with an
 * O(n²) neighbourhood, which is trivial below ~100 agents (animacoes.md §5.2:
 * 50 agents = 2,500 checks), plus a smooth wander and a soft box. All state is
 * in fixed-size typed arrays; update() allocates nothing.
 *
 * Integration is semi-implicit Euler in substeps of at most 1/60 s, speeds are
 * clamped to [minSpeed, maxSpeed] and positions are clamped to the box with the
 * velocity reflected, so agents stay inside the bounds at any frame rate; a
 * non-finite agent (bad input) is put back in the middle of the box.
 *
 * The wings are not animated here: the wing-flap vertex shader (wing-flap.ts)
 * beats them from a per-instance phase, so a whole flock is one draw call.
 */
import { DEG, Rng, safeDt, TAU } from './scalar.ts';

export type FlockKind = 'butterfly' | 'bird';

export interface FlockParams {
	readonly minSpeed: number;
	readonly maxSpeed: number;
	/** Steering limit, u/s². */
	readonly maxAccel: number;
	/** Neighbour radius and personal-space radius, u. */
	readonly neighbourRadius: number;
	readonly separationRadius: number;
	readonly alignment: number;
	readonly cohesion: number;
	readonly separation: number;
	/** Pull back from the box walls inside this share of the box size. */
	readonly margin: number;
	readonly boundsWeight: number;
	/** Smooth wander: strength (u/s²) and rate (rad/s of the noise phases). */
	readonly wander: number;
	readonly wanderRate: number;
	/** Keeps flight level (birds) or not (butterflies bob), 1/s. */
	readonly level: number;
	/** Largest climb or dive angle, radians. */
	readonly maxPitch: number;
}

/**
 * Tuning per kind [engine]. Butterflies flutter erratically in loose groups
 * with little alignment; small birds (e.g. the saíras of Atlantic Forest mixed
 * flocks) fly faster, aligned and level.
 */
export const FLOCK_KINDS: Readonly<Record<FlockKind, FlockParams>> = {
	butterfly: {
		minSpeed: 0.5,
		maxSpeed: 1.8,
		maxAccel: 6,
		neighbourRadius: 1.5,
		separationRadius: 0.45,
		alignment: 0.3,
		cohesion: 0.25,
		separation: 2.5,
		margin: 0.2,
		boundsWeight: 6,
		wander: 4,
		wanderRate: 1.7,
		level: 0,
		maxPitch: 50 * DEG
	},
	bird: {
		minSpeed: 2.5,
		maxSpeed: 6,
		maxAccel: 12,
		neighbourRadius: 3,
		separationRadius: 0.7,
		alignment: 1.6,
		cohesion: 0.8,
		separation: 5,
		margin: 0.2,
		boundsWeight: 10,
		wander: 1.2,
		wanderRate: 0.6,
		level: 1.5,
		maxPitch: 25 * DEG
	}
};

/** Longest integration substep, seconds. */
export const FLOCK_SUBSTEP = 1 / 60;

export interface FlockOptions {
	kind: FlockKind;
	count: number;
	/** Box the flock lives in: min x, y, z then max x, y, z (world u). */
	bounds: readonly [number, number, number, number, number, number];
	seed?: number;
	/** Overrides of the kind's parameters. */
	params?: Partial<FlockParams>;
}

/**
 * The parameters as a class, so every flock's params share one hidden class and
 * one field layout: two plain objects whose fields mix small integers and
 * fractions make the shared steering code box numbers on every update (measured).
 */
class FlockSettings implements FlockParams {
	minSpeed = 0;
	maxSpeed = 0;
	maxAccel = 0;
	neighbourRadius = 0;
	separationRadius = 0;
	alignment = 0;
	cohesion = 0;
	separation = 0;
	margin = 0;
	boundsWeight = 0;
	wander = 0;
	wanderRate = 0;
	level = 0;
	maxPitch = 0;

	constructor(params: FlockParams) {
		this.minSpeed = params.minSpeed;
		this.maxSpeed = params.maxSpeed;
		this.maxAccel = params.maxAccel;
		this.neighbourRadius = params.neighbourRadius;
		this.separationRadius = params.separationRadius;
		this.alignment = params.alignment;
		this.cohesion = params.cohesion;
		this.separation = params.separation;
		this.margin = params.margin;
		this.boundsWeight = params.boundsWeight;
		this.wander = params.wander;
		this.wanderRate = params.wanderRate;
		this.level = params.level;
		this.maxPitch = params.maxPitch;
	}
}

export class Flock {
	readonly kind: FlockKind;
	readonly count: number;
	readonly params: FlockParams;
	/** Packed x, y, z per agent. */
	readonly position: Float32Array;
	readonly velocity: Float32Array;
	/** Per-agent wingbeat phase offset in cycles, for the shader's aFlapPhase attribute. */
	readonly phase: Float32Array;
	/** min x, y, z, max x, y, z. */
	readonly bounds = new Float32Array(6);
	/** Simulated time, seconds (also the shader's uFlapTime). */
	time = 0;
	readonly #wanderPhase: Float32Array;
	readonly #acceleration: Float32Array;
	#h = 0;

	constructor(options: FlockOptions) {
		const count = Math.max(0, Math.floor(options.count));
		this.kind = options.kind;
		this.count = count;
		this.params = new FlockSettings({ ...FLOCK_KINDS[options.kind], ...options.params });
		this.position = new Float32Array(count * 3);
		this.velocity = new Float32Array(count * 3);
		this.phase = new Float32Array(count);
		this.#wanderPhase = new Float32Array(count * 3);
		this.#acceleration = new Float32Array(count * 3);
		this.setBounds(options.bounds);
		const rng = new Rng(options.seed ?? 0xb01d);
		const b = this.bounds;
		const { minSpeed, maxSpeed } = this.params;
		for (let i = 0; i < count; i++) {
			const at = i * 3;
			for (let k = 0; k < 3; k++) this.position[at + k] = b[k] + (b[k + 3] - b[k]) * rng.range(0.25, 0.75);
			const heading = rng.range(0, TAU);
			const speed = rng.range(minSpeed, maxSpeed);
			this.velocity[at] = Math.sin(heading) * speed;
			this.velocity[at + 1] = 0;
			this.velocity[at + 2] = Math.cos(heading) * speed;
			this.phase[i] = rng.next();
			for (let k = 0; k < 3; k++) this.#wanderPhase[at + k] = rng.range(0, TAU);
		}
	}

	/** Moves the box (allocation-free). */
	setBounds(bounds: ArrayLike<number>) {
		for (let k = 0; k < 3; k++) {
			const lo = Number.isFinite(bounds[k]) ? bounds[k] : 0;
			const hi = Number.isFinite(bounds[k + 3]) ? bounds[k + 3] : lo;
			this.bounds[k] = Math.min(lo, hi);
			this.bounds[k + 3] = Math.max(lo, hi);
		}
	}

	/** Advances by `dt` seconds. */
	update(rawDt: number) {
		let left = safeDt(rawDt);
		while (left > 1e-9) {
			this.#h = Math.min(left, FLOCK_SUBSTEP);
			this.#steer();
			this.#integrate();
			left -= this.#h;
			this.time += this.#h;
		}
	}

	/** Steering accelerations for every agent from the current state. */
	#steer() {
		const p = this.params;
		const pos = this.position;
		const vel = this.velocity;
		const acc = this.#acceleration;
		const b = this.bounds;
		const n = this.count;
		const neighbour2 = p.neighbourRadius * p.neighbourRadius;
		const separation2 = p.separationRadius * p.separationRadius;
		const t = this.time;
		for (let i = 0; i < n; i++) {
			const ia = i * 3;
			const x = pos[ia];
			const y = pos[ia + 1];
			const z = pos[ia + 2];
			let cx = 0;
			let cy = 0;
			let cz = 0;
			let ax = 0;
			let ay = 0;
			let az = 0;
			let sx = 0;
			let sy = 0;
			let sz = 0;
			let neighbours = 0;
			for (let j = 0; j < n; j++) {
				if (j === i) continue;
				const ja = j * 3;
				const dx = pos[ja] - x;
				const dy = pos[ja + 1] - y;
				const dz = pos[ja + 2] - z;
				const d2 = dx * dx + dy * dy + dz * dz;
				if (d2 > neighbour2) continue;
				neighbours++;
				cx += dx;
				cy += dy;
				cz += dz;
				ax += vel[ja];
				ay += vel[ja + 1];
				az += vel[ja + 2];
				if (d2 < separation2 && d2 > 1e-8) {
					const push = 1 / d2;
					sx -= dx * push;
					sy -= dy * push;
					sz -= dz * push;
				}
			}
			let fx = 0;
			let fy = 0;
			let fz = 0;
			if (neighbours > 0) {
				const inv = 1 / neighbours;
				fx += cx * inv * p.cohesion + (ax * inv - vel[ia]) * p.alignment;
				fy += cy * inv * p.cohesion + (ay * inv - vel[ia + 1]) * p.alignment;
				fz += cz * inv * p.cohesion + (az * inv - vel[ia + 2]) * p.alignment;
				fx += sx * p.separation * p.separationRadius;
				fy += sy * p.separation * p.separationRadius;
				fz += sz * p.separation * p.separationRadius;
			}
			// Smooth wander: two incommensurate sines per axis, per-agent phases.
			const w = this.#wanderPhase;
			const rate = p.wanderRate;
			fx += p.wander * (Math.sin(t * rate + w[ia]) + 0.5 * Math.sin(t * rate * 2.7 + w[ia + 1]));
			fy += p.wander * 0.6 * Math.sin(t * rate * 1.6 + w[ia + 2]);
			fz += p.wander * (Math.cos(t * rate * 1.3 + w[ia + 1]) + 0.5 * Math.sin(t * rate * 2.3 + w[ia]));
			fy -= vel[ia + 1] * p.level;
			// Soft walls.
			for (let k = 0; k < 3; k++) {
				const lo = b[k];
				const hi = b[k + 3];
				const margin = Math.max(1e-3, (hi - lo) * p.margin);
				const at = pos[ia + k];
				let push = 0;
				if (at < lo + margin) push = (lo + margin - at) / margin;
				else if (at > hi - margin) push = -(at - (hi - margin)) / margin;
				const f = push * p.boundsWeight;
				if (k === 0) fx += f;
				else if (k === 1) fy += f;
				else fz += f;
			}
			const f = Math.sqrt(fx * fx + fy * fy + fz * fz);
			const limit = f > p.maxAccel ? p.maxAccel / f : 1;
			acc[ia] = fx * limit;
			acc[ia + 1] = fy * limit;
			acc[ia + 2] = fz * limit;
		}
	}

	#integrate() {
		const p = this.params;
		const pos = this.position;
		const vel = this.velocity;
		const acc = this.#acceleration;
		const b = this.bounds;
		const h = this.#h;
		const maxClimb = Math.tan(p.maxPitch);
		for (let i = 0; i < this.count; i++) {
			const ia = i * 3;
			let vx = vel[ia] + acc[ia] * h;
			let vy = vel[ia + 1] + acc[ia + 1] * h;
			let vz = vel[ia + 2] + acc[ia + 2] * h;
			// Limit the climb angle, then the speed.
			const flat = Math.sqrt(vx * vx + vz * vz);
			const climb = maxClimb * Math.max(flat, p.minSpeed);
			if (vy > climb) vy = climb;
			else if (vy < -climb) vy = -climb;
			let speed = Math.sqrt(vx * vx + vy * vy + vz * vz);
			if (!(speed > 1e-6)) {
				vx = p.minSpeed;
				vy = 0;
				vz = 0;
				speed = p.minSpeed;
			}
			const target = Math.min(p.maxSpeed, Math.max(p.minSpeed, speed));
			const k = target / speed;
			vx *= k;
			vy *= k;
			vz *= k;
			let x = pos[ia] + vx * h;
			let y = pos[ia + 1] + vy * h;
			let z = pos[ia + 2] + vz * h;
			if (x < b[0]) {
				x = b[0];
				vx = Math.abs(vx);
			} else if (x > b[3]) {
				x = b[3];
				vx = -Math.abs(vx);
			}
			if (y < b[1]) {
				y = b[1];
				vy = Math.abs(vy);
			} else if (y > b[4]) {
				y = b[4];
				vy = -Math.abs(vy);
			}
			if (z < b[2]) {
				z = b[2];
				vz = Math.abs(vz);
			} else if (z > b[5]) {
				z = b[5];
				vz = -Math.abs(vz);
			}
			if (!Number.isFinite(x + y + z + vx + vy + vz)) {
				x = (b[0] + b[3]) / 2;
				y = (b[1] + b[4]) / 2;
				z = (b[2] + b[5]) / 2;
				vx = p.minSpeed;
				vy = vz = 0;
			}
			pos[ia] = x;
			pos[ia + 1] = y;
			pos[ia + 2] = z;
			vel[ia] = vx;
			vel[ia + 1] = vy;
			vel[ia + 2] = vz;
		}
	}

	/**
	 * Writes one column-major 4×4 matrix per agent into `out` (an
	 * InstancedMesh's instanceMatrix.array): heading along the velocity, level
	 * wings, uniform `scale`. The geometry faces +z with its wings along ±x.
	 */
	writeMatrices(out: Float32Array, scale: ScaleSource) {
		const pos = this.position;
		const vel = this.velocity;
		const s = scale.scale;
		for (let i = 0; i < this.count; i++) {
			const ia = i * 3;
			const m = i * 16;
			let fx = vel[ia];
			let fy = vel[ia + 1];
			let fz = vel[ia + 2];
			const speed = Math.sqrt(fx * fx + fy * fy + fz * fz);
			if (speed > 1e-6) {
				fx /= speed;
				fy /= speed;
				fz /= speed;
			} else {
				fx = 0;
				fy = 0;
				fz = 1;
			}
			// right = normalize(up × forward), up' = forward × right.
			let rx = fz;
			let rz = -fx;
			const r = Math.sqrt(rx * rx + rz * rz);
			if (r > 1e-6) {
				rx /= r;
				rz /= r;
			} else {
				rx = 1;
				rz = 0;
			}
			const ux = fy * rz;
			const uy = fz * rx - fx * rz;
			const uz = -fy * rx;
			out[m] = rx * s;
			out[m + 1] = 0;
			out[m + 2] = rz * s;
			out[m + 3] = 0;
			out[m + 4] = ux * s;
			out[m + 5] = uy * s;
			out[m + 6] = uz * s;
			out[m + 7] = 0;
			out[m + 8] = fx * s;
			out[m + 9] = fy * s;
			out[m + 10] = fz * s;
			out[m + 11] = 0;
			out[m + 12] = pos[ia];
			out[m + 13] = pos[ia + 1];
			out[m + 14] = pos[ia + 2];
			out[m + 15] = 1;
		}
	}
}

/** A scale carried in an object field (see Playhead in ../track.ts). */
export interface ScaleSource {
	readonly scale: number;
}
