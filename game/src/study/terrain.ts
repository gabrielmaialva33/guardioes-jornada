/**
 * LOCAL-ONLY terrain albedos, selected from the runtime catalog, never terrain
 * geometry. Import only dynamically inside an import.meta.env.DEV branch.
 * The adapter changes a cloned material's map without replacing its ground
 * shader, canopy shade or lighting hooks. Normals and source height/splat maps
 * are deliberately unused: the park keeps its own terrain and Lambert light.
 */
import {
	CanvasTexture,
	LinearFilter,
	LinearMipmapLinearFilter,
	type MeshLambertMaterial,
	RepeatWrapping,
	SRGBColorSpace,
	Texture
} from 'three';
import { loadStudyCatalog, type StudyTerrainTexture } from './data.ts';
import { type StudyLook, studyEnabled, studyLook, studyUrl } from './gate.ts';
import { PAINTED_MAX_SIZE, posterizePixels } from './stylize.ts';

export type StudyTerrainRole = 'leafLitter' | 'soil' | 'mud' | 'sand' | 'riverStone' | 'moss' | 'grass';

export interface StudyTerrainLayer {
	readonly role: StudyTerrainRole;
	readonly texture: Texture;
}

export interface StudyTerrain {
	readonly look: StudyLook;
	/** Every fitting albedo remains available as a variant; unavailable roles stay empty. */
	readonly layers: Readonly<Record<StudyTerrainRole, readonly StudyTerrainLayer[]>>;
	/** Estimated resident RGBA + mip bytes, computed from decoded images. */
	readonly textureBytes: number;
	/** Pass a material owned by the caller (normally its ground/path clone). */
	apply(material: MeshLambertMaterial, role: StudyTerrainRole, variant?: number): () => void;
	/** Restores bindings, frees textures and closes decoded bitmaps. Idempotent. */
	dispose(): void;
}

/** Role-level curation only; asset names and metadata come from the local catalog. */
export function terrainRole(entry: StudyTerrainTexture): StudyTerrainRole | null {
	if (entry.role !== 'albedo') return null;
	const layer = entry.layer.toLowerCase();
	if (/leav|litter|root/.test(layer)) return 'leafLitter';
	if (/river.*ston|ston.*river/.test(layer)) return 'riverStone';
	if (/moss/.test(layer)) return 'moss';
	if (/mud/.test(layer)) return 'mud';
	if (/sand/.test(layer)) return 'sand';
	if (/soil|dirt/.test(layer)) return 'soil';
	if (/grass/.test(layer)) return 'grass';
	return null;
}

function paintedTexture(bitmap: ImageBitmap): CanvasTexture {
	const scale = Math.min(1, PAINTED_MAX_SIZE / Math.max(bitmap.width, bitmap.height));
	const canvas = document.createElement('canvas');
	canvas.width = Math.max(1, Math.round(bitmap.width * scale));
	canvas.height = Math.max(1, Math.round(bitmap.height * scale));
	const context = canvas.getContext('2d', { willReadFrequently: true });
	if (!context) throw new Error('study terrain: no painting canvas');
	context.imageSmoothingEnabled = true;
	context.imageSmoothingQuality = 'high';
	context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
	const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
	posterizePixels(pixels.data, 0.6, 4, true);
	context.putImageData(pixels, 0, 0);
	return new CanvasTexture(canvas);
}

interface OwnedTexture {
	texture: Texture;
	bytes: number;
	dispose(): void;
}

async function loadTexture(path: string, look: StudyLook, signal?: AbortSignal): Promise<OwnedTexture> {
	signal?.throwIfAborted();
	const response = await fetch(studyUrl(path), { signal });
	if (!response.ok) throw new Error(`study terrain: ${response.status}`);
	// ImageBitmap orientation is fixed during decoding, not by Texture.flipY.
	const bitmap = await createImageBitmap(await response.blob(), { imageOrientation: 'flipY' });
	let texture: Texture | undefined;
	let closed = false;
	const close = () => {
		if (!closed) {
			bitmap.close();
			closed = true;
		}
	};
	try {
		signal?.throwIfAborted();
		texture = look === 'painted' ? paintedTexture(bitmap) : new Texture(bitmap);
		const image = texture.image as { width: number; height: number };
		const bytes = Math.round(image.width * image.height * 4 * (4 / 3));
		texture.colorSpace = SRGBColorSpace;
		texture.wrapS = texture.wrapT = RepeatWrapping;
		texture.magFilter = LinearFilter;
		texture.minFilter = LinearMipmapLinearFilter;
		texture.flipY = false;
		texture.needsUpdate = true;
		if (look === 'painted') close();
		let disposed = false;
		return {
			texture,
			bytes,
			dispose() {
				if (disposed) return;
				disposed = true;
				texture?.dispose();
				close();
			}
		};
	} catch (error) {
		texture?.dispose();
		close();
		throw error;
	}
}

/** No request is made until the study gate admits this page. Painted is the default. */
export async function loadStudyTerrain({
	signal,
	look = studyLook()
}: {
	signal?: AbortSignal;
	look?: StudyLook;
} = {}): Promise<StudyTerrain | null> {
	if (!import.meta.env.DEV || !studyEnabled()) return null;
	signal?.throwIfAborted();
	const catalog = await loadStudyCatalog(signal);
	signal?.throwIfAborted();
	const layers: Record<StudyTerrainRole, StudyTerrainLayer[]> = {
		leafLitter: [],
		soil: [],
		mud: [],
		sand: [],
		riverStone: [],
		moss: [],
		grass: []
	};
	const owned: OwnedTexture[] = [];
	const bindings = new Map<MeshLambertMaterial, () => void>();
	let disposed = false;
	try {
		// Sequential decoding bounds transient memory on the physical workstation.
		for (const entry of catalog.terrain ?? []) {
			const role = terrainRole(entry);
			if (!role) continue;
			const next = await loadTexture(entry.path, look, signal);
			owned.push(next);
			layers[role].push({ role, texture: next.texture });
		}
		signal?.throwIfAborted();
	} catch (error) {
		for (const item of owned) item.dispose();
		throw error;
	}
	return {
		look,
		layers,
		textureBytes: owned.reduce((sum, item) => sum + item.bytes, 0),
		apply(material, role, variant = 0) {
			if (disposed) throw new Error('study terrain: disposed');
			const choices = layers[role];
			const index = Number.isFinite(variant)
				? Math.max(0, Math.floor(variant)) % Math.max(1, choices.length)
				: 0;
			const layer = choices[index];
			if (!layer) return () => {};
			bindings.get(material)?.();
			const previous = material.map;
			material.map = layer.texture;
			material.needsUpdate = true;
			let restored = false;
			const restore = () => {
				if (restored) return;
				restored = true;
				if (material.map === layer.texture) {
					material.map = previous;
					material.needsUpdate = true;
				}
				bindings.delete(material);
			};
			bindings.set(material, restore);
			return restore;
		},
		dispose() {
			if (disposed) return;
			disposed = true;
			for (const restore of bindings.values()) restore();
			for (const item of owned) item.dispose();
		}
	};
}
