import { describe, expect, it } from 'vitest';
import { FrameStats } from './frame-stats.ts';

describe('frame statistics', () => {
	it('reports measured FPS and a bounded-window p95, ignoring pause gaps', () => {
		const stats = new FrameStats(100);
		for (let i = 0; i < 95; i++) stats.add(0.016);
		for (let i = 0; i < 5; i++) stats.add(0.04);
		expect(stats.read().frameP95Ms).toBe(16);
		expect(stats.read().fps).toBeCloseTo(100 / 1.72);
		stats.add(10);
		expect(stats.read().fps).toBeCloseTo(100 / 1.72);
		stats.reset();
		expect(stats.read()).toEqual({ fps: 0, frameP95Ms: 0 });
	});
});
