/**
 * Onça-pintada (Panthera onca).
 *
 * Calm by design: it walks its trail with a lateral-sequence walk (the felid
 * pattern near 25% phase; Usherwood & Self Davies 2017), sits, lies down to
 * rest, and sways its tail. There is no stalking, crouching, chasing, pouncing
 * or attack state: jaguars avoid people, and attacks are very rare and almost
 * always provoked (ICMBio/CENAP, PAN Grandes Felinos). When the player comes
 * close it watches calmly and then walks away along its trail, never toward
 * the player. ONCA_STATES is the complete list, and a test pins it.
 */
import { STUD } from '../../engine/constants.ts';
import { Behaviour, type BehaviourOptions } from './behaviour.ts';
import type { AnimalWorld } from './motion.ts';
import { type Route, RouteCursor, StepDistance } from './route.ts';
import { approach, clamp, DEG, wrapAngle } from './scalar.ts';

export const ONCA_STATES = ['idle', 'move', 'sit', 'rest'] as const;
export type OncaState = (typeof ONCA_STATES)[number];

export const ONCA = {
	/** Calm walk, u/s (about 0.7 body lengths per second), and a brisker walk when moving off. */
	walkSpeed: 2.2,
	leaveSpeed: 2.8,
	accel: 1.5,
	/** Personal space: inside this it moves away from the player (15 studs). */
	avoidRadius: 15 * STUD,
	/** Inside this it watches the player. */
	watchRadius: 30 * STUD,
	/** Seconds it takes to notice the player before standing up. */
	notice: 0.8,
	move: [6, 14],
	idle: [2.5, 6],
	sit: [5, 12],
	rest: [15, 35],
	glance: [2, 5],
	glanceYaw: 40 * DEG,
	/** Longer posture fades for a heavy cat getting up or lying down. */
	fade: 0.6
} as const;

export interface OncaOptions extends BehaviourOptions {
	/** Its trail; closed routes loop, open ones are walked back and forth. */
	route: Route;
	start?: number;
}

export class OncaBehaviour extends Behaviour<OncaState> {
	readonly states = ONCA_STATES;
	readonly route: Route;
	readonly cursor = new RouteCursor();
	/** True while it is moving off because the player came close. */
	leaving = false;
	readonly #advance = new StepDistance();
	#speed = 0;
	#near = 0;
	#glance = 0;
	#lookYaw = 0;
	#lookPitch = 0;
	#playerX = 0;
	#playerZ = 0;
	#playerDistance = Number.POSITIVE_INFINITY;

	constructor(options: OncaOptions) {
		super('onca-pintada', 'idle', options);
		this.route = options.route;
		this.cursor.s = options.start ?? 0;
		this.route.locate(this.cursor);
		this.motion.yaw = this.targetYaw = this.cursor.yaw;
		this.#place();
		this.enter('idle', ONCA.idle[0]);
	}

	protected sense(world: AnimalWorld) {
		this.#playerX = world.playerX;
		this.#playerZ = world.playerZ;
	}

	protected advance(_world: AnimalWorld) {
		const h = this.h;
		const motion = this.motion;
		const dx = this.#playerX - motion.x;
		const dz = this.#playerZ - motion.z;
		const distance = Math.hypot(dx, dz);
		this.#playerDistance = distance;

		// Personal space: after noticing, get up and move off, never toward the player.
		if (distance < ONCA.avoidRadius) {
			this.#near += h;
			if (this.#near >= ONCA.notice) {
				const ahead = this.cursor.dx * dx + this.cursor.dz * dz;
				if (this.state !== 'move') {
					if (ahead > 0) this.#reverse();
					this.leaving = true;
					this.enter('move', this.rng.range(ONCA.move[0], ONCA.move[1]));
				} else if (ahead > 0) {
					this.#reverse();
					this.leaving = true;
				}
			}
		} else {
			this.#near = 0;
			if (distance > ONCA.avoidRadius * 1.5) this.leaving = false;
		}

		const cruise = this.state === 'move' ? (this.leaving ? ONCA.leaveSpeed : ONCA.walkSpeed) : 0;
		const before = this.#speed;
		// Wait to finish turning around before walking on.
		const aligned = Math.abs(wrapAngle(this.targetYaw - motion.yaw)) < 0.35;
		this.#speed = approach(before, aligned ? cruise : 0, ONCA.accel * h);
		motion.accel = (this.#speed - before) / h;
		if (this.#speed > 0) {
			const step = this.#advance;
			step.distance = 0.5 * (before + this.#speed) * h;
			this.route.advance(this.cursor, step);
			motion.distance += step.distance;
			this.#place();
		}
		this.targetYaw = this.cursor.yaw;
		this.turn();
		this.#attend(dx, dz, distance);
	}

	protected decide(_world: AnimalWorld) {
		const rng = this.rng;
		const roll = rng.next();
		switch (this.state) {
			case 'move':
				this.leaving = false;
				if (roll < 0.6) this.enter('idle', rng.range(ONCA.idle[0], ONCA.idle[1]));
				else if (roll < 0.85) this.enter('sit', rng.range(ONCA.sit[0], ONCA.sit[1]));
				else this.enter('rest', rng.range(ONCA.rest[0], ONCA.rest[1]));
				break;
			case 'idle':
				if (roll < 0.6) this.enter('move', rng.range(ONCA.move[0], ONCA.move[1]));
				else if (roll < 0.85) this.enter('sit', rng.range(ONCA.sit[0], ONCA.sit[1]));
				else this.enter('rest', rng.range(ONCA.rest[0], ONCA.rest[1]));
				break;
			case 'sit':
				if (roll < 0.5) this.enter('idle', rng.range(ONCA.idle[0], ONCA.idle[1]));
				else if (roll < 0.8) this.enter('rest', rng.range(ONCA.rest[0], ONCA.rest[1]));
				else this.enter('move', rng.range(ONCA.move[0], ONCA.move[1]));
				break;
			default:
				if (roll < 0.5) this.enter('sit', rng.range(ONCA.sit[0], ONCA.sit[1]));
				else this.enter('idle', rng.range(ONCA.idle[0], ONCA.idle[1]));
		}
	}

	protected finish(_world: AnimalWorld) {
		const motion = this.motion;
		motion.posture = this.state === 'sit' ? 'sit' : this.state === 'rest' ? 'lie' : 'stand';
		motion.fade = ONCA.fade;
		motion.speed = this.#speed;
		motion.lookYaw = this.#lookYaw;
		motion.lookPitch = this.#lookPitch;
	}

	/** Watches a nearby player calmly; otherwise glances around. */
	#attend(dx: number, dz: number, distance: number) {
		const motion = this.motion;
		if (distance < ONCA.watchRadius) {
			this.#lookYaw = wrapAngle(Math.atan2(dx, dz) - motion.yaw);
			this.#lookPitch = clamp(Math.atan2(1.5, distance), 0, 0.3);
			return;
		}
		this.#lookPitch = 0;
		if (this.state === 'move') {
			this.#lookYaw = 0;
			return;
		}
		this.#glance -= this.h;
		if (this.#glance <= 0) {
			this.#glance = this.rng.range(ONCA.glance[0], ONCA.glance[1]);
			this.#lookYaw = this.rng.range(-ONCA.glanceYaw, ONCA.glanceYaw);
		}
	}

	#reverse() {
		this.cursor.direction = -this.cursor.direction;
		this.route.locate(this.cursor);
	}

	#place() {
		this.motion.x = this.cursor.x;
		this.motion.y = this.cursor.y;
		this.motion.z = this.cursor.z;
	}

	/** Planar distance to the player in the last substep, u. */
	get playerDistance(): number {
		return this.#playerDistance;
	}
}
