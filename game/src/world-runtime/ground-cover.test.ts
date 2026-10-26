import { PerspectiveCamera } from 'three';
import { expect, it, vi } from 'vitest';
import { buildStoryWorld } from '../level/build.ts';
import { createGroundCover } from './ground-cover.ts';

it('rejects real positions on the lookout wood and under the river surface, not just rounded cells', () => {
	const { world, level } = buildStoryWorld(),
		cover = createGroundCover(world, level);
	expect(cover.eligible(128.8434069, 81.738867)).toBe(false);
	expect(cover.eligible(111.35636, 43.41152)).toBe(false);
	cover.dispose();
});

it('uses one opaque batch, excludes trail/water cells and disposes without retained children', () => {
	const { world, level } = buildStoryWorld(),
		cover = createGroundCover(world, level),
		camera = new PerspectiveCamera();
	camera.position.set(34, 8, 92);
	cover.update(camera, 10, 'low');
	expect(cover.mesh.count).toBeGreaterThan(50);
	expect(cover.mesh.count).toBeLessThanOrEqual(800);
	expect(cover.mesh.material.transparent).toBe(false);
	expect(cover.mesh.material.alphaTest).toBe(0);
	const positions = cover.mesh.instanceMatrix.array;
	for (let i = 0; i < cover.mesh.count; i++)
		expect(cover.eligible(positions[i * 16 + 12], positions[i * 16 + 14])).toBe(true);
	const dispose = vi.spyOn(cover.mesh.geometry, 'dispose');
	cover.dispose();
	cover.dispose();
	expect(dispose).toHaveBeenCalledOnce();
	expect(cover.object.children.length).toBe(0);
});
