import { describe, expect, it } from 'vitest';
import { buildStoryWorld } from '../level/build.ts';
import { TRAILS } from '../level/layout.ts';
import { heightAt } from '../survival/terrain.ts';
import { FLAG } from '../survival/types.ts';
import { createSurfaceSampler, fixtureSurface } from './surface.ts';

const { world, level } = buildStoryWorld();
const surfaceAt = createSurfaceSampler(world, level);
const onGround = (x: number, z: number) => surfaceAt(x, heightAt(world.heights, x, z), z);

/** The first grid cell with all of `set` and none of `unset`, away from every trail. */
function cellWith(set: number, unset = 0): [number, number] {
	const trails = level.trails.flatMap((t) => t.points);
	for (let z = 2; z < world.size - 2; z++)
		for (let x = 2; x < world.size - 2; x++) {
			const flags = world.flags[z * world.grid + x];
			if ((flags & set) !== set || flags & unset) continue;
			if (trails.some(([tx, tz]) => Math.hypot(tx - x, tz - z) < 12)) continue;
			return [x, z];
		}
	throw new Error(`no cell with flags ${set}`);
}

describe('surface under the feet', () => {
	it('reads the trail as soil and the base pad as soil', () => {
		const [x, z] = TRAILS.trilha[1] as [number, number];
		expect(onGround(x, z)).toBe('soil');
		expect(onGround(...cellWith(FLAG.base))).toBe('soil');
	});

	it('reads standing forest as leaves and pasture as grass', () => {
		expect(onGround(...cellWith(FLAG.forest, FLAG.river | FLAG.base))).toBe('leaves');
		expect(onGround(...cellWith(FLAG.cleared, FLAG.river | FLAG.forest | FLAG.base))).toBe('grass');
	});

	it('reads wading in the river as water', () => {
		const p = world.river.points[4];
		expect(surfaceAt(p.x, p.water - 0.3, p.z)).toBe('water');
	});

	it('reads the obby stones as rock and the ledges by their look', () => {
		const [stones, ledges] = level.obbies;
		for (const stone of stones.pieces) expect(surfaceAt(stone.x, stone.y, stone.z)).toBe('rock');
		for (const ledge of ledges.pieces)
			expect(surfaceAt(ledge.x, ledge.y, ledge.z), ledge.variant).toBe(
				ledge.variant === 'rock' ? 'rock' : 'wood'
			);
	});

	it('reads the bridge deck as wood', () => {
		const bridge = world.crossings.find((c) => c.kind === 'bridge');
		if (!bridge) throw new Error('bridge');
		const x = (bridge.from.x + bridge.to.x) / 2;
		const z = (bridge.from.z + bridge.to.z) / 2;
		expect(surfaceAt(x, (bridge.from.y + bridge.to.y) / 2, z)).toBe('wood');
	});

	it('gives the graybox fixture grass on the floor and wood on its platforms', () => {
		expect(fixtureSurface(0, 0, 0)).toBe('grass');
		expect(fixtureSurface(0, 2, 0)).toBe('wood');
	});
});
