/**
 * Distance fog and block-level LOD, so the far view cannot blow the budget.
 *
 * Fog colour is the horizon of the light variant (style/palette.ts LIGHT) and
 * its distances are multiples of CAMERA_MAX_DISTANCE (24 u): the fog starts
 * exactly where the camera can no longer back away, so the avatar is never
 * fogged at any zoom, and it is opaque one to two camera lengths further,
 * depending on the tier. `camera.far` is set to the fog end: everything past it
 * would be fully fogged anyway, so the far plane culls it for free (the clear
 * colour or sky must be the same horizon colour, see applyFog).
 *
 * LOD works per block (blocks.ts): each pool has a profile mapping a block's
 * distance from the camera to the share of its instances that stay drawn
 * (1, 1/2, 1/4…). The share is nested and stable: an instance kept at 1/4 is
 * also kept at 1/2, so trees thin out instead of swapping.
 */
import { Color, Fog, type PerspectiveCamera, type Scene } from 'three';
import { CAMERA_MAX_DISTANCE } from '../engine/constants.ts';
import { LIGHT } from '../style/palette.ts';
import type { Quality } from './quality.ts';

export type LightVariant = keyof typeof LIGHT;

/** Fog start and end per tier, in multiples of CAMERA_MAX_DISTANCE. */
export const FOG_RANGE: Readonly<Record<Quality, { readonly start: number; readonly end: number }>> = {
	low: { start: 1, end: 2 },
	medium: { start: 1, end: 2.5 },
	high: { start: 1, end: 3 }
};

/** Night pulls the far fog in (sobrevivencia-procedural.md §4.1); the start stays at the camera's reach. */
export const NIGHT_FOG_END = 0.8;

export interface FogSettings {
	/** Horizon colour of the light variant, as a CSS hex string. */
	readonly color: string;
	readonly near: number;
	readonly far: number;
	/** Camera far plane: the fog end. */
	readonly cameraFar: number;
}

export function fogSettings(quality: Quality, variant: LightVariant = 'daylight'): FogSettings {
	const range = FOG_RANGE[quality];
	const near = CAMERA_MAX_DISTANCE * range.start;
	const end = CAMERA_MAX_DISTANCE * range.end * (variant === 'night' ? NIGHT_FOG_END : 1);
	const far = Math.max(near + 1, end);
	return { color: LIGHT[variant].horizon, near, far, cameraFar: far };
}

/**
 * Applies fog settings to the scene and camera. Reuses the scene's Fog when
 * there is one (changing colour or distances never recompiles; adding or
 * removing fog does). Also sets `background` to the fog colour when the scene
 * has no background yet, so the far plane cut is invisible.
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
 * - tree: all trees inside the camera's reach, half to the middle of the fog, a quarter to its end.
 * - rock: all, then half in the fog.
 * - cover: grass, flowers, bushes and ferns stop where the fog starts; they are
 *   most of the instances (up to ~2,400 on the survival map) and read as
 *   texture, not landmarks, in the fog.
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
