/**
 * The diorama's colours come from the same CSS custom properties as the SVG
 * landscape (src/app.css), so the Mata and Sol themes both apply to the 3D
 * scene. Geometry stores tone indices, never raw colours: a theme change only
 * repaints the vertex colours.
 */
import { Color } from 'three';

/** Tones read from CSS custom properties (`--<name>`). */
const CSS_TONES = [
	'sky-top',
	'sky-bottom',
	'hill-far',
	'hill',
	'ground',
	'bark',
	'water',
	'sun',
	'canopy-dark',
	'canopy',
	'canopy-light',
	'blossom',
	'gold',
	'text-soft'
] as const;

/** Tones derived from the CSS ones, so they also follow the theme. */
const DERIVED_TONES = ['soil', 'rock', 'mist', 'meadow'] as const;

export const TONES = [...CSS_TONES, ...DERIVED_TONES] as const;
export type Tone = (typeof TONES)[number];

/** Tone name to index, as stored in the geometry. */
export const TONE = Object.fromEntries(TONES.map((t, i) => [t, i])) as Record<Tone, number>;

/** Mata (default theme) values, used if a property is missing. */
const FALLBACK: Record<(typeof CSS_TONES)[number], string> = {
	'sky-top': '#0d2318',
	'sky-bottom': '#183a28',
	'hill-far': '#24493a',
	hill: '#2b5a40',
	ground: '#1b3d2a',
	bark: '#8a6448',
	water: '#73cbf0',
	sun: '#f4e3a1',
	'canopy-dark': '#143d2b',
	canopy: '#2d6a4f',
	'canopy-light': '#74c69d',
	blossom: '#ff9fb7',
	gold: '#ffd166',
	'text-soft': '#a9dcbf'
};

export interface Palette {
	/** Linear-space colours indexed by `TONE`. */
	colors: Color[];
	/** True for the dark Mata theme: fireflies glow additively, the moon replaces the sun. */
	dark: boolean;
}

function luminance(c: Color): number {
	return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
}

/** Reads the current theme's colours from the element's computed style. */
export function readPalette(el: Element): Palette {
	const style = getComputedStyle(el);
	const colors: Color[] = [];
	for (const tone of CSS_TONES) {
		const value = style.getPropertyValue(`--${tone}`).trim();
		const color = new Color();
		try {
			color.setStyle(value || FALLBACK[tone]);
		} catch {
			color.setStyle(FALLBACK[tone]);
		}
		colors.push(color);
	}

	const get = (t: Tone) => colors[TONE[t]];
	const dark = luminance(get('sky-top')) < 0.2;
	const white = new Color(1, 1, 1);

	// soil: the island's cut, between bark and ground.
	colors.push(get('bark').clone().lerp(get('ground'), 0.35));
	// rock: the floating island's underside, a cool grey-green.
	colors.push(
		get('hill-far')
			.clone()
			.lerp(dark ? get('text-soft') : white, dark ? 0.18 : 0.12)
	);
	// mist: Paranapiacaba's fog, moonlit in Mata, white in Sol.
	colors.push(
		dark ? get('sky-bottom').clone().lerp(get('text-soft'), 0.55) : get('sky-bottom').clone().lerp(white, 0.6)
	);
	// meadow: the clearing's lighter grass.
	colors.push(
		get('hill')
			.clone()
			.lerp(get('canopy-light'), dark ? 0.28 : 0.22)
	);

	return { colors, dark };
}
