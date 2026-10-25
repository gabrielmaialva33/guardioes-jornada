/**
 * Atlantic Forest trees that name the groups. Fills share the same perceived
 * lightness (OKLCH L 0.74-0.82) so no team looks favored, and all take the
 * same dark ink. Color is never the only cue: the UI also shows the initial.
 */
export interface GroupPreset {
	name: string;
	color: string;
}

export const groupPresets: GroupPreset[] = [
	{ name: 'Canela', color: '#ea9356' },
	{ name: 'Cedro', color: '#ff9fb7' },
	{ name: 'Jequitibá', color: '#9cc4ff' },
	{ name: 'Ipê', color: '#d4c85b' },
	{ name: 'Araucária', color: '#23d2c8' },
	{ name: 'Juçara', color: '#cd90e0' }
];

/** Ink used on top of any team color (7.4:1 or better on every fill). */
export const GROUP_INK = '#0a1a10';

export const MIN_GROUPS = 2;
export const MAX_GROUPS = groupPresets.length;
