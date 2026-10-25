import { describe, expect, it } from 'vitest';
import { generateWorld } from './generate.ts';
import {
	decodeSaveDelta,
	deltaProblems,
	encodeSaveDelta,
	newSaveDelta,
	SaveDeltaError,
	type SurvivalSaveDelta
} from './save.ts';

const world = generateWorld(20261025);
const fresh = newSaveDelta(world, 'explorer');
const played: SurvivalSaveDelta = {
	...fresh,
	mode: 'guardian',
	day: 3,
	forestHealth: 72.5,
	collected: [0, 3],
	planted: [
		{ cell: world.corridor.cells[0].cell, species: 'embauba', day: 1 },
		{ cell: world.corridor.cells[1].cell, species: 'ipe-amarelo', day: 2 },
		{ cell: world.corridor.cells[2].cell, species: 'jucara', day: 3 }
	],
	npcCalls: world.threats.slice(0, 3).map((slot) => ({ threat: slot.id, responder: slot.responder, day: 2 })),
	cameraTraps: [
		{ spot: 0, day: 1 },
		{ spot: 5, day: 2 }
	]
};

describe('survival save delta', () => {
	it('round-trips a fresh and a played delta', () => {
		expect(decodeSaveDelta(encodeSaveDelta(fresh))).toEqual(fresh);
		const text = encodeSaveDelta(played);
		expect(decodeSaveDelta(text)).toEqual(played);
		expect(decodeSaveDelta(JSON.parse(text))).toEqual(played);
		expect(encodeSaveDelta(decodeSaveDelta(text))).toBe(text);
	});

	it('fits the world it was taken from, and only that one', () => {
		expect(deltaProblems(played, world)).toEqual([]);
		expect(deltaProblems(played, generateWorld(1))).toContain('another seed');
		expect(deltaProblems({ ...played, generatorVersion: world.generatorVersion + 1 }, world)).toContain(
			'generator version changed'
		);
		expect(deltaProblems({ ...played, planted: [{ cell: 0, species: 'embauba', day: 1 }] }, world)).toContain(
			'not a planting cell'
		);
		expect(deltaProblems({ ...played, cameraTraps: [{ spot: 999, day: 1 }] }, world)).toContain(
			'unknown camera spot'
		);
	});

	it('drops unknown fields', () => {
		expect(decodeSaveDelta({ ...fresh, extra: true })).toEqual(fresh);
	});

	it('rejects malformed deltas', () => {
		const bad: unknown[] = [
			'not json',
			null,
			[],
			{ ...fresh, format: 2 },
			{ ...fresh, mode: 'hard' },
			{ ...fresh, day: 0 },
			{ ...fresh, day: 6 },
			{ ...fresh, forestHealth: 101 },
			{ ...fresh, forestHealth: Number.NaN },
			{ ...fresh, seed: -1 },
			{ ...fresh, collected: [1, 1] },
			{ ...fresh, collected: [0.5] },
			{ ...played, planted: [played.planted[0], played.planted[0]] },
			{ ...played, planted: [{ ...played.planted[0], species: 'pau-brasil' }] },
			{ ...played, npcCalls: [{ threat: 0, responder: 'child', day: 1 }] },
			{ ...played, cameraTraps: [{ spot: 0, day: 4 }] },
			{ ...fresh, collected: Array.from({ length: 65 }, (_, k) => k) }
		];
		for (const value of bad)
			expect(() => decodeSaveDelta(value), JSON.stringify(value)).toThrow(SaveDeltaError);
	});
});
