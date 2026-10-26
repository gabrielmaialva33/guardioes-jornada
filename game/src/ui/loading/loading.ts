/**
 * Progress model of the loading screen (P11). Pure: no DOM, the clock is injected.
 *
 * Each real task is tracked with a weight; the shown fraction follows the finished
 * weight (plus a slow creep for tasks still running) through a critically damped
 * spring. It never goes backwards and stays below `ceiling` until `ready()`, so the
 * bar is never full while the world is still missing. Once ready it finishes, waits
 * out `minVisibleMs` so a fast load never flashes, then fades for `fadeMs`.
 */

/** Display order: the label is the first unfinished stage in this list. */
export const STAGES = [
	{ id: 'code', label: 'Abrindo a trilha' },
	{ id: 'placements', label: 'Plantando as árvores' },
	{ id: 'life', label: 'Acordando os bichos' },
	{ id: 'sound', label: 'Afinando os sons da mata' },
	{ id: 'avatar', label: 'Arrumando a mochila' },
	{ id: 'story', label: 'Chamando a Iara' },
	{ id: 'compile', label: 'Preparando as cores' }
] as const;
export type StageId = (typeof STAGES)[number]['id'];

export const LOADING = {
	/** The screen stays at least this long after it first appears. */
	minVisibleMs: 700,
	fadeMs: 400,
	/** Highest fraction shown before `ready()`. */
	ceiling: 0.95,
	/** Spring stiffness (rad/s) while loading and once ready. */
	omega: 5,
	finishOmega: 14,
	/** Share of a running task's weight credited over time, and its time constant. */
	creepShare: 0.6,
	creepMs: 3000,
	/** Before any task is known the bar still creeps up to this. */
	idleShare: 0.08,
	idleLabel: 'Abrindo a clareira',
	readyLabel: 'Tudo pronto!'
} as const;

export type LoadingPhase = 'loading' | 'error' | 'leaving' | 'done';
/** `unsupported`: this device cannot draw the 3D world; `failed`: anything else. */
export type LoadingErrorKind = 'unsupported' | 'failed';

export interface LoadingSnapshot {
	phase: LoadingPhase;
	/** Shown fraction, 0..1, monotone. */
	fraction: number;
	/** Rounded percentage for aria-valuenow. */
	percent: number;
	label: string;
	error: LoadingErrorKind | null;
	/** Milliseconds since the screen appeared. */
	elapsed: number;
}

interface Task {
	weight: number;
	/** Clock time the task started running, null while only reserved. */
	startedAt: number | null;
	done: boolean;
}

export interface LoadingOptions {
	clock?: () => number;
}

export class LoadingProgress {
	readonly #clock: () => number;
	readonly #tasks = new Map<StageId, Task>();
	readonly #shownAt: number;
	#last: number;
	#fraction = 0;
	#velocity = 0;
	#target = 0;
	#ready = false;
	#phase: LoadingPhase = 'loading';
	#error: LoadingErrorKind | null = null;
	#leavingAt = 0;
	/** Called by `retry()`; the owner restarts the work and tracks it again. */
	onretry: (() => void) | undefined;

	constructor({ clock = () => performance.now() }: LoadingOptions = {}) {
		this.#clock = clock;
		this.#shownAt = this.#last = clock();
	}

	get phase() {
		return this.#phase;
	}

	/** Whether any task besides the pack's own code was registered. */
	get tracksWorld() {
		for (const id of this.#tasks.keys()) if (id !== 'code') return true;
		return false;
	}

	/** Registers a task whose promise does not exist yet (e.g. the shader compile step). */
	reserve(id: StageId, weight = 1) {
		if (!this.#tasks.has(id)) this.#tasks.set(id, { weight: positive(weight), startedAt: null, done: false });
	}

	/**
	 * Tracks a task and returns it unchanged. `undefined` (an optional loader that is
	 * absent) counts as done. A rejection other than an abort switches to the error
	 * state; an abort is the owner tearing down and is ignored.
	 */
	track<T extends PromiseLike<unknown> | null | undefined>(id: StageId, task: T, weight?: number): T {
		const existing = this.#tasks.get(id);
		const entry: Task = {
			weight: weight === undefined ? (existing?.weight ?? 1) : positive(weight),
			startedAt: this.#clock(),
			done: task == null
		};
		this.#tasks.set(id, entry);
		task?.then(
			() => {
				entry.done = true;
			},
			(error: unknown) => {
				if (this.#tasks.get(id) !== entry || isAbort(error)) return;
				this.fail(error);
			}
		);
		return task;
	}

	/** Everything is drawn: finish the bar, then leave after the minimum display time. */
	ready() {
		if (this.#phase !== 'loading') return;
		this.#ready = true;
		for (const task of this.#tasks.values()) task.done = true;
	}

	fail(error?: unknown) {
		if (this.#phase === 'leaving' || this.#phase === 'done') return;
		this.#phase = 'error';
		this.#error = errorKind(error);
	}

	/** From the error state: forget the tasks (the bar keeps its place) and ask the owner to restart. */
	retry() {
		if (this.#phase !== 'error' || this.#error === 'unsupported') return;
		this.#tasks.clear();
		this.#ready = false;
		this.#error = null;
		this.#phase = 'loading';
		this.#velocity = 0;
		this.onretry?.();
	}

	/** Advances the spring to the clock's time and returns what to draw. */
	update(): LoadingSnapshot {
		const now = this.#clock();
		const dt = Math.max(0, now - this.#last) / 1000;
		this.#last = now;
		if (this.#phase === 'loading' || this.#phase === 'error') this.#advance(now, dt);
		if (this.#phase === 'loading' && this.#fraction === 1 && now - this.#shownAt >= LOADING.minVisibleMs) {
			this.#phase = 'leaving';
			this.#leavingAt = now;
		}
		if (this.#phase === 'leaving' && now - this.#leavingAt >= LOADING.fadeMs) this.#phase = 'done';
		return {
			phase: this.#phase,
			fraction: this.#fraction,
			percent: Math.round(this.#fraction * 100),
			label: this.#label(),
			error: this.#error,
			elapsed: now - this.#shownAt
		};
	}

	#advance(now: number, dt: number) {
		this.#target = Math.max(this.#target, this.#ready ? 1 : Math.min(LOADING.ceiling, this.#raw(now)));
		// Critically damped spring, exact step: x(t) = g + (x0 − g + (v0 + ω(x0 − g))t)e^(−ωt).
		const omega = this.#ready ? LOADING.finishOmega : LOADING.omega;
		const offset = this.#fraction - this.#target;
		const slope = this.#velocity + omega * offset;
		const decay = Math.exp(-omega * dt);
		const next = this.#target + (offset + slope * dt) * decay;
		this.#velocity = Math.max(0, (this.#velocity - omega * slope * dt) * decay);
		let fraction = Math.min(this.#ready ? 1 : LOADING.ceiling, Math.max(this.#fraction, next));
		if (this.#ready && 1 - fraction < 0.002) {
			fraction = 1;
			this.#velocity = 0;
		}
		this.#fraction = fraction;
	}

	/** Finished weight plus the creep of running tasks, over the total weight. */
	#raw(now: number) {
		let total = 0;
		let finished = 0;
		for (const task of this.#tasks.values()) {
			total += task.weight;
			if (task.done) finished += task.weight;
			else if (task.startedAt !== null)
				finished +=
					task.weight * LOADING.creepShare * (1 - Math.exp(-(now - task.startedAt) / LOADING.creepMs));
		}
		if (total === 0) return LOADING.idleShare * (1 - Math.exp(-(now - this.#shownAt) / LOADING.creepMs));
		return finished / total;
	}

	#label() {
		if (this.#ready) return LOADING.readyLabel;
		for (const stage of STAGES) {
			const task = this.#tasks.get(stage.id);
			if (task && !task.done) return stage.label;
		}
		return LOADING.idleLabel;
	}
}

function positive(weight: number) {
	return Number.isFinite(weight) && weight > 0 ? weight : 1;
}

function isAbort(error: unknown) {
	return typeof error === 'object' && error !== null && 'name' in error && error.name === 'AbortError';
}

function errorKind(error: unknown): LoadingErrorKind {
	return error instanceof Error && error.message === 'game-webgl-unavailable' ? 'unsupported' : 'failed';
}
