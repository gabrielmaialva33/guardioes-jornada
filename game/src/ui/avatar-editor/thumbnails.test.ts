import { describe, expect, it, vi } from 'vitest';
import { readbackToImage, ThumbnailCache, ThumbnailQueue } from './thumbnails.ts';

/** A clock the jobs advance: each render "costs" `cost` ms. */
function clock() {
	let time = 0;
	return {
		now: () => time,
		advance(ms: number) {
			time += ms;
		}
	};
}

function setup(cost: number, budgetMs = 4, maxEntries = 72) {
	const time = clock();
	const released: string[] = [];
	const cache = new ThumbnailCache<string>({ maxEntries, release: (value) => released.push(value) });
	const ready: string[] = [];
	const queue = new ThumbnailQueue<string>({
		cache,
		budgetMs,
		now: time.now,
		onready: (key) => ready.push(key)
	});
	const rendered: string[] = [];
	const work = (key: string) => {
		time.advance(cost);
		rendered.push(key);
		return `image:${key}`;
	};
	return { time, cache, queue, work, rendered, ready, released };
}

const keys = (n: number, prefix = 'k') => Array.from({ length: n }, (_, i) => `${prefix}${i}`);

describe('ThumbnailQueue budget', () => {
	it('fits as many cheap thumbnails as the 4 ms budget allows', () => {
		const { queue, work, rendered } = setup(1.5);
		queue.request(keys(10));
		expect(queue.pump(work)).toBe(2);
		expect(rendered).toEqual(['k0', 'k1']);
		expect(queue.pending).toBe(8);
		expect(queue.stats().maxFrameMs).toBeLessThanOrEqual(4);
	});
	it('keeps the average within budget when one thumbnail costs more than a frame', () => {
		const { queue, work } = setup(6);
		queue.request(keys(6));
		const perFrame: number[] = [];
		for (let frame = 0; frame < 12; frame++) perFrame.push(queue.pump(work));
		const total = perFrame.reduce((a, b) => a + b, 0);
		expect(total).toBe(6);
		// Never two expensive jobs in a frame, and frames in between repay the overrun.
		expect(Math.max(...perFrame)).toBe(1);
		const framesUsed = perFrame.lastIndexOf(1) + 1;
		expect((total * 6) / framesUsed).toBeLessThanOrEqual(4);
	});
	it('stops for the frame while a job is still preparing', () => {
		const { queue, cache } = setup(1);
		let ready = false;
		const work = (key: string) => (ready ? `image:${key}` : null);
		queue.request(['a', 'b']);
		expect(queue.pump(work)).toBe(0);
		expect(queue.pending).toBe(2);
		ready = true;
		expect(queue.pump(work)).toBe(2);
		expect(cache.peek('a')).toBe('image:a');
	});
	it('skips keys that cannot render until reset', () => {
		const { queue } = setup(1);
		const work = (key: string) => (key === 'bad' ? undefined : `image:${key}`);
		queue.request(['bad', 'good']);
		expect(queue.pump(work)).toBe(1);
		queue.request(['bad', 'good']);
		expect(queue.pending).toBe(0);
		queue.reset();
		queue.request(['bad']);
		expect(queue.pending).toBe(1);
	});
	it('reports per-thumbnail cost', () => {
		const { queue, work } = setup(2);
		queue.request(keys(4));
		while (queue.pending > 0) queue.pump(work);
		expect(queue.stats()).toMatchObject({ count: 4, meanMs: 2, maxMs: 2 });
	});
});

describe('ThumbnailQueue laziness and cache', () => {
	it('renders only the visible tab: a new request replaces the pending list', () => {
		const { queue, work, rendered } = setup(1.5);
		queue.request(keys(10, 'hair'));
		queue.pump(work);
		queue.request(keys(3, 'skin'));
		while (queue.pending > 0) queue.pump(work);
		expect(rendered).toEqual(['hair0', 'hair1', 'skin0', 'skin1', 'skin2']);
	});
	it('never renders a cached key twice in the session, even from a new queue', () => {
		const { queue, work, rendered, cache, time } = setup(1);
		queue.request(['a', 'b', 'a']);
		while (queue.pending > 0) queue.pump(work);
		queue.request(['a', 'b']);
		expect(queue.pending).toBe(0);
		const reopened = new ThumbnailQueue<string>({ cache, now: time.now });
		reopened.request(['b', 'c']);
		expect(reopened.pending).toBe(1);
		expect(rendered).toEqual(['a', 'b']);
	});
	it('notifies each stored thumbnail', () => {
		const { queue, work, ready } = setup(1);
		queue.request(['x', 'y']);
		queue.pump(work);
		expect(ready).toEqual(['x', 'y']);
	});
	it('evicts the least recently used past the limit, releasing it; the visible tab is kept', () => {
		const { queue, work, cache, released } = setup(0.1, 4, 3);
		queue.request(['a', 'b', 'c']);
		queue.pump(work);
		queue.request(['a']); // a is on screen again: most recent
		queue.request(['d']);
		queue.pump(work);
		expect(released).toEqual(['image:b']);
		expect(cache.has('a')).toBe(true);
		expect(cache.size).toBe(3);
		cache.clear();
		expect(released).toEqual(['image:b', 'image:c', 'image:a', 'image:d']);
		expect(cache.size).toBe(0);
	});
	it('releases a replaced image', () => {
		const release = vi.fn();
		const cache = new ThumbnailCache<object>({ release });
		const first = {},
			second = {};
		cache.set('k', first);
		cache.set('k', first);
		expect(release).not.toHaveBeenCalled();
		cache.set('k', second);
		expect(release).toHaveBeenCalledWith(first);
	});
});

describe('readbackToImage', () => {
	it('flips rows to top-down and un-premultiplies edges', () => {
		// 1 × 2: bottom row (first in the read-back) is a half-covered edge, top row is clear.
		const source = new Uint8Array([100, 50, 20, 128, 0, 0, 0, 0]);
		const target = new Uint8ClampedArray(8);
		readbackToImage(source, target, 1, 2);
		expect([...target.slice(0, 4)]).toEqual([0, 0, 0, 0]);
		expect([...target.slice(4)]).toEqual([199, 100, 40, 128]);
	});
	it('copies opaque pixels unchanged', () => {
		const source = new Uint8Array([1, 2, 3, 255, 4, 5, 6, 255, 7, 8, 9, 255, 10, 11, 12, 255]);
		const target = new Uint8ClampedArray(16);
		readbackToImage(source, target, 2, 2);
		expect([...target]).toEqual([7, 8, 9, 255, 10, 11, 12, 255, 1, 2, 3, 255, 4, 5, 6, 255]);
	});
});
