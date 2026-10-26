import { Box3, Vector3 } from 'three';
import { expect, it } from 'vitest';
import { impostorFrame, triangleTransform } from './tree-impostors.ts';

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

it('keeps an asymmetric canopy centred on the trunk instead of shifting the root at LOD handoff', () => {
	const bounds = new Box3(new Vector3(-2, 0, -3), new Vector3(4, 10, 2)),
		frame = impostorFrame(bounds);
	expect((0 + frame.radius) / (frame.radius * 2)).toBe(0.5);
	expect(frame.radius).toBeGreaterThanOrEqual(Math.abs(bounds.min.x));
	expect(frame.radius).toBeGreaterThanOrEqual(bounds.max.x);
	expect(frame.height).toBe(10);
});
