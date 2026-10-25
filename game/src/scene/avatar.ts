import {
	type Group,
	type Material,
	Mesh,
	MeshLambertMaterial,
	NearestFilter,
	SRGBColorSpace,
	Texture
} from 'three';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import modelUrl from '../assets/models/avatar.glb?url';
import skinUrl from '../assets/skins/skin-a.webp?url';
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

export async function loadAvatar(signal: AbortSignal): Promise<Group> {
	let model: Group | undefined;
	let bitmap: ImageBitmap | undefined;
	try {
		model = await loadModel(modelUrl, signal);
		const skin = await fetch(skinUrl, { signal });
		if (!skin.ok) throw new Error('skin-download');
		bitmap = await createImageBitmap(await skin.blob(), {
			imageOrientation: 'none',
			premultiplyAlpha: 'none'
		});
		signal.throwIfAborted();
		const texture = new Texture(bitmap);
		texture.colorSpace = SRGBColorSpace;
		texture.flipY = false;
		texture.magFilter = texture.minFilter = NearestFilter;
		texture.generateMipmaps = false;
		texture.needsUpdate = true;
		const material = new MeshLambertMaterial({ map: texture, flatShading: true, vertexColors: true });
		// The source embeds a default skin; release it before replacing it.
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
		model.scale.setScalar(3 / 2.7);
		return model;
	} catch (error) {
		if (model) disposeModel(model);
		bitmap?.close();
		throw error;
	}
}
