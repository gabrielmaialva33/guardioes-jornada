import { flushSync, mount, unmount } from 'svelte';
import { WebGLRenderer } from 'three';
import { GAME_ABI, type GameBridge, type GameDispose } from '../abi.ts';
import Root from './Root.svelte';

declare const __PACK_BUILD__: string;
export const abi = GAME_ABI;
export const buildTag = __PACK_BUILD__;

/** Each call owns its runtime root, renderer and listeners; disposal is awaitable and idempotent. */
export function mountGame(element: HTMLElement, bridge: GameBridge): GameDispose {
	if (bridge.abi !== GAME_ABI) throw new Error('game-abi-mismatch');
	const target = document.createElement('div');
	element.append(target);
	const listeners = new AbortController();
	let renderer: WebGLRenderer | undefined;
	let destroyRenderer: (() => void) | undefined;
	let app: ReturnType<typeof mount> | undefined;
	let disposed: Promise<void> | undefined;
	const createRenderer = (canvas: HTMLCanvasElement) => {
		let value: WebGLRenderer;
		try {
			value = new WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'low-power' });
		} catch (cause) {
			throw new Error('game-webgl-unavailable', { cause });
		}
		renderer = value;
		const setLoop = value.setAnimationLoop.bind(value);
		let loop: Parameters<typeof setLoop>[0] = null;
		value.setAnimationLoop = (callback) => {
			loop = callback;
			setLoop(document.hidden ? null : callback);
		};
		document.addEventListener('visibilitychange', () => setLoop(document.hidden ? null : loop), {
			signal: listeners.signal
		});
		window.addEventListener('pagehide', () => setLoop(null), { signal: listeners.signal });
		window.addEventListener('pageshow', () => setLoop(document.hidden ? null : loop), {
			signal: listeners.signal
		});
		destroyRenderer = () => {
			setLoop(null);
			value.dispose();
			value.forceContextLoss();
		};
		return value;
	};
	try {
		app = mount(Root, { target, props: { bridge, createRenderer } });
		flushSync();
	} catch (error) {
		listeners.abort();
		if (app) void unmount(app);
		destroyRenderer?.();
		target.remove();
		throw error;
	}
	return () => {
		if (!disposed)
			disposed = (async () => {
				listeners.abort();
				if (document.pointerLockElement && target.contains(document.pointerLockElement))
					document.exitPointerLock();
				renderer?.setAnimationLoop(null);
				try {
					if (app) await unmount(app);
				} finally {
					destroyRenderer?.();
					target.remove();
				}
			})();
		return disposed;
	};
}
