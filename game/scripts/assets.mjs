#!/usr/bin/env node
/**
 * Idempotent Kenney CC0 asset pipeline for Guardiões da Mata Atlântica (/secret-trail).
 *
 * Reads verified CC0 raw archives from KENNEY_RAW_DIR (defaults to
 * ~/.cache/agents/2026-10-25-trilha-secreta/kenney-raw) and outputs:
 *   - game/src/assets/models/avatar.glb       (Blocky Characters 2.0, 6 rigid nodes, animations stripped)
 *   - game/src/assets/models/monkey.glb       (Cube Pets 2.0 recolor base for mico-leão, bugio, muriqui)
 *   - game/src/assets/models/tiger.glb        (Cube Pets 2.0 recolor base for onça-pintada)
 *   - game/src/assets/models/parrot.glb       (Cube Pets 2.0 base for tucano-de-bico-verde & birds)
 *   - game/src/assets/models/koala.glb        (Cube Pets 2.0 recolor base for bicho-preguiça)
 *   - game/src/assets/models/kit-flora.glb    (Nature Kit 2.1 merged trees, palms, bushes, rocks, logs, grass)
 *   - game/src/assets/models/kit-props.glb    (Platformer 4.1 obby + Food 2.0 trash + Holiday 2.0 cabin)
 *   - game/src/assets/skins/skin-{a..r}.webp  (18 player skins, 256x256 NEAREST lossless WebP)
 *   - game/src/assets/skins/palette-pets.png  (64x64 NEAREST base palette for Cube Pets recolors)
 *
 * Uses pinned tools via pnpm dlx:
 *   - @gltf-transform/cli@4.5.1
 *   - gltfpack@1.3.0 (-cc -kn, meshopt + quantization, no Draco, no KTX2)
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { brotliCompressSync, deflateSync, gzipSync, constants as zlibConstants } from 'node:zlib';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GAME_ROOT = path.resolve(__dirname, '..');
const OUT_MODELS = path.join(GAME_ROOT, 'src', 'assets', 'models');
const OUT_SKINS = path.join(GAME_ROOT, 'src', 'assets', 'skins');
const RAW_ROOT =
	process.env.KENNEY_RAW_DIR ??
	path.join(os.homedir(), '.cache', 'agents', '2026-10-25-trilha-secreta', 'kenney-raw');

const PACKS = ['blocky-characters', 'cube-pets', 'nature-kit', 'platformer-kit', 'food-kit', 'holiday-kit'];

// Custom Atlantic Forest trees live in custom-*.glb; kit-flora keeps only bushes, rocks, logs, stumps, grass, flowers & props.
const FLORA_MODELS = [
	'plant_bushLarge',
	'flower_yellowA',
	'grass_leafsLarge',
	'hanging_moss',
	'rock_largeA',
	'log_large',
	'stump_old',
	'pot_large',
	'crops_leafsStageA',
	'campfire_logs',
	'sign'
];

const COLOR_MAP_PATH = path.join(__dirname, 'blender', 'color-map.json');
const COLOR_MAP = JSON.parse(fs.readFileSync(COLOR_MAP_PATH, 'utf8'));

function srgbByteToLinear(b) {
	const u = b / 255;
	return u <= 0.04045 ? u / 12.92 : ((u + 0.055) / 1.055) ** 2.4;
}

function hexToLinearFactor(hex) {
	const [r, g, b] = parseHex(hex);
	return [srgbByteToLinear(r), srgbByteToLinear(g), srgbByteToLinear(b), 1];
}

const PROP_MODELS = [
	{ pack: 'platformer-kit', dir: 'Models/GLB format', name: 'platform', tex: 'Textures/colormap.png' },
	{ pack: 'platformer-kit', dir: 'Models/GLB format', name: 'platform-ramp', tex: 'Textures/colormap.png' },
	{
		pack: 'platformer-kit',
		dir: 'Models/GLB format',
		name: 'platform-fortified',
		tex: 'Textures/colormap.png'
	},
	{ pack: 'platformer-kit', dir: 'Models/GLB format', name: 'block-grass', tex: 'Textures/colormap.png' },
	{
		pack: 'platformer-kit',
		dir: 'Models/GLB format',
		name: 'block-grass-large',
		tex: 'Textures/colormap.png'
	},
	{ pack: 'platformer-kit', dir: 'Models/GLB format', name: 'flag', tex: 'Textures/colormap.png' },
	{ pack: 'platformer-kit', dir: 'Models/GLB format', name: 'coin-gold', tex: 'Textures/colormap.png' },
	{ pack: 'food-kit', dir: 'Models/GLB format', name: 'soda-bottle', tex: 'Textures/colormap.png' },
	{ pack: 'food-kit', dir: 'Models/GLB format', name: 'soda-can', tex: 'Textures/colormap.png' },
	{
		pack: 'food-kit',
		dir: 'Models/GLB format',
		name: 'soda-can-crushed',
		tex: 'Textures/colormap.png',
		simplifyRatio: 0.88
	},
	{ pack: 'food-kit', dir: 'Models/GLB format', name: 'bag', tex: 'Textures/colormap.png' },
	{ pack: 'holiday-kit', dir: 'Models/GLB format', name: 'cabin-wall', tex: 'Textures/colormap.png' },
	{ pack: 'holiday-kit', dir: 'Models/GLB format', name: 'cabin-doorway', tex: 'Textures/colormap.png' },
	{ pack: 'holiday-kit', dir: 'Models/GLB format', name: 'cabin-window-a', tex: 'Textures/colormap.png' },
	{ pack: 'holiday-kit', dir: 'Models/GLB format', name: 'cabin-corner', tex: 'Textures/colormap.png' },
	{ pack: 'holiday-kit', dir: 'Models/GLB format', name: 'cabin-roof', tex: 'Textures/colormap.png' },
	{ pack: 'holiday-kit', dir: 'Models/GLB format', name: 'cabin-roof-point', tex: 'Textures/colormap.png' },
	{ pack: 'holiday-kit', dir: 'Models/GLB format', name: 'floor-wood', tex: 'Textures/colormap.png' }
];

const PET_NAMES = ['monkey', 'tiger', 'parrot', 'koala'];
const PET_KEEP_ANIMS = new Set(['idle', 'walk', 'run', 'eat', 'gesture-positive']);

function verifyLicenses() {
	for (const pack of PACKS) {
		const licPath = path.join(RAW_ROOT, pack, 'License.txt');
		if (!fs.existsSync(licPath)) {
			throw new Error(`Missing License.txt for ${pack} at ${licPath}`);
		}
		const text = fs.readFileSync(licPath, 'utf8');
		if (!text.includes('Creative Commons Zero, CC0')) {
			throw new Error(`License.txt in ${pack} is not CC0`);
		}
	}
}

/** Read a binary GLB into { json, bin }. */
function readGlb(filePath) {
	const buf = fs.readFileSync(filePath);
	if (buf.readUInt32LE(0) !== 0x46546c67) {
		throw new Error(`Not a valid GLB file: ${filePath}`);
	}
	const jsonLen = buf.readUInt32LE(12);
	const jsonStr = buf.subarray(20, 20 + jsonLen).toString('utf8');
	const json = JSON.parse(jsonStr);
	const binOffset = 20 + jsonLen;
	let bin = Buffer.alloc(0);
	if (binOffset + 8 <= buf.length) {
		const binLen = buf.readUInt32LE(binOffset);
		bin = Buffer.from(buf.subarray(binOffset + 8, binOffset + 8 + binLen));
	}
	return { json, bin };
}

/** Write { json, bin } back to a valid 4-byte aligned binary GLB. */
function writeGlb(filePath, json, bin) {
	const jsonBytes = Buffer.from(JSON.stringify(json), 'utf8');
	const jsonPad = (4 - (jsonBytes.length % 4)) % 4;
	const jsonChunk = Buffer.concat([jsonBytes, Buffer.alloc(jsonPad, 0x20)]);

	const binPad = (4 - (bin.length % 4)) % 4;
	const binChunk = Buffer.concat([bin, Buffer.alloc(binPad, 0x00)]);

	const totalLen = 12 + 8 + jsonChunk.length + (binChunk.length > 0 ? 8 + binChunk.length : 0);
	const header = Buffer.alloc(12);
	header.writeUInt32LE(0x46546c67, 0); // 'glTF'
	header.writeUInt32LE(2, 4); // version 2
	header.writeUInt32LE(totalLen, 8);

	const jsonHeader = Buffer.alloc(8);
	jsonHeader.writeUInt32LE(jsonChunk.length, 0);
	jsonHeader.writeUInt32LE(0x4e4f534a, 4); // 'JSON'

	const parts = [header, jsonHeader, jsonChunk];
	if (binChunk.length > 0) {
		const binHeader = Buffer.alloc(8);
		binHeader.writeUInt32LE(binChunk.length, 0);
		binHeader.writeUInt32LE(0x004e4942, 4); // 'BIN\0'
		parts.push(binHeader, binChunk);
	}
	fs.writeFileSync(filePath, Buffer.concat(parts));
}

/** Append bytes to a GLB buffer with 4-byte alignment and return the new bufferView index. */
function appendBufferView(json, bin, newBytes, target) {
	const alignPad = (4 - (bin.length % 4)) % 4;
	const byteOffset = bin.length + alignPad;
	const nextBin = Buffer.concat([bin, Buffer.alloc(alignPad, 0), newBytes]);
	json.buffers[0].byteLength = nextBin.length;
	json.bufferViews = json.bufferViews || [];
	const viewIndex = json.bufferViews.length;
	const view = { buffer: 0, byteOffset, byteLength: newBytes.length };
	if (target !== undefined) view.target = target;
	json.bufferViews.push(view);
	return { bin: nextBin, viewIndex };
}

/** Strip KHR_materials_unlit (so gltfpack preserves NORMAL) and TANGENT attributes, and set NEAREST samplers. */
function cleanMaterialsAndAttributes(json, { replaceImages = [] } = {}, bin) {
	let currentBin = bin;
	if (json.extensionsUsed) {
		json.extensionsUsed = json.extensionsUsed.filter(
			(e) => e !== 'KHR_materials_unlit' && e !== 'KHR_texture_transform'
		);
		if (json.extensionsUsed.length === 0) delete json.extensionsUsed;
	}
	if (json.materials) {
		for (const mat of json.materials) {
			if (mat.extensions) {
				delete mat.extensions.KHR_materials_unlit;
				if (Object.keys(mat.extensions).length === 0) delete mat.extensions;
			}
			const bct = mat.pbrMetallicRoughness?.baseColorTexture;
			if (bct?.extensions) {
				delete bct.extensions.KHR_texture_transform;
				if (Object.keys(bct.extensions).length === 0) delete bct.extensions;
			}
			if (mat.pbrMetallicRoughness) {
				mat.pbrMetallicRoughness.metallicFactor = 0;
				mat.pbrMetallicRoughness.roughnessFactor = 1;
			}
		}
	}
	if (json.meshes) {
		for (const mesh of json.meshes) {
			for (const prim of mesh.primitives || []) {
				if (prim.attributes?.TANGENT !== undefined) {
					delete prim.attributes.TANGENT;
				}
			}
		}
	}
	if (replaceImages.length > 0 && json.images) {
		for (let i = 0; i < Math.min(json.images.length, replaceImages.length); i++) {
			const imgBytes = replaceImages[i];
			if (!imgBytes) continue;
			const res = appendBufferView(json, currentBin, imgBytes);
			currentBin = res.bin;
			json.images[i] = {
				bufferView: res.viewIndex,
				mimeType: 'image/png',
				name: json.images[i].name || `palette-${i}`
			};
		}
	}
	if (json.textures && json.textures.length > 0) {
		json.samplers = [
			{
				magFilter: 9728, // NEAREST
				minFilter: 9728, // NEAREST
				wrapS: 33071, // CLAMP_TO_EDGE
				wrapT: 33071 // CLAMP_TO_EDGE
			}
		];
		for (const tex of json.textures) {
			tex.sampler = 0;
		}
	}
	return currentBin;
}

/** Bake non-unit scale on the avatar's 'head' node ([0.1, 0.1, 0.1]) into its mesh vertices and wrap out-of-range UVs into [0, 1]. */
function normalizeAvatarHeadScale(json, bin) {
	for (const mesh of json.meshes || []) {
		for (const prim of mesh.primitives || []) {
			if (prim.attributes.TEXCOORD_0 !== undefined) {
				const uvAcc = json.accessors[prim.attributes.TEXCOORD_0];
				const uvBv = json.bufferViews[uvAcc.bufferView];
				const uvBase = (uvBv.byteOffset || 0) + (uvAcc.byteOffset || 0);
				const uvStride = uvBv.byteStride || 8;
				const minUv = [Infinity, Infinity];
				const maxUv = [-Infinity, -Infinity];
				for (let i = 0; i < uvAcc.count; i++) {
					const off = uvBase + i * uvStride;
					const u = ((bin.readFloatLE(off) % 1) + 1) % 1;
					const v = ((bin.readFloatLE(off + 4) % 1) + 1) % 1;
					bin.writeFloatLE(u, off);
					bin.writeFloatLE(v, off + 4);
					if (u < minUv[0]) minUv[0] = u;
					if (v < minUv[1]) minUv[1] = v;
					if (u > maxUv[0]) maxUv[0] = u;
					if (v > maxUv[1]) maxUv[1] = v;
				}
				uvAcc.min = minUv;
				uvAcc.max = maxUv;
			}
		}
	}
	for (const node of json.nodes || []) {
		if (node.name === 'head' && node.scale && node.mesh !== undefined) {
			const [sx, sy, sz] = node.scale;
			if (Math.abs(sx - 1) > 1e-4 || Math.abs(sy - 1) > 1e-4 || Math.abs(sz - 1) > 1e-4) {
				const mesh = json.meshes[node.mesh];
				for (const prim of mesh.primitives || []) {
					const posAccIdx = prim.attributes.POSITION;
					const acc = json.accessors[posAccIdx];
					const bv = json.bufferViews[acc.bufferView];
					const baseOffset = (bv.byteOffset || 0) + (acc.byteOffset || 0);
					const stride = bv.byteStride || 12;
					const min = [Infinity, Infinity, Infinity];
					const max = [-Infinity, -Infinity, -Infinity];
					for (let i = 0; i < acc.count; i++) {
						const off = baseOffset + i * stride;
						const x = bin.readFloatLE(off) * sx;
						const y = bin.readFloatLE(off + 4) * sy;
						const z = bin.readFloatLE(off + 8) * sz;
						bin.writeFloatLE(x, off);
						bin.writeFloatLE(y, off + 4);
						bin.writeFloatLE(z, off + 8);
						if (x < min[0]) min[0] = x;
						if (y < min[1]) min[1] = y;
						if (z < min[2]) min[2] = z;
						if (x > max[0]) max[0] = x;
						if (y > max[1]) max[1] = y;
						if (z > max[2]) max[2] = z;
					}
					acc.min = min;
					acc.max = max;
				}
				delete node.scale;
			}
		}
	}
}

/** Merge multiple static GLB files into a single GLB where each file becomes a named root node in the main scene. */
function mergeStaticGlbs(items, outPath) {
	const merged = {
		asset: { version: '2.0', generator: 'guardioes-assets-pipeline' },
		scene: 0,
		scenes: [{ name: 'Scene', nodes: [] }],
		nodes: [],
		meshes: [],
		materials: [],
		textures: [],
		images: [],
		samplers: [
			{
				magFilter: 9728,
				minFilter: 9728,
				wrapS: 33071,
				wrapT: 33071
			}
		],
		accessors: [],
		bufferViews: [],
		buffers: [{ byteLength: 0 }]
	};
	let mergedBin = Buffer.alloc(0);
	const texIndexByKey = new Map();
	const matIndexByKey = new Map();

	for (const item of items) {
		const { json, bin } = readGlb(item.path);
		cleanMaterialsAndAttributes(json, {}, bin);

		const bvOffset = merged.bufferViews.length;
		const alignPad = (4 - (mergedBin.length % 4)) % 4;
		const binBase = mergedBin.length + alignPad;
		mergedBin = Buffer.concat([mergedBin, Buffer.alloc(alignPad, 0), bin]);

		for (const bv of json.bufferViews || []) {
			merged.bufferViews.push({
				...bv,
				buffer: 0,
				byteOffset: (bv.byteOffset || 0) + binBase
			});
		}

		const accOffset = merged.accessors.length;
		for (const acc of json.accessors || []) {
			merged.accessors.push({
				...acc,
				bufferView: acc.bufferView !== undefined ? acc.bufferView + bvOffset : undefined
			});
		}

		// Map materials (deduplicating by paletteKey or color)
		const matMap = new Map();
		for (let mIdx = 0; mIdx < (json.materials || []).length; mIdx++) {
			const mat = json.materials[mIdx];
			if (item.paletteBytes) {
				let texIdx = texIndexByKey.get(item.paletteKey);
				if (texIdx === undefined) {
					const res = appendBufferView(merged, mergedBin, item.paletteBytes);
					mergedBin = res.bin;
					const imgIdx = merged.images.length;
					merged.images.push({
						bufferView: res.viewIndex,
						mimeType: 'image/png',
						name: item.paletteKey
					});
					texIdx = merged.textures.length;
					merged.textures.push({
						sampler: 0,
						source: imgIdx,
						name: item.paletteKey
					});
					texIndexByKey.set(item.paletteKey, texIdx);
				}
				let sharedMatIdx = matIndexByKey.get(item.paletteKey);
				if (sharedMatIdx === undefined) {
					sharedMatIdx = merged.materials.length;
					merged.materials.push({
						name: item.paletteKey,
						doubleSided: Boolean(mat.doubleSided),
						pbrMetallicRoughness: {
							baseColorTexture: { index: texIdx },
							metallicFactor: 0,
							roughnessFactor: 1
						}
					});
					matIndexByKey.set(item.paletteKey, sharedMatIdx);
				}
				matMap.set(mIdx, sharedMatIdx);
			} else {
				const mappedEntry = COLOR_MAP.natureKitMaterials?.[mat.name];
				const targetFactor = mappedEntry
					? hexToLinearFactor(mappedEntry.targetHex)
					: mat.pbrMetallicRoughness?.baseColorFactor || [1, 1, 1, 1];
				const colorKey = mappedEntry ? mappedEntry.targetHex : JSON.stringify(targetFactor);
				let sharedMatIdx = matIndexByKey.get(colorKey);
				if (sharedMatIdx === undefined) {
					sharedMatIdx = merged.materials.length;
					merged.materials.push({
						name: mat.name || `color-${sharedMatIdx}`,
						pbrMetallicRoughness: {
							baseColorFactor: targetFactor,
							metallicFactor: 0,
							roughnessFactor: 1
						}
					});
					matIndexByKey.set(colorKey, sharedMatIdx);
				}
				matMap.set(mIdx, sharedMatIdx);
			}
		}

		const meshOffset = merged.meshes.length;
		for (const mesh of json.meshes || []) {
			merged.meshes.push({
				name: mesh.name,
				primitives: (mesh.primitives || []).map((p) => {
					const attrs = {};
					for (const [k, v] of Object.entries(p.attributes)) {
						if (!item.paletteBytes && k === 'TEXCOORD_0') continue;
						attrs[k] = v + accOffset;
					}
					return {
						attributes: attrs,
						indices: p.indices !== undefined ? p.indices + accOffset : undefined,
						material: p.material !== undefined ? matMap.get(p.material) : undefined,
						mode: p.mode
					};
				})
			});
		}

		const nodeOffset = merged.nodes.length;
		for (const node of json.nodes || []) {
			const newNode = { ...node };
			if (newNode.mesh !== undefined) newNode.mesh += meshOffset;
			if (newNode.children) newNode.children = newNode.children.map((c) => c + nodeOffset);
			merged.nodes.push(newNode);
		}

		const scene = (json.scenes || [])[json.scene ?? 0] || { nodes: [] };
		const rootChildren = (scene.nodes || []).map((n) => n + nodeOffset);
		if (rootChildren.length === 1) {
			merged.nodes[rootChildren[0]].name = item.name;
			merged.scenes[0].nodes.push(rootChildren[0]);
		} else {
			const wrapperIdx = merged.nodes.length;
			merged.nodes.push({ name: item.name, children: rootChildren });
			merged.scenes[0].nodes.push(wrapperIdx);
		}
	}

	if (merged.textures.length === 0) {
		delete merged.textures;
		delete merged.images;
		delete merged.samplers;
	}
	merged.buffers[0].byteLength = mergedBin.length;
	writeGlb(outPath, merged, mergedBin);
}

function runGltfTransform(args) {
	execFileSync('pnpm', ['dlx', '@gltf-transform/cli@4.5.1', ...args], { stdio: 'pipe' });
}

function runGltfpack(inFile, outFile, extraFlags = []) {
	execFileSync(
		'pnpm',
		['dlx', 'gltfpack@1.3.0', '-i', inFile, '-o', outFile, '-cc', '-kn', '-vtf', ...extraFlags],
		{ stdio: 'pipe' }
	);
}

function resizeNearestPng(inFile, outFile, size) {
	execFileSync(
		'magick',
		[inFile, '-filter', 'point', '-resize', `${size}x${size}`, '-strip', `PNG8:${outFile}`],
		{ stdio: 'pipe' }
	);
	return fs.readFileSync(outFile);
}

function resizeNearestWebp(inFile, outFile, size) {
	execFileSync(
		'magick',
		[
			inFile,
			'-filter',
			'point',
			'-resize',
			`${size}x${size}`,
			'-strip',
			'-define',
			'webp:lossless=true',
			outFile
		],
		{ stdio: 'pipe' }
	);
}

function parseHex(hex) {
	const v = parseInt(hex.slice(1), 16);
	return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

function rgbToLab([r, g, b]) {
	const R = srgbByteToLinear(r);
	const G = srgbByteToLinear(g);
	const B = srgbByteToLinear(b);
	const X = (R * 0.4124564 + G * 0.3575761 + B * 0.1804375) / 0.95047;
	const Y = (R * 0.2126729 + G * 0.7151522 + B * 0.072175) / 1.0;
	const Z = (R * 0.0193339 + G * 0.119192 + B * 0.9503041) / 1.08883;
	const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
	const fx = f(X);
	const fy = f(Y);
	const fz = f(Z);
	return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

function buildRampLabList(includeAccent = false) {
	const list = [];
	for (const hexes of Object.values(COLOR_MAP.ramps)) {
		for (const hx of hexes) {
			const rgb = parseHex(hx);
			list.push({ hex: hx, rgb, lab: rgbToLab(rgb) });
		}
	}
	if (includeAccent) {
		for (const hx of Object.values(COLOR_MAP.accent)) {
			const rgb = parseHex(hx);
			list.push({ hex: hx, rgb, lab: rgbToLab(rgb) });
		}
	}
	return list;
}

function nearestRampRgb(rgb, rampList) {
	const lab = rgbToLab(rgb);
	let best = rampList[0].rgb;
	let bestD = Infinity;
	for (const entry of rampList) {
		const d = Math.hypot(lab[0] - entry.lab[0], lab[1] - entry.lab[1], lab[2] - entry.lab[2]);
		if (d < bestD) {
			bestD = d;
			best = entry.rgb;
		}
	}
	return best;
}

/** Build a 64x64 NEAREST PNG-8 kit palette remapped to ART.md ramps via color-map.json. */
function buildRecoloredKitPalette(packName, srcPngPath) {
	const rgba = Buffer.from(
		execFileSync('magick', [srcPngPath, '-filter', 'point', '-resize', '64x64', '-depth', '8', 'rgba:-'])
	);
	const rampList = buildRampLabList(false);
	const leafShadow = parseHex(COLOR_MAP.ramps.leaf[0]);
	for (let i = 0; i < 64 * 64; i++) {
		const r = rgba[i * 4];
		const g = rgba[i * 4 + 1];
		const b = rgba[i * 4 + 2];
		const nr = r === 0 && g === 0 && b === 0 ? leafShadow : nearestRampRgb([r, g, b], rampList);
		rgba[i * 4] = nr[0];
		rgba[i * 4 + 1] = nr[1];
		rgba[i * 4 + 2] = nr[2];
		rgba[i * 4 + 3] = 255;
	}
	const overrides = COLOR_MAP.kitPropsSwatches?.[packName] || {};
	for (const [keyStr, spec] of Object.entries(overrides)) {
		const [cStr, bStr] = keyStr.replace(/[()]/g, '').split(',');
		const col = Number(cStr);
		const band = Number(bStr);
		const hexes = spec.targetHexes;
		const x0 = col * 8;
		const y0 = band * 16;
		for (let r = 0; r < 16; r++) {
			const rgb = parseHex(hexes[Math.min(3, Math.floor(r / 4))]);
			for (let dx = 0; dx < 8; dx++) {
				const p = ((y0 + r) * 64 + (x0 + dx)) * 4;
				rgba[p] = rgb[0];
				rgba[p + 1] = rgb[1];
				rgba[p + 2] = rgb[2];
				rgba[p + 3] = 255;
			}
		}
	}
	return encodePng(64, 64, rgba);
}

/** Snap every pixel in an embedded PNG buffer to the nearest ART ramp/accent colour. */
function snapPalettePngToArtRamps(pngBytes, workDir) {
	const tmpIn = path.join(workDir, 'snap-in.png');
	fs.writeFileSync(tmpIn, pngBytes);
	const dims = execFileSync('magick', ['identify', '-format', '%w %h', tmpIn], {
		encoding: 'utf8'
	})
		.trim()
		.split(/\s+/)
		.map(Number);
	const [w, h] = dims;
	const rgba = Buffer.from(execFileSync('magick', [tmpIn, '-depth', '8', 'rgba:-']));
	const rampList = buildRampLabList(true);
	for (let i = 0; i < w * h; i++) {
		const nr = nearestRampRgb([rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2]], rampList);
		rgba[i * 4] = nr[0];
		rgba[i * 4 + 1] = nr[1];
		rgba[i * 4 + 2] = nr[2];
		rgba[i * 4 + 3] = 255;
	}
	return encodePng(w, h, rgba);
}

/** Linearly interpolate two '#rrggbb' colors at t in [0, 1]. */
function lerpHex(hexA, hexB, t) {
	const a = parseHex(hexA);
	const b = parseHex(hexB);
	return [
		Math.round(a[0] + (b[0] - a[0]) * t),
		Math.round(a[1] + (b[1] - a[1]) * t),
		Math.round(a[2] + (b[2] - a[2]) * t)
	];
}

/** Deterministic CRC32 for PNG chunks. */
const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
	let c = n;
	for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
	CRC_TABLE[n] = c >>> 0;
}
function crc32(buf) {
	let c = 0xffffffff;
	for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
	return (c ^ 0xffffffff) >>> 0;
}
function pngChunk(type, data) {
	const len = Buffer.alloc(4);
	len.writeUInt32BE(data.length, 0);
	const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data]);
	const crc = Buffer.alloc(4);
	crc.writeUInt32BE(crc32(typeAndData), 0);
	return Buffer.concat([len, typeAndData, crc]);
}

/** Encode an RGBA buffer (width * height * 4) as a compact indexed PNG-8 (or RGB PNG). */
function encodePng(width, height, rgba) {
	// Collect unique RGB colors for indexed PNG-8 (PLTE) if <= 256 colors
	const palette = [];
	const colorIndex = new Map();
	for (let i = 0; i < width * height; i++) {
		const r = rgba[i * 4];
		const g = rgba[i * 4 + 1];
		const b = rgba[i * 4 + 2];
		const key = (r << 16) | (g << 8) | b;
		if (!colorIndex.has(key)) {
			colorIndex.set(key, palette.length);
			palette.push([r, g, b]);
		}
	}

	const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
	if (palette.length <= 256) {
		const ihdr = Buffer.alloc(13);
		ihdr.writeUInt32BE(width, 0);
		ihdr.writeUInt32BE(height, 4);
		ihdr[8] = 8; // 8-bit index
		ihdr[9] = 3; // color type 3 = indexed-color (PLTE)
		ihdr[10] = 0;
		ihdr[11] = 0;
		ihdr[12] = 0;

		const plte = Buffer.alloc(palette.length * 3);
		for (let i = 0; i < palette.length; i++) {
			plte[i * 3] = palette[i][0];
			plte[i * 3 + 1] = palette[i][1];
			plte[i * 3 + 2] = palette[i][2];
		}

		const rawScanlines = Buffer.alloc(height * (1 + width));
		for (let y = 0; y < height; y++) {
			const rowStart = y * (1 + width);
			rawScanlines[rowStart] = 0; // filter None
			for (let x = 0; x < width; x++) {
				const p = (y * width + x) * 4;
				const key = (rgba[p] << 16) | (rgba[p + 1] << 8) | rgba[p + 2];
				rawScanlines[rowStart + 1 + x] = colorIndex.get(key);
			}
		}
		const idat = deflateSync(rawScanlines, { level: 9 });
		return Buffer.concat([
			sig,
			pngChunk('IHDR', ihdr),
			pngChunk('PLTE', plte),
			pngChunk('IDAT', idat),
			pngChunk('IEND', Buffer.alloc(0))
		]);
	}

	const ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(width, 0);
	ihdr.writeUInt32BE(height, 4);
	ihdr[8] = 8;
	ihdr[9] = 2; // RGB
	const rawScanlines = Buffer.alloc(height * (1 + width * 3));
	for (let y = 0; y < height; y++) {
		const rowStart = y * (1 + width * 3);
		rawScanlines[rowStart] = 0;
		for (let x = 0; x < width; x++) {
			const p = (y * width + x) * 4;
			const d = rowStart + 1 + x * 3;
			rawScanlines[d] = rgba[p];
			rawScanlines[d + 1] = rgba[p + 1];
			rawScanlines[d + 2] = rgba[p + 2];
		}
	}
	const idat = deflateSync(rawScanlines, { level: 9 });
	return Buffer.concat([
		sig,
		pngChunk('IHDR', ihdr),
		pngChunk('IDAT', idat),
		pngChunk('IEND', Buffer.alloc(0))
	]);
}

/**
 * Remap UVs in tiger.glb and parrot.glb so Atlantic Forest species palettes map cleanly:
 * - In tiger.glb: eyes/nose (front face z > 0.625) and stripes (sides/back/forehead) both shared
 *   swatch(col=7, band=3). Move the 49 eye/nose triangles to swatch(col=5, band=3) so swatch(col=7, band=3)
 *   can be set to the base coat in jaguar palettes (eliminating tiger stripes while keeping black eyes/nose).
 * - In parrot.glb: wing tops, crest ('Group'), tail base, and the back of the body shared swatch(col=1, band=1)
 *   with the front breast/undertail. Move wing/crest/back triangles to swatch(col=1, band=3) so the wings,
 *   crown, back, and tail of Ramphastos dicolorus render glossy black while the front breast is yellow/red
 *   and the beak cells (7,3)/(6,3) are pale green.
 */
function remapPetUvsForSpecies(petName, json, bin) {
	if (petName !== 'tiger' && petName !== 'parrot') return;
	for (const mesh of json.meshes || []) {
		for (const prim of mesh.primitives || []) {
			const posAcc = json.accessors[prim.attributes.POSITION];
			const uvAcc = json.accessors[prim.attributes.TEXCOORD_0];
			const idxAcc = json.accessors[prim.indices];
			const posBv = json.bufferViews[posAcc.bufferView];
			const uvBv = json.bufferViews[uvAcc.bufferView];
			const idxBv = json.bufferViews[idxAcc.bufferView];
			const posBase = (posBv.byteOffset || 0) + (posAcc.byteOffset || 0);
			const posStride = posBv.byteStride || 12;
			const uvBase = (uvBv.byteOffset || 0) + (uvAcc.byteOffset || 0);
			const uvStride = uvBv.byteStride || 8;
			const idxBase = (idxBv.byteOffset || 0) + (idxAcc.byteOffset || 0);
			const idxBytes = idxAcc.componentType === 5121 ? 1 : idxAcc.componentType === 5123 ? 2 : 4;

			const readIdx = (i) =>
				idxBytes === 1
					? bin.readUInt8(idxBase + i)
					: idxBytes === 2
						? bin.readUInt16LE(idxBase + i * 2)
						: bin.readUInt32LE(idxBase + i * 4);
			const readPos = (vi) => [
				bin.readFloatLE(posBase + vi * posStride),
				bin.readFloatLE(posBase + vi * posStride + 4),
				bin.readFloatLE(posBase + vi * posStride + 8)
			];
			const readUv = (vi) => [
				bin.readFloatLE(uvBase + vi * uvStride),
				bin.readFloatLE(uvBase + vi * uvStride + 4)
			];
			const writeUv = (vi, u, v) => {
				bin.writeFloatLE(u, uvBase + vi * uvStride);
				bin.writeFloatLE(v, uvBase + vi * uvStride + 4);
			};

			for (let i = 0; i < idxAcc.count; i += 3) {
				const tris = [readIdx(i), readIdx(i + 1), readIdx(i + 2)];
				const uv0 = readUv(tris[0]);
				const uv1 = readUv(tris[1]);
				const uv2 = readUv(tris[2]);
				const cu = (uv0[0] + uv1[0] + uv2[0]) / 3;
				const cv = (uv0[1] + uv1[1] + uv2[1]) / 3;
				const col = Math.floor(cu * 8);
				const band = Math.floor(cv * 4);

				const p0 = readPos(tris[0]);
				const p1 = readPos(tris[1]);
				const p2 = readPos(tris[2]);
				const cx = (p0[0] + p1[0] + p2[0]) / 3;
				const cy = (p0[1] + p1[1] + p2[1]) / 3;
				const cz = (p0[2] + p1[2] + p2[2]) / 3;

				if (petName === 'tiger' && mesh.name === 'body' && col === 7 && band === 3) {
					const isEyeOrNose = cz > 0.625 && Math.abs(cx) < 0.35 && cy > 0.48 && cy < 0.9;
					if (isEyeOrNose) {
						// Move eye/nose to col=5, band=3 (u shifted by -2/8 = -0.25)
						for (const vi of tris) {
							const [u, v] = readUv(vi);
							if (Math.floor(u * 8) === 7) writeUv(vi, u - 2 / 8, v);
						}
					}
				} else if (petName === 'parrot') {
					if (
						mesh.name === 'wing-left' ||
						mesh.name === 'wing-right' ||
						mesh.name === 'Group' ||
						mesh.name === 'tail'
					) {
						// Map entire wing, crest, and tail meshes to cell (1,3) (glossy black plumage)
						for (const vi of tris) {
							const [, v] = readUv(vi);
							const localR = (v * 64) % 16;
							writeUv(vi, 1.5 / 8, (3 * 16 + localR) / 64);
						}
					}
				}
			}
		}
	}
}
/**
 * Paint an 8x16 swatch cell (col = 0..7, band = 0..3) in a 64x64 RGBA buffer.
 * Supports either [topHex, bottomHex] or a custom rowStops function(row 0..15) => [r, g, b].
 */
function paintSwatch(rgba, col, band, spec) {
	const x0 = col * 8;
	const y0 = band * 16;
	for (let r = 0; r < 16; r++) {
		let rgb;
		if (typeof spec === 'function') {
			rgb = spec(r);
		} else {
			const [topHex, botHex] = spec;
			rgb = lerpHex(topHex, botHex, Math.floor(r / 2) / 7);
		}
		for (let dx = 0; dx < 8; dx++) {
			const idx = ((y0 + r) * 64 + (x0 + dx)) * 4;
			rgba[idx] = rgb[0];
			rgba[idx + 1] = rgb[1];
			rgba[idx + 2] = rgb[2];
			rgba[idx + 3] = 255;
		}
	}
}

/**
 * Generate the 7 Atlantic Forest species palettes (64x64 NEAREST PNG-8) from the base Cube Pets
 * colormap. Each species overrides specific 8x16 (col, band) swatches used by its base model
 * and reserves auxiliary swatches for procedural attachments (mane, rosettes, toucan bill).
 */
function generateSpeciesPalettes(outSkinsDir) {
	const SPECIES_PALETTES = {
		// 1. Mico-leão-dourado (Leontopithecus rosalia) — base: monkey.glb
		// Golden-orange silky pelage, deeper fiery-gold mane swatch, bare dark purplish-grey face/muzzle.
		'mico-leao-dourado': [
			{ col: 2, band: 2, spec: ['#ffa828', '#d97214'] }, // Main pelage (body, legs, tail): luminous golden-orange
			{ col: 2, band: 3, spec: ['#6e565e', '#4d3b42'] }, // Bare face & inner ears: dark greyish-violet skin
			{ col: 0, band: 3, spec: ['#59434a', '#3f2e34'] }, // Muzzle tip / nose / lips: dark slate-plum
			{ col: 1, band: 2, spec: ['#fffdf5', '#d9d0c1'] }, // Eye sclera / highlight
			{ col: 7, band: 3, spec: ['#261c1a', '#140e0d'] }, // Pupils / nostrils / dark accents
			{ col: 3, band: 2, spec: ['#ff8818', '#b84a08'] } // Reserved cell for golden lion mane geometry
		],

		// 2. Bugio-ruivo (Alouatta guariba clamitans, adult male) — base: monkey.glb
		// Adult male sexual dichromatism: deep rufous-chestnut coat with copper-gold highlights and dark bare face.
		'bugio-ruivo': [
			{ col: 2, band: 2, spec: ['#c84b24', '#852910'] }, // Main pelage: rich reddish-chestnut / rufous
			{ col: 2, band: 3, spec: ['#4a3733', '#332421'] }, // Bare facial skin & ears: dark charcoal-brown
			{ col: 0, band: 3, spec: ['#3d2b28', '#261a18'] }, // Muzzle / nose / lips: deep brownish-black
			{ col: 1, band: 2, spec: ['#f7efe6', '#cbbba8'] }, // Eye sclera / highlight
			{ col: 7, band: 3, spec: ['#1f1716', '#120d0c'] }, // Pupils / dark facial contours
			{ col: 3, band: 2, spec: ['#7a220c', '#4d1305'] } // Reserved cell for prominent hyoid beard geometry
		],

		// 3. Muriqui-do-sul (Brachyteles arachnoides) — base: monkey.glb
		// Woolly pale yellowish-beige / cream-grey coat and characteristic bare matte-black face & muzzle.
		muriqui: [
			{ col: 2, band: 2, spec: ['#dfd3ba', '#b3a388'] }, // Main pelage: woolly beige-cream / pale buff-grey
			{ col: 2, band: 3, spec: ['#38363a', '#242226'] }, // Bare face & ears: matte charcoal-black
			{ col: 0, band: 3, spec: ['#2b292d', '#1b191c'] }, // Muzzle / nose: deep black (with subtle pink in B. hypoxanthus)
			{ col: 1, band: 2, spec: ['#fcfaf5', '#d4cfc4'] }, // Eye sclera / highlight
			{ col: 7, band: 3, spec: ['#18171a', '#0d0c0e'] }, // Pupils / nostrils
			{ col: 3, band: 2, spec: ['#c4b59b', '#96876f'] } // Reserved cell for prehensile tail underside / hands
		],

		// 4. Onça-pintada (Panthera onca) — base: tiger.glb
		// Golden-ochre base coat (stripe cell 7,3 also set to base coat so tiger stripes disappear; rosettes added in code).
		'onca-pintada': [
			{ col: 3, band: 3, spec: ['#f2a93b', '#cc7a1d'] }, // Main dorsal coat (body, tail, upper legs): golden-ochre
			{ col: 7, band: 3, spec: ['#f2a93b', '#cc7a1d'] }, // Tiger stripe cell matched to base coat (no tiger stripes!)
			{ col: 5, band: 3, spec: ['#26201e', '#14100f'] }, // Eyes, nose & outer rosette ring geometry: jet-black
			{ col: 2, band: 3, spec: ['#f7d399', '#dfb06b'] }, // Paws & inner ear tufts: warm buff-gold
			{ col: 1, band: 2, spec: ['#fffaf0', '#dfd5c5'] }, // Belly, chest, muzzle cheeks & eye sclera: cream-white
			{ col: 3, band: 2, spec: ['#b85d19', '#8a3f0b'] } // Inner rosette center geometry: rusty-ochre
		],

		// 5. Onça-preta / Melânica (Panthera onca melanistic variant) — base: tiger.glb
		// Uniformly dark charcoal-espresso coat (stripe cell 7,3 matched to base coat so stripes do not show), subtle contrast.
		'onca-melanica': [
			{ col: 3, band: 3, spec: ['#2b2830', '#1d1b21'] }, // Main dorsal coat: dark charcoal-espresso
			{ col: 7, band: 3, spec: ['#2b2830', '#1d1b21'] }, // Tiger stripe cell matched to base coat (uniformly dark!)
			{ col: 5, band: 3, spec: ['#121015', '#08070a'] }, // Eyes, nose & subtle ghost-rosette rings: deep velvet-black
			{ col: 2, band: 3, spec: ['#302c36', '#211e26'] }, // Paws & inner ears: subtle dark slate
			{ col: 1, band: 2, spec: ['#46414f', '#2f2b36'] }, // Muzzle cheeks, underbelly & eye sclera: muted dark pewter
			{ col: 3, band: 2, spec: ['#221f26', '#161419'] } // Inner ghost-rosette center geometry
		],

		// 6. Preguiça-de-coleira (Bradypus torquatus) — base: koala.glb
		// Endemic Atlantic Forest maned sloth: sandy-tan head/coat (rows 0..10) and black neck/shoulder mane (rows 11..15 in col=6,band=3 + cell col=5,band=3), ivory claws.
		'preguica-de-coleira': [
			{
				col: 6,
				band: 3,
				spec: (r) => {
					// Rows 0..10 (py=48..58): head, ears & face (sandy-tan); Rows 11..15 (py=59..63, z=-0.58..+0.27): black neck/shoulder mane (coleira preta)
					if (r <= 10) return lerpHex('#c9a97e', '#9c7c56', Math.floor(r / 2) / 5);
					return lerpHex('#292320', '#171311', (r - 11) / 4);
				}
			},
			{ col: 0, band: 2, spec: ['#ede0c8', '#c7b293'] }, // Long curved sloth claws (feet tips) & pale chest/ear ruff
			{ col: 7, band: 3, spec: ['#382f2b', '#211b18'] }, // Dark brownish-black facial mask, nose & eyes
			{ col: 1, band: 2, spec: ['#faf5eb', '#d4c9b8'] }, // Eye sclera / highlight
			{ col: 5, band: 3, spec: ['#241f1c', '#120f0e'] } // Dedicated cell for extra black mane / collar geometry
		],

		// 7. Tucano-de-bico-verde (Ramphastos dicolorus) — base: parrot.glb
		// Glossy black wings/back/crown/tail, golden-yellow throat/upper breast, crimson-red lower breast & undertail, pale green bill.
		'tucano-de-bico-verde': [
			{
				col: 1,
				band: 1,
				spec: (r) => {
					// Rows 0..4: head & upper back (jet black); Rows 5..8: upper breast (golden-yellow); Rows 9..15: belly & undertail (crimson-red)
					if (r <= 4) return lerpHex('#242730', '#181a22', r / 4);
					if (r <= 8) return lerpHex('#ffe033', '#f5b814', (r - 5) / 3);
					return lerpHex('#e6392e', '#b8221a', (r - 9) / 6);
				}
			},
			{ col: 1, band: 3, spec: ['#242730', '#15171e'] }, // Wings, back, crown & tail feathers: glossy jet-black
			{ col: 7, band: 2, spec: ['#22252e', '#14161c'] }, // Lower wing feathers & legs: glossy jet-black
			{ col: 7, band: 3, spec: ['#bce84c', '#86bf24'] }, // Upper beak cell: signature pale yellow-green bill
			{ col: 6, band: 3, spec: ['#a3d936', '#72ab18'] }, // Lower beak cell: pale yellow-green bill
			{
				col: 1,
				band: 2,
				spec: (r) => {
					// Rows 0..4: white eye sclera; Rows 5..15: vibrant sky-blue orbital skin ring around the eye
					if (r <= 4) return lerpHex('#ffffff', '#e8f4ff', r / 4);
					return lerpHex('#38a8f2', '#1f7ec4', (r - 5) / 10);
				}
			},
			{ col: 6, band: 2, spec: ['#bce84c', '#7cb820'] }, // Dedicated cell for enlarged green toucan bill geometry
			{ col: 4, band: 3, spec: ['#e6392e', '#b32018'] } // Dedicated cell for red breast band / undertail / bill base
		]
	};

	for (const [species, overrides] of Object.entries(SPECIES_PALETTES)) {
		const rgba = Buffer.alloc(64 * 64 * 4);
		for (let i = 3; i < rgba.length; i += 4) rgba[i] = 255;
		for (const { col, band, spec } of overrides) {
			paintSwatch(rgba, col, band, spec);
		}
		const outPath = path.join(outSkinsDir, `palette-${species}.png`);
		fs.writeFileSync(outPath, encodePng(64, 64, rgba));
	}
}

/**
 * Generate `avatar-regions.json`, `face-smile.png` (16x16), `face-neutral.png` (16x16),
 * and return a 64x64 PNG buffer of Preset 1 (Roblox-classic flat-colour avatar) to embed in `avatar.glb`.
 */
function generateAvatarRegionsAndDefaultSkin(outSkinsDir) {
	// 16x16 face decal ASCII art ('.' = transparent, 'E' = dark eye/mouth #26201e, 'W' = eye shine #e6ede9, 'B' = warm blush #d98274)
	const SMILE_16 = [
		'................',
		'................',
		'................',
		'................',
		'................',
		'....EE....EE....',
		'....EW....EW....',
		'....EE....EE....',
		'....EE....EE....',
		'..BB........BB..',
		'.....E....E.....',
		'......EEEE......',
		'................',
		'................',
		'................',
		'................'
	];

	const NEUTRAL_16 = [
		'................',
		'................',
		'................',
		'................',
		'................',
		'....EE....EE....',
		'....EW....EW....',
		'....EE....EE....',
		'....EE....EE....',
		'................',
		'......EEEE......',
		'................',
		'................',
		'................',
		'................',
		'................'
	];

	// 8x8 pixel coordinates (relative to head.front [8, 8, 8, 8] in a 64x64 texture)
	const SMILE_PIXELS_8 = [
		{ x: 2, y: 3, color: '#26201e', role: 'eye' },
		{ x: 5, y: 3, color: '#26201e', role: 'eye' },
		{ x: 2, y: 4, color: '#26201e', role: 'eye' },
		{ x: 5, y: 4, color: '#26201e', role: 'eye' },
		{ x: 3, y: 6, color: '#26201e', role: 'mouth' },
		{ x: 4, y: 6, color: '#26201e', role: 'mouth' }
	];

	const NEUTRAL_PIXELS_8 = [
		{ x: 2, y: 3, color: '#26201e', role: 'eye' },
		{ x: 5, y: 3, color: '#26201e', role: 'eye' },
		{ x: 2, y: 4, color: '#26201e', role: 'eye' },
		{ x: 5, y: 4, color: '#26201e', role: 'eye' },
		{ x: 3, y: 5, color: '#26201e', role: 'mouth' },
		{ x: 4, y: 5, color: '#26201e', role: 'mouth' }
	];

	const avatarRegions = {
		canvasSize: 64,
		description:
			'64x64 UV region map for compositing a Roblox-classic flat-colour avatar skin on avatar.glb (origin top-left, flipY=false).',
		regions: {
			head: {
				all: [0, 0, 32, 24],
				top: [8, 0, 8, 8],
				bottom: [8, 16, 8, 8],
				right: [0, 8, 8, 8],
				front: [8, 8, 8, 8],
				left: [16, 8, 8, 8],
				back: [24, 8, 8, 8],
				hair: [
					[8, 0, 8, 8],
					[24, 8, 8, 6],
					[0, 8, 8, 3],
					[0, 11, 2, 3],
					[16, 8, 8, 3],
					[22, 11, 2, 3],
					[8, 8, 8, 2]
				]
			},
			torso: {
				all: [0, 43, 28, 21],
				top: [6, 43, 8, 6],
				bottom: [6, 58, 8, 6],
				right: [0, 49, 6, 9],
				front: [6, 49, 8, 9],
				left: [14, 49, 6, 9],
				back: [20, 49, 8, 9]
			},
			armRight: {
				top: [30, 33, 4, 4],
				bottom: [34, 33, 4, 4],
				right: [30, 37, 4, 11],
				front: [34, 37, 4, 11],
				left: [38, 37, 4, 11],
				back: [42, 37, 4, 11],
				sleeve: [30, 37, 16, 5],
				forearm: [30, 42, 16, 6]
			},
			armLeft: {
				top: [48, 33, 4, 4],
				bottom: [52, 33, 4, 4],
				right: [48, 37, 4, 11],
				front: [52, 37, 4, 11],
				left: [56, 37, 4, 11],
				back: [60, 37, 4, 11],
				sleeve: [48, 37, 16, 5],
				forearm: [48, 42, 16, 6]
			},
			legRight: {
				top: [30, 50, 4, 4],
				bottom: [34, 50, 4, 4],
				right: [30, 54, 4, 10],
				front: [34, 54, 4, 10],
				left: [38, 54, 4, 10],
				back: [42, 54, 4, 10],
				pants: [30, 54, 16, 8],
				shoe: [30, 62, 16, 2]
			},
			legLeft: {
				top: [48, 50, 4, 4],
				bottom: [52, 50, 4, 4],
				right: [48, 54, 4, 10],
				front: [52, 54, 4, 10],
				left: [56, 54, 4, 10],
				back: [60, 54, 4, 10],
				pants: [48, 54, 16, 8],
				shoe: [48, 62, 16, 2]
			}
		},
		faces: {
			targetRect64: [8, 8, 8, 8],
			targetRect128: [16, 16, 16, 16],
			palette: {
				E: '#26201e',
				W: '#e4ece8',
				B: '#d98274'
			},
			smile: {
				file: 'face-smile.png',
				pixels8x8: SMILE_PIXELS_8,
				grid16x16: SMILE_16
			},
			neutral: {
				file: 'face-neutral.png',
				pixels8x8: NEUTRAL_PIXELS_8,
				grid16x16: NEUTRAL_16
			}
		},
		// 18 diverse Brazilian presets (skin tones from deep ebony/mahogany to warm bronze, indigenous terracotta, pardo & olive/light;
		// clothes strictly from ART.md ramps + non-gold accents ipeAmarelo/ipeRosa)
		presets: [
			{
				id: 'preset-01',
				name: 'Iara (Guardiã)',
				skin: '#b87b52',
				hair: '#2a201c',
				shirt: '#2d6a4f',
				pants: '#5e4330',
				shoes: '#4f5c55',
				face: 'smile'
			},
			{
				id: 'preset-02',
				name: 'Cauã',
				skin: '#8c583a',
				hair: '#241c18',
				shirt: '#4f9a6e',
				pants: '#5a4232',
				shoes: '#4f5c55',
				face: 'smile'
			},
			{
				id: 'preset-03',
				name: 'Dandara',
				skin: '#5c3b28',
				hair: '#241c18',
				shirt: '#f2c94c',
				pants: '#2d6a4f',
				shoes: '#5e4330',
				face: 'smile'
			},
			{
				id: 'preset-04',
				name: 'Bento',
				skin: '#d99e73',
				hair: '#5e4330',
				shirt: '#3e9ccf',
				pants: '#4f5c55',
				shoes: '#5a4232',
				face: 'smile'
			},
			{
				id: 'preset-05',
				name: 'Maitê',
				skin: '#e8b892',
				hair: '#8a6448',
				shirt: '#ff9fb7',
				pants: '#2f7fb0',
				shoes: '#4f5c55',
				face: 'smile'
			},
			{
				id: 'preset-06',
				name: 'Zuri',
				skin: '#6e4730',
				hair: '#241c18',
				shirt: '#74c69d',
				pants: '#4f5c55',
				shoes: '#5e4330',
				face: 'smile'
			},
			{
				id: 'preset-07',
				name: 'Raoni',
				skin: '#a66843',
				hair: '#241c18',
				shirt: '#5fa36a',
				pants: '#6b4f3a',
				shoes: '#5a4232',
				face: 'neutral'
			},
			{
				id: 'preset-08',
				name: 'Helena',
				skin: '#f0c8a8',
				hair: '#a8805c',
				shirt: '#2f7fb0',
				pants: '#6f7d74',
				shoes: '#4f5c55',
				face: 'smile'
			},
			{
				id: 'preset-09',
				name: 'Gael',
				skin: '#c98c63',
				hair: '#3b281e',
				shirt: '#3f7d4f',
				pants: '#8a6448',
				shoes: '#5e4330',
				face: 'smile'
			},
			{
				id: 'preset-10',
				name: 'Aiyra',
				skin: '#995f3d',
				hair: '#241c18',
				shirt: '#f2c94c',
				pants: '#5e4330',
				shoes: '#4f5c55',
				face: 'smile'
			},
			{
				id: 'preset-11',
				name: 'Lucas',
				skin: '#e2ae86',
				hair: '#5a4232',
				shirt: '#73cbf0',
				pants: '#2f5e3c',
				shoes: '#5a4232',
				face: 'neutral'
			},
			{
				id: 'preset-12',
				name: 'Tainá',
				skin: '#7d5035',
				hair: '#241c18',
				shirt: '#86bf7c',
				pants: '#5a4232',
				shoes: '#4f5c55',
				face: 'smile'
			},
			{
				id: 'preset-13',
				name: 'Ravi',
				skin: '#b0744d',
				hair: '#2a201c',
				shirt: '#a8805c',
				pants: '#2d6a4f',
				shoes: '#5e4330',
				face: 'smile'
			},
			{
				id: 'preset-14',
				name: 'Clara',
				skin: '#ecc2a0',
				hair: '#c9a27a',
				shirt: '#4f9a6e',
				pants: '#2f7fb0',
				shoes: '#4f5c55',
				face: 'smile'
			},
			{
				id: 'preset-15',
				name: 'Kauan',
				skin: '#63402b',
				hair: '#241c18',
				shirt: '#3e9ccf',
				pants: '#6b4f3a',
				shoes: '#4f5c55',
				face: 'neutral'
			},
			{
				id: 'preset-16',
				name: 'Lia',
				skin: '#d1946b',
				hair: '#5e4330',
				shirt: '#ff9fb7',
				pants: '#4f5c55',
				shoes: '#5a4232',
				face: 'smile'
			},
			{
				id: 'preset-17',
				name: 'Caio',
				skin: '#825439',
				hair: '#2a201c',
				shirt: '#5fa36a',
				pants: '#4f5c55',
				shoes: '#5e4330',
				face: 'smile'
			},
			{
				id: 'preset-18',
				name: 'Jaci',
				skin: '#be8158',
				hair: '#3b281e',
				shirt: '#2d6a4f',
				pants: '#8f6e52',
				shoes: '#5a4232',
				face: 'neutral'
			}
		]
	};

	fs.writeFileSync(
		path.join(outSkinsDir, 'avatar-regions.json'),
		`${JSON.stringify(avatarRegions, null, '\t')}\n`,
		'utf8'
	);

	// Write 16x16 PNGs for face-smile.png and face-neutral.png (using #1e4d36 background for unused pixels or skin-neutral preview)
	for (const [name, grid] of [
		['face-smile.png', SMILE_16],
		['face-neutral.png', NEUTRAL_16]
	]) {
		const rgba = Buffer.alloc(16 * 16 * 4);
		const bg = parseHex('#d99e73');
		for (let y = 0; y < 16; y++) {
			for (let x = 0; x < 16; x++) {
				const ch = grid[y][x];
				const rgb =
					ch === 'E'
						? parseHex('#26201e')
						: ch === 'W'
							? parseHex('#e4ece8')
							: ch === 'B'
								? parseHex('#d98274')
								: bg;
				const p = (y * 16 + x) * 4;
				rgba[p] = rgb[0];
				rgba[p + 1] = rgb[1];
				rgba[p + 2] = rgb[2];
				rgba[p + 3] = 255;
			}
		}
		fs.writeFileSync(path.join(outSkinsDir, name), encodePng(16, 16, rgba));
	}

	// Composite Preset 1 into a 64x64 PNG buffer for avatar.glb's default embedded texture
	return compositeAvatarPresetPng(avatarRegions, avatarRegions.presets[0]);
}

function fillRect64(rgba, [x0, y0, w, h], hex) {
	const [r, g, b] = parseHex(hex);
	for (let y = y0; y < Math.min(64, y0 + h); y++) {
		for (let x = x0; x < Math.min(64, x0 + w); x++) {
			const p = (y * 64 + x) * 4;
			rgba[p] = r;
			rgba[p + 1] = g;
			rgba[p + 2] = b;
			rgba[p + 3] = 255;
		}
	}
}

function compositeAvatarPresetPng(regionsSpec, preset) {
	const rgba = Buffer.alloc(64 * 64 * 4);
	// Fill background with dark leaf shadow #1e4d36
	fillRect64(rgba, [0, 0, 64, 64], '#1e4d36');

	const R = regionsSpec.regions;
	// 1. Skin
	fillRect64(rgba, R.head.all, preset.skin);
	fillRect64(rgba, R.armRight.bottom, preset.skin);
	fillRect64(rgba, R.armRight.forearm, preset.skin);
	fillRect64(rgba, R.armLeft.bottom, preset.skin);
	fillRect64(rgba, R.armLeft.forearm, preset.skin);

	// 2. Hair
	for (const rect of R.head.hair) {
		fillRect64(rgba, rect, preset.hair);
	}

	// 3. Shirt
	fillRect64(rgba, R.torso.all, preset.shirt);
	fillRect64(rgba, R.armRight.top, preset.shirt);
	fillRect64(rgba, R.armRight.sleeve, preset.shirt);
	fillRect64(rgba, R.armLeft.top, preset.shirt);
	fillRect64(rgba, R.armLeft.sleeve, preset.shirt);

	// 4. Pants & Shoes
	fillRect64(rgba, R.legRight.top, preset.pants);
	fillRect64(rgba, R.legRight.pants, preset.pants);
	fillRect64(rgba, R.legRight.bottom, preset.shoes);
	fillRect64(rgba, R.legRight.shoe, preset.shoes);
	fillRect64(rgba, R.legLeft.top, preset.pants);
	fillRect64(rgba, R.legLeft.pants, preset.pants);
	fillRect64(rgba, R.legLeft.bottom, preset.shoes);
	fillRect64(rgba, R.legLeft.shoe, preset.shoes);

	// 5. Face decal on head.front [8, 8, 8, 8]
	const faceSpec = regionsSpec.faces[preset.face] || regionsSpec.faces.smile;
	const [fx0, fy0] = regionsSpec.faces.targetRect64;
	for (const px of faceSpec.pixels8x8) {
		fillRect64(rgba, [fx0 + px.x, fy0 + px.y, 1, 1], px.color);
	}
	return encodePng(64, 64, rgba);
}

function main() {
	verifyLicenses();
	fs.mkdirSync(OUT_MODELS, { recursive: true });
	fs.mkdirSync(OUT_SKINS, { recursive: true });

	const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'guardioes-assets-'));
	try {
		// 1. Skins: 18 player skins (skin-a.webp .. skin-r.webp) at 128x128 NEAREST lossless WebP (ART.md §6)
		const blockyTexDir = path.join(RAW_ROOT, 'blocky-characters', 'Models', 'GLB format', 'Textures');
		for (let code = 97; code <= 114; code++) {
			const letter = String.fromCharCode(code);
			const srcPng = path.join(blockyTexDir, `texture-${letter}.png`);
			const dstWebp = path.join(OUT_SKINS, `skin-${letter}.webp`);
			resizeNearestWebp(srcPng, dstWebp, 128);
		}

		// Base 64x64 NEAREST palettes for Cube Pets + 7 Atlantic Forest species recolor palettes
		const petsPalPath = path.join(OUT_SKINS, 'palette-pets.png');
		resizeNearestPng(
			path.join(RAW_ROOT, 'cube-pets', 'Models', 'GLB format', 'Textures', 'colormap.png'),
			petsPalPath,
			64
		);
		generateSpeciesPalettes(OUT_SKINS);
		const defaultAvatarSkinBytes = generateAvatarRegionsAndDefaultSkin(OUT_SKINS);
		// Enforce ART.md lightness bounds [0.12, 0.90] on all species palettes and 128x128 skins
		execFileSync('python3', [path.join(__dirname, 'blender', 'recolor.py')], { stdio: 'inherit' });
		const boundedPetsPalBytes = fs.readFileSync(petsPalPath);

		// 2. Avatar: character-a.glb -> strip animations, normalize head scale to [1,1,1], keep 6 named nodes
		{
			const rawAvatar = path.join(RAW_ROOT, 'blocky-characters', 'Models', 'GLB format', 'character-a.glb');
			const { json, bin } = readGlb(rawAvatar);
			delete json.animations;
			normalizeAvatarHeadScale(json, bin);
			const nextBin = cleanMaterialsAndAttributes(json, { replaceImages: [defaultAvatarSkinBytes] }, bin);
			const step1 = path.join(workDir, 'avatar-step1.glb');
			const step2 = path.join(workDir, 'avatar-step2.glb');
			writeGlb(step1, json, nextBin);
			runGltfTransform(['prune', step1, step2]);
			runGltfpack(step2, path.join(OUT_MODELS, 'avatar.glb'), ['-vpf']);
		}

		// 3. Cube Pets: monkey, tiger, parrot, koala (keep node hierarchy + 5 core clips + 64x64 NEAREST palette)
		for (const pet of PET_NAMES) {
			const rawPet = path.join(RAW_ROOT, 'cube-pets', 'Models', 'GLB format', `animal-${pet}.glb`);
			const { json, bin } = readGlb(rawPet);
			if (json.animations) {
				json.animations = json.animations.filter((a) => PET_KEEP_ANIMS.has(a.name));
			}
			remapPetUvsForSpecies(pet, json, bin);
			const nextBin = cleanMaterialsAndAttributes(json, { replaceImages: [boundedPetsPalBytes] }, bin);
			const step1 = path.join(workDir, `${pet}-step1.glb`);
			const step2 = path.join(workDir, `${pet}-step2.glb`);
			writeGlb(step1, json, nextBin);
			runGltfTransform(['prune', step1, step2]);
			runGltfpack(step2, path.join(OUT_MODELS, `${pet}.glb`), ['-vpf']);
		}

		// 4. Flora: merge 18 Nature Kit models -> prune unused TEXCOORD_0 -> palette() -> snap to ART ramps -> gltfpack
		{
			const items = FLORA_MODELS.map((name) => {
				const rawPath = path.join(RAW_ROOT, 'nature-kit', 'Models', 'GLTF format', `${name}.glb`);
				if (name === 'tree_detailed') {
					const copyPath = path.join(workDir, 'tree_detailed-copy.glb');
					const simpPath = path.join(workDir, 'tree_detailed-simp.glb');
					runGltfTransform(['copy', rawPath, copyPath]);
					execFileSync(
						'pnpm',
						['dlx', 'gltfpack@1.3.0', '-i', copyPath, '-o', simpPath, '-noq', '-kn', '-si', '0.94', '-sp'],
						{ stdio: 'pipe' }
					);
					return { name, path: simpPath };
				}
				return { name, path: rawPath };
			});
			const mergedPath = path.join(workDir, 'flora-merged.glb');
			const prunedPath = path.join(workDir, 'flora-pruned.glb');
			const palPath = path.join(workDir, 'flora-pal.glb');
			mergeStaticGlbs(items, mergedPath);
			runGltfTransform(['prune', mergedPath, prunedPath]);
			runGltfTransform(['palette', prunedPath, palPath, '--min', '2']);
			// Snap the generated palette PNG to exact ART.md ramp colours and set NEAREST sampler
			const palGlb = readGlb(palPath);
			const imgBv = palGlb.json.bufferViews[palGlb.json.images[0].bufferView];
			const rawPalPng = palGlb.bin.subarray(
				imgBv.byteOffset || 0,
				(imgBv.byteOffset || 0) + imgBv.byteLength
			);
			const snappedPalPng = snapPalettePngToArtRamps(rawPalPng, workDir);
			const nextBin = cleanMaterialsAndAttributes(
				palGlb.json,
				{ replaceImages: [snappedPalPng] },
				palGlb.bin
			);
			writeGlb(palPath, palGlb.json, nextBin);
			execFileSync(
				'/usr/sbin/blender',
				[
					'--background',
					'--python',
					path.join(__dirname, 'blender', 'bake.py'),
					'--',
					palPath,
					path.join(OUT_MODELS, 'kit-flora.glb')
				],
				{ stdio: 'inherit' }
			);
		}

		// 5. Props: merge Platformer 4.1 + Food 2.0 + Holiday 2.0 with ART-remapped 64x64 NEAREST palettes -> bake -> gltfpack
		{
			const palCache = new Map();
			const items = PROP_MODELS.map((entry) => {
				const rawModelPath = path.join(RAW_ROOT, entry.pack, entry.dir, `${entry.name}.glb`);
				const texPath = path.resolve(path.dirname(rawModelPath), entry.tex);
				let modelPath = rawModelPath;
				if (entry.simplifyRatio) {
					modelPath = path.join(workDir, `${entry.name}-simp.glb`);
					execFileSync(
						'pnpm',
						[
							'dlx',
							'gltfpack@1.3.0',
							'-i',
							rawModelPath,
							'-o',
							modelPath,
							'-noq',
							'-kn',
							'-si',
							String(entry.simplifyRatio),
							'-sp',
							'-sa'
						],
						{ stdio: 'pipe' }
					);
				}
				let paletteBytes = palCache.get(entry.pack);
				if (!paletteBytes) {
					paletteBytes = buildRecoloredKitPalette(entry.pack, texPath);
					palCache.set(entry.pack, paletteBytes);
				}
				return {
					name: entry.name,
					path: modelPath,
					paletteKey: `palette-${entry.pack}`,
					paletteBytes
				};
			});
			const mergedPath = path.join(workDir, 'props-merged.glb');
			const prunedPath = path.join(workDir, 'props-pruned.glb');
			mergeStaticGlbs(items, mergedPath);
			runGltfTransform(['prune', mergedPath, prunedPath]);
			execFileSync(
				'/usr/sbin/blender',
				[
					'--background',
					'--python',
					path.join(__dirname, 'blender', 'bake.py'),
					'--',
					prunedPath,
					path.join(OUT_MODELS, 'kit-props.glb')
				],
				{ stdio: 'inherit' }
			);
		}

		// 6. Custom raw GLBs (if any exist in ~/.cache/agents/2026-10-25-trilha-secreta/custom-raw/)
		const customRawDir =
			process.env.CUSTOM_RAW_DIR ??
			path.join(os.homedir(), '.cache', 'agents', '2026-10-25-trilha-secreta', 'custom-raw');
		if (fs.existsSync(customRawDir) && fs.readdirSync(customRawDir).some((f) => f.endsWith('.glb'))) {
			execFileSync(
				'/usr/sbin/blender',
				['--background', '--python', path.join(__dirname, 'blender', 'bake.py'), '--', '--custom-only'],
				{ stdio: 'inherit' }
			);
		}
	} finally {
		fs.rmSync(workDir, { recursive: true, force: true });
	}

	// Print summary BOM
	const allFiles = [
		...fs
			.readdirSync(OUT_MODELS)
			.sort()
			.map((f) => path.join(OUT_MODELS, f)),
		...fs
			.readdirSync(OUT_SKINS)
			.sort()
			.map((f) => path.join(OUT_SKINS, f))
	];
	let totalRaw = 0;
	let totalGz = 0;
	let totalBr = 0;
	for (const f of allFiles) {
		const bytes = fs.readFileSync(f);
		const gz = gzipSync(bytes, { level: 9 });
		const br = brotliCompressSync(bytes, {
			params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 11 }
		});
		totalRaw += bytes.length;
		totalGz += gz.length;
		totalBr += br.length;
		console.log(
			`${path.relative(GAME_ROOT, f).padEnd(34)} raw=${String(bytes.length).padStart(6)}B  gz=${String(gz.length).padStart(6)}B  br=${String(br.length).padStart(6)}B`
		);
	}
	console.log(
		`${'TOTAL'.padEnd(34)} raw=${String(totalRaw).padStart(6)}B  gz=${String(totalGz).padStart(6)}B  br=${String(totalBr).padStart(6)}B`
	);
}

main();
