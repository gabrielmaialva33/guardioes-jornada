import { BufferGeometry, Color, Float32BufferAttribute } from 'three';
import { BLOCK_SIZE, type SurvivalWorld } from '../survival/types.ts';
import { smooth, terrainColor } from './terrain.ts';

/** Non-playable continuation, split in 40 u edge segments for ordinary frustum culling. */
export function boundaryTerrain(world: SurvivalWorld): BufferGeometry[] {
	const chunks: BufferGeometry[] = [];
	const rings = [0, 4, 12, 28, 60, 108, 160];
	const half = world.size / 2;
	for (let side = 0; side < 4; side++)
		for (let offset = 0; offset < world.size; offset += BLOCK_SIZE) {
			const count = Math.min(BLOCK_SIZE, world.size - offset) + 1,
				positions: number[] = [],
				colors: number[] = [],
				indices: number[] = [];
			for (const distance of rings)
				for (let i = 0; i < count; i++) {
					const t = offset + i;
					const x = side === 0 ? t : side === 1 ? world.size : side === 2 ? world.size - t : 0;
					const z = side === 0 ? 0 : side === 1 ? t : side === 2 ? world.size : world.size - t;
					const expansion = 1 + distance / half;
					const outerX = half + (x - half) * expansion,
						coast = smooth(0, 36, -outerX);
					const raised = world.heights[z * world.grid + x] + 18 * (distance / 160) ** 1.4;
					const y = raised * (1 - coast) + world.waterLevel * coast;
					positions.push(half + (x - half) * expansion, y, half + (z - half) * expansion);
					const c = new Color(terrainColor(world, x, z)).lerp(new Color('#73cbf0'), coast * 0.85);
					colors.push(c.r, c.g, c.b);
				}
			for (let r = 0; r < rings.length - 1; r++)
				for (let i = 0; i < count - 1; i++) {
					const a = r * count + i,
						b = a + 1,
						c = a + count,
						d = c + 1;
					indices.push(a, b, c, b, d, c);
				}
			const geometry = new BufferGeometry();
			geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
			geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
			geometry.setIndex(indices);
			geometry.computeVertexNormals();
			geometry.computeBoundingSphere();
			chunks.push(geometry);
		}
	return chunks;
}
