import { afterEach, beforeEach, expect, it, vi } from 'vitest';

let stored: Map<string, string>;

beforeEach(() => {
	stored = new Map();
	vi.stubGlobal('localStorage', {
		getItem: (key: string) => stored.get(key) ?? null,
		setItem: (key: string, value: string) => void stored.set(key, value)
	});
	vi.resetModules();
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.useRealTimers();
});

/** A fresh import is a page reload: the store reads storage again. */
const load = async () => (await import('./secret-badge.svelte.ts')).secretBadge;

it('starts unearned and keeps the first date when earned again', async () => {
	vi.useFakeTimers({ now: 1_000 });
	const badge = await load();
	expect(badge.earned).toBe(false);

	badge.earn();
	vi.setSystemTime(5_000);
	badge.earn();
	expect(badge.earnedAt).toBe(1_000);
});

it('survives a reload', async () => {
	(await load()).earn();
	const reloaded = await load();
	expect(reloaded.earned).toBe(true);
});

it('ignores unreadable or blocked storage', async () => {
	stored.set('guardioes-secret-badge', 'not a date');
	expect((await load()).earned).toBe(false);

	vi.stubGlobal('localStorage', {
		getItem: () => {
			throw new Error('blocked');
		},
		setItem: () => {
			throw new Error('blocked');
		}
	});
	vi.resetModules();
	const blocked = await load();
	expect(blocked.earned).toBe(false);
	blocked.earn();
	// Still earned for this visit, even though it could not be saved.
	expect(blocked.earned).toBe(true);
});
