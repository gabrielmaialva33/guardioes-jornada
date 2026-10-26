/**
 * The ring manager (WORLD.md §2, PARK.md §8): which chunks the player needs
 * and in what order.
 *
 * - Rings, as Chebyshev radii around the focus chunk: render 2 (5 × 5) on
 *   low and medium, 3 (7 × 7) on high; data one more (7 × 7, 9 × 9), so every
 *   rendered chunk has its neighbours for seamless normals; collision 1 (3 × 3).
 * - The focus moves when the player crosses a chunk edge. Every ring keeps
 *   one ring of slack: a chunk is released only beyond its radius + 1, so
 *   walking back and forth over an edge costs nothing.
 * - Data requests go out on a crossing, nearest and most ahead first (the
 *   chunk the player faces wins ties); pending ones that fall out of range are
 *   cancelled. Resident data stays under a byte cap: slack chunks go first.
 * - Main-thread work (attaching built meshes and colliders, placing
 *   instances, posting builds, releasing) runs in `update()` within a time
 *   budget per frame; terrain attributes and collision BVHs are built in the
 *   streaming Worker. Each step type keeps a running cost estimate, and a step
 *   that would overrun the budget waits for the next frame.
 * - Slot state lives in typed arrays indexed by a toroidal slot table (side
 *   2 · (data radius + 1) + 1); a frame without a crossing allocates nothing.
 */
import { type Camera, Group, type Mesh, type Object3D } from 'three';
import type { Quality } from '../../render/index.ts';
import type { PropProxy } from '../collision.ts';
import { ChunkCollider, type CollisionInput, CompoundCollision } from './chunk-collision.ts';
import type { StreamClient } from './client.ts';
import type { BuildRequest, BuildResult } from './protocol.ts';
import type { ChunkPlacements } from './slots.ts';
import type { TerrainInput, TerrainMeshPool } from './terrain-mesh.ts';
import type { RibbonMeshPool } from './trails.ts';
import { CHUNK_SIZE, type ChunkSource, chunkId, chunkOf, type StreamChunk } from './types.ts';
import { gatherBodies, type WaterMeshPool } from './water.ts';
import type { StreamWaterfall } from './waterfalls.ts';
import { createWindow, type FieldWindow, fillWindow } from './window.ts';

/** Ring radii in chunks (Chebyshev). */
export interface RingRadii {
	render: number;
	data: number;
	collision: number;
}

/** WORLD.md §2: render 5 × 5 on low (and medium), 7 × 7 on high; data +1; collision 3 × 3. */
export function ringRadii(quality: Quality): RingRadii {
	const render = quality === 'high' ? 3 : 2;
	return { render, data: render + 1, collision: 1 };
}

export interface RingOptions {
	source: ChunkSource;
	/** Terrain and collision builds (the streaming Worker's client). */
	builder: StreamClient;
	quality?: Quality;
	/** Overrides the quality's radii. */
	radii?: Partial<RingRadii>;
	/** Main-thread milliseconds per frame for streaming work (default 4). */
	budgetMs?: number;
	/** Bytes of chunk data the ring may hold (default 8 MiB). */
	byteCap?: number;
	/** Terrain meshes; null streams data and collision only. */
	terrain?: TerrainMeshPool | null;
	/** Water meshes (built with the terrain): rivers, pools, basins, the sea's edge. */
	water?: WaterMeshPool | null;
	/** Trail ribbons of the zones. */
	ribbons?: RibbonMeshPool | null;
	/** Mounts what a waterfall needs besides its model (spray.ts createWaterfallSpray, say). */
	waterfall?: ((fall: StreamWaterfall) => MountedFall) | null;
	placements?: ChunkPlacements | null;
	/** Extra colliders for a chunk (prefab props, gates), world coordinates. */
	props?: (chunk: StreamChunk) => readonly PropProxy[] | undefined;
	/** How much facing the chunk shortens its distance in the order of work, 0..1 (default 0.5). */
	facing?: number;
	now?: () => number;
}

/** A waterfall's extras, mounted while its chunk renders. */
export interface MountedFall {
	object: Object3D;
	update?(camera: Camera): void;
	dispose(): void;
}

export interface RingStats {
	focusX: number;
	focusZ: number;
	refocuses: number;
	/** Chunks with data (void chunks included) and the bytes they hold. */
	resident: number;
	voids: number;
	bytes: number;
	meshes: number;
	/** Water meshes, trail ribbons and waterfalls mounted. */
	water: number;
	ribbons: number;
	falls: number;
	colliders: number;
	placed: number;
	pendingData: number;
	pendingBuilds: number;
	/** Main-thread ms of the last update() and the worst so far. */
	frameMs: number;
	maxFrameMs: number;
	/** Frames whose streaming work ran past the budget. */
	overBudget: number;
	/** Colliders built on the main thread because the player's chunk had none once in play (after the first ready()). */
	emergencies: number;
	/** Data releases forced by the byte cap. */
	capped: number;
	/** Chunks whose data failed RETRIES + 1 times, held as void. */
	failed: number;
	/** Worst single step per kind (ms). */
	maxStepMs: Float64Array;
}

const DATA_PENDING = 1;
const DATA = 2;
const MESH_PENDING = 4;
const MESH = 8;
const COL_PENDING = 16;
const COL = 32;
const PLACED = 64;
/** Collision builds rank ahead of every terrain build. */
const COLLISION_FIRST = 100;
/** Requests a chunk gets before the ring holds it as void. */
const RETRIES = 3;

/** Step kinds, in the order the frame loop prefers them. */
export const STEP = {
	release: 0,
	collider: 1,
	collision: 2,
	mesh: 3,
	/** The chunk's water, trail ribbon and waterfalls, the step after its terrain. */
	surface: 4,
	place: 5,
	build: 6
} as const;
const STEPS = 7;

export class StreamingRing {
	readonly source: ChunkSource;
	readonly builder: StreamClient;
	readonly radii: RingRadii;
	readonly budgetMs: number;
	readonly byteCap: number;
	/** Terrain meshes of the render ring; add it to the scene. */
	readonly object = new Group();
	/** The collision ring as one query object (character and camera). */
	readonly collision = new CompoundCollision();
	readonly terrain: TerrainMeshPool | null;
	readonly water: WaterMeshPool | null;
	readonly ribbons: RibbonMeshPool | null;
	readonly placements: ChunkPlacements | null;
	readonly stats: RingStats;
	/** Called after a chunk's mesh joins the scene and before it leaves. */
	onRender: ((chunk: StreamChunk, mesh: Mesh) => void) | null = null;
	onUnrender: ((chunk: StreamChunk, mesh: Mesh) => void) | null = null;

	readonly #side: number;
	readonly #cx: Int32Array;
	readonly #cz: Int32Array;
	readonly #key: Float64Array;
	readonly #state: Uint8Array;
	readonly #gen: Uint32Array;
	readonly #retries: Uint8Array;
	readonly #meshJob: Float64Array;
	readonly #colJob: Float64Array;
	readonly #chunk: (StreamChunk | null)[];
	readonly #mesh: (Mesh | null)[];
	readonly #waterMesh: (Mesh | null)[];
	readonly #ribbonMesh: (Mesh | null)[];
	readonly #falls: (MountedFall[] | null)[];
	/** Every mounted waterfall, for updateWaterfalls(). */
	readonly #mounted: MountedFall[] = [];
	readonly #waterfall: RingOptions['waterfall'];
	readonly #collider: (ChunkCollider | null)[];
	readonly #builtMesh: (BuildResult | null)[];
	readonly #builtCol: (BuildResult | null)[];
	/** A terrain just attached whose water, ribbon and waterfalls wait for their own step. */
	readonly #surface: (BuildResult | null)[];
	readonly #estimate = new Float64Array(STEPS).fill(0.05);
	readonly #window: FieldWindow = createWindow();
	readonly #lookup = (cx: number, cz: number) => this.chunkAt(cx, cz);
	readonly #props: RingOptions['props'];
	readonly #facing: number;
	readonly #now: () => number;
	#fcx = 0;
	#fcz = 0;
	#started = false;
	#px = 0;
	#pz = 0;
	#dx = 0;
	#dz = 1;
	#pickStep = -1;
	#disposed = false;
	#playing = false;

	constructor(options: RingOptions) {
		this.source = options.source;
		this.builder = options.builder;
		const base = ringRadii(options.quality ?? 'low');
		this.radii = { ...base, ...options.radii };
		this.budgetMs = options.budgetMs ?? 4;
		this.byteCap = options.byteCap ?? 8 * 1024 * 1024;
		this.terrain = options.terrain ?? null;
		this.water = options.water ?? null;
		this.ribbons = options.ribbons ?? null;
		this.#waterfall = options.waterfall ?? null;
		this.placements = options.placements ?? null;
		this.#props = options.props;
		this.#facing = options.facing ?? 0.5;
		this.#now = options.now ?? (() => performance.now());
		this.#side = 2 * (this.radii.data + 1) + 1;
		const n = this.#side * this.#side;
		this.#cx = new Int32Array(n);
		this.#cz = new Int32Array(n);
		this.#key = new Float64Array(n).fill(-1);
		this.#state = new Uint8Array(n);
		this.#gen = new Uint32Array(n);
		this.#retries = new Uint8Array(n);
		this.#meshJob = new Float64Array(n);
		this.#colJob = new Float64Array(n);
		this.#chunk = new Array(n).fill(null);
		this.#mesh = new Array(n).fill(null);
		this.#waterMesh = new Array(n).fill(null);
		this.#ribbonMesh = new Array(n).fill(null);
		this.#falls = new Array(n).fill(null);
		this.#collider = new Array(n).fill(null);
		this.#builtMesh = new Array(n).fill(null);
		this.#surface = new Array(n).fill(null);
		this.#builtCol = new Array(n).fill(null);
		this.object.name = 'stream-terrain';
		this.stats = {
			focusX: 0,
			focusZ: 0,
			refocuses: 0,
			resident: 0,
			voids: 0,
			bytes: 0,
			meshes: 0,
			water: 0,
			ribbons: 0,
			falls: 0,
			colliders: 0,
			placed: 0,
			pendingData: 0,
			pendingBuilds: 0,
			frameMs: 0,
			maxFrameMs: 0,
			overBudget: 0,
			emergencies: 0,
			capped: 0,
			failed: 0,
			maxStepMs: new Float64Array(STEPS)
		};
		this.builder.onBuilt = (result) => this.#built(result);
		this.builder.onBuildError = (job) => this.#buildFailed(job);
	}

	/** Slots in the table (its side squared). */
	get capacity(): number {
		return this.#side * this.#side;
	}

	/** The loaded chunk at (cx, cz): the chunk, null for void, undefined when not loaded. */
	chunkAt(cx: number, cz: number): StreamChunk | null | undefined {
		const s = this.#slot(cx, cz);
		if (this.#key[s] !== chunkId(cx, cz) || !(this.#state[s] & DATA)) return undefined;
		return this.#chunk[s];
	}

	/** True when (cx, cz) has its terrain mesh (or is void). */
	rendered(cx: number, cz: number): boolean {
		const s = this.#slot(cx, cz);
		if (this.#key[s] !== chunkId(cx, cz) || !(this.#state[s] & DATA)) return false;
		return this.#chunk[s] === null || !this.terrain || (this.#state[s] & MESH) !== 0;
	}

	/** True when (cx, cz) has its collider (or is void). */
	collides(cx: number, cz: number): boolean {
		const s = this.#slot(cx, cz);
		if (this.#key[s] !== chunkId(cx, cz) || !(this.#state[s] & DATA)) return false;
		return this.#chunk[s] === null || (this.#state[s] & COL) !== 0;
	}

	/** Everything the player can see and touch around the focus is in: a loading screen may lift. */
	ready(): boolean {
		if (!this.#started) return false;
		const { render, collision } = this.radii;
		for (let dz = -render; dz <= render; dz++)
			for (let dx = -render; dx <= render; dx++) {
				const cx = this.#fcx + dx;
				const cz = this.#fcz + dz;
				if (!this.rendered(cx, cz)) return false;
				if (Math.abs(dx) <= collision && Math.abs(dz) <= collision && !this.collides(cx, cz)) return false;
				const slot = this.#slot(cx, cz);
				if (this.placements && this.#chunk[slot] && !(this.#state[slot] & PLACED)) return false;
				// Water, trails and waterfalls are in too.
				if (this.#surface[slot]) return false;
			}
		return true;
	}

	/**
	 * Once per frame: the player's world position and facing (any length).
	 * Refocuses on a chunk crossing, then works within the budget.
	 */
	update(x: number, z: number, facingX = 0, facingZ = 1) {
		if (this.#disposed) return;
		const t0 = this.#now();
		this.#px = x;
		this.#pz = z;
		// Math.hypot allocates (varargs); a frame should not.
		const f = Math.sqrt(facingX * facingX + facingZ * facingZ);
		if (f > 1e-6) {
			this.#dx = facingX / f;
			this.#dz = facingZ / f;
		}
		const fcx = chunkOf(x);
		const fcz = chunkOf(z);
		if (!this.#started || fcx !== this.#fcx || fcz !== this.#fcz) this.#refocus(fcx, fcz);
		// In play (ready once), the player's own chunk must collide this frame; while loading, the Worker builds it.
		if (!this.#playing && this.ready()) this.#playing = true;
		const focus = this.#slot(fcx, fcz);
		if (
			this.#playing &&
			this.#key[focus] === chunkId(fcx, fcz) &&
			this.#state[focus] & DATA &&
			this.#chunk[focus] &&
			!(this.#state[focus] & COL)
		)
			this.#emergency(focus);
		let steps = 0;
		for (;;) {
			const elapsed = this.#now() - t0;
			if (elapsed >= this.budgetMs) break;
			const s = this.#pick();
			if (s < 0) break;
			const step = this.#pickStep;
			if (steps > 0 && elapsed + this.#estimate[step] > this.budgetMs) break;
			const t1 = this.#now();
			this.#run(s, step);
			const dt = this.#now() - t1;
			this.#estimate[step] = Math.max(dt, this.#estimate[step] * 0.9 + dt * 0.1);
			if (dt > this.stats.maxStepMs[step]) this.stats.maxStepMs[step] = dt;
			steps++;
		}
		const ms = this.#now() - t0;
		this.stats.frameMs = ms;
		if (ms > this.stats.maxFrameMs) this.stats.maxFrameMs = ms;
		if (ms > this.budgetMs) this.stats.overBudget++;
	}

	/** Once per frame with the camera: the mounted waterfalls' own updates (spray visibility). */
	updateWaterfalls(camera: Camera) {
		const mounted = this.#mounted;
		for (let k = 0; k < mounted.length; k++) mounted[k].update?.(camera);
	}

	/**
	 * After a teleport or a respawn far away: loading rules again (the player's
	 * chunk waits for the Worker, no main-thread collider) until ready().
	 */
	relocate() {
		this.#playing = false;
	}

	/** Releases everything (meshes back to their pool, colliders disposed, requests cancelled). */
	dispose() {
		if (this.#disposed) return;
		for (let s = 0; s < this.#key.length; s++) if (this.#key[s] !== -1) this.#release(s);
		this.builder.onBuilt = null;
		this.builder.onBuildError = null;
		this.#disposed = true;
	}

	#slot(cx: number, cz: number): number {
		const n = this.#side;
		return (((cx % n) + n) % n) + (((cz % n) + n) % n) * n;
	}

	#distance(s: number): number {
		return Math.max(Math.abs(this.#cx[s] - this.#fcx), Math.abs(this.#cz[s] - this.#fcz));
	}

	/** Order of work: distance from the player to the chunk centre, shortened up to `facing` for chunks ahead. */
	#score(cx: number, cz: number): number {
		const dx = (cx + 0.5) * CHUNK_SIZE - this.#px;
		const dz = (cz + 0.5) * CHUNK_SIZE - this.#pz;
		const d = Math.sqrt(dx * dx + dz * dz);
		if (d < 1e-6) return 0;
		const ahead = (dx * this.#dx + dz * this.#dz) / d;
		return (d / CHUNK_SIZE) * (1 - this.#facing * ahead);
	}

	#refocus(fcx: number, fcz: number) {
		this.#fcx = fcx;
		this.#fcz = fcz;
		this.#started = true;
		this.stats.focusX = fcx;
		this.stats.focusZ = fcz;
		this.stats.refocuses++;
		this.source.focus(this.#px, this.#pz);
		const { data } = this.radii;
		// Out of the slack ring: release now (pending requests are only cancelled, so this is cheap).
		for (let s = 0; s < this.#key.length; s++)
			if (this.#key[s] !== -1 && this.#distance(s) > data + 1) this.#release(s);
		for (let dz = -data; dz <= data; dz++)
			for (let dx = -data; dx <= data; dx++) {
				const cx = fcx + dx;
				const cz = fcz + dz;
				const s = this.#slot(cx, cz);
				const key = chunkId(cx, cz);
				if (this.#key[s] === key) {
					// Still wanted: pending work is re-ranked from the new position.
					if (this.#state[s] & DATA_PENDING) this.#request(s, cx, cz);
					if (this.#meshJob[s]) this.builder.rank(this.#meshJob[s], this.#score(cx, cz));
					if (this.#colJob[s]) this.builder.rank(this.#colJob[s], this.#score(cx, cz) - COLLISION_FIRST);
					continue;
				}
				if (this.#key[s] !== -1) this.#release(s);
				this.#cx[s] = cx;
				this.#cz[s] = cz;
				this.#key[s] = key;
				this.#state[s] = DATA_PENDING;
				this.stats.pendingData++;
				this.#request(s, cx, cz);
			}
		this.#cap();
	}

	#request(s: number, cx: number, cz: number) {
		const gen = this.#gen[s];
		this.source.request(cx, cz, this.#score(cx, cz)).then(
			(chunk) => this.#arrived(s, gen, chunk),
			() => this.#lost(s, gen)
		);
	}

	#arrived(s: number, gen: number, chunk: StreamChunk | null) {
		if (this.#disposed || this.#gen[s] !== gen || !(this.#state[s] & DATA_PENDING)) return;
		this.#state[s] = (this.#state[s] & ~DATA_PENDING) | DATA;
		this.#chunk[s] = chunk;
		this.#retries[s] = 0;
		this.stats.pendingData--;
		this.stats.resident++;
		if (chunk) this.stats.bytes += chunk.bytes;
		else this.stats.voids++;
		this.#cap();
	}

	/**
	 * A request failed or was dropped by the source: ask again, up to RETRIES
	 * times, then hold the chunk as void (counted in stats.failed) so the ring
	 * never waits on it forever.
	 */
	#lost(s: number, gen: number) {
		if (this.#disposed || this.#gen[s] !== gen || !(this.#state[s] & DATA_PENDING)) return;
		this.#gen[s]++;
		if (this.#retries[s] < RETRIES) {
			this.#retries[s]++;
			this.#request(s, this.#cx[s], this.#cz[s]);
			return;
		}
		this.stats.failed++;
		this.#arrived(s, this.#gen[s], null);
	}

	/** Over the byte cap: release slack chunks, farthest first. */
	#cap() {
		while (this.stats.bytes > this.byteCap) {
			let worst = -1;
			let far = -1;
			for (let s = 0; s < this.#key.length; s++) {
				if (!(this.#state[s] & DATA) || !this.#chunk[s]) continue;
				const d = this.#distance(s);
				if (d > this.radii.data && d > far) {
					far = d;
					worst = s;
				}
			}
			if (worst < 0) return;
			this.#release(worst);
			this.stats.capped++;
		}
	}

	#release(s: number) {
		this.#releaseMesh(s);
		this.#releaseCollider(s);
		const st = this.#state[s];
		if (st & DATA_PENDING) {
			this.source.cancel(this.#cx[s], this.#cz[s]);
			this.stats.pendingData--;
		}
		if (st & DATA) {
			const chunk = this.#chunk[s];
			this.stats.resident--;
			if (chunk) this.stats.bytes -= chunk.bytes;
			else this.stats.voids--;
			this.source.release(this.#cx[s], this.#cz[s]);
		}
		this.#chunk[s] = null;
		this.#key[s] = -1;
		this.#state[s] = 0;
		this.#retries[s] = 0;
		this.#gen[s]++;
	}

	#releaseMesh(s: number) {
		const chunk = this.#chunk[s];
		if (this.#meshJob[s]) {
			this.builder.cancelBuild(this.#meshJob[s]);
			this.#meshJob[s] = 0;
			this.stats.pendingBuilds--;
		}
		this.#builtMesh[s] = null;
		this.#surface[s] = null;
		if (this.#state[s] & PLACED && chunk && this.placements) {
			this.placements.removeChunk(chunk);
			this.stats.placed--;
		}
		const mesh = this.#mesh[s];
		if (mesh && this.terrain) {
			if (chunk) this.onUnrender?.(chunk, mesh);
			this.terrain.release(mesh);
			this.stats.meshes--;
		}
		this.#mesh[s] = null;
		const water = this.#waterMesh[s];
		if (water && this.water) {
			this.water.release(water);
			this.stats.water--;
		}
		this.#waterMesh[s] = null;
		const ribbon = this.#ribbonMesh[s];
		if (ribbon && this.ribbons) {
			this.ribbons.release(ribbon);
			this.stats.ribbons--;
		}
		this.#ribbonMesh[s] = null;
		const falls = this.#falls[s];
		if (falls)
			for (const m of falls) {
				this.#mounted.splice(this.#mounted.indexOf(m), 1);
				m.object.removeFromParent();
				m.dispose();
				this.stats.falls--;
			}
		this.#falls[s] = null;
		this.#state[s] &= ~(MESH | MESH_PENDING | PLACED);
	}

	#releaseCollider(s: number) {
		if (this.#colJob[s]) {
			this.builder.cancelBuild(this.#colJob[s]);
			this.#colJob[s] = 0;
			this.stats.pendingBuilds--;
		}
		this.#builtCol[s] = null;
		const c = this.#collider[s];
		if (c) {
			this.collision.remove(c);
			c.dispose();
			this.stats.colliders--;
		}
		this.#collider[s] = null;
		this.#state[s] &= ~(COL | COL_PENDING);
	}

	/** Neighbours settled: data in (or void) for all eight, so the window is exact. */
	#neighbours(s: number): boolean {
		const cx = this.#cx[s];
		const cz = this.#cz[s];
		for (let dz = -1; dz <= 1; dz++)
			for (let dx = -1; dx <= 1; dx++) {
				if (dx === 0 && dz === 0) continue;
				const n = this.#slot(cx + dx, cz + dz);
				if (this.#key[n] !== chunkId(cx + dx, cz + dz) || !(this.#state[n] & DATA)) return false;
			}
		return true;
	}

	/** The best step to run now; its kind goes to #pickStep. −1 when there is nothing to do. */
	#pick(): number {
		const { render, collision } = this.radii;
		let best = -1;
		let bestStep = STEPS;
		let bestScore = 0;
		for (let s = 0; s < this.#key.length; s++) {
			if (this.#key[s] === -1) continue;
			const st = this.#state[s];
			if (!(st & DATA)) continue;
			const chunk = this.#chunk[s];
			if (!chunk) continue;
			const d = this.#distance(s);
			let step: number = STEPS;
			if ((st & (MESH | MESH_PENDING) && d > render + 1) || (st & (COL | COL_PENDING) && d > collision + 1))
				step = STEP.release;
			else if (this.#builtCol[s]) step = STEP.collider;
			else if (d <= collision && !(st & (COL | COL_PENDING))) step = STEP.collision;
			else if (this.#builtMesh[s] && this.terrain) step = STEP.mesh;
			else if (this.#surface[s]) step = STEP.surface;
			else if (st & MESH && !(st & PLACED) && this.placements) step = STEP.place;
			else if (this.terrain && d <= render && !(st & (MESH | MESH_PENDING)) && this.#neighbours(s))
				step = STEP.build;
			if (step === STEPS || step > bestStep) continue;
			const score = this.#score(this.#cx[s], this.#cz[s]);
			if (step < bestStep || score < bestScore) {
				best = s;
				bestStep = step;
				bestScore = score;
			}
		}
		this.#pickStep = bestStep;
		return best;
	}

	#run(s: number, step: number) {
		const chunk = this.#chunk[s] as StreamChunk;
		const d = this.#distance(s);
		switch (step) {
			case STEP.release:
				if (d > this.radii.render + 1) this.#releaseMesh(s);
				if (d > this.radii.collision + 1) this.#releaseCollider(s);
				break;
			case STEP.collider: {
				const result = this.#builtCol[s] as BuildResult;
				this.#builtCol[s] = null;
				if (result.collision) this.#attachCollider(s, new ChunkCollider(result.collision));
				else this.#state[s] &= ~COL_PENDING;
				break;
			}
			case STEP.collision:
				this.#postBuild(s, chunk, false);
				break;
			case STEP.mesh: {
				const result = this.#builtMesh[s] as BuildResult;
				this.#builtMesh[s] = null;
				this.#state[s] &= ~MESH_PENDING;
				if (result.terrain && this.terrain) {
					const mesh = this.terrain.acquire(result.terrain, chunk.x0, chunk.z0, chunk.minY, chunk.maxY);
					this.object.add(mesh);
					this.#mesh[s] = mesh;
					this.#state[s] |= MESH;
					this.stats.meshes++;
					if (
						(result.water && this.water) ||
						((result.ribbon ?? chunk.ribbon) && this.ribbons) ||
						(chunk.waterfalls?.length && this.#waterfall)
					)
						this.#surface[s] = result;
					this.onRender?.(chunk, mesh);
				}
				break;
			}
			case STEP.surface: {
				const result = this.#surface[s] as BuildResult;
				this.#surface[s] = null;
				this.#surfaces(s, chunk, result);
				break;
			}
			case STEP.place:
				this.placements?.add(chunk);
				this.#state[s] |= PLACED;
				this.stats.placed++;
				break;
			case STEP.build:
				this.#postBuild(s, chunk, true);
				break;
		}
	}

	/** The chunk's water, trail ribbon and waterfalls, with its terrain. */
	#surfaces(s: number, chunk: StreamChunk, result: BuildResult) {
		if (result.water && this.water) {
			const mesh = this.water.acquire(result.water, chunk.x0, chunk.z0);
			this.object.add(mesh);
			this.#waterMesh[s] = mesh;
			this.stats.water++;
		}
		const ribbon = result.ribbon ?? chunk.ribbon;
		if (ribbon && ribbon.count > 0 && this.ribbons) {
			const mesh = this.ribbons.acquire(ribbon, chunk.x0, chunk.z0);
			this.object.add(mesh);
			this.#ribbonMesh[s] = mesh;
			this.stats.ribbons++;
		}
		if (chunk.waterfalls && chunk.waterfalls.length > 0 && this.#waterfall) {
			const mounted: MountedFall[] = [];
			for (const fall of chunk.waterfalls) {
				const m = this.#waterfall(fall);
				this.object.add(m.object);
				mounted.push(m);
				this.#mounted.push(m);
				this.stats.falls++;
			}
			this.#falls[s] = mounted;
		}
	}

	#collisionInput(chunk: StreamChunk): CollisionInput {
		const k = chunk.collision;
		return {
			x0: chunk.x0,
			z0: chunk.z0,
			heights: chunk.heights,
			cylinders: k.cylinders,
			boxes: k.boxes,
			decks: k.decks,
			props: this.#props?.(chunk)
		};
	}

	#terrainInput(chunk: StreamChunk): TerrainInput {
		fillWindow(this.#window, chunk, this.#lookup);
		const bodies = gatherBodies(chunk, this.#lookup, this.#window);
		return {
			window: this.#window,
			x0: chunk.x0,
			z0: chunk.z0,
			waterLevel: chunk.waterLevel,
			rivers: bodies.rivers,
			pool: bodies.pools[0] ?? null,
			bodies,
			local: this.terrain?.local ?? true
		};
	}

	/** Posts a build: the terrain (with the collision too when it is due), or the collision alone. */
	#postBuild(s: number, chunk: StreamChunk, terrain: boolean) {
		const wantsCollision =
			this.#distance(s) <= this.radii.collision && !(this.#state[s] & (COL | COL_PENDING));
		if (terrain) {
			const job = this.builder.nextJob();
			const request: BuildRequest = {
				job,
				priority: this.#score(chunk.cx, chunk.cz),
				cx: chunk.cx,
				cz: chunk.cz,
				terrain: this.#terrainInput(chunk),
				collision: null
			};
			this.#meshJob[s] = job;
			this.#state[s] |= MESH_PENDING;
			this.stats.pendingBuilds++;
			this.builder.build(request);
		}
		if (wantsCollision) {
			const job = this.builder.nextJob();
			// Collision first: the player may stand on it soon.
			const request: BuildRequest = {
				job,
				priority: this.#score(chunk.cx, chunk.cz) - COLLISION_FIRST,
				cx: chunk.cx,
				cz: chunk.cz,
				terrain: null,
				collision: this.#collisionInput(chunk)
			};
			this.#colJob[s] = job;
			this.#state[s] |= COL_PENDING;
			this.stats.pendingBuilds++;
			this.builder.build(request);
		}
	}

	#built(result: BuildResult) {
		const s = this.#slot(result.cx, result.cz);
		if (this.#key[s] !== chunkId(result.cx, result.cz)) return;
		// MESH_PENDING and COL_PENDING stay set until the frame loop attaches the result.
		if (this.#meshJob[s] === result.job) {
			this.#meshJob[s] = 0;
			this.stats.pendingBuilds--;
			this.#builtMesh[s] = result;
		} else if (this.#colJob[s] === result.job) {
			this.#colJob[s] = 0;
			this.stats.pendingBuilds--;
			this.#builtCol[s] = result;
		}
	}

	#buildFailed(job: number) {
		for (let s = 0; s < this.#key.length; s++) {
			if (this.#meshJob[s] === job) {
				this.#meshJob[s] = 0;
				this.#state[s] &= ~MESH_PENDING;
				this.stats.pendingBuilds--;
			}
			if (this.#colJob[s] === job) {
				this.#colJob[s] = 0;
				this.#state[s] &= ~COL_PENDING;
				this.stats.pendingBuilds--;
			}
		}
	}

	#attachCollider(s: number, collider: ChunkCollider) {
		const old = this.#collider[s];
		if (old) {
			this.collision.remove(old);
			old.dispose();
			this.stats.colliders--;
		}
		this.#collider[s] = collider;
		this.collision.add(collider);
		this.#state[s] = (this.#state[s] & ~COL_PENDING) | COL;
		this.stats.colliders++;
	}

	/** The player's own chunk has no collider: build it here, now (a hitch, counted). */
	#emergency(s: number) {
		const built = this.#builtCol[s];
		if (built?.collision) {
			this.#builtCol[s] = null;
			this.#attachCollider(s, new ChunkCollider(built.collision));
			return;
		}
		if (this.#colJob[s]) {
			this.builder.cancelBuild(this.#colJob[s]);
			this.#colJob[s] = 0;
			this.stats.pendingBuilds--;
		}
		this.#attachCollider(s, ChunkCollider.build(this.#collisionInput(this.#chunk[s] as StreamChunk)));
		this.stats.emergencies++;
	}
}
