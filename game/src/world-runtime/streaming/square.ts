/**
 * A zone wider than deep (Praia, Manguezal: 200 × 160) as the square world the
 * whole-map helpers assume (terrain.ts, paths.ts, buildMapCollision clamp both
 * axes to world.size). Pure and three-free: zone-loader.ts hands it to Root,
 * trails.ts to paths.ts pathRibbon in the Worker.
 */
import { collisionBlocks, type ZoneBuild } from '../../level/zones/zone.ts';
import type { SurvivalWorld } from '../../survival/types.ts';
import { CHUNK_SIZE } from './types.ts';

/** Pads a zone wider than deep to a square world (rows past `depth` repeat the last one). */
export function squareWorld(build: ZoneBuild): SurvivalWorld {
	const { world, width, depth } = build;
	const side = width + 1;
	const n = side * side;
	const heights = new Float32Array(n);
	const zones = new Uint8Array(n);
	const flags = new Uint8Array(n);
	const baseSteps = new Int16Array(n).fill(-1);
	heights.set(world.heights);
	zones.set(world.zones);
	flags.set(world.flags);
	baseSteps.set(world.baseSteps);
	const last = depth * side;
	for (let j = depth + 1; j <= width; j++) {
		heights.copyWithin(j * side, last, last + side);
		zones.copyWithin(j * side, last, last + side);
	}
	const blocks = collisionBlocks(heights, width, width);
	for (let b = 0; b < world.blocks.length; b++) blocks[b] = world.blocks[b];
	// A rail along z = depth in the first padding row of blocks: nobody walks into the padding.
	const blocksX = width / CHUNK_SIZE;
	const row = depth / CHUNK_SIZE;
	for (let bx = 0; bx < blocksX; bx++) {
		const block = blocks[row * blocksX + bx];
		block.boxes = Float32Array.of(bx * CHUNK_SIZE + CHUNK_SIZE / 2, 20, depth, CHUNK_SIZE / 2, 40, 0.5, 1, 0);
	}
	return { ...world, size: width, grid: side, heights, zones, flags, baseSteps, blocks };
}
