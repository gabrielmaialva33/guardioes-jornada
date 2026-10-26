/**
 * The page's side of the streaming Worker: zone cuts as promises (one per
 * zone however many chunks wait for it) and chunk builds as callbacks keyed
 * by job id, so the ring allocates no promise per build.
 */
import type { ZoneId } from '../../level/zones/spec.ts';
import { WORLD_SEED } from '../../world-gen/constants.ts';
import { createStreamHost, type StreamHostOptions } from './host.ts';
import type { BuildRequest, BuildResult, StreamRequest, StreamResponse } from './protocol.ts';
import type { ZoneCut } from './zone-cut.ts';

/** What the client needs from a Worker (a fake in the tests, the inline port without one). */
export interface StreamPort {
	postMessage(message: StreamRequest): void;
	onmessage: ((event: { data: StreamResponse }) => void) | null;
	terminate?(): void;
}

/** The module Worker; Vite emits worker.ts as its own file. */
export function createStreamWorker(): Worker {
	return new Worker(new URL('./worker.ts', import.meta.url), { type: 'module', name: 'world-stream' });
}

/**
 * The host on this thread, one job per macrotask: for tests, previews and
 * browsers without module Workers. A zone build then runs on the main thread.
 */
export function createInlineStreamPort(options: Omit<StreamHostOptions, 'schedule'> = {}): StreamPort {
	const channel = new MessageChannel();
	const turns: (() => void)[] = [];
	channel.port1.onmessage = () => turns.shift()?.();
	const port: StreamPort = {
		// Copied as postMessage would: the ring reuses the buffers it sends.
		postMessage: (message) => host.receive(structuredClone(message)),
		onmessage: null,
		terminate: () => {
			turns.length = 0;
			channel.port1.close();
		}
	};
	const host = createStreamHost((message) => port.onmessage?.({ data: message }), {
		...options,
		schedule(turn) {
			turns.push(turn);
			channel.port2.postMessage(0);
		}
	});
	return port;
}

/** A zone cut given up before it arrived. */
export class ZoneCancelled extends Error {
	readonly zone: ZoneId;

	constructor(zone: ZoneId) {
		super(`zone ${zone} cancelled`);
		this.name = 'ZoneCancelled';
		this.zone = zone;
	}
}

export interface StreamStats {
	zones: number;
	builds: number;
	errors: number;
	/** Worker ms of the last build and the worst; of the last zone cut and the worst. */
	buildMs: number;
	buildMaxMs: number;
	zoneMs: number;
	zoneMaxMs: number;
	queued: number;
}

interface PendingZone {
	job: number;
	id: ZoneId;
	promise: Promise<ZoneCut>;
	resolve(cut: ZoneCut): void;
	reject(error: Error): void;
}

export class StreamClient {
	readonly seed: number;
	readonly stats: StreamStats = {
		zones: 0,
		builds: 0,
		errors: 0,
		buildMs: 0,
		buildMaxMs: 0,
		zoneMs: 0,
		zoneMaxMs: 0,
		queued: 0
	};
	/** Called with every finished build whose job was not cancelled. */
	onBuilt: ((result: BuildResult) => void) | null = null;
	/** Called when a build failed in the Worker. */
	onBuildError: ((job: number, message: string) => void) | null = null;
	readonly #port: StreamPort;
	readonly #zones = new Map<ZoneId, PendingZone>();
	readonly #builds = new Set<number>();
	readonly #cancelList: number[] = [];
	#jobs = 0;

	constructor(port: StreamPort, options: { seed?: number } = {}) {
		this.seed = options.seed ?? WORLD_SEED;
		this.#port = port;
		port.onmessage = (event) => this.#receive(event.data);
	}

	/** Builds and zone cuts in flight. */
	get pending(): number {
		return this.#builds.size + this.#zones.size;
	}

	/** A fresh job id (builds and zones share the sequence). */
	nextJob(): number {
		return ++this.#jobs;
	}

	/** The zone cut; asking again for a pending zone updates its priority and returns the same promise. */
	zone(id: ZoneId, priority = 0): Promise<ZoneCut> {
		let pending = this.#zones.get(id);
		if (!pending) {
			let resolve!: (cut: ZoneCut) => void;
			let reject!: (error: Error) => void;
			const promise = new Promise<ZoneCut>((yes, no) => {
				resolve = yes;
				reject = no;
			});
			pending = { job: this.nextJob(), id, promise, resolve, reject };
			this.#zones.set(id, pending);
		}
		this.#port.postMessage({ type: 'zone', job: pending.job, id, seed: this.seed, priority });
		return pending.promise;
	}

	cancelZone(id: ZoneId): boolean {
		const pending = this.#zones.get(id);
		if (!pending) return false;
		this.#zones.delete(id);
		this.#port.postMessage({ type: 'cancel', jobs: [pending.job] });
		pending.reject(new ZoneCancelled(id));
		return true;
	}

	/** Queues a build; its result comes to onBuilt. `request.job` comes from nextJob(). */
	build(request: BuildRequest) {
		this.#builds.add(request.job);
		this.#port.postMessage({ type: 'build', request });
	}

	/** Re-ranks a queued build (the Worker ignores a job it already ran). */
	rank(job: number, priority: number) {
		if (this.#builds.has(job)) this.#port.postMessage({ type: 'rank', job, priority });
	}

	cancelBuild(job: number): boolean {
		if (!this.#builds.delete(job)) return false;
		this.#cancelList.length = 0;
		this.#cancelList.push(job);
		this.#port.postMessage({ type: 'cancel', jobs: this.#cancelList });
		return true;
	}

	dispose() {
		for (const id of [...this.#zones.keys()]) this.cancelZone(id);
		this.#builds.clear();
		this.onBuilt = null;
		this.#port.onmessage = null;
		this.#port.terminate?.();
	}

	#receive(message: StreamResponse) {
		this.stats.queued = message.type === 'error' ? this.stats.queued : message.queued;
		switch (message.type) {
			case 'zone': {
				this.stats.zones++;
				this.stats.zoneMs = message.ms;
				this.stats.zoneMaxMs = Math.max(this.stats.zoneMaxMs, message.ms);
				const pending = this.#zones.get(message.cut.id);
				if (pending && pending.job === message.job) {
					this.#zones.delete(message.cut.id);
					pending.resolve(message.cut);
				}
				break;
			}
			case 'built': {
				const r = message.result;
				this.stats.builds++;
				this.stats.buildMs = r.ms;
				this.stats.buildMaxMs = Math.max(this.stats.buildMaxMs, r.ms);
				if (this.#builds.delete(r.job)) this.onBuilt?.(r);
				break;
			}
			case 'error': {
				this.stats.errors++;
				for (const pending of this.#zones.values())
					if (pending.job === message.job) {
						this.#zones.delete(pending.id);
						pending.reject(new Error(message.message));
						return;
					}
				if (this.#builds.delete(message.job)) this.onBuildError?.(message.job, message.message);
				break;
			}
		}
	}
}
