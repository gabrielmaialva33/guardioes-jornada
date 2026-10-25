import { test as base, type CDPSession, expect, type Page } from '@playwright/test';

// Every test fails if the page logs an error or throws.
const test = base.extend<{ pageErrors: string[] }>({
	pageErrors: [
		async ({ page }, use) => {
			const errors: string[] = [];
			page.on('pageerror', (e) => errors.push(e.message));
			page.on('console', (m) => {
				if (m.type() === 'error' && !m.location().url.includes('/cdn-cgi/')) errors.push(m.text());
			});
			await use(errors);
			expect(errors, 'console or page errors').toEqual([]);
		},
		{ auto: true }
	]
});

const SHEET = 'Você encontrou uma trilha secreta!';

/** Real touch input (not synthetic events): a tap still ends in a click, as on a phone. */
async function touchscreen(page: Page) {
	const cdp: CDPSession = await page.context().newCDPSession(page);
	const box = await page.locator('figure.secret').first().boundingBox();
	if (!box) throw new Error('the forest is not on screen');
	const x = box.x + box.width / 2;
	const y = box.y + box.height / 2;
	const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', dx = 0) =>
		cdp.send('Input.dispatchTouchEvent', {
			type,
			touchPoints: type === 'touchEnd' ? [] : [{ x: x + dx, y }]
		});
	return {
		async press(ms: number, drag = 0) {
			await touch('touchStart');
			if (drag) await touch('touchMove', drag);
			await page.waitForTimeout(ms);
			await touch('touchEnd');
		},
		async taps(count: number) {
			for (let i = 0; i < count; i++) {
				await touch('touchStart');
				await page.waitForTimeout(40);
				await touch('touchEnd');
				await page.waitForTimeout(80);
			}
		}
	};
}

async function dismiss(page: Page) {
	await page.getByRole('button', { name: 'Agora não' }).click();
	await expect(page.getByRole('dialog', { name: SHEET })).toBeHidden();
}

test('the forest hides the Secret Trail: long press, five taps or the Konami code', async ({ page }) => {
	await page.goto('/');
	await expect(page.getByRole('heading', { level: 1, name: 'O Chamado da Floresta' })).toBeVisible();
	const sheet = page.getByRole('dialog', { name: SHEET });
	const finger = await touchscreen(page);

	// The press opens the sheet, and the click that ends it does not close it again.
	await finger.press(1700);
	await expect(sheet).toBeVisible();
	await page.waitForTimeout(500);
	await expect(sheet).toBeVisible();
	await dismiss(page);

	// Dragging, a short hold or four taps are just touching the forest.
	await finger.press(1700, 40);
	await finger.press(800);
	await finger.taps(4);
	await page.waitForTimeout(2200);
	await expect(sheet).toBeHidden();

	await finger.taps(5);
	await expect(sheet).toBeVisible();
	await dismiss(page);

	for (const key of [
		'ArrowUp',
		'ArrowUp',
		'ArrowDown',
		'ArrowDown',
		'ArrowLeft',
		'ArrowRight',
		'ArrowLeft',
		'ArrowRight',
		'b',
		'a'
	])
		await page.keyboard.press(key);
	await expect(sheet).toBeVisible();
	await page.getByRole('button', { name: 'Entrar na trilha' }).click();
	await expect(page).toHaveURL(/\/secret-trail\/?$/);
});

test('the Sentinela badge only shows once earned on this phone', async ({ page }) => {
	await page.goto('/');
	await page.getByRole('button', { name: 'Aceitar o chamado' }).click();
	await page.getByLabel('Seu nome').fill('Ana');
	await page.getByRole('button', { name: 'Continuar' }).click();
	await page.getByRole('radio', { name: /^Grupo Canela-preta/ }).check();
	await page.getByRole('button', { name: 'Começar a jornada' }).click();
	await expect(page).toHaveURL(/\/journey\/\?id=/);

	await page.getByRole('tab', { name: 'Mapa' }).click();
	await expect(page.getByRole('region', { name: 'Sentinela da Trilha Secreta' })).toHaveCount(0);

	// The game earns it through the bridge; here the stored date stands in for that.
	await page.evaluate(() =>
		localStorage.setItem('guardioes-secret-badge', String(Date.UTC(2026, 9, 25, 12)))
	);
	await page.reload();
	await page.getByRole('tab', { name: 'Mapa' }).click();
	await expect(page.getByRole('region', { name: 'Sentinela da Trilha Secreta' })).toContainText(
		'25 de outubro de 2026'
	);

	await page.goto('/');
	await expect(page.getByRole('region', { name: 'Sentinela da Trilha Secreta' })).toBeVisible();
});
