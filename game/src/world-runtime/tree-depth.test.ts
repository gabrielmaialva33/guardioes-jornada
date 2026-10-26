import { DoubleSide, MeshLambertMaterial, Texture } from 'three';
import { expect, it } from 'vitest';
import { treeDepth } from './tree-depth.ts';

it('keeps the leaf alpha cut-out and sidedness in the wind-patched shadow pass', () => {
	const map = new Texture(),
		m = new MeshLambertMaterial({ map, alphaTest: 0.5, side: DoubleSide }),
		depth = treeDepth(m, 6, { from: 6, to: 11, amplitude: 0.1, sample: 'origin' });
	expect(depth.map).toBe(map);
	expect(depth.alphaTest).toBe(0.5);
	expect(depth.side).toBe(DoubleSide);
	expect(depth.userData.lifeWind).toBeTruthy();
	expect(depth.customProgramCacheKey()).toContain('canopy-depth-v1');
	depth.dispose();
	m.dispose();
	map.dispose();
});
