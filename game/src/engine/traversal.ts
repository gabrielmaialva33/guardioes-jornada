import type { Character } from './character.ts';
import type { InputFrame } from './input.ts';
/** Optional fixed-step driver. Engine stays independent of park/map data. */
export interface TraversalDriver {
	readonly mode: string;
	readonly cameraLift: number;
	readonly cameraBehind: number | null;
	capture(input: InputFrame): void;
	/** Return true only when this tick's character movement has already been handled. */
	step(dt: number, character: Character): boolean;
	reset(): void;
}
