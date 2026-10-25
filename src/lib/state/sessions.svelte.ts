import * as v from 'valibot';
import { journeys, penap } from '#lib/content/penap.ts';
import type { Journey } from '#lib/content/types.ts';
import { decodeSession } from '#lib/data/session-schema.ts';
import { clearJournalEntry, clearJournalRecord, journalRecord, readJournal } from '#lib/data/journal.ts';
import {
	IndexedRepository,
	acquireWriter,
	type LocalRecord,
	type Operation,
	type Repository,
	type WriterLease,
	type WriterLock
} from '#lib/data/repository.ts';
import { copySessionPhotos, deletePhoto, deleteSessionPhotos } from '#lib/photos.ts';
import {
	currentStep,
	gainsBetween,
	newCertificateCode,
	newId,
	normalizeSession,
	progressOf,
	type Gains,
	type Group,
	type ScoreEvent,
	type Session
} from '#lib/session.ts';

export type SessionChange = { kind: 'saved' | 'removed' | 'remote'; id: string };
export interface NewSession {
	school: string;
	className: string;
	guide: string;
	date: string;
	groups: Omit<Group, 'id'>[];
}
export interface RemoteSession {
	id: string;
	owner_id: string;
	rev: number;
	doc: unknown;
	deleted_at: string | null;
	last_mutation_id?: string | null;
}
interface Options {
	repository?: Repository;
	lock?: WriterLock;
	ownerId?: string | null;
}

export class Sessions {
	#records = $state<LocalRecord[]>([]);
	ownerId = $state<string | null>(null);
	loaded = $state(false);
	readOnly = $state(true);
	error = $state<string | null>(null);
	#identityReady = $state(false);
	#healthy = $state(false);
	#readOK = $state(false);
	#writeFailed = false;
	#repository: Repository;
	#lock: WriterLock;
	#release: WriterLease | null = null;
	#writerRetry?: ReturnType<typeof setTimeout>;
	#closed = false;
	#loading: Promise<void> | null = null;
	#writes = new Map<string, LocalRecord>();
	#draining: Promise<void> | null = null;
	#listeners = new Set<(change: SessionChange) => void>();
	constructor(options: Options = {}) {
		this.#repository = options.repository ?? new IndexedRepository();
		this.#lock = options.lock ?? acquireWriter;
		if ('ownerId' in options) this.setOwner(options.ownerId ?? null);
	}
	get ready() {
		return this.loaded && this.#readOK && this.#healthy && !this.readOnly && this.#identityReady;
	}
	get list(): Session[] {
		return this.#records
			.filter((r) => r.ownerId === this.ownerId && !r.deleted && !r.quarantine && r.session)
			.map((r) => r.session!);
	}
	get quarantine() {
		return this.#records
			.filter((r) => r.ownerId === this.ownerId && r.quarantine)
			.map((r) => ({ id: r.id, ...r.quarantine! }));
	}
	get guestCount() {
		return this.#records.filter((r) => r.ownerId === null && !r.deleted && !!r.session && !r.quarantine)
			.length;
	}
	get pendingCount() {
		return this.ownerId
			? this.#records.filter(
					(r) => r.ownerId === this.ownerId && !r.quarantine && (r.rev > r.ackedRev || r.inflight)
				).length
			: 0;
	}
	setOwner(ownerId: string | null) {
		this.ownerId = ownerId;
		this.#identityReady = true;
	}
	onChange(listener: (change: SessionChange) => void) {
		this.#listeners.add(listener);
		return () => {
			this.#listeners.delete(listener);
		};
	}
	#emit(kind: SessionChange['kind'], id: string) {
		for (const listener of this.#listeners) listener({ kind, id });
	}

	load(): Promise<void> {
		if (this.#closed) return Promise.resolve();
		if (this.#loading) return this.#loading;
		if (this.loaded && this.#readOK && this.#healthy && !this.readOnly) return Promise.resolve();
		this.#loading = this.#load().finally(() => {
			this.#loading = null;
		});
		return this.#loading;
	}
	async #load() {
		try {
			if (!this.#release) {
				const lease = await this.#lock();
				if (this.#closed) {
					lease?.();
					return;
				}
				if (lease && !this.#writes.size) this.#readOK = false;
				this.#release = lease;
				void lease?.lost?.then(() => {
					if (this.#release !== lease || this.#closed) return;
					this.#release = null;
					this.readOnly = true;
					this.#readOK = false;
					this.#retryWriter();
				});
			}
			this.readOnly = !this.#release;
			if (this.#writes.size) {
				await this.flush();
				return;
			}
			if (!this.readOnly && this.#repository instanceof IndexedRepository)
				await this.#repository.migrateLegacy((raw) => this.#legacy(raw));
			this.#readOK = false;
			this.#records = (await this.#repository.read()).map((raw) => this.#decodeRecord(raw));
			if (!this.readOnly) await this.#recoverJournal();
			this.#readOK = true;
			this.#healthy = true;
			this.error = null;
			if (!this.readOnly) await this.#cleanup();
		} catch {
			this.#healthy = false;
			this.error = 'Não foi possível ler as jornadas. Tente abrir novamente antes de fazer alterações.';
		} finally {
			this.loaded = true;
			this.#retryWriter();
		}
	}
	#retryWriter() {
		clearTimeout(this.#writerRetry);
		if (this.#closed || !this.readOnly) return;
		this.#writerRetry = setTimeout(() => {
			void this.load();
		}, 2000);
	}
	async #recoverJournal() {
		const entries = readJournal();
		const records = new Map(this.#records.map((record) => [record.id, record]));
		const recovered: LocalRecord[] = [];
		for (const entry of entries) {
			let record = this.#decodeRecord(entry.raw);
			const stored = records.get(entry.id);
			const validId = v.safeParse(v.pipe(v.string(), v.uuid()), entry.id).success;
			if (
				!entry.parsed ||
				!validId ||
				record.id !== entry.id ||
				(record.quarantine && !stored?.quarantine) ||
				(stored && stored.ownerId !== record.ownerId)
			) {
				// Preserve damaged input separately; never overwrite a good durable copy.
				const owner = v.safeParse(v.nullable(v.pipe(v.string(), v.uuid())), record.ownerId);
				record = {
					id: validId && !stored ? entry.id : crypto.randomUUID(),
					ownerId: owner.success ? owner.output : null,
					rev: 1,
					ackedRev: 1,
					serverRev: 0,
					deleted: false,
					session: null,
					quarantine: {
						reason:
							record.quarantine?.reason ??
							'Registro local de recuperação inválido. O original foi preservado.',
						raw: entry.raw
					}
				};
			} else if (stored && record.rev <= stored.rev) continue;
			records.set(record.id, record);
			recovered.push(record);
		}
		// Do not consume journal entries until their recovery transaction completes.
		if (recovered.length) await this.#repository.write(recovered);
		this.#records = [...records.values()];
		for (const entry of entries) clearJournalEntry(entry.key, entry.text);
	}
	#legacy(raw: unknown): LocalRecord {
		const data = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
		const parsed = decodeSession({ ...data, ownerId: null, rev: 1 });
		return {
			id: typeof data.id === 'string' ? data.id : crypto.randomUUID(),
			ownerId: null,
			rev: 1,
			ackedRev: 0,
			serverRev: 0,
			deleted: false,
			session: parsed.session ?? null,
			...(!parsed.session ? { quarantine: { reason: parsed.reason, raw } } : {})
		};
	}
	#decodeRecord(raw: unknown): LocalRecord {
		const integer = v.pipe(v.number(), v.safeInteger(), v.minValue(0));
		const schema = v.object({
			id: v.pipe(v.string(), v.uuid()),
			ownerId: v.nullable(v.pipe(v.string(), v.uuid())),
			rev: v.pipe(integer, v.minValue(1)),
			ackedRev: integer,
			serverRev: integer,
			deleted: v.boolean(),
			session: v.unknown(),
			inflight: v.optional(v.unknown()),
			quarantine: v.optional(v.object({ reason: v.string(), raw: v.unknown() })),
			cleanupPhotos: v.optional(v.boolean())
		});
		const result = v.safeParse(schema, raw);
		if (!result.success) {
			const envelope = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
			return {
				id: typeof envelope.id === 'string' ? envelope.id : crypto.randomUUID(),
				ownerId: typeof envelope.ownerId === 'string' ? envelope.ownerId : null,
				rev: 1,
				ackedRev: 1,
				serverRev: 0,
				deleted: false,
				session: null,
				quarantine: { reason: 'Fila local inválida. O original foi preservado.', raw }
			};
		}
		const r = result.output as LocalRecord;
		const invalid = (reason: string): LocalRecord => ({
			...r,
			session: null,
			inflight: undefined,
			quarantine: { reason, raw }
		});
		if (r.ackedRev > r.rev) return invalid('Revisões locais incompatíveis.');
		if (r.inflight) {
			const op = v.safeParse(
				v.object({
					mutationId: v.pipe(v.string(), v.uuid()),
					rev: v.pipe(integer, v.minValue(1)),
					baseRev: integer,
					kind: v.picklist(['push', 'delete']),
					session: v.unknown()
				}),
				r.inflight
			);
			if (!op.success || op.output.rev > r.rev) return invalid('Operação pendente inválida.');
			if (op.output.kind === 'push') {
				const sent = decodeSession(op.output.session);
				if (
					!sent.session ||
					sent.session.id !== r.id ||
					sent.session.ownerId !== r.ownerId ||
					sent.session.rev !== op.output.rev
				)
					return invalid('O dono da operação pendente é incompatível.');
			}
		}
		if (r.quarantine || (r.deleted && !r.session)) return r;
		const parsed = decodeSession(r.session);
		if (
			!parsed.session ||
			parsed.session.id !== r.id ||
			parsed.session.ownerId !== r.ownerId ||
			parsed.session.rev !== r.rev
		)
			return invalid(parsed.reason ?? 'Metadados incompatíveis.');
		return { ...r, session: parsed.session };
	}
	#record(id: string) {
		return this.#records.find((r) => r.id === id && r.ownerId === this.ownerId);
	}
	#current(session: Session): Session | null {
		if (!this.ready) {
			this.error = this.readOnly
				? 'Esta janela está somente para leitura. Use a janela principal.'
				: 'Aguarde a leitura e gravação das jornadas antes de alterar.';
			return null;
		}
		return this.find(session.id);
	}
	find(id: string | null): Session | null {
		return this.list.find((s) => s.id === id) ?? null;
	}
	journeyMissing(session: Session) {
		return !journeys[session.journeyId];
	}
	journeyOf(session: Session): Journey {
		return journeys[session.journeyId] ?? penap;
	}

	#commit(records: LocalRecord[], kind: SessionChange['kind']) {
		for (const r of records) {
			const i = this.#records.findIndex((existing) => existing.id === r.id);
			if (i < 0) this.#records.push(r);
			else this.#records[i] = r;
			const snapshot = $state.snapshot(r);
			journalRecord(snapshot);
			this.#writes.set(r.id, snapshot);
		}
		void this.flush()
			.then(() => {
				for (const r of records) this.#emit(kind, r.id);
			})
			.catch(() => {});
	}
	flush(): Promise<void> {
		if (this.#draining) return this.#draining;
		this.#draining = (async () => {
			try {
				while (this.#writes.size) {
					const batch = [...this.#writes.values()];
					await this.#repository.write(batch);
					for (const record of batch) {
						clearJournalRecord(record);
						if (this.#writes.get(record.id) === record) this.#writes.delete(record.id);
					}
				}
				this.#healthy = true;
				if (this.#writeFailed) {
					this.#writeFailed = false;
					this.error = null;
				}
			} catch (error) {
				this.#healthy = false;
				this.#writeFailed = true;
				this.error =
					'Não foi possível salvar neste aparelho. Libere espaço e tente novamente; mantenha esta janela aberta.';
				throw error;
			}
		})().finally(() => {
			this.#draining = null;
		});
		return this.#draining;
	}
	#persist(session: Session) {
		const record = this.#record(session.id)!;
		session.rev = record.rev + 1;
		session.updatedAt = Date.now();
		this.#commit([{ ...record, rev: session.rev, session }], 'saved');
	}
	create(data: NewSession, journeyId = 'penap'): Session {
		if (!this.ready) throw new Error('As jornadas ainda não estão prontas para alterações.');
		const session = normalizeSession({
			id: crypto.randomUUID(),
			ownerId: this.ownerId,
			rev: 1,
			journeyId,
			createdAt: Date.now(),
			updatedAt: Date.now(),
			...data,
			groups: data.groups.map((g) => ({ ...g, id: newId() }))
		});
		const parsed = decodeSession(session);
		if (!parsed.session) throw new Error(parsed.reason);
		this.#commit(
			[
				{
					id: session.id,
					ownerId: this.ownerId,
					session: parsed.session,
					rev: 1,
					ackedRev: 0,
					serverRev: 0,
					deleted: false
				}
			],
			'saved'
		);
		if (typeof navigator !== 'undefined') void navigator.storage?.persist?.().catch(() => {});
		return this.find(session.id)!;
	}
	async remove(id: string) {
		const session = this.find(id);
		if (!session || !this.#current(session)) return;
		const r = this.#record(id)!;
		const rev = r.rev + 1;
		this.#commit(
			[
				{
					...r,
					rev,
					deleted: true,
					session: r.ownerId === null ? null : { ...$state.snapshot(session), rev },
					cleanupPhotos: true,
					ackedRev: r.ownerId === null ? rev : r.ackedRev
				}
			],
			'removed'
		);
		await this.flush();
		await this.#cleanup();
	}
	async forget(id: string) {
		const r = this.#record(id);
		if (!r || !this.ready) return;
		const rev = r.rev + 1;
		this.#commit(
			[{ ...r, rev, ackedRev: rev, session: null, deleted: true, inflight: undefined, cleanupPhotos: true }],
			'remote'
		);
		await this.flush();
		await this.#cleanup();
	}
	async #cleanup() {
		for (const r of this.#records.filter((r) => r.cleanupPhotos)) {
			try {
				await deleteSessionPhotos(r.id);
				const current = this.#records.find((record) => record.id === r.id);
				if (current) this.#commit([{ ...current, cleanupPhotos: false }], 'remote');
			} catch {
				this.error = 'A limpeza de fotos ficou pendente e será tentada novamente.';
			}
		}
		await this.flush();
	}
	advance(s: Session): Gains | null {
		const session = this.#current(s);
		if (!session) return null;
		const journey = this.journeyOf(session),
			step = currentStep(session, journey);
		if (!step) return null;
		if (step.kind === 'mission' && !session.revealed) {
			session.revealed = true;
			this.#persist(session);
			return null;
		}
		const before = progressOf(session, journey);
		if (step.kind === 'oath') session.oathAt = Date.now();
		session.step++;
		session.revealed = false;
		this.#persist(session);
		return step.kind === 'opening' ? null : gainsBetween(journey, step, before, progressOf(session, journey));
	}
	back(s: Session) {
		const session = this.#current(s);
		if (!session) return;
		if (session.revealed) session.revealed = false;
		else if (session.step > 0) {
			session.step--;
			const previous = currentStep(session, this.journeyOf(session));
			session.revealed = previous?.kind === 'mission';
			if (previous?.kind === 'oath') session.oathAt = null;
		}
		this.#persist(session);
	}
	score(s: Session, groupId: string, delta: number, stepId: string | null, item?: string) {
		const session = this.#current(s);
		if (!session || !session.groups.some((g) => g.id === groupId) || !Number.isSafeInteger(delta)) return;
		const event: ScoreEvent = {
			id: newId(),
			at: Date.now(),
			groupId,
			delta,
			stepId,
			...(item ? { item } : {})
		};
		session.scores.push(event);
		this.#persist(session);
	}
	toggleItem(s: Session, groupId: string, stepId: string, item: string): boolean {
		const session = this.#current(s);
		if (!session) return false;
		const i = session.scores.findIndex(
			(e) => e.groupId === groupId && e.stepId === stepId && e.item === item
		);
		if (i < 0) {
			this.score(session, groupId, 1, stepId, item);
			return true;
		}
		session.scores.splice(i, 1);
		this.#persist(session);
		return false;
	}
	undoScore(s: Session): ScoreEvent | null {
		const session = this.#current(s);
		if (!session) return null;
		const event = session.scores.pop() ?? null;
		this.#persist(session);
		return event;
	}
	addPhoto(s: Session, key: string) {
		const session = this.#current(s);
		if (!session) return;
		if (!session.photos.includes(key)) session.photos.push(key);
		this.#persist(session);
	}
	async removePhoto(s: Session, key: string) {
		if (!this.#current(s)) return;
		await deletePhoto(key);
		const session = this.#current(s);
		if (!session) return;
		session.photos = session.photos.filter((p) => p !== key);
		this.#persist(session);
		await this.flush();
	}

	async nextOperation(): Promise<{ id: string; operation: Operation } | null> {
		await this.flush();
		if (!this.ready || !this.ownerId) return null;
		const r = this.#records.find(
			(r) => r.ownerId === this.ownerId && !r.quarantine && (r.rev > r.ackedRev || r.inflight)
		);
		if (!r) return null;
		const operation = r.inflight ?? {
			mutationId: crypto.randomUUID(),
			rev: r.rev,
			baseRev: r.serverRev,
			kind: r.deleted ? 'delete' : 'push',
			session: $state.snapshot(r.session)
		};
		this.#commit([{ ...r, inflight: operation }], 'remote');
		await this.flush();
		return { id: r.id, operation: $state.snapshot(operation) };
	}
	async acknowledge(id: string, operation: Operation, serverRev: number) {
		const r = this.#record(id);
		if (!r || r.inflight?.mutationId !== operation.mutationId) return;
		const done = r.deleted && r.rev === operation.rev;
		this.#commit(
			[
				{
					...r,
					ackedRev: Math.max(r.ackedRev, operation.rev),
					serverRev,
					inflight: undefined,
					...(done ? { session: null, cleanupPhotos: true } : {})
				}
			],
			'remote'
		);
		await this.flush();
		if (done) await this.#cleanup();
	}
	async receive(remote: RemoteSession, isCurrent: () => boolean = () => true) {
		if (!isCurrent() || !this.ready || remote.owner_id !== this.ownerId) return;
		const r = this.#record(remote.id);
		if (r && remote.rev <= r.serverRev) return;
		if (r && (r.rev > r.ackedRev || r.inflight)) {
			await this.resolveConflict(remote.id, remote, isCurrent);
			return;
		}
		const rev = (r?.rev ?? 0) + 1;
		const parsed = remote.deleted_at
			? null
			: decodeSession({ ...(remote.doc as object), id: remote.id, ownerId: remote.owner_id, rev });
		this.#commit(
			[
				{
					id: remote.id,
					ownerId: remote.owner_id,
					rev,
					ackedRev: rev,
					serverRev: remote.rev,
					deleted: !!remote.deleted_at,
					session: parsed?.session ?? null,
					...(parsed && !parsed.session ? { quarantine: { reason: parsed.reason, raw: remote.doc } } : {}),
					...(remote.deleted_at ? { cleanupPhotos: true } : {})
				}
			],
			'remote'
		);
		await this.flush();
		if (remote.deleted_at) await this.#cleanup();
	}
	async resolveConflict(id: string, remote: RemoteSession | null, isCurrent: () => boolean = () => true) {
		const owner = this.ownerId;
		const duplicateId = crypto.randomUUID();
		let r = this.#record(id);
		if (!r || !isCurrent()) return;
		let copy: Session | null = null;
		while (r.session) {
			const snapshot = $state.snapshot(r.session),
				version = r.rev;
			const photos = await copySessionPhotos(snapshot.photos, id, duplicateId);
			if (this.ownerId !== owner || !isCurrent()) {
				await deleteSessionPhotos(duplicateId);
				return;
			}
			r = this.#record(id)!;
			if (r.rev !== version) continue;
			copy = {
				...snapshot,
				id: duplicateId,
				rev: 1,
				school: snapshot.school + ' (cópia deste celular)',
				certificateCode: newCertificateCode(),
				photos
			};
			break;
		}
		if (this.ownerId !== owner || !isCurrent()) return;
		const rev = r.rev + 1;
		const parsed =
			remote && !remote.deleted_at
				? decodeSession({ ...(remote.doc as object), id, ownerId: owner, rev })
				: null;
		const original: LocalRecord = {
			id,
			ownerId: owner,
			rev,
			ackedRev: rev,
			serverRev: remote?.rev ?? r.serverRev,
			deleted: !remote || !!remote.deleted_at,
			session: parsed?.session ?? null,
			...(parsed && !parsed.session ? { quarantine: { reason: parsed.reason, raw: remote?.doc } } : {}),
			...(!remote || remote.deleted_at ? { cleanupPhotos: true } : {})
		};
		this.#commit(
			[
				original,
				...(copy
					? [
							{
								id: duplicateId,
								ownerId: owner,
								rev: 1,
								ackedRev: 0,
								serverRev: 0,
								deleted: false,
								session: copy
							}
						]
					: [])
			],
			'saved'
		);
		this.error =
			'Houve alterações em outro aparelho. As alterações locais foram preservadas em uma cópia desta jornada.';
		await this.flush();
		await this.#cleanup();
	}
	async importGuests(ownerId: string) {
		if (!this.ready || this.ownerId !== ownerId)
			throw new Error('Entre na conta e aguarde as jornadas ficarem prontas.');
		const guests = this.#records.filter(
			(r) => r.ownerId === null && !r.deleted && r.session && !r.quarantine
		);
		this.#commit(
			guests.map((r) => ({
				...r,
				ownerId,
				rev: r.rev + 1,
				ackedRev: 0,
				serverRev: 0,
				session: { ...r.session!, ownerId, rev: r.rev + 1 }
			})),
			'saved'
		);
		await this.flush();
	}
	close() {
		this.#closed = true;
		clearTimeout(this.#writerRetry);
		this.#release?.();
		this.#release = null;
		this.readOnly = true;
		this.#repository.close();
	}
}

export const sessions = new Sessions();
