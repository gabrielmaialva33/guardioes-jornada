/**
 * What a survival game persists: only the changes on top of the generated
 * world. The world itself is never saved; seed + generatorVersion rebuild it,
 * and its checksum tells whether the rebuild matches (research §4.4). Storage
 * lives elsewhere: this file only defines, encodes and validates the shape.
 */
import {
	PLANT_GRID,
	RESPONDER,
	type Responder,
	type Seedling,
	SEEDLINGS,
	type SurvivalWorld
} from './types.ts';

export const SAVE_FORMAT = 1;
/** Days in the longer (guardian) mode; the explorer mode plays 3. */
export const MAX_DAYS = 5;

export type GameMode = 'explorer' | 'guardian';

export interface PlantedCell {
	/** Planting grid cell id (PlantingCell.cell). */
	cell: number;
	species: Seedling;
	/** Day it was planted: growth follows game days, never the real clock. */
	day: number;
}

export interface NpcCall {
	/** ThreatSlot.id the child reported. */
	threat: number;
	responder: Responder;
	day: number;
}

export interface CameraTrap {
	/** CameraSpot.id. */
	spot: number;
	day: number;
}

export interface SurvivalSaveDelta {
	format: typeof SAVE_FORMAT;
	generatorVersion: number;
	seed: number;
	/** Checksum of the world this delta applies to. */
	checksum: number;
	mode: GameMode;
	/** 1-based day the save was taken at (each dawn). */
	day: number;
	/** Saúde da Mata, 0 to 100. */
	forestHealth: number;
	/** ResourceNode ids picked up. */
	collected: number[];
	planted: PlantedCell[];
	npcCalls: NpcCall[];
	cameraTraps: CameraTrap[];
}

const LIMITS = { collected: 64, planted: 120, npcCalls: 256, cameraTraps: 64 };
const RESPONDERS = new Set<string>(Object.values(RESPONDER));

export class SaveDeltaError extends Error {}

/** A fresh delta for the first dawn of a world. */
export function newSaveDelta(world: SurvivalWorld, mode: GameMode): SurvivalSaveDelta {
	return {
		format: SAVE_FORMAT,
		generatorVersion: world.generatorVersion,
		seed: world.seed,
		checksum: world.checksum,
		mode,
		day: 1,
		forestHealth: 50,
		collected: [],
		planted: [],
		npcCalls: [],
		cameraTraps: []
	};
}

export function encodeSaveDelta(delta: SurvivalSaveDelta): string {
	return JSON.stringify(decodeSaveDelta(delta));
}

/** Validates a delta read from disk (JSON text or a parsed value) and returns a clean copy. */
export function decodeSaveDelta(input: unknown): SurvivalSaveDelta {
	const value = typeof input === 'string' ? parse(input) : input;
	const v = record(value, 'save');
	if (v.format !== SAVE_FORMAT) throw new SaveDeltaError(`unknown save format ${String(v.format)}`);
	if (v.mode !== 'explorer' && v.mode !== 'guardian') throw new SaveDeltaError('bad mode');
	const day = int(v.day, 'day', 1, MAX_DAYS);
	const dayOf = (item: Record<string, unknown>) => int(item.day, 'day', 1, MAX_DAYS);
	const delta: SurvivalSaveDelta = {
		format: SAVE_FORMAT,
		generatorVersion: int(v.generatorVersion, 'generatorVersion', 1, 0xffff),
		seed: int(v.seed, 'seed', 0, 0xffffffff),
		checksum: int(v.checksum, 'checksum', 0, 0xffffffff),
		mode: v.mode,
		day,
		forestHealth: number(v.forestHealth, 'forestHealth', 0, 100),
		collected: list(v.collected, 'collected', LIMITS.collected, (item) => int(item, 'collected', 0, 0xffff)),
		planted: list(v.planted, 'planted', LIMITS.planted, (item) => {
			const p = record(item, 'planted');
			if (typeof p.species !== 'string' || !(p.species in SEEDLINGS)) throw new SaveDeltaError('bad species');
			return {
				cell: int(p.cell, 'cell', 0, PLANT_GRID * PLANT_GRID - 1),
				species: p.species as Seedling,
				day: dayOf(p)
			};
		}),
		npcCalls: list(v.npcCalls, 'npcCalls', LIMITS.npcCalls, (item) => {
			const c = record(item, 'npcCall');
			if (typeof c.responder !== 'string' || !RESPONDERS.has(c.responder))
				throw new SaveDeltaError('bad responder');
			return {
				threat: int(c.threat, 'threat', 0, 0xffff),
				responder: c.responder as Responder,
				day: dayOf(c)
			};
		}),
		cameraTraps: list(v.cameraTraps, 'cameraTraps', LIMITS.cameraTraps, (item) => {
			const t = record(item, 'cameraTrap');
			return { spot: int(t.spot, 'spot', 0, 0xffff), day: dayOf(t) };
		})
	};
	unique(delta.collected, 'collected');
	unique(
		delta.planted.map((p) => p.cell),
		'planted cell'
	);
	for (const entry of [...delta.planted, ...delta.npcCalls, ...delta.cameraTraps])
		if (entry.day > day) throw new SaveDeltaError('entry from a future day');
	return delta;
}

/**
 * Problems applying a delta to a regenerated world: a different generator or
 * map, or ids the world does not have. Empty when the delta fits.
 */
export function deltaProblems(delta: SurvivalSaveDelta, world: SurvivalWorld): string[] {
	const problems: string[] = [];
	if (delta.generatorVersion !== world.generatorVersion) problems.push('generator version changed');
	if (delta.seed !== world.seed) problems.push('another seed');
	if (delta.checksum !== world.checksum) problems.push('world checksum differs');
	const cells = new Set(world.corridor.cells.map((c) => c.cell));
	if (delta.collected.some((id) => id >= world.resources.length)) problems.push('unknown resource');
	if (delta.planted.some((p) => !cells.has(p.cell))) problems.push('not a planting cell');
	for (const call of delta.npcCalls) {
		const slot = world.threats[call.threat];
		if (!slot || slot.responder !== call.responder) problems.push('unknown threat or responder');
	}
	if (delta.cameraTraps.some((t) => t.spot >= world.cameraSpots.length)) problems.push('unknown camera spot');
	return problems;
}

function parse(text: string): unknown {
	try {
		return JSON.parse(text);
	} catch {
		throw new SaveDeltaError('not JSON');
	}
}

function record(value: unknown, what: string): Record<string, unknown> {
	if (value === null || typeof value !== 'object' || Array.isArray(value))
		throw new SaveDeltaError(`${what}: not an object`);
	return value as Record<string, unknown>;
}

function number(value: unknown, what: string, min: number, max: number): number {
	if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max)
		throw new SaveDeltaError(`${what}: out of range`);
	return value;
}

function int(value: unknown, what: string, min: number, max: number): number {
	const n = number(value, what, min, max);
	if (!Number.isInteger(n)) throw new SaveDeltaError(`${what}: not an integer`);
	return n;
}

function list<T>(value: unknown, what: string, max: number, item: (value: unknown) => T): T[] {
	if (!Array.isArray(value) || value.length > max) throw new SaveDeltaError(`${what}: not a list`);
	return value.map(item);
}

function unique(values: number[], what: string) {
	if (new Set(values).size !== values.length) throw new SaveDeltaError(`duplicate ${what}`);
}
