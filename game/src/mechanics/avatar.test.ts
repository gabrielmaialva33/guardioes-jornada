import { expect, it } from 'vitest';
import { createAvatarInput } from '../animation/avatar-animator.ts';
import { readTraversal } from './avatar.ts';
import { createMechanicsFixture } from './fixture.ts';
import { Ladder } from './ladder.ts';
import { createCanoeMesh, createLadderMesh, createZiplineMesh } from './meshes.ts';

it('shares rung spacing between ladder data, mesh and the reusable avatar input', () => {
	const f = createMechanicsFixture(),
		input = createAvatarInput();
	f.traversal.mode = 'ladder';
	f.traversal.active = f.ladder;
	f.ladder.position.y = 2.1;
	expect(readTraversal(input, f.traversal, 1)).toBe(input);
	expect(input.climbing).toBe(true);
	expect(input.ladderRungSpacing).toBe(0.45);
	expect(input.ladderDistance).toBeCloseTo(1.8);
	const l = new Ladder({ ...f.ladder.spec, rungSpacing: 0.6 });
	expect(l.rungSpacing).toBe(0.6);
	const mesh = createLadderMesh(l);
	mesh.dispose();
	expect(() => new Ladder({ ...f.ladder.spec, rungSpacing: 0 })).toThrow();
	f.dispose();
});
it('takes speed from the zipline and stroke/side from the canoe, clearing attachment state on exit', () => {
	const f = createMechanicsFixture(),
		i = createAvatarInput();
	f.traversal.mode = 'zipline';
	f.traversal.active = f.zipline;
	f.zipline.speed = 9;
	readTraversal(i, f.traversal, 1);
	expect(i.hanging).toBe(true);
	expect(i.ziplineSpeed).toBe(9);
	f.traversal.mode = 'canoe';
	f.traversal.active = f.canoe;
	f.canoe.stroke = 3;
	f.canoe.speed = -2;
	readTraversal(i, f.traversal, -1);
	expect(i.hanging).toBe(false);
	expect(i.rowing).toBe(true);
	expect(i.canoeStroke).toBe(3);
	expect(i.paddleSide).toBe(-1);
	f.traversal.reset();
	readTraversal(i, f.traversal, 1);
	expect(i.rowing).toBe(false);
	expect(i.sitting).toBe(false);
	expect(i.ladderRungSpacing).toBe(0);
	f.dispose();
});
it('exposes mesh grip/seat/side and suppresses boat bob while retaining the working paddle with reduced motion', () => {
	const f = createMechanicsFixture(),
		mesh = createCanoeMesh(f.canoe, -1),
		zip = createZiplineMesh(f.zipline);
	expect(mesh.paddleSide).toBe(-1);
	expect(mesh.seatOffset).toBeLessThan(0);
	expect(zip.gripHeight).toBeGreaterThanOrEqual(2.4);
	expect(zip.gripHeight).toBeLessThanOrEqual(3);
	f.canoe.speed = 4;
	f.canoe.stroke = Math.PI / 2;
	mesh.update(true);
	expect(mesh.boat.position.y).toBe(f.canoe.position.y);
	expect(Math.abs(mesh.paddle.rotation.x)).toBeGreaterThan(0);
	mesh.dispose();
	zip.dispose();
	f.dispose();
});
