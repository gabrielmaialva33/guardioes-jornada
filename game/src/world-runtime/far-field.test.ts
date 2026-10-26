import { PerspectiveCamera, Vector3 } from 'three';
import { expect, it } from 'vitest';
import { buildStoryWorld } from '../level/build.ts';
import { coarseTerrain, detailDistances, patchFarShader } from './far-field.ts';

const { world, level } = buildStoryWorld();
it('covers the whole reserve and outer apron in one coarse mesh with finite vertical bounds', () => {
	const g = coarseTerrain(world, level.trails);
	g.computeBoundingBox();
	expect(g.boundingBox?.min.x).toBe(-160);
	expect(g.boundingBox?.max.x).toBe(320);
	expect((g.index?.count ?? 0) / 3).toBeLessThanOrEqual(6000);
	expect(g.boundingBox?.min.y).toBeLessThan(2);
	expect(g.boundingBox?.max.y).toBeGreaterThan(15);
	const p = g.getAttribute('position');
	for (let i = 0; i < p.count; i++) expect(Number.isFinite(p.getY(i))).toBe(true);
	g.dispose();
});
it('confirms old far=70 clips lowland at the elevated mirante pose, independently of culling bounds', () => {
	const camera = new PerspectiveCamera(70, 960 / 432, 0.1, 70);
	camera.position.set(155, 44, 80);
	camera.lookAt(100, 1.8, 75);
	camera.updateMatrixWorld();
	const point = new Vector3(70, 2, 75).project(camera);
	expect(point.z).toBeGreaterThan(1);
	const shader = {
		vertexShader: '#include <project_vertex>',
		fragmentShader: '#include <common>\n#include <dithering_fragment>',
		uniforms: {}
	};
	patchFarShader(shader);
	expect(shader.vertexShader).toContain('gl_Position.w');
	expect(shader.fragmentShader).toContain('uFarMist');
});
it('keeps detailed bands independent of the long visibility range', () => {
	expect(detailDistances('low')).toEqual({ terrain: 56, trees: 48 });
	expect(detailDistances('high').trees).toBeLessThan(100);
});
