import { PerspectiveCamera, Vector3 } from 'three';
import { expect, it } from 'vitest';
import { applyCameraPose, OrbitCamera, springStep, stepZoom, touchPitchScale } from './camera.ts';
import {
	CAMERA_DEFAULT_DISTANCE,
	CAMERA_FOCUS_HEIGHT,
	CAMERA_MAX_DISTANCE,
	FIRST_PERSON_DISTANCE,
	FIRST_PERSON_THRESHOLD,
	PITCH_MAX,
	PITCH_MIN,
	SHIFT_LOCK_OFFSET,
	STUD,
	ZOOM_STIFFNESS
} from './constants.ts';
import { buildCollisionWorld, createGraybox, LOW_CEILING_BOTTOM, THIN_WALL_THICKNESS } from './graybox.ts';

const DT = 1 / 60;
const world = buildCollisionWorld(createGraybox());
const lens = { fov: 70, aspect: 2, near: 0.1 };

function settle(camera: OrbitCamera, feet: { x: number; y: number; z: number }, frames = 60) {
	for (let i = 0; i < frames; i++) camera.update(DT, feet, world, lens);
	return camera.pose;
}

it('zooms on a monotonic hyperbolic curve whose in-step undoes its out-step', () => {
	let previous = 0;
	for (let studs = 1; studs <= 120; studs += 0.5) {
		const distance = studs * STUD;
		const out = stepZoom(distance, 1);
		const back = stepZoom(out, -1);
		expect(out).toBeGreaterThanOrEqual(previous);
		previous = out;
		if (out < CAMERA_MAX_DISTANCE) {
			expect(out).toBeGreaterThan(distance);
			expect(back).toBeCloseTo(distance, 9);
		}
		expect(stepZoom(distance, -0.25)).toBeLessThan(distance);
	}
	// Roblox: one wheel notch out from 12.5 studs lands at 19.75 studs.
	expect(stepZoom(12.5 * STUD, 1) / STUD).toBeCloseTo(19.75, 9);
	expect(stepZoom(CAMERA_MAX_DISTANCE, 5)).toBe(CAMERA_MAX_DISTANCE);
});

it('snaps into first person under 1 stud and back out above it', () => {
	expect(stepZoom(1.2 * STUD, -1)).toBe(FIRST_PERSON_DISTANCE);
	expect(stepZoom(FIRST_PERSON_DISTANCE, 0.1)).toBeGreaterThanOrEqual(FIRST_PERSON_THRESHOLD);
	const camera = new OrbitCamera();
	for (let i = 0; i < 12; i++) camera.zoom(-1);
	expect(camera.firstPerson).toBe(true);
	const pose = settle(camera, { x: 0, y: 0, z: 0 }, 120);
	expect(pose.distance).toBeCloseTo(FIRST_PERSON_DISTANCE, 6);
	expect(pose.avatarOpacity).toBe(0);
	expect(pose.bodyYaw).toBeCloseTo(Math.PI, 9);
});

it('fades the avatar only within 1.25 studs, at most 2.8 per second', () => {
	// 1.1 studs: Roblox transparency 1 - (1.1 - 0.5) / 1.5 = 0.6.
	const camera = new OrbitCamera({ distance: 1.1 * STUD });
	expect(camera.firstPerson).toBe(false);
	expect(settle(camera, { x: 0, y: 0, z: 0 }, 1).avatarOpacity).toBeCloseTo(1 - 2.8 * DT, 9);
	expect(settle(camera, { x: 0, y: 0, z: 0 }, 60).avatarOpacity).toBeCloseTo(0.4, 9);
	expect(settle(new OrbitCamera({ distance: 1.3 * STUD }), { x: 0, y: 0, z: 0 }).avatarOpacity).toBe(1);
});

it('follows a critically damped spring: no overshoot, settled within half a second', () => {
	const state = { x: 2, v: 0 };
	let previous = state.x;
	for (let i = 0; i < 30; i++) {
		springStep(state, 10, ZOOM_STIFFNESS, DT);
		expect(state.x).toBeGreaterThanOrEqual(previous);
		expect(state.x).toBeLessThanOrEqual(10);
		previous = state.x;
	}
	expect(state.x).toBeCloseTo(10, 2);
});

it('slows touch pitch away from the horizon, down to 25% at the pole', () => {
	expect(touchPitchScale(0, -0.1)).toBe(1);
	expect(touchPitchScale(-0.5, 0.1)).toBe(1);
	expect(touchPitchScale(-Math.PI / 2, -0.1)).toBeCloseTo(0.25, 12);
	expect(touchPitchScale(-1, -0.1)).toBeLessThan(touchPitchScale(-0.5, -0.1));
	expect(touchPitchScale(1, 0.1)).toBeCloseTo(touchPitchScale(-1, -0.1), 12);
});

it('turns right when dragged right, looks down when dragged down, and clamps pitch at ±80°', () => {
	const camera = new OrbitCamera();
	const pose = camera.update(DT, { x: 0, y: 0, z: 0 }, null, lens);
	const before = new Vector3().subVectors(pose.focus, pose.position).normalize();
	camera.look(30, 0, 'mouse');
	camera.look(0, 10, 'touch');
	const after = camera.update(DT, { x: 0, y: 0, z: 0 }, null, lens);
	const forward = new Vector3().subVectors(after.focus, after.position).normalize();
	expect(before.x).toBeCloseTo(0, 9);
	expect(forward.x).toBeGreaterThan(0.2);
	expect(forward.y).toBeLessThan(before.y);
	camera.look(0, 1e4, 'mouse');
	expect(camera.pitch).toBe(PITCH_MIN);
	camera.look(0, -1e4, 'touch');
	expect(camera.pitch).toBe(PITCH_MAX);
});

it('keeps the camera in front of the thin wall, never at a negative distance', () => {
	const camera = new OrbitCamera();
	camera.yaw = Math.PI; // behind the character is -z, where the wall is
	camera.pitch = 0;
	const face = 10 + THIN_WALL_THICKNESS / 2;
	for (const z of [11, 10.6, face + 0.01]) {
		const pose = settle(camera, { x: 32, y: 0, z });
		expect(pose.distance).toBeGreaterThanOrEqual(0);
		expect(pose.distance).toBeLessThanOrEqual(z - face + 1e-9);
		expect(pose.position.z).toBeGreaterThanOrEqual(face - 1e-9);
	}
});

it('keeps the camera under the low ceiling when looking down steeply', () => {
	const camera = new OrbitCamera();
	camera.pitch = PITCH_MIN;
	const pose = settle(camera, { x: 14, y: 0, z: 9 });
	expect(pose.distance).toBeGreaterThanOrEqual(0);
	expect(pose.position.y).toBeLessThanOrEqual(LOW_CEILING_BOTTOM + 1e-9);
	// With the pivot inside the slab, collision still yields a finite, non-negative distance.
	const inside = settle(new OrbitCamera(), {
		x: 14,
		y: LOW_CEILING_BOTTOM + 0.2 - CAMERA_FOCUS_HEIGHT,
		z: 9
	});
	expect(Number.isFinite(inside.distance)).toBe(true);
	expect(inside.distance).toBeGreaterThanOrEqual(0);
	expect(inside.position.toArray().every(Number.isFinite)).toBe(true);
});

it('snaps in at a wall and springs back out once clear', () => {
	const camera = new OrbitCamera();
	camera.yaw = Math.PI;
	camera.pitch = 0;
	expect(settle(camera, { x: 32, y: 0, z: 11 }).distance).toBeLessThan(1);
	const pose = camera.update(DT, { x: 32, y: 0, z: 30 }, world, lens);
	expect(pose.distance).toBeLessThan(CAMERA_DEFAULT_DISTANCE * 0.5);
	expect(settle(camera, { x: 32, y: 0, z: 30 }).distance).toBeCloseTo(CAMERA_DEFAULT_DISTANCE, 3);
});

it('puts the shoulder offset to the right in shift-lock and shortens it at a wall', () => {
	const camera = new OrbitCamera();
	camera.shiftLock = true;
	const open = settle(camera, { x: 0, y: 0, z: 0 });
	expect(open.focus.x).toBeCloseTo(SHIFT_LOCK_OFFSET, 9);
	expect(open.bodyYaw).toBeCloseTo(Math.PI, 9);
	// The corner wall's inner face is at x = 24: only 0.4 u of shoulder room is left.
	const blocked = settle(camera, { x: 23.4, y: 0, z: 8 });
	expect(blocked.focus.x).toBeCloseTo(23.8, 9);
});

it('writes a pose that looks at the focus', () => {
	const camera = new OrbitCamera();
	camera.yaw = 0.8;
	const pose = camera.update(DT, { x: 3, y: 1, z: -2 }, world, lens);
	const three = new PerspectiveCamera();
	applyCameraPose(three, pose);
	three.updateMatrixWorld();
	const toFocus = new Vector3().subVectors(pose.focus, three.position).normalize();
	expect(three.getWorldDirection(new Vector3()).dot(toFocus)).toBeCloseTo(1, 9);
});
