import { describe, expect, it } from 'vitest';
import { MAX_GROUPS, MIN_GROUPS } from './groups.ts';
import { journeys, mataAtlantica } from './mata-atlantica.ts';

// Hosts of the sources the tree facts were checked against (Embrapa, CNCFlora,
// Flora e Funga do Brasil). A new source needs a deliberate review.
const TRUSTED_SOURCES = ['www.alice.cnptia.embrapa.br', 'proflora.jbrj.gov.br', 'servicos.jbrj.gov.br'];

/** Every string a participant can read: the whole script minus internal ids. */
function visibleText(value: unknown): string[] {
	if (typeof value === 'string') return [value];
	if (Array.isArray(value)) return value.flatMap(visibleText);
	if (value && typeof value === 'object') {
		return Object.entries(value).flatMap(([key, v]) =>
			key === 'id' || key === 'icon' ? [] : visibleText(v)
		);
	}
	return [];
}

describe('Mata Atlântica journey script', () => {
	it('keeps the stored journey id that existing sessions point to', () => {
		expect(journeys.penap).toBe(mataAtlantica);
	});

	it('does not depend on PENAP or assume a school', () => {
		const text = visibleText(mataAtlantica).join('\n');
		expect(text).not.toMatch(/PENAP/i);
		expect(text).not.toMatch(/\b(escola|alun[oa]s?|estudantes?|professor(a|es)?)\b/i);
	});

	it('offers groups a participant can pick freely', () => {
		const names = mataAtlantica.groups.map((g) => g.name);
		expect(names).toEqual(['Canela-preta', 'Cedro-rosa']);
		expect(names.length).toBeGreaterThanOrEqual(MIN_GROUPS);
		expect(names.length).toBeLessThanOrEqual(MAX_GROUPS);
		for (const group of mataAtlantica.groups) expect(group.color).toMatch(/^#[0-9a-f]{6}$/i);
	});

	it('only states tree facts that carry a trusted source', () => {
		const trees = mataAtlantica.steps.flatMap((step) => step.trees ?? []);
		expect(trees.map((t) => t.scientificName)).toEqual(['Ocotea catharinensis', 'Cedrela fissilis']);
		for (const tree of trees) {
			expect(tree.sources.length).toBeGreaterThan(0);
			for (const url of tree.sources) expect(TRUSTED_SOURCES).toContain(new URL(url).hostname);
			// Neither species is exclusive to the Atlantic Forest.
			expect([tree.summary, ...tree.cues].join(' ')).not.toMatch(/end[êe]mic|exclusiv/i);
		}
	});
});
