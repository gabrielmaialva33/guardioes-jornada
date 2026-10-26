/** The page owns two Workers and one bounded ring; no scene/global state lives in either Worker. */
import type { Material } from 'three';
import type { ZoneId } from '../../level/zones/spec.ts';
import type { Quality } from '../../render/index.ts';
import { createWorldGenWorker, type WorkerPort, WorldGenClient } from '../../world-gen/client.ts';
import { createHost } from '../../world-gen/host.ts';
import type { WorkerRequest, WorkerResponse } from '../../world-gen/protocol.ts';
import { createInlineStreamPort, createStreamWorker, StreamClient, type StreamPort } from './client.ts';
import { StreamFarTerrain } from './far-terrain.ts';
import { GeneratedSource } from './generated.ts';
import { sampleHeight, sampleWater } from './navigation.ts';
import type { StreamRequest, StreamResponse } from './protocol.ts';
import { type RingOptions, StreamingRing } from './ring.ts';
import { ParkSource, ZoneSource } from './sources.ts';
import { createWaterfallSpray } from './spray.ts';
import { TerrainMeshPool } from './terrain-mesh.ts';
import { RibbonMeshPool } from './trails.ts';
import { chunkOf } from './types.ts';
import { WaterMeshPool } from './water.ts';

function adaptWorker<Input, Output>(worker: Worker) {
	const port = {
		onmessage: null as ((event: { data: Output }) => void) | null,
		postMessage(message: Input) {
			worker.postMessage(message);
		},
		terminate() {
			worker.onmessage = null;
			worker.terminate();
		}
	};
	worker.onmessage = (event: MessageEvent<Output>) => port.onmessage?.({ data: event.data });
	return port;
}

/** Module-Worker fallback for older WebViews. Work is scheduled, never run inside a physics query. */
function inlineGenerator(): WorkerPort {
	const channel = new MessageChannel(),
		turns: (() => void)[] = [];
	let disposed = false;
	const port: WorkerPort = {
		onmessage: null,
		postMessage(message) {
			if (!disposed) host.receive(structuredClone(message));
		},
		terminate() {
			disposed = true;
			turns.length = 0;
			channel.port1.close();
			channel.port2.close();
		}
	};
	channel.port1.onmessage = () => {
		if (!disposed) turns.shift()?.();
	};
	const host = createHost(
		(message, transfer) =>
			port.onmessage?.({ data: structuredClone(message, { transfer }) as WorkerResponse }),
		{
			schedule(turn) {
				turns.push(turn);
				channel.port2.postMessage(0);
			},
			now: () => performance.now()
		}
	);
	return port;
}

function streamPort(): StreamPort {
	try {
		return adaptWorker<StreamRequest, StreamResponse>(createStreamWorker());
	} catch {
		return createInlineStreamPort();
	}
}
function generatorPort(): WorkerPort {
	try {
		return adaptWorker<WorkerRequest, WorkerResponse>(createWorldGenWorker());
	} catch {
		return inlineGenerator();
	}
}

export interface StreamingOptions {
	zone?: ZoneId | null;
	quality: Quality;
	ground?: Material;
	water?: Material;
	path?: Material;
	placements?: RingOptions['placements'];
	props?: RingOptions['props'];
	streamPort?: StreamPort;
	generatorPort?: WorkerPort;
}

export function createStreamingRuntime(options: StreamingOptions) {
	const stream = new StreamClient(options.streamPort ?? streamPort());
	const generator = options.zone
		? null
		: new WorldGenClient(options.generatorPort ?? generatorPort(), { byteCap: 4 * 1024 * 1024 });
	const zones = new ZoneSource(stream, { only: options.zone ?? undefined, keepBytes: 2 * 1024 * 1024 });
	const source = generator ? new ParkSource(zones, new GeneratedSource(generator)) : zones;
	const terrain = options.ground ? new TerrainMeshPool(options.ground) : null;
	const water = options.water ? new WaterMeshPool(options.water) : null;
	const ribbons = options.path ? new RibbonMeshPool(options.path) : null;
	const ring = new StreamingRing({
		source,
		builder: stream,
		quality: options.quality,
		terrain,
		water,
		ribbons,
		waterfall: options.water ? createWaterfallSpray : null,
		placements: options.placements,
		props: options.props,
		budgetMs: 3,
		byteCap: 8 * 1024 * 1024
	});
	const far = options.ground ? new StreamFarTerrain(Math.sqrt(ring.capacity)) : null;
	if (far) ring.object.add(far.object);
	const lookup = (cx: number, cz: number) => ring.chunkAt(cx, cz);
	let ready = false,
		relocating = true,
		disposed = false;
	return {
		ring,
		stream,
		generator,
		terrain,
		far,
		collision: ring.collision,
		get ready() {
			return ready;
		},
		height(x: number, z: number) {
			return sampleHeight(lookup, x, z);
		},
		water(x: number, z: number) {
			return sampleWater(lookup, x, z);
		},
		/** Before the fixed-step controller. A teleport/cold load waits for the complete initial ring. */
		update(x: number, z: number, facingX = 0, facingZ = 1) {
			if (disposed) return false;
			ring.update(x, z, facingX, facingZ);
			far?.sync(ring);
			if (relocating) {
				ready = ring.ready();
				if (ready) relocating = false;
			} else ready = ring.collides(chunkOf(x), chunkOf(z)) && !!ring.chunkAt(chunkOf(x), chunkOf(z));
			return ready;
		},
		relocate() {
			if (disposed) return;
			relocating = true;
			ready = false;
			ring.relocate();
		},
		dispose() {
			if (disposed) return;
			disposed = true;
			ready = false;
			ring.dispose();
			source.dispose();
			stream.dispose();
			terrain?.dispose();
			water?.dispose();
			ribbons?.dispose();
			far?.dispose();
		}
	};
}

export type StreamingRuntime = ReturnType<typeof createStreamingRuntime>;
