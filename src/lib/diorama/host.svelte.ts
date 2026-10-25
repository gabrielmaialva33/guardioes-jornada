/**
 * One WebGL context per page. Every mounted <Diorama> joins a stack; only
 * the newest one shows 3D (e.g. the gains sheet over the journey map) and
 * the others show their SVG. The engine's single canvas moves between
 * them, so the context and compiled shaders are reused and growth that
 * started in one place keeps going in the other.
 *
 * The engine is created lazily (separate chunk) and disposed shortly after
 * the last diorama unmounts.
 */
import type { Engine, FailReason } from './scene/createDiorama.ts';
import { demote, pickTier, remember, type Tier } from './tier.ts';

export interface Seen {
	stage: number;
	oath: boolean;
}

class DioramaHost {
	tier = $state<Tier>('svg');
	owners = $state<number[]>([]);
	/** Bumped whenever the engine is replaced, so dioramas re-attach. */
	generation = $state(0);
	/** What the class last saw: a newly mounted diorama grows from here. */
	seen: Seen | null = null;

	get active() {
		return this.owners.at(-1) ?? 0;
	}
}

export const host = new DioramaHost();

let decided = false;
let nextId = 1;
let engine: Promise<Engine> | null = null;
let engineAbort: AbortController | undefined;
let gameFinished: Promise<void> = Promise.resolve();
let releaseGame: (() => void) | undefined;
let disposeTimer: ReturnType<typeof setTimeout> | undefined;
/** Recent context losses; two within a few minutes means memory pressure. */
let losses: number[] = [];
const LOSS_WINDOW_MS = 3 * 60 * 1000;

/** Registers a diorama; the newest one gets the 3D canvas. */
export function join(): number {
	if (!decided) {
		decided = true;
		host.tier = pickTier();
	}
	clearTimeout(disposeTimer);
	const id = nextId++;
	host.owners = [...host.owners, id];
	return id;
}

export function leave(id: number) {
	host.owners = host.owners.filter((o) => o !== id);
	if (host.owners.length === 0) {
		clearTimeout(disposeTimer);
		// A short grace period lets a page navigation reuse the context.
		disposeTimer = setTimeout(drop, 1500);
	}
}

function whenVisible(signal: AbortSignal): Promise<void> {
	if (signal.aborted) return Promise.reject(new Error('diorama-cancelled'));
	if (!document.hidden) return Promise.resolve();
	return new Promise((resolve, reject) => {
		const cleanup = () => {
			document.removeEventListener('visibilitychange', on);
			signal.removeEventListener('abort', cancel);
		};
		const cancel = () => {
			cleanup();
			reject(new Error('diorama-cancelled'));
		};
		const on = () => {
			if (document.hidden) return;
			cleanup();
			resolve();
		};
		document.addEventListener('visibilitychange', on);
		signal.addEventListener('abort', cancel, { once: true });
	});
}

function whenGameFinished(signal: AbortSignal): Promise<void> {
	if (signal.aborted) return Promise.reject(new Error('diorama-cancelled'));
	return new Promise((resolve, reject) => {
		const cancel = () => {
			signal.removeEventListener('abort', cancel);
			reject(new Error('diorama-cancelled'));
		};
		signal.addEventListener('abort', cancel, { once: true });
		void gameFinished.then(() => {
			signal.removeEventListener('abort', cancel);
			resolve();
		});
	});
}

export function getEngine(): Promise<Engine> {
	if (host.tier === 'svg') return Promise.reject(new Error('3D is off on this device'));
	if (!engine) {
		engineAbort = new AbortController();
		const signal = engineAbort.signal;
		const quality = host.tier === 'full' ? 'full' : 'lite';
		const created = whenVisible(signal).then(async () => {
			if (engine !== created || signal.aborted) throw new Error('diorama-cancelled');
			await whenGameFinished(signal);
			if (engine !== created || host.owners.length === 0) throw new Error('The scene is no longer visible');
			const m = await import('./scene/createDiorama.ts');
			if (engine !== created) throw new Error('diorama-cancelled');
			await whenVisible(signal);
			await whenGameFinished(signal);
			if (engine !== created || host.owners.length === 0) throw new Error('The scene is no longer visible');
			return m.createEngine({ tier: quality, onFail: fail });
		});
		engine = created;
		created.catch(() => {
			if (engine === created) {
				engine = null;
				if (host.owners.length) host.tier = 'svg';
			}
		});
	}
	return engine;
}

/** Hand the GPU to an independent renderer, including any in-flight diorama build. */
export async function acquireGameGpu(): Promise<() => void> {
	while (releaseGame) await gameFinished;
	let resolveGame: () => void = () => undefined;
	gameFinished = new Promise((resolve) => {
		resolveGame = resolve;
	});
	releaseGame = resolveGame;
	clearTimeout(disposeTimer);
	const previous = engine;
	engine = null;
	engineAbort?.abort();
	try {
		await previous?.then(
			(value) => value.dispose(),
			() => {}
		);
	} catch (error) {
		resolveGame();
		releaseGame = undefined;
		throw error;
	}
	let released = false;
	return () => {
		if (released) return;
		released = true;
		resolveGame();
		releaseGame = undefined;
	};
}

function drop() {
	const e = engine;
	engine = null;
	engineAbort?.abort();
	e?.then(
		(x) => x.dispose(),
		() => {}
	);
}

function fail(reason: FailReason) {
	console.info(`[diorama] 3D ${reason === 'slow' ? 'too slow' : 'context lost'}, falling back`);
	drop();
	if (reason === 'slow') {
		host.tier = demote(host.tier);
		remember(host.tier);
	} else {
		const now = Date.now();
		losses = [...losses.filter((t) => now - t < LOSS_WINDOW_MS), now];
		// The GPU keeps dropping us (memory pressure): stay on SVG this session.
		if (losses.length >= 2) host.tier = 'svg';
	}
	host.generation++;
}
