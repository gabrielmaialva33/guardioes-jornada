/**
 * Dev-server-only middleware of the LOCAL-ONLY Green Hell study mode
 * (game/src/study/). It serves the owner's extraction in the git-ignored
 * `tmp/greenhell-port/` at `/__estudo/greenhell/`, read-only, straight from
 * disk: nothing is copied, transformed or bundled. The assets belong to Creepy
 * Jar and have no licence for redistribution, so this plugin applies to `serve`
 * only and a build never sees them. Modelled on dev-pack.ts.
 */
import { createReadStream } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname, resolve, sep } from 'node:path';
import { pipeline } from 'node:stream';
import type { Plugin } from 'vite';

export const STUDY_DEV_PREFIX = '/__estudo/greenhell/';

/** Only what the study runtime fetches: models, textures, sounds and the JSON inventories. */
const types: Record<string, string> = {
	'.glb': 'model/gltf-binary',
	'.json': 'application/json; charset=utf-8',
	'.png': 'image/png',
	'.webp': 'image/webp',
	'.jpg': 'image/jpeg',
	'.webm': 'audio/webm',
	'.m4a': 'audio/mp4',
	'.ogg': 'audio/ogg'
};

export function studyMiddleware(directory: string, base = '') {
	const prefix = `${base}${STUDY_DEV_PREFIX}`;
	return (request: IncomingMessage, response: ServerResponse, next: () => void): void => {
		const path = (request.url ?? '').split('?')[0];
		if (!path.startsWith(prefix)) {
			next();
			return;
		}
		const fail = (status: number) => {
			response.statusCode = status;
			response.end();
		};
		response.setHeader('Cache-Control', 'no-store');
		response.setHeader('X-Content-Type-Options', 'nosniff');
		response.setHeader('X-Frame-Options', 'DENY');
		// Dev machine only: never cached by a proxy, never indexed.
		response.setHeader('X-Robots-Tag', 'noindex');
		if (request.method !== 'GET' && request.method !== 'HEAD') {
			response.setHeader('Allow', 'GET, HEAD');
			fail(405);
			return;
		}
		let relative: string;
		try {
			relative = decodeURIComponent(path.slice(prefix.length));
		} catch {
			fail(404);
			return;
		}
		if (
			relative.includes('\\') ||
			relative.includes('\0') ||
			relative.split('/').some((part) => !part || part === '.' || part === '..' || part.startsWith('.'))
		) {
			fail(404);
			return;
		}
		const type = types[extname(relative).toLowerCase()];
		if (!type) {
			fail(404);
			return;
		}
		void (async () => {
			try {
				const [root, file] = await Promise.all([realpath(directory), realpath(resolve(directory, relative))]);
				if (!file.startsWith(root + sep)) {
					fail(404);
					return;
				}
				const info = await stat(file);
				if (!info.isFile()) {
					fail(404);
					return;
				}
				response.setHeader('Content-Type', type);
				response.setHeader('Content-Length', info.size);
				if (request.method === 'HEAD') {
					response.end();
					return;
				}
				pipeline(createReadStream(file), response, () => {});
			} catch {
				fail(404);
			}
		})();
	};
}

/** `apply: 'serve'`: the plugin does not exist in `vite build`. */
export function greenHellStudyDev(): Plugin {
	return {
		name: 'greenhell-study-dev',
		apply: 'serve',
		configureServer(server) {
			server.middlewares.use(studyMiddleware(resolve(server.config.root, '../tmp/greenhell-port')));
		}
	};
}
