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
import { brotliCompressSync, constants as zlibConstants, gzipSync } from 'node:zlib';

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
		['dlx', 'gltfpack@1.3.0', '-i', inFile, '-o', outFile, '-cc', '-kn', ...extraFlags],
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

		// Base 64x64 NEAREST palettes for Cube Pets, Platformer, Food, Holiday
		const petsPalPath = path.join(OUT_SKINS, 'palette-pets.png');
		const petsPalBytes = resizeNearestPng(
			path.join(RAW_ROOT, 'cube-pets', 'Models', 'GLB format', 'Textures', 'colormap.png'),
			petsPalPath,
			64
		);
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
