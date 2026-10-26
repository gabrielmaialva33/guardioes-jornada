/** Production-only P1 proof. Builds isolated A/B/C artifacts; never deploys or calls cloud APIs. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { cp, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { homedir } from 'node:os';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type BrowserContext, chromium } from '@playwright/test';
import {
	AUDIO_CODECS,
	type AudioCodec,
	decodeGameManifest,
	type GameManifest,
	requiredFiles
} from './protocol.ts';
import { createGraybox } from './src/engine/graybox.ts';

const project = fileURLToPath(new URL('../', import.meta.url));
const output =
	process.env.GAME_ACCEPTANCE_DIR ?? join(homedir(), '.cache/agents/2026-10-25-trilha-secreta/p1-acceptance');
await mkdir(output, { recursive: true });
async function build(label: string, snapshot = true) {
	const log = createWriteStream(join(output, `build-${label}.log`));
	await new Promise<void>((done, reject) => {
		const child = spawn('pnpm', ['build'], {
			cwd: project,
			env: {
				...process.env,
				GAME_BUILD_TAG: snapshot ? label : '',
				GAME_ALLOW_SOFTWARE_TEST: snapshot ? '1' : '0'
			},
			stdio: ['ignore', 'pipe', 'pipe']
		});
		child.stdout.pipe(log);
		child.stderr.pipe(log);
		child.once('error', reject);
		child.once('exit', (code) => (code === 0 ? done() : reject(new Error(`build ${label} failed: ${code}`))));
	});
	log.end();
	if (snapshot) await cp(join(project, 'build'), join(output, label), { recursive: true, force: true });
	console.info(`Built ${label}`);
}
for (const label of ['A', 'B', 'C']) await build(label);
const manifests = await Promise.all(
	['A', 'B', 'C'].map(async (label) =>
		decodeGameManifest(JSON.parse(await readFile(join(output, label, 'game-packs/latest.json'), 'utf8')))
	)
);
assert.equal(new Set(manifests.map((manifest) => manifest.packId)).size, 3);
/** What a device with `codec` downloads: raw bytes and the transfer the launcher announces (gzip where generated). */
const download = (manifest: GameManifest, codec: AudioCodec) => {
	const files = requiredFiles(manifest, codec);
	return {
		files: files.length,
		bytes: files.reduce((sum, file) => sum + file.bytes, 0),
		transfer: files.reduce((sum, file) => sum + (file.gzipBytes ?? file.bytes), 0)
	};
};
const audioBytes = (manifest: GameManifest, codec: AudioCodec) =>
	manifest.files.filter((file) => file.codec === codec).reduce((sum, file) => sum + file.bytes, 0);

let served = 'A';
let hold: { url: string; ready: () => void; release: Promise<void> } | undefined;
const requests: string[] = [];
const types: Record<string, string> = {
	'.html': 'text/html',
	'.js': 'application/javascript',
	'.json': 'application/json',
	'.css': 'text/css',
	'.woff2': 'font/woff2',
	'.svg': 'image/svg+xml',
	'.png': 'image/png',
	'.glb': 'model/gltf-binary'
};
const server = createServer(async (request, response) => {
	try {
		const path = new URL(request.url ?? '/', 'http://localhost').pathname;
		requests.push(path);
		if (hold?.url === path) {
			hold.ready();
			await hold.release;
		}
		const root = resolve(output, served);
		let file = resolve(root, `.${path}`);
		if (file !== root && !file.startsWith(`${root}/`)) throw new Error('path');
		if ((await stat(file)).isDirectory()) file = join(file, 'index.html');
		const extension = extname(file);
		response.setHeader('Content-Type', types[extension] ?? 'application/octet-stream');
		response.setHeader('X-Frame-Options', 'DENY');
		response.setHeader(
			'Cache-Control',
			path.startsWith('/game-packs/') && !path.endsWith('/latest.json')
				? 'public, max-age=31536000, immutable'
				: 'no-cache'
		);
		if (request.headers['accept-encoding']?.includes('gzip')) {
			try {
				const compressed = await readFile(`${file}.gz`);
				response.setHeader('Content-Encoding', 'gzip');
				response.end(compressed);
				return;
			} catch {
				/* Serve the original when no encoding exists. */
			}
		}
		response.end(await readFile(file));
	} catch {
		response.writeHead(404);
		response.end('not found');
	}
});
await new Promise<void>((done, reject) => {
	server.once('error', reject);
	server.listen(4190, '127.0.0.1', done);
});
const browser = await chromium.launch({
	channel: process.env.PLAYWRIGHT_CHANNEL ?? 'chrome',
	headless: true,
	args: [
		'--no-sandbox',
		'--remote-debugging-port=9238',
		...(process.env.GAME_TEST_ANGLE ? [`--use-angle=${process.env.GAME_TEST_ANGLE}`] : [])
	]
});
const origin = 'http://127.0.0.1:4190';
const result: Record<string, unknown> = {
	packIds: manifests.map((manifest) => manifest.packId),
	packBytes: manifests.map((manifest) => ({
		all: manifest.files.reduce((sum, file) => sum + file.bytes, 0),
		audio: Object.fromEntries(AUDIO_CODECS.map((codec) => [codec, audioBytes(manifest, codec)])),
		device: Object.fromEntries(AUDIO_CODECS.map((codec) => [codec, download(manifest, codec)]))
	}))
};
try {
	const context = await browser.newContext({
		viewport: { width: 412, height: 915 },
		isMobile: true,
		hasTouch: true
	});
	// Raw CDP sessions include workers: page-only offline emulation can leave a worker online.
	const version = await (await fetch('http://127.0.0.1:9238/json/version')).json();
	const wire = new WebSocket(version.webSocketDebuggerUrl);
	await new Promise<void>((done, reject) => {
		wire.onopen = () => done();
		wire.onerror = reject;
	});
	let id = 0,
		offline = false;
	const sessions = new Set<string>();
	const replies = new Map<number, (value: { error?: { message: string }; result?: unknown }) => void>();
	const send = (sessionId: string | undefined, method: string, params: object = {}) =>
		new Promise<unknown>((done, reject) => {
			const command = ++id;
			const timer = setTimeout(() => {
				replies.delete(command);
				reject(new Error(`${method} timed out`));
			}, 10000);
			replies.set(command, (reply) => {
				clearTimeout(timer);
				if (reply.error) reject(new Error(reply.error.message));
				else done(reply.result);
			});
			wire.send(JSON.stringify({ id: command, method, params, ...(sessionId ? { sessionId } : {}) }));
		});
	const network = (sessionId: string) =>
		send(sessionId, 'Network.emulateNetworkConditions', {
			offline,
			latency: 0,
			downloadThroughput: offline ? 0 : -1,
			uploadThroughput: offline ? 0 : -1
		});
	const workerErrors: string[] = [];
	wire.onmessage = async ({ data }) => {
		const message = JSON.parse(String(data));
		const reply = replies.get(message.id);
		if (reply) {
			replies.delete(message.id);
			reply(message);
			return;
		}
		if (message.method === 'Target.detachedFromTarget') {
			sessions.delete(message.params.sessionId);
			return;
		}
		if (message.method !== 'Target.attachedToTarget' || message.params.targetInfo.type !== 'service_worker')
			return;
		const sessionId: string = message.params.sessionId;
		sessions.add(sessionId);
		try {
			await send(sessionId, 'Network.enable');
			await network(sessionId);
			await send(sessionId, 'Runtime.runIfWaitingForDebugger');
		} catch (error) {
			workerErrors.push(String(error));
		}
	};
	await send(undefined, 'Target.setAutoAttach', {
		autoAttach: true,
		waitForDebuggerOnStart: true,
		flatten: true,
		filter: [{ type: 'service_worker', exclude: false }]
	});
	const setOffline = async (value: boolean, target: BrowserContext = context) => {
		offline = value;
		await target.setOffline(value);
		await Promise.all([...sessions].map(network));
	};
	await context.addInitScript(() => {
		Object.defineProperty(navigator, 'deviceMemory', { get: () => 8 });
		Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 });
		const connection = (navigator as Navigator & { connection?: object }).connection;
		if (connection) Object.defineProperty(connection, 'effectiveType', { get: () => '4g' });
		const metrics = {
			contexts: 0,
			maxContexts: 0,
			created: 0,
			disposed: 0,
			raf: new Set<number>(),
			listeners: [] as {
				target: EventTarget;
				type: string;
				listener: EventListenerOrEventListenerObject;
				capture: boolean;
				wrapped: EventListener;
			}[]
		};
		Object.assign(window, { __packMetrics: metrics });
		const originalContext = HTMLCanvasElement.prototype.getContext;
		const seen = new WeakSet<object>();
		HTMLCanvasElement.prototype.getContext = function (
			this: HTMLCanvasElement,
			...args: Parameters<typeof originalContext>
		) {
			const value = originalContext.apply(this, args);
			if (value && /^webgl/.test(args[0]) && !seen.has(value)) {
				seen.add(value);
				metrics.contexts++;
				metrics.created++;
				metrics.maxContexts = Math.max(metrics.maxContexts, metrics.contexts);
				const gl = value as WebGL2RenderingContext;
				const getExtension = gl.getExtension.bind(gl);
				let lost = false;
				gl.getExtension = ((name: string) => {
					const extension = getExtension(name);
					if (name !== 'WEBGL_lose_context' || !extension) return extension;
					return {
						loseContext: () => {
							if (!lost) {
								lost = true;
								metrics.contexts--;
								metrics.disposed++;
							}
							(extension as WEBGL_lose_context).loseContext();
						},
						restoreContext: () => (extension as WEBGL_lose_context).restoreContext()
					};
				}) as typeof gl.getExtension;
			}
			return value;
		} as typeof originalContext;
		const raf = window.requestAnimationFrame.bind(window),
			cancel = window.cancelAnimationFrame.bind(window);
		window.requestAnimationFrame = (callback) => {
			const handle = raf((time) => {
				metrics.raf.delete(handle);
				callback(time);
			});
			metrics.raf.add(handle);
			return handle;
		};
		window.cancelAnimationFrame = (handle) => {
			metrics.raf.delete(handle);
			cancel(handle);
		};
		const add = EventTarget.prototype.addEventListener,
			remove = EventTarget.prototype.removeEventListener;
		EventTarget.prototype.addEventListener = function (type, listener, options) {
			if (!listener || (this !== window && this !== document)) return add.call(this, type, listener, options);
			const capture = typeof options === 'boolean' ? options : !!options?.capture;
			if (
				metrics.listeners.some(
					(r) => r.target === this && r.type === type && r.listener === listener && r.capture === capture
				)
			)
				return;
			const record = { target: this, type, listener, capture, wrapped: (() => {}) as EventListener };
			const forget = () => {
				const index = metrics.listeners.indexOf(record);
				if (index >= 0) metrics.listeners.splice(index, 1);
			};
			record.wrapped = (event) => {
				if (typeof options === 'object' && options.once) forget();
				if (typeof listener === 'function') listener.call(this, event);
				else listener.handleEvent(event);
			};
			if (typeof options === 'object' && options.signal) {
				if (options.signal.aborted) return;
				add.call(options.signal, 'abort', forget, { once: true });
			}
			metrics.listeners.push(record);
			add.call(this, type, record.wrapped, options);
		};
		EventTarget.prototype.removeEventListener = function (type, listener, options) {
			const capture = typeof options === 'boolean' ? options : !!options?.capture;
			const index = metrics.listeners.findIndex(
				(r) => r.target === this && r.type === type && r.listener === listener && r.capture === capture
			);
			if (index >= 0) {
				const [record] = metrics.listeners.splice(index, 1);
				return remove.call(this, type, record.wrapped, options);
			}
			return remove.call(this, type, listener, options);
		};
	});
	const page = await context.newPage();
	// Every sound the page asks for, served by the worker or not: a device must only ever ask for its codec.
	const audioRequests: string[] = [];
	page.on('request', (request) => {
		const path = new URL(request.url()).pathname;
		if (/\.(webm|m4a)$/.test(path)) audioRequests.push(path);
	});
	/** The audio codec recorded in a pack's completion marker and the codecs of the sounds its cache holds. */
	const packAudio = (packId: string) =>
		page.evaluate(async (id) => {
			const name = (await caches.keys()).find((key) => key.startsWith('guardioes-game:') && key.endsWith(id));
			if (!name) throw new Error('no pack cache');
			const cache = await caches.open(name);
			const urls = (await cache.keys()).map((request) => new URL(request.url).pathname);
			const marker = urls.find((url) => url.endsWith('/__complete__.json'));
			return {
				marker: marker ? (await (await cache.match(marker))?.json())?.audioCodec : undefined,
				webm: urls.filter((url) => url.endsWith('.webm')).length,
				m4a: urls.filter((url) => url.endsWith('.m4a')).length
			};
		}, packId);
	const errors: string[] = [];
	page.on('pageerror', (error) => errors.push(error.message));
	const cdp = await context.newCDPSession(page);
	await cdp.send('Network.enable');
	await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
	const initialResponse = await page.goto(origin);
	assert.equal(initialResponse?.status(), 200);
	console.info('Home loaded');
	await page.evaluate(() => navigator.serviceWorker.ready.then(() => {}));
	await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
	await page.waitForTimeout(500);
	assert.equal(requests.filter((path) => path.startsWith('/game-packs/')).length, 0);
	const shell = await page.evaluate(async () =>
		Promise.all(
			(await caches.keys())
				.filter((name) => name.startsWith('guardioes-') && !name.startsWith('guardioes-game:'))
				.map(async (name) => (await (await caches.open(name)).keys()).map((request) => request.url))
		)
	);
	assert.equal(shell.flat().filter((url) => url.includes('/game-packs/')).length, 0);
	result.zeroGameBytesAtInstall = true;
	console.info('Install: zero game bytes');
	await page.locator('figure.scene').first().scrollIntoViewIfNeeded();
	await page
		.locator('.scene3d.ready canvas')
		.first()
		.waitFor({ timeout: 15000 })
		.catch(() => {});
	result.dioramaVisible = (await page.locator('.scene3d.ready canvas').count()) > 0;
	// SPA navigation deliberately exercises the diorama's 1.5-second release grace.
	await page.evaluate(() => {
		const a = document.createElement('a');
		a.href = '/secret-trail/?debug&graybox';
		a.textContent = 'test navigation';
		document.body.append(a);
		a.click();
		a.remove();
	});
	await page.getByRole('button', { name: 'Entrar na trilha', exact: true }).waitFor();
	// Chrome plays Opus, so the launcher sizes and downloads the WebM sounds only.
	const firstDownload = download(manifests[0], 'webm');
	const announced = page.getByText(/Na primeira vez, baixa cerca de/);
	await announced.waitFor();
	const announcedText = (await announced.textContent())?.replace(/\s+/g, ' ').trim() ?? '';
	const megabytes = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 });
	const expectedSize =
		firstDownload.transfer < 1024 * 1024
			? `${Math.ceil(firstDownload.transfer / 1024)} KB`
			: `${megabytes.format(Math.ceil(firstDownload.transfer / 1024) / 1024)} MB`;
	assert.ok(announcedText.includes(`cerca de ${expectedSize}`), `${announcedText} / ${expectedSize}`);
	result.launcherSize = { announced: announcedText, expected: expectedSize, webm: firstDownload };
	const beforeDownload = requests.length;
	await page.getByRole('button', { name: 'Entrar na trilha', exact: true }).click();
	await page.locator('[data-game-root] canvas').waitFor({ timeout: 30000 });
	assert.equal(await page.locator('main[data-pack-id]').getAttribute('data-pack-id'), manifests[0].packId);
	await page.waitForFunction(() => globalThis.__gameDebug?.().ready === true);
	const downloadedA = requests
		.slice(beforeDownload)
		.filter((path) => path.startsWith(`/game-packs/${manifests[0].packId}/`));
	assert.equal(downloadedA.filter((path) => path.endsWith('.m4a')).length, 0);
	await writeFile(join(output, 'download-requests.json'), JSON.stringify(downloadedA, null, 2));
	assert.equal(downloadedA.length, firstDownload.files);
	const audioA = await packAudio(manifests[0].packId);
	assert.deepEqual(audioA, {
		marker: 'webm',
		webm: manifests[0].files.filter((file) => file.codec === 'webm').length,
		m4a: 0
	});
	result.packAAudio = { ...audioA, downloadedFiles: downloadedA.length };
	if (await page.getByRole('button', { name: 'Jogar assim mesmo', exact: true }).isVisible())
		await page.getByRole('button', { name: 'Jogar assim mesmo', exact: true }).click();
	const obby = createGraybox().obby;
	await page.evaluate(
		async (edges) => {
			await new Promise<void>((done, reject) => {
				const deadline = performance.now() + 20000;
				let space = false;
				const key = (type: string, code: string) => window.dispatchEvent(new KeyboardEvent(type, { code }));
				key('keydown', 'KeyW');
				const tick = () => {
					const state = globalThis.__gameDebug?.();
					if (space) {
						key('keyup', 'Space');
						space = false;
					}
					if (state?.checkpoint === 'summit' || performance.now() > deadline) {
						key('keyup', 'KeyW');
						if (state?.checkpoint === 'summit') done();
						else reject(new Error(`Obby traversal failed: ${JSON.stringify(state)}`));
						return;
					}
					if (state?.grounded && edges.some((edge) => state.z > edge - 0.45 && state.z < edge)) {
						key('keydown', 'Space');
						space = true;
					}
					requestAnimationFrame(tick);
				};
				tick();
			});
		},
		[obby.edgeZ, ...obby.platforms.slice(0, -1).map((platform) => platform.to)]
	);
	result.grayboxAtSummit = await page.evaluate(() => globalThis.__gameDebug?.());
	assert.ok(await page.evaluate(() => Number(localStorage.getItem('guardioes-secret-badge')) > 0));
	await page.getByRole('button', { name: 'Personalizar personagem', exact: true }).click();
	assert.equal(await page.locator('.presets .preset').count(), 18);
	assert.equal(await page.locator('.chooser canvas').count(), 0);
	await page.getByRole('tab', { name: 'Skins da Kenney', exact: true }).click();
	await page.getByRole('button', { name: 'Skin da Kenney r', exact: true }).click();
	await page.getByRole('button', { name: 'Usar este personagem', exact: true }).click();
	await page.getByRole('dialog').waitFor({ state: 'hidden' });
	assert.equal(await page.evaluate(() => globalThis.__gameDebug?.().avatarStyle), 'kenney');
	result.avatarChooser = { presets: 18, previewCanvases: 0, savedSkin: 'r' };

	await page.getByRole('button', { name: 'Voltar à jornada', exact: true }).click();
	await page.getByRole('button', { name: 'Entrar na trilha', exact: true }).waitFor();
	await page.waitForTimeout(200);
	const metrics = () =>
		page.evaluate(() => {
			const m = (
				window as unknown as {
					__packMetrics: {
						contexts: number;
						maxContexts: number;
						created: number;
						disposed: number;
						raf: Set<number>;
						listeners: unknown[];
					};
				}
			).__packMetrics;
			return {
				contexts: m.contexts,
				maxContexts: m.maxContexts,
				created: m.created,
				disposed: m.disposed,
				raf: m.raf.size,
				listeners: m.listeners.length
			};
		});
	const baseline = await metrics();
	const cycles = [];
	for (let cycle = 0; cycle < 20; cycle++) {
		await page.getByRole('button', { name: 'Entrar na trilha', exact: true }).click();
		await page.locator('[data-game-root] canvas').waitFor();
		await page.waitForFunction(() => globalThis.__gameDebug?.().ready === true);
		if (await page.getByRole('button', { name: 'Jogar assim mesmo', exact: true }).isVisible())
			await page.getByRole('button', { name: 'Jogar assim mesmo', exact: true }).click();
		await page.getByRole('button', { name: 'Voltar à jornada', exact: true }).click();
		await page.getByRole('button', { name: 'Entrar na trilha', exact: true }).waitFor();
		await page.waitForTimeout(50);
		const current = await metrics();
		cycles.push(current);
		assert.equal(current.contexts, 0);
		assert.equal(current.raf, baseline.raf);
		assert.equal(current.listeners, baseline.listeners);
		assert.ok(current.maxContexts <= 1);
	}
	result.cycles = { baseline, after: cycles.at(-1), count: cycles.length };
	result.badgeBridge = true;
	console.info('20 lifecycle cycles passed');
	const installRequests = requests.length;
	for (const label of ['B', 'C']) {
		served = label;
		await page.evaluate(async () => {
			const registration = await navigator.serviceWorker.getRegistration();
			if (!registration) throw new Error('no worker');
			await registration.update();
			await new Promise<void>((done) => {
				const poll = () => (registration.waiting ? done() : setTimeout(poll, 25));
				poll();
			});
			await new Promise<void>((done) => {
				navigator.serviceWorker.addEventListener('controllerchange', () => done(), { once: true });
				registration.waiting?.postMessage('skip-waiting');
			});
		});
		await page.reload();
		await page.getByRole('button', { name: 'Entrar na trilha', exact: true }).waitFor();
		assert.equal(await page.locator('main[data-pack-id]').getAttribute('data-pack-id'), manifests[0].packId);
	}
	assert.equal(requests.slice(installRequests).filter((path) => path.startsWith('/game-packs/')).length, 0);
	await setOffline(true);
	const networkBefore = requests.length;
	await page.reload();
	await page.getByRole('button', { name: 'Entrar na trilha', exact: true }).click();
	await page.locator('[data-game-root] canvas').waitFor();
	await page.waitForFunction(() => globalThis.__gameDebug?.().ready === true);
	if (await page.getByRole('button', { name: 'Jogar assim mesmo', exact: true }).isVisible())
		await page.getByRole('button', { name: 'Jogar assim mesmo', exact: true }).click();
	assert.equal(await page.locator('main[data-pack-id]').getAttribute('data-pack-id'), manifests[0].packId);
	assert.equal(requests.length, networkBefore);
	assert.ok(sessions.size > 0);
	assert.equal(await page.evaluate(() => globalThis.__gameDebug?.().avatarStyle), 'kenney');
	assert.equal(await page.evaluate(() => globalThis.__gameDebug?.().avatarSkin), 'r');
	result.offlineAvatarPreference = true;
	result.offlineAtCUsesA = true;
	console.info('A still opens offline at C');
	await page.getByRole('button', { name: 'Voltar à jornada', exact: true }).click();
	await page.getByRole('button', { name: 'Entrar na trilha', exact: true }).waitFor();
	const updateButton = page.getByRole('button', { name: 'Baixar versão mais recente', exact: true });
	const offlineHint = await page.evaluate(() => navigator.onLine);
	result.offlineNavigatorOnline = offlineHint;
	console.info(`Offline navigator.onLine: ${offlineHint}; update buttons: ${await updateButton.count()}`);
	if (!offlineHint) assert.equal(await updateButton.count(), 0);
	await setOffline(false);
	await updateButton.waitFor({ state: 'visible' });
	result.updateVisibleAfterReconnect = true;
	let arrived: () => void = () => {};
	const downloading = new Promise<void>((done) => {
		arrived = done;
	});
	let release: () => void = () => {};
	hold = {
		url: `/game-packs/${manifests[2].packId}/entry.js`,
		ready: arrived,
		release: new Promise<void>((done) => {
			release = done;
		})
	};
	await page.getByRole('button', { name: 'Baixar versão mais recente', exact: true }).click();
	await downloading;
	assert.equal(await page.locator('main[data-pack-id]').getAttribute('data-pack-id'), manifests[0].packId);
	release();
	hold = undefined;
	await page.locator('[data-game-root] canvas').waitFor();
	await page.waitForFunction(() => globalThis.__gameDebug?.().ready === true);
	if (await page.getByRole('button', { name: 'Jogar assim mesmo', exact: true }).isVisible())
		await page.getByRole('button', { name: 'Jogar assim mesmo', exact: true }).click();
	assert.equal(await page.locator('main[data-pack-id]').getAttribute('data-pack-id'), manifests[2].packId);
	await page.getByRole('button', { name: 'Voltar à jornada', exact: true }).click();
	await setOffline(true);
	await page.reload();
	await page.getByRole('button', { name: 'Entrar na trilha', exact: true }).click();
	await page.locator('[data-game-root] canvas').waitFor();
	await page.waitForFunction(() => globalThis.__gameDebug?.().ready === true);
	if (await page.getByRole('button', { name: 'Jogar assim mesmo', exact: true }).isVisible())
		await page.getByRole('button', { name: 'Jogar assim mesmo', exact: true }).click();
	assert.equal(await page.locator('main[data-pack-id]').getAttribute('data-pack-id'), manifests[2].packId);
	const audioC = await packAudio(manifests[2].packId);
	assert.deepEqual(audioC, {
		marker: 'webm',
		webm: manifests[2].files.filter((file) => file.codec === 'webm').length,
		m4a: 0
	});
	result.packCAudio = audioC;
	result.atomicReplacementAndOfflineC = true;
	// The fixture query must not mask missing map-only assets in the completed pack.
	const storyUrl = new URL(page.url());
	storyUrl.searchParams.delete('graybox');
	const beforeStory = requests.length;
	await page.goto(storyUrl.href);
	await page.getByRole('button', { name: 'Entrar na trilha', exact: true }).click();
	await page.waitForFunction(() => globalThis.__gameDebug?.().ready === true);
	if (await page.getByRole('button', { name: 'Jogar assim mesmo', exact: true }).isVisible())
		await page.getByRole('button', { name: 'Jogar assim mesmo', exact: true }).click();
	assert.equal(await page.evaluate(() => globalThis.__gameDebug?.().worldKind), 'map');
	// Chrome checks /service-worker.js for updates on its own timer; only page and pack requests count.
	assert.deepEqual(
		requests.slice(beforeStory).filter((path) => path !== '/service-worker.js'),
		[]
	);
	result.defaultStoryWorldOfflineAtC = true;
	// The map preloads its sounds behind the loading screen; nature (the forest bed) follows after the first frame.
	for (const deadline = Date.now() + 15000; !audioRequests.some((path) => path.includes('forest-day')); ) {
		assert.ok(Date.now() < deadline, 'the forest bed was never requested');
		await page.waitForTimeout(100);
	}
	assert.ok(audioRequests.some((path) => path.endsWith('.webm')));
	assert.deepEqual(
		audioRequests.filter((path) => path.endsWith('.m4a')),
		[]
	);
	result.audioRequests = { webm: audioRequests.length, m4a: 0 };
	await page.screenshot({ path: join(output, 'story-offline-at-C.png') });
	assert.deepEqual(errors, []);
	assert.deepEqual(workerErrors, []);
	result.pageErrors = errors;
	result.workerErrors = workerErrors;
	await context.close();
	wire.close();
} finally {
	await browser.close();
	await new Promise<void>((done) => server.close(() => done()));
	await writeFile(join(output, 'acceptance.json'), JSON.stringify(result, null, 2));
}
await build('default', false);
console.info(JSON.stringify(result, null, 2));
