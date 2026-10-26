import {
	AUDIO_CODECS,
	type AudioCodec,
	decodeGameManifest,
	type GameManifest,
	requiredFiles
} from '../../../game/protocol.ts';

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
/**
 * The completion marker: the full manifest plus the audio codec this device
 * downloaded (null: none). Markers written before codecs have no `audioCodec`
 * and mean every file was downloaded.
 */
export function gameMarker(manifest: GameManifest, audioCodec: AudioCodec | null): Response {
	return Response.json({ ...manifest, audioCodec });
}
function markerCodec(value: unknown): AudioCodec | null | undefined {
	if (value === undefined || value === null) return value;
	if (AUDIO_CODECS.includes(value as AudioCodec)) return value as AudioCodec;
	throw new Error('invalid-game-marker');
}
/** The pack as this device holds it: only the files its marker requires, all present. */
export async function completeGameManifest(
	cache: Cache,
	root: URL,
	packId: string
): Promise<GameManifest | null> {
	try {
		const marker = await cache.match(gameMarkerUrl(root, packId));
		if (!marker) return null;
		const record = await marker.json();
		const manifest = decodeGameManifest(record);
		if (manifest.packId !== packId) return null;
		const files = requiredFiles(manifest, markerCodec(record.audioCodec));
		for (const file of files) if (!(await cache.match(gameFileUrl(root, packId, file.path)))) return null;
		return { ...manifest, files };
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
