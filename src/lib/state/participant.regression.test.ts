import { afterEach, assert, expect, it } from 'vitest';
import { IndexedRepository, type LocalRecord } from '#lib/data/repository.ts';
import { decodeSession } from '#lib/data/session-schema.ts';
import { normalizeSession, type Session, todayIso } from '#lib/session.ts';
import { Sessions } from './sessions.svelte.ts';

const A = '11111111-1111-4111-8111-111111111111';
const groups = [
	{ name: 'Canela', color: '#123456' },
	{ name: 'Cedro', color: '#654321' }
];
const stores: Sessions[] = [];
async function open(repository = new IndexedRepository(`participant-${crypto.randomUUID()}`)) {
	const store = new Sessions({ repository, ownerId: A, lock: async () => () => {} });
	stores.push(store);
	await store.load();
	return store;
}
afterEach(() => {
	for (const store of stores.splice(0)) store.close();
});

it('creates a named participant in the selected generated group without school metadata', async () => {
	const store = await open();
	const session = store.create({ participant: '  Ana  ', groups, myGroupIndex: 1, startStep: 1 });
	expect(session.participant).toBe('Ana');
	expect(session.myGroupId).toBe(session.groups[1].id);
	expect(session.school).toBe('');
	expect(session.className).toBe('');
	expect(session.guide).toBe('');
	expect(session.date).toBe(todayIso());
	expect(session.step).toBe(1);
	expect(session.journeyId).toBe('penap');
	await store.flush();
});
it.each(['', '   ', 'x'.repeat(41)])(
	'rejects an invalid participant name %j without creating a record',
	async (participant) => {
		const store = await open();
		expect(() => store.create({ participant, groups, myGroupIndex: 0 })).toThrow();
		expect(store.list).toHaveLength(0);
	}
);
it.each([-1, 2, 0.5, Number.NaN])(
	'rejects an out-of-range/noninteger group index %s',
	async (myGroupIndex) => {
		const store = await open();
		expect(() => store.create({ participant: 'Ana', groups, myGroupIndex })).toThrow();
		expect(store.list).toHaveLength(0);
	}
);
it('accepts a trimmed 40-character name, keeps optional legacy fields and starts at zero by default', async () => {
	const store = await open();
	const session = store.create({
		participant: ` ${'a'.repeat(40)} `,
		groups,
		myGroupIndex: 0,
		school: 'School',
		className: 'Class',
		guide: 'Guide',
		date: '2026-10-25'
	});
	expect(session.participant).toHaveLength(40);
	expect(session.school).toBe('School');
	expect(session.className).toBe('Class');
	expect(session.guide).toBe('Guide');
	expect(session.step).toBe(0);
	await store.flush();
});
it('rejects an empty group list or invalid starting step', async () => {
	const store = await open();
	expect(() => store.create({ participant: 'Ana', groups: [], myGroupIndex: 0 })).toThrow();
	expect(() => store.create({ participant: 'Ana', groups, myGroupIndex: 0, startStep: -1 })).toThrow();
	expect(store.list).toHaveLength(0);
});
it('loads legacy IDB and cloud documents with defaults rather than quarantining them', async () => {
	const repository = new IndexedRepository(`participant-legacy-${crypto.randomUUID()}`);
	const normalized = normalizeSession({ id: crypto.randomUUID(), ownerId: A });
	const legacy = { ...normalized } as Record<string, unknown>;
	delete legacy.participant;
	delete legacy.myGroupId;
	const record = {
		id: normalized.id,
		ownerId: A,
		rev: 1,
		ackedRev: 1,
		serverRev: 1,
		deleted: false,
		session: legacy
	} as unknown as LocalRecord;
	await repository.write([record]);
	const store = await open(repository);
	expect(store.find(normalized.id)?.participant).toBe('');
	expect(store.find(normalized.id)?.myGroupId).toBeNull();
	expect(store.quarantine).toHaveLength(0);
	const remoteId = crypto.randomUUID();
	await store.receive({
		id: remoteId,
		owner_id: A,
		rev: 1,
		deleted_at: null,
		doc: { ...legacy, id: remoteId }
	});
	expect(store.find(remoteId)?.participant).toBe('');
	expect(store.find(remoteId)?.myGroupId).toBeNull();
	expect(store.quarantine).toHaveLength(0);
	expect(normalizeSession({ id: crypto.randomUUID() }).participant).toBe('');
	expect(normalizeSession({ id: crypto.randomUUID() }).myGroupId).toBeNull();
});
it('renames and changes group with increasing revisions, durable storage and a pending outbox', async () => {
	const repository = new IndexedRepository(`participant-mutate-${crypto.randomUUID()}`),
		store = await open(repository);
	const session = store.create({ participant: 'Ana', groups, myGroupIndex: 0 });
	await store.flush();
	const operation = await store.nextOperation();
	assert(operation);
	await store.acknowledge(session.id, operation.operation, 1);
	store.rename(session, '  Bruno  ');
	store.setMyGroup(session, session.groups[1].id);
	await store.flush();
	const saved = store.find(session.id);
	assert(saved);
	expect(saved.participant).toBe('Bruno');
	expect(saved.myGroupId).toBe(session.groups[1].id);
	expect(saved.rev).toBe(3);
	expect(store.pendingCount).toBe(1);
	const [record] = (await repository.read()) as LocalRecord[];
	expect(record.session?.participant).toBe('Bruno');
	expect(record.session?.myGroupId).toBe(saved.myGroupId);
	expect(() => store.rename(session, ' ')).toThrow();
	expect(() => store.setMyGroup(session, 'unknown')).toThrow();
	expect(store.find(session.id)?.rev).toBe(3);
	await store.flush();
});
it('resolves stale references before renaming and choosing a group', async () => {
	const store = await open(),
		stale = store.create({ participant: 'Ana', groups, myGroupIndex: 0 });
	await store.flush();
	const operation = await store.nextOperation();
	assert(operation);
	await store.acknowledge(stale.id, operation.operation, 1);
	await store.receive({
		id: stale.id,
		owner_id: A,
		rev: 2,
		deleted_at: null,
		doc: { ...stale, school: 'Remote school' }
	});
	store.rename(stale, 'Bruno');
	store.setMyGroup(stale, stale.groups[1].id);
	await store.flush();
	expect(store.find(stale.id)?.school).toBe('Remote school');
	expect(store.find(stale.id)?.participant).toBe('Bruno');
	expect(store.find(stale.id)?.myGroupId).toBe(stale.groups[1].id);
});
it('rejects a saved selection that does not belong to the session', () => {
	const session = normalizeSession({ id: crypto.randomUUID(), myGroupId: 'unknown' } as Partial<Session> &
		Pick<Session, 'id'>);
	expect(decodeSession(session).session).toBeUndefined();
});
