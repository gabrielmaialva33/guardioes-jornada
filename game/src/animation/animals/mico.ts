/**
 * Mico-leão-dourado (Leontopithecus rosalia), the player's companion.
 *
 * Biology it follows:
 * - Walks with a diagonal-sequence gait and bounds when fast, the hindlimbs
 *   overstriding the forelimbs (Rosenberger & Stafford 1994); the species
 *   table blends the walk into the bound between 2 and 3.5 u/s.
 * - Moves in short bursts with frequent vigilance pauses: quick head turns
 *   scanning for raptors (the 'pop' spring preset).
 * - Its tail is NOT prehensile: it balances and trails, and never holds a branch
 *   (ICMBio ficha L. rosalia; AMLD). There is no hanging state, and the
 *   species has no suspended posture to fall into (postures.ts).
 *
 * Companion mode keeps it 3 studs from the player with a feed-forward of the
 * player's velocity plus a dead-banded radial correction with braking, so it
 * neither lags behind a walking player nor dithers around a still one; a
 * hysteresis between 'follow' and 'idle' keeps the state from flickering. It
 * hops when the player jumps, after a crouch of LIMITS.anticipation.
 */
import { STUD, WALK_SPEED } from '../../engine/constants.ts';
import { LIMITS } from '../../style/motion.ts';
import { Behaviour, type BehaviourOptions } from './behaviour.ts';
import type { AnimalWorld } from './motion.ts';
import { type Route, RouteCursor, StepDistance } from './route.ts';
import { approach, clamp, DEG, wrapAngle } from './scalar.ts';

export const MICO_STATES = ['idle', 'move', 'rest', 'follow', 'hop'] as const;
export type MicoState = (typeof MICO_STATES)[number];

/** Companion and wandering tuning [engine], in world units. */
export const MICO = {
	/** Target gap to the player: 3 studs. */
	followDistance: 3 * STUD,
	/** Settles inside ±bandIn of the gap, starts again outside ±bandOut. */
	bandIn: 0.25 * STUD,
	bandOut: 1 * STUD,
	/** Radial correction per unit of gap error, 1/s. */
	gain: 4,
	/** A quarter faster than the player's walk so it can catch up. */
	maxSpeed: 1.25 * WALK_SPEED,
	/** A small, agile primate stops short. */
	accel: 70,
	/** Player speeds (u/s) that count as moving and as standing still. */
	playerMoving: 0.4,
	playerStill: 0.15,
	/** Further than this (a respawn, a teleport) it reappears behind the player. */
	teleportDistance: 30,
	/** The hop on a player jump: apex height and airtime. */
	hopHeight: 0.45,
	hopTime: 0.42,
	/** Wandering bursts along its own route when not a companion. */
	wanderSpeed: 3.8,
	wanderAccel: 20,
	burst: [0.6, 1.8],
	pause: [0.6, 2.2],
	rest: [6, 14],
	restChance: 0.15,
	/** Seconds between vigilance glances, and their reach. */
	glance: [0.35, 1.1],
	glanceYaw: 70 * DEG,
	glancePitch: 20 * DEG,
	/** Share of glances spent looking at the player in companion mode. */
	lookAtPlayer: 0.6,
	/** The player's eye height above its feet (the avatar is 3 u tall). */
	playerEyes: 2.6
} as const;

export interface MicoOptions extends BehaviourOptions {
	/** A branch or trail to wander on when not following. */
	route?: Route | null;
	/** Start following the player. */
	companion?: boolean;
	/** Start position, when there is no route. */
	x?: number;
	y?: number;
	z?: number;
}

export class MicoBehaviour extends Behaviour<MicoState> {
	readonly states = MICO_STATES;
	readonly route: Route | null;
	readonly cursor = new RouteCursor();
	companion = false;
	/** Planar velocity, u/s. */
	vx = 0;
	vz = 0;
	/** Settled next to the player (idle) rather than following. */
	settled = false;
	/** Seconds into the current hop (crouch included), or -1. */
	hopClock = -1;
	readonly #advance = new StepDistance();
	#resume: MicoState = 'idle';
	#ground = 0;
	#jumpLatch = false;
	#glance = 0;
	#lookYaw = 0;
	#lookPitch = 0;
	#lookAtPlayer = false;
	#playerVx = 0;
	#playerVz = 0;
	#lastPlayerX = 0;
	#lastPlayerZ = 0;
	#hasPlayer = false;
	#speed = 0;
	#cruise = 0;
	#lift = 0;
	#tvx = 0;
	#tvz = 0;

	constructor(options: MicoOptions = {}) {
		super('mico-leao-dourado', 'idle', options);
		this.route = options.route ?? null;
		this.motion.x = options.x ?? 0;
		this.motion.y = options.y ?? 0;
		this.motion.z = options.z ?? 0;
		this.#ground = this.motion.y;
		if (this.route) {
			this.route.locate(this.cursor);
			this.#place();
		}
		this.setCompanion(options.companion ?? false);
	}

	/** Turns companion mode on (follow the player) or off (wander on the route from the nearest point). */
	setCompanion(on: boolean) {
		this.companion = on;
		this.settled = false;
		if (on) {
			this.enter('follow', 1e9);
			return;
		}
		if (this.route) {
			this.cursor.s = nearestOnRoute(this.route, this.motion.x, this.motion.z);
			this.route.locate(this.cursor);
		}
		this.enter('idle', this.rng.range(MICO.pause[0], MICO.pause[1]));
	}

	/** The scene calls this on a player jump if it does not fill AnimalWorld.playerJumped. */
	notifyPlayerJump() {
		this.#jumpLatch = true;
	}

	protected sense(world: AnimalWorld) {
		if (world.playerJumped) this.#jumpLatch = true;
		const dt = this.frameDt;
		// Player velocity: the engine's if given, else a smoothed estimate from positions.
		if (Number.isFinite(world.playerVx) && Number.isFinite(world.playerVz)) {
			this.#playerVx = world.playerVx;
			this.#playerVz = world.playerVz;
		} else if (this.#hasPlayer && dt > 0) {
			const k = 1 - Math.exp(-12 * dt);
			this.#playerVx += ((world.playerX - this.#lastPlayerX) / dt - this.#playerVx) * k;
			this.#playerVz += ((world.playerZ - this.#lastPlayerZ) / dt - this.#playerVz) * k;
		}
		this.#lastPlayerX = world.playerX;
		this.#lastPlayerZ = world.playerZ;
		this.#hasPlayer = true;
		if (this.companion) {
			const dx = this.motion.x - world.playerX;
			const dz = this.motion.z - world.playerZ;
			if (dx * dx + dz * dz > MICO.teleportDistance * MICO.teleportDistance) this.#teleport(world);
		}
		if (this.#jumpLatch && this.companion && this.state !== 'hop') {
			this.#jumpLatch = false;
			this.#resume = this.settled ? 'idle' : 'follow';
			this.hopClock = 0;
			this.enter('hop', 1e9);
		} else if (this.state === 'hop') {
			this.#jumpLatch = false;
		}
	}

	protected advance(world: AnimalWorld) {
		const motion = this.motion;
		if (this.companion) this.#follow(world);
		else this.#wander();
		// Ground: the scene's sample, else the player's feet while the player is grounded.
		if (this.companion) {
			if (Number.isFinite(world.groundY)) this.#ground = world.groundY;
			else if (world.playerGrounded) this.#ground = world.playerY;
		} else if (this.route) {
			this.#ground = this.cursor.y;
		}
		this.#lift = 0;
		if (this.state === 'hop') this.#hop();
		motion.y = this.#ground + this.#lift;
		this.#glanceStep(world);
	}

	protected decide(_world: AnimalWorld) {
		const rng = this.rng;
		if (this.companion) {
			// Companion states are driven by the player, not by the clock.
			this.timer = 1e9;
			return;
		}
		switch (this.state) {
			case 'move':
				this.enter('idle', rng.range(MICO.pause[0], MICO.pause[1]));
				break;
			case 'idle':
				if (rng.chance(MICO.restChance)) this.enter('rest', rng.range(MICO.rest[0], MICO.rest[1]));
				else if (this.route && this.route.length > 0.1) {
					this.#cruise = MICO.wanderSpeed * rng.range(0.6, 1.1);
					this.enter('move', rng.range(MICO.burst[0], MICO.burst[1]));
				} else this.enter('idle', rng.range(MICO.pause[0], MICO.pause[1]));
				break;
			default:
				this.enter('idle', rng.range(MICO.pause[0], MICO.pause[1]));
		}
	}

	protected finish(_world: AnimalWorld) {
		const motion = this.motion;
		motion.posture = this.state === 'rest' ? 'sit' : 'stand';
		motion.speed = this.#speed;
		motion.lookYaw = this.#lookYaw;
		motion.lookPitch = this.#lookPitch;
	}

	#follow(world: AnimalWorld) {
		const motion = this.motion;
		const dx = motion.x - world.playerX;
		const dz = motion.z - world.playerZ;
		const distance = Math.hypot(dx, dz);
		const nx = distance > 1e-6 ? dx / distance : Math.sin(motion.yaw + Math.PI);
		const nz = distance > 1e-6 ? dz / distance : Math.cos(motion.yaw + Math.PI);
		const error = distance - MICO.followDistance;
		const playerSpeed = Math.hypot(this.#playerVx, this.#playerVz);

		if (this.settled) {
			if (Math.abs(error) > MICO.bandOut || playerSpeed > MICO.playerMoving) this.settled = false;
		} else if (
			Math.abs(error) < MICO.bandIn &&
			playerSpeed < MICO.playerStill &&
			Math.hypot(this.vx, this.vz) < 0.3
		) {
			this.settled = true;
		}
		if (this.state !== 'hop') this.state = this.settled ? 'idle' : 'follow';

		let tvx = 0;
		let tvz = 0;
		if (!this.settled) {
			// Dead band, then a proportional pull capped by a braking curve (arrive).
			const excess = Math.max(0, Math.abs(error) - MICO.bandIn);
			const pull = Math.min(MICO.gain * excess, Math.sqrt(2 * MICO.accel * excess), MICO.maxSpeed);
			const radial = error > 0 ? -pull : pull;
			tvx = this.#playerVx + radial * nx;
			tvz = this.#playerVz + radial * nz;
			const target = Math.hypot(tvx, tvz);
			if (target > MICO.maxSpeed) {
				tvx *= MICO.maxSpeed / target;
				tvz *= MICO.maxSpeed / target;
			}
		}
		this.#tvx = tvx;
		this.#tvz = tvz;
		this.#accelerate();

		// Face the travel direction while moving; when settled, face the player if far off.
		const speed = Math.hypot(this.vx, this.vz);
		if (speed > 0.3) this.targetYaw = Math.atan2(this.vx, this.vz);
		else if (this.settled) {
			const toPlayer = Math.atan2(-nx, -nz);
			if (Math.abs(wrapAngle(toPlayer - motion.yaw)) > 50 * DEG) this.targetYaw = toPlayer;
		}
		this.turn();
	}

	#wander() {
		const motion = this.motion;
		const route = this.route;
		const cruise = this.state === 'move' && route ? this.#cruise : 0;
		const before = this.#speed;
		this.#speed = approach(before, cruise, MICO.wanderAccel * this.h);
		motion.accel = (this.#speed - before) / this.h;
		this.vx = this.vz = 0;
		if (route && this.#speed > 0) {
			const step = this.#advance;
			step.distance = 0.5 * (before + this.#speed) * this.h;
			route.advance(this.cursor, step);
			motion.distance += step.distance;
			this.#place();
		}
		if (route) this.targetYaw = this.cursor.yaw;
		this.turn();
	}

	/** Moves the velocity toward (#tvx, #tvz) at MICO.accel and integrates the position. */
	#accelerate() {
		const motion = this.motion;
		const h = this.h;
		let dvx = this.#tvx - this.vx;
		let dvz = this.#tvz - this.vz;
		const dv = Math.hypot(dvx, dvz);
		const most = MICO.accel * h;
		if (dv > most) {
			dvx *= most / dv;
			dvz *= most / dv;
		}
		const before = Math.hypot(this.vx, this.vz);
		const vx = this.vx + dvx;
		const vz = this.vz + dvz;
		// Trapezoid: exact for the constant acceleration of this substep.
		const mx = 0.5 * (this.vx + vx) * h;
		const mz = 0.5 * (this.vz + vz) * h;
		this.vx = vx;
		this.vz = vz;
		motion.x += mx;
		motion.z += mz;
		const speed = Math.hypot(vx, vz);
		motion.distance += Math.hypot(mx, mz);
		motion.accel = (speed - before) / h;
		this.#speed = speed;
	}

	/** Advances the hop and sets #lift, the height above the ground. */
	#hop() {
		const motion = this.motion;
		const before = this.hopClock;
		const clock = before + this.h;
		this.hopClock = clock;
		const crouch = LIMITS.anticipation;
		const end = crouch + MICO.hopTime;
		if (clock < crouch) {
			motion.crouch = clock / crouch;
			return;
		}
		motion.crouch = 0;
		if (before < crouch) motion.takeoff = 1;
		if (clock >= end) {
			motion.landing = 1;
			this.hopClock = -1;
			this.enter(this.#resume, this.companion ? 1e9 : MICO.pause[0]);
			if (this.companion) this.state = this.settled ? 'idle' : 'follow';
			return;
		}
		const t = (clock - crouch) / MICO.hopTime;
		this.#lift = 4 * MICO.hopHeight * t * (1 - t);
	}

	#glanceStep(world: AnimalWorld) {
		const moving = this.state === 'move' || (this.state === 'follow' && this.#speed > 1);
		if (moving || this.state === 'rest') {
			this.#lookAtPlayer = false;
			this.#lookYaw = 0;
			this.#lookPitch = this.state === 'rest' ? -10 * DEG : 0;
			return;
		}
		this.#glance -= this.h;
		if (this.#glance <= 0) {
			const rng = this.rng;
			this.#glance = rng.range(MICO.glance[0], MICO.glance[1]);
			this.#lookAtPlayer = this.companion && rng.chance(MICO.lookAtPlayer);
			if (!this.#lookAtPlayer) {
				this.#lookYaw = rng.range(-MICO.glanceYaw, MICO.glanceYaw);
				this.#lookPitch = rng.range(-0.3, 1) * MICO.glancePitch;
			}
		}
		if (this.#lookAtPlayer) {
			const motion = this.motion;
			const dx = world.playerX - motion.x;
			const dz = world.playerZ - motion.z;
			this.#lookYaw = wrapAngle(Math.atan2(dx, dz) - motion.yaw);
			const rise = world.playerY + MICO.playerEyes - (motion.y + this.species.size * 0.8);
			this.#lookPitch = clamp(Math.atan2(rise, Math.hypot(dx, dz)), -0.6, 0.6);
		}
	}

	#place() {
		const motion = this.motion;
		motion.x = this.cursor.x;
		motion.z = this.cursor.z;
		this.#ground = this.cursor.y;
	}

	#teleport(world: AnimalWorld) {
		const motion = this.motion;
		const back = Math.atan2(this.#playerVx, this.#playerVz) + Math.PI;
		const angle = Number.isFinite(back) ? back : motion.yaw;
		motion.x = world.playerX + Math.sin(angle) * MICO.followDistance;
		motion.z = world.playerZ + Math.cos(angle) * MICO.followDistance;
		motion.yaw = this.targetYaw = angle + Math.PI;
		this.vx = this.vz = this.#speed = 0;
		this.#ground = Number.isFinite(world.groundY) ? world.groundY : world.playerY;
		this.settled = false;
	}
}

/** Arc length of the route point nearest to (x, z), ignoring height. Load or event time only. */
export function nearestOnRoute(route: Route, x: number, z: number): number {
	const p = route.points;
	let best = 0;
	let bestDistance = Number.POSITIVE_INFINITY;
	for (let i = 0; i < route.segments; i++) {
		const a = i * 3;
		const b = ((i + 1) % route.count) * 3;
		const ex = p[b] - p[a];
		const ez = p[b + 2] - p[a + 2];
		const span = ex * ex + ez * ez;
		const t = span > 0 ? Math.min(1, Math.max(0, ((x - p[a]) * ex + (z - p[a + 2]) * ez) / span)) : 0;
		const qx = p[a] + ex * t - x;
		const qz = p[a + 2] + ez * t - z;
		const d = qx * qx + qz * qz;
		if (d < bestDistance) {
			bestDistance = d;
			best = route.lengths[i] + t * (route.lengths[i + 1] - route.lengths[i]);
		}
	}
	return best;
}
