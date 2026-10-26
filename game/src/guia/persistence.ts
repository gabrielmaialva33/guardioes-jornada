import { type DiscoveryOrigin, decodeGuide, GuideBook, type GuideDocument } from './model.ts';
import type { SpeciesRegistry } from './registry.ts';
import { type ThumbnailAdapter, validateThumbnail } from './thumbnails.ts';
/** p2 supplies this interface over gameSave.guia. No local-save dependency or schema mutation here. */
export interface GuideSaveAdapter {
	read(): Promise<unknown>;
	write(document: GuideDocument): Promise<boolean>;
}
export type GuideIssue = 'future-save' | 'invalid-save' | 'save-failed' | 'thumbnail-failed' | null;
export class GuideService {
	readonly #listeners = new Set<() => void>();
	readonly #photos = new Map<string, Blob>();
	#tail = Promise.resolve();
	#thumbnailRejected = false;
	issue: GuideIssue = null;
	private constructor(
		readonly book: GuideBook,
		readonly save: GuideSaveAdapter,
		readonly photos: ThumbnailAdapter,
		readonly writable: boolean
	) {}
	static async open(registry: SpeciesRegistry, save: GuideSaveAdapter, photos: ThumbnailAdapter) {
		let raw: unknown;
		let failed = false;
		try {
			raw = await save.read();
		} catch {
			failed = true;
		}
		const decoded = decodeGuide(raw),
			writable = !failed && (decoded.status === 'ok' || decoded.status === 'missing');
		const service = new GuideService(
			new GuideBook(registry, decoded.document ?? undefined),
			save,
			photos,
			writable
		);
		service.issue = failed
			? 'save-failed'
			: decoded.status === 'future'
				? 'future-save'
				: decoded.status === 'invalid'
					? 'invalid-save'
					: null;
		return service;
	}
	subscribe(listener: () => void) {
		this.#listeners.add(listener);
		return () => {
			this.#listeners.delete(listener);
		};
	}
	#emit() {
		for (const listener of this.#listeners) listener();
	}
	record(ids: readonly string[], origin: DiscoveryOrigin, thumbnail?: Blob, at = Date.now()) {
		let changed = false;
		for (const id of ids) {
			const species = this.book.registry.find(id);
			if (!species) continue;
			changed = this.book.discover(species.id, origin, at) || changed;
			if (thumbnail) {
				try {
					validateThumbnail(species.id, thumbnail);
					this.#photos.set(species.id, thumbnail);
					this.#thumbnailRejected = false;
				} catch {
					this.#thumbnailRejected = true;
					this.issue = 'thumbnail-failed';
				}
			}
		}
		if (changed || thumbnail) this.#emit();
		return this.retry();
	}
	retry() {
		const work = async () => {
			if (!this.writable) {
				this.#emit();
				return;
			}
			let issue: GuideIssue = this.#thumbnailRejected ? 'thumbnail-failed' : null;
			for (const [id, blob] of this.#photos) {
				try {
					await this.photos.put(id, blob);
				} catch {
					issue = 'thumbnail-failed';
				}
			}
			try {
				if (!(await this.save.write(this.book.snapshot()))) issue = 'save-failed';
			} catch {
				issue = 'save-failed';
			}
			this.issue = issue;
			this.#emit();
		};
		// Serial writes snapshot at execution, so a slower earlier capture cannot erase newer discoveries.
		this.#tail = this.#tail.then(work, work);
		return this.#tail;
	}
	async thumbnail(id: string) {
		const canonical = this.book.registry.find(id)?.id;
		if (!canonical || !this.book.has(canonical)) return null;
		const local = this.#photos.get(canonical);
		if (local) return local;
		try {
			return await this.photos.get(canonical);
		} catch {
			if (this.issue !== 'thumbnail-failed') {
				this.issue = 'thumbnail-failed';
				this.#emit();
			}
			return null;
		}
	}
}
