/**
 * The streaming Worker's entry: `new Worker(new URL('./worker.ts',
 * import.meta.url), { type: 'module' })` (client.ts createStreamWorker). The
 * work lives in host.ts; this file wires the port, a MessageChannel turn (no
 * 4 ms timer clamp) and the clock for the timings it reports.
 */
import { createStreamHost } from './host.ts';
import type { StreamRequest, StreamResponse } from './protocol.ts';

interface WorkerScope {
	postMessage(message: StreamResponse, transfer: ArrayBuffer[]): void;
	onmessage: ((event: MessageEvent<StreamRequest>) => void) | null;
}

const scope = globalThis as unknown as WorkerScope;
const turns: (() => void)[] = [];
const channel = new MessageChannel();
channel.port1.onmessage = () => turns.shift()?.();

const host = createStreamHost((message, transfer) => scope.postMessage(message, transfer), {
	schedule(turn) {
		turns.push(turn);
		channel.port2.postMessage(0);
	},
	now: () => performance.now()
});

scope.onmessage = (event) => host.receive(event.data);
