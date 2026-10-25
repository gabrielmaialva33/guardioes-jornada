import { Ray, Vector3 } from 'three';
import { expect, it } from 'vitest';
import { type AvatarProfile, createLocalSave } from '../data/local-save.ts';
import { Character } from '../engine/character.ts';
import { buildStoryWorld } from '../level/build.ts';
import { createMapEnvironment } from './environment.ts';

const profile: AvatarProfile = {
	style: 'classic',
	kenneySkin: 'a',
	face: 'smile',
	colors: { skin: '#b0744d', hair: '#5e4330', shirt: '#2f7fb0', pants: '#4f5c55', shoes: '#4f5c55' }
};
it('uses the real story checkpoints, targets and map-scoped device save', () => {
	const { world, level } = buildStoryWorld(),
		values = new Map<string, string>();
	const save = createLocalSave(profile, {
		getItem: (k) => values.get(k) ?? null,
		setItem: (k, v) => {
			values.set(k, v);
		}
	});
	const map = createMapEnvironment(world, level, save);
	expect(map.environment.checkpoints.map((c) => c.id)).toEqual(level.checkpoints.map((c) => c.id));
	const bank = level.checkpoints.find((c) => c.id === 'pedras-leste');
	if (!bank) throw new Error('story-bank');
	expect(map.tracker.update(1 / 60, bank.spawn)?.type).toBe('checkpoint');
	const reloaded = createMapEnvironment(world, level, save);
	expect(reloaded.checkpoint.id).toBe(bank.id);
	expect(reloaded.environment.target.name).toBe(level.missions[0].name);
	reloaded.environment.nextTarget();
	expect(reloaded.environment.target.name).toBe(level.missions[1].name);
	map.environment.collision.dispose();
	reloaded.environment.collision.dispose();
});
it('the BVH supports all authored checkpoint pads and every mirante ledge at their visible tops', () => {
	const { world, level } = buildStoryWorld();
	const map = createMapEnvironment(
		world,
		level,
		createLocalSave(profile, { getItem: () => null, setItem() {} })
	);
	const collision = map.environment.collision;
	for (const cp of [level.start, ...level.checkpoints]) {
		const character = new Character(collision, cp.spawn, cp.yaw);
		for (let i = 0; i < 20; i++)
			character.step(1 / 60, { moveX: 0, moveZ: 0, jumpHeld: false, faceYaw: null });
		expect(character.position.y, cp.id).toBeCloseTo(cp.spawn.y, 1);
		expect(character.grounded, cp.id).toBe(true);
	}
	for (const p of level.obbies.find((o) => o.id === 'ledges')?.pieces ?? []) {
		expect(
			collision.raycast(new Ray(new Vector3(p.x, p.y + 0.5, p.z), new Vector3(0, -1, 0)), 1),
			p.variant
		).toBeCloseTo(0.5, 4);
	}
	collision.dispose();
});
