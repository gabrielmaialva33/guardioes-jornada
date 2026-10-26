/**
 * Captures the golden frames of every pose the runtime can show
 * (poses.json status 'exists' or 'approx'), per tier, into
 * `~/.cache/guardioes-golden/<set>/<tier>-<mode>/`: `<pose>.png`, the
 * `<pose>.mask.png` used for the sky and void metrics, and `<pose>.json`
 * (the __gameDebug counters, the metrics and how the frame was taken).
 *
 * Until the runtime has its ?golden=1 hook (README), determinism comes from
 * outside the game:
 * - the clock: Playwright's fake clock drives Date, performance.now, timers
 *   and requestAnimationFrame; once the game is ready it advances exactly
 *   `settleMs` in 16 ms frames, then stops while the frame is taken;
 * - the seed: Math.random is replaced by a seeded generator before any script;
 * - the tier: the existing capability pick, steered by emulating the device
 *   (low: mobile, 4 GB, 4 cores; medium: desktop, 4 GB, 8 cores; high: desktop,
 *   8 GB, 16 cores, on a desktop-class GPU);
 * - the HUD: hidden with an injected style (every child of the game root but
 *   the canvas), so the CSS sky stays.
 *
 * Usage (from the repo root, with `pnpm game:dev` on 5196):
 *   node game/golden/capture.ts --set before [--tiers low,high] [--poses P1,P4]
 *        [--mode gpu|swiftshader] [--clock fake|real] [--url http://localhost:5196/]
 *        [--serve 5197]   (starts its own dev server; required for swiftshader)
 *        [--angle gl]     (ANGLE backend in gpu mode)
 */

import { type ChildProcess, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { type Browser, type BrowserContext, chromium, type Page } from '@playwright/test';
import {
	ensureRoot,
	frameMetrics,
	list,
	loadPoses,
	type Mode,
	type Pose,
	parseArgs,
	readRgba,
	runDir,
	type Tier
} from './lib.ts';

const args = parseArgs(process.argv.slice(2));
const config = loadPoses();
const set = args.get('set') ?? 'before';
const mode = (args.get('mode') ?? 'gpu') as Mode;
const clockMode = args.get('clock') ?? 'runtime';
const hooked = clockMode === 'runtime';
const tiers = list(args.get('tiers'), config.tiers) as Tier[];
const assetRoot = resolve(args.get('assets') ?? 'game/src/assets');
const frozenAssets = new Map<string, Buffer>();
function snapshotAssets(dir: string, prefix = '') {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const key = prefix + entry.name;
		if (entry.isDirectory()) snapshotAssets(join(dir, entry.name), `${key}/`);
		else if (/\.(glb|png|webp|webm|m4a|ogg)$/.test(key))
			frozenAssets.set(key, readFileSync(join(dir, entry.name)));
	}
}
snapshotAssets(assetRoot);
const hash = createHash('sha256');
for (const [key, bytes] of [...frozenAssets].sort(([a], [b]) => a.localeCompare(b))) {
	hash.update(key);
	hash.update(bytes);
}
const assetHash = hash.digest('hex');
const wanted = list(args.get('poses'), []);
const serve = args.get('serve');
let origin = args.get('url') ?? 'http://localhost:5196/';
if (mode !== 'gpu' && mode !== 'swiftshader')
	throw new Error(`--mode must be gpu or swiftshader, not ${mode}`);
if (clockMode !== 'fake' && clockMode !== 'real' && clockMode !== 'runtime')
	throw new Error(`--clock must be runtime, fake or real`);
if (mode === 'swiftshader' && !serve)
	console.warn(
		'swiftshader: the game refuses software GPUs unless its server runs with GAME_ALLOW_SOFTWARE_TEST=1; use --serve <port>'
	);

const legacyIds = new Set(['P1', 'P3', 'P4', 'P7', 'X1']);
const poses = config.poses.filter(
	(p) => (hooked || legacyIds.has(p.id)) && (wanted.length === 0 || wanted.includes(p.id))
);
const skipped = config.poses.filter(
	(p) => !hooked && !legacyIds.has(p.id) && (wanted.length === 0 || wanted.includes(p.id))
);

/** Everything but the canvas's own subtree is hidden; the root keeps its CSS sky gradient. */
const HIDE_HUD = '[data-game-root] > :not(.world) { visibility: hidden !important; }';
/** The same frame over magenta: what stays magenta is where the canvas drew nothing. */
const MAGENTA_SKY = '[data-game-root] { background: #ff00ff !important; }';
const FRAME_MS = 16;
const CLOCK_START = Date.parse('2026-10-25T10:00:00-03:00');

const DEVICES: Record<Tier, { mobile: boolean; memory: number; cores: number }> = {
	low: { mobile: true, memory: 4, cores: 4 },
	medium: { mobile: false, memory: 4, cores: 8 },
	high: { mobile: false, memory: 8, cores: 16 }
};

function launchArgs(): string[] {
	if (mode === 'swiftshader')
		return ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'];
	return [`--use-angle=${args.get('angle') ?? 'gl'}`, '--no-sandbox'];
}

async function startServer(port: string): Promise<ChildProcess> {
	const env = { ...process.env, GAME_ALLOW_SOFTWARE_TEST: mode === 'swiftshader' ? '1' : '0' };
	const child = spawn(
		'./node_modules/.bin/vite',
		['--config', 'game/vite.config.ts', '--port', port, '--strictPort', '--host', '127.0.0.1'],
		{ env, stdio: ['ignore', 'pipe', 'pipe'] }
	);
	origin = `http://127.0.0.1:${port}/`;
	const deadline = Date.now() + 60000;
	while (Date.now() < deadline) {
		if (child.exitCode !== null) throw new Error(`dev server exited with ${child.exitCode}`);
		try {
			if ((await fetch(origin)).ok) return child;
		} catch {
			// Not listening yet.
		}
		await new Promise((resolve) => setTimeout(resolve, 300));
	}
	child.kill();
	throw new Error(`dev server on ${port} did not answer`);
}

async function newContext(browser: Browser, tier: Tier): Promise<BrowserContext> {
	const device = DEVICES[tier];
	const context = await browser.newContext({
		viewport: { width: config.canvas.width, height: config.canvas.height },
		deviceScaleFactor: 1,
		isMobile: device.mobile,
		hasTouch: device.mobile,
		reducedMotion: 'no-preference'
	});
	// A capture is isolated from other agents' asset exports and Vite HMR.
	await context.routeWebSocket('**', (socket) => {
		socket.onMessage(() => {});
	});
	await context.route('**/src/assets/**', async (route) => {
		const request = route.request(),
			url = new URL(request.url());
		const key = decodeURIComponent(url.pathname.split('/src/assets/')[1] ?? '');
		const body = frozenAssets.get(key);
		if (!body || request.resourceType() === 'script') return route.continue();
		const types: Record<string, string> = {
			'.glb': 'model/gltf-binary',
			'.png': 'image/png',
			'.webp': 'image/webp',
			'.webm': 'audio/webm',
			'.m4a': 'audio/mp4',
			'.ogg': 'audio/ogg'
		};
		await route.fulfill({ body, contentType: types[extname(key)] ?? 'application/octet-stream' });
	});
	await context.addInitScript(
		({ memory, cores, seed }) => {
			Object.defineProperty(navigator, 'deviceMemory', { value: memory, configurable: true });
			Object.defineProperty(navigator, 'hardwareConcurrency', { value: cores, configurable: true });
			// mulberry32: every Math.random call in the page is reproducible.
			let state = seed >>> 0;
			Math.random = () => {
				state = (state + 0x6d2b79f5) >>> 0;
				let t = state;
				t = Math.imul(t ^ (t >>> 15), t | 1);
				t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
				return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
			};
		},
		{ memory: device.memory, cores: device.cores, seed: config.seed }
	);
	return context;
}

const readDebug = (page: Page) => page.evaluate(() => globalThis.__gameDebug?.());

/** Loads a pose and brings it to the settled frame. Returns the counters at that frame. */
async function settle(page: Page, pose: Pose, tier: Tier) {
	const url = new URL(origin);
	url.searchParams.set('debug', '');
	url.searchParams.set('pose', pose.runtimePose ?? '');
	if (hooked) {
		url.searchParams.set('golden', '1');
		url.searchParams.set('t', String(config.clockSeconds));
		url.searchParams.set('seed', String(config.seed));
		url.searchParams.set('tier', tier);
		url.searchParams.set('time', pose.timeOfDay);
		if (pose.camera)
			url.searchParams.set(
				'cam',
				[...pose.camera.position, ...pose.camera.target, pose.camera.fov].join(',')
			);
		if (pose.avatar)
			url.searchParams.set('avatar', [pose.avatar.x, pose.avatar.z, pose.avatar.yaw].join(','));
		if (pose.id === 'P10') url.searchParams.set('scene', 'lineup');
		if (pose.id === 'P12') url.searchParams.set('life', 'companion');
		if (pose.id === 'P13') url.searchParams.set('life', 'butterflies');
	}
	if (clockMode === 'fake') {
		// A fixed start time, paused: the game only sees time move when runFor moves it.
		await page.clock.install({ time: CLOCK_START });
		await page.clock.pauseAt(CLOCK_START + 1000);
	}
	await page.goto(url.href, { waitUntil: 'domcontentloaded' });
	await page.addStyleTag({ content: HIDE_HUD });
	const deadline = Date.now() + 60000;
	while (
		!(await page.evaluate(
			() =>
				globalThis.__gameDebug?.().ready === true &&
				(!globalThis.__gameDebug?.().goldenReady ? !location.search.includes('golden=1') : true)
		))
	) {
		if (Date.now() > deadline) throw new Error(`pose ${pose.id} (${pose.runtimePose}) never became ready`);
		// Loading is network and decoding, in real time; frames only run when the fake clock moves.
		if (clockMode === 'fake') await page.clock.runFor(FRAME_MS);
		await page.waitForTimeout(50);
	}
	const samples = [];
	if (clockMode === 'fake') {
		for (let elapsed = 0; elapsed < config.settleMs; elapsed += FRAME_MS * 10) {
			await page.clock.runFor(FRAME_MS * 10);
			// Let real-time work started by those frames (shader compiles, uploads) land between steps.
			await page.waitForTimeout(20);
		}
		samples.push(await readDebug(page));
	} else {
		await page.waitForTimeout(config.settleMs);
		for (let i = 0; i < 8; i++) {
			samples.push(await readDebug(page));
			await page.waitForTimeout(125);
		}
	}
	const states = samples.filter((s) => s !== undefined);
	const last = states.at(-1);
	if (!last) throw new Error(`pose ${pose.id}: __gameDebug disappeared`);
	return {
		last,
		maxDraws: Math.max(...states.map((s) => s.drawCalls)),
		maxTriangles: Math.max(...states.map((s) => s.triangles))
	};
}

async function capture(page: Page, pose: Pose, tier: Tier, dir: string, errors: string[]) {
	const counters = await settle(page, pose, tier);
	if (errors.length) throw new Error(`pose ${pose.id}: browser errors: ${errors.join(' | ')}`);
	if (hooked && counters.last.goldenReady !== true)
		throw new Error(`pose ${pose.id}: runtime reset during capture`);
	const png = join(dir, `${pose.id}.png`);
	const maskPng = join(dir, `${pose.id}.mask.png`);
	await page.screenshot({ path: png, animations: 'disabled', caret: 'hide' });
	const style = await page.addStyleTag({ content: MAGENTA_SKY });
	if (hooked) {
		await page.evaluate(() => globalThis.__gameGoldenMask?.(true));
		await page.waitForTimeout(60);
	}
	await page.screenshot({ path: maskPng, animations: 'disabled', caret: 'hide' });
	await style.evaluate((node) => (node as Element).remove());
	if (hooked) await page.evaluate(() => globalThis.__gameGoldenMask?.(false));
	const metrics = frameMetrics(await readRgba(png), await readRgba(maskPng));
	const record = {
		pose: pose.id,
		assetHash,
		name: pose.name,
		status: pose.status,
		runtimePose: pose.runtimePose,
		tier,
		tierPicked: counters.last.quality,
		tierReason: counters.last.qualityReason,
		mode,
		clock: clockMode,
		url: page.url(),
		capturedAt: new Date().toISOString(),
		canvas: config.canvas,
		counters: {
			drawCalls: counters.last.drawCalls,
			triangles: counters.last.triangles,
			programs: counters.last.programs,
			geometries: counters.last.geometries,
			textures: counters.last.textures,
			dpr: counters.last.dpr,
			maxDraws: counters.maxDraws,
			maxTriangles: counters.maxTriangles,
			// Under the fake clock these two measure the fake 16 ms frames, not the GPU.
			fps: counters.last.fps,
			frameP95Ms: counters.last.frameP95Ms
		},
		debug: counters.last,
		metrics,
		errors: [...errors]
	};
	await writeFile(join(dir, `${pose.id}.json`), `${JSON.stringify(record, null, '\t')}\n`);
	const tierNote = counters.last.quality === tier ? '' : ` (asked ${tier}, got ${counters.last.quality})`;
	console.info(
		`${tier} ${pose.id} ${pose.runtimePose}: ${counters.last.drawCalls} draws, ${counters.last.triangles} tri, dark ${metrics.darkPct}%, sat ${metrics.meanSaturation}, sky ${metrics.skyPct}% σ ${metrics.skyStd}, void↓ ${metrics.voidLowerPct}%${tierNote}`
	);
	errors.length = 0;
	return record;
}

await ensureRoot();
let server: ChildProcess | null = null;
let browser: Browser | null = null;
const summary: Record<string, unknown>[] = [];
try {
	if (serve) server = await startServer(serve);
	browser = await chromium.launch({ channel: 'chrome', headless: true, args: launchArgs() });
	for (const tier of tiers) {
		const dir = runDir(set, tier, mode);
		if (!args.has('append')) await rm(dir, { recursive: true, force: true });
		await mkdir(dir, { recursive: true });
		for (const pose of poses) {
			// A fresh context per pose: the fake clock belongs to the context and is installed before any script.
			const context = await newContext(browser, tier);
			try {
				const page = await context.newPage();
				const errors: string[] = [];
				page.on('pageerror', (error) => errors.push(error.message));
				page.on('console', (message) => {
					if (message.type() === 'error') errors.push(message.text());
				});
				try {
					const record = await capture(page, pose, tier, dir, errors);
					summary.push({
						tier,
						pose: pose.id,
						tierPicked: record.tierPicked,
						drawCalls: record.counters.drawCalls,
						triangles: record.counters.triangles,
						...record.metrics,
						errors: record.errors.length
					});
				} catch (error) {
					console.error(`${tier} ${pose.id}: ${(error as Error).message}`);
					summary.push({ tier, pose: pose.id, failed: (error as Error).message });
				}
			} finally {
				await context.close();
			}
		}
		await writeFile(
			join(dir, 'run.json'),
			`${JSON.stringify(
				{
					set,
					tier,
					mode,
					clock: clockMode,
					origin,
					capturedAt: new Date().toISOString(),
					browser: browser.version(),
					captured: config.poses.filter((p) => existsSync(join(dir, `${p.id}.png`))).map((p) => p.id),
					assetHash,
					needsRuntime: skipped.map((p) => p.id)
				},
				null,
				'\t'
			)}\n`
		);
	}
} finally {
	await browser?.close();
	server?.kill();
}
if (skipped.length > 0)
	console.info(
		`not captured (needs the ?golden=1 hook): ${skipped.map((p) => `${p.id} ${p.name}`).join('; ')}`
	);
const failed = summary.filter((s) => 'failed' in s);
console.info(`${summary.length - failed.length} frames in ${join(runDir(set, tiers[0], mode), '..')}`);
if (failed.length > 0) process.exitCode = 1;
