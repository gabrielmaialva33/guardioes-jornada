import { type Group, type Material, Mesh, MeshLambertMaterial, Texture } from 'three';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import modelUrl from '../assets/models/avatar.glb?url';
import hairUrl from '../assets/models/avatar-hair.glb?url';
import { AVATAR_ATLAS } from '../avatar/catalog.ts';
import { HairAccessories } from '../avatar/hair.ts';
import { createAvatarTexture } from '../avatar/texture.ts';
import type { AvatarProfile } from '../data/local-save.ts';
import { stylize } from '../render/stylized.ts';
import { ensureVertexColors } from './materials.ts';

/** Own every resource, including ImageBitmaps, so leaving during decoding is safe. */
export function disposeModel(model: Group) {
	const materials = new Set<Material>();
	const textures = new Set<Texture>();
	model.traverse((object) => {
		if (!(object instanceof Mesh)) return;
		object.geometry.dispose();
		for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
			materials.add(material);
			for (const value of Object.values(material)) if (value instanceof Texture) textures.add(value);
		}
	});
	for (const material of materials) material.dispose();
	for (const texture of textures) {
		texture.dispose();
		if (typeof ImageBitmap !== 'undefined' && texture.image instanceof ImageBitmap) texture.image.close();
	}
	model.removeFromParent();
}

/** Decoders stay inside the pack; caller owns the returned scene and every source texture. */
export async function loadModel(url: string, signal: AbortSignal): Promise<Group> {
	const response = await fetch(url, { signal });
	if (!response.ok) throw new Error('model-download');
	const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
	const model = (
		await loader.parseAsync(await response.arrayBuffer(), new URL('.', new URL(url, location.href)).href)
	).scene;
	if (signal.aborted) {
		disposeModel(model);
		signal.throwIfAborted();
	}
	return model;
}

export interface AvatarInstance {
	model: Group;
	appearance: ReturnType<typeof createAvatarTexture>;
	dispose(): void;
}
export async function loadAvatar(signal: AbortSignal, profile: AvatarProfile): Promise<AvatarInstance> {
	let model: Group | undefined;
	let appearance: ReturnType<typeof createAvatarTexture> | undefined;
	let cancel: (() => void) | undefined;
	let hairSource: Group | undefined;
	let hair: HairAccessories | undefined;
	try {
		model = await loadModel(modelUrl, signal);
		appearance = createAvatarTexture();
		const skin = appearance;
		cancel = () => skin.dispose();
		signal.addEventListener('abort', cancel, { once: true });
		await skin.apply(profile);
		signal.throwIfAborted();
		const material = stylize(
			new MeshLambertMaterial({ map: skin.texture, flatShading: true, vertexColors: true }),
			{ rim: true }
		);
		const originals = new Set<Material>();
		const originalTextures = new Set<Texture>();
		model.traverse((object) => {
			if (!(object instanceof Mesh)) return;
			for (const old of Array.isArray(object.material) ? object.material : [object.material]) {
				originals.add(old);
				for (const value of Object.values(old)) if (value instanceof Texture) originalTextures.add(value);
			}
			ensureVertexColors(object.geometry);
			object.material = material;
		});
		for (const old of originals) old.dispose();
		for (const old of originalTextures) {
			old.dispose();
			if (typeof ImageBitmap !== 'undefined' && old.image instanceof ImageBitmap) old.image.close();
		}
		if (AVATAR_ATLAS.version === 2) {
			hairSource = await loadModel(hairUrl, signal);
			const head = model.getObjectByName('head');
			if (!head) throw new Error('avatar-head-missing');
			hair = new HairAccessories(hairSource, head, AVATAR_ATLAS.hairStyles);
			hair.apply(profile.style === 'classic' ? (profile.hairStyle ?? 'curto') : 'curto', profile.colors);
		}
		model.scale.setScalar(3 / 2.7);
		const ownedModel = model;
		const onAbort = cancel;
		let appearanceGeneration = 0;
		const accessory = hair,
			accessorySource = hairSource;
		return {
			model,
			appearance: {
				texture: skin.texture,
				dispose: () => skin.dispose(),
				async apply(profile: AvatarProfile) {
					const generation = ++appearanceGeneration;
					const changed = await skin.apply(profile);
					if (generation === appearanceGeneration)
						hair?.apply(
							profile.style === 'classic' ? (profile.hairStyle ?? 'curto') : 'curto',
							profile.colors
						);
					return changed;
				}
			},
			dispose() {
				signal.removeEventListener('abort', onAbort);
				appearanceGeneration++;
				accessory?.dispose();
				if (accessorySource) disposeModel(accessorySource);
				skin.dispose();
				disposeModel(ownedModel);
			}
		};
	} catch (error) {
		if (cancel) signal.removeEventListener('abort', cancel);
		hair?.dispose();
		if (hairSource) disposeModel(hairSource);
		appearance?.dispose();
		if (model) disposeModel(model);
		throw error;
	}
}
