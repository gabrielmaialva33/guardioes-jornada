/**
 * The P23 ground species: capivara, anta (and calf), cateto, veado-mateiro,
 * cachorro-do-mato, tapiti, caranguejo-uçá, tatu-galinha, jabuti-tinga,
 * sapo-cururu and the wading colhereiro. One behaviour, tuned per species in GROUND.
 *
 * Like the onça (onca.ts), each walks a route laid out by the scene (a loop on
 * the forest floor, a river bank, a trail, a mud flat) and moves along it with
 * the walk and run of its species (species.ts, derived from measures.ts by
 * AJ83). Its states:
 * - idle (glancing around), graze (grazing, rooting, sniffing, pecking or
 *   probing: the head goes down and bobs), move, rest (lying), sit;
 * - alert: it stops and watches a player inside `alertRadius`;
 * - flee: inside `reactRadius`, after `notice` seconds, it runs (or walks
 *   briskly, reaction 'leave') along its route away from the player, never
 *   toward, and stops when cornered at the end of an open route, as the onça;
 * - hide: the tortoise withdraws into its shell, the crab backs into its burrow
 *   (it sinks into the mud) until the player has gone.
 * Reactions happen at substep granularity with fixed durations and no random
 * draw, so a frame-rate change never shifts the decisions (behaviour.ts).
 *
 * Swimming: a route point may be in water (the capivara's and the anta's bank
 * routes dip into the river); there the scene sets the route at the waterline
 * and the animal swims (posture 'swim', a slow bob).
 *
 * Herds: members of one Herd (the capivara family, the cateto band, the anta
 * and her calf, the guarás) keep their places along parallel routes relative
 * to the first member, the leader; when the leader moves or flees the others
 * follow, and a threat to any member alarms the leader. Between moves each
 * makes its own idle, graze and rest choices. The scene updates herd members
 * in one LOD slot so they step in the same frames.
 *
 * Activity: outside its active period (measures.ts; AnimalWorld.light) an
 * animal mostly rests, as the nocturnal anta, tapiti and sapo do by day.
 *
 * The colhereiro feeds walking slowly through the shallows, sweeping its bill
 * side to side (graze with `sweep`), and its flock flies in at dusk: when the
 * light turns to `arrives` (or the scene calls Herd.arrive / arrive), each bird
 * flies in from afar along its approach and lands on its wading line.
 */
import { Behaviour, type BehaviourOptions } from './behaviour.ts';
import type { Activity } from './measures.ts';
import { type AnimalWorld, type Light, PLAYER_EYES } from './motion.ts';
import type { Posture } from './postures.ts';
import { type Route, RouteCursor, StepDistance } from './route.ts';
import { DEG, TAU } from './scalar.ts';
import type { SpeciesId } from './species.ts';

export const GROUND_STATES = [
	'idle',
	'graze',
	'move',
	'rest',
	'sit',
	'alert',
	'flee',
	'hide',
	'arrive'
] as const;
export type GroundState = (typeof GROUND_STATES)[number];

/** The ground species this behaviour drives. */
export type GroundSpecies =
	| 'capivara'
	| 'anta'
	| 'anta-filhote'
	| 'cateto'
	| 'veado-mateiro'
	| 'cachorro-do-mato'
	| 'tapiti'
	| 'caranguejo-uca'
	| 'tatu-galinha'
	| 'jabuti-tinga'
	| 'sapo-cururu'
	| 'colhereiro';

export type Reaction = 'flee' | 'leave' | 'hide';

export interface GroundTuning {
	/** What it does when the player comes inside `reactRadius` (u) for `notice` seconds. */
	readonly reaction: Reaction;
	readonly reactRadius: number;
	/** Stops and watches inside this (u). */
	readonly alertRadius: number;
	readonly notice: number;
	/** Seconds of flight; seconds hidden after the player has left reactRadius × 1.3. */
	readonly fleeTime: number;
	readonly hideTime: number;
	/** Seconds an alert lasts once the player is out of alertRadius. */
	readonly alertTime: number;
	/** Durations (s) of each state, drawn when it is chosen. */
	readonly idle: readonly [number, number];
	readonly graze: readonly [number, number];
	readonly move: readonly [number, number];
	readonly rest: readonly [number, number];
	readonly sit: readonly [number, number];
	/** Choices from idle, relative weights. */
	readonly choose: {
		readonly graze: number;
		readonly move: number;
		readonly rest: number;
		readonly sit: number;
	};
	/** Brisk-walk factor for 'leave' (× the walk speed) and the speed ramp, u/s². */
	readonly leaveFactor: number;
	readonly accel: number;
	/** Glances while idle or grazing: interval (s) and reach (rad). */
	readonly glance: readonly [number, number];
	readonly glanceYaw: number;
	/** Faces 90° off its path and walks sideways (crabs). */
	readonly sideways: boolean;
	/** Sinks this share of its height when hidden (a crab backing into its burrow). */
	readonly sink: number;
	/** Posture crossfade, s. */
	readonly fade: number;
	/** Feeding: walks on at this share of its walk speed while grazing (0: stands), sweeping the head side to side by `sweep` (rad) every `sweepPeriod` s (0: no sweep). */
	readonly grazeWalk: number;
	readonly sweep: number;
	readonly sweepPeriod: number;
	/** The light its flock flies in at (null: never), and the approach: distance back along its line and height (u), flight speed (u/s), wingbeats per second, delay between birds (s). */
	readonly arrives: Light | null;
	readonly arrival: {
		readonly distance: number;
		readonly height: number;
		readonly speed: number;
		readonly flapRate: number;
		readonly stagger: number;
	};
}

const BASE: GroundTuning = {
	reaction: 'flee',
	reactRadius: 8,
	alertRadius: 12,
	notice: 0.6,
	fleeTime: 4,
	hideTime: 4,
	alertTime: 2.5,
	idle: [2, 5],
	graze: [4, 10],
	move: [4, 9],
	rest: [12, 30],
	sit: [5, 12],
	choose: { graze: 0.4, move: 0.35, rest: 0.15, sit: 0 },
	leaveFactor: 1.4,
	accel: 2,
	glance: [1.5, 4],
	glanceYaw: 50 * DEG,
	sideways: false,
	sink: 0,
	fade: 0.4,
	grazeWalk: 0,
	sweep: 0,
	sweepPeriod: 1,
	arrives: null,
	arrival: { distance: 24, height: 9, speed: 6, flapRate: 3, stagger: 0.8 }
};

/**
 * Per-species tuning. Reaction distances are game choices sized to the 160 u Reserva,
 * except the veado's 15 u (the brief); the behaviours follow the sources in the report:
 * capybaras graze and take to the water, tapirs browse and are night-active, peccaries
 * root in bands, brockets leap away and freeze, the crab-eating fox trots off, rabbits
 * sit up then bound away, the crab backs into its burrow, the armadillo digs and runs,
 * the tortoise (the forest jabuti-tinga) withdraws, the toad sits and waits, the ibis wades and probes.
 */
export const GROUND: Readonly<Record<GroundSpecies, GroundTuning>> = {
	capivara: {
		...BASE,
		reactRadius: 6,
		alertRadius: 10,
		graze: [6, 14],
		rest: [15, 35],
		choose: { graze: 0.5, move: 0.25, rest: 0.15, sit: 0.1 }
	},
	anta: {
		...BASE,
		reactRadius: 8,
		alertRadius: 13,
		graze: [6, 12],
		move: [5, 10],
		choose: { graze: 0.5, move: 0.35, rest: 0.15, sit: 0 }
	},
	'anta-filhote': {
		...BASE,
		reactRadius: 8,
		alertRadius: 13,
		choose: { graze: 0.35, move: 0.25, rest: 0.4, sit: 0 }
	},
	cateto: {
		...BASE,
		reactRadius: 8,
		alertRadius: 12,
		notice: 0.4,
		graze: [5, 12],
		choose: { graze: 0.6, move: 0.3, rest: 0.1, sit: 0 }
	},
	'veado-mateiro': {
		...BASE,
		reactRadius: 15,
		alertRadius: 22,
		notice: 0.5,
		fleeTime: 5,
		alertTime: 3.5,
		choose: { graze: 0.5, move: 0.35, rest: 0.15, sit: 0 }
	},
	'cachorro-do-mato': {
		...BASE,
		reaction: 'leave',
		reactRadius: 9,
		alertRadius: 14,
		fleeTime: 6,
		choose: { graze: 0.4, move: 0.35, rest: 0.1, sit: 0.15 }
	},
	tapiti: {
		...BASE,
		reactRadius: 6,
		alertRadius: 9,
		fleeTime: 3,
		idle: [1.5, 4],
		graze: [3, 8],
		move: [1.5, 4],
		choose: { graze: 0.55, move: 0.3, rest: 0.15, sit: 0 }
	},
	'caranguejo-uca': {
		...BASE,
		reaction: 'hide',
		reactRadius: 4.5,
		alertRadius: 7,
		notice: 0.25,
		hideTime: 5,
		idle: [1, 3],
		graze: [3, 8],
		move: [1, 3],
		choose: { graze: 0.5, move: 0.5, rest: 0, sit: 0 },
		accel: 6,
		sideways: true,
		sink: 1.15,
		fade: 0.25
	},
	'tatu-galinha': {
		...BASE,
		reactRadius: 5,
		alertRadius: 8,
		notice: 0.3,
		fleeTime: 3,
		graze: [5, 12],
		choose: { graze: 0.55, move: 0.35, rest: 0.1, sit: 0 }
	},
	'jabuti-tinga': {
		...BASE,
		reaction: 'hide',
		reactRadius: 3.5,
		alertRadius: 6,
		notice: 0.8,
		hideTime: 6,
		idle: [3, 8],
		graze: [8, 20],
		move: [8, 20],
		rest: [20, 45],
		choose: { graze: 0.45, move: 0.35, rest: 0.2, sit: 0 },
		accel: 0.3,
		fade: 0.8
	},
	'sapo-cururu': {
		...BASE,
		reaction: 'leave',
		reactRadius: 3,
		alertRadius: 5,
		notice: 1,
		fleeTime: 2.5,
		idle: [3, 10],
		graze: [0.5, 1],
		move: [1, 2.5],
		choose: { graze: 0.35, move: 0.3, rest: 0.35, sit: 0 },
		leaveFactor: 1.6,
		accel: 4
	},
	// Colhereiros sift the shallows walking slowly and swinging the bill side to side (WikiAves:
	// "peneira a água, sacudindo e mergulhando o bico"), live in flocks, and the flock flies in at
	// dusk (coordinator's brief). A large bird: about 3 wingbeats a second (estimate).
	colhereiro: {
		...BASE,
		reaction: 'leave',
		reactRadius: 8,
		alertRadius: 12,
		graze: [6, 14],
		move: [3, 7],
		choose: { graze: 0.7, move: 0.3, rest: 0, sit: 0 },
		grazeWalk: 0.35,
		sweep: 35 * DEG,
		sweepPeriod: 1.2,
		arrives: 'dusk'
	}
};

/** True when a species is in its active period under this light. */
export function isActive(activity: Activity, light: Light): boolean {
	switch (activity) {
		case 'diurnal':
			return light !== 'night';
		case 'nocturnal':
			return light !== 'day';
		case 'crepuscular':
			return light !== 'day';
		default:
			return true;
	}
}

/** Outside its active period, the chance that an idle choice is rest (and rests last this much longer). */
const OFF_PERIOD_REST = 0.75;
const OFF_PERIOD_LONGER = 2;

/** The waterline bob of a swimmer: amplitude (share of its height) and period (s); decorative. */
const SWIM_BOB = { share: 0.015, period: 2.4 } as const;

/**
 * A group that moves together. Members join in creation order; the first is the
 * leader. Each member's route runs parallel to the leader's (the scene offsets it
 * sideways), and `offset` (u along the route) is its place relative to the leader.
 */
export class Herd {
	readonly members: GroundBehaviour[] = [];
	/** A member saw the player inside its reaction radius: where the player was. */
	alarmed = false;
	alarmX = 0;
	alarmZ = 0;

	get leader(): GroundBehaviour | null {
		return this.members[0] ?? null;
	}

	/** Gap gain (1/s) that pulls a follower back to its place, and the slack it allows (u). */
	static readonly GAIN = 1.2;
	static readonly SLACK = 0.5;

	/** The flock flies in now: every member from afar, one after another (the scene's dusk, a mission beat). */
	arrive() {
		this.members.forEach((member, rank) => {
			member.arrive(rank * member.tuning.arrival.stagger);
		});
	}
}

export interface GroundOptions extends BehaviourOptions {
	species: GroundSpecies;
	/** Its route: a loop or a trail, feet points (the waterline where it swims). */
	route: Route;
	/** Per route point: 1 where the point is in water (the animal swims there), else 0. */
	water?: ArrayLike<number> | null;
	start?: number;
	herd?: Herd | null;
	/** Place along the route relative to the herd leader, u (followers only). */
	offset?: number;
}

export class GroundBehaviour extends Behaviour<GroundState> {
	readonly states = GROUND_STATES;
	readonly tuning: GroundTuning;
	readonly route: Route;
	readonly cursor = new RouteCursor();
	readonly herd: Herd | null;
	/** Place relative to the herd leader along the route, u. */
	readonly offset: number;
	/** Swimming in the last update. */
	swimming = false;
	/** Hidden share, 0..1 (the crab's sink, the tortoise's withdrawal). */
	hidden = 0;
	/** Signed travel speed along the route direction (+ along cursor.direction), u/s: what followers read. */
	speed = 0;
	/** Planar distance to the player in the last substep, u. */
	playerDistance = Number.POSITIVE_INFINITY;
	readonly #water: Float64Array | null;
	readonly #advance = new StepDistance();
	readonly #walkSpeed: number;
	readonly #runSpeed: number;
	readonly #eyeRise: number;
	#near = 0;
	#glance = 0;
	#lookYaw = 0;
	#lookPitch = 0;
	#playerX = 0;
	#playerZ = 0;
	#active = true;
	#fleeSpeed = 0;
	#bob = 0;
	#follow = false;
	#dx = 0;
	#dz = 0;
	/** The arrival flight: where it starts, its peak and its landing (x, y, z each), its delay and length. */
	readonly #flight = new Float64Array(9);
	#flightDelay = 0;
	#flightTime = 1;
	#lastLight: Light | null = null;
	#flapping = 0;

	constructor(options: GroundOptions) {
		super(options.species, 'idle', options);
		this.tuning = GROUND[options.species];
		this.route = options.route;
		this.#water =
			options.water && options.water.length > 0
				? Float64Array.from(options.water, (w) => (w > 0 ? 1 : 0))
				: null;
		this.herd = options.herd ?? null;
		this.offset = options.offset ?? 0;
		this.herd?.members.push(this);
		this.#walkSpeed = this.species.stride.slowSpeed;
		this.#runSpeed = this.species.run ? this.species.stride.fastSpeed : this.#walkSpeed * 1.5;
		this.#eyeRise = PLAYER_EYES - this.species.eyeHeight;
		this.cursor.s = options.start ?? 0;
		this.route.locate(this.cursor);
		this.motion.yaw = this.drive.targetYaw = this.#facing();
		this.#place();
		this.enter('idle', this.tuning.idle[0]);
	}

	/** Walk and run speeds, u/s (tests, debug). */
	get walkSpeed(): number {
		return this.#walkSpeed;
	}

	get runSpeed(): number {
		return this.#runSpeed;
	}

	/** True when it follows its herd leader this update. */
	get following(): boolean {
		return this.#follow;
	}

	/**
	 * Flies in from afar after `delay` seconds and lands where it stands on its route: the
	 * approach starts `arrival.distance` back along its line and `arrival.height` up. A fixed
	 * duration, no random draw (the scene or the dusk triggers it, at any frame rate alike).
	 */
	arrive(delay = 0) {
		const a = this.tuning.arrival;
		const c = this.cursor;
		const f = this.#flight;
		f[6] = c.x;
		f[7] = c.y;
		f[8] = c.z;
		f[0] = c.x - c.dx * a.distance;
		f[1] = c.y + a.height;
		f[2] = c.z - c.dz * a.distance;
		f[3] = (f[0] + f[6]) / 2;
		f[4] = Math.max(f[1], f[7]) + a.height * 0.3;
		f[5] = (f[2] + f[8]) / 2;
		const span = Math.sqrt(a.distance * a.distance + a.height * a.height);
		this.#flightDelay = Math.max(0, delay);
		this.#flightTime = Math.max(0.5, (span * 1.15) / a.speed);
		this.#follow = false;
		this.enter('arrive', this.#flightDelay + this.#flightTime);
		this.#placeFlight();
	}

	/** Seconds the current arrival has left (0 when it is not arriving). */
	get arriving(): number {
		return this.state === 'arrive' ? this.clock.timer : 0;
	}

	protected sense(world: AnimalWorld) {
		this.#playerX = world.playerX;
		this.#playerZ = world.playerZ;
		this.#active = isActive(this.species.activity, world.light);
		// The flock flies in when the light turns to its arrival light (the leader calls it for all).
		const arrives = this.tuning.arrives;
		if (
			arrives !== null &&
			this.#lastLight !== null &&
			world.light !== this.#lastLight &&
			world.light === arrives
		) {
			const herd = this.herd;
			if (herd === null) this.arrive();
			else if (herd.leader === this) herd.arrive();
		}
		this.#lastLight = world.light;
	}

	protected advance(_world: AnimalWorld) {
		if (this.state === 'arrive') {
			this.#placeFlight();
			return;
		}
		const h = this.clock.h;
		const motion = this.motion;
		const tuning = this.tuning;
		const dx = this.#playerX - motion.x;
		const dz = this.#playerZ - motion.z;
		const distance = Math.sqrt(dx * dx + dz * dz);
		this.playerDistance = Number.isFinite(distance) ? distance : Number.POSITIVE_INFINITY;
		const herd = this.herd;
		const leader = herd?.leader ?? null;
		const isLeader = leader === this || leader === null;

		// Threat: notice, then react (a follower alarms its herd; the leader reacts for everyone).
		if (this.playerDistance < tuning.reactRadius) {
			this.#near += h;
			if (this.#near >= tuning.notice) {
				if (herd && !isLeader) {
					herd.alarmed = true;
					herd.alarmX = this.#playerX;
					herd.alarmZ = this.#playerZ;
				} else this.#react(this.#playerX, this.#playerZ);
			}
		} else {
			this.#near = 0;
			if (this.state === 'alert' && this.playerDistance > tuning.alertRadius) {
				// Settles after alertTime outside the radius (the timer then runs out into a decision).
				if (this.clock.timer > tuning.alertTime) this.clock.timer = tuning.alertTime;
			}
		}
		if (isLeader && herd?.alarmed) {
			herd.alarmed = false;
			this.#react(herd.alarmX, herd.alarmZ);
		}
		// Watching: a calm animal inside alertRadius stops and looks (not a fleeing or hidden one).
		if (
			this.playerDistance < tuning.alertRadius &&
			this.state !== 'alert' &&
			this.state !== 'flee' &&
			this.state !== 'hide' &&
			!this.#follow
		)
			this.enter('alert', tuning.alertTime + 2);
		// Hidden until the player has gone: the timer restarts while the player is near.
		if (this.state === 'hide' && this.playerDistance < tuning.reactRadius * 1.3)
			this.clock.timer = tuning.hideTime;

		this.#followStep(leader, isLeader);

		let cruise = 0;
		if (this.#follow) cruise = this.drive.cruise;
		else if (this.state === 'move') cruise = this.#walkSpeed;
		else if (this.state === 'graze') cruise = this.#walkSpeed * tuning.grazeWalk;
		else if (this.state === 'flee') cruise = this.#fleeSpeed;
		// Cornered at the end of an open route: stop and watch rather than turn back past the player.
		if (this.state === 'flee' && !this.route.closed) {
			const left = this.cursor.direction > 0 ? this.route.length - this.cursor.s : this.cursor.s;
			if (left < this.#walkSpeed * 0.5) cruise = 0;
		}
		// Wait to finish turning around before moving on.
		let delta = this.drive.targetYaw - motion.yaw;
		delta -= TAU * Math.round(delta / TAU);
		this.drive.cruise = Math.abs(delta) < 0.35 ? cruise : 0;
		this.drive.rampRate = this.state === 'flee' ? tuning.accel * 2 : tuning.accel;
		this.ramp();
		motion.speed = this.drive.speed;
		this.speed = this.drive.speed;
		if (this.drive.travel > 0) {
			const step = this.#advance;
			step.distance = this.drive.travel;
			this.route.advance(this.cursor, step);
			motion.distance += step.distance;
		}
		this.#place();
		this.drive.targetYaw = this.#facing();
		this.turn();

		// Hidden share eases in and out (the crab sinks, the tortoise draws in).
		const rate = h / Math.max(0.05, tuning.fade);
		if (this.state === 'hide') this.hidden = Math.min(1, this.hidden + rate);
		else this.hidden = Math.max(0, this.hidden - rate);
		this.#dx = dx;
		this.#dz = dz;
		this.#attend();
	}

	protected decide(_world: AnimalWorld) {
		if (this.state === 'arrive') {
			// Landed on its line.
			this.#placeFlight();
			this.enter('idle', this.tuning.idle[0]);
			return;
		}
		if (this.#follow) {
			// Following: no own decisions until the leader stops.
			this.enter(this.state, 1);
			return;
		}
		const tuning = this.tuning;
		const rng = this.rng;
		switch (this.state) {
			case 'flee':
				this.enter('alert', tuning.alertTime);
				return;
			case 'hide':
			case 'alert':
			case 'move':
			case 'graze':
			case 'rest':
			case 'sit':
				if (this.state !== 'move' && this.state !== 'hide' && this.state !== 'alert' && rng.chance(0.5))
					this.#choose();
				else this.enter('idle', rng.range(tuning.idle[0], tuning.idle[1]));
				return;
			default:
				this.#choose();
		}
	}

	protected finish(_world: AnimalWorld) {
		const motion = this.motion;
		const state = this.state;
		this.swimming = this.#inWater();
		let posture: Posture = 'stand';
		// In flight (the arrival): flapping, then gliding the last quarter in.
		const flying = state === 'arrive' && this.clock.inState >= this.#flightDelay;
		if (flying) {
			const u = (this.clock.inState - this.#flightDelay) / this.#flightTime;
			this.#flapping = u < 0.75 ? 1 : 0;
		} else this.#flapping = 0;
		motion.flap = this.#flapping;
		motion.flapRate = this.tuning.arrival.flapRate;
		motion.wingsClosed = 0;
		motion.pitch = 0;
		motion.bank = 0;
		if (state === 'arrive') posture = 'fly';
		else if (state === 'hide') posture = 'withdraw';
		else if (this.swimming) posture = 'swim';
		else if (state === 'graze') posture = 'graze';
		else if (state === 'rest') posture = 'lie';
		else if (state === 'sit') posture = 'sit';
		else if (state === 'alert') posture = 'alert';
		motion.posture = posture;
		motion.fade = this.tuning.fade;
		motion.eat = state === 'graze' && !this.swimming ? 1 : 0;
		motion.feeding = false;
		motion.speed = this.drive.speed;
		motion.lookYaw = this.#lookYaw;
		motion.lookPitch = this.#lookPitch;
		// The waterline bob (decorative) and the burrow sink.
		const size = this.species.size;
		if (this.swimming && !this.reducedMotion) {
			this.#bob = SWIM_BOB.share * size * Math.sin((TAU * this.clock.total) / SWIM_BOB.period);
			motion.y += this.#bob;
		} else this.#bob = 0;
		if (this.tuning.sink > 0 && this.hidden > 0) {
			const t = this.hidden;
			motion.y -= this.tuning.sink * size * t * t * (3 - 2 * t);
		}
	}

	/** Moves off from a threat at (x, z): flee (run) or leave (brisk walk) away from it, or hide. */
	#react(x: number, z: number) {
		const tuning = this.tuning;
		if (tuning.reaction === 'hide') {
			if (this.state !== 'hide') this.enter('hide', tuning.hideTime);
			return;
		}
		const ahead = this.cursor.dx * (x - this.motion.x) + this.cursor.dz * (z - this.motion.z);
		if (ahead > 0) this.#reverse();
		this.#fleeSpeed = tuning.reaction === 'flee' ? this.#runSpeed : this.#walkSpeed * tuning.leaveFactor;
		// A fixed duration: this happens at substep granularity (see the module comment).
		if (this.state !== 'flee') this.enter('flee', tuning.fleeTime);
		else this.clock.timer = tuning.fleeTime;
		// The herd follows its leader: their direction flips with it.
		const herd = this.herd;
		if (herd && herd.leader === this)
			for (let i = 1; i < herd.members.length; i++) {
				const member = herd.members[i];
				if (member.cursor.direction !== this.cursor.direction) member.#reverse();
			}
	}

	/** A follower keeps its place relative to the leader while the leader moves. */
	#followStep(leader: GroundBehaviour | null, isLeader: boolean) {
		if (isLeader || leader === null || leader.state === 'arrive') {
			this.#follow = false;
			return;
		}
		const leaderMoving = leader.state === 'move' || leader.state === 'flee' || leader.drive.speed > 0.05;
		// Target arc: the leader's share of its route mapped onto this one, plus the place.
		const ratio = leader.route.length > 0 ? this.route.length / leader.route.length : 1;
		let gap = leader.cursor.s * ratio + this.offset - this.cursor.s;
		if (this.route.closed && this.route.length > 0)
			gap -= this.route.length * Math.round(gap / this.route.length);
		const slack = Herd.SLACK;
		if (!leaderMoving && Math.abs(gap) < slack * 2) {
			if (this.#follow) {
				this.#follow = false;
				this.enter('idle', this.rng.range(this.tuning.idle[0], this.tuning.idle[1]));
			}
			return;
		}
		if (this.state === 'hide') return;
		// Signed speed along the route's +s: the leader's, plus a pull toward the place.
		const leaderVelocity = leader.drive.speed * leader.cursor.direction * ratio;
		let velocity = leaderVelocity + Herd.GAIN * (Math.abs(gap) > slack ? gap : 0);
		const most = Math.max(this.#runSpeed, leader.drive.speed * ratio * 1.25);
		velocity = Math.min(most, Math.max(-most, velocity));
		const direction = velocity >= 0 ? 1 : -1;
		if (Math.abs(velocity) > 0.05 && direction !== this.cursor.direction) this.#reverse();
		this.drive.cruise = Math.abs(velocity);
		const fleeing = leader.state === 'flee';
		if (!this.#follow || (fleeing && this.state !== 'flee') || (!fleeing && this.state === 'flee')) {
			this.#follow = true;
			this.enter(fleeing ? 'flee' : 'move', 1);
		}
	}

	#choose() {
		const tuning = this.tuning;
		const rng = this.rng;
		const c = tuning.choose;
		if (!this.#active && rng.chance(OFF_PERIOD_REST)) {
			this.enter('rest', rng.range(tuning.rest[0], tuning.rest[1]) * OFF_PERIOD_LONGER);
			return;
		}
		const total = c.graze + c.move + c.rest + c.sit;
		const roll = rng.next() * (total > 0 ? total : 1);
		if (roll < c.graze) this.enter('graze', rng.range(tuning.graze[0], tuning.graze[1]));
		else if (roll < c.graze + c.move) this.enter('move', rng.range(tuning.move[0], tuning.move[1]));
		else if (roll < c.graze + c.move + c.rest) this.enter('rest', rng.range(tuning.rest[0], tuning.rest[1]));
		else if (c.sit > 0) this.enter('sit', rng.range(tuning.sit[0], tuning.sit[1]));
		else this.enter('idle', rng.range(tuning.idle[0], tuning.idle[1]));
	}

	/** Watches a nearby player (alert, hidden); otherwise glances around while still. Reads #dx, #dz. */
	#attend() {
		const dx = this.#dx;
		const dz = this.#dz;
		const state = this.state;
		const distance = this.playerDistance;
		if ((state === 'alert' || state === 'hide') && Number.isFinite(distance)) {
			let yaw = Math.atan2(dx, dz) - this.motion.yaw;
			yaw -= TAU * Math.round(yaw / TAU);
			this.#lookYaw = yaw;
			const pitch = Math.atan2(this.#eyeRise, Math.max(0.5, distance));
			this.#lookPitch = Math.min(0.4, Math.max(0, pitch));
			return;
		}
		this.#lookPitch = 0;
		if (state === 'move' || state === 'flee' || state === 'rest' || state === 'arrive') {
			this.#lookYaw = 0;
			return;
		}
		// The spoonbill's sweep: the head swings side to side through the water while it feeds.
		const sweep = this.tuning.sweep;
		if (state === 'graze' && sweep > 0) {
			this.#lookYaw = sweep * Math.sin((TAU * this.clock.total) / this.tuning.sweepPeriod);
			return;
		}
		this.#glance -= this.clock.h;
		if (this.#glance <= 0) {
			this.#glance = this.cosmetic.range(this.tuning.glance[0], this.tuning.glance[1]);
			this.#lookYaw = this.cosmetic.range(-this.tuning.glanceYaw, this.tuning.glanceYaw);
		}
	}

	/** Places the bird on its arrival curve (waiting at the start until its delay is over). */
	#placeFlight() {
		const f = this.#flight;
		const t = this.clock.inState - this.#flightDelay;
		const u = Math.min(1, Math.max(0, t / this.#flightTime));
		const a = (1 - u) * (1 - u);
		const b = 2 * u * (1 - u);
		const d = u * u;
		const motion = this.motion;
		motion.x = a * f[0] + b * f[3] + d * f[6];
		motion.y = a * f[1] + b * f[4] + d * f[7];
		motion.z = a * f[2] + b * f[5] + d * f[8];
		// Facing along the path (toward the landing).
		const vx = 2 * (1 - u) * (f[3] - f[0]) + 2 * u * (f[6] - f[3]);
		const vz = 2 * (1 - u) * (f[5] - f[2]) + 2 * u * (f[8] - f[5]);
		if (vx !== 0 || vz !== 0) motion.yaw = this.drive.targetYaw = Math.atan2(vx, vz);
		motion.speed = 0;
	}

	#facing(): number {
		const yaw = this.cursor.yaw + (this.tuning.sideways ? Math.PI / 2 : 0);
		return yaw - TAU * Math.round(yaw / TAU);
	}

	#inWater(): boolean {
		const water = this.#water;
		if (water === null) return false;
		const n = this.route.count;
		const i = this.cursor.segment;
		const a = water[Math.min(i, n - 1)];
		const b = water[this.route.closed ? (i + 1) % n : Math.min(i + 1, n - 1)];
		const span = this.route.lengths[i + 1] - this.route.lengths[i];
		const t = span > 0 ? (this.cursor.s - this.route.lengths[i]) / span : 0;
		return a + (b - a) * t >= 0.5;
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
}

/** The species GroundBehaviour drives (tests, the scene's factory). */
export const GROUND_SPECIES = Object.keys(GROUND) as GroundSpecies[];

/** True for a species GroundBehaviour drives. */
export const isGroundSpecies = (id: SpeciesId): id is GroundSpecies => id in GROUND;
