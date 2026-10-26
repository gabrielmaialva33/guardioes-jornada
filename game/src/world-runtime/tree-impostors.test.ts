import { expect, it } from 'vitest';
import { triangleTransform } from './tree-impostors.ts';

it('projects complete masked texture triangles rather than averaging a leaf card into a polygon', () => {
	const uv = [128, 64, 256, 64, 128, 192],
		p = [10, 20, 80, 25, 12, 90],
		m = triangleTransform(uv, p);
	expect(m).not.toBeNull();
	if (!m) throw new Error('matrix');
	for (let i = 0; i < 3; i++) {
		expect(m[0] * uv[i * 2] + m[2] * uv[i * 2 + 1] + m[4]).toBeCloseTo(p[i * 2]);
		expect(m[1] * uv[i * 2] + m[3] * uv[i * 2 + 1] + m[5]).toBeCloseTo(p[i * 2 + 1]);
	}
	expect(triangleTransform([0, 0, 0, 0, 1, 1], p)).toBeNull();
});
