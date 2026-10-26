/** Local map smoke/measurement harness; no cloud, device or deployment changes. */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { chromium } from '@playwright/test';

const output =
	process.env.GAME_MEASURE_DIR ?? join(homedir(), '.cache/agents/2026-10-25-trilha-secreta/map-runtime');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
	channel: 'chrome',
	headless: true,
	args: ['--use-angle=gl', '--no-sandbox']
});
const result: Record<string, unknown> = {
	environment: 'Local Chromium, RTX 4090; mobile viewport and low tier; not a phone benchmark'
};
try {
	const context = await browser.newContext({
		viewport: { width: 915, height: 412 },
		isMobile: true,
		hasTouch: true
	});
	await context.addInitScript(() => {
		Object.defineProperty(navigator, 'deviceMemory', { value: 4, configurable: true });
		Object.defineProperty(navigator, 'hardwareConcurrency', { value: 4, configurable: true });
	});
	const page = await context.newPage();
	const errors: string[] = [];
	page.on('pageerror', (error) => errors.push(error.message));
	page.on('console', (message) => {
		if (message.type() === 'error') errors.push(message.text());
	});
	const origin = process.env.GAME_MEASURE_URL ?? 'http://localhost:5196/';
	for (const pose of ['spawn', 'stones', 'mirante', 'bridge', 'edge']) {
		const url = new URL(origin);
		url.searchParams.set('debug', '');
		url.searchParams.set('pose', pose);
		await page.goto(url.href);
		await page.waitForFunction(() => globalThis.__gameDebug?.().ready === true, { timeout: 45000 });
		await page.waitForTimeout(2500);
		const samples = [];
		for (let i = 0; i < 16; i++) {
			samples.push(await page.evaluate(() => globalThis.__gameDebug?.()));
			await page.waitForTimeout(250);
		}
		const states = samples.filter((s) => s !== undefined);
		assert.equal(states.length, 16);
		const snapshot = states[states.length - 1];
		const maxDraws = Math.max(...states.map((s) => s.drawCalls)),
			maxTriangles = Math.max(...states.map((s) => s.triangles)),
			maxP95 = Math.max(...states.map((s) => s.frameP95Ms));
		result[pose] = { ...snapshot, maxDraws, maxTriangles, maxP95 };
		assert.equal(snapshot.quality, 'low');
		assert.ok(maxDraws <= 150);
		assert.ok(maxTriangles <= 200000);
		assert.ok(states.every((s) => (s.textureBytes ?? 0) <= 4 * 1024 * 1024));
		assert.ok(states.every((s) => (s.geometryLods?.overlap ?? 0) === 0));
		assert.ok(maxP95 <= 33.3);
		await page.screenshot({ path: join(output, `${pose}.png`) });
		console.info(pose, JSON.stringify(result[pose]));
	}
	// The default world must still accept real keyboard input, rather than only displaying data.
	const spawnUrl = new URL(origin);
	spawnUrl.searchParams.set('debug', '');
	spawnUrl.searchParams.set('pose', 'spawn');
	await page.goto(spawnUrl.href);
	await page.waitForFunction(() => globalThis.__gameDebug?.().ready === true);
	const before = await page.evaluate(() => globalThis.__gameDebug?.());
	await page.keyboard.down('KeyW');
	await page.keyboard.down('Space');
	await page.waitForTimeout(700);
	await page.keyboard.up('Space');
	await page.keyboard.up('KeyW');
	await page.waitForTimeout(300);
	const after = await page.evaluate(() => globalThis.__gameDebug?.());
	assert.ok(before && after && Math.hypot(after.x - before.x, after.z - before.z) > 0.5);
	result.movement = { before, after };
	const cycles = [];
	for (let i = 0; i < 20; i++) {
		await page.getByRole('button', { name: 'Voltar à jornada', exact: true }).click();
		await page.waitForFunction(() => globalThis.__gameDebug === undefined);
		await page.getByRole('button', { name: 'Entrar na trilha', exact: true }).click();
		await page.waitForFunction(() => globalThis.__gameDebug?.().ready === true);
		await page.waitForTimeout(100);
		cycles.push(await page.evaluate(() => globalThis.__gameDebug?.()));
	}
	result.cycles = cycles;
	assert.equal(cycles.length, 20);
	const last = cycles.at(-1),
		first = cycles[0];
	assert.ok(last && first && last.geometries === first.geometries && last.textures === first.textures);

	await page.getByRole('button', { name: 'Personalizar personagem', exact: true }).click();
	const textureVersion = await page.evaluate(() => globalThis.__gameDebug?.().avatarTextureVersion);
	await page.getByRole('tab', { name: 'Cabelo', exact: true }).click();
	await page.getByRole('radio', { name: 'Cabelo longo', exact: true }).click();
	await page.getByRole('button', { name: 'Usar este personagem', exact: true }).click();
	await page.waitForFunction(() => globalThis.__gameDebug?.().avatarHair === 'longo');
	assert.equal(await page.evaluate(() => globalThis.__gameDebug?.().avatarTextureVersion), textureVersion);
	await page.screenshot({ path: join(output, 'hair-long.png') });
	await page.reload();
	await page.waitForFunction(() => globalThis.__gameDebug?.().ready === true);
	assert.equal(await page.evaluate(() => globalThis.__gameDebug?.().avatarHair), 'longo');
	result.hairOnlyChangeWithoutTextureUpload = true;
	result.hairPersists = true;
	result.errors = errors;
	assert.deepEqual(errors, []);
	await writeFile(join(output, 'measurements.json'), JSON.stringify(result, null, 2));
} finally {
	await browser.close();
}
