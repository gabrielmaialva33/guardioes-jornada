import { afterEach, describe, expect, it, vi } from 'vitest';
import { GAME_ABI, type GameManifest } from '../../../game/protocol.ts';
import { GamePacks, getGamePackInfo } from './game-pack.ts';
import { gameCacheName, gameFileUrl, matchGamePack } from './game-pack-cache.ts';
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
			sizeKB: 2
		});
		await new GamePacks({ root, storage, fetch: vi.fn(async () => new Response('A')) }).download(manifest);
		request.mockClear();
		expect(await getGamePackInfo(root)).toEqual({
			complete: true,
			packId: manifest.packId,
			missingBytes: 0,
			sizeKB: 0
		});
		expect(request).not.toHaveBeenCalled();
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
