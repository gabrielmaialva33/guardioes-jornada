import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { chromium } from '@playwright/test';

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=gl'] });
try {
	const page = await browser.newPage(),
		errors: string[] = [];
	page.on('pageerror', (e) => errors.push(e.message));
	page.on('console', (m) => {
		if (m.type() === 'error') errors.push(m.text());
	});
	await page.goto(
		new URL('golden/look-fixture.html', process.env.GAME_MEASURE_URL ?? 'http://127.0.0.1:5198/').href
	);
	await page.waitForFunction(() => !!document.body.dataset.result);
	const result = JSON.parse((await page.locator('body').getAttribute('data-result')) ?? '{}');
	assert.deepEqual(errors, []);
	assert.equal(result.samples.length, 12);
	assert.ok(result.maxError <= 2, JSON.stringify(result));
	await writeFile(
		join(homedir(), '.cache/agents/2026-10-25-trilha-secreta/p32-grade-gpu.json'),
		JSON.stringify(result, null, 2)
	);
	console.info('ACES + grade: CPU/GPU max byte error', result.maxError);
} finally {
	await browser.close();
}
