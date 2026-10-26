/**
 * Onça-pintada (Panthera onca), and the other big-cat trail walkers that share
 * this behaviour: the onça-parda (Puma concolor) and the jaguatirica (Leopardus
 * pardalis), with their own speeds (FELIDS, from species.ts) and activity.
 *
 * The onça-pintada:
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
import { isActive } from './ground.ts';
import { type AnimalWorld, PLAYER_EYES } from './motion.ts';
import { type Route, RouteCursor, StepDistance } from './route.ts';
import { clamp, DEG, wrapAngle } from './scalar.ts';
import { SPECIES } from './species.ts';

export const ONCA_STATES = ['idle', 'move', 'sit', 'rest'] as const;
export type OncaState = (typeof ONCA_STATES)[number];

export interface FelidTuning {
	readonly walkSpeed: number;
	readonly leaveSpeed: number;
	readonly accel: number;
	readonly avoidRadius: number;
	readonly watchRadius: number;
	readonly notice: number;
	readonly move: readonly [number, number];
	readonly idle: readonly [number, number];
	readonly sit: readonly [number, number];
	readonly rest: readonly [number, number];
	readonly glance: readonly [number, number];
	readonly glanceYaw: number;
	readonly fade: number;
}

export const ONCA: FelidTuning = {
	/** Calm walk, u/s (about 0.9 body lengths per second), and a brisker walk when moving off. */
	walkSpeed: 1.8,
	leaveSpeed: 2.3,
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
};

/** The cats that share this behaviour. */
export type FelidSpecies = 'onca-pintada' | 'onca-parda' | 'jaguatirica';

/**
 * The puma and the ocelot: the onça's timings and radii (so the scene's LEVEL.md 15 u
 * mapping applies to them too: they walk away at 15 u like the onça), with walking
 * speeds from their own size by AJ83 (species.ts: the derived walk; leaving 1.3× it).
 */
const felid = (id: 'onca-parda' | 'jaguatirica', extra: Partial<FelidTuning>): FelidTuning => {
	const walk = SPECIES[id].stride.slowSpeed;
	return { ...ONCA, walkSpeed: walk, leaveSpeed: walk * 1.3, ...extra };
};

export const FELIDS: Readonly<Record<FelidSpecies, FelidTuning>> = {
	'onca-pintada': ONCA,
	'onca-parda': felid('onca-parda', {}),
	// Smaller and quicker to settle; rests in thick cover by day (nocturnal).
	jaguatirica: felid('jaguatirica', { fade: 0.4, sit: [4, 10] })
};

/** Outside its active period a cat mostly rests (the jaguatirica by day). */
const OFF_PERIOD_REST = 0.75;

export interface OncaOptions extends BehaviourOptions {
	/** Its trail; closed routes loop, open ones are walked back and forth. */
	route: Route;
	start?: number;
	/** Default 'onca-pintada'. */
	species?: FelidSpecies;
}

export class OncaBehaviour extends Behaviour<OncaState> {
	readonly states = ONCA_STATES;
	readonly tuning: FelidTuning;
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
	#dx = 0;
	#dz = 0;
	#active = true;
	/** The player's eyes above its own, u: what it raises its head by to watch the player. */
	readonly #eyeRise: number;

	constructor(options: OncaOptions) {
		const species = options.species ?? 'onca-pintada';
		super(species, 'idle', options);
		this.tuning = FELIDS[species];
		this.#eyeRise = PLAYER_EYES - this.species.eyeHeight;
		this.route = options.route;
		this.cursor.s = options.start ?? 0;
		this.route.locate(this.cursor);
		this.motion.yaw = this.drive.targetYaw = this.cursor.yaw;
		this.#place();
		this.enter('idle', this.tuning.idle[0]);
	}

	protected sense(world: AnimalWorld) {
		this.#playerX = world.playerX;
		this.#playerZ = world.playerZ;
		this.#active = isActive(this.species.activity, world.light);
	}

	protected advance(_world: AnimalWorld) {
		const h = this.clock.h;
		const motion = this.motion;
		const dx = this.#playerX - motion.x;
		const dz = this.#playerZ - motion.z;
		const distance = Math.sqrt(dx * dx + dz * dz);
		this.#playerDistance = distance;

		// Personal space: after noticing, get up and move off, never toward the player.
		if (distance < this.tuning.avoidRadius) {
			this.#near += h;
			if (this.#near >= this.tuning.notice) {
				const ahead = this.cursor.dx * dx + this.cursor.dz * dz;
				if (this.state !== 'move') {
					if (ahead > 0) this.#reverse();
					this.leaving = true;
					// A fixed duration: this reaction happens at substep granularity, and a draw
					// here would shift the decisions' random sequence between frame rates.
					this.enter('move', this.tuning.move[1]);
				} else if (ahead > 0) {
					this.#reverse();
					this.leaving = true;
				}
			}
		} else {
			this.#near = 0;
			if (distance > this.tuning.avoidRadius * 1.5) this.leaving = false;
		}

		let cruise = 0;
		if (this.state === 'move') cruise = this.leaving ? this.tuning.leaveSpeed : this.tuning.walkSpeed;
		// Cornered at the end of an open trail: stop and watch rather than turn back past the player.
		if (this.leaving && !this.route.closed) {
			const left = this.cursor.direction > 0 ? this.route.length - this.cursor.s : this.cursor.s;
			if (left < this.tuning.walkSpeed * 0.5) cruise = 0;
		}
		// Wait to finish turning around before walking on.
		const aligned = Math.abs(wrapAngle(this.drive.targetYaw - motion.yaw)) < 0.35;
		this.drive.cruise = aligned ? cruise : 0;
		this.drive.rampRate = this.tuning.accel;
		this.ramp();
		this.#speed = this.drive.speed;
		motion.speed = this.drive.speed;
		if (this.drive.travel > 0) {
			const step = this.#advance;
			step.distance = this.drive.travel;
			this.route.advance(this.cursor, step);
			motion.distance += step.distance;
			this.#place();
		}
		this.drive.targetYaw = this.cursor.yaw;
		this.turn();
		this.#dx = dx;
		this.#dz = dz;
		this.#attend();
	}

	protected decide(_world: AnimalWorld) {
		const rng = this.rng;
		if (!this.#active && this.state !== 'rest' && rng.chance(OFF_PERIOD_REST)) {
			this.leaving = false;
			this.enter('rest', rng.range(this.tuning.rest[0], this.tuning.rest[1]) * 2);
			return;
		}
		const roll = rng.next();
		switch (this.state) {
			case 'move':
				this.leaving = false;
				if (roll < 0.6) this.enter('idle', rng.range(this.tuning.idle[0], this.tuning.idle[1]));
				else if (roll < 0.85) this.enter('sit', rng.range(this.tuning.sit[0], this.tuning.sit[1]));
				else this.enter('rest', rng.range(this.tuning.rest[0], this.tuning.rest[1]));
				break;
			case 'idle':
				if (roll < 0.6) this.enter('move', rng.range(this.tuning.move[0], this.tuning.move[1]));
				else if (roll < 0.85) this.enter('sit', rng.range(this.tuning.sit[0], this.tuning.sit[1]));
				else this.enter('rest', rng.range(this.tuning.rest[0], this.tuning.rest[1]));
				break;
			case 'sit':
				if (roll < 0.5) this.enter('idle', rng.range(this.tuning.idle[0], this.tuning.idle[1]));
				else if (roll < 0.8) this.enter('rest', rng.range(this.tuning.rest[0], this.tuning.rest[1]));
				else this.enter('move', rng.range(this.tuning.move[0], this.tuning.move[1]));
				break;
			default:
				if (roll < 0.5) this.enter('sit', rng.range(this.tuning.sit[0], this.tuning.sit[1]));
				else this.enter('idle', rng.range(this.tuning.idle[0], this.tuning.idle[1]));
		}
	}

	protected finish(_world: AnimalWorld) {
		const motion = this.motion;
		motion.posture = this.state === 'sit' ? 'sit' : this.state === 'rest' ? 'lie' : 'stand';
		motion.fade = this.tuning.fade;
		motion.speed = this.#speed;
		motion.lookYaw = this.#lookYaw;
		motion.lookPitch = this.#lookPitch;
	}

	/** Watches a nearby player calmly; otherwise glances around. Reads #dx, #dz, #playerDistance. */
	#attend() {
		const motion = this.motion;
		const dx = this.#dx;
		const dz = this.#dz;
		const distance = this.#playerDistance;
		if (distance < this.tuning.watchRadius) {
			this.#lookYaw = wrapAngle(Math.atan2(dx, dz) - motion.yaw);
			this.#lookPitch = clamp(Math.atan2(this.#eyeRise, distance), 0, 0.3);
			return;
		}
		this.#lookPitch = 0;
		if (this.state === 'move') {
			this.#lookYaw = 0;
			return;
		}
		this.#glance -= this.clock.h;
		if (this.#glance <= 0) {
			this.#glance = this.cosmetic.range(this.tuning.glance[0], this.tuning.glance[1]);
			this.#lookYaw = this.cosmetic.range(-this.tuning.glanceYaw, this.tuning.glanceYaw);
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
