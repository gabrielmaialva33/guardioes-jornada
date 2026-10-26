import { expect, test } from '@playwright/test';
import { climbTreehouse, storyBuild, walk } from '../game/story-driver.ts';

test.use({ viewport: { width: 915, height: 412 }, launchOptions: { args: ['--use-angle=gl'] } });
test('mission 0 opens at the real treehouse, Guia pauses input, and zipline stays locked before mission 6', async ({
	page
}, info) => {
	test.setTimeout(120000);
	const url = new URL(
		process.env.GAME_E2E_URL ??
			new URL('/secret-trail/?debug', process.env.E2E_BASE_URL ?? 'http://localhost:4180').href
	);
	url.searchParams.set('e2e', '');
	await page.goto(url.href);
	if (!process.env.GAME_E2E_URL)
		await page.getByRole('button', { name: 'Entrar na trilha', exact: true }).click();
	await page.waitForFunction(() => globalThis.__gameDebug?.().ready, null, { timeout: 90000 });
	await page.getByRole('button', { name: 'Guia da Mata', exact: true }).click();
	await expect(page.getByRole('dialog')).toContainText('Guia da Mata');
	const position = await page.evaluate(() => globalThis.__gameDebug?.().x);
	await page.keyboard.down('w');
	await page.waitForTimeout(250);
	await page.keyboard.up('w');
	expect(await page.evaluate(() => globalThis.__gameDebug?.().x)).toBe(position);
	await page.screenshot({ path: info.outputPath('guide-in-game.png') });
	await page.keyboard.press('Escape');
	const iara = storyBuild.level.triggers.find((t) => t.id === 'iara');
	if (!iara) throw Error('iara');
	await walk(page, iara, 2);
	await page.locator('[data-game-button="action"]').tap();
	await page.getByRole('button', { name: 'Vamos começar', exact: true }).press('Enter');
	expect(await page.evaluate(() => globalThis.__gameDebug?.().park?.house)).toBe(false);
	await climbTreehouse(page);
	expect(await page.evaluate(() => globalThis.__gameDebug?.().park?.house)).toBe(true);
	url.searchParams.set('pose', 'deck');
	await page.goto(url.href);
	if (!process.env.GAME_E2E_URL)
		await page.getByRole('button', { name: 'Entrar na trilha', exact: true }).click();
	await page.waitForFunction(() => globalThis.__gameDebug?.().ready, null, { timeout: 90000 });
	expect(await page.evaluate(() => globalThis.__gameDebug?.().park?.ziplineUnlocked)).toBe(false);
	await page.locator('[data-game-root]').focus();
	await page.keyboard.press('e');
	await page.waitForTimeout(250);
	expect(await page.evaluate(() => globalThis.__gameDebug?.().park?.mode)).toBe('walk');
	await page.screenshot({ path: info.outputPath('locked-zipline.png') });
});

test('a real camera frame discovers a bird, saves a bounded thumbnail, and survives reloading', async ({
	page
}, info) => {
	test.setTimeout(90000);
	const url = new URL(
		process.env.GAME_E2E_URL ??
			new URL('/secret-trail/?debug', process.env.E2E_BASE_URL ?? 'http://localhost:4180').href
	);
	url.searchParams.set('e2e', '');
	url.searchParams.set('pose', 'birds');
	await page.goto(url.href);
	if (!process.env.GAME_E2E_URL)
		await page.getByRole('button', { name: 'Entrar na trilha', exact: true }).click();
	await page.waitForFunction(() => globalThis.__gameDebug?.().ready, null, { timeout: 60000 });
	await page.getByRole('button', { name: 'Câmera fotográfica', exact: true }).click();
	await page.mouse.move(460, 210);
	await page.mouse.down({ button: 'right' });
	for (let i = 0; i < 14; i++) {
		if (await page.evaluate(() => (globalThis.__gameDebug?.().park?.photoCount ?? 0) > 0)) break;
		await page.mouse.move(460, 210 - (i + 1) * 12, { steps: 3 });
		await page.waitForTimeout(100);
	}
	await page.mouse.up({ button: 'right' });
	await expect
		.poll(() => page.evaluate(() => globalThis.__gameDebug?.().park?.photoCount ?? 0))
		.toBeGreaterThan(0);
	await page.screenshot({ path: info.outputPath('photo-frame.png') });
	await page.getByRole('button', { name: 'Fotografar', exact: true }).tap();
	await page.getByRole('button', { name: 'Guia da Mata', exact: true }).click();
	await expect(page.getByRole('dialog')).toContainText('1/');
	await page.getByRole('button', { name: /Tucano-de-bico-verde/i }).click();
	await expect(
		page.getByRole('img', { name: 'Seu registro de Tucano-de-bico-verde', exact: true })
	).toBeVisible();
	await page.screenshot({ path: info.outputPath('own-photo.png') });
	const photoBytes = await page
		.getByRole('img', { name: 'Seu registro de Tucano-de-bico-verde' })
		.evaluate(async (image) => (await (await fetch((image as HTMLImageElement).src)).blob()).size);
	expect(photoBytes).toBeGreaterThan(0);
	expect(photoBytes).toBeLessThanOrEqual(60 * 1024);
	const sky = await page
		.getByRole('img', { name: 'Seu registro de Tucano-de-bico-verde' })
		.evaluate(async (image) => {
			const bitmap = await createImageBitmap(await (await fetch((image as HTMLImageElement).src)).blob());
			const c = document.createElement('canvas');
			c.width = bitmap.width;
			c.height = bitmap.height;
			const ctx = c.getContext('2d');
			if (!ctx) throw Error('canvas');
			ctx.drawImage(bitmap, 0, 0);
			bitmap.close();
			return [...ctx.getImageData(Math.floor(c.width / 2), 1, 1, 1).data];
		});
	expect(sky[0] + sky[1] + sky[2]).toBeGreaterThan(100);
	await info.attach('thumbnail', {
		body: JSON.stringify({ bytes: photoBytes, sky }),
		contentType: 'application/json'
	});

	for (const [width, height] of [
		[360, 800],
		[800, 360],
		[1280, 800]
	]) {
		await page.setViewportSize({ width, height });
		await page.screenshot({ path: info.outputPath(`guide-${width}x${height}.png`) });
	}
	await page.setViewportSize({ width: 915, height: 412 });

	await page.reload();
	if (!process.env.GAME_E2E_URL)
		await page.getByRole('button', { name: 'Entrar na trilha', exact: true }).click();
	await page.waitForFunction(() => globalThis.__gameDebug?.().ready, null, { timeout: 60000 });
	await page.getByRole('button', { name: 'Guia da Mata', exact: true }).click();
	await expect(page.getByRole('dialog')).toContainText('1/');
	await page.getByRole('button', { name: /Tucano-de-bico-verde/i }).click();
	await expect(page.getByRole('img', { name: 'Seu registro de Tucano-de-bico-verde' })).toBeVisible();
});
