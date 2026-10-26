import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	type AudioCodec,
	decodeGameManifest,
	GAME_ABI,
	type GameManifest,
	requiredFiles
} from '../../../game/protocol.ts';
import { GamePacks, getGamePackInfo } from './game-pack.ts';
import { gameCacheName, gameFileUrl, gameMarkerUrl, matchGamePack } from './game-pack-cache.ts';
import { cachePrefix, obsoleteCaches } from './worker-cache.ts';

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});
const root = new URL('https://app.invalid/park/');
function memoryCaches() {
	const caches = new Map<string, Map<string, Response>>();
	return {
		keys: async () => [...caches.keys()],
		has: async (name: string) => caches.has(name),
		delete: async (name: string) => caches.delete(name),
		open: async (name: string) => {
			let values = caches.get(name);
			if (!values) {
				values = new Map();
				caches.set(name, values);
			}
			const data = values;
			return {
				match: async (key: string) => data.get(String(key))?.clone(),
				put: async (key: string, response: Response) => {
					data.set(String(key), response.clone());
				}
			} as unknown as Cache;
		}
	} as CacheStorage;
}
async function pack(text: string): Promise<GameManifest> {
	const bytes = new TextEncoder().encode(text);
	const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (v) =>
		v.toString(16).padStart(2, '0')
	).join('');
	return {
		abi: GAME_ABI,
		packId: digest,
		entry: 'entry.js',
		files: [{ path: 'entry.js', bytes: bytes.length, sha256: digest }]
	};
}
const sha256 = async (bytes: Uint8Array<ArrayBuffer>) =>
	Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (v) =>
		v.toString(16).padStart(2, '0')
	).join('');
/** A pack whose files hold their own path as bytes; audio is tagged like pack-build.ts does. */
async function audioPack(paths: string[]): Promise<GameManifest> {
	const files = await Promise.all(
		paths.map(async (path) => {
			const bytes = new TextEncoder().encode(path);
			const codec: AudioCodec | undefined = path.endsWith('.webm')
				? 'webm'
				: path.endsWith('.m4a')
					? 'm4a'
					: undefined;
			return { path, bytes: bytes.length, sha256: await sha256(bytes), ...(codec ? { codec } : {}) };
		})
	);
	const packId = await sha256(new TextEncoder().encode(JSON.stringify(files)));
	return decodeGameManifest({ abi: GAME_ABI, packId, entry: 'entry.js', files });
}
/** Serves each pack file's path as its body and records what was asked for. */
function pathFetch(requested: string[]) {
	return vi.fn(async (url: string | URL | Request) => {
		const path = String(url).replace(/^.*\/game-packs\/[a-f0-9]{64}\//, '');
		requested.push(path);
		return new Response(path);
	});
}
const AUDIO_PATHS = [
	'entry.js',
	'assets/style.css',
	'assets/step-1.webm',
	'assets/step-1.m4a',
	'assets/river-1.webm',
	'assets/river-1.m4a'
];

describe('optional independent packs', () => {
	it('persists a verified pack and serves it without the server after A, B and C app cleanups', async () => {
		const storage = memoryCaches();
		const a = await pack('pack A');
		const manager = new GamePacks({ root, storage, fetch: vi.fn(async () => new Response('pack A')) });
		await manager.download(a);
		for (const version of ['A', 'B', 'C']) {
			for (const name of obsoleteCaches(await storage.keys(), cachePrefix(root.pathname), version))
				await storage.delete(name);
		}
		expect(await new GamePacks({ root, storage }).current()).toEqual(a);
		const hit = await matchGamePack(storage, root, new URL(gameFileUrl(root, a.packId, a.entry)));
		expect(await hit?.text()).toBe('pack A');
	});
	it('publishes a replacement only after every file is verified and committed', async () => {
		const storage = memoryCaches(),
			a = await pack('A'),
			c = await pack('C');
		await new GamePacks({ root, storage, fetch: vi.fn(async () => new Response('A')) }).download(a);
		const manager = new GamePacks({
			root,
			storage,
			fetch: vi.fn(async () => {
				expect(await new GamePacks({ root, storage }).current()).toEqual(a);
				return new Response('C');
			})
		});
		await manager.download(c);
		expect(await manager.current()).toEqual(c);
		expect(await storage.has(gameCacheName(root, a.packId))).toBe(true);
	});
	it('keeps the previous complete pack on corruption, abort, HTTP failure or quota exhaustion', async () => {
		for (const failure of ['hash', 'abort', 'http', 'quota']) {
			const storage = memoryCaches(),
				a = await pack('A'),
				c = await pack('C');
			await new GamePacks({ root, storage, fetch: vi.fn(async () => new Response('A')) }).download(a);
			const controller = new AbortController();
			if (failure === 'abort') controller.abort();
			const normalOpen = storage.open.bind(storage);
			if (failure === 'quota')
				storage.open = async (name) => {
					const cache = await normalOpen(name);
					if (name.includes(':staging:'))
						cache.put = async () => {
							throw new DOMException('full', 'QuotaExceededError');
						};
					return cache;
				};
			const manager = new GamePacks({
				root,
				storage,
				fetch: vi.fn(
					async () => new Response(failure === 'hash' ? 'X' : 'C', { status: failure === 'http' ? 503 : 200 })
				)
			});
			await expect(manager.download(c, { signal: controller.signal })).rejects.toThrow();
			expect(await manager.current()).toEqual(a);
			expect((await storage.keys()).some((name) => name.includes(':staging:'))).toBe(false);
		}
	});
	it('reports byte progress and does not accept a truncated response', async () => {
		const storage = memoryCaches(),
			manifest = await pack('abcdef'),
			progress = vi.fn();
		const manager = new GamePacks({ root, storage, fetch: vi.fn(async () => new Response('abcdef')) });
		await manager.download(manifest, { progress });
		expect(progress).toHaveBeenLastCalledWith({ loaded: 6, total: 6 });
		const broken = new GamePacks({
			root,
			storage: memoryCaches(),
			fetch: vi.fn(async () => new Response('abc'))
		});
		await expect(broken.download(manifest)).rejects.toThrow();
	});
	it('exposes an estimated download size to the discovery sheet, and reads a complete pack without network', async () => {
		const storage = memoryCaches(),
			manifest = await pack('A');
		manifest.files[0].gzipBytes = 1025;
		vi.stubGlobal('caches', storage);
		const request = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json(manifest));
		expect(await getGamePackInfo(root)).toEqual({
			complete: false,
			packId: manifest.packId,
			missingBytes: 1025,
			sizeKB: 2,
			audioCodec: null
		});
		await new GamePacks({ root, storage, fetch: vi.fn(async () => new Response('A')) }).download(manifest);
		request.mockClear();
		expect(await getGamePackInfo(root)).toEqual({
			complete: true,
			packId: manifest.packId,
			missingBytes: 0,
			sizeKB: 0,
			audioCodec: null
		});
		expect(request).not.toHaveBeenCalled();
	});
	it('tells a saved pack apart from a newer published one, reading only latest.json', async () => {
		const storage = memoryCaches(),
			a = await pack('A'),
			b = await pack('B');
		b.files[0].gzipBytes = 2048;
		await new GamePacks({ root, storage, fetch: vi.fn(async () => new Response('A')) }).download(a);
		const requested: string[] = [];
		const serve = (latest: GameManifest) =>
			vi.fn(async (url: string | URL | Request) => {
				requested.push(String(url));
				return Response.json(latest);
			});
		expect(await new GamePacks({ root, storage, fetch: serve(a) }).newer(a)).toBeNull();
		expect(await new GamePacks({ root, storage, fetch: serve(b) }).newer(a)).toEqual({
			manifest: b,
			bytes: 2048
		});
		expect(requested).toEqual([
			new URL('game-packs/latest.json', root).href,
			new URL('game-packs/latest.json', root).href
		]);
		// Checking never replaces the saved pack.
		expect(await new GamePacks({ root, storage }).current()).toEqual(a);
	});
	it('does not publish an interrupted streaming download', async () => {
		const storage = memoryCaches(),
			manifest = await pack('ABC'),
			controller = new AbortController();
		const manager = new GamePacks({ root, storage, fetch: vi.fn(async () => new Response('ABC')) });
		await expect(
			manager.download(manifest, {
				signal: controller.signal,
				progress: ({ loaded }) => {
					if (loaded) controller.abort();
				}
			})
		).rejects.toThrow();
		expect(await manager.current()).toBeNull();
		expect(
			await matchGamePack(storage, root, new URL(gameFileUrl(root, manifest.packId, manifest.entry)))
		).toBeUndefined();
	});
});

describe('one audio codec per device', () => {
	it('downloads, verifies and serves only the chosen codec, offline', async () => {
		for (const [codec, other] of [
			['webm', 'm4a'],
			['m4a', 'webm']
		] as const) {
			const storage = memoryCaches(),
				manifest = await audioPack(AUDIO_PATHS),
				requested: string[] = [],
				progress = vi.fn();
			const manager = new GamePacks({ root, storage, fetch: pathFetch(requested), audioCodec: codec });
			const saved = await manager.download(manifest, { progress });
			const wanted = AUDIO_PATHS.filter((path) => !path.endsWith(`.${other}`));
			expect(requested).toEqual(wanted);
			expect(saved.files.map((file) => file.path)).toEqual(wanted);
			expect(progress).toHaveBeenLastCalledWith({
				loaded: wanted.join('').length,
				total: wanted.join('').length
			});
			const marker = await (await storage.open(gameCacheName(root, manifest.packId))).match(
				gameMarkerUrl(root, manifest.packId)
			);
			expect(await marker?.json()).toMatchObject({ audioCodec: codec });
			// A later manager (any codec answer) reads the pack as its marker says, without network.
			const offline = new GamePacks({ root, storage, audioCodec: other });
			expect((await offline.current())?.files.map((file) => file.path)).toEqual(wanted);
			const url = (path: string) => new URL(gameFileUrl(root, manifest.packId, path));
			expect(await (await matchGamePack(storage, root, url(`assets/step-1.${codec}`)))?.text()).toBe(
				`assets/step-1.${codec}`
			);
			expect(await matchGamePack(storage, root, url(`assets/step-1.${other}`))).toBeUndefined();
		}
	});

	it('keeps packs completed before codecs: their marker requires every file', async () => {
		const storage = memoryCaches(),
			manifest = await audioPack(AUDIO_PATHS),
			cache = await storage.open(gameCacheName(root, manifest.packId));
		for (const path of AUDIO_PATHS.slice(0, -1))
			await cache.put(gameFileUrl(root, manifest.packId, path), new Response(path));
		await cache.put(gameMarkerUrl(root, manifest.packId), Response.json(manifest));
		const registry = await storage.open(`guardioes-game:${encodeURIComponent(root.pathname)}:registry`);
		await registry.put(
			new URL('game-packs/__active__', root).href,
			Response.json({ active: manifest, previous: null })
		);
		const manager = new GamePacks({ root, storage, audioCodec: 'webm' });
		expect(await manager.current()).toBeNull();
		const last = AUDIO_PATHS.at(-1) ?? '';
		await cache.put(gameFileUrl(root, manifest.packId, last), new Response(last));
		expect(await manager.current()).toEqual(manifest);
		await cache.put(gameMarkerUrl(root, manifest.packId), Response.json({ ...manifest, audioCodec: 'ogg' }));
		expect(await manager.current()).toBeNull();
	});

	it('sizes the download for the chosen codec only', async () => {
		const storage = memoryCaches(),
			manifest = await audioPack(AUDIO_PATHS);
		vi.stubGlobal('caches', storage);
		vi.spyOn(globalThis, 'fetch').mockImplementation(async () => Response.json(manifest));
		for (const codec of ['webm', 'm4a', null] as const) {
			const bytes = requiredFiles(manifest, codec).reduce((sum, file) => sum + file.bytes, 0);
			expect(await getGamePackInfo(root, undefined, codec)).toMatchObject({
				complete: false,
				missingBytes: bytes,
				audioCodec: codec
			});
		}
		expect(requiredFiles(manifest, null).map((file) => file.path)).toEqual(['entry.js', 'assets/style.css']);
		expect(requiredFiles(manifest, undefined)).toEqual(manifest.files);
		expect(() =>
			decodeGameManifest({ ...manifest, files: [{ ...manifest.files[0], codec: 'ogg' }] })
		).toThrow();
	});
});
