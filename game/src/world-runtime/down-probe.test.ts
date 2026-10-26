import { getHeapStatistics } from 'node:v8';
import { Ray, Vector3 } from 'three';
import { expect, it } from 'vitest';
import { buildStoryWorld } from '../level/index.ts';
import { buildMapCollision, prefabProxies } from './collision.ts';
import { DownProbe } from './down-probe.ts';

const { world, level } = buildStoryWorld(),
	collision = buildMapCollision(world, prefabProxies(world, level)),
	probe = new DownProbe(collision);
it('matches the existing BVH for terrain, elevated stones, decks and the mirante across the map', () => {
	const ray = new Ray(new Vector3(), new Vector3(0, -1, 0));
	for (let z = 1; z < world.size; z += 7)
		for (let x = 1; x < world.size; x += 7) {
			ray.origin.set(x, 30, z);
			const distance = collision.raycast(ray, 60);
			probe.x=x;probe.y=30;probe.z=z;probe.depth=60;probe.sample();
			expect(probe.height).toBeCloseTo(distance === null ? -Infinity : 30 - distance, 5);
		}
	for (const o of level.obbies)
		for (const p of o.pieces) {
			probe.x=p.x;probe.y=p.y+1;probe.z=p.z;probe.depth=1.1;probe.sample();
			expect(probe.height).toBeCloseTo(p.y, 4);
		}
});
function allocated() {
	const h = getHeapStatistics();
	return 'total_allocated_bytes' in h && typeof h.total_allocated_bytes === 'number'
		? h.total_allocated_bytes
		: null;
}
it.skipIf(allocated() === null)('allocates no hit objects during repeated probes', () => {
	probe.y=3;probe.z=92;probe.depth=2;
	for (let i = 0; i < 200000; i++){probe.x=34+(i&7)*.03;probe.sample();}
	let best = Infinity;
	for (let run = 0; run < 5; run++) {
		const before = allocated() ?? 0;
		for (let i = 0; i < 100000; i++){probe.x=34+(i&7)*.03;probe.sample();}
		best = Math.min(best, ((allocated() ?? 0) - before) / 100000);
	}
	expect(best).toBeLessThan(4);
});
