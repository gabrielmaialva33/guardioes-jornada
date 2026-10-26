import { expect, it } from 'vitest';
import { AvatarAnimator, createAvatarInput } from '../animation/avatar-animator.ts';
import { buildStoryWorld } from '../level/index.ts';
import { StoryGame } from '../missions/story.ts';
import { AvatarWiring } from './avatar-wiring.ts';

it('copies transient gesture positions and waits for real idle, then preserves event order', () => {
	const animator = new AvatarAnimator(),
		input = createAvatarInput(),
		wiring = new AvatarWiring(animator);
	const target = { x: 0.4, y: 0.2, z: 0.8 };
	wiring.enqueue('pickup', target);
	wiring.enqueue('cheer', null);
	target.x = 100;
	input.speed = 2;
	input.intent = 1;
	wiring.update(input, 1 / 60);
	animator.update(1 / 60, input);
	expect(wiring.started).toBe(false);
	input.speed = 0;
	input.intent = 0;
	for (let i = 0; i < 80 && wiring.lastGesture !== 'pickup'; i++) {
		wiring.update(input, 1 / 60);
		animator.update(1 / 60, input);
	}
	expect(wiring.lastGesture).toBe('pickup');
	for (let i = 0; i < 180 && wiring.lastGesture !== 'cheer'; i++) {
		wiring.update(input, 1 / 60);
		animator.update(1 / 60, input);
	}
	expect(wiring.lastGesture).toBe('cheer');
});
it('uses stable look candidates, removing a collected reward without snapping to its invisible model', () => {
	const { level } = buildStoryWorld();
	const story = new StoryGame(level, { persist: () => true, badge: () => {} }),
		animator = new AvatarAnimator(),
		wiring = new AvatarWiring(animator, story),
		input = createAvatarInput();
	const c = level.collectibles.find((c) => c.kind === 'trash');
	if (!c) throw new Error('trash');
	input.x = c.x;
	input.y = c.y;
	input.z = c.z - 1;
	input.yaw = 0;
	wiring.update(input, 1 / 60);
	const candidates = wiring.candidates;
	expect(input.lookTarget).toBeTruthy();
	story.data.collected.push(c.id);
	story.revision++;
	wiring.update(input, 1 / 60);
	expect(wiring.candidates).toBe(candidates);
	expect(candidates.find((p) => p.id === 1000 + level.collectibles.indexOf(c))?.x).toBe(Infinity);
});
