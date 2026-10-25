/**
 * Distance fog and block-level LOD, so the far view cannot blow the budget.
 *
 * Fog colour is the horizon of the light variant and its distances are the
 * tier's view distance, both from style/palette.ts (LIGHT, VIEW): on low the
 * fog starts at 30 u and is opaque at 70 u. VIEW is how far the player sees,
 * not how far the camera sits from the avatar (CAMERA_MAX_DISTANCE, 24 u).
 * `camera.far` is the fog end: everything past it would be fully fogged
 * anyway, so the far plane culls it for free (the clear colour or sky must be
 * the same horizon colour, see applyFog), and blocks past it fail the
 * frustum test in blocks.ts.
 *
 * LOD works per block (blocks.ts): each pool has a profile mapping a block's
 * distance from the camera to the share of its instances that stay drawn
 * (1, 1/2, 1/4…). The bands are cut from the same VIEW distances. The share is
 * nested and stable: an instance kept at 1/4 is also kept at 1/2, so trees thin
 * out instead of swapping.
 */
import { Color, Fog, type PerspectiveCamera, type Scene } from 'three';
import { LIGHT, VIEW } from '../style/palette.ts';
import type { Quality } from './quality.ts';

export type LightVariant = keyof typeof LIGHT;

/** Night pulls the fog end in (sobrevivencia-procedural.md §4.1); the start keeps 10 u before it. */
export const NIGHT_FOG_END = 0.8;

export interface FogSettings {
	/** Horizon colour of the light variant, as a CSS hex string. */
	readonly color: string;
	/** Fog start (VIEW fogNear). */
	readonly near: number;
	/** Fog end, opaque (VIEW far). */
	readonly far: number;
	/** Camera far plane: the fog end. */
	readonly cameraFar: number;
}

export function fogSettings(quality: Quality, variant: LightVariant = 'daylight'): FogSettings {
	const view = VIEW[quality];
	const far = variant === 'night' ? view.far * NIGHT_FOG_END : view.far;
	const near = Math.min(view.fogNear, far - 10);
	return { color: LIGHT[variant].horizon, near, far, cameraFar: far };
}

/**
 * Applies fog settings to the scene and camera. Reuses the scene's Fog when
 * there is one (changing colour or distances never recompiles; adding or
 * removing fog does). Sets a Color `background` to the fog colour (or creates
 * one when the scene has none), so the far plane cut is invisible; a scene
 * with a texture or sky dome background keeps it, and the sky's horizon must
 * then match the fog colour and fit inside `cameraFar`.
 */
export function applyFog(scene: Scene, camera: PerspectiveCamera | null, settings: FogSettings): Fog {
	let fog = scene.fog instanceof Fog ? scene.fog : null;
	if (fog === null) {
		fog = new Fog(settings.color, settings.near, settings.far);
		scene.fog = fog;
	} else {
		fog.color.set(settings.color);
		fog.near = settings.near;
		fog.far = settings.far;
	}
	if (scene.background === null) scene.background = new Color(settings.color);
	else if (scene.background instanceof Color) scene.background.set(settings.color);
	if (camera && camera.far !== settings.cameraFar) {
		camera.far = settings.cameraFar;
		camera.updateProjectionMatrix();
	}
	return fog;
}

// --- LOD ---------------------------------------------------------------------------

export interface LodBand {
	/** The band holds blocks whose distance is at most this, in world units. */
	readonly until: number;
	/** Share of the block's instances drawn, 0 to 1. */
	readonly keep: number;
}

/** Bands in increasing `until`; blocks past the last band draw nothing. */
export type LodProfile = readonly LodBand[];

/** Share of instances kept at a block distance. */
export function keepFraction(profile: LodProfile, distance: number): number {
	for (let i = 0; i < profile.length; i++) if (distance <= profile[i].until) return profile[i].keep;
	return 0;
}

/**
 * Bands from the tier's VIEW (through its FogSettings), camera to block distance:
 * - tree: all trees up to where the fog starts, half to the middle of the fog, a quarter to its end.
 * - rock: all, then half in the fog.
 * - cover: grass, flowers, bushes and ferns: all to half the fog start, half to
 *   the fog start, none beyond. They are most of the instances (up to ~2,400 on
 *   the survival map) and read as texture, not landmarks, in the fog.
 * - gameplay: pickups, threats, signs, checkpoints, obby parts: never thinned.
 */
export type LodCategory = 'tree' | 'rock' | 'cover' | 'gameplay';

export function lodProfiles(fog: FogSettings): Readonly<Record<LodCategory, LodProfile>> {
	const middle = (fog.near + fog.far) / 2;
	return {
		tree: [
			{ until: fog.near, keep: 1 },
			{ until: middle, keep: 0.5 },
			{ until: fog.far, keep: 0.25 }
		],
		rock: [
			{ until: fog.near, keep: 1 },
			{ until: fog.far, keep: 0.5 }
		],
		cover: [
			{ until: fog.near * 0.5, keep: 1 },
			{ until: fog.near, keep: 0.5 }
		],
		gameplay: [{ until: fog.far, keep: 1 }]
	};
}

/**
 * Stable LOD rank of an instance slot: the 8-bit reversal of its index (van
 * der Corput order). Slots filled in sequence, as the survival generator's
 * per-block runs are, get evenly spread ranks, so keeping ranks below 128
 * draws every second instance of a block, below 64 every fourth.
 */
export function lodRank(slot: number): number {
	let v = slot & 255;
	v = ((v & 0xf0) >> 4) | ((v & 0x0f) << 4);
	v = ((v & 0xcc) >> 2) | ((v & 0x33) << 2);
	v = ((v & 0xaa) >> 1) | ((v & 0x55) << 1);
	return v;
}

/** LOD profiles for a tier and light variant: `lodProfiles(fogSettings(quality, variant))`. */
export function lodProfilesFor(
	quality: Quality,
	variant: LightVariant = 'daylight'
): Readonly<Record<LodCategory, LodProfile>> {
	return lodProfiles(fogSettings(quality, variant));
}
