import { Box3, Group, Texture, Vector3 } from 'three';
import { expect, it } from 'vitest';
import type { SurvivalWorld } from '../../survival/types.ts';
import { createTreeImpostors } from '../tree-impostors.ts';

it('reuses bounded impostor slots across chunk unloads without rebaking an atlas or growing geometry', () => {
	const trees: SurvivalWorld['trees'] = {
		count: 0,
		kinds: ['jucara'],
		kind: new Uint8Array(),
		block: new Uint8Array(),
		x: new Float32Array(),
		y: new Float32Array(),
		z: new Float32Array(),
		scale: new Float32Array(),
		yawC: new Float32Array(),
		yawS: new Float32Array()
	};
	const atlas = new Texture();
	const bank = createTreeImpostors(
		[{ kind: 'jucara', model: new Group(), bounds: new Box3(new Vector3(-1, 0, -1), new Vector3(1, 8, 1)) }],
		trees,
		'low',
		{ capacity: 2, atlas }
	);
	const first = bank.add('jucara', 10, 2, 20, 1),
		second = bank.add('jucara', 30, 4, 40, 1);
	expect(first).toBeGreaterThanOrEqual(0);
	expect(second).toBeGreaterThanOrEqual(0);
	expect(bank.add('jucara', 50, 0, 60, 1)).toBe(-1);
	expect(bank.object.count).toBe(2);
	bank.remove(first);
	expect(bank.object.count).toBe(1);
	const array = bank.object.instanceMatrix.array;
	expect(array[12]).toBe(30);
	expect(array[14]).toBe(40);
	expect(bank.add('jucara', 50, 0, 60, 1)).toBe(first);
	bank.remove(second);
	bank.remove(first);
	expect(bank.object.count).toBe(0);
	bank.dispose();
});
