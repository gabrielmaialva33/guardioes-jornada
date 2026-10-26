/**
 * createLivingWorld: plans the layer from the map, loads what it needs through
 * the game's own loaders, bakes the animal meshes and returns the layer.
 *
 * - GLBs go through the injected `loadGlb` (the scene's meshopt GLTF loader).
 *   The returned scenes are only read, then released with `releaseGlb`
 *   (default: dispose them, as the scene's loadModel hands over ownership).
 * - Palettes load with `loadTexture` (default: fetch + createImageBitmap with
 *   no flip, as GLTFLoader decodes GLB textures).
 * - No listener is added to `signal`; it is checked between steps, and an abort
 *   releases everything already loaded before rethrowing.
 */

import type { Object3D } from 'three';
import { NearestFilter, SRGBColorSpace, Texture } from 'three';
import type { SpeciesId } from '../animation/animals/index.ts';
import { SPECIES } from '../animation/animals/index.ts';
import type { StoryLevel } from '../level/types.ts';
import type { Quality } from '../render/quality.ts';
import type { SurvivalWorld } from '../survival/types.ts';
import { LIFE_ASSETS, type LifeAssetUrls } from './assets.ts';
import type { HowlEvent, LifeBlobs } from './fauna.ts';
import { LIFE_SEED, planLife } from './homes.ts';
import { type LivingWorld, LivingWorldRuntime } from './living-world.ts';
import { bakePet, type PetTemplate, releaseModel } from './pets.ts';

export interface LivingWorldOptions {
	world: SurvivalWorld;
	/** The story level (handholds, clareira); omit for survival maps. */
	level?: StoryLevel;
	quality: Quality;
	loadGlb: (url: string, signal: AbortSignal) => Promise<Object3D>;
	signal: AbortSignal;
	/** Fixed seed (golden captures, tests). */
	seed?: number;
	loadTexture?: (url: string, signal: AbortSignal) => Promise<Texture>;
	/** Called with every GLB scene after baking. Pass a no-op if loadGlb hands out shared cached scenes. */
	releaseGlb?: (model: Object3D) => void;
	/** Every bugio howl and chorus, for the audio landmark. */
	onHowl?: (event: HowlEvent) => void;
	/** The scene's blob shadows (ShadowRig.blobs) for the animals on the ground. */
	blobs?: LifeBlobs;
	/** Override asset URLs (tests). */
	assets?: LifeAssetUrls;
}

/** fetch + createImageBitmap, no flip and no premultiply, like GLTFLoader; a nearest-filtered sRGB palette. */
export async function loadPaletteTexture(url: string, signal: AbortSignal): Promise<Texture> {
	const response = await fetch(url, { signal });
	if (!response.ok) throw new Error(`life-palette:${response.status}`);
	const bitmap = await createImageBitmap(await response.blob(), {
		premultiplyAlpha: 'none',
		colorSpaceConversion: 'none'
	});
	if (signal.aborted) {
		bitmap.close();
		signal.throwIfAborted();
	}
	const texture = new Texture(bitmap);
	texture.flipY = false;
	texture.colorSpace = SRGBColorSpace;
	texture.magFilter = NearestFilter;
	texture.minFilter = NearestFilter;
	texture.generateMipmaps = false;
	texture.needsUpdate = true;
	return texture;
}

export async function createLivingWorld(options: LivingWorldOptions): Promise<LivingWorld> {
	const { world, level, quality, signal } = options;
	const assets = options.assets ?? LIFE_ASSETS;
	const release = options.releaseGlb ?? releaseModel;
	const loadTexture = options.loadTexture ?? loadPaletteTexture;
	signal.throwIfAborted();
	const plan = planLife(world, level, options.seed ?? LIFE_SEED);
	const species = [...new Set(plan.animals.map((a) => a.species))];
	const models = new Map<string, Object3D>();
	const textures = new Map<SpeciesId, Texture>();
	const templates = new Map<SpeciesId, PetTemplate>();
	const releaseAll = () => {
		for (const model of models.values()) release(model);
		models.clear();
	};
	try {
		const urls = new Set<string>();
		for (const id of species) {
			urls.add(assets.models[SPECIES[id].model]);
			const attachment = assets.attachments[id];
			if (attachment) urls.add(attachment);
		}
		const loads = await Promise.allSettled(
			[...urls].map(async (url) => {
				const model = await options.loadGlb(url, signal);
				models.set(url, model);
			})
		);
		const palettes = await Promise.allSettled(
			species.map(async (id) => {
				textures.set(id, await loadTexture(assets.palettes[id], signal));
			})
		);
		signal.throwIfAborted();
		for (const load of [...loads, ...palettes]) if (load.status === 'rejected') throw load.reason;
		for (const id of species) {
			const model = models.get(assets.models[SPECIES[id].model]);
			if (!model) throw new Error(`life: no model for ${id}`);
			const attachmentUrl = assets.attachments[id];
			const attachment = attachmentUrl ? (models.get(attachmentUrl) ?? null) : null;
			templates.set(id, bakePet(id, model, attachment, textures.get(id) ?? null));
		}
		releaseAll();
		signal.throwIfAborted();
		return new LivingWorldRuntime({
			plan,
			world,
			level,
			quality,
			templates,
			textures: [...textures.values()],
			onHowl: options.onHowl,
			blobs: options.blobs
		});
	} catch (error) {
		releaseAll();
		for (const template of templates.values()) {
			template.geometry.dispose();
			template.material.dispose();
		}
		for (const texture of textures.values()) {
			texture.dispose();
			if (typeof ImageBitmap !== 'undefined' && texture.image instanceof ImageBitmap) texture.image.close();
		}
		throw error;
	}
}
