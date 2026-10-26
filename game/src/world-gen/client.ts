/**
 * The page's side: requests chunks from the world-gen Worker, cancels them,
 * steers their order by distance to the player, and keeps finished chunks in
 * an LRU capped by bytes (f-mundo-infinito.md §3.13: 8–16 MB of CPU data).
 * No runtime wiring here (F1): the streamer decides what to ask for and when.
 */
import type { WorldChunk } from './chunk.ts';
import { WORLD_SEED } from './constants.ts';
import { chunkBytes, chunkDistance2, chunkKey, type WorkerRequest, type WorkerResponse } from './protocol.ts';

/** What the client needs from a Worker (a fake in the tests). */
export interface WorkerPort {
	postMessage(message: WorkerRequest): void;
	onmessage: ((event: { data: WorkerResponse }) => void) | null;
	terminate?(): void;
}

/** The module Worker; Vite emits worker.ts as its own file. */
export function createWorldGenWorker(): Worker {
	return new Worker(new URL('./worker.ts', import.meta.url), { type: 'module', name: 'world-gen' });
}

/** A request given up before its chunk arrived (cancelled, dropped by focus, or the client disposed). */
export class ChunkCancelled extends Error {
	readonly key: string;

	constructor(key: string) {
		super(`chunk ${key} cancelled`);
		this.name = 'ChunkCancelled';
		this.key = key;
	}
}

/** Least-recently-used chunks within a byte cap; the newest entry always stays. */
export class ChunkCache {
	readonly byteCap: number;
	onEvict: ((chunk: WorldChunk) => void) | null = null;
	readonly #entries = new Map<string, { chunk: WorldChunk; bytes: number }>();
	#bytes = 0;
	#evicted = 0;

	constructor(byteCap: number) {
		this.byteCap = byteCap;
	}

	get bytes() {
		return this.#bytes;
	}

	get size() {
		return this.#entries.size;
	}

	get evicted() {
		return this.#evicted;
	}

	/** Without touching its recency. */
	peek(key: string): WorldChunk | undefined {
		return this.#entries.get(key)?.chunk;
	}

	/** Marks it most recently used. */
	get(key: string): WorldChunk | undefined {
		const entry = this.#entries.get(key);
		if (!entry) return undefined;
		this.#entries.delete(key);
		this.#entries.set(key, entry);
		return entry.chunk;
	}

	set(key: string, chunk: WorldChunk) {
		this.delete(key);
		const bytes = chunkBytes(chunk);
		this.#entries.set(key, { chunk, bytes });
		this.#bytes += bytes;
		for (const [oldest, entry] of this.#entries) {
			if (this.#bytes <= this.byteCap || oldest === key) break;
			this.#entries.delete(oldest);
			this.#bytes -= entry.bytes;
			this.#evicted++;
			this.onEvict?.(entry.chunk);
		}
	}

	delete(key: string): boolean {
		const entry = this.#entries.get(key);
		if (!entry) return false;
		this.#entries.delete(key);
		this.#bytes -= entry.bytes;
		return true;
	}

	/** Keys from least to most recently used. */
	keys(): string[] {
		return [...this.#entries.keys()];
	}

	clear() {
		this.#entries.clear();
		this.#bytes = 0;
	}
}

export interface ClientOptions {
	seed?: number;
	/** Cache cap in bytes (default 16 MiB, ~450 chunks). */
	byteCap?: number;
}

export interface ClientStats {
	requested: number;
	completed: number;
	cancelled: number;
	errors: number;
	/** Worker ms of the last chunk, and the worst so far. */
	lastMs: number;
	maxMs: number;
	/** Jobs still queued in the Worker when the last chunk left it. */
	queued: number;
}

interface Pending {
	cx: number;
	cz: number;
	promise: Promise<WorldChunk>;
	resolve(chunk: WorldChunk): void;
	reject(error: Error): void;
}

export class WorldGenClient {
	readonly seed: number;
	readonly cache: ChunkCache;
	readonly stats: ClientStats = {
		requested: 0,
		completed: 0,
		cancelled: 0,
		errors: 0,
		lastMs: 0,
		maxMs: 0,
		queued: 0
	};
	readonly #port: WorkerPort;
	readonly #pending = new Map<string, Pending>();

	constructor(port: WorkerPort, options: ClientOptions = {}) {
		this.seed = options.seed ?? WORLD_SEED;
		this.cache = new ChunkCache(options.byteCap ?? 16 * 1024 * 1024);
		this.#port = port;
		port.onmessage = (event) => this.#receive(event.data);
	}

	/** Requests in flight. */
	get pending(): number {
		return this.#pending.size;
	}

	/**
	 * The chunk at (cx, cz): from the cache, or from the Worker. Without
	 * `priority` the Worker orders it by distance to the last focus; a lower
	 * priority runs earlier. Asking again for a pending chunk updates its
	 * priority and returns the same promise.
	 */
	request(cx: number, cz: number, priority?: number): Promise<WorldChunk> {
		const key = chunkKey(cx, cz);
		const cached = this.cache.get(key);
		if (cached) return Promise.resolve(cached);
		let pending = this.#pending.get(key);
		if (!pending) {
			let resolve!: (chunk: WorldChunk) => void;
			let reject!: (error: Error) => void;
			const promise = new Promise<WorldChunk>((yes, no) => {
				resolve = yes;
				reject = no;
			});
			pending = { cx, cz, promise, resolve, reject };
			this.#pending.set(key, pending);
			this.stats.requested++;
		}
		this.#port.postMessage({ type: 'want', key, cx, cz, seed: this.seed, priority });
		return pending.promise;
	}

	/** Gives up a pending request; true when there was one. */
	cancel(cx: number, cz: number): boolean {
		const key = chunkKey(cx, cz);
		if (!this.#settle(key)) return false;
		this.#port.postMessage({ type: 'cancel', keys: [key] });
		return true;
	}

	/**
	 * The player's position: the Worker runs the nearest jobs first. With
	 * `keepRadius` (u), pending requests whose chunk centre is farther are
	 * cancelled here and dropped there.
	 */
	focus(x: number, z: number, keepRadius?: number) {
		if (keepRadius !== undefined)
			for (const [key, p] of this.#pending)
				if (chunkDistance2(p.cx, p.cz, x, z) > keepRadius * keepRadius) this.#settle(key);
		this.#port.postMessage({ type: 'focus', x, z, dropBeyond: keepRadius });
	}

	/** A finished chunk, marked as recently used. */
	get(cx: number, cz: number): WorldChunk | undefined {
		return this.cache.get(chunkKey(cx, cz));
	}

	/** Rejects everything pending and stops the Worker. */
	dispose() {
		for (const key of [...this.#pending.keys()]) this.#settle(key);
		this.#port.onmessage = null;
		this.#port.terminate?.();
	}

	#settle(key: string): boolean {
		const pending = this.#pending.get(key);
		if (!pending) return false;
		this.#pending.delete(key);
		this.stats.cancelled++;
		pending.reject(new ChunkCancelled(key));
		return true;
	}

	#receive(message: WorkerResponse) {
		switch (message.type) {
			case 'chunk': {
				this.stats.completed++;
				this.stats.lastMs = message.ms;
				this.stats.maxMs = Math.max(this.stats.maxMs, message.ms);
				this.stats.queued = message.queued;
				// A chunk that outran its cancel is still good data: keep it.
				this.cache.set(message.key, message.chunk);
				const pending = this.#pending.get(message.key);
				if (pending) {
					this.#pending.delete(message.key);
					pending.resolve(message.chunk);
				}
				break;
			}
			case 'dropped':
				for (const key of message.keys) this.#settle(key);
				break;
			case 'error': {
				this.stats.errors++;
				const pending = this.#pending.get(message.key);
				if (pending) {
					this.#pending.delete(message.key);
					pending.reject(new Error(message.message));
				}
				break;
			}
		}
	}
}
