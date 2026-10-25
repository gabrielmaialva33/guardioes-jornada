/**
 * Public surface of the survival map generator ("5 Dias de Guardião"): pure
 * TypeScript, no three.js, DOM or Svelte, safe to run in a Worker and to
 * transfer (typed arrays) to the page.
 */
export { checksumOf } from './checksum.ts';
export { generateWorld } from './generate.ts';
export { BRASILIA_UTC_OFFSET_MINUTES, dayKey, seedOfTheDay } from './random.ts';
export {
	type CameraTrap,
	decodeSaveDelta,
	deltaProblems,
	encodeSaveDelta,
	type GameMode,
	MAX_DAYS,
	type NpcCall,
	newSaveDelta,
	type PlantedCell,
	SAVE_FORMAT,
	SaveDeltaError,
	type SurvivalSaveDelta
} from './save.ts';
export { heightAt } from './terrain.ts';
export * from './types.ts';
