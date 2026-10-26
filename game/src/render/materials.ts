/**
 * The one material family of ART.md §5: MeshLambertMaterial, flat shading,
 * vertex colours (the Blender bake of AO plus sky gradient) multiplied by a
 * palette texture sampled with NearestFilter and no mipmaps. Geometry without
 * a bake gets white vertex colours (see mergePieces in instancing.ts), so every
 * static mesh compiles to the same few programs: Lambert + map + vertex colours
 * + fog, with or without instancing and instance colour.
 */

import {
	LinearFilter,
	LinearMipmapLinearFilter,
	type Material,
	type MeshBasicMaterial,
	MeshLambertMaterial,
	type MeshStandardMaterial,
	NearestFilter,
	SRGBColorSpace,
	type Texture
} from 'three';
import { type StylizedOptions, stylize, visualStep } from './stylized.ts';

/** Palette textures: sRGB, nearest, no mipmaps (ART.md §6). Mutates and returns the texture. */
export function preparePaletteMap(texture: Texture): Texture {
	const changed =
		texture.magFilter !== NearestFilter ||
		texture.minFilter !== NearestFilter ||
		texture.generateMipmaps ||
		texture.colorSpace !== SRGBColorSpace;
	texture.magFilter = NearestFilter;
	texture.minFilter = NearestFilter;
	texture.generateMipmaps = false;
	texture.colorSpace = SRGBColorSpace;
	// A texture already uploaded must be uploaded again for new sampler state.
	if (changed && texture.image) texture.needsUpdate = true;
	return texture;
}

/**
 * The house material for a source material (usually the MeshStandardMaterial
 * GLTFLoader builds): same palette map, base colour, side and alpha settings,
 * nothing physically based. Always a new material; callers cache per source.
 */
export function houseMaterial(source: Material, options: StylizedOptions = {}): MeshLambertMaterial {
	options = {
		vegetation: source.userData.vegetation === true,
		cover: source.userData.cover === true,
		...options
	};
	const lit = source as Partial<MeshStandardMaterial & MeshBasicMaterial>;
	const map = lit.map ? preparePaletteMap(lit.map) : null;
	const image: unknown = map?.image;
	if (
		map &&
		options.vegetation &&
		image !== null &&
		typeof image === 'object' &&
		'width' in image &&
		typeof image.width === 'number' &&
		image.width > 64
	) {
		map.magFilter = LinearFilter;
		map.minFilter = LinearMipmapLinearFilter;
		map.generateMipmaps = true;
		map.needsUpdate = true;
	}
	const material = new MeshLambertMaterial({
		name: source.name,
		map,
		flatShading: true,
		vertexColors: true,
		side: source.side,
		transparent: source.transparent,
		opacity: source.opacity,
		alphaTest: source.alphaTest
	});
	if (lit.color) material.color.copy(lit.color);
	if (source.userData.groundTint === true && visualStep() >= 1) {
		material.map = null;
		material.color.set('#ffffff');
	}
	return stylize(material, options);
}
