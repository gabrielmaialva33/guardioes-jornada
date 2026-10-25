import { type CloudAdapter, createLazyCloudAdapter } from '#lib/supabase/adapter.ts';
import { cloudAvailable } from '#lib/supabase/client.ts';
import { auth } from './auth.svelte.ts';
import { type Sessions, sessions } from './sessions.svelte.ts';

export type SyncStatus = 'unavailable' | 'signed-out' | 'offline' | 'idle' | 'syncing' | 'error';
export interface SyncIdentity {
	user: { id: string } | null;
	generation: number;
	onChange(listener: () => void): () => void;
}
interface Options {
	client?: CloudAdapter | null;
	store?: Sessions;
	identity?: SyncIdentity;
	online?: () => boolean;
	timeoutMs?: number;
	retryBaseMs?: number;
}

export class CloudSync {
	status = $state<SyncStatus>('signed-out');
	lastSyncAt = $state<number | null>(null);
	#store: Sessions;
	#client: CloudAdapter | null;
	#identity: SyncIdentity;
	#online: () => boolean;
	#timeout: number;
	#retryBase: number;
	#attempt = 0;
	#timer?: ReturnType<typeof setTimeout>;
	#controller?: AbortController;
	#running: Promise<void> | null = null;
	#needsPull = false;
	#again = false;
	#initialized = false;
	#disposed = false;
	#unsubscribe: (() => void)[] = [];
	constructor(options: Options = {}) {
		this.#store = options.store ?? sessions;
		this.#client =
			options.client === undefined ? (cloudAvailable ? createLazyCloudAdapter() : null) : options.client;
		this.#identity = options.identity ?? auth;
		this.#online = options.online ?? (() => typeof navigator === 'undefined' || navigator.onLine);
		this.#timeout = options.timeoutMs ?? 15000;
		this.#retryBase = options.retryBaseMs ?? 2000;
		this.status = this.#client ? 'signed-out' : 'unavailable';
	}
	get pending() {
		return this.#store.pendingCount;
	}
	get guestCount() {
		return this.#store.guestCount;
	}
	async init() {
		if (this.#initialized) return;
		this.#initialized = true;
		this.#store.setOwner(this.#identity.user?.id ?? null);
		await this.#store.load();
		this.#unsubscribe.push(
			this.#store.onChange((change) => {
				if (change.kind !== 'remote') this.#schedule(this.#retryBase);
			})
		);
		this.#unsubscribe.push(
			this.#identity.onChange(() => {
				this.#controller?.abort();
				clearTimeout(this.#timer);
				this.#store.setOwner(this.#identity.user?.id ?? null);
				this.lastSyncAt = null;
				this.#attempt = 0;
				this.#needsPull = true;
				this.status = !this.#client ? 'unavailable' : this.#identity.user ? 'idle' : 'signed-out';
				this.#schedule(0);
			})
		);
		if (typeof window !== 'undefined') {
			const online = () => {
				this.#needsPull = true;
				this.#schedule(0);
			};
			const offline = () => {
				this.#controller?.abort();
				clearTimeout(this.#timer);
				this.status = this.#identity.user ? 'offline' : 'signed-out';
			};
			const visible = () => {
				if (document.visibilityState === 'visible') online();
			};
			window.addEventListener('online', online);
			window.addEventListener('offline', offline);
			document.addEventListener('visibilitychange', visible);
			this.#unsubscribe.push(() => {
				window.removeEventListener('online', online);
				window.removeEventListener('offline', offline);
				document.removeEventListener('visibilitychange', visible);
			});
		}
		await this.run({ pull: true });
	}
	async importGuestSessions() {
		const owner = this.#identity.user?.id;
		if (!owner) throw new Error('Entre na conta antes de importar as jornadas.');
		await this.#store.importGuests(owner);
		await this.run({ pull: true });
	}
	#schedule(delay: number) {
		if (this.#disposed || !this.#client || !this.#identity.user || !this.#online()) return;
		clearTimeout(this.#timer);
		this.#timer = setTimeout(() => {
			void this.run();
		}, delay);
	}
	run({ pull = false } = {}): Promise<void> {
		this.#needsPull ||= pull;
		if (this.#disposed || !this.#client) {
			this.status = 'unavailable';
			return Promise.resolve();
		}
		if (!this.#identity.user) {
			this.status = 'signed-out';
			return Promise.resolve();
		}
		if (!this.#online()) {
			this.status = 'offline';
			return Promise.resolve();
		}
		if (this.#running) {
			this.#again = true;
			return this.#running;
		}
		clearTimeout(this.#timer);
		const owner = this.#identity.user.id,
			generation = this.#identity.generation;
		const current = () =>
			!this.#disposed &&
			this.#identity.user?.id === owner &&
			this.#identity.generation === generation &&
			this.#store.ownerId === owner;
		this.#running = this.#execute(owner, current).finally(() => {
			this.#running = null;
			if (this.#again || (!current() && this.#identity.user)) {
				this.#again = false;
				this.#schedule(0);
			}
		});
		return this.#running;
	}
	async #execute(owner: string, current: () => boolean) {
		const client = this.#client;
		if (!client) {
			this.status = 'unavailable';
			return;
		}
		this.status = 'syncing';
		try {
			let rounds = 0;
			do {
				this.#again = false;
				const pull = this.#needsPull;
				this.#needsPull = false;
				await this.#store.flush();
				if (!current()) return;
				if (!this.#store.ready) {
					this.status = 'idle';
					return;
				}
				for (let count = 0; count < 100; count++) {
					const pending = await this.#store.nextOperation();
					if (!current()) return;
					if (!pending) break;
					const { id, operation } = pending;
					const reply = await this.#request((signal) => {
						if (operation.kind === 'delete')
							return client.delete(id, operation.baseRev, operation.mutationId, signal);
						const session = operation.session;
						if (!session) throw new Error('The queued upload has no session document');
						return client.push(session, operation.baseRev, operation.mutationId, signal);
					});
					if (!current()) return;
					if (
						reply.server_doc &&
						(reply.server_doc.owner_id !== owner ||
							reply.server_doc.id !== id ||
							reply.server_doc.rev !== reply.rev)
					)
						throw new Error('Unexpected server record');
					if (
						reply.status === 'ok' &&
						operation.kind === 'push' &&
						(!reply.server_doc ||
							reply.server_doc.last_mutation_id !== operation.mutationId ||
							reply.server_doc.deleted_at ||
							reply.rev <= operation.baseRev)
					)
						throw new Error('The server did not confirm this mutation');
					if (
						reply.status === 'ok' &&
						operation.kind === 'delete' &&
						reply.server_doc &&
						!reply.server_doc.deleted_at
					)
						throw new Error('The deletion was not confirmed');
					if (reply.status === 'ok') await this.#store.acknowledge(id, operation, reply.rev);
					else if (
						operation.kind === 'push' &&
						operation.baseRev === 0 &&
						reply.rev === 0 &&
						!reply.server_doc &&
						reply.reason === 'certificate_code_taken'
					)
						await this.#store.regenerateCertificate(id, operation);
					else await this.#store.resolveConflict(id, reply.server_doc, current);
					if (!current()) return;
				}
				if (pull) {
					const rows = await this.#request((signal) => client.pull(owner, signal));
					if (!current()) return;
					for (const row of rows) {
						if (!current()) return;
						await this.#store.receive(row, current);
					}
				}
			} while (
				current() &&
				(this.#again || this.#needsPull || this.#store.syncablePendingCount > 0) &&
				++rounds < 10
			);
			if (current()) {
				this.#attempt = 0;
				this.lastSyncAt = Date.now();
				this.status = this.#store.blockedSyncError ? 'error' : 'idle';
				if (this.#store.syncablePendingCount) this.#schedule(this.#retryBase);
				else clearTimeout(this.#timer);
			}
		} catch {
			if (current()) {
				this.status = this.#online() ? 'error' : 'offline';
				this.#needsPull = true;
				this.#schedule(Math.min(60000, this.#retryBase * 2 ** Math.min(this.#attempt++, 5)));
			}
		}
	}
	async #request<T>(call: (signal: AbortSignal) => Promise<T>): Promise<T> {
		const controller = new AbortController();
		this.#controller = controller;
		const timeout = setTimeout(() => controller.abort(), this.#timeout);
		let onAbort: () => void = () => {};
		try {
			return await Promise.race([
				call(controller.signal),
				new Promise<never>((_, reject) => {
					onAbort = () => reject(new Error('Request aborted'));
					controller.signal.addEventListener('abort', onAbort, { once: true });
					if (controller.signal.aborted) onAbort();
				})
			]);
		} finally {
			clearTimeout(timeout);
			controller.signal.removeEventListener('abort', onAbort);
			if (this.#controller === controller) this.#controller = undefined;
		}
	}
	dispose() {
		this.#disposed = true;
		this.#controller?.abort();
		clearTimeout(this.#timer);
		for (const stop of this.#unsubscribe) stop();
	}
}
export const sync = new CloudSync();
