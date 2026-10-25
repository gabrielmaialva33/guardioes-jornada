import { Ray, Vector3 } from 'three';
import { expect, it } from 'vitest';
import { CheckpointTracker } from './checkpoints.ts';
import { JUMP_SPEED, MAX_SLOPE } from './constants.ts';
import { PlayerController } from './controller.ts';
import {
	buildCollisionWorld,
	createGraybox,
	jumpReach,
	proxyGeometry,
	STEEP_RAMP_ANGLE,
	WALKABLE_RAMP_ANGLE
} from './graybox.ts';
import type { InputFrame } from './input.ts';

const DT = 1 / 60;
const level = createGraybox();
const world = buildCollisionWorld(level);

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

function playerAtTrailhead() {
	const [x, y, z] = level.marks.trailhead;
	const tracker = new CheckpointTracker(level.start, level.checkpoints, level.killY);
	return new PlayerController(world, { x, y, z }, { checkpoints: tracker });
}

it('builds a small static collider set whose ramps have the declared slopes', () => {
	expect(world.triangles).toBeLessThan(500);
	const heightAt = (x: number, z: number) =>
		20 - (world.raycast(new Ray(new Vector3(x, 20, z), new Vector3(0, -1, 0)), 40) ?? Number.NaN);
	expect(heightAt(-26, 9)).toBeCloseTo(3 * Math.tan(WALKABLE_RAMP_ANGLE), 5);
	expect(heightAt(-32, 7)).toBeCloseTo(1 * Math.tan(STEEP_RAMP_ANGLE), 5);
	expect(WALKABLE_RAMP_ANGLE).toBeLessThan(MAX_SLOPE);
	expect(STEEP_RAMP_ANGLE).toBeGreaterThan(MAX_SLOPE);
	for (const proxy of level.proxies) {
		const positions = proxyGeometry(proxy).getAttribute('position').array;
		expect(Array.from(positions).every(Number.isFinite)).toBe(true);
	}
});

it('sizes the obby gaps from the jump reach, and a running jump clears every one', () => {
	const { gaps, rises, platforms, edgeZ } = level.obby;
	for (const [i, gap] of gaps.entries()) expect(gap).toBeLessThan(jumpReach(rises[i]));
	expect(gaps[0]).toBeCloseTo(0.5 * jumpReach(0), 9);
	expect(jumpReach(10)).toBe(0);
	expect(jumpReach(0)).toBeCloseTo((9.6 * 2 * JUMP_SPEED) / 117.72, 9);

	const player = playerAtTrailhead();
	const edges = [edgeZ, ...platforms.slice(0, -1).map((platform) => platform.to)];
	const reached: string[] = [];
	for (let frame = 0; frame < 600 && !reached.includes('summit'); frame++) {
		const { position, grounded } = player.character;
		const takeOff = grounded && edges.some((edge) => position.z > edge - 0.4 && position.z < edge);
		const result = player.update(DT, input({ moveY: 1, jumpPressed: takeOff }));
		for (const event of result.events) {
			expect(event.type).toBe('checkpoint');
			if (event.type === 'checkpoint') reached.push(event.checkpoint.id);
		}
	}
	expect(reached).toEqual(['trailhead', 'summit']);
});

it('respawns at the last checkpoint a quarter of a second after falling into the void', () => {
	const player = playerAtTrailhead();
	const log: { type: string; tick: number }[] = [];
	let ticks = 0;
	for (let frame = 0; frame < 240 && !log.some((entry) => entry.type === 'respawn'); frame++) {
		const result = player.update(DT, input({ moveY: 1 }));
		ticks += result.ticks;
		for (const event of result.events) log.push({ type: event.type, tick: ticks });
	}
	expect(log.map((entry) => entry.type)).toEqual(['checkpoint', 'fell', 'respawn']);
	expect((log[2].tick - log[1].tick) * DT).toBeCloseTo(0.25, 9);
	const [x, y, z] = level.marks.trailhead;
	expect(player.character.position.distanceTo(new Vector3(x, y, z))).toBeLessThan(1e-6);
	expect(player.character.grounded).toBe(true);
	expect(player.camera.yaw).toBeCloseTo(Math.PI, 9);
});
