import { get } from 'idb-keyval';
import type { Session } from '#lib/session.ts';
import { acquireFallbackWriter } from './writer-fallback.ts';

export interface Operation {
	mutationId: string;
	rev: number;
	baseRev: number;
	kind: 'push' | 'delete';
	session: Session | null;
}
export interface LocalRecord {
	id: string;
	ownerId: string | null;
	rev: number;
	ackedRev: number;
	serverRev: number;
	deleted: boolean;
	session: Session | null;
	inflight?: Operation;
	quarantine?: { reason: string; raw: unknown };
	cleanupPhotos?: boolean;
}
export interface Repository {
	read(): Promise<unknown[]>;
	write(records: LocalRecord[]): Promise<void>;
	close(): void;
}

/** One record contains both the session and its durable outbox state. */
export class IndexedRepository implements Repository {
	#db?: Promise<IDBDatabase>;
	constructor(private name = 'guardioes-data-v2') {}
	#open() {
		return (this.#db ??= new Promise<IDBDatabase>((resolve, reject) => {
			const request = indexedDB.open(this.name, 1);
			request.onupgradeneeded = () => {
				request.result.createObjectStore('records', { keyPath: 'id' });
				request.result.createObjectStore('meta');
			};
			request.onsuccess = () => resolve(request.result);
			request.onerror = () => reject(request.error);
		}));
	}
	async read(): Promise<unknown[]> {
		const db = await this.#open();
		return new Promise((resolve, reject) => {
			const tx = db.transaction('records', 'readonly');
			const request = tx.objectStore('records').getAll();
			tx.oncomplete = () => resolve(request.result);
			tx.onabort = () => reject(tx.error);
			tx.onerror = () => reject(tx.error);
		});
	}
	async write(records: LocalRecord[]) {
		const db = await this.#open();
		await new Promise<void>((resolve, reject) => {
			const tx = db.transaction('records', 'readwrite');
			for (const record of records) tx.objectStore('records').put(record);
			tx.oncomplete = () => resolve();
			tx.onabort = () => reject(tx.error);
			tx.onerror = () => reject(tx.error);
			if (typeof tx.commit === 'function') tx.commit();
		});
	}
	/** Import once, preserving the original v1 key and never guessing its owner. */
	async migrateLegacy(convert: (raw: unknown) => LocalRecord) {
		const db = await this.#open();
		const migrated = await new Promise<boolean>((resolve, reject) => {
			const tx = db.transaction('meta', 'readonly');
			const read = tx.objectStore('meta').get('legacy');
			tx.oncomplete = () => resolve(!!read.result);
			tx.onabort = () => reject(tx.error);
		});
		if (migrated) return;
		const legacy = await get<unknown>('sessions-v1');
		const records = Array.isArray(legacy) ? legacy.map(convert) : legacy == null ? [] : [convert(legacy)];
		await new Promise<void>((resolve, reject) => {
			const tx = db.transaction(['records', 'meta'], 'readwrite');
			for (const record of records) tx.objectStore('records').put(record);
			tx.objectStore('meta').put(true, 'legacy');
			tx.oncomplete = () => resolve();
			tx.onabort = () => reject(tx.error);
			if (typeof tx.commit === 'function') tx.commit();
		});
	}
	close() {
		void this.#db?.then((db) => db.close());
	}
}

export type WriterLease = (() => void) & { lost?: Promise<void> };
export type WriterLock = () => Promise<WriterLease | null>;

/** Keep the Web Lock until the store closes; another window can only read. */
export const acquireWriter: WriterLock = () =>
	new Promise((resolve) => {
		if (typeof navigator === 'undefined' || !navigator.locks) {
			resolve(acquireFallbackWriter());
			return;
		}
		void navigator.locks
			.request('guardioes-data-v2-writer', { ifAvailable: true }, async (lock) => {
				if (!lock) {
					resolve(null);
					return;
				}
				await new Promise<void>((release) => resolve(release));
			})
			.catch(() => resolve(null));
	});
