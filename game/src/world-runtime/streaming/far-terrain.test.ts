import { expect, it } from 'vitest';
import { generateChunk } from '../../world-gen/chunk.ts';
import { StreamFarTerrain } from './far-terrain.ts';
import { fromWorldChunk } from './generated.ts';

it('keeps a single bounded far-field batch over repeated kilometre round trips', () => {
	const far = new StreamFarTerrain(9);
	const geometry = far.object.geometry;
	for (let round = 0; round < 2; round++)
		for (const direction of [1, -1])
			for (let n = 0; n < 26; n++) {
				const cx = direction > 0 ? 20 + n : 45 - n;
				const chunk = fromWorldChunk(generateChunk(cx, 12));
				if (!chunk) throw new Error('fixture');
				far.add(chunk, () => null);
				expect(far.size).toBeLessThanOrEqual(9);
			}
	expect(far.object.geometry).toBe(geometry);
	expect(geometry.getAttribute('position').count).toBe(81 * 121);
	expect(far.object.frustumCulled).toBe(false);
	far.dispose();
	far.dispose();
});
