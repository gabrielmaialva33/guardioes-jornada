import { createReadStream } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname, resolve, sep } from 'node:path';
import { pipeline } from 'node:stream';
import type { Plugin } from 'vite';

const types: Record<string, string> = {
	'.json': 'application/json; charset=utf-8',
	'.js': 'text/javascript; charset=utf-8',
	'.css': 'text/css; charset=utf-8',
	'.glb': 'model/gltf-binary',
	'.webp': 'image/webp',
	'.png': 'image/png',
	'.svg': 'image/svg+xml',
	'.wasm': 'application/wasm',
	'.txt': 'text/plain; charset=utf-8'
};
/** Serve raw pack bytes: Vite must not transform this separately bundled runtime. */
export function gamePackMiddleware(directory: string, base = '') {
	const prefix = `${base}/game-packs/`;
	return (request: IncomingMessage, response: ServerResponse, next: () => void): void => {
		const path = (request.url ?? '').split('?')[0];
		if (!path.startsWith(prefix)) {
			next();
			return;
		}
		response.setHeader('Cache-Control', 'no-store');
		response.setHeader('X-Content-Type-Options', 'nosniff');
		response.setHeader('X-Frame-Options', 'DENY');
		if (request.method !== 'GET' && request.method !== 'HEAD') {
			response.statusCode = 405;
			response.setHeader('Allow', 'GET, HEAD');
			response.end();
			return;
		}
		let relative: string;
		try {
			relative = decodeURIComponent(path.slice(prefix.length));
		} catch {
			response.statusCode = 404;
			response.end();
			return;
		}
		if (
			relative.includes('\\') ||
			relative.split('/').some((part) => !part || part === '.' || part === '..')
		) {
			response.statusCode = 404;
			response.end();
			return;
		}
		void (async () => {
			try {
				const [root, file] = await Promise.all([realpath(directory), realpath(resolve(directory, relative))]);
				if (!file.startsWith(root + sep)) {
					response.statusCode = 404;
					response.end();
					return;
				}
				const info = await stat(file);
				if (!info.isFile()) {
					response.statusCode = 404;
					response.end();
					return;
				}
				response.setHeader('Content-Type', types[extname(file)] ?? 'application/octet-stream');
				response.setHeader('Content-Length', info.size);
				if (request.method === 'HEAD') {
					response.end();
					return;
				}
				pipeline(createReadStream(file), response, () => {});
			} catch {
				// A missing optional manifest is normal before the first game build in dev.
				response.statusCode = relative === 'latest.json' ? 204 : 404;
				response.end();
			}
		})();
	};
}
export function gamePacksDev(base = ''): Plugin {
	return {
		name: 'built-game-packs-dev',
		apply: 'serve',
		configureServer(server) {
			server.middlewares.use(gamePackMiddleware(resolve(server.config.root, 'build/game-packs'), base));
		}
	};
}
