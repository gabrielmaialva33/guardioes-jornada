import { expect, it } from 'vitest';
import { decodeGuide, GuideBook } from './model.ts';
import { SpeciesRegistry } from './registry.ts';
import { SPECIES } from './species.ts';

it('contains the 23 requested species, canonicalizes photo aliases and filters game zone/time', () => {
	const registry = new SpeciesRegistry(SPECIES);
	expect(registry.entries).toHaveLength(23);
	expect(registry.find('saira')?.id).toBe('saira-sete-cores');
	expect(registry.find('tucano')?.id).toBe('tucano-de-bico-verde');
	expect(registry.filter({ zone: 'manguezal', time: 'dusk' }).some((s) => s.id === 'colhereiro')).toBe(true);
	expect(
		registry
			.filter({ zone: 'praia', time: 'night' })
			.every((s) => s.zones.includes('praia') && s.times.includes('night'))
	).toBe(true);
	expect(() => new SpeciesRegistry([SPECIES[0], SPECIES[0]])).toThrow();
});
it('discovers each species once, merges photo/mission origins and uses the registry count', () => {
	const book = new GuideBook(new SpeciesRegistry(SPECIES));
	expect(book.discover('tucano', 'photo', 100)).toBe(true);
	expect(book.discover('tucano-de-bico-verde', 'photo', 200)).toBe(false);
	expect(book.discover('tucano', 'mission', 300)).toBe(true);
	expect(book.count).toBe(1);
	expect(book.total).toBe(23);
	expect(book.get('tucano')?.firstSeen).toBe(100);
	expect(book.get('tucano')?.origins).toEqual(['photo', 'mission']);
	expect(book.discover('unregistered', 'photo', 1)).toBe(false);
});
it('keeps discoveries for future catalog entries and refuses malformed/future documents without wiping them', () => {
	const doc = {
		version: 1,
		discoveries: {
			future: { firstSeen: 1, origins: ['mission'] },
			tucano: { firstSeen: 2, origins: ['photo'] }
		}
	};
	const result = decodeGuide(doc);
	expect(result.status).toBe('ok');
	const book = new GuideBook(new SpeciesRegistry(SPECIES), result.document ?? undefined);
	expect(book.count).toBe(1);
	expect(book.snapshot().discoveries.future).toEqual(doc.discoveries.future);
	expect(decodeGuide({ version: 2, discoveries: {} }).status).toBe('future');
	expect(decodeGuide({ version: 1, discoveries: { a: { firstSeen: -1, origins: ['oops'] } } }).status).toBe(
		'invalid'
	);
	expect(decodeGuide(undefined).status).toBe('missing');
});
it('never lets a caller mutate the book through returned records or snapshots', () => {
	const book = new GuideBook(new SpeciesRegistry(SPECIES));
	book.discover('anta', 'mission', 1);
	const snapshot = book.snapshot();
	snapshot.discoveries.anta.origins.push('photo');
	expect(book.get('anta')?.origins).toEqual(['mission']);
});

it('preserves a future species id that matches an Object prototype property', () => {
	const decoded = decodeGuide({
		version: 1,
		discoveries: { constructor: { firstSeen: 1, origins: ['mission'] } }
	});
	expect(decoded.status).toBe('ok');
	const book = new GuideBook(new SpeciesRegistry(SPECIES), decoded.document ?? undefined);
	expect(book.count).toBe(0);
	expect(book.snapshot().discoveries.constructor).toEqual({ firstSeen: 1, origins: ['mission'] });
});
