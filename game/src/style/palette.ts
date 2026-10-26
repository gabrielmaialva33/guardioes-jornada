/**
 * The game's colours (see ART.md, section 2). The ramps extend the app's tokens
 * (src/app.css: --canopy, --canopy-light, --bark, --sun, --gold, --water),
 * brightened for daylight, so the game and the app's diorama are one forest.
 * Each ramp goes from shadow to light.
 */
export const RAMPS = {
	leaf: ['#1e4d36', '#2d6a4f', '#4f9a6e', '#74c69d'],
	grass: ['#2f5e3c', '#3f7d4f', '#5fa36a', '#86bf7c'],
	wood: ['#5e4330', '#8a6448', '#a8805c', '#c9a27a'],
	soil: ['#5a4232', '#6b4f3a', '#8f6e52', '#b08f70'],
	rock: ['#4f5c55', '#6f7d74', '#8e9b92', '#b3bdb5'],
	water: ['#1f6f8b', '#2aafad', '#5fd3c8', '#cdece5']
} as const;

/** Reserved for things to touch or reach: collectibles, checkpoints, quest marks. */
export const ACCENT = {
	gold: '#ffd166',
	ipeAmarelo: '#f2c94c',
	ipeRosa: '#ff9fb7'
} as const;

export const LIGHT = {
	daylight: {
		hemisphereSky: '#cfe8ff',
		hemisphereGround: '#6f8f45',
		sun: '#ffe2b5',
		sunElevationDeg: 35,
		skyTop: '#4f9dc7',
		horizon: '#afc9d7'
	},
	night: {
		hemisphereSky: '#2a4a5c',
		hemisphereGround: '#14271c',
		sun: '#b9c8ff',
		sunElevationDeg: 35,
		skyTop: '#0d2318',
		horizon: '#24493a'
	}
} as const;

/**
 * View distance per quality tier, in world units. Fog starts at `fogNear` and is
 * opaque at `far`, which is also the camera's far plane. This is how far the
 * player sees, unrelated to how far the camera sits from the avatar.
 */
export const VIEW = {
	low: { fogNear: 75, far: 140 },
	medium: { fogNear: 105, far: 180 },
	high: { fogNear: 155, far: 260 }
} as const;

export type Ramp = keyof typeof RAMPS;

/** HSL lightness bounds every world colour stays within (ART.md: no pure black or white). */
export const LIGHTNESS = { min: 0.12, max: 0.9 } as const;
export const SATURATION = { min: 0.25, max: 0.7 } as const;
