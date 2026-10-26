import { BoxGeometry, Vector3 } from 'three';
import { expect, it } from 'vitest';
import { createAvatarInput } from '../animation/avatar-animator.ts';
import { CollisionWorld } from '../engine/world.ts';
import { buildStoryWorld } from '../level/index.ts';
import { AvatarGroundContext } from './avatar-context.ts';

const { world, level } = buildStoryWorld();
const geometry = new BoxGeometry(10, 1, 10).translate(0, -0.5, 0);
const collision = new CollisionWorld([{ geometry }]);
geometry.dispose();
const sample = new AvatarGroundContext(collision, world, level);
const input = createAvatarInput();
const character = { position: new Vector3(), previousPosition: new Vector3(), groundNormal: new Vector3(0, 1, 0), grounded: true };

it('balances on authored stone tops and sloping bridge decks, never on the riverbed below', () => {
	const stone = level.obbies.find((o) => o.id === 'stones')?.pieces[0];
	if (!stone) throw new Error('stone');
	character.position.set(stone.x, stone.y, stone.z);
	sample.update(input, character);
	expect(input.surface).toBe('narrow');
	const bridge = world.crossings.find((c) => c.kind === 'bridge');
	if (!bridge) throw new Error('bridge');
	character.position.set((bridge.from.x + bridge.to.x) / 2, (bridge.from.y + bridge.to.y) / 2, (bridge.from.z + bridge.to.z) / 2);
	sample.update(input, character);
	expect(input.surface).toBe('narrow');
	character.position.y -= 1.5;
	sample.update(input, character);
	expect(input.surface).not.toBe('narrow');
});
it('wades only below the water surface and above knee depth; airborne inputs reset', () => {
	character.position.set(level.pool.x, level.pool.water - 0.3, level.pool.z);
	sample.update(input, character);
	expect(input.surface).toBe('water');
	character.position.y = level.pool.water - 1;
	sample.update(input, character);
	expect(input.surface).toBe('ground');
	character.grounded = false;
	input.slope = 1;
	sample.update(input, character);
	expect(input.surface).toBe('ground');
	expect(input.slope).toBe(0);
	expect(input.edgeAhead).toBe(Infinity);
	character.grounded = true;
});
it('uses facing-relative ground normals and a real down-probe at a ledge', () => {
	character.position.set(0, 0, 0);
	character.previousPosition.copy(character.position);
	input.yaw = 0;
	character.groundNormal.set(0, Math.cos(0.3), -Math.sin(0.3));
	sample.update(input, character);
	expect(input.slope).toBeCloseTo(0.3);
	expect(input.edgeAhead).toBe(Infinity);
	character.position.set(0, 0, 4.8);
	character.previousPosition.copy(character.position);
	sample.update(input, character);
	expect(input.edgeAhead).toBeLessThan(0.4);
	// Movement direction wins over facing: walking back away from the edge is safe.
	character.previousPosition.z = 4.9;
	sample.update(input, character);
	expect(input.edgeAhead).toBe(Infinity);
});
