/**
 * Tucano-de-bico-verde (Ramphastos dicolorus).
 *
 * Biology it follows:
 * - Moves along branches by hopping, not walking (Short & Horne 2001, Toucans,
 *   Barbets and Honeyguides, OUP).
 * - Perched, it turns and cocks its head to look with one eye (the species
 *   table's headTilt).
 * - Flight is short and undulating: a burst of 6–10 rapid wingbeats, the wings
 *   closed for a moment so it drops, then a glide on spread wings, and again
 *   (Van Tyne 1929, Univ. Michigan Misc. Publ. 19; Skutch 1971, Auk 88:381–396),
 *   with the feet drawn up forward (Van Tyne 1929).
 * - It roosts with the tail folded up over its back (Kricher 1989, via ADW).
 *
 * The wingbeat rate (6 Hz) is an estimate for a ~400 g bird, not a measured
 * value for this species; see the report.
 */
import { LIMITS } from '../../style/motion.ts';
import { Behaviour, type BehaviourOptions } from './behaviour.ts';
import type { AnimalWorld } from './motion.ts';
import { clamp, DEG, smoothstep, wrapAngle } from './scalar.ts';

export const TUCANO_STATES = ['perch', 'hop', 'fly', 'glide', 'rest'] as const;
export type TucanoState = (typeof TUCANO_STATES)[number];

export const TUCANO = {
	/** Flight speed, u/s, wingbeats per second and beats per burst. */
	flightSpeed: 6,
	flapRate: 6,
	beats: [6, 10],
	/** Wings closed before each glide, seconds, then the glide. */
	drop: 0.15,
	glide: [0.4, 0.8],
	/** Height gained flapping and lost dropping or gliding, u/s. */
	climbRate: 1.2,
	dropRate: 2.2,
	sinkRate: 0.7,
	/** The arc between perches rises by this share of the distance plus a constant, u. */
	arcShare: 0.2,
	arcBase: 0.6,
	/** A hop along the perch: distance and height (u) and airtime (s). */
	hopDistance: 0.25,
	hopHeight: 0.12,
	hopTime: 0.3,
	perch: [2, 6],
	rest: [15, 30],
	/** Choices on a perch, cumulative order: hop, fly, rest (the rest stays perched). */
	hopChance: 0.35,
	flyChance: 0.3,
	restChance: 0.1,
	glance: [0.8, 2.2],
	glanceYaw: 60 * DEG,
	glancePitch: 15 * DEG,
	bankGain: 0.04
} as const;

/** One perch: a branch segment centred on (x, y, z), running along `yaw`, `halfLength` each way. */
export interface Perch {
	x: number;
	y: number;
	z: number;
	yaw: number;
	halfLength: number;
}

export interface TucanoOptions extends BehaviourOptions {
	/** At least one perch; with two or more it flies between them. */
	perches: readonly Perch[];
	start?: number;
}

const PERCH_STRIDE = 5;

export class TucanoBehaviour extends Behaviour<TucanoState> {
	readonly states = TUCANO_STATES;
	/** Perches packed x, y, z, yaw, halfLength. */
	readonly perches: Float64Array;
	readonly perchCount: number;
	perch = 0;
	/** Position along the current perch, u. */
	offset = 0;
	/** Flight progress 0..1 and the perch flown to. */
	progress = 0;
	target = 0;
	/** Hops and flights so far (tests, debug). */
	hops = 0;
	flights = 0;
	readonly #curve = new Float64Array(9);
	#length = 1;
	#bob = 0;
	#bobRate = 0;
	#hopFrom = 0;
	#hopTo = 0;
	#beats = 0;
	#glance = 0;
	#lookYaw = 0;
	#lookPitch = 0;
	#vy = 0;
	#vh = 0;

	constructor(options: TucanoOptions) {
		super('tucano-de-bico-verde', 'perch', options);
		if (options.perches.length === 0) throw new Error('A toucan needs a perch');
		this.perchCount = options.perches.length;
		this.perches = new Float64Array(this.perchCount * PERCH_STRIDE);
		options.perches.forEach((perch, i) => {
			this.perches.set(
				[perch.x, perch.y, perch.z, perch.yaw, Math.max(0, perch.halfLength)],
				i * PERCH_STRIDE
			);
		});
		this.perch = Math.min(Math.max(options.start ?? 0, 0), this.perchCount - 1);
		this.motion.yaw = this.drive.targetYaw = this.perches[this.perch * PERCH_STRIDE + 3];
		this.#placeOnPerch();
		this.enter('perch', TUCANO.perch[0]);
	}

	/** Flies to perch `index` now (the scene can call it, e.g. when the player gets close). */
	flyTo(index: number) {
		if (index === this.perch || index < 0 || index >= this.perchCount) return false;
		if (this.state === 'fly' || this.state === 'glide') return false;
		this.#takeOff(index);
		return true;
	}

	protected advance(_world: AnimalWorld) {
		switch (this.state) {
			case 'hop':
				this.#hop();
				break;
			case 'fly':
			case 'glide':
				this.#fly();
				break;
			default:
				this.#placeOnPerch();
				this.turn();
				this.#glanceStep();
		}
	}

	protected decide(_world: AnimalWorld) {
		const rng = this.rng;
		switch (this.state) {
			case 'perch': {
				const roll = rng.next();
				if (roll < TUCANO.hopChance) this.#startHop();
				else if (roll < TUCANO.hopChance + TUCANO.flyChance && this.perchCount > 1) {
					let next = Math.floor(rng.range(0, this.perchCount - 1));
					if (next >= this.perch) next++;
					this.#takeOff(next);
				} else if (roll < TUCANO.hopChance + TUCANO.flyChance + TUCANO.restChance)
					this.enter('rest', rng.range(TUCANO.rest[0], TUCANO.rest[1]));
				else this.enter('perch', rng.range(TUCANO.perch[0], TUCANO.perch[1]));
				break;
			}
			case 'fly':
				// End of a flap burst: close the wings, drop, then glide.
				this.enter('glide', TUCANO.drop + rng.range(TUCANO.glide[0], TUCANO.glide[1]));
				break;
			case 'glide':
				this.#burst();
				break;
			case 'hop':
				this.enter('perch', rng.range(TUCANO.perch[0], TUCANO.perch[1]));
				break;
			default:
				this.enter('perch', rng.range(TUCANO.perch[0], TUCANO.perch[1]));
		}
	}

	protected finish(_world: AnimalWorld) {
		const motion = this.motion;
		const state = this.state;
		const flying = state === 'fly' || state === 'glide';
		motion.posture = flying ? 'fly' : state === 'rest' ? 'roost' : 'perch';
		motion.fade = flying ? 0.12 : 0.25;
		const launching = state === 'fly' && this.progress === 0;
		motion.flapRate = TUCANO.flapRate;
		motion.flap = state === 'fly' && !launching ? 1 : 0;
		motion.wingsClosed = state === 'glide' && this.clock.inState < TUCANO.drop ? 1 : 0;
		// Separate stores, not a ternary: merging a constant with another number made V8 box it every frame (measured).
		if (flying) {
			motion.lookYaw = 0;
			motion.lookPitch = 0;
			motion.pitch = -Math.atan2(this.#vy, Math.max(0.1, this.#vh));
			const bank = motion.turnRate * TUCANO.flightSpeed * TUCANO.bankGain;
			motion.bank = Math.min(0.5, Math.max(-0.5, bank));
			motion.speed = TUCANO.flightSpeed;
		} else {
			motion.lookYaw = this.#lookYaw;
			motion.lookPitch = this.#lookPitch;
			motion.pitch = 0;
			motion.bank = 0;
			motion.speed = 0;
		}
	}

	#startHop() {
		const half = this.perches[this.perch * PERCH_STRIDE + 4];
		let to = this.offset + (this.rng.chance(0.5) ? 1 : -1) * TUCANO.hopDistance;
		if (Math.abs(to) > half) to = this.offset - Math.sign(to - this.offset) * TUCANO.hopDistance;
		this.#hopFrom = this.offset;
		this.#hopTo = clamp(to, -half, half);
		const yaw = this.perches[this.perch * PERCH_STRIDE + 3];
		this.drive.targetYaw = this.#hopTo >= this.#hopFrom ? yaw : wrapAngle(yaw + Math.PI);
		this.enter('hop', LIMITS.anticipation + TUCANO.hopTime);
	}

	#hop() {
		const motion = this.motion;
		const crouch = LIMITS.anticipation;
		const t = this.clock.inState + this.clock.h;
		this.turn();
		if (t < crouch) {
			motion.crouch = t / crouch;
			this.#placeOnPerch();
			return;
		}
		if (this.clock.inState < crouch) motion.takeoff = 0.5;
		motion.crouch = 0;
		const u = Math.min(1, (t - crouch) / TUCANO.hopTime);
		this.offset = this.#hopFrom + (this.#hopTo - this.#hopFrom) * u;
		this.#placeOnPerch();
		motion.y += 4 * TUCANO.hopHeight * u * (1 - u);
		if (u >= 1 || this.clock.timer <= this.clock.h + 1e-9) {
			motion.landing = 0.4;
			this.hops++;
		}
	}

	#takeOff(target: number) {
		const p = this.perches;
		const motion = this.motion;
		const curve = this.#curve;
		const q = target * PERCH_STRIDE;
		const dx = p[q] - motion.x;
		const dy = p[q + 1] - motion.y;
		const dz = p[q + 2] - motion.z;
		const span = Math.sqrt(dx * dx + dy * dy + dz * dz);
		curve[0] = motion.x;
		curve[1] = motion.y;
		curve[2] = motion.z;
		curve[3] = motion.x + dx / 2;
		curve[4] = motion.y + dy / 2 + TUCANO.arcShare * span + TUCANO.arcBase;
		curve[5] = motion.z + dz / 2;
		curve[6] = p[q];
		curve[7] = p[q + 1];
		curve[8] = p[q + 2];
		const legA = Math.hypot(curve[3] - curve[0], curve[4] - curve[1], curve[5] - curve[2]);
		const legB = Math.hypot(curve[6] - curve[3], curve[7] - curve[4], curve[8] - curve[5]);
		this.#length = Math.max(0.1, (span + legA + legB) / 2);
		this.target = target;
		this.progress = 0;
		this.#bob = 0;
		this.flights++;
		this.drive.targetYaw = Math.atan2(dx, dz);
		this.#burst();
	}

	#burst() {
		this.#beats = Math.floor(this.rng.range(TUCANO.beats[0], TUCANO.beats[1] + 1));
		const launch = this.progress === 0 ? LIMITS.anticipation : 0;
		this.enter('fly', launch + this.#beats / TUCANO.flapRate);
	}

	#fly() {
		const motion = this.motion;
		const h = this.clock.h;
		// Anticipation crouch on the perch before the first beat.
		if (this.progress === 0 && this.state === 'fly' && this.clock.inState + h <= LIMITS.anticipation) {
			motion.crouch = (this.clock.inState + h) / LIMITS.anticipation;
			this.turn();
			return;
		}
		if (this.progress === 0) motion.takeoff = 1;
		motion.crouch = 0;
		const before = this.progress;
		this.progress = Math.min(1, before + (TUCANO.flightSpeed * h) / this.#length);
		const dropping = this.state === 'glide' && this.clock.inState < TUCANO.drop;
		if (this.state === 'fly') this.#bobRate = TUCANO.climbRate;
		else if (dropping) this.#bobRate = -TUCANO.dropRate;
		else this.#bobRate = -TUCANO.sinkRate;
		this.#bob = clamp(this.#bob + this.#bobRate * h, -0.6, 0.6);
		const u = this.progress;
		const envelope = smoothstep(u / 0.15) * smoothstep((1 - u) / 0.2);
		const c = this.#curve;
		const a = (1 - u) * (1 - u);
		const b = 2 * u * (1 - u);
		const d = u * u;
		const px = motion.x;
		const py = motion.y;
		const pz = motion.z;
		motion.x = a * c[0] + b * c[3] + d * c[6];
		motion.y = a * c[1] + b * c[4] + d * c[7] + this.#bob * envelope;
		motion.z = a * c[2] + b * c[5] + d * c[8];
		const mx = motion.x - px;
		const mz = motion.z - pz;
		this.#vh = Math.sqrt(mx * mx + mz * mz) / h;
		this.#vy = (motion.y - py) / h;
		if (mx !== 0 || mz !== 0) this.drive.targetYaw = Math.atan2(mx, mz);
		this.turn();
		if (u >= 1) this.#land();
	}

	#land() {
		const motion = this.motion;
		this.perch = this.target;
		this.offset = 0;
		this.#vy = this.#vh = 0;
		motion.landing = 0.7;
		this.#placeOnPerch();
		this.drive.targetYaw = this.perches[this.perch * PERCH_STRIDE + 3];
		this.enter('perch', this.rng.range(TUCANO.perch[0], TUCANO.perch[1]));
	}

	#glanceStep() {
		if (this.state === 'rest') {
			this.#lookYaw = this.#lookPitch = 0;
			return;
		}
		this.#glance -= this.clock.h;
		if (this.#glance > 0) return;
		const rng = this.cosmetic;
		this.#glance = rng.range(TUCANO.glance[0], TUCANO.glance[1]);
		this.#lookYaw = rng.range(-TUCANO.glanceYaw, TUCANO.glanceYaw);
		this.#lookPitch = rng.range(-1, 1) * TUCANO.glancePitch;
	}

	#placeOnPerch() {
		const p = this.perches;
		const at = this.perch * PERCH_STRIDE;
		const yaw = p[at + 3];
		this.motion.x = p[at] + Math.sin(yaw) * this.offset;
		this.motion.y = p[at + 1];
		this.motion.z = p[at + 2] + Math.cos(yaw) * this.offset;
	}
}
