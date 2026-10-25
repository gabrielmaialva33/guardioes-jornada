import { test as base, expect, type Page } from '@playwright/test';

// Every test fails if the page logs an error or throws.
const test = base.extend<{ pageErrors: string[] }>({
	pageErrors: [
		async ({ page }, use) => {
			const errors: string[] = [];
			page.on('pageerror', (e) => errors.push(e.message));
			page.on('console', (m) => {
				// Cloudflare's edge analytics beacon (/cdn-cgi/rum) is not part of the app
				// and cannot reach the network in airplane mode.
				if (m.type() === 'error' && !m.location().url.includes('/cdn-cgi/')) errors.push(m.text());
			});
			await use(errors);
			expect(errors, 'console or page errors').toEqual([]);
		},
		{ auto: true }
	]
});

const primary = (page: Page) => page.locator('.action-bar .primary');

async function continueFromGains(page: Page, title: string) {
	const sheet = page.getByRole('dialog', { name: title });
	await expect(sheet).toBeVisible();
	await sheet.getByRole('button', { name: 'Continuar' }).click();
	await expect(sheet).toBeHidden();
}

async function createJourney(page: Page, participant = 'Ana') {
	await page.goto('/');

	// First visit (empty storage) shows the call to adventure and no school/class fields.
	await expect(page.getByRole('heading', { level: 1, name: 'O Chamado da Floresta' })).toBeVisible();
	await expect(page.getByLabel('Escola')).toHaveCount(0);
	await expect(page.getByLabel('Turma')).toHaveCount(0);
	await expect(page.locator('body')).not.toContainText('PENAP');

	await page.getByRole('button', { name: 'Aceitar o chamado' }).click();
	await expect(page).toHaveURL(/\/new\/?\?etapa=nome/);

	await expect(page.getByRole('heading', { level: 1, name: 'Como devemos te chamar?' })).toBeVisible();
	await expect(page.getByLabel('Escola')).toHaveCount(0);
	await expect(page.getByLabel('Turma')).toHaveCount(0);
	await page.getByLabel('Seu nome').fill(participant);
	await page.getByRole('button', { name: 'Continuar' }).click();

	await expect(page.getByRole('heading', { level: 1, name: 'Escolha seu grupo' })).toBeVisible();
	const canelaRadio = page.getByRole('radio', { name: /^Grupo Canela-preta/ });
	const cedroRadio = page.getByRole('radio', { name: /^Grupo Cedro-rosa/ });
	await expect(canelaRadio).toBeAttached();
	await expect(cedroRadio).toBeAttached();
	await expect(page.getByRole('button', { name: 'Adicionar grupo' })).toHaveCount(0);

	// The radio input is visually hidden inside its label, so click/check via the radio or label.
	await cedroRadio.check({ force: true });
	await page.getByRole('button', { name: 'Começar a jornada' }).click();
	await expect(page).toHaveURL(/\/journey\/\?id=/);
}

test('runs a whole journey: missions, points, undo, oath and certificates', async ({ page }) => {
	await createJourney(page, 'Ana');
	await expect(page.locator('body')).not.toContainText('PENAP');

	// Class panel shows the participant name and chosen group.
	const classPanel = page.getByRole('region', { name: 'Progresso da jornada' });
	await expect(classPanel).toContainText('Ana');
	await expect(classPanel).toContainText('Grupo Cedro-rosa');

	// The opening story was already read on the home screen; journey starts at Mission 1 (hidden until revealed).
	await expect(page.getByText('Missão 1 de 5')).toBeVisible();
	await expect(primary(page)).toHaveText('Revelar missão');
	await primary(page).click();
	await expect(page.getByText('Todo guardião precisa conhecer aquilo que protege.')).toBeVisible();
	await expect(page.getByRole('heading', { level: 3, name: 'Canela-preta' })).toBeVisible();
	await expect(page.getByRole('heading', { level: 3, name: 'Cedro-rosa' })).toBeVisible();
	await expect(page.getByText('Ocotea catharinensis')).toBeVisible();
	await expect(page.getByText('Cedrela fissilis')).toBeVisible();

	await primary(page).click();
	await continueFromGains(page, 'Missão cumprida!');
	await page.getByRole('tab', { name: 'Mapa' }).click();
	await expect(page.getByText('Vocês estão aqui')).toBeVisible();
	await expect(page.locator('li.current strong')).toHaveText('Trilha das Árvores');
	await page.getByRole('tab', { name: 'Jornada' }).click();

	// Mission 2: points inside the mission, then undo from the scoreboard.
	await primary(page).click();
	await expect(page.getByText('Minuto de silêncio')).toBeVisible();
	await page.getByRole('button', { name: 'Dar 1 ponto para Canela-preta' }).click();
	await page.getByRole('button', { name: 'Dar 1 ponto para Canela-preta' }).click();
	await page.getByRole('button', { name: 'Dar 1 ponto para Cedro-rosa' }).click();
	await page.getByRole('tab', { name: 'Placar' }).click();
	const scores = page.getByRole('tabpanel', { name: 'Placar' });
	await expect(scores.locator('li.mine')).toContainText('Cedro-rosa');
	await expect(scores.locator('li.mine')).toContainText('seu grupo');
	await expect(scores.getByLabel('2 pontos para Canela-preta')).toBeVisible();
	await scores.getByRole('button', { name: /Desfazer \+1 para Cedro-rosa/ }).click();
	await expect(scores.getByLabel('0 pontos para Cedro-rosa')).toBeVisible();
	await page.getByRole('tab', { name: 'Jornada' }).click();
	await primary(page).click();
	await continueFromGains(page, 'Missão cumprida!');

	// Progress survives a reload (IndexedDB).
	await page.reload();
	await expect(page.getByText('Missão 3 de 5')).toBeVisible();
	await expect(page.getByText('Turma de Guardiões', { exact: false })).toHaveCount(0);
	await expect(page.getByLabel('Nível 2')).toBeVisible();

	// The back button undoes a step.
	await primary(page).click();
	await page.getByRole('button', { name: 'Voltar uma etapa' }).click();
	await expect(primary(page)).toHaveText('Revelar missão');

	// Mission 3.
	await primary(page).click();
	await primary(page).click();
	await continueFromGains(page, 'Missão cumprida!');

	// Mission 4: checklist finds are worth one point each.
	await primary(page).click();
	await page.getByRole('button', { name: 'Cedro-rosa', exact: true }).click();
	await page.getByRole('button', { name: 'Um inseto', exact: true }).click();
	await page.getByRole('button', { name: 'Uma árvore grande', exact: true }).click();
	await expect(page.getByText('2 de 5 encontrados')).toBeVisible();
	await primary(page).click();
	await continueFromGains(page, 'Missão cumprida!');

	// Final mission and the oath.
	await primary(page).click();
	await page.getByRole('button', { name: 'Dar 1 ponto para Cedro-rosa' }).click();
	await primary(page).click();
	await continueFromGains(page, 'Missão cumprida!');
	await expect(primary(page)).toHaveText('Fazer o juramento');
	await primary(page).click();
	await continueFromGains(page, 'Juramento feito!');

	await expect(page.getByRole('heading', { name: 'Vocês são Guardiões da Mata Atlântica!' })).toBeVisible();
	await expect(page.locator('.standings li').first()).toContainText('Cedro-rosa');
	await expect(page.locator('.standings li').first()).toContainText('3 pontos');
	await expect(page.locator('body')).not.toContainText('PENAP');

	await page.getByRole('link', { name: 'Ver certificados' }).click();
	await expect(page.locator('body')).not.toContainText('PENAP');
	await expect(page.locator('article.certificate')).toHaveCount(1);
	const cert = page.getByRole('article', { name: 'Certificado de Ana' });
	await expect(cert).toBeVisible();
	await expect(cert).toContainText('Certificamos que');
	await expect(cert).toContainText('Ana');
	await expect(cert).toContainText('do grupo Cedro-rosa,');
	await expect(cert).toContainText('concluiu a jornada pela Mata Atlântica');
	await expect(cert.getByRole('img', { name: 'Código QR para verificar este certificado' })).toBeVisible();

	// Returning home when journeys exist shows 'Nova jornada', which opens /new starting with the call again.
	await page.goto('/');
	await expect(page.locator('body')).not.toContainText('PENAP');
	await page.getByRole('link', { name: 'Nova jornada' }).click();
	await expect(page.getByRole('heading', { level: 1, name: 'O Chamado da Floresta' })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Aceitar o chamado' })).toBeVisible();
});

test('works in airplane mode once the app is cached', async ({ page, context }) => {
	await createJourney(page);
	// Reveal Mission 1 before going offline.
	await primary(page).click();

	// Wait for the service worker to finish caching the app.
	await page.evaluate(async () => {
		await navigator.serviceWorker.ready;
	});
	await page.goto('/');
	await expect(page.getByText('Pronto offline')).toBeVisible();

	await context.setOffline(true);
	await page.reload();
	await expect(page.getByRole('heading', { name: 'Guardiões da Mata Atlântica' })).toBeVisible();
	await page.getByRole('link', { name: /Continuar jornada/ }).click();
	// Mission 1 was revealed before going offline; the state came back from IndexedDB.
	await expect(page.getByText('Todo guardião precisa conhecer aquilo que protege.')).toBeVisible();
	await primary(page).click();
	await continueFromGains(page, 'Missão cumprida!');
	await expect(page.getByText('Missão 2 de 5')).toBeVisible();

	// A direct load of a deep link also works offline.
	await page.reload();
	await expect(page.getByText('Missão 2 de 5')).toBeVisible();
	await context.setOffline(false);
});

test('keeps the last tap when the app is closed right away', async ({ page }) => {
	await createJourney(page);
	const url = page.url();
	await primary(page).click();
	// Reload immediately, like a phone killing the app right after a tap.
	await page.goto(url);
	await expect(primary(page)).toHaveText('Concluir missão');
	await expect(page.getByText('Todo guardião precisa conhecer aquilo que protege.')).toBeVisible();
});
