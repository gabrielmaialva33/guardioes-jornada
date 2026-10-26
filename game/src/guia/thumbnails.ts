import { validId } from './registry.ts';
/** Binary + our UTF-8 metadata stay under 64 KiB per entry; IDB engine overhead is not portable. */
export const ENTRY_BUDGET_BYTES = 64 * 1024;
export const MAX_THUMBNAIL_BYTES = 60 * 1024;
export interface ThumbnailAdapter {
	get(speciesId: string): Promise<Blob | null>;
	put(speciesId: string, blob: Blob): Promise<void>;
}
export function validateThumbnail(id: string, blob: Blob) {
	if (
		!validId(id) ||
		!['image/jpeg', 'image/png', 'image/webp'].includes(blob.type) ||
		blob.size < 1 ||
		blob.size > MAX_THUMBNAIL_BYTES
	)
		throw new Error('Invalid or oversized guide thumbnail');
	const metadata = new TextEncoder().encode(
		JSON.stringify({ speciesId: id, updatedAt: Number.MAX_SAFE_INTEGER, type: blob.type, bytes: blob.size })
	).byteLength;
	if (metadata + blob.size > ENTRY_BUDGET_BYTES) throw new Error('Guide entry exceeds byte budget');
}
/** Own database: does not mutate the main save or its IndexedDB schema. One atomic replacement per species. */
export class IndexedDbThumbnails implements ThumbnailAdapter {
	#opening: Promise<IDBDatabase> | null = null;
	#closed = false;
	constructor(
		readonly factory: IDBFactory | undefined = globalThis.indexedDB,
		readonly name = 'guardioes-guia-thumbnails'
	) {}
	#open() {
		if (this.#closed) return Promise.reject(new Error('Thumbnail adapter closed'));
		if (this.#opening) return this.#opening;
		const promise = new Promise<IDBDatabase>((resolve, reject) => {
			if (!this.factory) {
				reject(new Error('IndexedDB unavailable'));
				return;
			}
			const request = this.factory.open(this.name, 1);
			let settled = false;
			const fail = () => {
				settled = true;
				reject(request.error ?? new Error('Thumbnail database blocked'));
			};
			request.onblocked = fail;
			request.onerror = fail;
			request.onupgradeneeded = () => {
				if (!request.result.objectStoreNames.contains('photos'))
					request.result.createObjectStore('photos', { keyPath: 'speciesId' });
			};
			request.onsuccess = () => {
				const db = request.result;
				if (settled || this.#closed) {
					db.close();
					if (!settled) reject(new Error('Thumbnail adapter closed'));
					return;
				}
				db.onversionchange = () => {
					db.close();
					this.#opening = null;
				};
				resolve(db);
			};
		});
		this.#opening = promise;
		void promise.catch(() => {
			if (this.#opening === promise) this.#opening = null;
		});
		return promise;
	}
	async get(speciesId: string) {
		if (!validId(speciesId)) return null;
		const db = await this.#open();
		return new Promise<Blob | null>((resolve, reject) => {
			const tx = db.transaction('photos', 'readonly'),
				request = tx.objectStore('photos').get(speciesId);
			let blob: Blob | null = null;
			request.onsuccess = () => {
				const row = request.result;
				if (row?.blob instanceof Blob) {
					try {
						validateThumbnail(speciesId, row.blob);
						blob = row.blob;
					} catch {
						/* Preserve invalid rows for review; never erase them while reading. */
					}
				}
			};
			tx.oncomplete = () => resolve(blob);
			tx.onerror = tx.onabort = () => reject(tx.error ?? new Error('Thumbnail read failed'));
		});
	}
	async put(speciesId: string, blob: Blob) {
		validateThumbnail(speciesId, blob);
		const db = await this.#open();
		return new Promise<void>((resolve, reject) => {
			const tx = db.transaction('photos', 'readwrite');
			tx.objectStore('photos').put({ speciesId, blob, updatedAt: Date.now() });
			tx.oncomplete = () => resolve();
			tx.onerror = tx.onabort = () => reject(tx.error ?? new Error('Thumbnail write failed'));
		});
	}
	close() {
		this.#closed = true;
		void this.#opening?.then(
			(db) => db.close(),
			() => {}
		);
		this.#opening = null;
	}
}
