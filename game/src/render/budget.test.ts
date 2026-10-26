import { DataTexture, Group, Mesh, MeshBasicMaterial, PlaneGeometry, RedFormat, ShaderMaterial } from 'three';
import { describe, expect, it } from 'vitest';
import {
	BUDGET,
	collectTextures,
	debugSnapshot,
	FrameBudget,
	type InfoRenderer,
	shadowMapBytes,
	textureBytes
} from './budget.ts';

/** renderer.info as WebGLInfo keeps it, and render() as WebGLRenderer resets it. */
function mockRenderer(pixelRatio = 1) {
	const info = {
		autoReset: true,
		render: { frame: 0, calls: 0, triangles: 0 },
		memory: { geometries: 12, textures: 5 },
		programs: [{}, {}, {}],
		reset() {
			info.render.calls = 0;
			info.render.triangles = 0;
		}
	};
	const renderer = {
		info,
		getPixelRatio: () => pixelRatio,
		/** One render() call issuing `calls` draws of `triangles` in total. */
		render(calls: number, triangles: number) {
			info.render.frame++;
			if (info.autoReset) info.reset();
			info.render.calls += calls;
			info.render.triangles += triangles;
		}
	};
	return renderer satisfies InfoRenderer;
}

describe('FrameBudget', () => {
	it('sums every pass of a frame and resets per frame', () => {
		const renderer = mockRenderer();
		const budget = new FrameBudget(renderer);
		expect(renderer.info.autoReset).toBe(false);
		budget.beginFrame(0);
		// Shadow pass, main pass and a HUD pass, as three would count them inside three render() calls.
		renderer.render(6, 400);
		renderer.render(40, 50_000);
		renderer.render(2, 4);
		budget.beginFrame(33.3);
		expect(budget.stats()).toMatchObject({ frames: 1, drawCalls: 48, triangles: 50_404 });
		// The next frame counts on its own, not on top of the last.
		renderer.render(30, 20_000);
		budget.beginFrame(66.6);
		expect(budget.stats()).toMatchObject({ frames: 2, drawCalls: 30, triangles: 20_000, drawCallsMax: 48 });
		budget.dispose();
		expect(renderer.info.autoReset).toBe(true);
	});

	it('reports rolling FPS and p50/p95 frame times, ignoring pauses', () => {
		const renderer = mockRenderer();
		const budget = new FrameBudget(renderer, { window: 20 });
		let now = 0;
		budget.beginFrame(now);
		// 18 frames at 30 FPS, 2 hitches of 100 ms.
		for (let i = 0; i < 20; i++) {
			now += i === 5 || i === 12 ? 100 : 1000 / 30;
			renderer.render(10, 100);
			budget.beginFrame(now);
		}
		// A hidden tab: not a frame.
		now += 5000;
		budget.beginFrame(now);
		const stats = budget.stats();
		expect(stats.frames).toBe(20);
		expect(stats.frameP50Ms).toBeCloseTo(33.33, 1);
		expect(stats.frameP95Ms).toBe(100);
		expect(stats.fps).toBeCloseTo((1000 * 20) / (18 * (1000 / 30) + 200), 5);
		expect(stats.slowFrames).toBe(2);
		expect(stats.framesOverDrawBudget).toBe(0);
		budget.dispose();
	});

	it('flags frames over the draw budget', () => {
		const renderer = mockRenderer();
		const budget = new FrameBudget(renderer);
		budget.beginFrame(0);
		renderer.render(BUDGET.drawCalls + 1, 1);
		budget.beginFrame(33);
		expect(budget.stats().framesOverDrawBudget).toBe(1);
		budget.dispose();
	});

	it('exposes the debug snapshot of the active budget', () => {
		expect(debugSnapshot()).toEqual({
			fps: 0,
			frameP95Ms: 0,
			drawCalls: 0,
			triangles: 0,
			dpr: 0,
			quality: 'low',
			programs: 0,
			geometries: 0,
			textures: 0
		});
		const renderer = mockRenderer(0.85);
		const budget = new FrameBudget(renderer, { quality: 'medium' });
		budget.beginFrame(0);
		renderer.render(7, 70);
		budget.beginFrame(25);
		const snapshot = debugSnapshot();
		expect(Object.keys(snapshot).sort()).toEqual(
			[
				'dpr',
				'drawCalls',
				'fps',
				'frameP95Ms',
				'geometries',
				'programs',
				'quality',
				'textures',
				'triangles'
			].sort()
		);
		expect(snapshot).toMatchObject({
			fps: 40,
			frameP95Ms: 25,
			drawCalls: 7,
			triangles: 70,
			dpr: 0.85,
			quality: 'medium',
			programs: 3,
			geometries: 12,
			textures: 5
		});
		budget.dispose();
		expect(debugSnapshot().drawCalls).toBe(0);
	});
});

describe('memory estimates', () => {
	it('counts palette textures and shadow maps', () => {
		const palette = new DataTexture(new Uint8Array(64 * 64 * 4), 64, 64);
		const mesh = new Mesh(new PlaneGeometry(), new MeshBasicMaterial({ map: palette, alphaMap: palette }));
		const textures = collectTextures(mesh);
		expect(textures.size).toBe(1);
		expect(textureBytes(textures)).toBe(64 * 64 * 4);
		expect(shadowMapBytes(1024)).toBe(8 * 1024 * 1024);
		expect(shadowMapBytes(2048)).toBeGreaterThan(BUDGET.textureBytes);
	});
});

it('counts shader atlas uniforms once and respects the R8 canopy map format', () => {
	const map = new DataTexture(new Uint8Array(100), 10, 10, RedFormat);
	map.generateMipmaps = false;
	const mesh = new Mesh(
		new PlaneGeometry(),
		new ShaderMaterial({ uniforms: { a: { value: map }, b: { value: map } } })
	);
	const root = new Group();
	root.add(mesh);
	expect(textureBytes(collectTextures(root))).toBe(100);
	map.dispose();
	mesh.geometry.dispose();
	mesh.material.dispose();
});
