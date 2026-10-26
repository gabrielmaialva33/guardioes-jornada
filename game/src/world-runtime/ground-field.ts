import { DataTexture, LinearFilter, RedFormat } from 'three';
import type { Trail } from '../level/types.ts';
import type { SurvivalWorld } from '../survival/types.ts';
import { segmentDistance } from './terrain.ts';
/** 1.25u texels encode a signed path-edge distance [-2,6]u; the ribbon keeps its exact collision-aligned mesh. */
export function bakeGroundField(world: SurvivalWorld, trails: readonly Trail[]) {
	const side = 128,
		pixels = new Uint8Array(side * side);
	for (let z = 0; z < side; z++)
		for (let x = 0; x < side; x++) {
			const px = ((x + 0.5) / side) * world.size,
				pz = ((z + 0.5) / side) * world.size;
			let distance = 6;
			for (const trail of trails)
				for (let i = 1; i < trail.points.length; i++) {
					const a = trail.points[i - 1],
						b = trail.points[i];
					distance = Math.min(distance, segmentDistance(px, pz, a[0], a[1], b[0], b[1]) - trail.halfWidth);
				}
			pixels[z * side + x] = Math.round(Math.max(0, Math.min(1, (distance + 2) / 8)) * 255);
		}
	const texture = new DataTexture(pixels, side, side, RedFormat);
	texture.magFilter = texture.minFilter = LinearFilter;
	texture.generateMipmaps = false;
	texture.unpackAlignment = 1;
	texture.needsUpdate = true;
	let disposed = false;
	return {
		texture,
		pixels,
		sample(x: number, z: number) {
			if (x < 0 || z < 0 || x > world.size || z > world.size) return 6;
			const ix = Math.min(side - 1, Math.floor((x / world.size) * side)),
				iz = Math.min(side - 1, Math.floor((z / world.size) * side));
			return (pixels[iz * side + ix] / 255) * 8 - 2;
		},
		dispose() {
			if (disposed) return;
			disposed = true;
			texture.dispose();
		}
	};
}
