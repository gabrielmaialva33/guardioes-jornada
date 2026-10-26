/** Native model routing and bounded canopy ownership for the moving chunk ring. */
import type { Box3 } from 'three';
import type { WindOptions } from '../../life/index.ts';
import { CanopyVisibility, type CanopyVolume } from '../../render/canopy-visibility.ts';
import type { PoolSet, Quality } from '../../render/index.ts';
import { FLAG, type Placements } from '../../survival/types.ts';
import { geometryRanges } from '../asset-plan.ts';
import type { createTreeImpostors } from '../tree-impostors.ts';
import { sampleWater } from './navigation.ts';
import { type PlacementFamily, type PlacementRoute, ringCapacity, ringSlots } from './slots.ts';
import { CHUNK_SIDE, type StreamChunk } from './types.ts';

export interface PlacementModel {
	family: string;
	kind: string;
	near: string;
	far?: string;
	bounds: Box3;
	scale: number;
	count: number;
	wind?: WindOptions;
	canopyBase?: number;
	trunkRadius: number;
}

export const STREAM_COVER_KINDS = [
	'bromelia',
	'bromelia-red',
	'understorey-taioba',
	'understorey-heliconia',
	'understorey-fern-a',
	'understorey-fern-b',
	'understorey-monstera-a',
	'understorey-bush',
	'understorey-flowers-ground-a',
	'understorey-flowers-ground-b',
	'ground-sand-foliage'
] as const;
export const STREAM_ROCK_KINDS = [
	'log',
	'ground-shore-rocks-a',
	'ground-shore-rocks-b',
	'ground-shore-rocks-c',
	'rock-polyone-01',
	'rock-polyone-02',
	'rock-polyone-06',
	'rock-polyone-03',
	'rock-polyone-04',
	'rock-polyone-11'
] as const;

/** Conservative measured-window capacities; no buffer growth on the render thread. */
export function modelCapacity(family: string, kind: string, radius: number): number {
	if (family === 'tree') return ringCapacity([`tree:${kind}`], radius);
	if (family === 'scenery') return ringSlots(radius) * 2;
	if (family === 'rock')
		return ringCapacity(
			kind === 'log'
				? ['rock:log']
				: kind.startsWith('ground-shore')
					? ['rock:stone', 'rock:boulder']
					: kind.endsWith('01') || kind.endsWith('02') || kind.endsWith('06')
						? ['rock:stone']
						: ['rock:boulder'],
			radius
		);
	const keys = kind.startsWith('bromelia')
		? ['bromelia']
		: kind === 'ground-sand-foliage'
			? ['beach-grass']
			: kind === 'understorey-bush'
				? ['bush']
				: kind.includes('flowers')
					? ['flower', 'grass']
					: kind.includes('taioba') || kind.includes('heliconia')
						? ['fern', 'bush', 'grass']
						: ['fern', 'grass'];
	return ringCapacity(
		keys.map((k) => `decoration:${k}`),
		radius
	);
}

/** Stable world-coordinate variation: crossing a chunk never changes an instance's species. */
export function placementKind(family: PlacementFamily, kind: string, chunk: StreamChunk, i: number): string {
	if (family === 'tree' || kind === 'log') return kind;
	const p = family === 'rock' ? chunk.rocks : chunk.decorations;
	const x = p.x[i],
		z = p.z[i];
	const variation = Math.abs((Math.round(x * 16) * 73856093) ^ (Math.round(z * 16) * 19349663)) % 3;
	if (kind === 'bromelia') return variation ? 'bromelia' : 'bromelia-red';
	if (kind === 'beach-grass') return 'ground-sand-foliage';
	const wet = sampleWater((cx, cz) => (cx === chunk.cx && cz === chunk.cz ? chunk : null), x, z);
	const ground =
		chunk.heights[
			Math.max(0, Math.min(40, Math.round(z - chunk.z0))) * CHUNK_SIDE +
				Math.max(0, Math.min(40, Math.round(x - chunk.x0)))
		];
	const nearWater = wet !== null && Math.abs(ground - wet) < 1.5;
	if (family === 'rock')
		return nearWater
			? STREAM_ROCK_KINDS[variation + 1]
			: STREAM_ROCK_KINDS[(kind === 'stone' ? 4 : 7) + variation];
	if (kind === 'flower') return variation ? 'understorey-flowers-ground-a' : 'understorey-flowers-ground-b';
	if (nearWater) return variation ? 'understorey-taioba' : 'understorey-heliconia';
	if (kind === 'bush') return 'understorey-bush';
	const cell =
		Math.max(0, Math.min(40, Math.round(z - chunk.z0))) * CHUNK_SIDE +
		Math.max(0, Math.min(40, Math.round(x - chunk.x0)));
	return kind === 'fern' || chunk.flags[cell] & FLAG.forest
		? ['understorey-fern-a', 'understorey-fern-b', 'understorey-monstera-a'][variation]
		: 'understorey-flowers-ground-a';
}

interface CrownChunk {
	volumes: CanopyVolume[];
	controller: CanopyVisibility | null;
}
/** Same public camera contract, but each chunk keeps its fade history until it actually leaves. */
export class StreamCanopies {
	readonly chunks = new Map<number, CrownChunk>();
	fading = 0;
	get volumes() {
		return [...this.chunks.values()].flatMap((c) => c.volumes);
	}
	occlusion = (
		head: Parameters<CanopyVisibility['occlusion']>[0],
		direction: Parameters<CanopyVisibility['occlusion']>[1],
		reach: number
	) => {
		let limit = reach;
		for (const chunk of this.chunks.values()) {
			chunk.controller ??= new CanopyVisibility(chunk.volumes);
			const hit = chunk.controller.occlusion(head, direction, reach);
			if (hit !== null) limit = Math.min(limit, hit);
		}
		return limit < reach ? limit : null;
	};
	update(
		camera: Parameters<CanopyVisibility['update']>[0],
		head: Parameters<CanopyVisibility['update']>[1],
		dt: number,
		reducedMotion = false
	) {
		this.fading = 0;
		for (const chunk of this.chunks.values()) {
			chunk.controller ??= new CanopyVisibility(chunk.volumes);
			chunk.controller.update(camera, head, dt, reducedMotion);
			this.fading += chunk.controller.fading;
		}
	}
}

type ObservedRoute = PlacementRoute & {
	scenery(kind: string, chunk: StreamChunk, i: number, out: Int32Array): number;
	added(
		family: PlacementFamily | 'scenery',
		kind: string,
		chunk: StreamChunk,
		i: number,
		pool: number,
		id: number
	): void;
	removed(chunk: StreamChunk): void;
};

export function createPlacementRoute(
	poolSet: PoolSet,
	models: readonly PlacementModel[],
	quality: Quality,
	options: {
		impostors?: ReturnType<typeof createTreeImpostors>;
		scenery?: Placements<string>;
	} = {}
) {
	const pools = [...poolSet.pools.values()],
		byModel = new Map<string, PlacementModel>();
	const indices = new Map<string, number>(),
		scale = new Float32Array(pools.length).fill(1);
	const canopies = new StreamCanopies();
	const crowns = new Map<
		number,
		Map<number, { near: number; far: number; impostor: number; volume: CanopyVolume | null }>
	>();
	const extras = new Map<number, [number, number][]>();
	for (let i = 0; i < pools.length; i++) indices.set(pools[i].name, i);
	for (const model of models) {
		byModel.set(`${model.family}:${model.kind}`, model);
		for (const name of model.far ? [model.near, model.far] : [model.near]) {
			const index = indices.get(name);
			if (index !== undefined) scale[index] = model.scale;
		}
	}
	const route: ObservedRoute = {
		pools,
		scenery(kind, _chunk, _i, out) {
			const model = byModel.get(`scenery:${kind === 'waterfall' ? 'ground-waterfall' : kind}`);
			const index = model ? indices.get(model.near) : undefined;
			if (index === undefined) return 0;
			out[0] = index;
			return 1;
		},
		route(family, kind, chunk, i, out) {
			const key = placementKind(family, kind, chunk, i);
			const model = byModel.get(`${family === 'decoration' ? 'cover' : family}:${key}`);
			if (!model) return 0;
			const near = indices.get(model.near),
				far = model.far ? indices.get(model.far) : undefined;
			if (near === undefined) return 0;
			out[0] = near;
			if (far !== undefined) {
				out[1] = far;
				return 2;
			}
			return 1;
		},
		scale(pool, kind) {
			// Small rocks must retain the old quarter-stud visual radius.
			return (
				scale[pool] * (kind === 'stone' ? 0.25 / (pools[pool].name.includes('ground-shore') ? 1.1 : 0.3) : 1)
			);
		},
		added(family, kind, chunk, i, pool, id) {
			if (family !== 'tree') return;
			const model = byModel.get(`tree:${kind}`);
			if (!model) return;
			let records = crowns.get(chunk.key);
			if (!records) {
				records = new Map();
				crowns.set(chunk.key, records);
				canopies.chunks.set(chunk.key, { volumes: [], controller: null });
			}
			if (model.far && pools[pool].name === model.far) {
				const record = records.get(i);
				if (record) record.far = id;
				return;
			}
			const p = chunk.trees,
				k = p.scale[i] * model.scale,
				b = model.bounds,
				bottom = model.canopyBase ?? b.min.y;
			const record = {
				near: id,
				far: -1,
				impostor: options.impostors?.add(kind, p.x[i], p.y[i], p.z[i], k) ?? -1,
				volume: null as CanopyVolume | null
			};
			const volume: CanopyVolume = {
				x: p.x[i] + ((b.min.x + b.max.x) * 0.5 * p.yawC[i] + (b.min.z + b.max.z) * 0.5 * p.yawS[i]) * k,
				z: p.z[i] + (-(b.min.x + b.max.x) * 0.5 * p.yawS[i] + (b.min.z + b.max.z) * 0.5 * p.yawC[i]) * k,
				y: p.y[i] + (bottom + b.max.y) * 0.5 * k,
				rx: Math.max(b.max.x - b.min.x, b.max.z - b.min.z) * 0.5 * k,
				rz: Math.max(b.max.x - b.min.x, b.max.z - b.min.z) * 0.5 * k,
				ry: Math.max(0.3, (b.max.y - bottom) * 0.5 * k),
				id,
				trunk: {
					x: p.x[i],
					z: p.z[i],
					bottom: p.y[i] + b.min.y * k,
					top: p.y[i] + bottom * k,
					radius: model.trunkRadius * k + 0.1
				},
				setFade: (_id, opacity) => {
					const near = pools[pool].setFade(record.near, opacity);
					const farIndex = model.far ? indices.get(model.far) : undefined;
					return farIndex === undefined || record.far < 0
						? near
						: pools[farIndex].setFade(record.far, opacity);
				}
			};
			record.volume = volume;
			records.set(i, record);
			canopies.chunks.get(chunk.key)?.volumes.push(volume);
		},
		removed(chunk) {
			const records = crowns.get(chunk.key);
			if (records && options.impostors)
				for (const r of records.values()) options.impostors.remove(r.impostor);
			for (const [pool, id] of extras.get(chunk.key) ?? []) pools[pool].remove(id);
			extras.delete(chunk.key);
			crowns.delete(chunk.key);
			canopies.chunks.delete(chunk.key);
		}
	};
	const setQuality = (q: Quality) => {
		for (const model of models) {
			const ranges = geometryRanges(q, model.family);
			poolSet.get(model.near).distanceBand = { min: 0, max: model.far ? ranges.near : ranges.far };
			if (model.far) poolSet.get(model.far).distanceBand = { min: ranges.near, max: ranges.far };
		}
	};
	setQuality(quality);
	return {
		route,
		canopies,
		setQuality(q: Quality) {
			setQuality(q);
			options.impostors?.setQuality(q);
		},
		mountScenery(chunk: StreamChunk) {
			if (!options.scenery || chunk.zone !== 'reserva' || extras.has(chunk.key)) return;
			const ids: [number, number][] = [],
				p = options.scenery;
			for (let i = 0; i < p.count; i++) {
				const kind = p.kinds[p.kind[i]];
				if (
					kind === 'ground-waterfall' ||
					p.x[i] < chunk.x0 ||
					p.x[i] >= chunk.x0 + 40 ||
					p.z[i] < chunk.z0 ||
					p.z[i] >= chunk.z0 + 40
				)
					continue;
				const model = byModel.get(`scenery:${kind}`),
					index = model ? indices.get(model.near) : undefined;
				if (index === undefined) continue;
				const id = pools[index].addPlaced(p.x[i], p.y[i], p.z[i], p.yawC[i], p.yawS[i], p.scale[i]);
				if (id >= 0) ids.push([index, id]);
			}
			extras.set(chunk.key, ids);
		},
		dispose() {
			for (const records of crowns.values())
				for (const r of records.values()) options.impostors?.remove(r.impostor);
			for (const ids of extras.values()) for (const [pool, id] of ids) pools[pool].remove(id);
			extras.clear();
			crowns.clear();
			canopies.chunks.clear();
		}
	};
}
