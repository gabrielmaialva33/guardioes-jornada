import { Box3, Line3, Vector3 } from 'three';
import { expect, it } from 'vitest';
import type { Character } from './character.ts';
import { CheckpointTracker } from './checkpoints.ts';
import { PlayerController } from './controller.ts';
import { buildCollisionWorld, createGraybox, THIN_WALL_THICKNESS, type V3 } from './graybox.ts';
import type { InputFrame } from './input.ts';

const level = createGraybox();
const world = buildCollisionWorld(level);
const at = ([x, y, z]: V3) => ({ x, y, z });

function input(overrides: Partial<InputFrame> = {}): InputFrame {
	return {
		moveX: 0,
		moveY: 0,
		jumpHeld: false,
		jumpPressed: false,
		actionHeld: false,
		actionPressed: false,
		emotePressed: false,
		shiftLock: false,
		mouseLookX: 0,
		mouseLookY: 0,
		touchLookX: 0,
		touchLookY: 0,
		zoomDelta: 0,
		...overrides
	};
}

/** How far the capsule sits inside the nearest triangle (≤ 0 when clear). */
function penetration(character: Character): number {
	const { radius, height } = character.options;
	const { x, y, z } = character.position;
	const axis = new Line3(new Vector3(x, y + radius, z), new Vector3(x, y + height - radius, z));
	const bounds = new Box3(new Vector3(x - 1, y - 1, z - 1), new Vector3(x + 1, y + height + 1, z + 1));
	let nearest = Number.POSITIVE_INFINITY;
	world.shapecast(bounds, (triangle) => {
		nearest = Math.min(nearest, triangle.closestPointToSegment(axis));
	});
	return radius - nearest;
}

/** Deterministic PRNG (mulberry32). */
function random(seed: number) {
	let state = seed >>> 0;
	return () => {
		state = (state + 0x6d2b79f5) >>> 0;
		let t = state;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

it.each([
	['30 Hz', () => 1 / 30],
	['90 Hz', () => 1 / 90],
	['120 Hz', () => 1 / 120],
	['200 ms frames', () => 0.2],
	['mixed rates with hitches', (frame: number) => [1 / 30, 1 / 144, 0.2, 1 / 60, 1 / 90][frame % 5]]
])('follows the same path tick for tick at %s as at 60 Hz', (_, frameSeconds) => {
	// Hold forward and jump up the walkable ramp, over its platform and off the end.
	const held = input({ moveY: 1, jumpHeld: true });
	const trace = (seconds: (frame: number) => number) => {
		const player = new PlayerController(world, at(level.marks.walkableRamp));
		const positions = new Map<number, number[]>();
		for (let frame = 0; player.clock.ticks < 240; frame++) {
			player.update(seconds(frame), held);
			positions.set(player.clock.ticks, player.character.position.toArray());
		}
		return positions;
	};
	const reference = trace(() => 1 / 60);
	const other = trace(frameSeconds);
	expect(other.size).toBeGreaterThan(40);
	for (const [tick, position] of other) {
		expect(position.every(Number.isFinite)).toBe(true);
		if (tick > 0) expect(position).toEqual(reference.get(tick));
	}
});

it('resumes after 30 s hidden without replaying them', () => {
	const walk = input({ moveY: 1 });
	const resumed = new PlayerController(world, at(level.marks.spawn));
	for (let frame = 0; frame < 30; frame++) resumed.update(1 / 60, walk);
	const before = resumed.character.position.clone();
	resumed.resume();
	expect(resumed.update(30, walk).ticks).toBe(0);
	expect(resumed.character.position.equals(before)).toBe(true);
	expect(resumed.update(1 / 60, walk).ticks).toBe(1);

	const forgotten = new PlayerController(world, at(level.marks.spawn));
	expect(forgotten.update(30, walk).ticks).toBe(4);
	expect(forgotten.character.position.z).toBeLessThan(4 * (9.6 / 60) + 1e-9);
});

it('keeps the body facing the camera while strafing in shift-lock and in first person', () => {
	const strafe = (overrides: Partial<InputFrame>, zoomIn = false) => {
		const player = new PlayerController(world, at(level.marks.spawn));
		if (zoomIn) player.update(1 / 60, input({ zoomDelta: -20 }));
		for (let frame = 0; frame < 30; frame++) player.update(1 / 60, input({ moveX: 1, ...overrides }));
		return player;
	};
	// The camera sits behind a +z-facing body (yaw π), so its right is -x.
	const free = strafe({});
	expect(free.character.position.x).toBeLessThan(-4);
	expect(free.character.yaw).toBeCloseTo(-Math.PI / 2, 3);
	const locked = strafe({ shiftLock: true });
	expect(locked.character.position.x).toBeLessThan(-4);
	expect(locked.character.yaw).toBeCloseTo(0, 12);
	expect(locked.frame.pose.shiftLock).toBe(true);
	const firstPerson = strafe({}, true);
	expect(firstPerson.camera.firstPerson).toBe(true);
	expect(firstPerson.character.yaw).toBeCloseTo(0, 12);
});

const LANES = [
	'spawn',
	'steepRamp',
	'walkableRamp',
	'stepHigh',
	'log',
	'bridge',
	'lowCeiling',
	'corner',
	'thinWall',
	'trailhead'
] as const;

it.each(LANES.map((mark, seed) => [mark, seed] as const))(
	'survives a long random run from %s without NaN, tunnelling or sinking',
	(mark, seed) => {
		const next = random(20261025 + seed * 7919);
		const tracker = new CheckpointTracker(level.start, level.checkpoints, level.killY);
		const player = new PlayerController(world, at(level.marks[mark]), { checkpoints: tracker });
		const character = player.character;
		const wallFace = THIN_WALL_THICKNESS / 2 + character.options.radius;
		let frameInput = input();
		let worst = 0;
		let jumps = 0;
		let previous = character.position.clone();
		for (let frame = 0; frame < 1500; frame++) {
			if (frame % 20 === 0) {
				const angle = Math.floor(next() * 8) * (Math.PI / 4);
				const stop = next() < 0.15;
				frameInput = input({
					moveX: stop ? 0 : Math.sin(angle),
					moveY: stop ? 0 : Math.cos(angle),
					jumpHeld: next() < 0.3,
					touchLookX: (next() - 0.5) * 40
				});
			}
			frameInput.jumpPressed = next() < 0.02;
			const seconds = next() < 0.05 ? 0.2 : 1 / (30 + Math.floor(next() * 115));
			const result = player.update(seconds, frameInput);
			if (result.jumped) jumps++;

			const position = character.position;
			expect(position.toArray().every(Number.isFinite)).toBe(true);
			expect(result.pose.position.toArray().every(Number.isFinite)).toBe(true);
			expect(result.pose.distance).toBeGreaterThanOrEqual(0);
			if (!tracker.respawning) worst = Math.max(worst, penetration(character));
			// Never through the ground from above while over it.
			const overGround = Math.abs(position.x) < 39 && position.z > -29 && position.z < 39;
			if (overGround && previous.y >= -1e-6) expect(position.y).toBeGreaterThanOrEqual(-1e-6);
			// Never from one side of the thin wall to the other while in front of it.
			const facing = (point: Vector3) => Math.abs(point.x - 32) < 2.4 && point.y < 3.5;
			if (facing(previous) && facing(position) && Math.abs(previous.z - 10) >= wallFace - 1e-6)
				expect(Math.sign(position.z - 10)).toBe(Math.sign(previous.z - 10));
			previous = position.clone();
		}
		expect(worst).toBeLessThan(1e-3);
		expect(jumps).toBeGreaterThan(10);
	}
);
