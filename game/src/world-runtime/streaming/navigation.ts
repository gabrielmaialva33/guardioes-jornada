/** Allocation-free field queries used by checkpoints, the avatar and wayfinding. */
import type { Light } from '../../animation/animals/index.ts';
import { ZONE } from '../../survival/types.ts';
import { CHUNK_SIDE, CHUNK_SIZE } from './types.ts';
import type { ChunkLookup } from './window.ts';
import { zoneParam } from './zone-loader.ts';

export function streamSelection(search: string) {
	const query = new URLSearchParams(search);
	return { enabled: !query.has('graybox') && query.get('world') !== 'survival', zone: zoneParam(query) };
}

/** A 24-minute local simulation cycle; frozen captures may choose a phase explicitly. */
export function lightAt(seconds: number, override?: string | null): Light {
	if (override === 'day' || override === 'dusk' || override === 'night') return override;
	const phase = ((seconds % 1440) + 1440) % 1440;
	return phase < 960 ? 'day' : phase < 1080 ? 'dusk' : 'night';
}

export function sampleHeight(lookup: ChunkLookup, x: number, z: number): number | null {
	const chunk = lookup(Math.floor(x / CHUNK_SIZE), Math.floor(z / CHUNK_SIZE));
	if (!chunk) return null;
	const lx = x - chunk.x0,
		lz = z - chunk.z0,
		ix = Math.floor(lx),
		iz = Math.floor(lz);
	const fx = lx - ix,
		fz = lz - iz,
		i = iz * CHUNK_SIDE + ix,
		h = chunk.heights;
	return (
		(h[i] * (1 - fx) + h[i + 1] * fx) * (1 - fz) +
		(h[i + CHUNK_SIDE] * (1 - fx) + h[i + CHUNK_SIDE + 1] * fx) * fz
	);
}

export function sampleWater(lookup: ChunkLookup, x: number, z: number): number | null {
	const chunk = lookup(Math.floor(x / CHUNK_SIZE), Math.floor(z / CHUNK_SIZE));
	if (!chunk) return null;
	const basins = chunk.basins;
	if (basins)
		for (let i = 0; i < basins.length; i += 7) {
			const dx = basins[i + 3] - basins[i + 1],
				dz = basins[i + 4] - basins[i + 2];
			const t = Math.max(
				0,
				Math.min(1, ((x - basins[i + 1]) * dx + (z - basins[i + 2]) * dz) / (dx * dx + dz * dz || 1))
			);
			const px = x - basins[i + 1] - t * dx,
				pz = z - basins[i + 2] - t * dz;
			if (px * px + pz * pz <= basins[i + 5] * basins[i + 5]) return basins[i + 6];
		}
	const story = chunk.story,
		pool = story?.level.pool;
	if (story && pool && pool.halfLength > 0) {
		const dx = x - pool.x - story.offsetX,
			dz = z - pool.z - story.offsetZ;
		const a = (dx * pool.axisX + dz * pool.axisZ) / pool.halfLength;
		const b = (-dx * pool.axisZ + dz * pool.axisX) / pool.halfWidth;
		if (a * a + b * b <= 1) return pool.water;
	}
	let nearest = Infinity,
		height: number | null = null;
	for (let i = 0; i < chunk.rivers.length; i += 8) {
		const r = chunk.rivers,
			dx = r[i + 3] - r[i],
			dz = r[i + 4] - r[i + 1];
		const t = Math.max(0, Math.min(1, ((x - r[i]) * dx + (z - r[i + 1]) * dz) / (dx * dx + dz * dz || 1)));
		const xx = x - r[i] - t * dx,
			zz = z - r[i + 1] - t * dz,
			distance = xx * xx + zz * zz;
		if (distance < nearest && distance <= r[i + 6] * r[i + 6]) {
			nearest = distance;
			height = r[i + 2] + (r[i + 5] - r[i + 2]) * t;
		}
	}
	if (height !== null) return height;
	const index = Math.round(z - chunk.z0) * CHUNK_SIDE + Math.round(x - chunk.x0);
	return chunk.zones[index] === ZONE.sea && chunk.heights[index] < chunk.waterLevel ? chunk.waterLevel : null;
}
