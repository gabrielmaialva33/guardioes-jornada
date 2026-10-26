/**
 * Thumbnail scheduling for the editor's grids, without any GPU code:
 *
 * - ThumbnailCache: images by option key (thumbnailKey in editor.ts), least
 *   recently used dropped past `maxEntries`, released through a callback. One
 *   lives for the whole game session (see stage.ts), so reopening the editor
 *   shows the thumbnails it already made.
 * - ThumbnailQueue: the keys the visible tab still lacks, in display order, run
 *   a few per animation frame within a time budget. Asking for another tab
 *   replaces the pending list, so only what is on screen is ever rendered.
 *
 * Budget: a frame stops before a job whose estimated cost would overrun it, but
 * always runs one when it has nothing left over from earlier frames; a job
 * that overruns leaves a debt the following frames pay back by doing nothing,
 * so on average the work stays within the budget even on a phone where one
 * thumbnail costs more than a frame's share.
 */

export interface ThumbnailCacheOptions<T> {
	maxEntries?: number;
	/** Frees an evicted or cleared image (canvas.width = 0, bitmap.close()). */
	release?: (value: T) => void;
}

export class ThumbnailCache<T> {
	readonly maxEntries: number;
	readonly #release: ((value: T) => void) | undefined;
	/** Insertion order is recency: get() and touch() move a key to the end. */
	readonly #entries = new Map<string, T>();

	constructor(options: ThumbnailCacheOptions<T> = {}) {
		this.maxEntries = Math.max(1, options.maxEntries ?? 72);
		this.#release = options.release;
	}

	get size(): number {
		return this.#entries.size;
	}

	has(key: string): boolean {
		return this.#entries.has(key);
	}

	/** Reads without changing the eviction order (painting a tile). */
	peek(key: string): T | undefined {
		return this.#entries.get(key);
	}

	/** Marks a key as recently used. */
	touch(key: string) {
		const value = this.#entries.get(key);
		if (value === undefined) return;
		this.#entries.delete(key);
		this.#entries.set(key, value);
	}

	set(key: string, value: T) {
		const old = this.#entries.get(key);
		if (old !== undefined) {
			this.#entries.delete(key);
			if (old !== value) this.#release?.(old);
		}
		this.#entries.set(key, value);
		while (this.#entries.size > this.maxEntries) {
			const oldest = this.#entries.keys().next().value;
			if (oldest === undefined) break;
			const evicted = this.#entries.get(oldest);
			this.#entries.delete(oldest);
			if (evicted !== undefined) this.#release?.(evicted);
		}
	}

	clear() {
		for (const value of this.#entries.values()) this.#release?.(value);
		this.#entries.clear();
	}
}

/**
 * Renders one key. Returns the image when done, `null` while it is still being
 * prepared (an async skin change: ask again next frame), or `undefined` when
 * the key cannot be rendered (it is skipped until the queue is rebuilt).
 */
export type ThumbnailWork<T> = (key: string) => T | null | undefined;

export interface ThumbnailQueueOptions<T> {
	cache: ThumbnailCache<T>;
	/** Milliseconds of thumbnail work per frame. */
	budgetMs?: number;
	now?: () => number;
	/** A thumbnail was stored (repaint its tile). */
	onready?: (key: string) => void;
}

export interface ThumbnailStats {
	/** Thumbnails rendered by this queue. */
	count: number;
	/** Synchronous cost per thumbnail (render, read back, copy), ms. */
	meanMs: number;
	maxMs: number;
	/** Frames that ran at least one job, and the longest such frame, ms. */
	frames: number;
	maxFrameMs: number;
}

export class ThumbnailQueue<T> {
	readonly cache: ThumbnailCache<T>;
	readonly budgetMs: number;
	readonly #now: () => number;
	readonly #onready: ((key: string) => void) | undefined;
	#pending: string[] = [];
	readonly #failed = new Set<string>();
	/** Moving estimate of one job's cost, ms (0: nothing measured yet). */
	#estimate = 0;
	#debt = 0;
	#count = 0;
	#total = 0;
	#max = 0;
	#frames = 0;
	#maxFrame = 0;

	constructor(options: ThumbnailQueueOptions<T>) {
		this.cache = options.cache;
		this.budgetMs = Math.max(0.5, options.budgetMs ?? 4);
		this.#now = options.now ?? (() => performance.now());
		this.#onready = options.onready;
	}

	/** Keys still to render. */
	get pending(): number {
		return this.#pending.length;
	}

	/** The cost estimate the next frame plans with, ms. */
	get estimateMs(): number {
		return this.#estimate;
	}

	/**
	 * The visible tab's keys, in display order. Replaces whatever was pending;
	 * keys already cached are touched, so the visible tab is evicted last.
	 */
	request(keys: readonly string[]) {
		const seen = new Set<string>();
		const pending: string[] = [];
		for (const key of keys) {
			if (seen.has(key)) continue;
			seen.add(key);
			if (this.cache.has(key)) this.cache.touch(key);
			else if (!this.#failed.has(key)) pending.push(key);
		}
		this.#pending = pending;
	}

	/** Forgets failures and pending work (context restored, skins reachable again). */
	reset() {
		this.#pending = [];
		this.#failed.clear();
		this.#debt = 0;
	}

	/** Runs this frame's share of the work; returns how many thumbnails were stored. */
	pump(work: ThumbnailWork<T>, budgetMs = this.budgetMs): number {
		if (this.#pending.length === 0) return 0;
		if (this.#debt > 0) {
			this.#debt = Math.max(0, this.#debt - budgetMs);
			return 0;
		}
		const start = this.#now();
		let done = 0;
		while (this.#pending.length > 0) {
			const elapsed = this.#now() - start;
			if (done > 0 && elapsed + this.#estimate > budgetMs) break;
			const key = this.#pending[0];
			if (this.cache.has(key) || this.#failed.has(key)) {
				this.#pending.shift();
				continue;
			}
			const before = this.#now();
			const value = work(key);
			if (value === null) break;
			const cost = this.#now() - before;
			this.#pending.shift();
			if (value === undefined) {
				this.#failed.add(key);
				continue;
			}
			this.#estimate = this.#estimate === 0 ? cost : this.#estimate * 0.7 + cost * 0.3;
			this.cache.set(key, value);
			done++;
			this.#count++;
			this.#total += cost;
			this.#max = Math.max(this.#max, cost);
			this.#onready?.(key);
		}
		const spent = this.#now() - start;
		if (done > 0) {
			this.#frames++;
			this.#maxFrame = Math.max(this.#maxFrame, spent);
		}
		if (spent > budgetMs) this.#debt += spent - budgetMs;
		return done;
	}

	stats(): ThumbnailStats {
		return {
			count: this.#count,
			meanMs: this.#count > 0 ? this.#total / this.#count : 0,
			maxMs: this.#max,
			frames: this.#frames,
			maxFrameMs: this.#maxFrame
		};
	}
}

/**
 * Copies a WebGL read-back (rows bottom-up, RGBA) into a top-down image, and
 * un-premultiplies the antialiased edges a transparent clear leaves (an edge
 * pixel half over the clear reads as half its colour at half alpha).
 */
export function readbackToImage(
	source: ArrayLike<number>,
	target: Uint8ClampedArray,
	width: number,
	height: number
) {
	const row = width * 4;
	for (let y = 0; y < height; y++) {
		const from = (height - 1 - y) * row;
		const to = y * row;
		for (let i = 0; i < row; i += 4) {
			const a = source[from + i + 3];
			if (a === 0) {
				target[to + i] = target[to + i + 1] = target[to + i + 2] = target[to + i + 3] = 0;
				continue;
			}
			const scale = a === 255 ? 1 : 255 / a;
			target[to + i] = source[from + i] * scale;
			target[to + i + 1] = source[from + i + 1] * scale;
			target[to + i + 2] = source[from + i + 2] * scale;
			target[to + i + 3] = a;
		}
	}
}
