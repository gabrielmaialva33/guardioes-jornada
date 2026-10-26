/**
 * Screenshots of the loading screen (P11): phone portrait, phone landscape and
 * desktop at 0/40/90 %, the error states and reduced motion, with the app fonts,
 * in the system Chrome. No dev server: Vite bundles loading-sheet.page.ts into one
 * script and the page is served from Playwright routes. Also checks layout (no
 * horizontal scroll, nothing under the trail) and that reduced motion is still.
 *
 * Usage (from the repo root):
 *   node game/golden/loading-sheet.ts
 *
 * Writes `<root>/sheets/loading/*.png` and `checks.json` (GUARDIOES_GOLDEN_DIR overrides the root).
 */
import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Page } from '@playwright/test';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { build } from 'vite';
import { ensureRoot, GOLDEN_ROOT } from './lib.ts';

const here = dirname(fileURLToPath(import.meta.url));
const fonts = join(here, '../../node_modules/@fontsource-variable');
const out = join(GOLDEN_ROOT, 'sheets', 'loading');

const result = await build({
	configFile: false,
	logLevel: 'warn',
	plugins: [svelte({ configFile: false, emitCss: false })],
	build: {
		write: false,
		minify: false,
		lib: { entry: join(here, 'loading-sheet.page.ts'), formats: ['iife'], name: 'loadingSheet' }
	}
});
const outputs = Array.isArray(result) ? result : [result];
let script = '';
for (const output of outputs)
	if ('output' in output) for (const chunk of output.output) if (chunk.type === 'chunk') script += chunk.code;
if (!script) throw new Error('the page bundle is empty');

const page = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<style>
@font-face { font-family: 'Alegreya Variable'; font-weight: 400 900; src: url(/fonts/alegreya.woff2) format('woff2'); }
@font-face { font-family: 'Atkinson Hyperlegible Next Variable'; font-weight: 200 800; src: url(/fonts/atkinson.woff2) format('woff2'); }
:root { --font-story: 'Alegreya Variable', Georgia, serif; --font-ui: 'Atkinson Hyperlegible Next Variable', system-ui, sans-serif; --tap: 48px; }
html, body { margin: 0; }
</style><body></body>`;

const STATES = {
	'0': { fraction: 0, percent: 0, label: 'Abrindo a trilha' },
	'40': { fraction: 0.4, percent: 40, label: 'Acordando os bichos', elapsed: 6000 },
	'90': { fraction: 0.9, percent: 90, label: 'Preparando as cores', elapsed: 12000 }
};
const VIEWPORTS = {
	portrait: { width: 360, height: 800, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
	landscape: { width: 800, height: 360, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
	desktop: { width: 1440, height: 900, deviceScaleFactor: 1, isMobile: false, hasTouch: false }
};

async function layout(page: Page) {
	return page.evaluate(() => {
		const box = (selector: string) => document.querySelector(selector)?.getBoundingClientRect();
		const trail = box('.trail');
		const card = box('.card');
		const title = box('h1');
		const mico = box('.mico');
		return {
			horizontalScroll: document.documentElement.scrollWidth > innerWidth,
			cardAboveTrail: !!card && !!trail && card.bottom <= trail.top,
			titleInside: !!title && title.top >= 16 && title.left >= 16 && title.right <= innerWidth - 16,
			cardInside: !!card && card.left >= 16 && card.right <= innerWidth - 16,
			micoInside: !!mico && mico.left >= 16 && mico.right <= innerWidth - 16,
			fonts: [...document.fonts].filter((font) => font.status === 'loaded').map((font) => font.family)
		};
	});
}

await ensureRoot();
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const checks: Record<string, unknown> = {};
try {
	const open = async (
		viewport: (typeof VIEWPORTS)[keyof typeof VIEWPORTS],
		reducedMotion: 'reduce' | 'no-preference'
	) => {
		const context = await browser.newContext({ viewport, reducedMotion });
		await context.route('http://loading-sheet.local/**', async (route) => {
			const path = new URL(route.request().url()).pathname;
			if (path === '/') return route.fulfill({ contentType: 'text/html', body: page });
			if (path === '/sheet.js')
				return route.fulfill({ contentType: 'text/javascript; charset=utf-8', body: script });
			if (path === '/fonts/alegreya.woff2')
				return route.fulfill({
					body: readFileSync(join(fonts, 'alegreya/files/alegreya-latin-wght-normal.woff2'))
				});
			if (path === '/fonts/atkinson.woff2')
				return route.fulfill({
					body: readFileSync(
						join(fonts, 'atkinson-hyperlegible-next/files/atkinson-hyperlegible-next-latin-wght-normal.woff2')
					)
				});
			return route.fulfill({ status: 404, body: '' });
		});
		const tab = await context.newPage();
		tab.on('pageerror', (error) => console.error('page error:', error.message));
		await tab.goto('http://loading-sheet.local/');
		await tab.addScriptTag({ url: '/sheet.js' });
		return { tab, context };
	};
	const shoot = async (tab: Page, name: string, snapshot: object | 'live', fact = 0) => {
		await tab.evaluate(
			([value, first]) => window.showLoading(value as never, first as number),
			[snapshot, fact]
		);
		await tab.evaluate(() => document.fonts.ready.then(() => undefined));
		await tab.waitForTimeout(120);
		await tab.screenshot({ path: join(out, `${name}.png`), animations: 'disabled' });
		checks[name] = await layout(tab);
	};

	for (const [view, viewport] of Object.entries(VIEWPORTS)) {
		const { tab, context } = await open(viewport, 'no-preference');
		let fact = 0;
		for (const [percent, state] of Object.entries(STATES))
			await shoot(tab, `${view}-${percent}`, state, fact++ * 3);
		await shoot(tab, `${view}-error`, { phase: 'error', error: 'failed', fraction: 0.62, percent: 62 });
		if (view === 'portrait')
			await shoot(tab, `${view}-unsupported`, {
				phase: 'error',
				error: 'unsupported',
				fraction: 0.1,
				percent: 10
			});
		await context.close();
	}

	// Reduced motion: two frames 600 ms apart are identical; with motion they differ.
	for (const motion of ['reduce', 'no-preference'] as const) {
		const { tab, context } = await open(VIEWPORTS.portrait, motion);
		await tab.evaluate(() =>
			window.showLoading({ fraction: 0.4, percent: 40, label: 'Acordando os bichos' }, 1)
		);
		await tab.evaluate(() => document.fonts.ready.then(() => undefined));
		await tab.waitForTimeout(200);
		const a = await tab.screenshot();
		await tab.waitForTimeout(600);
		const b = await tab.screenshot();
		checks[`motion-${motion}`] = { framesIdentical: a.equals(b) };
		if (motion === 'reduce') await writeFile(join(out, 'portrait-reduced-motion.png'), b);
		await context.close();
	}

	// Live model: the shown fraction over time must never go backwards, then the screen fades out.
	{
		const { tab, context } = await open(VIEWPORTS.portrait, 'no-preference');
		await tab.evaluate(() => window.showLoading('live', 0));
		const samples = await tab.evaluate(
			() =>
				new Promise<{ t: number; now: number; phase: string; opacity: string }[]>((done) => {
					const list: { t: number; now: number; phase: string; opacity: string }[] = [];
					const start = performance.now();
					const sample = () => {
						const bar = document.querySelector('[role="progressbar"]');
						const root = document.querySelector<HTMLElement>('.loading');
						list.push({
							t: Math.round(performance.now() - start),
							now: Number(bar?.getAttribute('aria-valuenow') ?? -1),
							phase: root?.dataset.phase ?? 'gone',
							opacity: root ? getComputedStyle(root).opacity : '0'
						});
						if (performance.now() - start < 3500) requestAnimationFrame(sample);
						else done(list);
					};
					sample();
				})
		);
		let monotone = true;
		for (let i = 1; i < samples.length; i++) if (samples[i].now < samples[i - 1].now) monotone = false;
		const firstFull = samples.find((sample) => sample.now === 100);
		const leaving = samples.find((sample) => sample.phase === 'leaving');
		const done = samples.find((sample) => sample.phase === 'done');
		checks.live = {
			monotone,
			samples: samples.length,
			at100ms: firstFull?.t,
			leavingAt: leaving?.t,
			doneAt: done?.t,
			maxBeforeReady: Math.max(...samples.filter((sample) => sample.t < 2000).map((sample) => sample.now)),
			pointerEventsAfter: await tab.evaluate(() => {
				const root = document.querySelector('.loading');
				return root ? getComputedStyle(root).pointerEvents : 'removed';
			})
		};
		await context.close();
	}
	await writeFile(join(out, 'checks.json'), JSON.stringify(checks, null, 2));
	console.log(`${Object.keys(checks).length} checks -> ${out}`);
} finally {
	await browser.close();
}
