import { BufferGeometry, Color, Float32BufferAttribute } from 'three';
import type { Trail } from '../level/types.ts';
import { RAMPS } from '../style/palette.ts';
import { BLOCK_SIZE, type CollisionBlock, FLAG, type SurvivalWorld, ZONE } from '../survival/types.ts';

export function segmentDistance(x: number, z: number, ax: number, az: number, bx: number, bz: number) {
	const dx = bx - ax,
		dz = bz - az;
	const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1)));
	return Math.hypot(x - ax - dx * t, z - az - dz * t);
}
export function terrainColor(
	world: SurvivalWorld,
	x: number,
	z: number,
	trails: readonly Pick<Trail, 'points' | 'halfWidth'>[] = []
): string {
	const i = Math.round(z) * world.grid + Math.round(x),
		f = world.flags[i],
		zone = world.zones[i];
	for (const trail of trails)
		for (let p = 1; p < trail.points.length; p++) {
			const a = trail.points[p - 1],
				b = trail.points[p];
			if (segmentDistance(x, z, a[0], a[1], b[0], b[1]) <= trail.halfWidth) return RAMPS.soil[2];
		}
	if (f & FLAG.base) return RAMPS.soil[3];
	if (f & FLAG.river || zone === ZONE.river) return RAMPS.soil[1];
	if (zone === ZONE.sea || zone === ZONE.beach) return RAMPS.soil[3];
	if (f & (FLAG.cleared | FLAG.corridor)) return RAMPS.grass[3];
	if (f & FLAG.forest) return RAMPS.grass[1];
	if (zone === ZONE.highland) return RAMPS.rock[2];
	return RAMPS.grass[2];
}
/** Six independent vertices per cell: flat normals and no seams at chunk boundaries. */
export function terrainChunk(
	world: SurvivalWorld,
	block: Pick<CollisionBlock, 'x0' | 'z0'>,
	trails: readonly Trail[] = []
): BufferGeometry {
	const positions: number[] = [],
		colors: number[] = [];
	const color = new Color();
	for (let z = block.z0; z < Math.min(block.z0 + BLOCK_SIZE, world.size); z++)
		for (let x = block.x0; x < Math.min(block.x0 + BLOCK_SIZE, world.size); x++) {
			color.set(terrainColor(world, x, z, trails));
			for (const [px, pz] of [
				[x, z],
				[x, z + 1],
				[x + 1, z],
				[x + 1, z],
				[x, z + 1],
				[x + 1, z + 1]
			]) {
				positions.push(px, world.heights[pz * world.grid + px], pz);
				colors.push(color.r, color.g, color.b);
			}
		}
	const g = new BufferGeometry();
	g.setAttribute('position', new Float32BufferAttribute(positions, 3));
	g.setAttribute('color', new Float32BufferAttribute(colors, 3));
	g.computeVertexNormals();
	g.computeBoundingSphere();
	return g;
}
