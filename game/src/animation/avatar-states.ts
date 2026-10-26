/**
 * Roblox's Animate script as a state machine: which state plays and the
 * crossfade weight of every state's slot, nothing about poses.
 *
 * Fades work like AnimationTrack:Play/Stop(fadeTime): on a change, every slot
 * moves linearly from its current weight to its target (1 for the new state, 0
 * for the others) over the new state's fade time, so the weights always sum to 1.
 * An event counts from the start of the update that sees it; a timer that runs
 * out mid-update (the 0.31 s jump hold, the ledge delay) starts its fade at the
 * exact moment, so timings do not depend on the frame rate.
 *
 * There is no landing state: touching down goes straight to walk/run or idle
 * with their 0.2 s fade, and the landing spring is a procedural layer.
 */
import { COYOTE_TIME, JUMP_SPEED, STUD } from '../engine/constants.ts';
import { ANIMATE } from './animate-timings.ts';
import { EMOTES, type EmoteId } from './avatar-poses.ts';

export const SLOTS = ['idle', 'walk', 'jump', 'fall', 'climb', 'swim', 'sit', 'emote'] as const;

/** 'walk' is the walk/run blend. */
export type AvatarState = (typeof SLOTS)[number];

const IDLE = 0;
const WALK = 1;
const JUMP = 2;
const FALL = 3;
const CLIMB = 4;
const SWIM = 5;
const SIT = 6;
const EMOTE = 7;

/** Index of each state in SLOTS and `weights`. */
export const SLOT_INDEX = Object.fromEntries(SLOTS.map((slot, i) => [slot, i])) as Readonly<
	Record<AvatarState, number>
>;

/** Longest update honoured; a resumed tab does not fast-forward gestures. */
export const MAX_DT = 0.25;
/** Stick intent above this cancels an emote even against a wall. */
const INTENT_DEADZONE = 0.05;
/** An upward speed gain this big in one update is a jump (also a coyote jump), never gravity. */
const JUMP_IMPULSE = JUMP_SPEED * 0.25;
/** World units/s. */
const JUMP_MIN_SPEED = 1;

/** Ground under the feet, for the contextual locomotion layer (avatar-animator.ts). */
export type Surface = 'ground' | 'narrow' | 'water';

/** What the engine's character reports each update. */
export interface MotionInput {
	/** Horizontal speed actually covered after collision, world units/s (Character.planarSpeed). */
	speed: number;
	/** Stick or key intent, 0..1. Only cancels emotes; it never moves the walk cycle. */
	intent: number;
	grounded: boolean;
	/** World units/s, up positive (Character.velocity.y). */
	verticalSpeed: number;
	/** Seconds since the feet left the ground, 0 while grounded. */
	airTime: number;
	/** A jump impulse since the last update (Character.events.jumped); upward impulses are also detected. */
	jumped: boolean;
	climbing: boolean;
	swimming: boolean;
	sitting: boolean;
	/**
	 * Optional context; the state machine ignores it, the animator's layers read it.
	 * 'narrow': river stones, the bridge, a log (arms out, short steps, a wobble);
	 * 'water': wading below the knee (high knees, a slower cycle). Default 'ground'.
	 */
	surface?: Surface;
	/** Ground slope along the facing direction, radians, uphill positive. Default 0. */
	slope?: number;
	/** Distance (u) to a drop in the move direction, or the facing one when still; Infinity when none. */
	edgeAhead?: number;
}

export interface StateMachineOptions {
	/** World units per stud. */
	stud?: number;
	/** Airborne time without a jump before fall starts: the coyote window still reads as grounded. */
	fallDelay?: number;
}

export class AvatarStateMachine {
	state: AvatarState = 'idle';
	/** Crossfade weight per slot, in SLOTS order; they always sum to 1. */
	readonly weights = new Float64Array(SLOTS.length);
	/** Walk and run shares inside the walk slot (sum 1); frozen while stopping, as in Animate. */
	walkWeight = 1;
	runWeight = 0;
	/** Swim-stroke share inside the swim slot; the rest is swim-idle. */
	swimMoveWeight = 0;
	/** The emote shown (kept while it fades out) and its clock in seconds. */
	emote: EmoteId | null = null;
	emoteTime = 0;
	/** Horizontal speed in studs/s, as last read. */
	studSpeed = 0;
	/** Events of the last update. */
	jumped = false;
	landed = false;
	/** Downward speed at the landing, world units/s. */
	landingSpeed = 0;
	readonly #stud: number;
	readonly #fallDelay: number;
	readonly #from = new Float64Array(SLOTS.length);
	#current = IDLE;
	#fadeTime = 0;
	#fadeElapsed = 0;
	#jumpTimer = 0;
	#airTime = 0;
	#emoteActive = false;
	#pendingEmote: EmoteId | null = null;
	#wasGrounded = true;
	#lastVerticalSpeed = 0;
	#swimMoving = false;

	constructor(options: StateMachineOptions = {}) {
		this.#stud = options.stud ?? STUD;
		this.#fallDelay = options.fallDelay ?? COYOTE_TIME;
		this.reset();
	}

	/** An emote is playing (not fading out). */
	get emoting(): boolean {
		return this.#emoteActive;
	}

	weight(state: AvatarState): number {
		return this.weights[SLOT_INDEX[state]];
	}

	/**
	 * Asks for an emote. Like Animate, it is accepted only while standing still
	 * (idle) and not during another emote; it starts on the next update and is
	 * dropped if the character moved by then. Returns whether it was accepted.
	 */
	playEmote(id: EmoteId): boolean {
		if (!Object.hasOwn(EMOTES, id) || this.#current !== IDLE || this.#emoteActive) return false;
		this.#pendingEmote = id;
		return true;
	}

	/** Ends the emote early; it fades back to idle. */
	stopEmote() {
		this.#pendingEmote = null;
		this.#emoteActive = false;
	}

	/** Idle at full weight, no events, no timers (spawn, respawn, skin change). */
	reset() {
		this.state = 'idle';
		this.#current = IDLE;
		this.weights.fill(0);
		this.weights[IDLE] = 1;
		this.#fadeTime = this.#fadeElapsed = 0;
		this.walkWeight = 1;
		this.runWeight = this.swimMoveWeight = 0;
		this.emote = this.#pendingEmote = null;
		this.emoteTime = 0;
		this.#emoteActive = false;
		this.jumped = this.landed = false;
		this.landingSpeed = this.studSpeed = 0;
		this.#jumpTimer = this.#airTime = this.#lastVerticalSpeed = 0;
		this.#wasGrounded = true;
		this.#swimMoving = false;
	}

	update(rawDt: number, input: MotionInput) {
		const dt = rawDt > 0 ? Math.min(rawDt, MAX_DT) : 0;
		const grounded = input.grounded;
		const verticalSpeed = Number.isFinite(input.verticalSpeed) ? input.verticalSpeed : 0;
		const speed = Math.max(0, Number.isFinite(input.speed) ? input.speed : 0) / this.#stud;
		const lastVerticalSpeed = this.#lastVerticalSpeed;
		this.studSpeed = speed;

		// Events. Velocity only falls in the air, so an upward gain is a jump impulse; a
		// re-jump on the landing frame also counts as that landing.
		this.jumped =
			!grounded &&
			(input.jumped || (verticalSpeed > JUMP_MIN_SPEED && verticalSpeed - lastVerticalSpeed > JUMP_IMPULSE));
		this.landed = (grounded && !this.#wasGrounded) || (this.jumped && lastVerticalSpeed < -JUMP_MIN_SPEED);
		this.landingSpeed = this.landed ? Math.max(0, -lastVerticalSpeed) : 0;
		this.#wasGrounded = grounded;
		this.#lastVerticalSpeed = verticalSpeed;
		this.#airTime = grounded ? 0 : this.#airTime + dt;
		const airTime = Math.max(Number.isFinite(input.airTime) ? input.airTime : 0, this.#airTime);

		// Animate's stepAnimate counts the jump hold down every frame.
		if (this.jumped) this.#jumpTimer = ANIMATE.jumpDuration;
		const jumpLeft = this.#jumpTimer - dt;
		this.#jumpTimer = Math.max(0, jumpLeft);

		const moving = speed > ANIMATE.speedThreshold;
		const still = grounded && !moving && !input.sitting && !input.climbing && !input.swimming;
		const steering = (Number.isFinite(input.intent) ? input.intent : 0) > INTENT_DEADZONE;
		if (this.#pendingEmote !== null) {
			if (still && !steering) {
				this.emote = this.#pendingEmote;
				this.emoteTime = 0;
				this.#emoteActive = true;
			}
			this.#pendingEmote = null;
		}
		// Seconds of this update past the emote's end, or -1.
		let emoteOver = -1;
		if (this.emote !== null) {
			this.emoteTime += dt;
			if (this.#emoteActive) {
				// A looping gesture (talk) plays until stopEmote, a move or the stick.
				const over = EMOTES[this.emote].loop ? -1 : this.emoteTime - EMOTES[this.emote].period;
				if (over >= 0) emoteOver = Math.min(dt, over);
				if (over >= 0 || !still || steering) this.#emoteActive = false;
			}
		}

		if (moving) {
			// setRunSpeed: walk alone up to runSpeed 0.5, linear crossfade to 1, then run alone.
			const walkEnd = ANIMATE.walkNativeSpeed / ANIMATE.runNativeSpeed;
			const runSpeed = speed / ANIMATE.runNativeSpeed;
			this.runWeight = Math.min(1, Math.max(0, (runSpeed - walkEnd) / (1 - walkEnd)));
			this.walkWeight = 1 - this.runWeight;
		}

		if (input.swimming) {
			const swimSpeed = Math.hypot(speed, verticalSpeed / this.#stud);
			if (swimSpeed > ANIMATE.swimEnterSpeed) this.#swimMoving = true;
			else if (swimSpeed < ANIMATE.swimExitSpeed) this.#swimMoving = false;
			const target = this.#swimMoving ? 1 : 0;
			if (this.weights[SWIM] === 0) this.swimMoveWeight = target;
			else {
				const step = dt / ANIMATE.swimFade;
				this.swimMoveWeight =
					target > this.swimMoveWeight
						? Math.min(target, this.swimMoveWeight + step)
						: Math.max(target, this.swimMoveWeight - step);
			}
		}

		const current = this.#current;
		let next = current;
		let fade = 0;
		let lead = dt;
		if (input.sitting) {
			next = SIT;
			fade = ANIMATE.sitFade;
		} else if (input.climbing) {
			next = CLIMB;
			fade = ANIMATE.climbFade;
		} else if (input.swimming) {
			next = SWIM;
			fade = ANIMATE.swimFade;
		} else if (!grounded) {
			if (this.jumped) {
				next = JUMP;
				fade = ANIMATE.jumpFade;
			} else if (current === JUMP) {
				if (jumpLeft <= 0) {
					next = FALL;
					fade = ANIMATE.fallFade;
					lead = Math.min(dt, -jumpLeft);
				}
			} else if (current !== FALL) {
				const ground = current === IDLE || current === WALK || current === EMOTE;
				if (!ground || airTime >= this.#fallDelay) {
					next = FALL;
					fade = ANIMATE.fallFade;
					if (ground) lead = Math.min(dt, airTime - this.#fallDelay);
				}
			}
		} else if (moving) {
			next = WALK;
			fade = ANIMATE.walkFade;
		} else if (this.#emoteActive) {
			next = EMOTE;
			fade = ANIMATE.emoteFade;
		} else {
			next = IDLE;
			fade = current === EMOTE ? ANIMATE.loopFade : ANIMATE.idleFade;
			if (emoteOver >= 0) lead = emoteOver;
		}

		if (next !== current) {
			this.#from.set(this.weights);
			this.#current = next;
			this.state = SLOTS[next];
			this.#fadeTime = fade;
			this.#fadeElapsed = lead;
		} else this.#fadeElapsed += dt;

		const progress = this.#fadeTime > 0 ? Math.min(1, this.#fadeElapsed / this.#fadeTime) : 1;
		const from = this.#from;
		for (let i = 0; i < SLOTS.length; i++)
			this.weights[i] = from[i] * (1 - progress) + (i === this.#current ? progress : 0);
	}
}
