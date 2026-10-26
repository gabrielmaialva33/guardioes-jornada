import { Ray, Vector3 } from 'three';
import { expect, it } from 'vitest';
import { buildPark } from '../../level/zones/park.ts';
import type { StreamClient, StreamPort } from './client.ts';
import { createStreamHost } from './host.ts';
import type { StreamResponse } from './protocol.ts';
import { createStreamingRuntime } from './runtime.ts';

it('holds physics during cold load and a far relocation, then disposes its worker and colliders', async () => {
	const turns: (() => void)[] = [];
	let port: StreamPort;
	let terminated = 0;
	const host = createStreamHost(
		(message, transfer) =>
			port.onmessage?.({ data: structuredClone(message, { transfer }) as StreamResponse }),
		{ schedule: (turn) => turns.push(turn), built: new Map(buildPark()) }
	);
	port = {
		onmessage: null,
		postMessage: (message) => host.receive(structuredClone(message)),
		terminate: () => {
			terminated++;
		}
	};
	const runtime = createStreamingRuntime({ zone: 'vale', quality: 'low', streamPort: port });
	expect(runtime.update(194, 50, 1, 0)).toBe(false);
	for (let k = 0; k < 800 && !runtime.ready; k++) {
		for (let j = 0; j < 8; j++) turns.shift()?.();
		for (let j = 0; j < 8; j++) await Promise.resolve();
		runtime.update(194, 50, 1, 0);
	}
	expect(runtime.ready).toBe(true);
	expect(
		runtime.collision.raycast(new Ray(new Vector3(194, 80, 50), new Vector3(0, -1, 0)), 150)
	).not.toBeNull();
	runtime.relocate();
	expect(runtime.ready).toBe(false);
	expect(runtime.update(310, 150, 0, 1)).toBe(false);
	for (let k = 0; k < 800 && !runtime.ready; k++) {
		for (let j = 0; j < 8; j++) turns.shift()?.();
		for (let j = 0; j < 8; j++) await Promise.resolve();
		runtime.update(310, 150, 0, 1);
	}
	expect(runtime.ready).toBe(true);
	runtime.dispose();
	runtime.dispose();
	expect(terminated).toBe(1);
	expect(runtime.ring.object.children).toHaveLength(0);
	expect(runtime.ring.stats.colliders).toBe(0);
	expect((runtime.stream as StreamClient).pending).toBe(0);
});
