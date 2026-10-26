import { IDBFactory } from 'fake-indexeddb';
import { expect, it } from 'vitest';
import type { GuideDocument } from './model.ts';
import { type GuideSaveAdapter, GuideService } from './persistence.ts';
import { SpeciesRegistry } from './registry.ts';
import { SPECIES } from './species.ts';
import { IndexedDbThumbnails, MAX_THUMBNAIL_BYTES } from './thumbnails.ts';

const registry = new SpeciesRegistry(SPECIES);
function storage(value: unknown = undefined) {
	let saved = value;
	let calls = 0;
	return {
		get value() {
			return saved;
		},
		get calls() {
			return calls;
		},
		async read() {
			return saved;
		},
		async write(doc: GuideDocument) {
			calls++;
			saved = doc;
			return true;
		}
	};
}
it('replaces a species thumbnail, enforces the payload budget, and survives reopening the database', async () => {
	const factory = new IDBFactory();
	let photos = new IndexedDbThumbnails(factory, 'guide-test');
	await photos.put('anta', new Blob(['first'], { type: 'image/jpeg' }));
	await photos.put('anta', new Blob(['second'], { type: 'image/webp' }));
	photos.close();
	photos = new IndexedDbThumbnails(factory, 'guide-test');
	expect(await (await photos.get('anta'))?.text()).toBe('second');
	await expect(
		photos.put('anta', new Blob([new Uint8Array(MAX_THUMBNAIL_BYTES + 1)], { type: 'image/jpeg' }))
	).rejects.toThrow();
	await expect(photos.put('anta', new Blob(['<svg/>'], { type: 'image/svg+xml' }))).rejects.toThrow();
	expect(await (await photos.get('anta'))?.text()).toBe('second');
	photos.close();
});
it('queues rapid discoveries without overwriting one another and restores metadata/photos offline', async () => {
	const save = storage(),
		factory = new IDBFactory(),
		photos = new IndexedDbThumbnails(factory, 'service-test');
	const service = await GuideService.open(registry, save, photos);
	await Promise.all([
		service.record(['tucano', 'saira', 'tucano'], 'photo', new Blob(['shot'], { type: 'image/jpeg' })),
		service.record(['anta'], 'mission')
	]);
	expect(service.book.count).toBe(3);
	expect(service.issue).toBeNull();
	const next = await GuideService.open(registry, save, photos);
	expect(next.book.count).toBe(3);
	expect(await (await next.thumbnail('tucano'))?.text()).toBe('shot');
	photos.close();
});
it('does not overwrite future/corrupt saves and still allows session discoveries', async () => {
	for (const doc of [
		{ version: 9, discoveries: {} },
		{ version: 1, discoveries: { bad: true } }
	]) {
		const save = storage(doc),
			photos = new IndexedDbThumbnails(new IDBFactory(), 'readonly');
		const service = await GuideService.open(registry, save, photos);
		await service.record(['anta'], 'mission');
		expect(service.book.has('anta')).toBe(true);
		expect(save.calls).toBe(0);
		expect(save.value).toEqual(doc);
		expect(service.issue).not.toBeNull();
		photos.close();
	}
});
it('keeps discoveries on quota/write failures and retries without erasing them', async () => {
	let failing = true,
		saved: GuideDocument | undefined;
	const save: GuideSaveAdapter = {
		async read() {
			return undefined;
		},
		async write(doc) {
			if (failing) return false;
			saved = doc;
			return true;
		}
	};
	const photos = new IndexedDbThumbnails(new IDBFactory(), 'retry');
	const service = await GuideService.open(registry, save, photos);
	await service.record(['mico'], 'photo');
	expect(service.book.has('mico')).toBe(true);
	expect(service.issue).toBe('save-failed');
	failing = false;
	await service.retry();
	expect(service.issue).toBeNull();
	expect(saved?.discoveries['mico-leao-dourado']).toBeDefined();
	photos.close();
});
it('photo failure does not block a mission or discard its discovery', async () => {
	const save = storage();
	const service = await GuideService.open(registry, save, {
		async get() {
			return null;
		},
		async put() {
			throw new Error('quota');
		}
	});
	await service.record(['anta'], 'photo', new Blob(['shot'], { type: 'image/jpeg' }));
	expect(service.book.has('anta')).toBe(true);
	expect(service.issue).toBe('thumbnail-failed');
	expect((save.value as GuideDocument).discoveries.anta).toBeDefined();
});
it('reports rejected photo payloads instead of silently claiming they were saved', async () => {
	const save = storage();
	const service = await GuideService.open(registry, save, {
		async get() {
			return null;
		},
		async put() {
			throw new Error('must not receive an oversized blob');
		}
	});
	await service.record(['anta'], 'photo', new Blob([new Uint8Array(65537)], { type: 'image/jpeg' }));
	expect(service.book.has('anta')).toBe(true);
	expect(service.issue).toBe('thumbnail-failed');
});
