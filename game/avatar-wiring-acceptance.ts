/** Local browser proof of P13 postures, gestures, real hair nodes and throttled ground probes. */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { chromium } from '@playwright/test';

const output = join(homedir(), '.cache/agents/2026-10-25-trilha-secreta/p13-browser');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', args: ['--use-angle=gl', '--no-sandbox'] });
const result: Record<string, unknown> = {
	environment: 'Local Chrome / RTX 4090, mobile low; probes CPU throttled 4x, not a phone measurement'
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
	const page = await context.newPage(),
		errors: string[] = [];
	page.on('pageerror', (e) => errors.push(e.message));
	const origin = process.env.GAME_MEASURE_URL ?? 'http://localhost:5196/';
	const open = async (pose: string) => {
		await page.goto(`${origin}?debug&pose=${pose}`);
		await page.waitForFunction(() => globalThis.__gameDebug?.().ready === true, undefined, {
			timeout: 60000
		});
		await page.waitForTimeout(1200);
	};
	await open('stone-top');
	assert.equal(await page.evaluate(() => globalThis.__gameDebug?.().avatarContext?.surface), 'narrow');
	result.stones = await page.evaluate(() => globalThis.__gameDebug?.());
	await page.screenshot({ path: join(output, 'stones-arms.png') });
	await open('wading');
	assert.equal(await page.evaluate(() => globalThis.__gameDebug?.().avatarContext?.surface), 'water');
	result.wading = await page.evaluate(() => globalThis.__gameDebug?.());
	await page.screenshot({ path: join(output, 'water-wading.png') });
	await open('mirante');
	await page.keyboard.press('KeyE');
	await page.waitForFunction(() => globalThis.__gameDebug?.().avatarContext?.gesture === 'binoculars');
	await page.waitForTimeout(900);
	result.binoculars = await page.evaluate(() => globalThis.__gameDebug?.());
	await page.screenshot({ path: join(output, 'mirante-binoculars.png') });
	await open('spawn');
	await page.getByRole('button', { name: 'Personalizar personagem', exact: true }).click();
	await page.getByRole('button', { name: 'Rabo de cavalo', exact: true }).click();
	await page.getByRole('button', { name: 'Usar este personagem', exact: true }).click();
	await page.waitForFunction(() => globalThis.__gameDebug?.().avatarHair === 'rabo');
	await page.keyboard.down('KeyW');
	await page.waitForTimeout(650);
	await page.keyboard.up('KeyW');
	await page.waitForFunction(
		() => Math.abs(globalThis.__gameDebug?.().avatarContext?.hairPitch ?? 0) > 0.005
	);
	result.hair = await page.evaluate(() => globalThis.__gameDebug?.());
	await page.screenshot({ path: join(output, 'hair-swing.png') });
	const cdp = await context.newCDPSession(page);
	await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
	result.probes = await page.evaluate(async () => {
		const load = (path: string) => import(/* @vite-ignore */ path);
		const [
			{ buildStoryWorld },
			{ buildMapCollision, prefabProxies },
			{ AvatarGroundContext },
			{ createAvatarInput },
			{ Vector3 }
		] = await Promise.all([
			load('/src/level/index.ts'),
			load('/src/world-runtime/collision.ts'),
			load('/src/world-runtime/avatar-context.ts'),
			load('/src/animation/avatar-animator.ts'),
			load('/@id/three')
		]);
		const { world, level } = buildStoryWorld(),
			collision = buildMapCollision(world, prefabProxies(world, level)),
			probe = new AvatarGroundContext(collision, world, level),
			input = createAvatarInput();
		const character = {
			position: new Vector3(),
			previousPosition: new Vector3(),
			groundNormal: new Vector3(0, 1, 0),
			grounded: true
		};
		const points = [
			level.spawn,
			...level.obbies.flatMap((o: { pieces: { x: number; y: number; z: number }[] }) => o.pieces),
			level.mirante
		];
		const batches = [];
		for (let run = 0; run < 120; run++) {
			const start = performance.now();
			for (let i = 0; i < 500; i++) {
				const p = points[i % points.length];
				character.position.set(p.x, p.y, p.z);
				character.previousPosition.copy(character.position);
				probe.update(input, character);
			}
			if (run >= 20) batches.push((performance.now() - start) / 500);
		}
		collision.dispose();
		batches.sort((a, b) => a - b);
		return {
			meanMs: batches.reduce((a, b) => a + b, 0) / batches.length,
			p95Ms: batches[Math.floor(batches.length * 0.95)],
			maxMs: batches.at(-1),
			samples: batches.length,
			updatesPerSample: 500,
			throttle: 4
		};
	});
	const probes = result.probes as { p95Ms: number };
	assert.ok(probes.p95Ms <= 0.05, JSON.stringify(probes));
	assert.deepEqual(errors, []);
	result.errors = errors;
	await writeFile(join(output, 'results.json'), JSON.stringify(result, null, 2));
	console.info(JSON.stringify(result, null, 2));
} finally {
	await browser.close();
}
