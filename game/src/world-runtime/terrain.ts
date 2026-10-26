import { BufferGeometry, Color, Float32BufferAttribute } from 'three';
import type { Pool, Trail } from '../level/types.ts';
import { visualStep } from '../render/stylized.ts';
import { RAMPS } from '../style/palette.ts';
import { BLOCK_SIZE, type CollisionBlock, FLAG, type SurvivalWorld, ZONE } from '../survival/types.ts';
import { waterField } from './shore.ts';

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
const groundWarm = new Color('#94ac52'),
	groundCool = new Color('#438573'),
	groundDry = new Color('#a6a660'),
	groundLitter = new Color('#79583f');
const clamp = (v: number, a = 0, b = 1) => Math.max(a, Math.min(b, v));
export const smooth = (a: number, b: number, v: number) => {
	const t = clamp((v - a) / (b - a));
	return t * t * (3 - 2 * t);
};
const colors = Object.fromEntries(
	Object.entries(RAMPS).map(([k, v]) => [k, v.map((hex) => new Color(hex))])
) as Record<keyof typeof RAMPS, Color[]>;
function bilinear(world: SurvivalWorld, x: number, z: number, read: (i: number) => number): number {
	x = clamp(x, 0, world.size);
	z = clamp(z, 0, world.size);
	const ix = Math.floor(x),
		iz = Math.floor(z),
		fx = x - ix,
		fz = z - iz;
	const a = read(iz * world.grid + ix),
		b = read(iz * world.grid + Math.min(world.size, ix + 1));
	const c = read(Math.min(world.size, iz + 1) * world.grid + ix),
		d = read(Math.min(world.size, iz + 1) * world.grid + Math.min(world.size, ix + 1));
	return (a + (b - a) * fx) * (1 - fz) + (c + (d - c) * fx) * fz;
}
const hash = (x: number, z: number) => {
	const a = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
	return a - Math.floor(a);
};
function noise(x: number, z: number) {
	const ix = Math.floor(x),
		iz = Math.floor(z),
		fx = smooth(0, 1, x - ix),
		fz = smooth(0, 1, z - iz);
	return (
		(hash(ix, iz) * (1 - fx) + hash(ix + 1, iz) * fx) * (1 - fz) +
		(hash(ix, iz + 1) * (1 - fx) + hash(ix + 1, iz + 1) * fx) * fz
	);
}
/** Continuous fields use world-space samples, including normals: chunk edges are bit-identical. */
export function terrainTint(
	world: SurvivalWorld,
	x: number,
	z: number,
	trails: readonly Pick<Trail, 'points' | 'halfWidth'>[] = [],
	out = new Color()
): Color {
	let forest = 0,
		cleared = 0,
		wet = 0,
		weight = 0;
	for (let dz = -2; dz <= 2; dz++)
		for (let dx = -2; dx <= 2; dx++) {
			const w = (3 - Math.abs(dx)) * (3 - Math.abs(dz));
			weight += w;
			forest += w * bilinear(world, x + dx, z + dz, (i) => +!!(world.flags[i] & FLAG.forest));
			cleared +=
				w * bilinear(world, x + dx, z + dz, (i) => +!!(world.flags[i] & (FLAG.cleared | FLAG.corridor)));
			wet += w * bilinear(world, x + dx, z + dz, (i) => +!!(world.flags[i] & FLAG.river));
		}
	const macro = noise(x / 50 + 13, z / 50 + 13),
		meso = noise(x / 8 + 71, z / 8 + 71),
		shade = 1 - (forest / weight) * 0.6;
	out
		.copy(groundWarm)
		.lerp(groundCool, smooth(0.22, 0.78, macro))
		.lerp(groundDry, smooth(0.5, 0.85, meso) * 0.65 * shade)
		.lerp(groundLitter, smooth(0.35, 0.7, meso) * (1 - shade) * 0.85);
	out.lerp(colors.grass[3], (cleared / weight) * 0.12);
	const h = (xx: number, zz: number) => bilinear(world, xx, zz, (i) => world.heights[i]);
	const y = h(x, z),
		slope = Math.hypot((h(x + 1, z) - h(x - 1, z)) * 0.5, (h(x, z + 1) - h(x, z - 1)) * 0.5);
	out.lerp(colors.grass[3], smooth(10, 20, y) * 0.15);
	out.lerp(colors.soil[1], (wet / weight) * 0.8);
	const beach = bilinear(world, x, z, (i) => +(world.zones[i] === ZONE.beach || world.zones[i] === ZONE.sea));
	out.lerp(colors.soil[3], beach * 0.85);
	let path = 0;
	for (const trail of trails)
		for (let i = 1; i < trail.points.length; i++) {
			const a = trail.points[i - 1],
				b = trail.points[i];
			path = Math.max(
				path,
				1 -
					smooth(trail.halfWidth - 0.3, trail.halfWidth + 0.3, segmentDistance(x, z, a[0], a[1], b[0], b[1]))
			);
		}
	path = Math.max(
		path,
		bilinear(world, x, z, (i) => +!!(world.flags[i] & FLAG.base))
	);
	out.lerp(colors.soil[2], path);
	out.lerp(colors.rock[2], smooth(0.4, 1.05, slope));
	return out.multiplyScalar(0.95 + 0.07 * noise(x * 0.13, z * 0.13) + 0.03 * noise(x * 0.37, z * 0.37));
}
/** Shore distance is measured to the ribbon edge, with a per-vertex water height for sloping rivers. */
export function shoreAt(world: SurvivalWorld, x: number, z: number, pool?: Pool): [number, number] {
	const field = waterField(world, pool, x, z);
	return [field.height, field.distance];
}
export function terrainChunk(
	world: SurvivalWorld,
	block: Pick<CollisionBlock, 'x0' | 'z0'>,
	trails: readonly Trail[] = [],
	pool?: Parameters<typeof shoreAt>[3]
): BufferGeometry {
	const side = BLOCK_SIZE + 1,
		positions: number[] = [],
		colorsOut: number[] = [],
		normals: number[] = [],
		shore: number[] = [],
		indices: number[] = [];
	const c = new Color(),
		continuous = visualStep() >= 2;
	for (let z = 0; z < side; z++)
		for (let x = 0; x < side; x++) {
			const px = block.x0 + x,
				pz = block.z0 + z,
				i = pz * world.grid + px;
			positions.push(px, world.heights[i], pz);
			if (continuous) terrainTint(world, px, pz, [], c);
			else c.set(terrainColor(world, px, pz, trails));
			colorsOut.push(c.r, c.g, c.b);
			const dx =
				world.heights[pz * world.grid + Math.min(world.size, px + 1)] -
				world.heights[pz * world.grid + Math.max(0, px - 1)];
			const dz =
				world.heights[Math.min(world.size, pz + 1) * world.grid + px] -
				world.heights[Math.max(0, pz - 1) * world.grid + px];
			const n = Math.hypot(dx, 2, dz);
			normals.push(-dx / n, 2 / n, -dz / n);
			shore.push(...shoreAt(world, px, pz, pool));
		}
	for (let z = 0; z < BLOCK_SIZE; z++)
		for (let x = 0; x < BLOCK_SIZE; x++) {
			const i = z * side + x;
			indices.push(i, i + side, i + 1, i + 1, i + side, i + side + 1);
		}
	const g = new BufferGeometry();
	g.setAttribute('position', new Float32BufferAttribute(positions, 3));
	g.setAttribute('color', new Float32BufferAttribute(colorsOut, 3));
	g.setAttribute('normal', new Float32BufferAttribute(normals, 3));
	g.setAttribute('shore', new Float32BufferAttribute(shore, 2));
	g.setIndex(indices);
	g.computeBoundingSphere();
	return g;
}
