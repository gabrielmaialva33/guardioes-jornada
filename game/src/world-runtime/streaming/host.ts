/**
 * The streaming Worker's side, without the Worker (world-gen host.ts's
 * pattern): one job per scheduled turn, lowest priority first, so cancels and
 * new priorities that arrive in between are seen before the next job. A zone
 * job builds one zone per turn (its seams' zones first, each once per Worker)
 * and then cuts it, so chunk builds slip in between long zone builds.
 */

import { buildOne } from '../../level/zones/park.ts';
import { type ZoneId, zoneOfChunk } from '../../level/zones/spec.ts';
import type { ZoneBuild } from '../../level/zones/zone.ts';
import { collisionData } from './chunk-collision.ts';
import {
	type BuildRequest,
	cutTransferables,
	resultTransferables,
	type StreamRequest,
	type StreamResponse
} from './protocol.ts';
import {
	buildTerrainRows,
	createTerrainAttributes,
	inputBodies,
	type TerrainAttributes
} from './terrain-mesh.ts';
import type { TerrainTint } from './tint.ts';
import { type RibbonPiece, zoneRibbons } from './trails.ts';
import { chunkId } from './types.ts';
import {
	buildWaterMesh,
	createWaterAttributes,
	createWaterField,
	fillWaterField,
	type WaterAttributes
} from './water.ts';
import { buildZoneOnDemand, cutZone, zoneClosure } from './zone-cut.ts';

/** Zones whose split trail ribbons the Worker keeps (each a few MB at most). */
const RIBBON_ZONES = 2;

export interface StreamHostOptions {
	/** Runs `turn` after the messages already queued (a MessageChannel in the Worker). */
	schedule(turn: () => void): void;
	now?(): number;
	/** Zones built so far: the Worker's memo (shared with buildPark's results in tests). */
	built?: Map<ZoneId, ZoneBuild>;
	tint?: TerrainTint;
}

export interface StreamHost {
	receive(message: StreamRequest): void;
	readonly pending: number;
	readonly built: ReadonlyMap<ZoneId, ZoneBuild>;
}

interface Job {
	job: number;
	priority: number;
	order: number;
	zone?: { id: ZoneId; seed: number; started: number };
	build?: BuildRequest;
}

export function createStreamHost(
	post: (message: StreamResponse, transfer: ArrayBuffer[]) => void,
	options: StreamHostOptions
): StreamHost {
	const queue = new Map<number, Job>();
	const built = options.built ?? new Map<ZoneId, ZoneBuild>();
	const now = options.now ?? (() => 0);
	let arrivals = 0;
	let scheduled = false;

	const kick = () => {
		if (scheduled || queue.size === 0) return;
		scheduled = true;
		options.schedule(turn);
	};

	function runZone(job: Job) {
		const zone = job.zone as NonNullable<Job['zone']>;
		const t0 = now();
		const next = zoneClosure(zone.id).find((z) => !built.has(z));
		if (next) built.set(next, buildOne(next, built));
		if (next && next !== zone.id) {
			// Keep the job: one zone per turn, so builds run in between.
			zone.started += now() - t0;
			return;
		}
		queue.delete(job.job);
		const cut = cutZone(built.get(zone.id) as ZoneBuild, built, zone.seed);
		const ms = zone.started + (now() - t0);
		post({ type: 'zone', job: job.job, cut, ms, queued: queue.size }, cutTransferables(cut));
	}

	/**
	 * A park chunk's trail ribbon: its zone's pathRibbon, split by chunk once and
	 * kept for the RIBBON_ZONES zones used last; each answer is a copy (transferred).
	 */
	const ribbons = new Map<ZoneId, Map<number, RibbonPiece>>();
	function ribbonOf(cx: number, cz: number): RibbonPiece | null {
		const zone = zoneOfChunk(cx, cz);
		if (!zone) return null;
		let pieces = ribbons.get(zone);
		if (pieces) ribbons.delete(zone);
		else pieces = zoneRibbons(built.get(zone) ?? buildZoneOnDemand(zone, built));
		ribbons.set(zone, pieces);
		for (const old of ribbons.keys()) {
			if (ribbons.size <= RIBBON_ZONES) break;
			ribbons.delete(old);
		}
		const piece = pieces.get(chunkId(cx, cz));
		return piece
			? {
					position: piece.position.slice(),
					color: piece.color.slice(),
					trail: piece.trail.slice(),
					normal: piece.normal.slice(),
					count: piece.count,
					minY: piece.minY,
					maxY: piece.maxY
				}
			: null;
	}

	function runBuild(job: Job) {
		queue.delete(job.job);
		const request = job.build as BuildRequest;
		const t0 = now();
		let terrain: TerrainAttributes | null = null;
		let water: WaterAttributes | null = null;
		const input = request.terrain;
		if (input) {
			// One water field: the terrain's shore and the water mesh read the same values.
			const field = fillWaterField(inputBodies(input), input.window, createWaterField());
			terrain = createTerrainAttributes();
			buildTerrainRows(input, terrain, 0, 41, options.tint, field);
			water = buildWaterMesh(field, input.x0, input.z0, input.local, createWaterAttributes());
			if (water.count === 0) water = null;
		}
		const ribbon = input ? ribbonOf(request.cx, request.cz) : null;
		const collision = request.collision ? collisionData(request.collision) : null;
		const result = {
			job: request.job,
			cx: request.cx,
			cz: request.cz,
			terrain,
			water,
			ribbon,
			collision,
			ms: now() - t0
		};
		post({ type: 'built', result, queued: queue.size }, resultTransferables(result));
	}

	function turn() {
		scheduled = false;
		let best: Job | undefined;
		for (const job of queue.values())
			if (!best || job.priority < best.priority || (job.priority === best.priority && job.order < best.order))
				best = job;
		if (best) {
			try {
				if (best.zone) runZone(best);
				else runBuild(best);
			} catch (error) {
				queue.delete(best.job);
				post(
					{ type: 'error', job: best.job, message: error instanceof Error ? error.message : String(error) },
					[]
				);
			}
		}
		kick();
	}

	return {
		get pending() {
			return queue.size;
		},
		built,
		receive(message) {
			switch (message.type) {
				case 'zone': {
					const job = queue.get(message.job);
					if (job) job.priority = message.priority;
					else
						queue.set(message.job, {
							job: message.job,
							priority: message.priority,
							order: arrivals++,
							zone: { id: message.id, seed: message.seed, started: 0 }
						});
					break;
				}
				case 'build': {
					const r = message.request;
					const job = queue.get(r.job);
					if (job) job.priority = r.priority;
					else queue.set(r.job, { job: r.job, priority: r.priority, order: arrivals++, build: r });
					break;
				}
				case 'rank': {
					const job = queue.get(message.job);
					if (job) job.priority = message.priority;
					break;
				}
				case 'cancel':
					for (const id of message.jobs) queue.delete(id);
					break;
			}
			kick();
		}
	};
}
