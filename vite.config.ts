import adapter from '@sveltejs/adapter-static';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vitest/config';

const base = process.env.BASE_PATH ?? '';
if (base !== '' && (!base.startsWith('/') || base.endsWith('/'))) {
	throw new Error('BASE_PATH must be empty, or start with "/" and not end with it');
}

export default defineConfig({
	plugins: [
		sveltekit({
			// Fully static: every route is prerendered to an index.html and the
			// service worker caches all of it so the app works in airplane mode.
			// precompress writes .gz/.br next to each file for nginx gzip_static.
			adapter: adapter({ strict: true, precompress: true }),
			paths: { base: base as '' | `/${string}` },
			// Always fetch the worker script fresh so new versions are picked up.
			serviceWorker: { register: true, options: { updateViaCache: 'none' } }
		})
	],
	server: { port: 5180 },
	preview: { port: 4180 },
	// Unit tests for the data layer; end-to-end tests live in tests/ (Playwright).
	test: {
		include: ['src/**/*.test.ts'],
		environment: 'node',
		setupFiles: ['fake-indexeddb/auto']
	}
});
