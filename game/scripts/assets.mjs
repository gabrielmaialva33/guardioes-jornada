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
import { brotliCompressSync, constants as zlibConstants, deflateSync, gzipSync } from 'node:zlib';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GAME_ROOT = path.resolve(__dirname, '..');
const OUT_MODELS = path.join(GAME_ROOT, 'src', 'assets', 'models');
const OUT_SKINS = path.join(GAME_ROOT, 'src', 'assets', 'skins');
const RAW_ROOT =
	process.env.KENNEY_RAW_DIR ??
	path.join(os.homedir(), '.cache', 'agents', '2026-10-25-trilha-secreta', 'kenney-raw');

const PACKS = [
	'blocky-characters',
	'cube-pets',
	'nature-kit',
	'platformer-kit',
	'food-kit',
	'holiday-kit'
];

const FLORA_MODELS = [
	'tree_oak',
	'tree_detailed',
	'tree_plateau',
	'tree_fat',
	'tree_palmTall',
	'tree_palmDetailedTall',
	'tree_palmShort',
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

const PROP_MODELS = [
	{ pack: 'platformer-kit', dir: 'Models/GLB format', name: 'platform', tex: '../Textures/variation-a.png' },
	{ pack: 'platformer-kit', dir: 'Models/GLB format', name: 'platform-ramp', tex: '../Textures/variation-a.png' },
	{ pack: 'platformer-kit', dir: 'Models/GLB format', name: 'platform-fortified', tex: '../Textures/variation-a.png' },
	{ pack: 'platformer-kit', dir: 'Models/GLB format', name: 'block-grass', tex: '../Textures/variation-a.png' },
	{ pack: 'platformer-kit', dir: 'Models/GLB format', name: 'block-grass-large', tex: '../Textures/variation-a.png' },
	{ pack: 'platformer-kit', dir: 'Models/GLB format', name: 'flag', tex: '../Textures/variation-a.png' },
	{ pack: 'platformer-kit', dir: 'Models/GLB format', name: 'coin-gold', tex: '../Textures/variation-a.png' },
	{ pack: 'food-kit', dir: 'Models/GLB format', name: 'soda-bottle', tex: 'Textures/colormap.png' },
	{ pack: 'food-kit', dir: 'Models/GLB format', name: 'soda-can', tex: 'Textures/colormap.png' },
	{ pack: 'food-kit', dir: 'Models/GLB format', name: 'soda-can-crushed', tex: 'Textures/colormap.png' },
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
	if (json. materials) {
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
	if (json. meshes) {
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

/** Bake non-unit scale on the avatar's 'head' node ([0.1, 0.1, 0.1]) into its mesh vertices so all 6 rigid nodes have scale=[1,1,1]. */
function normalizeAvatarHeadScale(json, bin) {
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
				const colorKey = JSON.stringify(mat.pbrMetallicRoughness?.baseColorFactor || [1, 1, 1, 1]);
				let sharedMatIdx = matIndexByKey.get(colorKey);
				if (sharedMatIdx === undefined) {
					sharedMatIdx = merged.materials.length;
					merged.materials.push({
						name: mat.name || `color-${sharedMatIdx}`,
						pbrMetallicRoughness: {
							baseColorFactor: mat.pbrMetallicRoughness?.baseColorFactor || [1, 1, 1, 1],
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

/** Parse '#rrggbb' into [r, g, b]. */
function parseHex(hex) {
	const v = parseInt(hex.slice(1), 16);
	return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
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
function generateSpeciesPalettes(basePetPngPath, outSkinsDir) {
	const baseRgba = Buffer.from(
		execFileSync('magick', [basePetPngPath, '-depth', '8', 'rgba:-'])
	);

	const SPECIES_PALETTES = {
		// 1. Mico-leão-dourado (Leontopithecus rosalia) — base: monkey.glb
		// Golden-orange silky pelage, deeper fiery-gold mane swatch, bare dark purplish-grey face/muzzle.
		'mico-leao-dourado': [
			{ col: 2, band: 2, spec: ['#ffa828', '#d97214'] }, // Main pelage (body, legs, tail): luminous golden-orange
			{ col: 2, band: 3, spec: ['#6e565e', '#4d3b42'] }, // Bare face & inner ears: dark greyish-violet skin
			{ col: 0, band: 3, spec: ['#59434a', '#3f2e34'] }, // Muzzle tip / nose / lips: dark slate-plum
			{ col: 1, band: 2, spec: ['#fffdf5', '#d9d0c1'] }, // Eye sclera / highlight
			{ col: 7, band: 3, spec: ['#261c1a', '#140e0d'] }, // Pupils / nostrils / dark accents
			{ col: 3, band: 2, spec: ['#ff8818', '#b84a08'] }  // Reserved cell for golden lion mane geometry
		],

		// 2. Bugio-ruivo (Alouatta guariba clamitans, adult male) — base: monkey.glb
		// Adult male sexual dichromatism: deep rufous-chestnut coat with copper-gold highlights and dark bare face.
		'bugio-ruivo': [
			{ col: 2, band: 2, spec: ['#c84b24', '#852910'] }, // Main pelage: rich reddish-chestnut / rufous
			{ col: 2, band: 3, spec: ['#4a3733', '#332421'] }, // Bare facial skin & ears: dark charcoal-brown
			{ col: 0, band: 3, spec: ['#3d2b28', '#261a18'] }, // Muzzle / nose / lips: deep brownish-black
			{ col: 1, band: 2, spec: ['#f7efe6', '#cbbba8'] }, // Eye sclera / highlight
			{ col: 7, band: 3, spec: ['#1f1716', '#120d0c'] }, // Pupils / dark facial contours
			{ col: 3, band: 2, spec: ['#7a220c', '#4d1305'] }  // Reserved cell for prominent hyoid beard geometry
		],

		// 3. Muriqui-do-sul (Brachyteles arachnoides) — base: monkey.glb
		// Woolly pale yellowish-beige / cream-grey coat and characteristic bare matte-black face & muzzle.
		muriqui: [
			{ col: 2, band: 2, spec: ['#dfd3ba', '#b3a388'] }, // Main pelage: woolly beige-cream / pale buff-grey
			{ col: 2, band: 3, spec: ['#38363a', '#242226'] }, // Bare face & ears: matte charcoal-black
			{ col: 0, band: 3, spec: ['#2b292d', '#1b191c'] }, // Muzzle / nose: deep black (with subtle pink in B. hypoxanthus)
			{ col: 1, band: 2, spec: ['#fcfaf5', '#d4cfc4'] }, // Eye sclera / highlight
			{ col: 7, band: 3, spec: ['#18171a', '#0d0c0e'] }, // Pupils / nostrils
			{ col: 3, band: 2, spec: ['#c4b59b', '#96876f'] }  // Reserved cell for prehensile tail underside / hands
		],

		// 4. Onça-pintada (Panthera onca) — base: tiger.glb
		// Warm golden-ochre coat, cream-white belly/throat/muzzle, jet-black spots/rosettes + rusty-brown rosette center cell.
		'onca-pintada': [
			{ col: 3, band: 3, spec: ['#f2a93b', '#cc7a1d'] }, // Main dorsal coat (body, tail, upper legs): golden-ochre
			{ col: 7, band: 3, spec: ['#292321', '#141110'] }, // Built-in dark markings, ears, nose & outer rosette rings: jet black
			{ col: 2, band: 3, spec: ['#f7d399', '#dfb06b'] }, // Paws & inner ear tufts: warm buff-gold
			{ col: 1, band: 2, spec: ['#fffaf0', '#dfd5c5'] }, // Belly, chest, muzzle cheeks & tail underside: cream-white
			{ col: 3, band: 2, spec: ['#b85d19', '#8a3f0b'] }  // Reserved cell for inner rosette centers (rusty-ochre)
		],

		// 5. Onça-preta / Melânica (Panthera onca melanistic variant) — base: tiger.glb
		// Deep charcoal-espresso coat with velvet-black ghost markings/rosettes, golden-amber eyes, and dark slate belly/paws.
		'onca-melanica': [
			{ col: 3, band: 3, spec: ['#322e36', '#211e24'] }, // Main dorsal coat: dark charcoal-espresso
			{ col: 7, band: 3, spec: ['#141217', '#09080b'] }, // Ghost markings / outer rosette rings: deep velvet-black
			{ col: 2, band: 3, spec: ['#3d3842', '#2b272f'] }, // Paws & inner ears: muted dark slate
			{
				col: 1,
				band: 2,
				spec: (r) => {
					// Rows 0..3: glowing golden-amber jaguar eyes; Rows 4..15: dark slate muzzle & underbelly
					if (r <= 3) return lerpHex('#ffcf40', '#e09f1f', r / 3);
					return lerpHex('#48434f', '#2f2b36', (r - 4) / 11);
				}
			},
			{ col: 3, band: 2, spec: ['#241f26', '#171419'] }  // Reserved cell for inner ghost-rosette centers
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
			{ col: 5, band: 3, spec: ['#241f1c', '#120f0e'] }  // Dedicated cell for extra black mane / collar geometry
		],

		// 7. Tucano-de-bico-verde (Ramphastos dicolorus) — base: parrot.glb
		// Glossy black plumage, golden-yellow throat/upper breast, crimson-red belly & undertail, pale yellow-green bill, sky-blue lower eye ring.
		'tucano-de-bico-verde': [
			{
				col: 1,
				band: 1,
				spec: (r) => {
					// Rows 0..4: head & upper back (jet black); Rows 5..8: upper breast (golden-yellow); Rows 9..15: belly & undertail (crimson-red)
					if (r <= 4) return lerpHex('#282b34', '#1c1e26', r / 4);
					if (r <= 8) return lerpHex('#ffe033', '#f2bd18', (r - 5) / 3);
					return lerpHex('#e6392e', '#b8221a', (r - 9) / 6);
				}
			},
			{ col: 1, band: 3, spec: ['#262932', '#171920'] }, // Wings & tail feathers: glossy jet-black
			{ col: 7, band: 3, spec: ['#b5e645', '#84bd24'] }, // Upper beak: signature yellow-green bill
			{ col: 6, band: 3, spec: ['#99cf30', '#6da118'] }, // Lower beak: yellow-green bill
			{ col: 7, band: 2, spec: ['#5a6878', '#3e4956'] }, // Legs/feet (blue-grey tarsus of Ramphastos) & wing edge
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
			{ col: 4, band: 3, spec: ['#e6392e', '#b32018'] }  // Dedicated cell for red breast band / undertail / bill base
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

function main() {
	verifyLicenses();
	fs.mkdirSync(OUT_MODELS, { recursive: true });
	fs.mkdirSync(OUT_SKINS, { recursive: true });

	const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'guardioes-assets-'));
	try {
		// 1. Skins: 18 player skins (skin-a.webp .. skin-r.webp) at 256x256 NEAREST lossless WebP
		const blockyTexDir = path.join(RAW_ROOT, 'blocky-characters', 'Models', 'GLB format', 'Textures');
		for (let code = 97; code <= 114; code++) {
			const letter = String.fromCharCode(code);
			const srcPng = path.join(blockyTexDir, `texture-${letter}.png`);
			const dstWebp = path.join(OUT_SKINS, `skin-${letter}.webp`);
			resizeNearestWebp(srcPng, dstWebp, 256);
		}

		// Base 64x64 NEAREST palettes for Cube Pets + 7 Atlantic Forest species recolor palettes
		const petsPalPath = path.join(OUT_SKINS, 'palette-pets.png');
		const petsPalBytes = resizeNearestPng(
			path.join(RAW_ROOT, 'cube-pets', 'Models', 'GLB format', 'Textures', 'colormap.png'),
			petsPalPath,
			64
		);
		generateSpeciesPalettes(petsPalPath, OUT_SKINS);
		const skinAPlaceholderBytes = resizeNearestPng(
			path.join(blockyTexDir, 'texture-a.png'),
			path.join(workDir, 'skin-a-4.png'),
			4
		);

		// 2. Avatar: character-a.glb -> strip animations, normalize head scale to [1,1,1], keep 6 named nodes
		{
			const rawAvatar = path.join(RAW_ROOT, 'blocky-characters', 'Models', 'GLB format', 'character-a.glb');
			const { json, bin } = readGlb(rawAvatar);
			delete json.animations;
			normalizeAvatarHeadScale(json, bin);
			const nextBin = cleanMaterialsAndAttributes(
				json,
				{ replaceImages: [skinAPlaceholderBytes] },
				bin
			);
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
			const nextBin = cleanMaterialsAndAttributes(json, { replaceImages: [petsPalBytes] }, bin);
			const step1 = path.join(workDir, `${pet}-step1.glb`);
			const step2 = path.join(workDir, `${pet}-step2.glb`);
			writeGlb(step1, json, nextBin);
			runGltfTransform(['prune', step1, step2]);
			runGltfpack(step2, path.join(OUT_MODELS, `${pet}.glb`), ['-vpf']);
		}

		// 4. Flora: merge 18 Nature Kit models -> prune unused TEXCOORD_0 -> palette() -> NEAREST sampler -> gltfpack -cc -kn
		{
			const items = FLORA_MODELS.map((name) => ({
				name,
				path: path.join(RAW_ROOT, 'nature-kit', 'Models', 'GLTF format', `${name}.glb`)
			}));
			const mergedPath = path.join(workDir, 'flora-merged.glb');
			const prunedPath = path.join(workDir, 'flora-pruned.glb');
			const palPath = path.join(workDir, 'flora-pal.glb');
			mergeStaticGlbs(items, mergedPath);
			runGltfTransform(['prune', mergedPath, prunedPath]);
			runGltfTransform(['palette', prunedPath, palPath, '--min', '2']);
			// Ensure NEAREST sampler on the generated palette texture
			const palGlb = readGlb(palPath);
			const nextBin = cleanMaterialsAndAttributes(palGlb.json, {}, palGlb.bin);
			writeGlb(palPath, palGlb.json, nextBin);
			runGltfpack(palPath, path.join(OUT_MODELS, 'kit-flora.glb'));
		}

		// 5. Props: merge Platformer 4.1 + Food 2.0 + Holiday 2.0 with 64x64 NEAREST palettes -> gltfpack -cc -kn
		{
			const palCache = new Map();
			const items = PROP_MODELS.map((entry) => {
				const modelPath = path.join(RAW_ROOT, entry.pack, entry.dir, `${entry.name}.glb`);
				const texPath = path.resolve(path.dirname(modelPath), entry.tex);
				let paletteBytes = palCache.get(entry.pack);
				if (!paletteBytes) {
					paletteBytes = resizeNearestPng(
						texPath,
						path.join(workDir, `pal-${entry.pack}.png`),
						64
					);
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
			runGltfpack(prunedPath, path.join(OUT_MODELS, 'kit-props.glb'));
		}
	} finally {
		fs.rmSync(workDir, { recursive: true, force: true });
	}

	// Print summary BOM
	const allFiles = [
		...fs.readdirSync(OUT_MODELS).sort().map((f) => path.join(OUT_MODELS, f)),
		...fs.readdirSync(OUT_SKINS).sort().map((f) => path.join(OUT_SKINS, f))
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
