/**
 * Worker entry: `new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })`
 * (client.ts createWorldGenWorker). Generation lives in host.ts and below;
 * this file only wires the port, a MessageChannel turn (no 4 ms timer clamp)
 * and the clock for the timing it reports. That clock is the only reason the
 * determinism scan exempts this file: no time ever reaches the generator.
 */
import { createHost } from './host.ts';
import type { WorkerRequest, WorkerResponse } from './protocol.ts';

interface WorkerScope {
	postMessage(message: WorkerResponse, transfer: ArrayBuffer[]): void;
	onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
}

const scope = globalThis as unknown as WorkerScope;
const turns: (() => void)[] = [];
const channel = new MessageChannel();
channel.port1.onmessage = () => turns.shift()?.();

const host = createHost((message, transfer) => scope.postMessage(message, transfer), {
	schedule(turn) {
		turns.push(turn);
		channel.port2.postMessage(0);
	},
	now: () => performance.now()
});

scope.onmessage = (event) => host.receive(event.data);
