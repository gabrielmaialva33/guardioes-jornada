import { expect, it } from 'vitest';
import { Ladder } from './ladder.ts';
import { Zipline } from './zipline.ts';

const ladderSpec = {
	id: 'tree',
	base: { x: 0, y: 0, z: 0 },
	top: { x: 0, y: 6, z: 0 },
	exit: { x: 0, y: 6, z: 2 },
	radius: 1
};
it('climbs at half walk speed, dismounts on the deck, and can descend', () => {
	const l = new Ladder(ladderSpec);
	expect(l.enter({ x: 0, y: 0, z: 0 })).toBe(true);
	for (let i = 0; i < 60; i++) l.step(1 / 60, 1, false, 9.6);
	expect(l.position.y).toBeCloseTo(4.8);
	expect(l.phase).toBe('climbing');
	for (let i = 0; i < 30; i++) l.step(1 / 60, 1, false, 9.6);
	expect(l.phase).toBe('top');
	expect(l.position).toEqual(ladderSpec.exit);
	l.step(0.5, 0, false, 9.6);
	expect(l.enter(ladderSpec.exit)).toBe(true);
	l.step(1 / 60, -1, false, 9.6);
	expect(l.position.y).toBeLessThan(6);
});
it('rejects distant entry and detaches on jump without instant reattachment', () => {
	const l = new Ladder(ladderSpec);
	expect(l.enter({ x: 3, y: 0, z: 0 })).toBe(false);
	l.enter(ladderSpec.base);
	l.step(1 / 60, 1, true, 9.6);
	expect(l.phase).toBe('detached');
	expect(l.enter(l.position)).toBe(false);
	l.step(0.5, 0, false, 9.6);
	expect(l.enter(l.position)).toBe(true);
});
it('rides the Act 1 cable in roughly eight seconds, caps speed and brakes in the last six units', () => {
	const z = new Zipline({ id: 'home', start: { x: 128, y: 15, z: 80 }, end: { x: 46, y: 4, z: 84 } });
	expect(z.start(false)).toBe(false);
	expect(z.start(true)).toBe(true);
	let elapsed = 0,
		max = 0,
		brakeSpeed = 0;
	while (z.phase === 'riding' && elapsed < 15) {
		z.step(1 / 60);
		elapsed += 1 / 60;
		max = Math.max(max, z.speed);
		if (z.remaining < 2) brakeSpeed = z.speed;
	}
	expect(z.phase).toBe('arrived');
	expect(elapsed).toBeGreaterThan(7);
	expect(elapsed).toBeLessThan(11);
	expect(max).toBeLessThanOrEqual(11);
	expect(brakeSpeed).toBeLessThan(8);
	expect(z.position).toEqual(z.spec.end);
});
it('rejects degenerate and uphill cables', () => {
	expect(() => new Zipline({ id: 'bad', start: { x: 0, y: 0, z: 0 }, end: { x: 0, y: 0, z: 0 } })).toThrow();
	expect(() => new Zipline({ id: 'bad', start: { x: 0, y: 0, z: 0 }, end: { x: 3, y: 1, z: 0 } })).toThrow();
});
