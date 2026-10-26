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
	await page.goto('http://localhost:5196/golden/dither-fixture.html');
	await page.waitForFunction(() => !!document.body.dataset.result);
	const result = JSON.parse((await page.locator('body').getAttribute('data-result')) ?? '{}');
	assert.deepEqual(errors, []);
	assert.equal(result.holes, 0);
	assert.equal(result.overlap, 0);
	assert.equal(result.red, 8);
	assert.equal(result.green, 8);
	assert.equal(result.canopyHidden, 16);
	assert.equal(result.canopyRestored, 16);
	await page.goto('http://localhost:5196/golden/dither-fixture.html?negative=1');
	await page.waitForFunction(() => !!document.body.dataset.result);
	const negative = JSON.parse((await page.locator('body').getAttribute('data-result')) ?? '{}');
	assert.equal(negative.holes, 8);
	assert.equal(negative.overlap, 8);
	await writeFile(
		join(homedir(), '.cache/agents/2026-10-25-trilha-secreta/assets-dither.json'),
		JSON.stringify({ result, negative }, null, 2)
	);
	console.info('Real GPU midpoint: 8 detail + 8 impostor pixels, zero holes or overlap.');
} finally {
	await browser.close();
}
