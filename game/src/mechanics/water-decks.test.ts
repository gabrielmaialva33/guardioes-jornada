import { expect, it } from 'vitest';
import { Boardwalk } from './boardwalk.ts';
import { SuspensionBridge } from './bridge.ts';
import { Canoe } from './canoe.ts';

const channel = [
	{ x: 0, y: 0, z: 0 },
	{ x: 0, y: 0, z: 20 },
	{ x: 10, y: 0, z: 30 }
];
const landings = [
	{ id: 'a', water: channel[0], exit: { x: 2, y: 0, z: 0 } },
	{ id: 'b', water: channel[2], exit: { x: 12, y: 0, z: 30 } }
];
it('rows, turns, drifts gently, stays in the channel and exits only at a landing', () => {
	const c = new Canoe({ id: 'river', channel, halfWidth: 3, landings });
	expect(c.board({ x: 30, y: 0, z: 0 })).toBe(false);
	expect(c.board(landings[0].exit)).toBe(true);
	for (let i = 0; i < 120; i++) c.step(1 / 60, 1, 0);
	expect(c.speed).toBeLessThanOrEqual(4);
	expect(c.position.z).toBeGreaterThan(5);
	expect(c.leave()).toBe(false);
	const before = c.position.z;
	for (let i = 0; i < 120; i++) c.step(1 / 60, 0, 0);
	expect(c.position.z).toBeGreaterThan(before);
	for (let i = 0; i < 3000; i++) c.step(1 / 60, 1, 0.5);
	expect(c.distanceFromChannel(c.position)).toBeLessThanOrEqual(2.00001);
	const dock = new Canoe({ id: 'dock', channel, halfWidth: 3, landings });
	dock.board(landings[0].exit);
	expect(dock.leave()).toBe(true);
	expect(dock.position).toEqual(landings[0].exit);
});
it('damps every bridge plank, bounds sway and resets immediately for reduced motion', () => {
	const b = new SuspensionBridge({
		id: 'bridge',
		start: { x: 0, y: 4, z: 0 },
		end: { x: 0, y: 4, z: 16 },
		width: 2,
		planks: 20
	});
	for (let i = 0; i < 120; i++) b.step(1 / 60, { x: 0, y: 3.5, z: 8 }, 9.6, false);
	expect(Math.max(...b.offsets.map(Math.abs))).toBeLessThanOrEqual(0.25);
	expect(Math.abs(b.offsets[10])).toBeGreaterThan(0.01);
	for (let i = 0; i < 600; i++) b.step(1 / 60, { x: 20, y: 4, z: 8 }, 0, false);
	expect(Math.max(...b.offsets.map(Math.abs))).toBeLessThan(0.001);
	b.step(1 / 60, { x: 0, y: 3.5, z: 8 }, 9.6, false);
	b.step(1 / 60, { x: 0, y: 3.5, z: 8 }, 9.6, true);
	expect([...b.offsets].every((v) => v === 0)).toBe(true);
	expect(b.heightAt(0, 8)).toBeCloseTo(3.5, 2);
	expect(b.heightAt(2, 8)).toBeNull();
});
it('frames a nearby lookout briefly, cuts instantly with reduced motion, and never activates from afar', () => {
	const b = new Boardwalk({
		id: 'deck',
		start: { x: 0, y: 4, z: 0 },
		end: { x: 0, y: 4, z: 20 },
		width: 2,
		lookouts: [
			{
				id: 'view',
				position: { x: 0, y: 4, z: 10 },
				camera: { x: 4, y: 8, z: 10 },
				target: { x: 0, y: 5, z: 0 }
			}
		]
	});
	expect(b.action({ x: 10, y: 4, z: 10 }, false)).toBe(false);
	expect(b.action({ x: 0, y: 4, z: 10 }, true)).toBe(true);
	expect(b.blend).toBe(1);
	b.step(3.1, true);
	expect(b.phase).toBe('walking');
	expect(b.blend).toBe(0);
	b.action({ x: 0, y: 4, z: 10 }, false);
	b.step(0.1, false);
	expect(b.blend).toBeGreaterThan(0);
	expect(b.blend).toBeLessThan(1);
});
