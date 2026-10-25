import { version } from '$app/env';
import { assets, immutable, prerendered } from '$app/manifest';
import { asset, resolve } from '$app/paths';
import { self } from '$app/service-worker';
import { cachePrefix, obsoleteCaches, previousAsset } from '#lib/data/worker-cache.ts';

/**
 * Caches the whole app on the first visit with a connection. After that it
 * opens and works in airplane mode: there is barely any signal inside the park.
 */
const root = new URL(resolve('/'), self.location.origin);
const PREFIX = cachePrefix(root.pathname);
const CACHE = `${PREFIX}${version}`;
const toUrl = (path: string) => new URL(path, root).pathname;

const APP_FILES = [
	...new Set([
		...immutable.map(({ path }) => toUrl(path)),
		...assets.map(({ path }) => toUrl(asset(path))),
		...prerendered.map(({ path }) => toUrl(resolve(path)))
	])
];
const PRECACHED = new Set(APP_FILES);

self.addEventListener('install', (event) => {
	event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(APP_FILES)));
});

self.addEventListener('activate', (event) => {
	event.waitUntil(
		caches
			.keys()
			.then((keys) => Promise.all(obsoleteCaches(keys, PREFIX, CACHE).map((key) => caches.delete(key))))
			.then(() => self.clients.claim())
	);
});

// The page asks a waiting worker to take over when the guide taps "update".
// Never forced mid-journey: the guide chooses when.
self.addEventListener('message', (event) => {
	if (event.data === 'skip-waiting') void self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
	const request = event.request;
	if (request.method !== 'GET') return;
	const url = new URL(request.url);
	// Supabase and every other origin go straight to the network.
	if (url.origin !== self.location.origin) return;

	event.respondWith(
		(async () => {
			const cache = await caches.open(CACHE);

			// App files never change within a version: serve them from the cache.
			if (PRECACHED.has(url.pathname)) {
				const hit = await cache.match(url.pathname);
				if (hit) return hit;
			}

			// Open clients may still import the previous build's hashed modules.
			if (url.pathname.startsWith(root.pathname + '_app/immutable/')) {
				const previous = await previousAsset(caches, PREFIX, CACHE, url.pathname);
				if (previous) return previous;
			}

			try {
				const response = await fetch(request);
				if (response.ok && response.type === 'basic') event.waitUntil(cache.put(request, response.clone()));
				return response;
			} catch (error) {
				const hit = await cache.match(request, { ignoreSearch: true });
				if (hit) return hit;
				if (request.mode === 'navigate') {
					const home = await cache.match(root.pathname);
					if (home) return home;
				}
				throw error;
			}
		})()
	);
});
