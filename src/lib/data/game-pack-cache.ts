import { decodeGameManifest, type GameManifest } from '../../../game/protocol.ts';

export function gameCachePrefix(root: URL): string {
	return `guardioes-game:${encodeURIComponent(root.pathname)}:`;
}
export function gameCacheName(root: URL, packId: string): string {
	return `${gameCachePrefix(root)}${packId}`;
}
export function gameFileUrl(root: URL, packId: string, path: string): string {
	return new URL(`game-packs/${packId}/${path}`, root).href;
}
export function gameMarkerUrl(root: URL, packId: string): string {
	return gameFileUrl(root, packId, '__complete__.json');
}
export async function completeGameManifest(
	cache: Cache,
	root: URL,
	packId: string
): Promise<GameManifest | null> {
	try {
		const marker = await cache.match(gameMarkerUrl(root, packId));
		if (!marker) return null;
		const manifest = decodeGameManifest(await marker.json());
		if (manifest.packId !== packId) return null;
		for (const file of manifest.files)
			if (!(await cache.match(gameFileUrl(root, packId, file.path)))) return null;
		return manifest;
	} catch {
		return null;
	}
}
/** Optional packs live outside the app-version cache and are never install dependencies. */
export async function matchGamePack(
	storage: CacheStorage,
	root: URL,
	request: URL
): Promise<Response | undefined> {
	const prefix = new URL('game-packs/', root).pathname;
	if (request.origin !== root.origin || !request.pathname.startsWith(prefix)) return;
	const [packId, ...segments] = request.pathname.slice(prefix.length).split('/');
	if (!packId || !/^[a-f0-9]{64}$/.test(packId)) return;
	const name = gameCacheName(root, packId);
	if (!(await storage.has(name))) return;
	const cache = await storage.open(name);
	const manifest = await completeGameManifest(cache, root, packId);
	const file = segments.join('/');
	if (!manifest?.files.some(({ path }) => path === file)) return;
	return cache.match(gameFileUrl(root, packId, file));
}
