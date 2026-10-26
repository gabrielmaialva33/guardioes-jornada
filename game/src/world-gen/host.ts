/**
 * The Worker's side of the protocol, without the Worker: a queue of chunk
 * jobs run one per scheduled turn, nearest to the focus first, so cancel and
 * focus messages that arrive in between are seen before the next job. The
 * Worker keeps no game state; worker.ts wires this to `self`, the tests to a
 * fake port.
 */
import { generateChunk, type WorldChunk } from './chunk.ts';
import { chunkDistance2, chunkTransferables, type WorkerRequest, type WorkerResponse } from './protocol.ts';

export interface HostOptions {
	/** Runs `turn` after the messages already queued (a MessageChannel in the Worker). */
	schedule(turn: () => void): void;
	/** Clock for the per-chunk timing reported back; 0 when absent. */
	now?(): number;
	generate?(cx: number, cz: number, seed: number): WorldChunk;
}

export interface Host {
	receive(message: WorkerRequest): void;
	readonly pending: number;
}

interface Job {
	key: string;
	cx: number;
	cz: number;
	seed: number;
	priority?: number;
	/** Arrival order: the tie-break. */
	order: number;
}

export function createHost(
	post: (message: WorkerResponse, transfer: ArrayBuffer[]) => void,
	options: HostOptions
): Host {
	const queue = new Map<string, Job>();
	const generate = options.generate ?? generateChunk;
	const now = options.now ?? (() => 0);
	let focusX = 0;
	let focusZ = 0;
	let arrivals = 0;
	let scheduled = false;
	const rank = (job: Job) => job.priority ?? chunkDistance2(job.cx, job.cz, focusX, focusZ);

	const kick = () => {
		if (scheduled || queue.size === 0) return;
		scheduled = true;
		options.schedule(turn);
	};

	function turn() {
		scheduled = false;
		let best: Job | undefined;
		let bestRank = 0;
		for (const job of queue.values()) {
			const r = rank(job);
			if (!best || r < bestRank || (r === bestRank && job.order < best.order)) {
				best = job;
				bestRank = r;
			}
		}
		if (best) {
			queue.delete(best.key);
			try {
				const start = now();
				const chunk = generate(best.cx, best.cz, best.seed);
				const ms = now() - start;
				post({ type: 'chunk', key: best.key, chunk, ms, queued: queue.size }, chunkTransferables(chunk));
			} catch (error) {
				post({ type: 'error', key: best.key, message: String(error) }, []);
			}
		}
		kick();
	}

	return {
		receive(message) {
			switch (message.type) {
				case 'want': {
					const known = queue.get(message.key);
					queue.set(message.key, {
						key: message.key,
						cx: message.cx,
						cz: message.cz,
						seed: message.seed,
						priority: message.priority,
						order: known ? known.order : arrivals++
					});
					kick();
					break;
				}
				case 'cancel':
					for (const key of message.keys) queue.delete(key);
					break;
				case 'focus': {
					focusX = message.x;
					focusZ = message.z;
					const limit = message.dropBeyond;
					if (limit === undefined) break;
					const dropped: string[] = [];
					for (const job of queue.values())
						if (job.priority === undefined && chunkDistance2(job.cx, job.cz, focusX, focusZ) > limit * limit)
							dropped.push(job.key);
					for (const key of dropped) queue.delete(key);
					if (dropped.length > 0) post({ type: 'dropped', keys: dropped }, []);
					break;
				}
			}
		},
		get pending() {
			return queue.size;
		}
	};
}
