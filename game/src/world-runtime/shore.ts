import { BufferGeometry, Color, Float32BufferAttribute } from 'three';
import type { Pool } from '../level/types.ts';
import { RAMPS } from '../style/palette.ts';
import type { SurvivalWorld } from '../survival/types.ts';
import { poolShoreScale, terrainHeight } from './paths.ts';

export interface WaterField {
	height: number;
	distance: number;
	depth: number;
}
const clamp = (v: number) => Math.max(0, Math.min(1, v));
/** The union, not two overlapping outlines: negative means inside either body of water. */
export function waterField(
	world: SurvivalWorld,
	pool: Pool | undefined,
	x: number,
	z: number,
	out: WaterField = { height: 0, distance: 0, depth: 0 }
) {
	let distance = Infinity,
		height = world.waterLevel;
	for (let i = 1; i < world.river.points.length; i++) {
		const a = world.river.points[i - 1],
			b = world.river.points[i],
			dx = b.x - a.x,
			dz = b.z - a.z,
			t = clamp(((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz || 1)),
			px = x - a.x - t * dx,
			pz = z - a.z - t * dz;
		const d = Math.sqrt(px * px + pz * pz) - world.river.halfWidth;
		if (d < distance) {
			distance = d;
			height = a.water + (b.water - a.water) * t;
		}
	}
	if (pool) {
		const dx = x - pool.x,
			dz = z - pool.z,
			a = (dx * pool.axisX + dz * pool.axisZ) / pool.halfLength,
			b = (-dx * pool.axisZ + dz * pool.axisX) / pool.halfWidth;
		const d =
			(Math.sqrt(a * a + b * b) - poolShoreScale(Math.atan2(b, a))) *
			Math.min(pool.halfLength, pool.halfWidth);
		const t = clamp((distance - d + 1) * 0.5),
			blend = t * t * (3 - 2 * t);
		height += (pool.water - height) * blend;
		distance = Math.min(distance, d);
	}
	out.height = height;
	out.distance = distance;
	out.depth = Math.max(0, height - terrainHeight(world, x, z));
	return out;
}
/** A 1u shared grid gives the fragment shader continuous shores, including the pool/river junction. */
export function waterSurface(world: SurvivalWorld, pool?: Pool) {
	const n = world.grid,
		fields = new Float32Array(n * n * 3),
		sample = { height: 0, distance: 0, depth: 0 };
	for (let z = 0; z < n; z++)
		for (let x = 0; x < n; x++) {
			waterField(world, pool, x, z, sample);
			const i = (z * n + x) * 3;
			fields[i] = sample.height;
			fields[i + 1] = sample.distance;
			fields[i + 2] = sample.depth;
		}
	const positions: number[] = [],
		colors: number[] = [],
		water: number[] = [],
		indices: number[] = [],
		ids = new Int32Array(n * n).fill(-1),
		color = new Color(),
		deep = new Color(RAMPS.water[0]),
		shallow = new Color(RAMPS.water[2]);
	const vertex = (x: number, z: number) => {
		const key = z * n + x;
		if (ids[key] >= 0) return ids[key];
		const i = key * 3,
			id = positions.length / 3;
		positions.push(x, fields[i] + 0.005, z);
		water.push(fields[i + 1], fields[i + 2]);
		const t = clamp((fields[i + 2] - 0.1) / 1.4);
		color.copy(shallow).lerp(deep, t * t * (3 - 2 * t));
		colors.push(color.r, color.g, color.b);
		ids[key] = id;
		return id;
	};
	for (let z = 0; z < n - 1; z++)
		for (let x = 0; x < n - 1; x++) {
			const i = (z * n + x) * 3;
			if (Math.min(fields[i + 1], fields[i + 4], fields[i + n * 3 + 1], fields[i + n * 3 + 4]) > 0.6)
				continue;
			const a = vertex(x, z),
				b = vertex(x + 1, z),
				c = vertex(x, z + 1),
				d = vertex(x + 1, z + 1);
			indices.push(a, c, b, b, c, d);
		}
	const g = new BufferGeometry();
	g.setAttribute('position', new Float32BufferAttribute(positions, 3));
	g.setAttribute('color', new Float32BufferAttribute(colors, 3));
	g.setAttribute('water', new Float32BufferAttribute(water, 2));
	g.setIndex(indices);
	g.computeVertexNormals();
	g.computeBoundingSphere();
	return g;
}
