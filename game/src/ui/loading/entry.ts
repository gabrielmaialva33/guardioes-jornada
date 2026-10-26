/**
 * The pack's entry (P11). It holds only the loading screen, so the screen paints as
 * soon as this small module runs, before three.js and the game are parsed; the game
 * is a separate chunk imported right after and mounts under the screen, which fades
 * once the world is drawn. The ABI is unchanged: `mountGame` still returns a
 * dispose function synchronously.
 *
 * A failure after this point (the game chunk, a world asset, or a device that cannot
 * draw 3D) can no longer be thrown to the launcher, so the screen shows it, with
 * "Tentar de novo" (remounts the game) or "Voltar" (`bridge.exit`).
 */
import { flushSync, mount, unmount } from 'svelte';
import { GAME_ABI, type GameBridge, type GameDispose } from '../../../abi.ts';
import { golden } from '../../scene/golden.ts';
import { FACTS } from './facts.ts';
import LoadingScreen from './LoadingScreen.svelte';
import { LoadingProgress } from './loading.ts';

declare const __PACK_BUILD__: string;
export const abi = GAME_ABI;
export const buildTag = __PACK_BUILD__;

/** main.ts's `mountGame`; the third argument is optional so either version fits. */
type GameMount = (
	element: HTMLElement,
	bridge: GameBridge,
	options?: { loading?: LoadingProgress }
) => GameDispose;

export function mountGame(element: HTMLElement, bridge: GameBridge): GameDispose {
	if (bridge.abi !== GAME_ABI) throw new Error('game-abi-mismatch');
	const loading = new LoadingProgress();
	const host = document.createElement('div');
	element.append(host);
	// Goldens capture the world as it is: no screen over it.
	const showsScreen = !golden.enabled;
	let screen: ReturnType<typeof mount> | undefined;
	const removeScreen = () => {
		if (screen) void unmount(screen);
		screen = undefined;
		host.remove();
	};
	let game: GameDispose | undefined;
	let attempt = 0;
	let disposed: Promise<void> | undefined;
	const start = () => {
		const current = ++attempt;
		loading.track('code', import('../../main.ts')).then(
			(module) => {
				if (disposed || current !== attempt) return;
				const mountWorld: GameMount = module.mountGame;
				try {
					game = mountWorld(element, bridge, { loading });
				} catch (error) {
					loading.fail(error);
					if (!showsScreen) throw error;
					return;
				}
				// A game that does not report its tasks (main.ts without `reportsLoading`) is shown once mounted.
				if (!('reportsLoading' in module && module.reportsLoading === true)) loading.ready();
			},
			(error: unknown) => {
				if (!showsScreen) throw error;
			}
		);
	};
	loading.onretry = () => {
		const previous = game;
		game = undefined;
		void Promise.resolve(previous?.()).then(() => {
			if (!disposed) start();
		});
	};
	// The game chunk starts downloading first; the screen paints while it parses.
	start();
	if (showsScreen) {
		screen = mount(LoadingScreen, {
			target: host,
			props: {
				model: loading,
				firstFact: Math.floor(Math.random() * FACTS.length),
				onexit: () => bridge.exit(),
				ondone: removeScreen
			}
		});
		flushSync();
	}
	return () => {
		if (!disposed)
			disposed = (async () => {
				attempt++;
				try {
					await game?.();
				} finally {
					removeScreen();
				}
			})();
		return disposed;
	};
}
