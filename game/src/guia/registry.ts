import type { DayTime, SpeciesEntry, Zone } from './types.ts';
export const validId = (id: unknown): id is string =>
	typeof id === 'string' && /^[a-z][a-z0-9-]{0,79}$/.test(id);
export class SpeciesRegistry {
	readonly entries: readonly SpeciesEntry[];
	readonly #index = new Map<string, SpeciesEntry>();
	constructor(entries: readonly SpeciesEntry[]) {
		this.entries = Object.freeze([...entries]);
		for (const entry of entries) {
			for (const id of [entry.id, ...entry.aliases]) {
				if (!validId(id) || this.#index.has(id)) throw new Error(`Duplicate or invalid species id: ${id}`);
				this.#index.set(id, entry);
			}
			for (const field of [
				entry.name,
				entry.scientificName,
				entry.habitat,
				entry.diet,
				entry.status,
				entry.fact
			])
				if (!field.text || !(field.source === 'TODO-SOURCE' || field.source.startsWith('https://')))
					throw new Error(`Missing source: ${entry.id}`);
		}
	}
	find(id: string) {
		return this.#index.get(id);
	}
	filter({ zone, time }: { zone?: Zone; time?: DayTime } = {}) {
		return this.entries.filter((s) => (!zone || s.zones.includes(zone)) && (!time || s.times.includes(time)));
	}
}
