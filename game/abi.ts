/** This plain-data ABI belongs to the launcher, not either Svelte runtime. */
import type { GAME_ABI } from './protocol.ts';

export * from './protocol.ts';
export interface GameBridge {
	abi: typeof GAME_ABI;
	exit(): void;
	earnBadge(): void;
}
export type GameDispose = () => void | Promise<void>;
export interface GameModule {
	abi: number;
	mountGame(element: HTMLElement, bridge: GameBridge): GameDispose;
}
