import { expect, it } from 'vitest';
import { CameraTrap } from './camera-trap.ts';
import { PhotoCamera, type PhotoFrame } from './photo.ts';

const frame: PhotoFrame = {
	origin: { x: 0, y: 0, z: 0 },
	forward: { x: 0, y: 0, z: 1 },
	right: { x: 1, y: 0, z: 0 },
	up: { x: 0, y: 1, z: 0 },
	tanHalfFov: 1,
	aspect: 1
};
it('accepts multiple central subjects, rejects behind, over 25 units, outside central 40% and occluded subjects', () => {
	const subjects = [
		{ id: 'a', species: 'a', position: { x: 0, y: 0, z: 25 } },
		{ id: 'b', species: 'b', position: { x: 4, y: 0, z: 10 } },
		{ id: 'edge', species: 'e', position: { x: 4.01, y: 0, z: 10 } },
		{ id: 'far', species: 'f', position: { x: 0, y: 0, z: 25.01 } },
		{ id: 'behind', species: 'h', position: { x: 0, y: 0, z: -3 } },
		{ id: 'hidden', species: 'x', position: { x: 0, y: 0, z: 12 } }
	];
	const photo = new PhotoCamera(subjects);
	let rays = 0;
	photo.evaluate(frame, (_origin, target) => {
		rays++;
		return target.z === 12;
	});
	expect([...photo.valid]).toEqual([1, 1, 0, 0, 0, 0]);
	expect(rays).toBe(3);
	expect(photo.action()).toBe('framing');
	expect(photo.action()).toBe('saved');
	expect(photo.savedCount).toBe(2);
	expect(photo.saved[0]?.species).toBe('a');
	expect(photo.saved[1]?.species).toBe('b');
});
it('does not enter with no valid subject or save stale validity after a subject leaves', () => {
	const subject = { id: 'a', species: 'a', position: { x: 0, y: 0, z: 5 } };
	const photo = new PhotoCamera([subject]);
	expect(photo.action()).toBe('idle');
	photo.evaluate(frame, () => false);
	photo.action();
	subject.position.z = 30;
	photo.evaluate(frame, () => false);
	expect(photo.action()).toBe('framing');
	expect(photo.savedCount).toBe(0);
});
it('trap waits for a new different mission, then exposes a photo exactly once', () => {
	const trap = new CameraTrap('muriqui', 'V4');
	expect(trap.collect()).toBe(false);
	expect(trap.place(12)).toBe(true);
	trap.missionCompleted('V2', 12);
	trap.missionCompleted('V4', 13);
	expect(trap.phase).toBe('pending');
	trap.missionCompleted('V2', 14);
	expect(trap.phase).toBe('ready');
	expect(trap.collect()).toBe(true);
	expect(trap.collect()).toBe(false);
	expect(trap.place(15)).toBe(false);
});
