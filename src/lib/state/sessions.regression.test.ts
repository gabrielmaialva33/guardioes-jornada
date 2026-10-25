import { del } from 'idb-keyval';
import { afterEach, assert, describe, expect, it, vi } from 'vitest';
import {
	IndexedRepository,
	type LocalRecord,
	type Repository,
	type WriterLock
} from '#lib/data/repository.ts';
import { decodeSession } from '#lib/data/session-schema.ts';
import * as photos from '#lib/photos.ts';
import { photoKey, readPhoto, savePhoto } from '#lib/photos.ts';
import type { Session } from '#lib/session.ts';
import type { CloudAdapter, PushReply } from '#lib/supabase/adapter.ts';
import { type RemoteSession, Sessions } from './sessions.svelte.ts';
import { CloudSync, type SyncIdentity } from './sync.svelte.ts';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const input = {
	participant: 'Synthetic participant',
	myGroupIndex: 0,
	school: 'Synthetic school',
	className: 'Synthetic class',
	guide: 'Synthetic guide',
	date: '2026-10-25',
	groups: [{ name: 'Canela', color: '#123456' }]
};
const stores: Sessions[] = [],
	syncs: CloudSync[] = [];
function deferred<T = void>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((r) => {
		resolve = r;
	});
	return { promise, resolve };
}
function lock(): WriterLock {
	let held = false;
	return async () => {
		if (held) return null;
		held = true;
		return () => {
			held = false;
		};
	};
}
function store(
	ownerId: string | null = A,
	repository: Repository = new IndexedRepository(`test-${crypto.randomUUID()}`),
	writer = lock()
) {
	const s = new Sessions({ repository, lock: writer, ownerId });
	stores.push(s);
	return s;
}
class Identity implements SyncIdentity {
	user: { id: string } | null;
	generation = 0;
	listeners = new Set<() => void>();
	constructor(owner: string | null = A) {
		this.user = owner ? { id: owner } : null;
	}
	onChange(fn: () => void) {
		this.listeners.add(fn);
		return () => {
			this.listeners.delete(fn);
		};
	}
	change(owner: string | null) {
		this.user = owner ? { id: owner } : null;
		this.generation++;
		for (const fn of this.listeners) fn();
	}
}
class Cloud implements CloudAdapter {
	rows = new Map<string, RemoteSession>();
	pushes: { session: Session; mutationId: string; base: number }[] = [];
	pulls = 0;
	beforePush?: () => Promise<void>;
	loseReply = false;
	failures = 0;
	push = async (session: Session, base: number, mutationId: string): Promise<PushReply> => {
		this.pushes.push({ session: structuredClone(session), mutationId, base });
		if (this.beforePush) await this.beforePush();
		if (this.failures-- > 0) throw new Error('Transient failure');
		const old = this.rows.get(session.id);
		if (old?.last_mutation_id === mutationId)
			return { status: 'ok', rev: old.rev, server_doc: structuredClone(old) };
		if (old && (old.rev !== base || old.deleted_at))
			return { status: 'conflict', rev: old.rev, server_doc: structuredClone(old) };
		assert(session.ownerId);
		const row = {
			id: session.id,
			owner_id: session.ownerId,
			rev: (old?.rev ?? 0) + 1,
			doc: structuredClone(session),
			deleted_at: null,
			last_mutation_id: mutationId
		};
		this.rows.set(session.id, row);
		if (this.loseReply) {
			this.loseReply = false;
			throw new Error('Response lost after commit');
		}
		return { status: 'ok', rev: row.rev, server_doc: structuredClone(row) };
	};
	delete = async (id: string, base: number, mutationId: string): Promise<PushReply> => {
		const old = this.rows.get(id);
		if (!old) return { status: 'ok', rev: 0, server_doc: null };
		if (old.deleted_at || old.last_mutation_id === mutationId)
			return { status: 'ok', rev: old.rev, server_doc: structuredClone(old) };
		if (old.rev !== base) return { status: 'conflict', rev: old.rev, server_doc: structuredClone(old) };
		const row = {
			...old,
			rev: old.rev + 1,
			deleted_at: new Date().toISOString(),
			doc: {},
			last_mutation_id: mutationId
		};
		this.rows.set(id, row);
		return { status: 'ok', rev: row.rev, server_doc: structuredClone(row) };
	};
	pull = async (owner: string): Promise<RemoteSession[]> => {
		this.pulls++;
		return [...this.rows.values()].filter((r) => r.owner_id === owner).map((r) => structuredClone(r));
	};
}
async function connected(
	s: Sessions,
	cloud = new Cloud(),
	identity = new Identity(),
	options: { timeoutMs?: number; retryBaseMs?: number } = {}
) {
	const sync = new CloudSync({ store: s, client: cloud, identity, online: () => true, ...options });
	syncs.push(sync);
	await sync.init();
	return { sync, cloud, identity };
}
afterEach(async () => {
	for (const s of syncs.splice(0)) s.dispose();
	for (const s of stores.splice(0)) s.close();
	vi.restoreAllMocks();
	vi.useRealTimers();
	await del('sessions-v1');
});

describe('durable sessions and ownership', () => {
	it('R7 refuses creation while an existing database read is pending', async () => {
		const gate = deferred<unknown[]>();
		const write = vi.fn(async () => {});
		const s = store(A, { read: () => gate.promise, write, close() {} });
		const loading = s.load();
		expect(() => s.create(input)).toThrow();
		expect(s.list).toHaveLength(0);
		expect(write).not.toHaveBeenCalled();
		gate.resolve([]);
		await loading;
		expect(s.ready).toBe(true);
	});
	it('keeps mutations disabled after a failed read and allows a successful retry', async () => {
		let failed = true;
		const s = store(A, {
			read: async () => {
				if (failed) throw Error();
				return [];
			},
			write: async () => {},
			close() {}
		});
		await s.load();
		expect(s.loaded).toBe(true);
		expect(s.ready).toBe(false);
		await s.flush();
		expect(s.ready).toBe(false);
		expect(() => s.create(input)).toThrow();
		failed = false;
		await s.load();
		expect(s.ready).toBe(true);
	});
	it('R8 makes a second window read-only and reloads before taking the released writer lock', async () => {
		const writer = lock(),
			name = `windows-${crypto.randomUUID()}`;
		const a = store(A, new IndexedRepository(name), writer),
			b = store(A, new IndexedRepository(name), writer);
		await a.load();
		const first = a.create(input);
		await a.flush();
		await b.load();
		expect(b.readOnly).toBe(true);
		expect(b.ready).toBe(false);
		expect(() => b.create(input)).toThrow();
		a.close();
		await b.load();
		expect(b.ready).toBe(true);
		b.create(input);
		await b.flush();
		expect(b.find(first.id)).not.toBeNull();
		expect(b.list).toHaveLength(2);
	});
	it('refuses writes when a browser cannot obtain a Web Lock', async () => {
		const s = store(A, new IndexedRepository(`no-lock-${crypto.randomUUID()}`), async () => null);
		await s.load();
		expect(s.readOnly).toBe(true);
		expect(() => s.create(input)).toThrow();
	});
	it('R4/R11 uses increasing revisions after clock rollback and in the same millisecond', async () => {
		const s = store();
		await s.load();
		const visit = s.create(input);
		await s.flush();
		vi.spyOn(Date, 'now').mockReturnValue(1000);
		s.score(visit, visit.groups[0].id, 1, null);
		s.score(visit, visit.groups[0].id, 1, null);
		expect(s.find(visit.id)?.rev).toBe(3);
		expect(s.find(visit.id)?.scores).toHaveLength(2);
		await s.flush();
	});
	it('R12 resolves an old Session reference by ID after the record was replaced', async () => {
		const s = store();
		await s.load();
		const old = s.create(input);
		await s.flush();
		const pending = await s.nextOperation();
		assert(pending);
		await s.acknowledge(old.id, pending.operation, 1);
		await s.receive({
			id: old.id,
			owner_id: A,
			rev: 2,
			doc: { ...old, school: 'Remote school' },
			deleted_at: null
		});
		s.addPhoto(old, photoKey(old.id, old.groups[0].id, 'inseto'));
		await s.flush();
		expect(s.find(old.id)?.photos).toHaveLength(1);
		expect(s.find(old.id)?.school).toBe('Remote school');
	});
	it('R13 quarantines unknown journeys without deleting the original document', async () => {
		const s = store();
		await s.load();
		const visit = s.create(input);
		await s.flush();
		const raw = { ...visit, journeyId: 'future-journey' };
		await s.receive({ id: crypto.randomUUID(), owner_id: A, rev: 1, deleted_at: null, doc: raw });
		expect(s.list).toHaveLength(1);
		expect(s.quarantine).toHaveLength(1);
		expect(s.quarantine[0].raw).toEqual(raw);
	});
	it('rejects malformed dates and null arrays instead of trusting TypeScript casts', async () => {
		const s = store();
		await s.load();
		const visit = s.create(input);
		await s.flush();
		expect(decodeSession({ ...visit, groups: null }).session).toBeUndefined();
		expect(decodeSession({ ...visit, date: '2026-02-31' }).session).toBeUndefined();
		expect(decodeSession({ ...visit, updatedAt: Number.MAX_SAFE_INTEGER }).session).toBeUndefined();
	});
	it('quarantines a damaged in-flight envelope without uploading or discarding the raw record', async () => {
		const name = `bad-outbox-${crypto.randomUUID()}`,
			repository = new IndexedRepository(name);
		const s = store(A, repository);
		await s.load();
		const visit = s.create(input);
		await s.flush();
		const rows = (await repository.read()) as LocalRecord[];
		rows[0].inflight = { mutationId: 'bad', rev: 1, baseRev: 0, kind: 'push', session: visit };
		await repository.write(rows);
		s.close();
		const reopened = store(A, new IndexedRepository(name));
		await reopened.load();
		expect(reopened.quarantine).toHaveLength(1);
		expect(reopened.list).toHaveLength(0);
		expect(await reopened.nextOperation()).toBeNull();
	});
	it('preserves unrecognized future fields in quarantine instead of stripping them on the next edit', async () => {
		const s = store();
		await s.load();
		const visit = s.create(input);
		await s.flush();
		const raw = { ...visit, futureField: 'keep this' };
		await s.receive({ id: crypto.randomUUID(), owner_id: A, rev: 1, deleted_at: null, doc: raw });
		expect(s.quarantine[0].raw).toEqual(raw);
	});
	it('does not expose another owner’s sessions or quarantine', async () => {
		const s = store();
		await s.load();
		const visit = s.create(input);
		await s.flush();
		s.setOwner(B);
		expect(s.list).toHaveLength(0);
		expect(s.find(visit.id)).toBeNull();
		s.setOwner(null);
		expect(s.list).toHaveLength(0);
		s.setOwner(A);
		expect(s.find(visit.id)).not.toBeNull();
	});
	it('R9 removes local photo blobs when a cloud tombstone arrives', async () => {
		const s = store();
		await s.load();
		const visit = s.create(input);
		const key = photoKey(visit.id, visit.groups[0].id, 'inseto');
		await savePhoto(key, new File(['nature'], 'nature.jpg', { type: 'image/jpeg' }));
		s.addPhoto(visit, key);
		await s.flush();
		const op = await s.nextOperation();
		assert(op);
		await s.acknowledge(visit.id, op.operation, 1);
		await s.receive({ id: visit.id, owner_id: A, rev: 2, deleted_at: new Date().toISOString(), doc: {} });
		expect(s.find(visit.id)).toBeNull();
		expect(await readPhoto(key)).toBeUndefined();
	});
	it('wipes a deleted guest document locally without leaving an upload intent', async () => {
		const repository = new IndexedRepository(`guest-delete-${crypto.randomUUID()}`),
			s = store(null, repository);
		await s.load();
		const visit = s.create(input);
		await s.remove(visit.id);
		const [record] = (await repository.read()) as LocalRecord[];
		expect(record.session).toBeNull();
		expect(record.ackedRev).toBe(record.rev);
		expect(s.guestCount).toBe(0);
	});
	it('preserves an uncommitted write on storage failure and retries it without reloading over memory', async () => {
		const repository = new IndexedRepository(`disk-${crypto.randomUUID()}`);
		let fail = false;
		const s = store(A, {
			read: () => repository.read(),
			write: (rows) => (fail ? Promise.reject(Error('disk')) : repository.write(rows)),
			close: () => repository.close()
		});
		await s.load();
		fail = true;
		const visit = s.create(input);
		await expect(s.flush()).rejects.toThrow();
		expect(s.ready).toBe(false);
		expect(s.find(visit.id)).not.toBeNull();
		fail = false;
		await s.load();
		expect(s.ready).toBe(true);
		expect(await repository.read()).toHaveLength(1);
	});
});

describe('persistent CAS outbox', () => {
	it('R1 never uploads guest visits on sign-in; explicit import is required', async () => {
		const s = store(null);
		await s.load();
		const guest = s.create(input);
		await s.flush();
		const { sync, cloud } = await connected(s, new Cloud(), new Identity(B));
		expect(sync.guestCount).toBe(1);
		expect(s.list).toHaveLength(0);
		expect(cloud.pushes).toHaveLength(0);
		await sync.importGuestSessions();
		expect(cloud.rows.get(guest.id)?.owner_id).toBe(B);
		expect(sync.guestCount).toBe(0);
	});
	it('R2 keeps deletion intent while the very first upload is in flight', async () => {
		const s = store();
		const { sync, cloud } = await connected(s);
		const entered = deferred(),
			release = deferred();
		cloud.beforePush = async () => {
			entered.resolve();
			await release.promise;
		};
		const visit = s.create(input);
		const upload = sync.run();
		await entered.promise;
		await s.remove(visit.id);
		release.resolve();
		await upload;
		expect(cloud.rows.get(visit.id)?.deleted_at).not.toBeNull();
		expect(sync.pending).toBe(0);
		await sync.run({ pull: true });
		expect(s.find(visit.id)).toBeNull();
	});
	it('R3 deletes a synced visit even when the phone clock moves backwards', async () => {
		const s = store();
		const { sync, cloud } = await connected(s);
		const visit = s.create(input);
		await sync.run();
		vi.spyOn(Date, 'now').mockReturnValue(1000);
		await s.remove(visit.id);
		await sync.run();
		expect(cloud.rows.get(visit.id)?.deleted_at).not.toBeNull();
		expect(sync.pending).toBe(0);
	});
	it('R5 keeps edits made while an earlier revision is uploading', async () => {
		const s = store();
		const { sync, cloud } = await connected(s);
		const visit = s.create(input);
		await sync.run();
		const entered = deferred(),
			release = deferred();
		let first = true;
		cloud.beforePush = async () => {
			if (first) {
				first = false;
				entered.resolve();
				await release.promise;
			}
		};
		s.score(visit, visit.groups[0].id, 1, null);
		const upload = sync.run();
		await entered.promise;
		s.score(visit, visit.groups[0].id, 1, null);
		release.resolve();
		await upload;
		expect((cloud.rows.get(visit.id)?.doc as Session | undefined)?.scores).toHaveLength(2);
		expect(sync.pending).toBe(0);
	});
	it('R6 preserves local changes as a duplicate rather than ACKing a CAS conflict', async () => {
		const s = store();
		const { sync, cloud } = await connected(s);
		const visit = s.create(input);
		await sync.run();
		const remote = cloud.rows.get(visit.id);
		assert(remote);
		remote.rev++;
		remote.doc = { ...(remote.doc as Session), school: 'Server school' };
		remote.last_mutation_id = crypto.randomUUID();
		s.score(visit, visit.groups[0].id, 1, null);
		await sync.run();
		expect(s.find(visit.id)?.school).toBe('Server school');
		const copy = s.list.find((s) => s.id !== visit.id);
		assert(copy);
		expect(copy.school).toBe(`${input.school} (cópia deste celular)`);
		expect(copy.scores).toHaveLength(1);
		expect(copy.certificateCode).not.toBe(visit.certificateCode);
		expect(cloud.rows.has(copy.id)).toBe(true);
	});
	it('does not acknowledge a nominal ok response without the matching server mutation', async () => {
		const s = store();
		const { sync, cloud } = await connected(s);
		s.create(input);
		cloud.push = async () => ({ status: 'ok', rev: 1, server_doc: null });
		await sync.run();
		expect(sync.status).toBe('error');
		expect(sync.pending).toBe(1);
	});
	it('conflict copies preserve photo bytes under the new session ID', async () => {
		const s = store();
		const { sync, cloud } = await connected(s);
		const visit = s.create(input);
		const key = photoKey(visit.id, visit.groups[0].id, 'inseto');
		await savePhoto(key, new File(['photo bytes'], 'nature.jpg', { type: 'image/jpeg' }));
		s.addPhoto(visit, key);
		await sync.run();
		const remote = cloud.rows.get(visit.id);
		assert(remote);
		remote.rev++;
		remote.last_mutation_id = crypto.randomUUID();
		s.score(visit, visit.groups[0].id, 1, null);
		await sync.run();
		const copy = s.list.find((entry) => entry.id !== visit.id);
		assert(copy);
		expect(copy.photos).toHaveLength(1);
		expect(copy.photos[0].startsWith(`${copy.id}:`)).toBe(true);
		expect(await (await readPhoto(copy.photos[0]))?.text()).toBe('photo bytes');
	});
	it('invalidates conflict work across an A to B to A authentication generation change', async () => {
		const s = store();
		await s.load();
		const visit = s.create(input);
		await s.flush();
		const entered = deferred(),
			release = deferred();
		vi.spyOn(photos, 'copySessionPhotos').mockImplementation(async () => {
			entered.resolve();
			await release.promise;
			return [];
		});
		let generation = 1;
		const conflict = s.resolveConflict(
			visit.id,
			{ id: visit.id, owner_id: A, rev: 2, deleted_at: null, doc: { ...visit, school: 'Remote' } },
			() => generation === 1
		);
		await entered.promise;
		s.setOwner(B);
		generation++;
		s.setOwner(A);
		generation++;
		release.resolve();
		await conflict;
		expect(s.list).toHaveLength(1);
		expect(s.find(visit.id)?.school).toBe(input.school);
		expect(s.pendingCount).toBe(1);
	});
	it('R10 accumulates a pull requested while an upload is busy', async () => {
		const s = store();
		const { sync, cloud } = await connected(s);
		const entered = deferred(),
			release = deferred();
		cloud.beforePush = async () => {
			entered.resolve();
			await release.promise;
		};
		s.create(input);
		const upload = sync.run();
		await entered.promise;
		const before = cloud.pulls;
		const pull = sync.run({ pull: true });
		release.resolve();
		await Promise.all([upload, pull]);
		expect(cloud.pulls).toBeGreaterThan(before);
	});
	it('retries the same durable mutation after a response is lost and the app restarts', async () => {
		const name = `restart-${crypto.randomUUID()}`,
			writer = lock(),
			cloud = new Cloud();
		const s = store(A, new IndexedRepository(name), writer);
		const { sync } = await connected(s, cloud);
		s.create(input);
		cloud.loseReply = true;
		await sync.run();
		expect(sync.status).toBe('error');
		const mutation = cloud.pushes[0].mutationId;
		sync.dispose();
		s.close();
		const next = store(A, new IndexedRepository(name), writer);
		const resumed = await connected(next, cloud);
		expect(cloud.pushes.at(-1)?.mutationId).toBe(mutation);
		expect(cloud.rows.size).toBe(1);
		expect(resumed.sync.pending).toBe(0);
		expect(next.list).toHaveLength(1);
	});
	it('persists a tombstone across closing and reopening before any network call', async () => {
		const name = `delete-restart-${crypto.randomUUID()}`,
			writer = lock(),
			cloud = new Cloud();
		const s = store(A, new IndexedRepository(name), writer);
		const { sync } = await connected(s, cloud);
		const visit = s.create(input);
		await sync.run();
		await s.remove(visit.id);
		sync.dispose();
		s.close();
		const next = store(A, new IndexedRepository(name), writer);
		await connected(next, cloud);
		expect(cloud.rows.get(visit.id)?.deleted_at).not.toBeNull();
		expect(next.list).toHaveLength(0);
	});
	it('ignores an old account response after switching to another guide', async () => {
		const s = store(),
			identity = new Identity();
		const { sync, cloud } = await connected(s, new Cloud(), identity);
		const entered = deferred(),
			release = deferred();
		cloud.beforePush = async () => {
			entered.resolve();
			await release.promise;
		};
		const visit = s.create(input);
		const run = sync.run();
		await entered.promise;
		identity.change(B);
		release.resolve();
		await run;
		expect(s.ownerId).toBe(B);
		expect(s.list).toHaveLength(0);
		expect(cloud.pushes.every((p) => p.session.ownerId === A)).toBe(true);
		identity.change(A);
		await sync.run({ pull: true });
		expect(s.find(visit.id)).not.toBeNull();
	});
	it('does not push or pull while offline', async () => {
		const s = store();
		await s.load();
		s.create(input);
		const cloud = new Cloud();
		const sync = new CloudSync({ store: s, client: cloud, identity: new Identity(), online: () => false });
		syncs.push(sync);
		await sync.init();
		expect(sync.status).toBe('offline');
		expect(sync.pending).toBe(1);
		expect(cloud.pushes).toHaveLength(0);
		expect(cloud.pulls).toBe(0);
	});
	it('retries transient failures without needing another edit or visibility event', async () => {
		const s = store();
		const { sync, cloud } = await connected(s, new Cloud(), new Identity(), { retryBaseMs: 100 });
		vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
		cloud.failures = 1;
		s.create(input);
		await sync.run();
		expect(sync.status).toBe('error');
		await vi.advanceTimersByTimeAsync(101);
		await sync.run();
		expect(sync.status).toBe('idle');
		expect(sync.pending).toBe(0);
	});
	it('aborts a hung request at the timeout and keeps its revision pending', async () => {
		const s = store();
		const { sync, cloud } = await connected(s, new Cloud(), new Identity(), { timeoutMs: 100 });
		const entered = deferred();
		cloud.beforePush = async () => {
			entered.resolve();
			await new Promise(() => {});
		};
		vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
		s.create(input);
		const run = sync.run();
		await entered.promise;
		await vi.advanceTimersByTimeAsync(101);
		await run;
		expect(sync.status).toBe('error');
		expect(sync.pending).toBe(1);
	});
	it('keeps server tombstones and a local conflict copy when another device deleted a dirty session', async () => {
		const s = store();
		const { sync, cloud } = await connected(s);
		const visit = s.create(input);
		await sync.run();
		const remote = cloud.rows.get(visit.id);
		assert(remote);
		remote.rev++;
		remote.deleted_at = new Date().toISOString();
		remote.doc = {};
		remote.last_mutation_id = crypto.randomUUID();
		s.score(visit, visit.groups[0].id, 1, null);
		await sync.run();
		expect(s.find(visit.id)).toBeNull();
		expect(s.list).toHaveLength(1);
		expect(s.list[0].scores).toHaveLength(1);
	});
});

describe('hardened RPC conflicts', () => {
	it('regenerates a taken certificate code on the same session ID and retries the latest revision', async () => {
		const s = store(),
			{ sync, cloud } = await connected(s);
		const visit = s.create(input);
		const originalCode = visit.certificateCode,
			push = cloud.push,
			calls: Session[] = [];
		cloud.push = async (session, base, mutation) => {
			calls.push(structuredClone(session));
			if (calls.length === 1) {
				s.score(visit, visit.groups[0].id, 1, null);
				return { status: 'conflict', rev: 0, server_doc: null, reason: 'certificate_code_taken' };
			}
			return push(session, base, mutation);
		};
		await sync.run();
		expect(calls).toHaveLength(2);
		expect(s.list).toHaveLength(1);
		expect(calls[1].id).toBe(visit.id);
		expect(calls[1].rev).toBeGreaterThan(calls[0].rev);
		expect(calls[1].certificateCode).not.toBe(originalCode);
		expect(calls[1].certificateCode).toMatch(/^[0-9A-HJKMNP-TV-Z]{8}$/);
		expect(calls[1].scores).toHaveLength(1);
		expect(sync.pending).toBe(0);
	});
	it('caps certificate regenerations durably without forking, losing the session or retrying forever', async () => {
		const name = `certificate-cap-${crypto.randomUUID()}`,
			s = store(A, new IndexedRepository(name));
		const { sync, cloud } = await connected(s);
		vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
		const visit = s.create(input);
		let calls = 0;
		cloud.push = async () => {
			calls++;
			return { status: 'conflict', rev: 0, server_doc: null, reason: 'certificate_code_taken' };
		};
		await sync.run();
		expect(calls).toBe(6);
		expect(s.list).toHaveLength(1);
		expect(s.find(visit.id)).not.toBeNull();
		expect(s.error).toBeTruthy();
		expect(sync.status).toBe('error');
		expect(sync.pending).toBe(1);
		await vi.advanceTimersByTimeAsync(120000);
		expect(calls).toBe(6);
		await sync.run();
		expect(calls).toBe(6);
		sync.dispose();
		s.close();
		const restored = store(A, new IndexedRepository(name));
		const next = await connected(restored, cloud);
		expect(calls).toBe(6);
		expect(restored.find(visit.id)).not.toBeNull();
		expect(restored.error).toBeTruthy();
		expect(next.sync.status).toBe('error');
	});
	it('honors deletion made while the rejected certificate upload was in flight', async () => {
		const s = store(),
			{ sync, cloud } = await connected(s),
			visit = s.create(input);
		let pushes = 0;
		cloud.push = async () => {
			pushes++;
			await s.remove(visit.id);
			return { status: 'conflict', rev: 0, server_doc: null, reason: 'certificate_code_taken' };
		};
		await sync.run();
		expect(pushes).toBe(1);
		expect(s.list).toHaveLength(0);
		expect(sync.pending).toBe(0);
	});
	it('continues syncing other sessions and permits removing a paused session', async () => {
		const s = store(),
			{ sync, cloud } = await connected(s),
			visit = s.create(input),
			push = cloud.push;
		cloud.push = async (session, base, mutation) =>
			session.id === visit.id
				? { status: 'conflict', rev: 0, server_doc: null, reason: 'certificate_code_taken' }
				: push(session, base, mutation);
		await sync.run();
		const other = s.create(input);
		await sync.run();
		expect(cloud.rows.has(other.id)).toBe(true);
		expect(sync.pending).toBe(1);
		expect(s.find(visit.id)).not.toBeNull();
		await s.remove(visit.id);
		await sync.run();
		expect(sync.pending).toBe(0);
		expect(sync.status).toBe('idle');
		expect(s.error).toBeNull();
	});
	it('forks a foreign-owned ID, retires its old local record and pushes the preserved journey once', async () => {
		const s = store(),
			{ sync, cloud } = await connected(s),
			visit = s.create(input);
		s.score(visit, visit.groups[0].id, 1, null);
		const push = cloud.push;
		let collisions = 0;
		const foreign = {
			id: visit.id,
			owner_id: B,
			rev: 1,
			doc: { secret: 'synthetic foreign data' },
			deleted_at: null
		};
		cloud.rows.set(visit.id, foreign);
		cloud.push = async (session, base, mutation) => {
			if (session.id === visit.id) {
				collisions++;
				return { status: 'conflict', rev: 0, server_doc: null };
			}
			return push(session, base, mutation);
		};
		await sync.run();
		expect(s.find(visit.id)).toBeNull();
		expect(s.list).toHaveLength(1);
		const copy = s.list[0];
		expect(copy.id).not.toBe(visit.id);
		expect(copy.ownerId).toBe(A);
		expect(copy.scores).toHaveLength(1);
		expect(cloud.rows.get(visit.id)).toEqual(foreign);
		expect(cloud.rows.get(copy.id)?.owner_id).toBe(A);
		expect(sync.pending).toBe(0);
		await sync.run({ pull: true });
		expect(collisions).toBe(1);
		expect(s.list).toHaveLength(1);
	});
	it('treats an unknown reason as a generic server conflict', async () => {
		const s = store(),
			{ sync, cloud } = await connected(s),
			visit = s.create(input);
		const push = cloud.push;
		const server = {
			id: visit.id,
			owner_id: A,
			rev: 1,
			doc: { ...visit, school: 'Server school' },
			deleted_at: null
		};
		cloud.rows.set(visit.id, server);
		cloud.push = async (session, base, mutation) =>
			session.id === visit.id
				? { status: 'conflict', rev: 1, server_doc: server, reason: 'future_reason' }
				: push(session, base, mutation);
		await sync.run();
		expect(s.find(visit.id)?.school).toBe('Server school');
		expect(s.list).toHaveLength(2);
		expect(s.list.find((entry) => entry.id !== visit.id)?.school).toBe(
			`${input.school} (cópia deste celular)`
		);
		expect(sync.pending).toBe(0);
	});
	it('bounds repeated anonymous conflicts instead of endlessly making fresh IDs', async () => {
		const s = store(),
			{ sync, cloud } = await connected(s);
		s.create(input);
		let calls = 0;
		cloud.push = async () => {
			calls++;
			return { status: 'conflict', rev: 0, server_doc: null, reason: 'future_reason' };
		};
		await sync.run();
		expect(calls).toBe(6);
		expect(s.list).toHaveLength(1);
		expect(s.error).toBeTruthy();
		expect(sync.status).toBe('error');
		await sync.run();
		expect(calls).toBe(6);
	});
});
