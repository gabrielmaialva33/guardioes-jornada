import { describe, expect, it } from 'vitest';
import { WALK_SPEED } from '../../engine/constants.ts';
import { createAnimal } from './animal.ts';
import { MICO } from './mico.ts';
import { createAnimalWorld } from './motion.ts';

function companion() {
	const mico = createAnimal('mico-leao-dourado', { seed: 12, companion: true, x: 0, y: 0, z: 6 });
	const world = createAnimalWorld();
	world.playerVx = 0;
	world.playerVz = 0;
	world.groundY = 0;
	return { mico, world };
}

const gap = (mico: ReturnType<typeof companion>['mico'], world: ReturnType<typeof createAnimalWorld>) =>
	Math.hypot(mico.motion.x - world.playerX, mico.motion.z - world.playerZ);

describe('mico companion follow', () => {
	it('settles 3 studs from a still player and then does not move at all', () => {
		const { mico, world } = companion();
		for (let i = 0; i < 180; i++) mico.update(1 / 60, world);
		expect(Math.abs(gap(mico, world) - MICO.followDistance)).toBeLessThan(MICO.bandIn + 1e-6);
		expect(mico.state).toBe('idle');
		let x = mico.motion.x;
		let z = mico.motion.z;
		for (let i = 0; i < 300; i++) {
			mico.update(1 / 60, world);
			expect(mico.motion.x).toBe(x);
			expect(mico.motion.z).toBe(z);
			expect(mico.state).toBe('idle');
			x = mico.motion.x;
			z = mico.motion.z;
		}
	});

	for (const hz of [30, 60, 144]) {
		it(`keeps the gap while the player walks, without jitter (${hz} Hz)`, () => {
			const { mico, world } = companion();
			const dt = 1 / hz;
			world.playerVx = WALK_SPEED;
			let toggles = 0;
			let previous = '';
			let lastSpeed = Number.NaN;
			let maxSpeedChange = 0;
			for (let i = 0; i < 8 * hz; i++) {
				world.playerX += WALK_SPEED * dt;
				mico.update(dt, world);
				const t = (i + 1) * dt;
				if (t < 2) continue;
				// Steady following: within half a stud of 3 studs, at the player's speed, one state.
				expect(Math.abs(gap(mico, world) - MICO.followDistance)).toBeLessThan(0.3);
				const speed = Math.hypot(mico.behaviour.vx, mico.behaviour.vz);
				if (Number.isFinite(lastSpeed))
					maxSpeedChange = Math.max(maxSpeedChange, Math.abs(speed - lastSpeed));
				lastSpeed = speed;
				if (previous && mico.state !== previous) toggles++;
				previous = mico.state;
			}
			expect(toggles).toBe(0);
			expect(Math.abs(lastSpeed - WALK_SPEED)).toBeLessThan(0.05 * WALK_SPEED);
			expect(maxSpeedChange).toBeLessThan(0.05);
		});
	}

	it('stops without bouncing when the player stops', () => {
		const { mico, world } = companion();
		world.playerVx = WALK_SPEED;
		for (let i = 0; i < 240; i++) {
			world.playerX += WALK_SPEED / 60;
			mico.update(1 / 60, world);
		}
		world.playerVx = 0;
		let reversals = 0;
		let lastVx = mico.behaviour.vx;
		let closest = Number.POSITIVE_INFINITY;
		for (let i = 0; i < 240; i++) {
			mico.update(1 / 60, world);
			const vx = mico.behaviour.vx;
			if (Math.sign(vx) !== Math.sign(lastVx) && Math.abs(vx) > 1e-3 && Math.abs(lastVx) > 1e-3) reversals++;
			lastVx = vx;
			closest = Math.min(closest, gap(mico, world));
		}
		expect(reversals).toBeLessThanOrEqual(1);
		expect(closest).toBeGreaterThan(MICO.followDistance - MICO.bandOut);
		expect(mico.state).toBe('idle');
		expect(Math.abs(gap(mico, world) - MICO.followDistance)).toBeLessThanOrEqual(MICO.bandOut);
	});

	it('hops when the player jumps, after a short anticipation, and lands back', () => {
		const { mico, world } = companion();
		for (let i = 0; i < 120; i++) mico.update(1 / 60, world);
		world.playerJumped = true;
		mico.frame(1 / 60, world, 5, true);
		world.playerJumped = false;
		expect(mico.state).toBe('hop');
		let peak = 0;
		let crouched = false;
		for (let i = 0; i < 60; i++) {
			mico.frame(1 / 60, world, 5, true);
			peak = Math.max(peak, mico.motion.y);
			if (mico.motion.crouch > 0) crouched = true;
		}
		expect(crouched).toBe(true);
		expect(peak).toBeGreaterThan(0.8 * MICO.hopHeight);
		expect(mico.motion.y).toBe(0);
		expect(mico.state).toBe('idle');
	});

	it('reappears behind a player who teleported far away', () => {
		const { mico, world } = companion();
		world.playerX = 100;
		mico.update(1 / 60, world);
		expect(gap(mico, world)).toBeLessThan(MICO.followDistance + 0.5);
	});
});
