import { render } from 'svelte/server';
import { expect, it } from 'vitest';
import { GuideService } from '../../guia/persistence.ts';
import { SpeciesRegistry } from '../../guia/registry.ts';
import { SPECIES } from '../../guia/species.ts';
import GuidePanel from './GuidePanel.svelte';

async function service() {
	return GuideService.open(
		new SpeciesRegistry(SPECIES),
		{
			async read() {
				return undefined;
			},
			async write() {
				return true;
			}
		},
		{
			async get() {
				return null;
			},
			async put() {}
		}
	);
}
it('renders a dynamic counter, labeled filters and unknown silhouettes without revealing their facts', async () => {
	const model = await service();
	await model.record(['mico'], 'mission');
	const html = render(GuidePanel, { props: { service: model, onclose() {}, initialEntry: 'muriqui' } }).body;
	expect(html).toContain('1 de 23 espécies descobertas');
	expect(html).toContain('Filtrar por lugar');
	expect(html).toContain('Filtrar por horário');
	expect(html).toContain('Quem vive por aqui?');
	expect(html).not.toContain('Brachyteles arachnoides');
	expect(html).not.toContain(SPECIES[1].fact.text);
});
it('reveals the complete entry after discovery, with conservation separate from game rarity', async () => {
	const model = await service();
	await model.record(['tucano'], 'photo');
	const html = render(GuidePanel, {
		props: { service: model, onclose() {}, initialEntry: 'tucano-de-bico-verde' }
	}).body;
	for (const field of [
		'Ramphastos dicolorus',
		'Onde vive',
		'O que come',
		'Você sabia?',
		'Na natureza',
		'Menos preocupante',
		'Incomum',
		'Fontes desta página'
	])
		expect(html).toContain(field);
});
