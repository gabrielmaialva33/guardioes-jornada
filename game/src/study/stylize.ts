/**
 * The study mode's "painted" look (the default): a Green Hell model redrawn in
 * our house style (ART.md §2, §5, §6), so it sits next to the blocky avatar and
 * the painted trees.
 *
 * - Material: our house Lambert (render/stylized.ts `stylize`, imported, never
 *   edited): flat shading on animals, the house lighting chunk (hemisphere,
 *   canopy shade, height mist) and its rim light. No specular, no normal map.
 * - Albedo: drawn once, at load, small (≤ 96 px, then a soft linear filter), so
 *   fur and pores melt into flat areas; then each pixel takes one of 4 tones of
 *   the palette ramp nearest its hue (greys go to `rock`), pulled 60% onto the
 *   ramp's colour, with saturation and lightness clamped to the world's range
 *   (ART.md §2: S 25–70%, L 12–90%). It keeps each species' pattern (a calf's
 *   stripes, a jaguar's rosettes) in our colours. Nothing is written to disk.
 * - Outline (ART.md §5 characters and animals): a back-face shell in the darkest
 *   tone of the mesh's own ramp, about 1.5 px wide, plus a darker contour on the
 *   faces that turn away. One extra draw per skinned mesh.
 * - One painted material and outline per source material, one canvas per source
 *   image: models stylized before cloning (SkeletonUtils.clone) share them.
 *
 * Shared API (P15 sound and P16 vegetation use it): `stylizeModel(model, look)`.
 * DEV only, behind the study gate (gate.ts).
 */
import {
	BackSide,
	CanvasTexture,
	Color,
	LinearFilter,
	LinearMipmapLinearFilter,
	type Material,
	type Mesh,
	MeshBasicMaterial,
	MeshLambertMaterial,
	type MeshStandardMaterial,
	type Object3D,
	SkinnedMesh,
	SRGBColorSpace,
	type Texture
} from 'three';
import { stylize } from '../render/stylized.ts';
import { LIGHTNESS, RAMPS, type Ramp, SATURATION } from '../style/palette.ts';
import type { StudyLook } from './gate.ts';

export interface StylizeOptions {
	/** Foliage: smooth normals (no flat facets) and no outline, like our vegetation. */
	vegetation?: boolean;
	/** Largest side of the painted albedo, px (≤ 256; default 96). */
	maxSize?: number;
	/** 0 keeps the posterized source colour, 1 replaces it with the ramp tone (default 0.6). */
	snap?: number;
	/** Tones per ramp (default 4; 3 gives an even flatter look). */
	bands?: number;
	/** Darker contour on faces turned away, 0..1 (default 0.35; 0 turns it off). */
	contour?: number;
	/** Back-face shell outline (default: on for skinned meshes unless `vegetation`). */
	outline?: boolean;
	/** Outline width in clip space (≈ px × 2 / viewport height; default 0.006). */
	outlineWidth?: number;
}

export interface StylizedModel {
	readonly look: StudyLook;
	/** Painted materials and canvases created for this model (empty for `raw`). */
	readonly materials: readonly Material[];
	readonly textures: readonly Texture[];
	/** GPU bytes of the painted albedos (RGBA + mips), for the budget readout. */
	readonly textureBytes: number;
	/** Outline shells added (one draw each). */
	readonly outlines: number;
	dispose(): void;
}

export const PAINTED_MAX_SIZE = 256;
const DEFAULT_SIZE = 96;
const DEFAULT_SNAP = 0.6;
const DEFAULT_BANDS = 4;
const DEFAULT_CONTOUR = 0.35;
const DEFAULT_OUTLINE = 0.006;
/** Below this saturation a pixel is a grey: it goes to the rock ramp. */
const GREY = 0.16;

type Rgb = readonly [number, number, number];

interface RampTones {
	name: Ramp;
	/** Mean hue of the tones, 0..1. */
	hue: number;
	tones: readonly Rgb[];
}

const hexRgb = (hex: string): Rgb => {
	const n = Number.parseInt(hex.slice(1), 16);
	return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

/** HSL of sRGB bytes, each 0..1. */
export function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
	const rn = r / 255;
	const gn = g / 255;
	const bn = b / 255;
	const max = Math.max(rn, gn, bn);
	const min = Math.min(rn, gn, bn);
	const l = (max + min) / 2;
	if (max === min) return [0, 0, l];
	const d = max - min;
	const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
	let h: number;
	if (max === rn) h = (gn - bn) / d + (gn < bn ? 6 : 0);
	else if (max === gn) h = (bn - rn) / d + 2;
	else h = (rn - gn) / d + 4;
	return [h / 6, s, l];
}

function hue2rgb(p: number, q: number, t: number) {
	let u = t;
	if (u < 0) u += 1;
	if (u > 1) u -= 1;
	if (u < 1 / 6) return p + (q - p) * 6 * u;
	if (u < 1 / 2) return q;
	if (u < 2 / 3) return p + (q - p) * (2 / 3 - u) * 6;
	return p;
}

/** sRGB bytes (0..255, unrounded) of an HSL colour. */
export function hslToRgb(h: number, s: number, l: number): [number, number, number] {
	if (s === 0) return [l * 255, l * 255, l * 255];
	const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
	const p = 2 * l - q;
	return [hue2rgb(p, q, h + 1 / 3) * 255, hue2rgb(p, q, h) * 255, hue2rgb(p, q, h - 1 / 3) * 255];
}

let ramps: RampTones[] | null = null;
/** The palette RAMPS with their mean hues (computed once). */
export function paletteRamps(): readonly RampTones[] {
	ramps ??= (Object.keys(RAMPS) as Ramp[]).map((name) => {
		const tones = RAMPS[name].map(hexRgb);
		let x = 0;
		let y = 0;
		for (const [r, g, b] of tones) {
			const [h] = rgbToHsl(r, g, b);
			x += Math.cos(h * Math.PI * 2);
			y += Math.sin(h * Math.PI * 2);
		}
		const hue = (Math.atan2(y, x) / (Math.PI * 2) + 1) % 1;
		return { name, hue, tones };
	});
	return ramps;
}

const hueGap = (a: number, b: number) => {
	const d = Math.abs(a - b) % 1;
	return Math.min(d, 1 - d);
};

/** The ramp a colour belongs to: greys to `rock`, colours to the ramp nearest in hue. */
export function rampFor(h: number, s: number): RampTones {
	const all = paletteRamps();
	if (s < GREY) return all.find((r) => r.name === 'rock') ?? all[0];
	let best = all[0];
	let bestGap = Number.POSITIVE_INFINITY;
	for (const ramp of all) {
		if (ramp.name === 'rock') continue;
		const gap = hueGap(h, ramp.hue);
		if (gap < bestGap) {
			bestGap = gap;
			best = ramp;
		}
	}
	return best;
}

/**
 * Posterize RGBA bytes in place (pure, so the tests run it without a canvas):
 * each opaque pixel's lightness is cut into `bands` tones of its ramp, its
 * colour is pulled by `snap` onto that ramp tone, and saturation and lightness
 * end inside the world's range. Returns the ramp most pixels went to.
 */
export function posterizePixels(data: Uint8ClampedArray, snap = DEFAULT_SNAP, bands = DEFAULT_BANDS): Ramp {
	const counts = new Map<Ramp, number>();
	for (let i = 0; i < data.length; i += 4) {
		if (data[i + 3] < 8) continue;
		const [h, s, l] = rgbToHsl(data[i], data[i + 1], data[i + 2]);
		const ramp = rampFor(h, s);
		counts.set(ramp.name, (counts.get(ramp.name) ?? 0) + 1);
		const level = Math.min(bands - 1, Math.floor(l * bands * 1.15));
		const toneIndex = Math.round((level / Math.max(1, bands - 1)) * (ramp.tones.length - 1));
		const tone = ramp.tones[toneIndex];
		// The source, posterized: its own hue, its band's lightness, saturation in range.
		// Greys stay grey (the rock ramp itself sits under the 25% floor); colours stay in range.
		const sat = s < GREY ? s : Math.min(SATURATION.max - 0.1, Math.max(SATURATION.min, s));
		const lit = Math.min(LIGHTNESS.max, Math.max(LIGHTNESS.min, (level + 0.5) / bands));
		const [sr, sg, sb] = hslToRgb(h, sat, lit);
		let r = sr + (tone[0] - sr) * snap;
		let g = sg + (tone[1] - sg) * snap;
		let b = sb + (tone[2] - sb) * snap;
		const [fh, fs, fl] = rgbToHsl(r, g, b);
		const clampS = Math.min(SATURATION.max, fs);
		const clampL = Math.min(LIGHTNESS.max, Math.max(LIGHTNESS.min, fl));
		if (clampS !== fs || clampL !== fl) [r, g, b] = hslToRgb(fh, clampS, clampL);
		data[i] = r;
		data[i + 1] = g;
		data[i + 2] = b;
	}
	let dominant: Ramp = 'rock';
	let most = -1;
	for (const [name, n] of counts)
		if (n > most) {
			most = n;
			dominant = name;
		}
	return dominant;
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

interface Painted {
	texture: CanvasTexture;
	ramp: Ramp;
}

function paintTexture(source: Texture, options: StylizeOptions): Painted | null {
	const image: unknown = source.image;
	if (!isDrawable(image) || typeof document === 'undefined') return null;
	const max = Math.min(PAINTED_MAX_SIZE, options.maxSize ?? DEFAULT_SIZE);
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
	const ramp = posterizePixels(pixels.data, options.snap ?? DEFAULT_SNAP, options.bands ?? DEFAULT_BANDS);
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
	return { texture, ramp };
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

/** The back-face shell: pushed out along the normal in clip space, so it keeps its width at any distance. */
function outlineMaterial(color: string, width: number): MeshBasicMaterial {
	const material = new MeshBasicMaterial({ color, side: BackSide, name: 'study-outline' });
	material.onBeforeCompile = (shader) => {
		shader.uniforms.uStudyOutline = { value: width };
		shader.vertexShader = shader.vertexShader
			.replace('#include <common>', '#include <common>\nuniform float uStudyOutline;')
			.replace(
				'#include <begin_vertex>',
				`#if !defined( USE_ENVMAP ) && !defined( USE_SKINNING )
 vec3 objectNormal = vec3( normal );
 #endif
 #include <begin_vertex>`
			)
			.replace(
				'#include <project_vertex>',
				`#include <project_vertex>
 vec3 studyNormal = normalize( normalMatrix * objectNormal );
 vec2 studyDir = ( projectionMatrix * vec4( studyNormal, 0.0 ) ).xy;
 gl_Position.xy += normalize( studyDir + vec2( 1e-6 ) ) * uStudyOutline * gl_Position.w;`
			);
	};
	material.customProgramCacheKey = () => 'study-outline-v1';
	return material;
}

interface Created {
	materials: Material[];
	textures: Texture[];
	bytes: number;
	outlines: number;
}

function paintMaterial(
	source: Material,
	options: StylizeOptions,
	images: Map<unknown, Painted | null>,
	created: Created
): { material: MeshLambertMaterial; ramp: Ramp } {
	const lit = source as Partial<MeshStandardMaterial>;
	let painted: Painted | null = null;
	if (lit.map) {
		const key = lit.map.image ?? lit.map;
		if (!images.has(key)) {
			const next = paintTexture(lit.map, options);
			images.set(key, next);
			if (next) {
				created.textures.push(next.texture);
				const image = next.texture.image as { width: number; height: number };
				created.bytes += Math.round(image.width * image.height * 4 * (4 / 3));
			}
		}
		painted = images.get(key) ?? null;
	}
	const material = new MeshLambertMaterial({
		name: `${source.name}-painted`,
		map: painted?.texture ?? null,
		color: painted ? new Color('#ffffff') : (lit.color?.clone() ?? new Color('#ffffff')),
		side: source.side,
		transparent: source.transparent,
		opacity: source.opacity,
		alphaTest: source.alphaTest,
		depthWrite: source.depthWrite
	});
	let ramp: Ramp = painted?.ramp ?? 'rock';
	// Untextured parts (eyes, some rocks) keep their colour, posterized like the pixels.
	if (!painted && lit.color) {
		const bytes = new Uint8ClampedArray([
			Math.round(material.color.r * 255),
			Math.round(material.color.g * 255),
			Math.round(material.color.b * 255),
			255
		]);
		ramp = posterizePixels(bytes, options.snap ?? DEFAULT_SNAP, options.bands ?? DEFAULT_BANDS);
		material.color.setRGB(bytes[0] / 255, bytes[1] / 255, bytes[2] / 255);
	}
	stylize(material, { vegetation: options.vegetation === true, rim: true });
	addContour(material, options.contour ?? DEFAULT_CONTOUR);
	material.userData.study = true;
	created.materials.push(material);
	return { material, ramp };
}

/**
 * Give a loaded Green Hell model the study look, in place. `raw` keeps the
 * source materials untouched; `painted` swaps every mesh material for a house
 * Lambert with a posterized, ramp-snapped albedo and adds the outline shells.
 * Call it once on a template before cloning; dispose() frees what the painted
 * look created (the source materials and textures stay the caller's).
 */
export function stylizeModel(model: Object3D, look: StudyLook, options: StylizeOptions = {}): StylizedModel {
	const created: Created = { materials: [], textures: [], bytes: 0, outlines: 0 };
	if (look === 'painted') {
		const byMaterial = new Map<Material, { material: MeshLambertMaterial; ramp: Ramp }>();
		const byImage = new Map<unknown, Painted | null>();
		const outlines = new Map<Ramp, MeshBasicMaterial>();
		const swap = (m: Material) => {
			let painted = byMaterial.get(m);
			if (!painted) {
				painted = paintMaterial(m, options, byImage, created);
				byMaterial.set(m, painted);
			}
			return painted;
		};
		const meshes: Mesh[] = [];
		model.traverse((object) => {
			const mesh = object as Mesh;
			if (mesh.isMesh) meshes.push(mesh);
		});
		for (const mesh of meshes) {
			const sources = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
			const painted = sources.map(swap);
			mesh.material = Array.isArray(mesh.material) ? painted.map((p) => p.material) : painted[0].material;
			const wantsOutline =
				options.outline ?? (!options.vegetation && (mesh as SkinnedMesh).isSkinnedMesh === true);
			if (!wantsOutline || !mesh.parent) continue;
			// The shell takes the darkest tone of the mesh's own ramp (ART.md §2: outlines, never black).
			const ramp = painted[0].ramp;
			let shellMaterial = outlines.get(ramp);
			if (!shellMaterial) {
				shellMaterial = outlineMaterial(RAMPS[ramp][0], options.outlineWidth ?? DEFAULT_OUTLINE);
				outlines.set(ramp, shellMaterial);
				created.materials.push(shellMaterial);
			}
			const skinned = mesh as SkinnedMesh;
			const shell = skinned.isSkinnedMesh
				? new SkinnedMesh(mesh.geometry, shellMaterial)
				: (mesh.clone(false) as Mesh);
			if (!skinned.isSkinnedMesh) shell.material = shellMaterial;
			shell.name = `${mesh.name}-outline`;
			shell.position.copy(mesh.position);
			shell.quaternion.copy(mesh.quaternion);
			shell.scale.copy(mesh.scale);
			shell.userData.studyOutline = true;
			mesh.parent.add(shell);
			if (skinned.isSkinnedMesh) (shell as SkinnedMesh).bind(skinned.skeleton, skinned.bindMatrix);
			created.outlines++;
		}
		// A part the converter left untextured and white (the tamanduá's hair) takes a mid tone
		// of the model's own ramp instead of a white patch.
		const counts = new Map<Ramp, number>();
		for (const { ramp, material } of byMaterial.values())
			if (material.map) counts.set(ramp, (counts.get(ramp) ?? 0) + 1);
		const dominant = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0];
		if (dominant)
			for (const [source, { material }] of byMaterial) {
				const color = (source as Partial<MeshStandardMaterial>).color;
				const white = !color || (color.r > 0.98 && color.g > 0.98 && color.b > 0.98);
				if (!material.map && !(source as Partial<MeshStandardMaterial>).map && white)
					material.color.set(RAMPS[dominant][1]);
			}
	}
	let disposed = false;
	return {
		look,
		materials: created.materials,
		textures: created.textures,
		textureBytes: created.bytes,
		outlines: created.outlines,
		dispose() {
			if (disposed) return;
			disposed = true;
			for (const material of created.materials) material.dispose();
			for (const texture of created.textures) texture.dispose();
		}
	};
}
