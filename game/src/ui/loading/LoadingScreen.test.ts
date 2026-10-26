import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { compile } from 'svelte/compiler';
import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import { FACTS } from './facts.ts';
import LoadingScreen from './LoadingScreen.svelte';
import { LoadingProgress } from './loading.ts';

function html(model: LoadingProgress, firstFact = 0) {
	return render(LoadingScreen, { props: { model, firstFact } }).body;
}

describe('LoadingScreen', () => {
	it('renders the title, the stage, a fact and an accessible progress bar', () => {
		let now = 0;
		const model = new LoadingProgress({ clock: () => now });
		model.track('placements', new Promise(() => {}));
		now = 1500;
		const body = html(model, 3);
		expect(body).toContain('Trilha secreta');
		expect(body).toContain('Plantando as árvores…');
		expect(body).toContain('Você sabia?');
		expect(body).toContain(FACTS[3].text);
		expect(body).toMatch(/role="progressbar"/);
		expect(body).toMatch(/aria-valuemin="0"/);
		expect(body).toMatch(/aria-valuemax="100"/);
		expect(body).toMatch(/aria-valuenow="\d+"/);
		expect(body).toContain('aria-label="Carregando a trilha"');
	});

	it('shows retry and exit on a failure, only exit when 3D is unavailable', () => {
		const failed = new LoadingProgress();
		failed.fail(new Error('network'));
		const body = html(failed);
		expect(body).toContain('role="alert"');
		expect(body).toContain('Tentar de novo');
		expect(body).toContain('Sair');
		const unsupported = new LoadingProgress();
		unsupported.fail(new Error('game-webgl-unavailable'));
		const other = html(unsupported);
		expect(other).toContain('Voltar');
		expect(other).not.toContain('Tentar de novo');
	});

	it('uses no network, no alert/confirm and honours reduced motion', () => {
		const source = readFileSync(new URL('./LoadingScreen.svelte', import.meta.url), 'utf8');
		expect(source).not.toMatch(/https?:\/\/|url\(|@import|fetch\(/);
		expect(source).not.toMatch(/\b(alert|confirm|prompt)\(/);
		expect(source).toMatch(/prefers-reduced-motion: reduce[\s\S]*animation: none/);
		expect(source).toMatch(/safe-area-inset-left/);
	});

	it('stays small: component, model, facts and loader under 15 KB gzipped', () => {
		const read = (name: string) => readFileSync(new URL(name, import.meta.url), 'utf8');
		const compiled = compile(read('./LoadingScreen.svelte'), { generate: 'client', css: 'external' });
		const css = compiled.css?.code ?? '';
		const total = [
			compiled.js.code,
			css,
			read('./loading.ts'),
			read('./facts.ts'),
			read('./scenery.ts'),
			read('./entry.ts')
		].join('\n');
		expect(gzipSync(total).length).toBeLessThan(15 * 1024);
	});
});
