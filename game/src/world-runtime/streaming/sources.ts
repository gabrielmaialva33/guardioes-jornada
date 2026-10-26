/**
 * The park's ChunkSource (hand-made zones, cut once per zone in the streaming
 * Worker) and the router that sends each chunk to its source: a park chunk to
 * the zones, any other to the endless world's generator.
 */
import { PARK_ZONES, type ZoneId, zoneOfChunk } from '../../level/zones/spec.ts';
import type { StreamClient } from './client.ts';
import { ZoneCancelled } from './client.ts';
import {
	CHUNK_SIZE,
	type ChunkSource,
	chunkId,
	StreamCancelled,
	type StreamChunk,
	streamChunkBytes
} from './types.ts';
import type { ZoneCut } from './zone-cut.ts';

/** Where a zone's chunks live in its cut (row-major over the zone's chunk rectangle). */
export function cutIndex(id: ZoneId, cx: number, cz: number): number {
	const z = PARK_ZONES[id];
	return (cz - z.cz0) * (z.cx1 - z.cx0 + 1) + cx - z.cx0;
}

interface Waiting {
	id: ZoneId;
	cx: number;
	cz: number;
	promise: Promise<StreamChunk | null>;
	resolve(chunk: StreamChunk | null): void;
	reject(error: Error): void;
}

export interface ZoneSourceOptions {
	/**
	 * A zone-only map (`?zone=<id>`): chunks of other zones and of the generated
	 * world are void, and the zone's edge chunks get invisible rails.
	 */
	only?: ZoneId;
	/** Cuts of zones no chunk is held from, kept for a walk back, within this many bytes (default 2 MiB). */
	keepBytes?: number;
}

/** Rails of a zone-only map: boxes on the zone's outer edges, CollisionBlock layout. */
export function zoneRails(id: ZoneId, cx: number, cz: number): Float32Array {
	const z = PARK_ZONES[id];
	const out: number[] = [];
	const x0 = cx * CHUNK_SIZE;
	const z0 = cz * CHUNK_SIZE;
	const half = CHUNK_SIZE / 2;
	// [cx, cy, cz, halfX, halfY, halfZ, yawC, yawS]: 1 u thick, 80 u tall as buildMapCollision's rails.
	if (cx === z.cx0) out.push(z.x0, 20, z0 + half, 0.5, 40, half, 1, 0);
	if (cx === z.cx1) out.push(z.x1, 20, z0 + half, 0.5, 40, half, 1, 0);
	if (cz === z.cz0) out.push(x0 + half, 20, z.z0, half, 40, 0.5, 1, 0);
	if (cz === z.cz1) out.push(x0 + half, 20, z.z1, half, 40, 0.5, 1, 0);
	return Float32Array.from(out);
}

export class ZoneSource implements ChunkSource {
	readonly client: StreamClient;
	readonly only: ZoneId | null;
	readonly keepBytes: number;
	readonly #cuts = new Map<ZoneId, ZoneCut>();
	/** Chunks held by the ring, per zone. */
	readonly #held = new Map<ZoneId, Set<number>>();
	readonly #waiting = new Map<number, Waiting>();
	#bytes = 0;

	constructor(client: StreamClient, options: ZoneSourceOptions = {}) {
		this.client = client;
		this.only = options.only ?? null;
		this.keepBytes = options.keepBytes ?? 2 * 1024 * 1024;
	}

	get bytes(): number {
		return this.#bytes;
	}

	/** Zones whose cut is here. */
	get zones(): ZoneId[] {
		return [...this.#cuts.keys()];
	}

	request(cx: number, cz: number, priority: number): Promise<StreamChunk | null> {
		const id = zoneOfChunk(cx, cz);
		if (!id || (this.only && id !== this.only)) return Promise.resolve(null);
		this.#hold(id, cx, cz);
		const cut = this.#cuts.get(id);
		if (cut) return Promise.resolve(this.#chunk(cut, cx, cz));
		const key = chunkId(cx, cz);
		const before = this.#waiting.get(key);
		// Asking again only re-ranks the zone: the same promise answers.
		if (before) {
			this.client.zone(id, priority);
			return before.promise;
		}
		let resolve!: (chunk: StreamChunk | null) => void;
		let reject!: (error: Error) => void;
		const promise = new Promise<StreamChunk | null>((yes, no) => {
			resolve = yes;
			reject = no;
		});
		this.#waiting.set(key, { id, cx, cz, promise, resolve, reject });
		this.client.zone(id, priority).then(
			(arrived) => this.#arrive(arrived),
			(error: Error) => this.#fail(id, error)
		);
		return promise;
	}

	cancel(cx: number, cz: number) {
		const key = chunkId(cx, cz);
		const waiting = this.#waiting.get(key);
		if (!waiting) return;
		this.#waiting.delete(key);
		waiting.reject(new StreamCancelled(cx, cz));
		this.#unhold(waiting.id, key);
		let wanted = false;
		for (const w of this.#waiting.values()) if (w.id === waiting.id) wanted = true;
		if (!wanted) this.client.cancelZone(waiting.id);
	}

	release(cx: number, cz: number) {
		const id = zoneOfChunk(cx, cz);
		if (id) this.#unhold(id, chunkId(cx, cz));
	}

	focus(_x: number, _z: number) {}

	dispose() {
		for (const [key, w] of this.#waiting) {
			this.#waiting.delete(key);
			w.reject(new StreamCancelled(w.cx, w.cz));
		}
		this.#cuts.clear();
		this.#held.clear();
		this.#bytes = 0;
	}

	#chunk(cut: ZoneCut, cx: number, cz: number): StreamChunk {
		return cut.chunks[cutIndex(cut.id, cx, cz)];
	}

	#hold(id: ZoneId, cx: number, cz: number) {
		let set = this.#held.get(id);
		if (!set) {
			set = new Set();
			this.#held.set(id, set);
			// Most recently held last, so #trim drops the stalest cut first.
			const cut = this.#cuts.get(id);
			if (cut) {
				this.#cuts.delete(id);
				this.#cuts.set(id, cut);
			}
		}
		set.add(chunkId(cx, cz));
	}

	#unhold(id: ZoneId, key: number) {
		const set = this.#held.get(id);
		if (!set) return;
		set.delete(key);
		if (set.size === 0) {
			this.#held.delete(id);
			this.#trim();
		}
	}

	/** Drops cuts nobody holds, least recently held first, beyond keepBytes. */
	#trim() {
		let loose = 0;
		for (const [id, cut] of this.#cuts) if (!this.#held.has(id)) loose += cut.bytes;
		for (const [id, cut] of this.#cuts) {
			if (loose <= this.keepBytes) break;
			if (this.#held.has(id)) continue;
			this.#cuts.delete(id);
			this.#bytes -= cut.bytes;
			loose -= cut.bytes;
		}
	}

	#arrive(cut: ZoneCut) {
		if (!this.#cuts.has(cut.id)) {
			if (this.only === cut.id)
				for (const c of cut.chunks) {
					const rails = zoneRails(cut.id, c.cx, c.cz);
					if (rails.length === 0) continue;
					const boxes = new Float32Array(c.collision.boxes.length + rails.length);
					boxes.set(c.collision.boxes);
					boxes.set(rails, c.collision.boxes.length);
					c.collision.boxes = boxes;
					c.bytes = streamChunkBytes(c);
				}
			let bytes = 0;
			for (const c of cut.chunks) bytes += c.bytes;
			cut.bytes = bytes;
			this.#cuts.set(cut.id, cut);
			this.#bytes += bytes;
		}
		const live = this.#cuts.get(cut.id) as ZoneCut;
		for (const [key, w] of this.#waiting)
			if (w.id === cut.id) {
				this.#waiting.delete(key);
				w.resolve(this.#chunk(live, w.cx, w.cz));
			}
		if (!this.#held.has(cut.id)) this.#trim();
	}

	#fail(id: ZoneId, error: Error) {
		for (const [key, w] of this.#waiting)
			if (w.id === id) {
				this.#waiting.delete(key);
				w.reject(error instanceof ZoneCancelled ? new StreamCancelled(w.cx, w.cz) : error);
			}
	}
}

/** Park chunks from the zones, every other chunk from the generator. */
export class ParkSource implements ChunkSource {
	readonly zones: ChunkSource;
	readonly generated: ChunkSource;

	constructor(zones: ChunkSource, generated: ChunkSource) {
		this.zones = zones;
		this.generated = generated;
	}

	get bytes(): number {
		return this.zones.bytes + this.generated.bytes;
	}

	#of(cx: number, cz: number): ChunkSource {
		return zoneOfChunk(cx, cz) ? this.zones : this.generated;
	}

	request(cx: number, cz: number, priority: number) {
		return this.#of(cx, cz).request(cx, cz, priority);
	}

	cancel(cx: number, cz: number) {
		this.#of(cx, cz).cancel(cx, cz);
	}

	release(cx: number, cz: number) {
		this.#of(cx, cz).release(cx, cz);
	}

	focus(x: number, z: number) {
		this.zones.focus(x, z);
		this.generated.focus(x, z);
	}

	dispose() {
		this.zones.dispose();
		this.generated.dispose();
	}
}
