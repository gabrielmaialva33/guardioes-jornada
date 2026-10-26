/**
 * The study mode's "painted" look (the default): a Green Hell model redrawn in
 * our house style (ART.md §2, §5, §6), so it sits next to the blocky avatar and
 * the painted trees.
 *
 * - Material: our house Lambert (render/stylized.ts `stylize`, imported, never
 *   edited): flat shading on animals, the house lighting chunk (hemisphere,
 *   canopy shade, height mist) and its rim light. No specular, no normal map.
 * - Albedo: drawn once, at load, small (≤ 96 px, then a soft linear filter), so
 *   fur and pores melt into flat areas. Each pixel then keeps its place in the
 *   texture's own value structure (dark back, pale collar, light belly): its
 *   lightness, relative to the texture's 5–95% range, picks one of 4 tones of
 *   the palette ramp nearest its hue (near-greys go to `rock`); value and
 *   saturation are pulled 60% onto that tone and the hue half as much, then
 *   clamped to the world's range (ART.md §2: S ≤ 70%, L 12–90%). Nothing is
 *   written to disk.
 * - Opaque: their materials are alpha-blended with smoothness in the albedo's
 *   alpha, which draws a body see-through. Painted materials are opaque, depth
 *   writing and full alpha; only cut-out textures (`…AlbedoOp`, fur cards) keep
 *   an alpha test. `forceOpaque()` does the same to the raw look's materials.
 * - Outline (ART.md §5 characters and animals): a back-face shell in a tone
 *   darker than the body (the ramp's darkest tone, taken down to L 14%), about
 *   1.25 CSS px wide at any distance, plus a darker contour on the faces that
 *   turn away. One extra draw per skinned mesh; callers skip it on small animals.
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
	/** Opaque, depth-writing materials with full alpha, cut-outs aside (default: on unless `vegetation`). */
	opaque?: boolean;
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
/** Outline width, CSS px (ART.md: a thin shell, about 1–1.5 px). */
export const OUTLINE_PX = 1.25;
/** Lightness of the outline tone: under every ramp's darkest tone, over LIGHTNESS.min (never black). */
const OUTLINE_LIGHTNESS = 0.14;
/** Below this saturation a pixel is a grey: it goes to the rock ramp. */
const GREY = 0.08;
/** Texture names whose alpha is a real cut-out (fur and hair cards), not smoothness. */
const CUTOUT = /albedoop|opacity|_op$|alpha|hair/i;

/**
 * The outline width every shell reads, in clip space: OUTLINE_PX of the view's
 * height. Callers update it when the view resizes (`setOutlineViewHeight`).
 */
const outlineWidth = { value: (2 * OUTLINE_PX) / 720 };
export function setOutlineViewHeight(cssHeight: number) {
	if (cssHeight > 0) outlineWidth.value = (2 * OUTLINE_PX) / cssHeight;
}

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
 * Posterize RGBA bytes in place (pure, so the tests run it without a canvas).
 * Each pixel's lightness, relative to the image's own 5–95% range, picks one of
 * `bands` tones of the ramp nearest its hue; value and saturation are pulled by
 * `snap` onto that tone, the hue by half of it; everything ends inside the
 * world's range. `opaque` first sets every alpha to 255 (smoothness in alpha).
 * Returns the ramp most pixels went to.
 */
export function posterizePixels(
	data: Uint8ClampedArray,
	snap = DEFAULT_SNAP,
	bands = DEFAULT_BANDS,
	opaque = false
): Ramp {
	const counts = new Map<Ramp, number>();
	// Pass 1: the image's own value range, from a 64-bucket lightness histogram.
	const histogram = new Uint32Array(64);
	let total = 0;
	for (let i = 0; i < data.length; i += 4) {
		if (opaque) data[i + 3] = 255;
		else if (data[i + 3] < 8) continue;
		const max = Math.max(data[i], data[i + 1], data[i + 2]);
		const min = Math.min(data[i], data[i + 1], data[i + 2]);
		histogram[Math.min(63, Math.floor(((max + min) / 510) * 64))]++;
		total++;
	}
	const percentile = (p: number) => {
		let seen = 0;
		for (let k = 0; k < 64; k++) {
			seen += histogram[k];
			if (seen >= total * p) return (k + 0.5) / 64;
		}
		return 1;
	};
	const low = percentile(0.05);
	const high = Math.max(low + 0.04, percentile(0.95));
	// Pass 2: tones.
	for (let i = 0; i < data.length; i += 4) {
		if (data[i + 3] < 8) continue;
		const [h, s, l] = rgbToHsl(data[i], data[i + 1], data[i + 2]);
		const ramp = rampFor(h, s);
		counts.set(ramp.name, (counts.get(ramp.name) ?? 0) + 1);
		const t = Math.min(1, Math.max(0, (l - low) / (high - low)));
		const band = Math.min(bands - 1, Math.floor(t * bands));
		const tone = ramp.tones[Math.round((band / Math.max(1, bands - 1)) * (ramp.tones.length - 1))];
		const [th, ts, tl] = rgbToHsl(tone[0], tone[1], tone[2]);
		// The source's own value for this band (so a dark animal stays darker than a pale one).
		const own = low + ((band + 0.5) / bands) * (high - low);
		let lit = own + (tl - own) * snap;
		let sat = s + (ts - s) * snap;
		let gap = th - h;
		if (gap > 0.5) gap -= 1;
		if (gap < -0.5) gap += 1;
		const hue = (h + gap * snap * 0.5 + 1) % 1;
		sat = s < GREY ? Math.min(sat, ts + 0.04) : Math.min(SATURATION.max, Math.max(SATURATION.min * 0.8, sat));
		lit = Math.min(LIGHTNESS.max, Math.max(LIGHTNESS.min, lit));
		const [r, g, b] = hslToRgb(hue, sat, lit);
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

function paintTexture(source: Texture, options: StylizeOptions, opaque: boolean): Painted | null {
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
	const ramp = posterizePixels(
		pixels.data,
		options.snap ?? DEFAULT_SNAP,
		options.bands ?? DEFAULT_BANDS,
		opaque
	);
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
function outlineMaterial(color: Color): MeshBasicMaterial {
	const material = new MeshBasicMaterial({ color, side: BackSide, name: 'study-outline' });
	material.onBeforeCompile = (shader) => {
		shader.uniforms.uStudyOutline = outlineWidth;
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
	material.customProgramCacheKey = () => 'study-outline-v2';
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
	const opaque = options.opaque ?? !options.vegetation;
	const cutout = source.alphaTest > 0 || CUTOUT.test(lit.map?.name ?? '');
	let painted: Painted | null = null;
	if (lit.map) {
		const key = lit.map.image ?? lit.map;
		if (!images.has(key)) {
			const next = paintTexture(lit.map, options, opaque && !cutout);
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
		transparent: opaque ? false : source.transparent,
		opacity: opaque ? 1 : source.opacity,
		alphaTest: opaque ? (cutout ? Math.max(0.5, source.alphaTest) : 0) : source.alphaTest,
		depthWrite: opaque ? true : source.depthWrite
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
 * Make every material of a model opaque and depth-writing (their alpha holds
 * smoothness, so blending draws bodies see-through); cut-out textures keep an
 * alpha test. Returns one line per material it had to fix, for the load log.
 */
export function forceOpaque(model: Object3D): string[] {
	const fixed: string[] = [];
	const seen = new Set<Material>();
	model.traverse((object) => {
		const mesh = object as Mesh;
		if (!mesh.isMesh) return;
		for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
			if (seen.has(material)) continue;
			seen.add(material);
			if (!material.transparent && material.opacity >= 1 && material.depthWrite) continue;
			const map = (material as Partial<MeshStandardMaterial>).map;
			const cutout = material.alphaTest > 0 || CUTOUT.test(map?.name ?? '');
			fixed.push(
				`${material.name || '(unnamed)'}: transparent=${material.transparent} opacity=${material.opacity} depthWrite=${material.depthWrite} -> opaque${cutout ? ' + alphaTest 0.5' : ''}`
			);
			material.transparent = false;
			material.opacity = 1;
			material.depthWrite = true;
			material.alphaTest = cutout ? Math.max(0.5, material.alphaTest) : 0;
			material.needsUpdate = true;
		}
	});
	return fixed;
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
				const hsl = { h: 0, s: 0, l: 0 };
				new Color(RAMPS[ramp][0]).getHSL(hsl);
				shellMaterial = outlineMaterial(new Color().setHSL(hsl.h, hsl.s, OUTLINE_LIGHTNESS));
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
