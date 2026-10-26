/**
 * Vertex colour of streamed terrain. `TerrainTint` is the plug: the default,
 * `windowTint`, is terrain.ts terrainTint (its continuous path, as of P34)
 * read from a FieldWindow in world coordinates instead of one SurvivalWorld,
 * so it needs no world edge and its noise lines up across every chunk. At
 * integer vertices terrainTint's bilinear reads collapse to single samples,
 * which is all this reads: on the Reserva's interior the two agree bit for bit
 * (checked when P34 landed). When terrain.ts's tint changes, point the builder
 * at the new one (host.ts StreamHostOptions.tint).
 */
import { Color } from 'three';
import { RAMPS } from '../../style/palette.ts';
import { FLAG, ZONE } from '../../survival/types.ts';
import { type FieldWindow, WINDOW_SIDE } from './window.ts';

/** Writes the colour of vertex (x, z), world coordinates (integers), into `out`. */
export type TerrainTint = (window: FieldWindow, x: number, z: number, out: Color) => void;

const groundWarm = new Color('#94ac52');
const groundCool = new Color('#438573');
const groundDry = new Color('#a6a660');
const groundLitter = new Color('#79583f');
const grass3 = new Color(RAMPS.grass[3]);
const soil1 = new Color(RAMPS.soil[1]);
const soil2 = new Color(RAMPS.soil[2]);
const soil3 = new Color(RAMPS.soil[3]);
const rock2 = new Color(RAMPS.rock[2]);

const clamp = (v: number, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const smooth = (a: number, b: number, v: number) => {
	const t = clamp((v - a) / (b - a));
	return t * t * (3 - 2 * t);
};
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

/** terrainTint over a window: (x, z) must be a vertex of the window's chunk. */
export const windowTint: TerrainTint = (win, x, z, out) => {
	const ci = x - win.x0;
	const cj = z - win.z0;
	const flags = win.flags;
	let forest = 0,
		cleared = 0,
		wet = 0,
		weight = 0;
	for (let dz = -2; dz <= 2; dz++)
		for (let dx = -2; dx <= 2; dx++) {
			const w = (3 - Math.abs(dx)) * (3 - Math.abs(dz));
			const f = flags[(cj + dz) * WINDOW_SIDE + ci + dx];
			weight += w;
			forest += w * +!!(f & FLAG.forest);
			cleared += w * +!!(f & (FLAG.cleared | FLAG.corridor));
			wet += w * +!!(f & FLAG.river);
		}
	const macro = noise(x / 50 + 13, z / 50 + 13),
		meso = noise(x / 8 + 71, z / 8 + 71),
		shade = 1 - (forest / weight) * 0.6;
	out
		.copy(groundWarm)
		.lerp(groundCool, smooth(0.22, 0.78, macro))
		.lerp(groundDry, smooth(0.5, 0.85, meso) * 0.65 * shade)
		.lerp(groundLitter, smooth(0.35, 0.7, meso) * (1 - shade) * 0.85);
	out.lerp(grass3, (cleared / weight) * 0.12);
	const h = win.heights;
	const c = cj * WINDOW_SIDE + ci;
	const y = h[c],
		slope = Math.hypot((h[c + 1] - h[c - 1]) * 0.5, (h[c + WINDOW_SIDE] - h[c - WINDOW_SIDE]) * 0.5);
	out.lerp(grass3, smooth(10, 20, y) * 0.15);
	out.lerp(soil1, (wet / weight) * 0.8);
	const zone = win.zones[c];
	const beach = +(zone === ZONE.beach || zone === ZONE.sea);
	out.lerp(soil3, beach * 0.85);
	const path = +!!(flags[c] & FLAG.base);
	out.lerp(soil2, path);
	out.lerp(rock2, smooth(0.4, 1.05, slope));
	out.multiplyScalar(0.95 + 0.07 * noise(x * 0.13, z * 0.13) + 0.03 * noise(x * 0.37, z * 0.37));
};
