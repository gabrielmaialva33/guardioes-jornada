import { describe, expect, it, vi } from 'vitest';
import {
	type Capabilities,
	DprGovernor,
	dprLimit,
	isWeakGpu,
	pickQuality,
	readCapabilities,
	watchContextLoss
} from './quality.ts';

const phone = (renderer: string, extra: Partial<Capabilities> = {}): Capabilities => ({
	webgl2: true,
	renderer,
	deviceMemory: 4,
	cores: 8,
	saveData: false,
	mobile: true,
	...extra
});

/** Renderer strings as Chrome on the target phones reports them, with and without ANGLE. */
const TARGET_GPUS = [
	'Mali-G52 MC2',
	'ANGLE (ARM, Mali-G52 MC2, OpenGL ES 3.2)',
	'Mali-G57 MC2',
	'Mali-G57',
	'ANGLE (ARM, Mali-G57 MC1, OpenGL ES 3.2)',
	'Adreno (TM) 610',
	'ANGLE (Qualcomm, Adreno (TM) 610, OpenGL ES 3.2)',
	'Adreno 610',
	'PowerVR Rogue GE8320',
	'Mali-G68 MC4'
];

describe('pickQuality', () => {
	it('picks low for every target GPU, even with plenty of memory and cores', () => {
		for (const gpu of TARGET_GPUS) {
			expect(isWeakGpu(gpu)).toBe(true);
			const choice = pickQuality(phone(gpu, { deviceMemory: 8 }), { mobileMedium: true });
			expect(choice).toEqual({ canRender: true, quality: 'low', reason: 'weak-gpu' });
		}
	});

	it('picks low for deviceMemory ≤ 4 with weak GPUs, and still renders on 3 GB phones (reported as 2)', () => {
		for (const memory of [1, 2, 4])
			for (const gpu of TARGET_GPUS) {
				const choice = pickQuality(phone(gpu, { deviceMemory: memory }));
				expect(choice.canRender).toBe(true);
				expect(choice.quality).toBe('low');
			}
	});

	it('keeps phones on low unless mobile medium is enabled for a strong GPU', () => {
		const strong = phone('Adreno (TM) 740', { deviceMemory: 8 });
		expect(pickQuality(strong).quality).toBe('low');
		expect(pickQuality(strong, { mobileMedium: true })).toMatchObject({ quality: 'medium' });
		// A strong GPU with ≤ 4 GB stays low.
		expect(pickQuality({ ...strong, deviceMemory: 4 }, { mobileMedium: true }).quality).toBe('low');
		// Masked GPU names on a phone: low.
		expect(pickQuality(phone('WebKit WebGL', { deviceMemory: 8 }), { mobileMedium: true }).quality).toBe(
			'low'
		);
	});

	it('gives desktops medium or high', () => {
		const desktop = (renderer: string): Capabilities => ({
			webgl2: true,
			renderer,
			deviceMemory: 8,
			cores: 16,
			mobile: false
		});
		expect(
			pickQuality(
				desktop('ANGLE (NVIDIA, NVIDIA GeForce RTX 4090 (0x00002684) Direct3D11 vs_5_0 ps_5_0, D3D11)')
			).quality
		).toBe('high');
		expect(pickQuality(desktop('NVIDIA GeForce RTX 4090'), { allowHigh: false }).quality).toBe('medium');
		expect(pickQuality(desktop('ANGLE (Intel, Intel(R) UHD Graphics 620, OpenGL 4.6)')).quality).toBe(
			'medium'
		);
		expect(pickQuality({ ...desktop('NVIDIA GeForce RTX 4090'), saveData: true }).quality).toBe('low');
		expect(pickQuality({ ...desktop('NVIDIA GeForce RTX 4090'), cores: 4 }).quality).toBe('low');
	});

	it('refuses to render without WebGL2 or on a software rasterizer', () => {
		expect(pickQuality({ webgl2: false, renderer: '' })).toMatchObject({
			canRender: false,
			reason: 'no-webgl2'
		});
		for (const gpu of ['Google SwiftShader', 'llvmpipe (LLVM 17.0.6, 256 bits)'])
			expect(pickQuality({ webgl2: true, renderer: gpu })).toMatchObject({ canRender: false });
	});

	it('reads the unmasked renderer from a context and the hints from navigator', () => {
		const gl = {
			RENDERER: 7937,
			getExtension: (name: string) =>
				name === 'WEBGL_debug_renderer_info' ? { UNMASKED_RENDERER_WEBGL: 37446 } : null,
			getParameter: (parameter: number) => (parameter === 37446 ? 'Mali-G52 MC2' : 'WebKit WebGL')
		} as unknown as WebGL2RenderingContext;
		const caps = readCapabilities(gl, {
			deviceMemory: 2,
			hardwareConcurrency: 8,
			connection: { saveData: false },
			userAgent: 'Mozilla/5.0 (Linux; Android 14; SM-A055M) Mobile'
		});
		expect(caps).toEqual({
			webgl2: true,
			renderer: 'Mali-G52 MC2',
			deviceMemory: 2,
			cores: 8,
			saveData: false,
			mobile: true
		});
		expect(readCapabilities(null, {}).webgl2).toBe(false);
	});
});

/** Feeds `windows` windows of 45 frames from a frame-interval generator; returns the DPR after each window. */
function run(governor: DprGovernor, windows: number, interval: (frame: number) => number) {
	const trace: number[] = [];
	let frame = 0;
	for (let w = 0; w < windows; w++) {
		for (let i = 0; i < 45; i++) governor.sample(interval(frame++));
		trace.push(governor.dpr);
	}
	return trace;
}

/** A deterministic PRNG for noisy input. */
function lcg(seed: number) {
	let state = seed >>> 0;
	return () => {
		state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
		return state / 2 ** 32;
	};
}

describe('DprGovernor', () => {
	it('holds steady at 30 FPS vsync', () => {
		const governor = new DprGovernor({ start: 1, max: 1.25 });
		expect(new Set(run(governor, 30, () => 1000 / 30))).toEqual(new Set([1]));
	});

	it('does not oscillate on noisy input', () => {
		// Vsync-quantized noise: mostly 30 FPS, some 60 FPS frames, some dropped frames.
		const random = lcg(7);
		const governor = new DprGovernor({ start: 1, max: 1.5 });
		const noisy = () => {
			const r = random();
			return r < 0.15 ? 50 : r < 0.3 ? 16.7 : 33.3;
		};
		expect(new Set(run(governor, 60, noisy))).toEqual(new Set([1]));
		// Isolated slow windows between normal ones never add up to a drop.
		const alternating = new DprGovernor({ start: 1, max: 1.5 });
		const trace = run(alternating, 40, (frame) => (Math.floor(frame / 45) % 2 === 0 ? 50 : 33.3));
		expect(new Set(trace)).toEqual(new Set([1]));
		// Nor do slow and fast windows in turn.
		const flapping = new DprGovernor({ start: 1, max: 1.5 });
		expect(new Set(run(flapping, 40, (frame) => (Math.floor(frame / 45) % 2 === 0 ? 50 : 12)))).toEqual(
			new Set([1])
		);
	});

	it('lowers within two windows of sustained slow frames, and reaches the floor', () => {
		const governor = new DprGovernor({ start: 1, max: 1 });
		const trace = run(governor, 8, () => 50);
		expect(trace[0]).toBe(1);
		expect(trace[1]).toBe(0.85);
		// One settle window, then two slow windows again.
		expect(trace[4]).toBe(0.75);
		expect(trace[7]).toBe(0.75);
		expect(governor.saturated).toBeGreaterThan(0);
	});

	it('climbs on headroom only up to the ceiling, which closes after repeated drops', () => {
		const governor = new DprGovernor({ start: 1, max: 1.25 });
		expect(run(governor, 4, () => 12).at(-1)).toBe(1.25);
		// A settle window after each change, then two slow windows.
		expect(run(governor, 3, () => 50).at(-1)).toBe(1);
		// Settle, then four fast windows: back up (one drop does not close the ceiling).
		expect(run(governor, 5, () => 12).at(-1)).toBe(1.25);
		expect(run(governor, 3, () => 50).at(-1)).toBe(1);
		expect(governor.ceiling).toBe(1);
		// Second drop from 1.25: never back above 1 in this session.
		expect(new Set(run(governor, 30, () => 12))).toEqual(new Set([1]));
		governor.setLimit(1.5);
		expect(run(governor, 10, () => 12).at(-1)).toBe(1);
	});

	it('follows the screen limit at once and ignores pauses', () => {
		const governor = new DprGovernor({ start: 1.25, max: 1.5 });
		expect(governor.setLimit(1)).toBe(true);
		expect(governor.dpr).toBe(1);
		for (let i = 0; i < 200; i++) expect(governor.sample(5000)).toBe(false);
		expect(dprLimit(360, 800, 2, 0.5e6)).toBeCloseTo(Math.sqrt(0.5e6 / (360 * 800)));
		expect(dprLimit(360, 800, 1, 0.5e6)).toBe(1);
	});
});

describe('watchContextLoss', () => {
	const lose = (canvas: EventTarget) => {
		const event = new Event('webglcontextlost', { cancelable: true });
		canvas.dispatchEvent(event);
		return event;
	};

	it('prevents the default, reports loss and restore, and fails on repeated losses', () => {
		const canvas = new EventTarget();
		let now = 0;
		const handlers = { lost: vi.fn(), restored: vi.fn(), failed: vi.fn() };
		const stop = watchContextLoss(canvas, handlers, { maxLosses: 2, windowMs: 1000, now: () => now });
		expect(lose(canvas).defaultPrevented).toBe(true);
		expect(handlers.lost).toHaveBeenCalledTimes(1);
		canvas.dispatchEvent(new Event('webglcontextrestored'));
		expect(handlers.restored).toHaveBeenCalledTimes(1);
		now = 5000;
		lose(canvas);
		expect(handlers.failed).not.toHaveBeenCalled();
		now = 5500;
		lose(canvas);
		expect(handlers.failed).toHaveBeenCalledWith(2);
		stop();
		lose(canvas);
		expect(handlers.lost).toHaveBeenCalledTimes(3);
	});
});
