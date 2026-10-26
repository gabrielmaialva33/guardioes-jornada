/**
 * Contact sheet of the avatar's contextual locomotion and gestures (P10): one
 * row per state or gesture, 4 phases each, rendered with the real avatar.glb
 * in the system Chrome. No dev server: Vite bundles avatar-sheet.page.ts into
 * one script and the page is served from Playwright routes.
 *
 * Usage (from the repo root):
 *   node game/golden/avatar-sheet.ts [--out avatar-p10.png]
 *
 * Writes `<root>/sheets/avatar/<out>` (GUARDIOES_GOLDEN_DIR overrides the root).
 */
import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { build } from 'vite';
import { ensureRoot, GOLDEN_ROOT, parseArgs } from './lib.ts';

const here = dirname(fileURLToPath(import.meta.url));
const models = join(here, '../src/assets/models');
const args = parseArgs(process.argv.slice(2));
const out = join(GOLDEN_ROOT, 'sheets', 'avatar', args.get('out') ?? 'avatar-p10.png');

const result = await build({
	configFile: false,
	logLevel: 'warn',
	build: {
		write: false,
		minify: false,
		lib: { entry: join(here, 'avatar-sheet.page.ts'), formats: ['iife'], name: 'avatarSheet' }
	}
});
const outputs = Array.isArray(result) ? result : [result];
let script = '';
for (const output of outputs)
	if ('output' in output) for (const chunk of output.output) if (chunk.type === 'chunk') script += chunk.code;
if (!script) throw new Error('the page bundle is empty');

const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
	const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
	page.on('pageerror', (error) => console.error('page error:', error.message));
	await page.route('http://avatar-sheet.local/**', async (route) => {
		const path = new URL(route.request().url()).pathname;
		if (path === '/')
			return route.fulfill({
				contentType: 'text/html',
				body: '<!doctype html><meta charset="utf-8"><body></body>'
			});
		if (path === '/sheet.js')
			return route.fulfill({ contentType: 'text/javascript; charset=utf-8', body: script });
		if (path === '/avatar.glb' || path === '/avatar-hair.glb')
			return route.fulfill({
				contentType: 'model/gltf-binary',
				body: readFileSync(join(models, path.slice(1)))
			});
		return route.fulfill({ status: 404, body: '' });
	});
	await page.goto('http://avatar-sheet.local/');
	await page.addScriptTag({ url: '/sheet.js' });
	await page.waitForFunction(() => window.sheet !== undefined, null, { timeout: 120_000 });
	const sheet = await page.evaluate(() => window.sheet);
	if (!sheet || 'error' in sheet) throw new Error(sheet ? sheet.error : 'no sheet');
	await ensureRoot();
	await mkdir(dirname(out), { recursive: true });
	await writeFile(out, Buffer.from(sheet.png.slice(sheet.png.indexOf(',') + 1), 'base64'));
	console.log(`${sheet.rows} rows x 4 phases -> ${out}`);
} finally {
	await browser.close();
}
