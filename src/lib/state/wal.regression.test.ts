import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { IndexedRepository, type LocalRecord, type Repository } from '#lib/data/repository.ts';
import { Sessions } from './sessions.svelte.ts';
import { clearJournalRecord, journalRecord } from '#lib/data/journal.ts';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const input = { school: 'Synthetic school', className: '', guide: '', date: '2026-10-25', groups: [] };
const stores: Sessions[] = [];
class MemoryStorage implements Storage {
	values = new Map<string, string>();
	get length() {
		return this.values.size;
	}
	clear() {
		this.values.clear();
	}
	getItem(key: string) {
		return this.values.get(key) ?? null;
	}
	key(index: number) {
		return [...this.values.keys()][index] ?? null;
	}
	removeItem(key: string) {
		this.values.delete(key);
	}
	setItem(key: string, value: string) {
		this.values.set(key, value);
	}
}
function create(repository: Repository, ownerId: string | null = A, writable = true) {
	const store = new Sessions({ repository, ownerId, lock: async () => (writable ? () => {} : null) });
	stores.push(store);
	return store;
}
function deferred() {
	let resolve!: () => void;
	const promise = new Promise<void>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}
beforeEach(() => {
	vi.stubGlobal('localStorage', new MemoryStorage());
	vi.stubGlobal('window', {
		get localStorage() {
			return globalThis.localStorage;
		}
	});
});
afterEach(() => {
	for (const store of stores.splice(0)) store.close();
	vi.unstubAllGlobals();
});

it('recovers the last synchronous mutation when unloading behind an unfinished IDB write', async () => {
	const name = 'wal-unload-' + crypto.randomUUID(),
		disk = new IndexedRepository(name);
	let blocked = false;
	const store = create({
		read: () => disk.read(),
		write: (rows) => (blocked ? new Promise(() => {}) : disk.write(rows)),
		close: () => disk.close()
	});
	await store.load();
	const visit = store.create(input);
	await store.flush();
	blocked = true;
	store.advance(visit);
	store.advance(visit);
	const key = 'guardioes-wal:' + visit.id;
	expect(JSON.parse(localStorage.getItem(key)!).session.revealed).toBe(true);
	store.close();
	const recoveredDisk = new IndexedRepository(name),
		recovered = create(recoveredDisk);
	await recovered.load();
	expect(recovered.ready).toBe(true);
	expect(recovered.find(visit.id)?.revealed).toBe(true);
	expect(((await recoveredDisk.read()) as LocalRecord[])[0].session?.revealed).toBe(true);
	expect(localStorage.getItem(key)).toBeNull();
});
it('ignores and clears a journal revision older than the durable IDB record', async () => {
	const name = 'wal-old-' + crypto.randomUUID(),
		disk = new IndexedRepository(name),
		store = create(disk);
	await store.load();
	const visit = store.create(input);
	await store.flush();
	const old = (await disk.read())[0];
	store.advance(visit);
	await store.flush();
	store.close();
	const key = 'guardioes-wal:' + visit.id;
	localStorage.setItem(key, JSON.stringify(old));
	const recovered = create(new IndexedRepository(name));
	await recovered.load();
	expect(recovered.find(visit.id)?.step).toBe(1);
	expect(recovered.find(visit.id)?.rev).toBe(2);
	expect(localStorage.getItem(key)).toBeNull();
});
it('quarantines corrupt JSON and invalid envelopes without replacing a valid journey', async () => {
	const name = 'wal-bad-' + crypto.randomUUID(),
		disk = new IndexedRepository(name),
		store = create(disk);
	await store.load();
	const visit = store.create(input);
	await store.flush();
	const record = (await disk.read())[0] as LocalRecord;
	store.close();
	const corruptKey = 'guardioes-wal:' + crypto.randomUUID(),
		invalidKey = 'guardioes-wal:' + visit.id;
	localStorage.setItem(corruptKey, '{broken');
	localStorage.setItem(
		invalidKey,
		JSON.stringify({ ...record, rev: 2, session: { ...record.session, rev: 2, groups: null } })
	);
	const recoveredDisk = new IndexedRepository(name),
		recovered = create(recoveredDisk);
	await recovered.load();
	expect(recovered.ready).toBe(true);
	expect(recovered.find(visit.id)).not.toBeNull();
	expect(((await recoveredDisk.read()) as LocalRecord[]).filter((row) => row.quarantine)).toHaveLength(2);
	expect(localStorage.getItem(corruptKey)).toBeNull();
	expect(localStorage.getItem(invalidKey)).toBeNull();
});
it.each(['quota', 'blocked'])('still persists to IDB when localStorage is %s', async (mode) => {
	const storage = new MemoryStorage();
	storage.setItem = () => {
		throw new Error(mode);
	};
	if (mode === 'blocked')
		storage.getItem = storage.key = () => {
			throw new Error(mode);
		};
	vi.stubGlobal('localStorage', storage);
	const disk = new IndexedRepository('wal-unavailable-' + crypto.randomUUID()),
		store = create(disk);
	await store.load();
	const visit = store.create(input);
	store.advance(visit);
	await store.flush();
	expect(store.ready).toBe(true);
	expect(((await disk.read()) as LocalRecord[])[0].session?.step).toBe(1);
});
it('an earlier IDB completion cannot clear a newer journal entry', async () => {
	const disk = new IndexedRepository('wal-drain-' + crypto.randomUUID());
	const first = deferred(),
		second = deferred(),
		secondEntered = deferred();
	let writes = 0;
	const store = create({
		read: () => disk.read(),
		close: () => disk.close(),
		write: async (rows) => {
			writes++;
			if (writes === 2) await first.promise;
			if (writes === 3) {
				secondEntered.resolve();
				await second.promise;
			}
			await disk.write(rows);
		}
	});
	await store.load();
	const visit = store.create(input);
	await store.flush();
	store.advance(visit);
	store.advance(visit);
	first.resolve();
	await secondEntered.promise;
	const key = 'guardioes-wal:' + visit.id;
	expect(JSON.parse(localStorage.getItem(key)!).rev).toBe(3);
	second.resolve();
	await store.flush();
	expect(localStorage.getItem(key)).toBeNull();
});
it('replays another owner without exposing or reassigning the recovered session', async () => {
	const name = 'wal-owner-' + crypto.randomUUID(),
		disk = new IndexedRepository(name);
	const store = create({
		read: () => disk.read(),
		write: () => new Promise(() => {}),
		close: () => disk.close()
	});
	await store.load();
	const visit = store.create(input);
	store.close();
	const recovered = create(new IndexedRepository(name), B);
	await recovered.load();
	expect(recovered.list).toHaveLength(0);
	expect(recovered.guestCount).toBe(0);
	recovered.setOwner(A);
	expect(recovered.find(visit.id)?.ownerId).toBe(A);
});
it('a read-only tab leaves the active writer journal untouched', async () => {
	const name = 'wal-reader-' + crypto.randomUUID(),
		disk = new IndexedRepository(name);
	const store = create({
		read: () => disk.read(),
		write: () => new Promise(() => {}),
		close: () => disk.close()
	});
	await store.load();
	const visit = store.create(input);
	const reader = create(new IndexedRepository(name), A, false);
	await reader.load();
	expect(reader.readOnly).toBe(true);
	expect(localStorage.getItem('guardioes-wal:' + visit.id)).not.toBeNull();
});
it('does not erase changed outbox metadata at the same local revision', async () => {
	const disk = new IndexedRepository('wal-metadata-' + crypto.randomUUID()),
		store = create(disk);
	await store.load();
	const visit = store.create(input);
	await store.flush();
	const original = (await disk.read())[0] as LocalRecord;
	journalRecord({ ...original, ackedRev: original.rev, serverRev: 1 });
	clearJournalRecord(original);
	expect(JSON.parse(localStorage.getItem('guardioes-wal:' + visit.id)!).serverRev).toBe(1);
});
it('keeps the journal and refuses mutations if recovery cannot finish its IDB transaction', async () => {
	const name = 'wal-recovery-fail-' + crypto.randomUUID(),
		disk = new IndexedRepository(name);
	const original = create({
		read: () => disk.read(),
		write: () => new Promise(() => {}),
		close: () => disk.close()
	});
	await original.load();
	const visit = original.create(input);
	original.close();
	const nextDisk = new IndexedRepository(name);
	let fail = true;
	const recovered = create({
		read: () => nextDisk.read(),
		close: () => nextDisk.close(),
		write: (rows) => (fail ? Promise.reject(new Error('disk')) : nextDisk.write(rows))
	});
	await recovered.load();
	expect(recovered.ready).toBe(false);
	expect(localStorage.getItem('guardioes-wal:' + visit.id)).not.toBeNull();
	fail = false;
	await recovered.load();
	expect(recovered.ready).toBe(true);
	expect(recovered.find(visit.id)).not.toBeNull();
	expect(localStorage.getItem('guardioes-wal:' + visit.id)).toBeNull();
});
it('still works when accessing the localStorage property itself throws', async () => {
	Object.defineProperty(globalThis, 'localStorage', {
		configurable: true,
		get() {
			throw new Error('SecurityError');
		}
	});
	const disk = new IndexedRepository('wal-security-' + crypto.randomUUID()),
		store = create(disk);
	await store.load();
	const visit = store.create(input);
	await store.flush();
	expect(store.ready).toBe(true);
	expect(((await disk.read()) as LocalRecord[])[0].id).toBe(visit.id);
});
it('preserves the journey if interrupted between the fork and retirement journal writes', async () => {
	const name = 'wal-partial-fork-' + crypto.randomUUID(),
		disk = new IndexedRepository(name),
		entered = deferred();
	let blocked = false;
	const store = create({
		read: () => disk.read(),
		close: () => disk.close(),
		write: (rows) => {
			if (blocked) {
				entered.resolve();
				return new Promise(() => {});
			}
			return disk.write(rows);
		}
	});
	await store.load();
	const visit = store.create(input);
	store.advance(visit);
	store.advance(visit);
	await store.flush();
	const storage = localStorage,
		write = storage.setItem.bind(storage);
	let wrote = false;
	storage.setItem = (key, value) => {
		if (!wrote) {
			write(key, value);
			wrote = true;
		}
	};
	blocked = true;
	void store.resolveConflict(visit.id, null);
	await entered.promise;
	store.close();
	storage.setItem = write;
	const recovered = create(new IndexedRepository(name));
	await recovered.load();
	expect(recovered.list.some((session) => session.revealed)).toBe(true);
});
