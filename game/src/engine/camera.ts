/**
 * Roblox-style orbit camera (Classic mode): yaw and pitch around a pivot at the
 * head, zoom from 128 studs down to first person, shift-lock over the right
 * shoulder, and collision that pulls the camera in front of walls and lets it
 * spring back out. It returns a pose; applyCameraPose writes it to a three camera.
 *
 * Adapted from CharacterCameraBehavior in @pmndrs/viverse 0.2.29 (src/camera.ts,
 * npm tarball of 2026-10-16): spherical placement from pitch/yaw with the
 * offset rotated by the camera yaw, not the body's. Changes: Roblox's hyperbolic
 * zoom steps and critically damped 4.5 Hz spring (BaseCamera.StepZoom,
 * ZoomController) instead of a multiplicative zoom; collision by four rays from
 * the near-plane corners plus the centre, clamped so the distance never goes
 * negative (the original cast one ray and subtracted 0.2); first person below
 * 1 stud with the TransparencyController fade; a shoulder offset that stops at
 * walls; no action readers (input arrives through look/zoom).
 *
 * Copyright 2024 Bela Bohlender
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy of this software and
 * associated documentation files (the "Software"), to deal in the Software without restriction, including
 * without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the
 * following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all copies or substantial
 * portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT
 * LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO
 * EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER
 * IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR
 * THE USE OR OTHER DEALINGS IN THE SOFTWARE.
 */
import { type Object3D, Ray, Vector3 } from 'three';
import type { Vec3 } from './character.ts';
import {
	CAMERA_DEFAULT_DISTANCE,
	CAMERA_FOCUS_HEIGHT,
	CAMERA_FOV,
	CAMERA_MAX_DISTANCE,
	CAMERA_MIN_DISTANCE,
	CAMERA_NEAR,
	CAMERA_OPAQUE_DISTANCE,
	FADE_END_DISTANCE,
	FADE_RATE,
	FADE_START_DISTANCE,
	FIRST_PERSON_DISTANCE,
	FIRST_PERSON_THRESHOLD,
	INITIAL_PITCH,
	MOUSE_SENSITIVITY_X,
	MOUSE_SENSITIVITY_Y,
	PITCH_MAX,
	PITCH_MIN,
	SHIFT_LOCK_OFFSET,
	STUD,
	TOUCH_PITCH_CURVE_POWER,
	TOUCH_PITCH_MIN_FRACTION,
	TOUCH_SENSITIVITY_X,
	TOUCH_SENSITIVITY_Y,
	ZOOM_CURVATURE,
	ZOOM_STIFFNESS
} from './constants.ts';
import { clamp, wrapAngle } from './math.ts';
import type { CollisionWorld } from './world.ts';

export type LookSource = 'mouse' | 'touch';

/** What collision needs from the projection: vertical fov in degrees, aspect and near plane. */
export interface CameraLens {
	fov: number;
	aspect: number;
	near: number;
}

export const DEFAULT_LENS: Readonly<CameraLens> = { fov: CAMERA_FOV, aspect: 16 / 9, near: CAMERA_NEAR };

export interface CameraPose {
	readonly position: Vector3;
	/** The point looked at: the head pivot, moved over the shoulder in shift-lock. */
	readonly focus: Vector3;
	/** Euler YXZ of the camera; pitch < 0 looks down. */
	yaw: number;
	pitch: number;
	/** Focus-to-camera distance after the zoom spring and collision; never negative. */
	distance: number;
	/** Zoomed under 1 stud: hide the avatar with colorWrite = false so it still casts a shadow. */
	firstPerson: boolean;
	/** Shift-lock in effect (it pauses in first person). */
	shiftLock: boolean;
	/** 1 opaque to 0 invisible: Roblox fades the avatar between 1.25 and 0.5 studs. */
	avatarOpacity: number;
	/** Yaw the body must face (shift-lock, first person), or null to turn toward the movement. */
	bodyYaw: number | null;
}

export interface OrbitCameraOptions {
	/** CameraMinZoomDistance; raise above 1 stud to forbid first person. */
	minDistance?: number;
	maxDistance?: number;
	distance?: number;
	focusHeight?: number;
}

/** Room kept between the shoulder pivot and a wall at the character's side. */
const SHOULDER_CLEARANCE = 0.2;
/** Ray origins on the near plane: centre and corners, as (right, up) signs. */
const NEAR_PLANE_POINTS = [
	[0, 0],
	[-1, -1],
	[1, -1],
	[-1, 1],
	[1, 1]
] as const;

const back = new Vector3();
const right = new Vector3();
const up = new Vector3();
const head = new Vector3();
const ray = new Ray();

export class OrbitCamera {
	yaw = 0;
	pitch = INITIAL_PITCH;
	/** Distance the zoom aims for, after the hyperbolic steps; the spring follows it. */
	zoomGoal: number;
	shiftLock = false;
	readonly minDistance: number;
	readonly maxDistance: number;
	readonly focusHeight: number;
	readonly pose: CameraPose = {
		position: new Vector3(),
		focus: new Vector3(),
		yaw: 0,
		pitch: INITIAL_PITCH,
		distance: 0,
		firstPerson: false,
		shiftLock: false,
		avatarOpacity: 1,
		bodyYaw: null
	};
	#spring = { x: 0, v: 0 };
	#transparency = 0;

	constructor(options: OrbitCameraOptions = {}) {
		this.minDistance = options.minDistance ?? CAMERA_MIN_DISTANCE;
		this.maxDistance = options.maxDistance ?? CAMERA_MAX_DISTANCE;
		this.focusHeight = options.focusHeight ?? CAMERA_FOCUS_HEIGHT;
		this.zoomGoal = clamp(options.distance ?? CAMERA_DEFAULT_DISTANCE, this.minDistance, this.maxDistance);
		this.#spring.x = this.zoomGoal;
	}

	/** Zoom goal under 1 stud: the body follows the camera and should be hidden. */
	get firstPerson(): boolean {
		return this.zoomGoal < FIRST_PERSON_THRESHOLD;
	}

	rotate(yawDelta: number, pitchDelta: number) {
		if (Number.isFinite(yawDelta)) this.yaw = wrapAngle(this.yaw + yawDelta);
		if (Number.isFinite(pitchDelta)) this.pitch = clamp(this.pitch + pitchDelta, PITCH_MIN, PITCH_MAX);
	}

	/**
	 * Orbits by a pointer movement in CSS px. Dragging right turns the view right,
	 * dragging down looks down; touch slows its pitch away from the horizon.
	 */
	look(dx: number, dy: number, source: LookSource) {
		if (source === 'mouse') this.rotate(-dx * MOUSE_SENSITIVITY_X, -dy * MOUSE_SENSITIVITY_Y);
		else {
			const pitchDelta = -dy * TOUCH_SENSITIVITY_Y;
			this.rotate(-dx * TOUCH_SENSITIVITY_X, pitchDelta * touchPitchScale(this.pitch, pitchDelta));
		}
	}

	/** Applies a Roblox zoom delta (positive zooms out): wheel notches, pinch or I/O. */
	zoom(delta: number) {
		this.zoomGoal = stepZoom(this.zoomGoal, delta, this.minDistance, this.maxDistance);
	}

	/** Puts the camera behind a body facing `bodyYaw`, e.g. after a respawn. */
	snapBehind(bodyYaw: number) {
		this.yaw = wrapAngle(bodyYaw + Math.PI);
	}

	/**
	 * Places the camera for this frame around the (interpolated) feet position.
	 * Collision only runs with a world and outside first person.
	 */
	update(dt: number, feet: Vec3, world: CollisionWorld | null, lens: CameraLens = DEFAULT_LENS): CameraPose {
		const pose = this.pose;
		const firstPerson = this.firstPerson;
		const shiftLock = this.shiftLock && !firstPerson;
		const sinYaw = Math.sin(this.yaw);
		const cosYaw = Math.cos(this.yaw);
		const sinPitch = Math.sin(this.pitch);
		const cosPitch = Math.cos(this.pitch);
		back.set(sinYaw * cosPitch, -sinPitch, cosYaw * cosPitch);
		right.set(cosYaw, 0, -sinYaw);
		up.set(sinPitch * sinYaw, cosPitch, sinPitch * cosYaw);

		head.set(feet.x, feet.y + this.focusHeight, feet.z);
		pose.focus.copy(head);
		if (shiftLock) {
			let offset = SHIFT_LOCK_OFFSET;
			if (world) {
				ray.set(head, right);
				const hit = world.raycast(ray, offset + SHOULDER_CLEARANCE);
				if (hit !== null) offset = Math.max(0, hit - SHOULDER_CLEARANCE);
			}
			pose.focus.addScaledVector(right, offset);
		}

		// The spring chases the goal; collision caps it instantly, so the camera snaps
		// in front of a wall and eases back out (Roblox ZoomController + Popper).
		let limit = this.maxDistance;
		if (world && this.zoomGoal > CAMERA_OPAQUE_DISTANCE)
			limit = Math.min(limit, this.#clearance(world, lens, Math.max(this.#spring.x, this.zoomGoal)));
		springStep(this.#spring, this.zoomGoal, ZOOM_STIFFNESS, dt);
		if (this.#spring.x > limit) {
			this.#spring.x = limit;
			this.#spring.v = 0;
		}
		if (this.#spring.x < Math.min(this.minDistance, limit)) {
			this.#spring.x = Math.min(this.minDistance, limit);
			this.#spring.v = 0;
		}
		const distance = Math.max(0, this.#spring.x);
		pose.position.copy(pose.focus).addScaledVector(back, distance);

		const target = fadeTarget(distance);
		const last = this.#transparency;
		this.#transparency =
			target < 1 && last < 0.95 ? last + clamp(target - last, -FADE_RATE * dt, FADE_RATE * dt) : target;

		pose.yaw = this.yaw;
		pose.pitch = this.pitch;
		pose.distance = distance;
		pose.firstPerson = firstPerson;
		pose.shiftLock = shiftLock;
		pose.avatarOpacity = 1 - this.#transparency;
		pose.bodyYaw = firstPerson || shiftLock ? wrapAngle(this.yaw + Math.PI) : null;
		return pose;
	}

	/** Free distance behind the focus: the nearest hit of rays from the near-plane centre and corners. */
	#clearance(world: CollisionWorld, lens: CameraLens, reach: number): number {
		const halfHeight = lens.near * Math.tan((lens.fov * Math.PI) / 360);
		const halfWidth = halfHeight * lens.aspect;
		let nearest = reach;
		for (const [x, y] of NEAR_PLANE_POINTS) {
			ray.origin
				.copy(this.pose.focus)
				.addScaledVector(right, x * halfWidth)
				.addScaledVector(up, y * halfHeight);
			ray.direction.copy(back);
			const hit = world.raycast(ray, nearest);
			if (hit !== null && hit < nearest) nearest = hit;
		}
		return Math.max(0, nearest);
	}
}

/**
 * Roblox BaseCamera.StepZoom in units: zooming out adds delta·(1 + 0.5·d) studs,
 * zooming in is its exact inverse, and goals under 1 stud snap to first person.
 */
export function stepZoom(
	distance: number,
	delta: number,
	min = CAMERA_MIN_DISTANCE,
	max = CAMERA_MAX_DISTANCE
): number {
	if (!delta || !Number.isFinite(delta)) return distance;
	const studs = distance / STUD;
	const threshold = FIRST_PERSON_THRESHOLD / STUD;
	const firstPerson = FIRST_PERSON_DISTANCE / STUD;
	let next =
		delta > 0
			? Math.max(studs + delta * (1 + studs * ZOOM_CURVATURE), threshold)
			: Math.max((studs + delta) / (1 - delta * ZOOM_CURVATURE), firstPerson);
	if (next < threshold) next = firstPerson;
	return clamp(next * STUD, min, max);
}

/**
 * Roblox CameraInput.adjustTouchPitchSensitivity: full speed toward the
 * horizon, slower away from it, down to 25% at ±90°.
 */
export function touchPitchScale(pitch: number, pitchDelta: number): number {
	if (pitchDelta * pitch <= 0) return 1;
	const curve = 1 - ((2 * Math.abs(pitch)) / Math.PI) ** TOUCH_PITCH_CURVE_POWER;
	return curve * (1 - TOUCH_PITCH_MIN_FRACTION) + TOUCH_PITCH_MIN_FRACTION;
}

/** Exact critically damped spring step (Roblox ZoomController ConstrainedSpring), frequency in Hz. */
export function springStep(state: { x: number; v: number }, goal: number, frequency: number, dt: number) {
	if (!(dt > 0)) return;
	const omega = frequency * 2 * Math.PI;
	const offset = goal - state.x;
	const step = omega * dt;
	const decay = Math.exp(-step);
	const x = goal + (state.v * dt - offset * (step + 1)) * decay;
	state.v = ((offset * omega - state.v) * step + state.v) * decay;
	state.x = x;
}

/** Roblox TransparencyController: 0.5 at 1.25 studs to 1 at 0.5 studs, nothing below 0.5. */
function fadeTarget(distance: number): number {
	const transparency = 1 - (0.5 * (distance - FADE_END_DISTANCE)) / (FADE_START_DISTANCE - FADE_END_DISTANCE);
	// Snap the float noise at 0.5 studs, so first person is exactly invisible.
	return transparency < 0.5 ? 0 : transparency > 1 - 1e-9 ? 1 : transparency;
}

/** Writes a pose to a camera that sits directly in the scene (no transformed parent). */
export function applyCameraPose(camera: Object3D, pose: CameraPose) {
	camera.position.copy(pose.position);
	camera.rotation.set(pose.pitch, pose.yaw, 0, 'YXZ');
}
