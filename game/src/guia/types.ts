export const ZONES = {
	reserva: 'Reserva da Iara',
	vale: 'Vale das Cachoeiras',
	copa: 'Copa das Árvores',
	praia: 'Praia e Costão',
	manguezal: 'Manguezal'
} as const;
export const TIMES = { dawn: 'Amanhecer', day: 'Dia', dusk: 'Entardecer', night: 'Noite' } as const;
export const RARITIES = { comum: 'Comum', incomum: 'Incomum', raro: 'Raro', lendario: 'Lendário' } as const;
export type Zone = keyof typeof ZONES;
export type DayTime = keyof typeof TIMES;
export type Rarity = keyof typeof RARITIES;
export type ArtKind =
	| 'primate'
	| 'sloth'
	| 'cat'
	| 'bird'
	| 'rodent'
	| 'ungulate'
	| 'canid'
	| 'rabbit'
	| 'armadillo'
	| 'tortoise'
	| 'frog'
	| 'crab'
	| 'turtle';
export interface SourcedText {
	text: string;
	source: string;
}
export interface Conservation extends SourcedText {
	scope: string;
}
export interface SpeciesEntry {
	id: string;
	aliases: readonly string[];
	name: SourcedText;
	scientificName: SourcedText;
	habitat: SourcedText;
	diet: SourcedText;
	status: Conservation;
	fact: SourcedText;
	/** Encounter design, not a claim about abundance, conservation or exclusive biological activity. */
	zones: readonly Zone[];
	times: readonly DayTime[];
	rarity: Rarity;
	art: ArtKind;
	color: string;
	accent: string;
	/** Editorial only; not shown to children. The coordinator approves all facts before release. */
	reviewNote?: string;
}
