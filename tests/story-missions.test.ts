import { expect, test } from '@playwright/test';
import { drive, storyBuild, walk } from '../game/story-driver.ts';

test.use({ viewport: { width: 915, height: 412 }, launchOptions: { args: ['--use-angle=gl'] } });
test('completes all six story missions through real keyboard movement and touch actions', async ({
	page
}, testInfo) => {
	test.setTimeout(300000);
	const errors: string[] = [];
	page.on('pageerror', (e) => errors.push(e.message));
	await page.addInitScript(() => {
		Object.defineProperty(navigator, 'deviceMemory', { value: 4, configurable: true });
	});
	const standalone = process.env.GAME_E2E_URL;
	await page.goto(standalone ?? '/secret-trail/?debug');
	if (!standalone) await page.getByRole('button', { name: 'Entrar na trilha', exact: true }).click();
	await page.waitForFunction(() => globalThis.__gameDebug?.().ready === true, { timeout: 45000 });
	const { level } = storyBuild;
	const at = (id: string) => {
		const p = [...level.triggers, ...level.landmarks, ...level.collectibles].find((p) => p.id === id);
		if (!p) throw new Error(id);
		return p;
	};
	const act = async (label: string) => {
		const button = page.locator('[data-game-button="action"]');
		await expect(button).toHaveAttribute('aria-label', label);
		await button.tap();
	};
	const close = async () => {
		const button = page.getByRole('button', { name: 'Continuar', exact: true });
		await expect(button).toBeVisible();
		await button.press('Enter');
		await expect(page.getByRole('dialog')).toBeHidden();
	};
	await page.getByRole('button', { name: /^Missões ·/ }).click();
	await expect(page.getByRole('button', { name: /Mirante.*Conclua/ })).toBeDisabled();
	await page.getByRole('button', { name: /^Missões ·/ }).press('Enter');
	console.info('Iara');
	await walk(page, at('iara'), 2);
	await act('Falar com Iara');
	await expect(page.getByRole('dialog')).toBeFocused();
	await page.keyboard.press('Shift+Tab');
	await expect(page.getByRole('button', { name: 'Agora não', exact: true })).toBeFocused();
	await page.screenshot({ path: testInfo.outputPath('iara-dialogue.png') });
	await page.getByRole('button', { name: 'Vamos começar', exact: true }).press('Enter');
	await walk(page, at('lixo-1'), 0.8);
	await act('Recolher resíduo');
	console.info('seeds');
	for (const c of level.collectibles.filter((c) => c.kind === 'jucara-fruit')) {
		await walk(page, c, 0.8);
		await act('Colher sementes de juçara');
	}
	console.info('corridor');
	for (const p of level.planting.filter((p) => p.mission === 1)) {
		await walk(page, p, 0.6);
		await act('Semear juçara');
	}
	await close();
	const leaf = level.collectibles.find((c) => c.kind === 'gold-leaf' && c.mission === 1);
	if (!leaf) throw new Error('leaf');
	await walk(page, leaf, 0.8);
	await act('Recolher folha dourada');
	await expect(page.locator('.missions .inventory')).toContainText('Resíduos 1/10 · Folhas 1/7');
	await page.screenshot({ path: testInfo.outputPath('corridor-restored.png') });
	await expect.poll(() => page.evaluate(() => globalThis.__gameDebug?.().storyProgress[0])).toBe(5);
	// A synchronous event save survives closing/reopening immediately.
	await page.reload();
	if (!standalone) await page.getByRole('button', { name: 'Entrar na trilha', exact: true }).click();
	await page.waitForFunction(() => globalThis.__gameDebug?.().ready === true);
	expect(await page.evaluate(() => globalThis.__gameDebug?.().storyProgress[0])).toBe(5);
	console.info('logger');
	await walk(page, at('observacao'), 0.8);
	await act('Chamar Iara pelo rádio');
	await page
		.getByRole('button', { name: 'Ir lá sozinho tentar impedir a pessoa', exact: true })
		.press('Enter');
	expect(await page.evaluate(() => globalThis.__gameDebug?.().storyProgress[1])).toBe(0);
	await page
		.getByRole('button', {
			name: 'Manter distância segura e avisar a guarda-parque Iara pelo rádio',
			exact: true
		})
		.press('Enter');
	await close();
	console.info('nursery');
	await walk(page, at('viveiro'), 3.0);
	await act('Pegar seis mudas');
	console.info('bridge');
	const bridge = storyBuild.world.crossings.find((c) => c.kind === 'bridge');
	if (!bridge) throw new Error('bridge');
	await walk(page, bridge.from, 0.8);
	await drive(page, [{ x: bridge.to.x, z: bridge.to.z }], 12000);
	const east = level.checkpoints.find((c) => c.id === 'pedras-leste');
	if (!east) throw new Error('bank');
	console.info('east-bank');
	await walk(page, east.spawn, 1.4);
	await expect.poll(() => page.evaluate(() => globalThis.__gameDebug?.().storyProgress[2])).toBe(1);
	console.info('clareira');
	for (const p of level.planting.filter((p) => p.mission === 4)) {
		await walk(page, p, 0.7);
		await act('Plantar muda');
	}
	console.info('traps');
	for (const t of level.triggers.filter((t) => t.kind === 'trap')) {
		const safe = { ...t, x: t.x - 2 };
		await walk(page, safe, 0.4);
		await act('Sinalizar sem tocar');
		await act('Chamar a fiscalização');
	}
	console.info('ledges');
	const obby = level.obbies.find((o) => o.id === 'ledges');
	if (!obby) throw new Error('ledges');
	await walk(page, obby.takeoff, 0.35);
	for (let i = 0; i < obby.pieces.length; i++) {
		if (i) {
			const prev = obby.pieces[i - 1];
			await drive(
				page,
				[{ x: prev.x + obby.dirX * (prev.radius - 0.35), z: prev.z + obby.dirZ * (prev.radius - 0.35) }],
				5000
			);
		}
		const top = obby.pieces[i];
		await drive(page, [top], 5000, true);
		await page.waitForFunction(
			(y) => {
				const s = globalThis.__gameDebug?.();
				return s?.grounded === true && s.y >= y - 0.1;
			},
			top.y,
			{ timeout: 3000 }
		);
	}
	await drive(page, [obby.landing], 5000, false, true);
	if (!(await page.evaluate(() => globalThis.__gameDebug?.().storyFinished)))
		await walk(page, level.mirante, 1, true);
	await expect(page.getByRole('dialog')).toContainText('Parabéns! Você protegeu a Trilha Secreta!');
	expect(await page.evaluate(() => globalThis.__gameDebug?.().storyFinished)).toBe(true);
	await expect(page.getByRole('button', { name: 'Voltar para a jornada', exact: true })).toBeVisible();
	if (standalone)
		expect(await page.evaluate(() => localStorage.getItem('secret-trail-dev-badge'))).toBe('earned');
	else
		expect(await page.evaluate(() => Number(localStorage.getItem('guardioes-secret-badge')))).toBeGreaterThan(
			0
		);
	await page.screenshot({ path: testInfo.outputPath('victory.png') });
	await page.getByRole('button', { name: 'Jogar de novo', exact: true }).tap();
	await expect.poll(() => page.evaluate(() => globalThis.__gameDebug?.().storyProgress[0])).toBe(0);
	expect(errors).toEqual([]);
});
test('the real capsule climbs every mirante ledge using keyboard jump controls', async ({ page }) => {
	test.setTimeout(60000);
	const standalone = process.env.GAME_E2E_URL;
	const url = standalone ? new URL(standalone) : null;
	if (url) url.searchParams.set('pose', 'ledges');
	await page.goto(url?.href ?? '/secret-trail/?debug&pose=ledges');
	if (!standalone) await page.getByRole('button', { name: 'Entrar na trilha', exact: true }).click();
	await page.waitForFunction(() => globalThis.__gameDebug?.().ready === true);
	const obby = storyBuild.level.obbies.find((o) => o.id === 'ledges');
	if (!obby) throw new Error('ledges');
	for (let i = 0; i < obby.pieces.length; i++) {
		if (i) {
			const p = obby.pieces[i - 1];
			await drive(
				page,
				[{ x: p.x + obby.dirX * (p.radius - 0.35), z: p.z + obby.dirZ * (p.radius - 0.35) }],
				5000
			);
		}
		const top = obby.pieces[i];
		console.info('jump', i);
		await drive(page, [top], 5000, true);
		await page.waitForFunction(
			(y) => {
				const s = globalThis.__gameDebug?.();
				return s?.grounded === true && s.y >= y - 0.1;
			},
			top.y,
			{ timeout: 3000 }
		);
	}
});
