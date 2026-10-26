/**
 * The study mode's "painted" look: turns a Green Hell model's PBR materials into
 * our house Lambert (render/stylized.ts, imported, never edited), with its albedo
 * posterized to a few tones snapped toward the palette RAMPS (style/palette.ts).
 *
 * - The new albedo is drawn once, at load, into a canvas of at most 256² (ART.md §6
 *   gradient atlases). Nothing is written to disk and nothing leaves the page.
 * - Normal, roughness, metalness and specular maps are dropped (Lambert has none
 *   of them in our look). Alpha is kept, so cut-out leaves still cut out.
 * - A darker contour on the faces that turn away from the eye stands in for an
 *   outline: zero extra draws (an inverted hull would double them).
 * - One painted material per source material and one canvas per source image, so
 *   models stylized before cloning (SkeletonUtils.clone) share them.
 *
 * Shared API (P15 audio and P16 vegetation import it): `stylizeModel(model, look)`.
 * DEV + `?estudo=greenhell` only: see gate.ts.
 */
import {
	CanvasTexture,
	Color,
	LinearFilter,
	LinearMipmapLinearFilter,
	type Material,
	type Mesh,
	MeshLambertMaterial,
	type MeshStandardMaterial,
	type Object3D,
	SRGBColorSpace,
	type Texture
} from 'three';
import { stylize } from '../render/stylized.ts';
import { LIGHTNESS, RAMPS } from '../style/palette.ts';
import type { StudyLook } from './gate.ts';

export interface StylizeOptions {
	/** Foliage: smooth normals (no flat facets), like our vegetation materials. */
	vegetation?: boolean;
	/** Largest side of the painted albedo, px (≤ 256). */
	maxSize?: number;
	/** 0 keeps the posterized source colour, 1 replaces it with the nearest palette colour. */
	snap?: number;
	/** Lightness bands of the posterized source (default 4). */
	bands?: number;
	/** Darker contour strength, 0..1 (default 0.45; 0 turns it off). */
	contour?: number;
}

export interface StylizedModel {
	readonly look: StudyLook;
	/** Painted materials and canvases created for this model (empty for `raw`). */
	readonly materials: readonly Material[];
	readonly textures: readonly Texture[];
	/** GPU bytes of the painted albedos (RGBA + mips), for the budget readout. */
	readonly textureBytes: number;
	dispose(): void;
}

export const PAINTED_MAX_SIZE = 256;
const DEFAULT_SNAP = 0.55;
const DEFAULT_BANDS = 4;
const DEFAULT_CONTOUR = 0.45;

/** Every RAMPS colour as sRGB bytes, shadow to light per ramp. */
export const PALETTE_RGB: readonly (readonly [number, number, number])[] = Object.values(RAMPS).flatMap(
	(ramp) =>
		ramp.map((hex) => {
			const n = Number.parseInt(hex.slice(1), 16);
			return [(n >> 16) & 255, (n >> 8) & 255, n & 255] as const;
		})
);

/** "Redmean" distance: a cheap perceptual RGB metric, good enough to pick a ramp tone. */
function distance(r: number, g: number, b: number, p: readonly [number, number, number]) {
	const rm = (r + p[0]) / 2;
	const dr = r - p[0];
	const dg = g - p[1];
	const db = b - p[2];
	return (2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db;
}

/**
 * Posterize RGBA bytes in place: each opaque pixel's luma is quantized to
 * `bands` levels (hue kept), then mixed toward the nearest palette colour by
 * `snap`, then clamped to the world's lightness range (ART.md §2). Pure, so the
 * unit tests run it without a canvas.
 */
export function posterizePixels(data: Uint8ClampedArray, snap = DEFAULT_SNAP, bands = DEFAULT_BANDS): void {
	const minL = LIGHTNESS.min * 255;
	const maxL = LIGHTNESS.max * 255;
	for (let i = 0; i < data.length; i += 4) {
		if (data[i + 3] < 8) continue;
		let r = data[i];
		let g = data[i + 1];
		let b = data[i + 2];
		const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
		const level = (Math.min(bands - 1, Math.floor((luma / 256) * bands)) + 0.5) / bands;
		const k = luma > 1 ? (level * 255) / luma : 1;
		r = Math.min(255, r * k);
		g = Math.min(255, g * k);
		b = Math.min(255, b * k);
		let best = PALETTE_RGB[0];
		let bestD = Number.POSITIVE_INFINITY;
		for (const p of PALETTE_RGB) {
			const d = distance(r, g, b, p);
			if (d < bestD) {
				bestD = d;
				best = p;
			}
		}
		r += (best[0] - r) * snap;
		g += (best[1] - g) * snap;
		b += (best[2] - b) * snap;
		const l = (Math.max(r, g, b) + Math.min(r, g, b)) / 2;
		const lift = l < minL ? minL - l : l > maxL ? maxL - l : 0;
		data[i] = r + lift;
		data[i + 1] = g + lift;
		data[i + 2] = b + lift;
	}
}

type Drawable = CanvasImageSource & { width: number; height: number };

function isDrawable(image: unknown): image is Drawable {
	if (image === null || typeof image !== 'object') return false;
	if (!('width' in image) || !('height' in image)) return false;
	return (
		(typeof ImageBitmap !== 'undefined' && image instanceof ImageBitmap) ||
		(typeof HTMLImageElement !== 'undefined' && image instanceof HTMLImageElement) ||
		(typeof HTMLCanvasElement !== 'undefined' && image instanceof HTMLCanvasElement) ||
		(typeof OffscreenCanvas !== 'undefined' && image instanceof OffscreenCanvas)
	);
}

function paintTexture(source: Texture, options: StylizeOptions): CanvasTexture | null {
	const image: unknown = source.image;
	if (!isDrawable(image) || typeof document === 'undefined') return null;
	const max = Math.min(PAINTED_MAX_SIZE, options.maxSize ?? PAINTED_MAX_SIZE);
	const scale = Math.min(1, max / Math.max(image.width, image.height));
	const width = Math.max(1, Math.round(image.width * scale));
	const height = Math.max(1, Math.round(image.height * scale));
	const canvas = document.createElement('canvas');
	canvas.width = width;
	canvas.height = height;
	const context = canvas.getContext('2d', { willReadFrequently: true });
	if (!context) return null;
	// The downscale's box filter flattens fur and pores before the tones are cut.
	context.imageSmoothingEnabled = true;
	context.imageSmoothingQuality = 'high';
	context.drawImage(image, 0, 0, width, height);
	const pixels = context.getImageData(0, 0, width, height);
	posterizePixels(pixels.data, options.snap ?? DEFAULT_SNAP, options.bands ?? DEFAULT_BANDS);
	context.putImageData(pixels, 0, 0);
	const texture = new CanvasTexture(canvas);
	texture.name = `${source.name}-painted`;
	texture.colorSpace = SRGBColorSpace;
	texture.flipY = source.flipY;
	texture.wrapS = source.wrapS;
	texture.wrapT = source.wrapT;
	texture.offset.copy(source.offset);
	texture.repeat.copy(source.repeat);
	texture.center.copy(source.center);
	texture.rotation = source.rotation;
	texture.channel = source.channel;
	texture.magFilter = LinearFilter;
	texture.minFilter = LinearMipmapLinearFilter;
	texture.generateMipmaps = true;
	texture.needsUpdate = true;
	return texture;
}

/** The darker contour, chained after the house patch (same program cache key family). */
function addContour(material: MeshLambertMaterial, strength: number) {
	if (strength <= 0) return;
	const previous = material.onBeforeCompile.bind(material);
	const previousKey = material.customProgramCacheKey.bind(material);
	material.onBeforeCompile = (shader, renderer) => {
		previous(shader, renderer);
		shader.uniforms.uStudyContour = { value: strength };
		shader.fragmentShader = shader.fragmentShader
			.replace('#include <common>', '#include <common>\nuniform float uStudyContour;')
			.replace(
				'vec3 outgoingLight =',
				`float studyFacing = abs(dot(normal, normalize(vViewPosition)));
 float studyEdge = 1.0 - smoothstep(0.18, 0.5, studyFacing);
 reflectedLight.directDiffuse *= 1.0 - uStudyContour * studyEdge;
 reflectedLight.indirectDiffuse *= 1.0 - uStudyContour * studyEdge;
 vec3 outgoingLight =`
			);
	};
	material.customProgramCacheKey = () => `${previousKey()}|study-contour`;
}

function paintMaterial(
	source: Material,
	options: StylizeOptions,
	textures: Map<unknown, CanvasTexture | null>,
	created: { materials: Material[]; textures: Texture[]; bytes: number }
): MeshLambertMaterial {
	const lit = source as Partial<MeshStandardMaterial>;
	let map: CanvasTexture | null = null;
	if (lit.map) {
		const key = lit.map.image ?? lit.map;
		if (!textures.has(key)) {
			const painted = paintTexture(lit.map, options);
			textures.set(key, painted);
			if (painted) {
				created.textures.push(painted);
				const image = painted.image as { width: number; height: number };
				created.bytes += Math.round(image.width * image.height * 4 * (4 / 3));
			}
		}
		map = textures.get(key) ?? null;
	}
	const material = new MeshLambertMaterial({
		name: `${source.name}-painted`,
		map,
		color: map ? new Color('#ffffff') : (lit.color?.clone() ?? new Color('#ffffff')),
		side: source.side,
		transparent: source.transparent,
		opacity: source.opacity,
		alphaTest: source.alphaTest,
		depthWrite: source.depthWrite
	});
	// Untextured parts (eyes, some rocks) keep their colour, snapped like the pixels.
	if (!map && lit.color) {
		const bytes = new Uint8ClampedArray([
			Math.round(material.color.r * 255),
			Math.round(material.color.g * 255),
			Math.round(material.color.b * 255),
			255
		]);
		posterizePixels(bytes, options.snap ?? DEFAULT_SNAP, options.bands ?? DEFAULT_BANDS);
		material.color.setRGB(bytes[0] / 255, bytes[1] / 255, bytes[2] / 255);
	}
	stylize(material, { vegetation: options.vegetation === true, rim: true });
	addContour(material, options.contour ?? DEFAULT_CONTOUR);
	material.userData.study = true;
	created.materials.push(material);
	return material;
}

/**
 * Give a loaded Green Hell model the study look, in place. `raw` keeps the
 * source materials untouched; `painted` swaps every mesh material for a house
 * Lambert with a posterized, palette-snapped albedo (≤ 256²). Call it once on a
 * template before cloning; dispose() frees what the painted look created (the
 * source materials and textures stay the caller's).
 */
export function stylizeModel(model: Object3D, look: StudyLook, options: StylizeOptions = {}): StylizedModel {
	const created = { materials: [] as Material[], textures: [] as Texture[], bytes: 0 };
	if (look === 'painted') {
		const byMaterial = new Map<Material, MeshLambertMaterial>();
		const byImage = new Map<unknown, CanvasTexture | null>();
		const swap = (m: Material) => {
			let painted = byMaterial.get(m);
			if (!painted) {
				painted = paintMaterial(m, options, byImage, created);
				byMaterial.set(m, painted);
			}
			return painted;
		};
		model.traverse((object) => {
			const mesh = object as Mesh;
			if (!mesh.isMesh) return;
			mesh.material = Array.isArray(mesh.material) ? mesh.material.map(swap) : swap(mesh.material);
		});
	}
	let disposed = false;
	return {
		look,
		materials: created.materials,
		textures: created.textures,
		textureBytes: created.bytes,
		dispose() {
			if (disposed) return;
			disposed = true;
			for (const material of created.materials) material.dispose();
			for (const texture of created.textures) texture.dispose();
		}
	};
}
