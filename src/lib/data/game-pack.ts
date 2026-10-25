import { decodeGameManifest, type GameManifest } from '../../../game/protocol.ts';
import {
	completeGameManifest,
	gameCacheName,
	gameCachePrefix,
	gameFileUrl,
	gameMarkerUrl
} from './game-pack-cache.ts';

export interface DownloadProgress {
	loaded: number;
	total: number;
}
interface DownloadOptions {
	signal?: AbortSignal;
	progress?: (progress: DownloadProgress) => void;
}

/** The active pointer is one atomic Cache.put, written only after the complete marker. */
export class GamePacks {
	readonly root: URL;
	#storage: CacheStorage;
	#fetch: typeof fetch;
	#registry: string;
	#pointer: string;
	constructor(options: { root: URL; storage?: CacheStorage; fetch?: typeof fetch }) {
		this.root = new URL(options.root);
		if (!this.root.pathname.endsWith('/')) throw new Error('invalid-game-base');
		this.#storage = options.storage ?? globalThis.caches;
		this.#fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
		this.#registry = `${gameCachePrefix(this.root)}registry`;
		this.#pointer = new URL('game-packs/__active__', this.root).href;
	}
	async current(): Promise<GameManifest | null> {
		try {
			if (!(await this.#storage.has(this.#registry))) return null;
			const index = await this.#storage.open(this.#registry);
			const response = await index.match(this.#pointer);
			if (!response) return null;
			const record = await response.json();
			for (const value of [record.active, record.previous]) {
				try {
					const manifest = decodeGameManifest(value);
					const name = gameCacheName(this.root, manifest.packId);
					if (!(await this.#storage.has(name))) continue;
					const complete = await completeGameManifest(
						await this.#storage.open(name),
						this.root,
						manifest.packId
					);
					if (complete) return complete;
				} catch {
					/* A damaged pack must not hide the previous complete version. */
				}
			}
		} catch {
			/* CacheStorage may be disabled. Downloads report the actionable error. */
		}
		return null;
	}
	async latest(signal?: AbortSignal): Promise<GameManifest> {
		const bytes = await this.#read(new URL('game-packs/latest.json', this.root).href, signal, 512 * 1024);
		return decodeGameManifest(JSON.parse(new TextDecoder().decode(bytes)));
	}
	async download(input: GameManifest, options: DownloadOptions = {}): Promise<GameManifest> {
		const manifest = decodeGameManifest(input);
		const download = () => this.#download(manifest, options);
		// Serializes publication across tabs. Without Web Locks each publish is still atomic.
		if (typeof navigator !== 'undefined' && navigator.locks) {
			return navigator.locks.request(
				`game-download:${this.root.pathname}`,
				{ signal: options.signal },
				download
			);
		}
		return download();
	}
	async #download(manifest: GameManifest, { signal, progress }: DownloadOptions): Promise<GameManifest> {
		signal?.throwIfAborted();
		const total = manifest.files.reduce((sum, file) => sum + file.bytes, 0);
		let loaded = 0;
		progress?.({ loaded, total });
		const name = gameCacheName(this.root, manifest.packId);
		const final = await this.#storage.open(name);
		if (await completeGameManifest(final, this.root, manifest.packId)) {
			await this.#publish(manifest, signal);
			progress?.({ loaded: total, total });
			return manifest;
		}
		const stagingName = `${name}:staging:${crypto.randomUUID()}`;
		try {
			const staging = await this.#storage.open(stagingName);
			for (const file of manifest.files) {
				const url = gameFileUrl(this.root, manifest.packId, file.path);
				const bytes = await this.#read(
					url,
					signal,
					file.bytes,
					(count) => {
						loaded += count;
						progress?.({ loaded, total });
					},
					file.bytes
				);
				const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (v) =>
					v.toString(16).padStart(2, '0')
				).join('');
				if (hash !== file.sha256) throw new Error('game-integrity');
				signal?.throwIfAborted();
				await staging.put(url, new Response(bytes, { headers: { 'Content-Type': contentType(file.path) } }));
			}
			for (const file of manifest.files) {
				signal?.throwIfAborted();
				const url = gameFileUrl(this.root, manifest.packId, file.path);
				const response = await staging.match(url);
				if (!response) throw new Error('game-incomplete');
				await final.put(url, response);
			}
			signal?.throwIfAborted();
			await final.put(gameMarkerUrl(this.root, manifest.packId), Response.json(manifest));
			await this.#publish(manifest, signal);
			return manifest;
		} finally {
			await this.#storage.delete(stagingName).catch(() => {});
		}
	}
	async #publish(manifest: GameManifest, signal?: AbortSignal) {
		const previous = await this.current();
		const registry = await this.#storage.open(this.#registry);
		signal?.throwIfAborted();
		await registry.put(this.#pointer, Response.json({ active: manifest, previous }));
		// Complete packs are retained for old open clients and offline rollback.
		// They are never part of app-version eviction; quota failure keeps the active pointer.
	}
	async #read(
		url: string,
		signal: AbortSignal | undefined,
		max: number,
		progress?: (count: number) => void,
		expected?: number
	): Promise<Uint8Array<ArrayBuffer>> {
		const controller = new AbortController();
		const abort = () => controller.abort(signal?.reason);
		signal?.throwIfAborted();
		signal?.addEventListener('abort', abort, { once: true });
		const timer = setTimeout(() => controller.abort(new Error('game-download-timeout')), 60_000);
		try {
			const response = await this.#fetch(url, { cache: 'no-store', signal: controller.signal });
			if (!response.ok) throw new Error('game-download-http');
			const reader = response.body?.getReader();
			if (!reader) throw new Error('game-download-body');
			let length = 0;
			const chunks: Uint8Array[] = [];
			try {
				while (true) {
					controller.signal.throwIfAborted();
					const { done, value } = await reader.read();
					if (done) break;
					length += value.length;
					if (length > max) throw new Error('game-download-size');
					chunks.push(value);
					progress?.(value.length);
				}
			} finally {
				await reader.cancel().catch(() => {});
				reader.releaseLock();
			}
			controller.signal.throwIfAborted();
			if (expected !== undefined && length !== expected) throw new Error('game-download-size');
			const result = new Uint8Array(length);
			let offset = 0;
			for (const chunk of chunks) {
				result.set(chunk, offset);
				offset += chunk.length;
			}
			return result;
		} finally {
			clearTimeout(timer);
			signal?.removeEventListener('abort', abort);
		}
	}
}
function contentType(path: string): string {
	if (path.endsWith('.js')) return 'application/javascript';
	if (path.endsWith('.css')) return 'text/css';
	if (path.endsWith('.glb')) return 'model/gltf-binary';
	if (path.endsWith('.json')) return 'application/json';
	if (path.endsWith('.webp')) return 'image/webp';
	if (path.endsWith('.png')) return 'image/png';
	if (path.endsWith('.svg')) return 'image/svg+xml';
	if (path.endsWith('.wasm')) return 'application/wasm';
	return 'application/octet-stream';
}
