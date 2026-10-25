/**
 * Bugio-ruivo (Alouatta guariba clamitans).
 *
 * Biology it follows:
 * - Slow quadrupedal walking along branches with a diagonal-sequence gait; it
 *   does not brachiate or swing by tail and arms (Cant 1986, Folia Primatol.
 *   46:1–14).
 * - Long rests: a leaf diet gives little energy, and brown howlers spend most
 *   of the day resting (Chiarello 1993, Primates 34:289–293).
 * - The howl: loud long-distance roars, head up, through an enlarged hyoid
 *   (Oliveira & Ades 2004, An. Acad. Bras. Ciênc. 76:393–398; Dunn et al. 2015,
 *   Curr. Biol. 25:2839–2844). Choruses are typical at dawn; the scene can
 *   call howl() then, and it also happens now and then on its own.
 * - Tail-and-hind-feet suspension only while feeding (Cant 1986): the
 *   'feed-hang' state is the only way into that posture, and it always feeds.
 */
import { Behaviour, type BehaviourOptions } from './behaviour.ts';
import type { AnimalWorld } from './motion.ts';
import { type Route, RouteCursor, StepDistance } from './route.ts';
import { approach, DEG } from './scalar.ts';

export const BUGIO_STATES = ['idle', 'move', 'rest', 'howl', 'feed-hang'] as const;
export type BugioState = (typeof BUGIO_STATES)[number];

export const BUGIO = {
	/** Slow walk along the branch, u/s (about half a body length per second), and its ramp. */
	walkSpeed: 0.7,
	accel: 0.8,
	move: [4, 9],
	idle: [3, 7],
	rest: [20, 45],
	howl: [5, 9],
	feed: [8, 16],
	/** Choices from idle, cumulative order: rest, move, feed, howl. */
	restChance: 0.45,
	moveChance: 0.3,
	feedChance: 0.15,
	/** Howling after waking (dawn choruses). */
	wakeHowl: 0.15,
	/** Howl envelope: rise and fall, seconds. */
	howlRamp: 0.6,
	/** Swinging down to feed or back up, seconds. */
	feedFade: 0.7,
	glance: [1.5, 4],
	glanceYaw: 45 * DEG
} as const;

export interface BugioOptions extends BehaviourOptions {
	/** The branch top it walks along (open: back and forth). */
	branch: Route;
	/** Start arc length on the branch. */
	start?: number;
}

export class BugioBehaviour extends Behaviour<BugioState> {
	readonly states = BUGIO_STATES;
	readonly branch: Route;
	readonly cursor = new RouteCursor();
	readonly #advance = new StepDistance();
	#speed = 0;
	#glance = 0;
	#lookYaw = 0;
	#howl = 0;

	constructor(options: BugioOptions) {
		super('bugio-ruivo', 'idle', options);
		this.branch = options.branch;
		this.cursor.s = options.start ?? 0;
		this.branch.locate(this.cursor);
		this.motion.yaw = this.targetYaw = this.cursor.yaw;
		this.#place();
		this.enter('idle', BUGIO.idle[0]);
	}

	/** Starts a howl now (dawn chorus, a mission beat). Ignored while feeding upside down. */
	howl(duration: number = BUGIO.howl[0]) {
		if (this.state === 'feed-hang') return false;
		this.enter('howl', duration);
		return true;
	}

	protected advance(_world: AnimalWorld) {
		const h = this.h;
		const motion = this.motion;
		this.cruise = this.state === 'move' ? BUGIO.walkSpeed : 0;
		this.rampRate = BUGIO.accel;
		this.ramp();
		this.#speed = this.speed;
		motion.speed = this.speed;
		if (this.travel > 0) {
			const step = this.#advance;
			step.distance = this.travel;
			this.branch.advance(this.cursor, step);
			motion.distance += step.distance;
			this.#place();
		}
		this.targetYaw = this.cursor.yaw;
		if (this.state !== 'feed-hang') this.turn();
		// Howl envelope rises while howling and fades after.
		this.#howl = approach(this.#howl, this.state === 'howl' ? 1 : 0, h / BUGIO.howlRamp);
		if (this.state === 'idle') {
			this.#glance -= h;
			if (this.#glance <= 0) {
				this.#glance = this.cosmetic.range(BUGIO.glance[0], BUGIO.glance[1]);
				this.#lookYaw = this.cosmetic.range(-BUGIO.glanceYaw, BUGIO.glanceYaw);
			}
		} else this.#lookYaw = 0;
	}

	protected decide(_world: AnimalWorld) {
		const rng = this.rng;
		switch (this.state) {
			case 'idle': {
				const roll = rng.next();
				if (roll < BUGIO.restChance) this.enter('rest', rng.range(BUGIO.rest[0], BUGIO.rest[1]));
				else if (roll < BUGIO.restChance + BUGIO.moveChance)
					this.enter('move', rng.range(BUGIO.move[0], BUGIO.move[1]));
				else if (roll < BUGIO.restChance + BUGIO.moveChance + BUGIO.feedChance)
					this.enter('feed-hang', rng.range(BUGIO.feed[0], BUGIO.feed[1]));
				else this.enter('howl', rng.range(BUGIO.howl[0], BUGIO.howl[1]));
				break;
			}
			case 'rest':
				if (rng.chance(BUGIO.wakeHowl)) this.enter('howl', rng.range(BUGIO.howl[0], BUGIO.howl[1]));
				else this.enter('idle', rng.range(BUGIO.idle[0], BUGIO.idle[1]));
				break;
			default:
				this.enter('idle', rng.range(BUGIO.idle[0], BUGIO.idle[1]));
		}
	}

	protected finish(_world: AnimalWorld) {
		const motion = this.motion;
		const state = this.state;
		motion.posture =
			state === 'rest' ? 'lie' : state === 'howl' ? 'howl' : state === 'feed-hang' ? 'feed-hang' : 'stand';
		motion.fade = state === 'feed-hang' || motion.posture === 'stand' ? BUGIO.feedFade : 0.4;
		motion.feeding = state === 'feed-hang';
		motion.eat = motion.feeding ? 1 : 0;
		motion.howl = this.#howl;
		motion.speed = this.#speed;
		motion.lookYaw = this.#lookYaw;
		motion.lookPitch = state === 'howl' ? 15 * DEG : 0;
	}

	#place() {
		this.motion.x = this.cursor.x;
		this.motion.y = this.cursor.y;
		this.motion.z = this.cursor.z;
	}
}
