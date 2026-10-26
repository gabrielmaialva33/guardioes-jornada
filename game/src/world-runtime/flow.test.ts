import { MeshLambertMaterial } from 'three';
import { expect, it } from 'vitest';
import { applyFlow, patchFlow, WATERFALL_RECT } from './flow.ts';

it('scrolls only inside the inset waterfall atlas cell, using the shared visual clock', () => {
	const s = { vertexShader: '', fragmentShader: '#include <common>\n#include <map_fragment>', uniforms: {} };
	patchFlow(s);
	expect(s.fragmentShader).toContain('fract(localFlow.y+uFlowTime*.2)');
	expect(s.fragmentShader).toContain('uFlowRect.xy+localFlow*uFlowRect.zw');
	expect(WATERFALL_RECT[1] + WATERFALL_RECT[3]).toBeLessThan(1);
});

it('patches a material shared by both LODs only once', () => {
	const m = new MeshLambertMaterial();
	applyFlow(m);
	const hook = m.onBeforeCompile,
		key = m.customProgramCacheKey();
	applyFlow(m);
	expect(m.onBeforeCompile).toBe(hook);
	expect(m.customProgramCacheKey()).toBe(key);
	m.dispose();
});
