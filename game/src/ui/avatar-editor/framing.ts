/**
 * Camera framings of the editor's preview, Roblox-style: the face and hair tabs
 * look at the head, every other tab at the whole body on its pedestal. A tween
 * moves between them; reduced motion cuts at once. Pure numbers, no three.js:
 * the stage copies `current` into its camera.
 *
 * World units as in the game (ART.md): the avatar is 3 u tall, feet at y = 0 on
 * the pedestal's top, facing +z. The camera sits on +z and looks down a little.
 */
import type { FramingId } from './editor.ts';

const DEG = Math.PI / 180;

export interface Framing {
	/** Height the camera aims at, u. */
	targetY: number;
	/** World height and width that must stay in view, u. */
	height: number;
	width: number;
	/** Camera elevation above the target, radians (looking down). */
	pitch: number;
	/** The character's turn this framing prefers (radians; 0 faces the camera). */
	yaw: number;
}

export const FRAMINGS: Readonly<Record<FramingId, Readonly<Framing>>> = {
	// From under the pedestal (−0.3) to above the tallest hair (3.4), with room for the
	// title over the top and the hint under the feet.
	body: { targetY: 1.5, height: 5.3, width: 3.4, pitch: 8 * DEG, yaw: -0.38 },
	// The head block (2.1 to 3.0) with the bun, afro and cap above it, and the shoulders' tops.
	// Centred low enough that the drag hint under it covers the chest, never the mouth.
	head: { targetY: 2.5, height: 2.6, width: 2.2, pitch: 4 * DEG, yaw: -0.18 }
};

/** Square thumbnails: the same idea, tighter, since there is no pedestal. */
export const THUMB_FRAMINGS: Readonly<Record<FramingId, Readonly<Framing>>> = {
	body: { targetY: 1.58, height: 3.55, width: 3.55, pitch: 6 * DEG, yaw: -0.42 },
	head: { targetY: 2.64, height: 1.55, width: 1.55, pitch: 3 * DEG, yaw: -0.3 }
};

export const FOV_DEG = 30;
/** Seconds between framings. */
export const FRAMING_SECONDS = 0.45;

/** Distance at which `height` × `width` fits a view of this aspect (width / height) and vertical FOV. */
export function fitDistance(framing: Readonly<Framing>, aspect: number, fovDeg = FOV_DEG): number {
	const tan = Math.tan((fovDeg * DEG) / 2);
	const safeAspect = Number.isFinite(aspect) && aspect > 0 ? aspect : 1;
	return Math.max(framing.height / 2 / tan, framing.width / 2 / (tan * safeAspect));
}

export interface CameraPlacement {
	x: number;
	y: number;
	z: number;
	targetY: number;
}

/** Camera position (on +z, raised by the pitch) and aim for a framing; writes into `out`. */
export function placeCamera(
	framing: Readonly<Framing>,
	aspect: number,
	out: CameraPlacement,
	fovDeg = FOV_DEG
): CameraPlacement {
	const distance = fitDistance(framing, aspect, fovDeg);
	out.x = 0;
	out.y = framing.targetY + Math.sin(framing.pitch) * distance;
	out.z = Math.cos(framing.pitch) * distance;
	out.targetY = framing.targetY;
	return out;
}

export function easeInOutCubic(t: number): number {
	const x = Math.min(1, Math.max(0, t));
	return x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2;
}

/** Eases every framing field from where the camera is to the goal. No allocation per step. */
export class FramingTween {
	readonly current: Framing;
	readonly #from: Framing;
	readonly #to: Framing;
	#t = 1;
	readonly duration: number;

	constructor(start: Readonly<Framing>, duration = FRAMING_SECONDS) {
		this.current = { ...start };
		this.#from = { ...start };
		this.#to = { ...start };
		this.duration = duration;
	}

	get moving(): boolean {
		return this.#t < 1;
	}

	/** Heads for `goal`; `instant` (reduced motion) cuts there. */
	set(goal: Readonly<Framing>, instant: boolean) {
		copy(this.#from, this.current);
		copy(this.#to, goal);
		this.#t = instant || this.duration <= 0 ? 1 : 0;
		if (instant) copy(this.current, goal);
	}

	/** Advances by `dt` seconds; true while still moving. */
	step(dt: number): boolean {
		if (this.#t >= 1) return false;
		this.#t = Math.min(1, this.#t + Math.max(0, Number.isFinite(dt) ? dt : 0) / this.duration);
		const k = easeInOutCubic(this.#t);
		const from = this.#from,
			to = this.#to,
			out = this.current;
		out.targetY = from.targetY + (to.targetY - from.targetY) * k;
		out.height = from.height + (to.height - from.height) * k;
		out.width = from.width + (to.width - from.width) * k;
		out.pitch = from.pitch + (to.pitch - from.pitch) * k;
		out.yaw = from.yaw + (to.yaw - from.yaw) * k;
		return this.#t < 1;
	}
}

function copy(out: Framing, from: Readonly<Framing>) {
	out.targetY = from.targetY;
	out.height = from.height;
	out.width = from.width;
	out.pitch = from.pitch;
	out.yaw = from.yaw;
}
