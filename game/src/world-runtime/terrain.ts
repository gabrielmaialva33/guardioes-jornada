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
const palette = new Map<string, Color>();
function cachedColor(hex: string): Color {
	let value = palette.get(hex);
	if (!value) {
		value = new Color(hex);
		palette.set(hex, value);
	}
	return value;
}
/** Bank-only colour blending; heights/physics and authored cliffs remain unchanged. */
function vertexColor(
	world: SurvivalWorld,
	x: number,
	z: number,
	colorAt: (x: number, z: number) => Color,
	out: Color
): Color {
	const index = z * world.grid + x;
	const base = colorAt(x, z);
	// Keep trail and camp footprints readable; blend the wet soil/vegetation seam only.
	if (base === cachedColor(RAMPS.soil[2]) || world.flags[index] & FLAG.base) return out.copy(base);
	let wet = false,
		dry = false,
		total = 0;
	out.setRGB(0, 0, 0);
	for (let dz = -1; dz <= 1; dz++)
		for (let dx = -1; dx <= 1; dx++) {
			const px = Math.min(world.size, Math.max(0, x + dx)),
				pz = Math.min(world.size, Math.max(0, z + dz)),
				i = pz * world.grid + px;
			if (Math.abs(world.heights[i] - world.heights[index]) > 1.2) continue;
			if (world.flags[i] & FLAG.river) wet = true;
			else dry = true;
			const weight = (dx === 0 ? 2 : 1) * (dz === 0 ? 2 : 1);
			const c = colorAt(px, pz);
			out.r += c.r * weight;
			out.g += c.g * weight;
			out.b += c.b * weight;
			total += weight;
		}
	return wet && dry ? out.multiplyScalar(1 / total) : out.copy(base);
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
	const rawColors = new Map<number, Color>();
	const colorAt = (x: number, z: number) => {
		const index = z * world.grid + x;
		let value = rawColors.get(index);
		if (!value) {
			value = cachedColor(terrainColor(world, x, z, trails));
			rawColors.set(index, value);
		}
		return value;
	};
	const side = BLOCK_SIZE + 1,
		vertexColors = new Float32Array(side * side * 3);
	for (let z = 0; z < side; z++)
		for (let x = 0; x < side; x++) {
			vertexColor(world, block.x0 + x, block.z0 + z, colorAt, color);
			color.toArray(vertexColors, (z * side + x) * 3);
		}

	for (let z = block.z0; z < Math.min(block.z0 + BLOCK_SIZE, world.size); z++)
		for (let x = block.x0; x < Math.min(block.x0 + BLOCK_SIZE, world.size); x++) {
			for (const [px, pz] of [
				[x, z],
				[x, z + 1],
				[x + 1, z],
				[x + 1, z],
				[x, z + 1],
				[x + 1, z + 1]
			]) {
				positions.push(px, world.heights[pz * world.grid + px], pz);
				const i = ((pz - block.z0) * side + px - block.x0) * 3;
				colors.push(vertexColors[i], vertexColors[i + 1], vertexColors[i + 2]);
			}
		}
	const g = new BufferGeometry();
	g.setAttribute('position', new Float32BufferAttribute(positions, 3));
	g.setAttribute('color', new Float32BufferAttribute(colors, 3));
	g.computeVertexNormals();
	g.computeBoundingSphere();
	return g;
}
