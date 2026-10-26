import { expect, it } from 'vitest';
import { getHeapStatistics } from 'node:v8';
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
function allocated(){const h=getHeapStatistics();return 'total_allocated_bytes' in h && typeof h.total_allocated_bytes==='number'?h.total_allocated_bytes:null;}
it.skipIf(allocated()===null)('reuses look/gesture state in the steady-state avatar loop',()=>{
	const {level}=buildStoryWorld(),story=new StoryGame(level,{persist:()=>true,badge:()=>{}}),animator=new AvatarAnimator(),input=createAvatarInput(),wiring=new AvatarWiring(animator,story);
	input.x=level.spawn.x;input.y=level.spawn.y;input.z=level.spawn.z;input.yaw=0;
	for(let i=0;i<200000;i++){wiring.update(input,1/60);animator.update(1/60,input);}
	let best=Infinity;
	for(let run=0;run<5;run++){const before=allocated()??0;for(let i=0;i<100000;i++){wiring.update(input,1/60);animator.update(1/60,input);}best=Math.min(best,((allocated()??0)-before)/100000);}
	expect(best).toBeLessThan(4);
});
