/** Local touch-control acceptance; no cloud or device state. */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { chromium } from '@playwright/test';

const output = join(homedir(), '.cache/agents/2026-10-25-trilha-secreta/controls-v2');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
	channel: 'chrome',
	headless: true,
	args: ['--use-angle=gl', '--no-sandbox']
});
const results: unknown[] = [];
try {
	for (const viewport of [
		{ width: 915, height: 412 },
		{ width: 412, height: 915 }
	]) {
		const context = await browser.newContext({ viewport, isMobile: true, hasTouch: true });
		await context.routeWebSocket('**', (socket) => socket.onMessage(() => {}));
		const page = await context.newPage(),
			errors: string[] = [];
		page.on('pageerror', (e) => errors.push(e.message));
		page.on('console', (m) => {
			if (m.type() === 'error') errors.push(m.text());
		});
		await page.goto('http://localhost:5196/?debug');
		if (viewport.height > viewport.width)
			await page.getByRole('button', { name: 'Jogar assim mesmo' }).click();
		await page.waitForFunction(() => globalThis.__gameDebug?.().ready === true);
		await page.waitForTimeout(600);
		assert.equal(await page.evaluate(() => globalThis.__gameDebug?.().cameraMode), 'follow');
		const jump = page.getByRole('button', { name: 'Pular', exact: true });
		const rect = await jump.boundingBox();
		assert.ok(rect && rect.width === 70 && rect.x === viewport.width - 95 && rect.y === viewport.height - 90);
		const ghost = page.locator('.ghost');
		assert.equal(await ghost.evaluate((e) => getComputedStyle(e).opacity), '1');
		await page.screenshot({ path: join(output, `${viewport.width}-ghost.png`) });
		const cdp = await context.newCDPSession(page);
		const touch = (
			type: 'touchStart' | 'touchMove' | 'touchEnd',
			points: { x: number; y: number; id: number }[]
		) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points });
		const y = viewport.height - 100;
		await touch('touchStart', [{ x: 80, y, id: 1 }]);
		await touch('touchMove', [{ x: 80, y: y - 35, id: 1 }]);
		await page.waitForTimeout(250);
		assert.equal(await page.locator('.stick-knob').evaluate((e) => getComputedStyle(e).opacity), '1');
		await page.screenshot({ path: join(output, `${viewport.width}-stick.png`) });
		await touch('touchEnd', []);
		await page.waitForTimeout(500);
		assert.equal(await ghost.evaluate((e) => getComputedStyle(e).opacity), '0');
		await touch('touchStart', [{ x: rect.x + 35, y: rect.y + 35, id: 2 }]);
		await page.waitForTimeout(80);
		assert.equal(await jump.evaluate((e) => e.classList.contains('pressed')), true);
		const background = await jump.evaluate((e) => getComputedStyle(e).backgroundColor);
		assert.ok(!background.includes('241, 211, 100'));
		await touch('touchEnd', []);
		const top = await page.locator('.top-bar button').evaluateAll((nodes) =>
			nodes.map((n) => {
				const r = n.getBoundingClientRect();
				return { w: r.width, h: r.height, y: r.y };
			})
		);
		assert.equal(top.length, 7);
		assert.ok(top.every((r) => r.w >= 44 && r.h >= 44 && r.y < 60));
		await page.getByRole('button', { name: 'Personalizar personagem', exact: true }).click();
		await page.getByRole('checkbox', { name: 'Modo canhoto' }).check();
		await page.getByRole('checkbox', { name: 'Botões maiores' }).check();
		await page.getByRole('button', { name: 'Fechar personalização' }).click();
		await page.reload();
		if (viewport.height > viewport.width)
			await page.getByRole('button', { name: 'Jogar assim mesmo' }).click();
		await page.waitForFunction(() => globalThis.__gameDebug?.().ready === true);
		await page.waitForTimeout(400);
		const larger = await jump.boundingBox();
		assert.ok(larger && larger.x === 50 && larger.width === 120);
		await page.screenshot({ path: join(output, `${viewport.width}-left-large.png`) });
		results.push({
			viewport,
			top,
			jump: rect,
			larger,
			debug: await page.evaluate(() => globalThis.__gameDebug?.()),
			errors
		});
		assert.deepEqual(errors, []);
		await context.close();
	}
	const context = await browser.newContext({
		viewport: { width: 915, height: 412 },
		isMobile: true,
		hasTouch: true
	});
	await context.routeWebSocket('**', (s) => s.onMessage(() => {}));
	const page = await context.newPage();
	await page.goto('http://localhost:5196/?debug&pose=mirante');
	await page.waitForFunction(() => globalThis.__gameDebug?.().ready === true);
	await page.waitForTimeout(400);
	const canopy = await page.evaluate(() => globalThis.__gameDebug?.());
	assert.ok(canopy && (canopy.canopiesFading ?? 0) > 0);
	await page.screenshot({ path: join(output, '915-mirante-canopy.png') });
	results.push({ canopy });
	await context.close();
	await writeFile(join(output, 'results.json'), JSON.stringify(results, null, 2));
	console.info(
		'Portrait/landscape touch controls, pressed feedback, Follow mode and persisted settings passed'
	);
} finally {
	await browser.close();
}
