import { DataTexture, LinearFilter, RedFormat, UnsignedByteType } from 'three';
import type { SurvivalWorld } from '../survival/types.ts';
/** Ground projection of the 45° sun at azimuth 180°. A tree's crown is distinct from trunk contact AO. */
export function bakeCanopy(world: SurvivalWorld) {
	const side = Math.min(320, world.size * 2),
		scale = side / world.size;
	const shade = new Float32Array(side * side).fill(1);
	const stamp = (cx: number, cz: number, radius: number, strength: number) => {
		const r = radius * scale,
			x = cx * scale,
			z = cz * scale;
		for (let iz = Math.max(0, Math.floor(z - r)); iz <= Math.min(side - 1, Math.ceil(z + r)); iz++)
			for (let ix = Math.max(0, Math.floor(x - r)); ix <= Math.min(side - 1, Math.ceil(x + r)); ix++) {
				const d = Math.hypot(ix - x, iz - z) / r;
				if (d < 1) shade[iz * side + ix] *= 1 - strength * (1 - d * d) ** 2;
			}
	};
	const crown: Record<string, [number, number]> = {
		jequitiba: [4.7, 12],
		araucaria: [4.0, 10],
		embauba: [3, 7],
		jucara: [2.5, 6],
		jeriva: [3, 8],
		xaxim: [2.0, 4],
		'pau-brasil': [3.4, 8],
		'mangue-vermelho': [3, 6],
		'ipe-amarelo': [3.4, 8],
		'ipe-rosa': [3.4, 8]
	};
	const trees = world.trees;
	for (let i = 0; i < trees.count; i++) {
		const [radius, height] = crown[trees.kinds[trees.kind[i]]] ?? [3, 7],
			k = trees.scale[i];
		stamp(trees.x[i], trees.z[i] + height * k, radius * k, 0.55);
		stamp(trees.x[i], trees.z[i], 0.85 * k, 0.26);
	}
	for (let i = 0; i < world.rocks.count; i++)
		stamp(world.rocks.x[i], world.rocks.z[i], 0.8 * world.rocks.scale[i], 0.18);
	const pixels = new Uint8Array(side * side);
	// Separable-looking 3x3 tent blur, performed once; never read back from the GPU.
	for (let z = 0; z < side; z++)
		for (let x = 0; x < side; x++) {
			let sum = 0,
				weights = 0;
			for (let dz = -1; dz <= 1; dz++)
				for (let dx = -1; dx <= 1; dx++) {
					const w = (dx === 0 ? 2 : 1) * (dz === 0 ? 2 : 1);
					weights += w;
					sum +=
						w *
						shade[Math.max(0, Math.min(side - 1, z + dz)) * side + Math.max(0, Math.min(side - 1, x + dx))];
				}
			pixels[z * side + x] = Math.round(Math.max(0.12, sum / weights) * 255);
		}
	const texture = new DataTexture(pixels, side, side, RedFormat, UnsignedByteType);
	texture.magFilter = texture.minFilter = LinearFilter;
	texture.generateMipmaps = false;
	texture.unpackAlignment = 1;
	texture.needsUpdate = true;
	let disposed = false;
	return {
		texture,
		pixels,
		bytes: pixels.byteLength,
		sample(x: number, z: number) {
			if (x < 0 || z < 0 || x >= world.size || z >= world.size) return 1;
			return (
				pixels[Math.min(side - 1, Math.floor(z * scale)) * side + Math.min(side - 1, Math.floor(x * scale))] /
				255
			);
		},
		dispose() {
			if (!disposed) {
				disposed = true;
				texture.dispose();
			}
		}
	};
}
