import { createStore, del, get, keys, set } from 'idb-keyval';

/**
 * Checklist photos stay on the device, in a database separate from sessions.
 * They are downscaled before saving so they do not fill the phone's storage.
 */
const store = typeof indexedDB === 'undefined' ? undefined : createStore('guardioes-photos', 'photos');

export function photoKey(sessionId: string, groupId: string, item: string): string {
	return `${sessionId}:${groupId}:${item}`;
}

export async function savePhoto(key: string, file: File): Promise<void> {
	await set(key, await downscale(file), store);
}

export function readPhoto(key: string): Promise<Blob | undefined> {
	return get<Blob>(key, store);
}

export function deletePhoto(key: string): Promise<void> {
	return del(key, store);
}

/** A conflict copy has its own keys; never delete the original before copying. */
export async function copySessionPhotos(
	photoKeys: string[],
	sourceId: string,
	targetId: string
): Promise<string[]> {
	const copied: string[] = [];
	for (const key of photoKeys) {
		const blob = await readPhoto(key);
		if (!blob) continue;
		const next = key.startsWith(sourceId + ':')
			? targetId + key.slice(sourceId.length)
			: `${targetId}:${key}`;
		await set(next, blob, store);
		copied.push(next);
	}
	return copied;
}

export async function deleteSessionPhotos(sessionId: string): Promise<void> {
	const all = await keys(store);
	await Promise.all(all.filter((k) => String(k).startsWith(`${sessionId}:`)).map((k) => del(k, store)));
}

async function downscale(file: File, maxSide = 1280, quality = 0.8): Promise<Blob> {
	try {
		const bitmap = await createImageBitmap(file);
		const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
		const canvas = new OffscreenCanvas(Math.round(bitmap.width * scale), Math.round(bitmap.height * scale));
		canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
		bitmap.close();
		return await canvas.convertToBlob({ type: 'image/jpeg', quality });
	} catch {
		// Unsupported format or old browser: keep the original file.
		return file;
	}
}
