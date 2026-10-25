import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { gamePackMiddleware } from './dev-pack.ts';

let scratch: string;
let origin: string;
const root = () => join(scratch, 'packs');
const server = createServer((request, response) => {
	gamePackMiddleware(root(), '/app')(request, response, () => {
		response.statusCode = 404;
		response.end('unhandled');
	});
});
beforeAll(async () => {
	const parent = join(homedir(), '.cache/agents/2026-10-25-trilha-secreta');
	await mkdir(parent, { recursive: true });
	scratch = await mkdtemp(join(parent, 'dev-pack-http-'));
	await mkdir(join(root(), 'pack'), { recursive: true });
	await writeFile(join(root(), 'latest.json'), '{}');
	await writeFile(join(root(), 'pack/entry.js'), 'export const abi = 1;');
	await writeFile(join(scratch, 'private.txt'), 'outside-root');
	await symlink(join(scratch, 'private.txt'), join(root(), 'leak.txt'));
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
	const address = server.address();
	if (!address || typeof address === 'string') throw new Error('server-address');
	origin = `http://127.0.0.1:${address.port}`;
});
afterAll(async () => {
	server.closeIdleConnections();
	await new Promise<void>((resolve) => server.close(() => resolve()));
	await rm(scratch, { recursive: true, force: true });
});
it('serves raw built JSON and JavaScript under the app base, with query strings and HEAD', async () => {
	const manifest = await fetch(`${origin}/app/game-packs/latest.json?fresh=1`);
	expect(manifest.status).toBe(200);
	expect(manifest.headers.get('Content-Type')).toContain('application/json');
	expect(await manifest.json()).toEqual({});
	const script = await fetch(`${origin}/app/game-packs/pack/entry.js`);
	expect(script.headers.get('Content-Type')).toContain('javascript');
	expect(script.headers.get('Cache-Control')).toBe('no-store');
	expect(await script.text()).toBe('export const abi = 1;');
	const head = await fetch(`${origin}/app/game-packs/pack/entry.js`, { method: 'HEAD' });
	expect(head.status).toBe(200);
	expect(await head.text()).toBe('');
});
it('never reads outside the built pack root, even via encoded traversal or symlinks', async () => {
	for (const path of ['%2e%2e%2fprivate.txt', 'leak.txt', 'pack%5c..%5cprivate.txt', '%zz'])
		expect((await fetch(`${origin}/app/game-packs/${path}`)).status).toBe(404);
});
it('does not intercept application routes or permit write methods', async () => {
	expect(await (await fetch(`${origin}/app/journey/`)).text()).toBe('unhandled');
	expect((await fetch(`${origin}/app/game-packs/latest.json`, { method: 'POST' })).status).toBe(405);
});
it('a fresh checkout with no built manifest has optional metadata, not a console-producing 404', async () => {
	const missing = createServer((request, response) =>
		gamePackMiddleware(join(scratch, 'missing'))(request, response, () => response.end())
	);
	await new Promise<void>((resolve) => missing.listen(0, '127.0.0.1', resolve));
	const address = missing.address();
	if (!address || typeof address === 'string') throw new Error('server-address');
	try {
		const response = await fetch(`http://127.0.0.1:${address.port}/game-packs/latest.json`);
		expect(response.status).toBe(204);
		expect(await response.text()).toBe('');
	} finally {
		missing.closeIdleConnections();
		await new Promise<void>((resolve) => missing.close(() => resolve()));
	}
});
