#!/usr/bin/env node
/**
 * Crown measures of the staging-v2 trees, the numbers behind src/life/homes.ts CROWNS (copied by hand):
 * the lod0 node's foliage, told apart from the trunk by its UVs (the leaf and frond cells of the 512 px
 * trees atlas, rows above 336 px). `base` is the foliage's 5th height percentile, `top` the tree's height,
 * `radius` the 95th percentile of the foliage's distance from the trunk axis. Model units.
 *
 *   node game/scripts/life-crowns.mjs
 *
 * Environment:
 *   TREES_DIR  folder with tree-<species>.glb (default: game/src/assets/models/trees/). Raw or
 *              meshopt-compressed GLBs both work: they go through three's GLTFLoader + MeshoptDecoder.
 *   SPECIES    comma-separated species (default: the seven staging-v2 trees).
 *
 * CROWNS was measured on the raw (unpacked) staging-v2 GLBs. The packed GLBs in the repo weld vertices,
 * so vertex-percentile figures move a little (26/10/2026: juçara p5 7.55 → 7.78, jequitibá p95 7.08 →
 * 7.16); heights and maxima are unchanged. Point TREES_DIR at the raw GLBs to reproduce CROWNS exactly.
 *
 * Araucária, embaúba and xaxim keep their custom-*.glb measures; this script does not cover them.
 * See game/docs/life.md.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Matrix4, Vector3 } from 'three';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const dir = process.env.TREES_DIR ?? fileURLToPath(new URL('../src/assets/models/trees/', import.meta.url));
const species = (
	process.env.SPECIES ??
	'ipe-amarelo,ipe-rosa,pau-brasil,jequitiba-rosa,jeriva,palmeira-jucara,mangue-vermelho'
).split(',');

/** Atlas rows (px from the top of the 512 px trees atlas) below which a vertex is foliage. */
const ATLAS_SIZE = 512;
const FOLIAGE_ROWS = 336;

/** Drops images, textures and texture references from the JSON chunk: Node has no image decoder. */
function stripTextures(buffer) {
	const jsonLength = buffer.readUInt32LE(12);
	const json = JSON.parse(buffer.subarray(20, 20 + jsonLength).toString('utf8'));
	delete json.images;
	delete json.textures;
	delete json.samplers;
	for (const m of json.materials ?? []) {
		if (m.pbrMetallicRoughness) {
			delete m.pbrMetallicRoughness.baseColorTexture;
			delete m.pbrMetallicRoughness.metallicRoughnessTexture;
		}
		delete m.normalTexture;
		delete m.occlusionTexture;
		delete m.emissiveTexture;
	}
	let text = Buffer.from(JSON.stringify(json), 'utf8');
	text = Buffer.concat([text, Buffer.alloc((4 - (text.length % 4)) % 4, 0x20)]);
	const rest = buffer.subarray(20 + jsonLength);
	const header = Buffer.alloc(20);
	header.writeUInt32LE(0x46546c67, 0);
	header.writeUInt32LE(2, 4);
	header.writeUInt32LE(20 + text.length + rest.length, 8);
	header.writeUInt32LE(text.length, 12);
	header.writeUInt32LE(0x4e4f534a, 16);
	const out = Buffer.concat([header, text, rest]);
	return out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength);
}

const pct = (a, p) => {
	const s = Float64Array.from(a).sort();
	return s[Math.min(s.length - 1, Math.max(0, Math.floor(s.length * p)))];
};

await MeshoptDecoder.ready;
const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);
const parse = (data) => new Promise((resolve, reject) => loader.parse(data, '', resolve, reject));

for (const name of species) {
	const gltf = await parse(stripTextures(readFileSync(join(dir, `tree-${name}.glb`))));
	gltf.scene.updateMatrixWorld(true);
	const lod0 = gltf.scene.getObjectByProperty('name', `tree-${name}-lod0`);
	if (!lod0) throw new Error(`tree-${name}.glb has no tree-${name}-lod0 node`);
	// The lod0 node's space, its own transform included (identity in the raw GLBs, dequantization when packed).
	const toNode = new Matrix4().copy(lod0.parent?.matrixWorld ?? new Matrix4()).invert();
	const fy = [];
	const fr = [];
	const ty = [];
	let maxY = Number.NEGATIVE_INFINITY;
	let minY = Number.POSITIVE_INFINITY;
	const v = new Vector3();
	const m = new Matrix4();
	lod0.traverse((o) => {
		if (!o.isMesh) return;
		const pos = o.geometry.attributes.position;
		const uv = o.geometry.attributes.uv;
		m.multiplyMatrices(toNode, o.matrixWorld);
		for (let k = 0; k < pos.count; k++) {
			v.fromBufferAttribute(pos, k).applyMatrix4(m);
			maxY = Math.max(maxY, v.y);
			minY = Math.min(minY, v.y);
			if (uv.getY(k) * ATLAS_SIZE < FOLIAGE_ROWS) {
				fy.push(v.y);
				fr.push(Math.hypot(v.x, v.z));
			} else ty.push(v.y);
		}
	});
	// Radius per height band of the foliage, to see the crown's shape.
	const bands = {};
	for (let k = 0; k < fy.length; k++) {
		const band = Math.floor(fy[k]);
		bands[band] = Math.max(bands[band] ?? 0, fr[k]);
	}
	console.log(
		`${name.padEnd(16)} height ${maxY.toFixed(2)} (min ${minY.toFixed(2)})  foliage y min ${Math.min(...fy).toFixed(2)} ` +
			`p5 ${pct(fy, 0.05).toFixed(2)} p10 ${pct(fy, 0.1).toFixed(2)} max ${Math.max(...fy).toFixed(2)}  ` +
			`r max ${Math.max(...fr).toFixed(2)} p95 ${pct(fr, 0.95).toFixed(2)}  verts ${fy.length}/${ty.length}`
	);
	console.log(
		'   bands',
		Object.entries(bands)
			.sort((a, b) => a[0] - b[0])
			.map(([k, r]) => `${k}:${r.toFixed(1)}`)
			.join(' ')
	);
}
