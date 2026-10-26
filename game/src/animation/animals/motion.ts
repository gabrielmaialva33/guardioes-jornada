/**
 * The contract between a behaviour (what the animal does) and the animator (how
 * its body looks). A behaviour refills one AnimalMotion every update; the
 * animator reads it and never writes back. Plain number fields, initialized as
 * numbers so V8 stores them in place (p3-animation.md, V8 rule 2).
 */
import { DURATION } from '../../style/motion.ts';
import type { Posture } from './postures.ts';

export class AnimalMotion {
	// --- Placement of the model origin in the world (the scene copies these to the group) ---
	x = 0;
	y = 0;
	z = 0;
	/** Facing, radians, 0 = +z (the engine's convention). */
	yaw = 0;

	// --- Posture ---
	posture: Posture = 'stand';
	/** Crossfade into a newly requested posture, seconds. */
	fade: number = DURATION.state;
	/**
	 * Seconds since the behaviour's state changed, at the end of the update (Behaviour
	 * fills it). The animator starts a new posture's fade that far along (at most one
	 * update), so a far-LOD update that spans a state change fades exactly as frames do.
	 */
	postureAge = 0;

	// --- Locomotion (ground and branches) ---
	/** Distance actually covered during this update, u (turning on the spot counts its foot travel). The gait advances by it only. */
	distance = 0;
	/**
	 * Gait cycles covered during this update: the sum over substeps of distance /
	 * stride at that substep's speed (Behaviour fills it). -1 when unset: the
	 * animator then uses distance / stride at the final speed.
	 */
	cycles = -1;
	/** Travel speed, u/s: picks stride, cadence and the walk/run blend. */
	speed = 0;
	/** Forward acceleration, u/s², for lean and tail lag. */
	accel = 0;
	/** Yaw rate, rad/s, for bank and tail swing. */
	turnRate = 0;

	// --- Attention ---
	/** Look direction relative to the body, radians: yaw left +, pitch up +. */
	lookYaw = 0;
	lookPitch = 0;

	// --- Hops and flight ---
	/** Anticipation crouch, 0..1 (at most LIMITS.anticipation long). */
	crouch = 0;
	/** Landing impact this update, 0..1 (kicks the squash). */
	landing = 0;
	/** Take-off this update, 0..1 (kicks the stretch). */
	takeoff = 0;
	/** Wingbeat amplitude 0..1 and rate in beats per second. */
	flap = 0;
	flapRate = 0;
	/** Wings closed against the body mid-flight (the toucan's drop before a glide), 0..1. */
	wingsClosed = 0;
	/** Body pitch (nose down +) and bank (roll right +) from the flight path, radians. */
	pitch = 0;
	bank = 0;

	// --- Suspension: brachiation (muriqui) ---
	/** Pendulum angle of the shoulder about the gripping hand, radians (+ = body ahead of the hand). */
	swing = 0;
	/** Body tilt, radians: how far the trunk follows the swing. */
	tilt = 0;
	/** Gripping hand: 1 = left (front-left limb), -1 = right. */
	grip = 1;
	/** Free hand reaching for the next anchor, 0..1, and that anchor relative to the grip in model units (forward, up). */
	reach = 0;
	reachForward = 0;
	reachUp = 0;
	/** Shoulder correction after a hand switch, model units (forward, up); decays to 0. */
	snapForward = 0;
	snapUp = 0;

	// --- Suspension: sloth limbs (slots front-left, front-right, back-left, back-right) ---
	/** Foot position along the branch relative to its hip, model units (+ = ahead). */
	readonly limbReach = new Float64Array(4);
	/** Foot unhooked from the branch while it moves, 0..1. */
	readonly limbLift = new Float64Array(4);

	// --- Feeding and calls ---
	/** True only while the animal is feeding (the bugio's tail-and-feet hang requires it). */
	feeding = false;
	/** Hand-to-mouth feeding gesture, 0..1. */
	eat = 0;
	/** Howl loudness envelope, 0..1 (the scene can drive audio from it). */
	howl = 0;

	/** Clears the per-update events. */
	beginUpdate() {
		this.distance = 0;
		this.cycles = -1;
		this.landing = 0;
		this.takeoff = 0;
	}
}

/** Time of day as the animals read it: night is the survival mode's lighting (ART.md §1). */
export type Light = 'day' | 'dusk' | 'night';

/** The player's eye height above its feet, u (the avatar is 3 u tall; its head spans 2.1–3 u). */
export const PLAYER_EYES = 2.6;

/**
 * What behaviours read from the scene each frame. Create once with
 * createAnimalWorld() and refill it; all animals share it.
 */
export interface AnimalWorld {
	/** Player feet, u, and planar velocity, u/s (NaN velocity: estimated from positions). */
	playerX: number;
	playerY: number;
	playerZ: number;
	playerVx: number;
	playerVz: number;
	playerGrounded: boolean;
	/** True in the frame the player jumped (PlayerFrame.jumped). */
	playerJumped: boolean;
	/** Ground height under the companion, sampled by the scene at its last position; NaN uses the player's. */
	groundY: number;
	/** prefers-reduced-motion or the game toggle (ART.md §7). */
	reducedMotion: boolean;
	/** Day, dusk or night: nocturnal and crepuscular species rest more by day (default 'day'). */
	light: Light;
}

export function createAnimalWorld(): AnimalWorld {
	return {
		playerX: 0,
		playerY: 0,
		playerZ: 0,
		playerVx: Number.NaN,
		playerVz: Number.NaN,
		playerGrounded: true,
		playerJumped: false,
		groundY: Number.NaN,
		reducedMotion: false,
		light: 'day'
	};
}
