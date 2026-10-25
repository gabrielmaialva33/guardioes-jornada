import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { deferVisible } from './visible.ts';
let intersect: (entries: { isIntersecting: boolean }[]) => void;
let idle: (() => void) | undefined;
let hidden = false;
const listeners = new Map<string, () => void>();
beforeEach(() => {
	hidden = false; idle = undefined; listeners.clear();
	vi.stubGlobal('document', { get hidden() { return hidden; }, addEventListener: (event: string, callback: () => void) => listeners.set(event, callback), removeEventListener: (event: string) => listeners.delete(event) });
	vi.stubGlobal('window', { requestIdleCallback: (callback: () => void) => { idle = callback; return 1; }, cancelIdleCallback: () => { idle = undefined; } });
	vi.stubGlobal('IntersectionObserver', class { constructor(callback: typeof intersect) { intersect = callback; } observe() {} disconnect() {} });
});
afterEach(() => vi.unstubAllGlobals());
it('does not start a hidden map and waits for both intersection and idle', () => {
	const stop = vi.fn(), start = vi.fn(() => stop), dispose = deferVisible({ getClientRects: () => [1], closest: () => null } as unknown as HTMLElement, start);
	intersect([{ isIntersecting: false }]); expect(start).not.toHaveBeenCalled();
	intersect([{ isIntersecting: true }]); expect(start).not.toHaveBeenCalled(); idle?.(); expect(start).toHaveBeenCalledOnce();
	intersect([{ isIntersecting: false }]); expect(stop).toHaveBeenCalledOnce(); dispose();
});
it('cancels pending work while the document is hidden and cleans up observers', () => {
	const start = vi.fn(() => () => {}), dispose = deferVisible({ getClientRects: () => [1], closest: () => null } as unknown as HTMLElement, start);
	intersect([{ isIntersecting: true }]); hidden = true; listeners.get('visibilitychange')?.(); idle?.(); expect(start).not.toHaveBeenCalled();
	hidden = false; listeners.get('visibilitychange')?.(); idle?.(); expect(start).toHaveBeenCalledOnce(); dispose(); expect(listeners.size).toBe(0);
});
