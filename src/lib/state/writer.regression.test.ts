import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Sessions } from './sessions.svelte.ts';
import type { LocalRecord, Repository } from '#lib/data/repository.ts';

const stores: Sessions[] = [];
class MemoryRepository implements Repository {
	rows = new Map<string, LocalRecord>();
	async read() {
		return [...this.rows.values()].map((row) => structuredClone(row));
	}
	async write(rows: LocalRecord[]) {
		for (const row of rows) this.rows.set(row.id, structuredClone(row));
	}
	close() {}
}
class Channel {
	static channels = new Set<Channel>();
	onmessage: ((event: MessageEvent) => void) | null = null;
	constructor(readonly name: string) {
		Channel.channels.add(this);
	}
	postMessage(data: unknown) {
		for (const channel of Channel.channels) {
			if (channel !== this && channel.name === this.name)
				queueMicrotask(() => {
					if (Channel.channels.has(channel)) channel.onmessage?.({ data } as MessageEvent);
				});
		}
	}
	close() {
		Channel.channels.delete(this);
	}
}
function create(repository: Repository = new MemoryRepository()) {
	const store = new Sessions({ repository, ownerId: null });
	stores.push(store);
	return store;
}
function webLocks() {
	let held = false;
	return {
		request: async (_name: string, _options: unknown, callback: (lock: object | null) => Promise<void>) => {
			if (held) return callback(null);
			held = true;
			try {
				await callback({});
			} finally {
				held = false;
			}
		}
	};
}
beforeEach(() => {
	vi.useFakeTimers();
	vi.stubGlobal('navigator', {});
	vi.stubGlobal('BroadcastChannel', undefined);
});
afterEach(() => {
	for (const store of stores.splice(0)) store.close();
	Channel.channels.clear();
	vi.unstubAllGlobals();
	vi.useRealTimers();
});

it('allows offline writing without either coordination API', async () => {
	const store = create();
	await store.load();
	expect(store.readOnly).toBe(false);
	expect(store.ready).toBe(true);
});
it('keeps a tab read-only when another tab holds the Web Lock', async () => {
	vi.stubGlobal('navigator', { locks: webLocks() });
	const first = create(),
		second = create();
	await first.load();
	await second.load();
	expect(first.ready).toBe(true);
	expect(second.readOnly).toBe(true);
	expect(second.ready).toBe(false);
});
it('automatically reloads and becomes writable after the Web Lock is released', async () => {
	vi.stubGlobal('navigator', { locks: webLocks() });
	const repository = new MemoryRepository(),
		first = create(repository),
		second = create(repository);
	await first.load();
	await second.load();
	const visit = first.create({
		participant: 'Synthetic participant',
		myGroupIndex: 0,
		school: 'Synthetic school',
		className: '',
		guide: '',
		date: '2026-10-25',
		groups: [{ name: 'Canela', color: '#123456' }]
	});
	await first.flush();
	first.close();
	await vi.advanceTimersByTimeAsync(3000);
	expect(second.readOnly).toBe(false);
	expect(second.ready).toBe(true);
	expect(second.find(visit.id)?.school).toBe('Synthetic school');
});
it('uses heartbeats to reject a second writer without Web Locks, then permits takeover', async () => {
	vi.stubGlobal('BroadcastChannel', Channel);
	const first = create(),
		second = create();
	const firstLoad = first.load();
	await vi.advanceTimersByTimeAsync(300);
	await firstLoad;
	const secondLoad = second.load();
	await vi.advanceTimersByTimeAsync(300);
	await secondLoad;
	expect(first.ready).toBe(true);
	expect(second.readOnly).toBe(true);
	await vi.advanceTimersByTimeAsync(4000);
	expect(second.readOnly).toBe(true);
	first.close();
	await vi.advanceTimersByTimeAsync(3000);
	expect(second.ready).toBe(true);
});
it('elects one writer when two fallback tabs open together', async () => {
	vi.stubGlobal('BroadcastChannel', Channel);
	const first = create(),
		second = create();
	const loading = Promise.all([first.load(), second.load()]);
	await vi.advanceTimersByTimeAsync(300);
	await loading;
	expect([first, second].filter((store) => store.ready)).toHaveLength(1);
	expect([first, second].filter((store) => store.readOnly)).toHaveLength(1);
});
