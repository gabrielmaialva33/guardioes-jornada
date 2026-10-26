#!/usr/bin/env node
/**
 * Measures the Cube Pets GLBs (game/src/assets/models/{monkey,tiger,koala,parrot}.glb) in their own
 * units with three's GLTFLoader + MeshoptDecoder, in Node: every vertex in root space, rest pose. These
 * are the numbers behind src/animation/animals/rigs.ts ModelMeasures (copied by hand).
 * Textures are stripped from the JSON chunk before parsing (Node has no image decoder); geometry, node
 * transforms and quantization are untouched.
 *
 *   node game/scripts/measure-glb.mjs [repo-root]
 *
 * Environment:
 *   REPO    repository root when no argument is given (default: this checkout).
 *   MODELS  comma-separated model names in game/src/assets/models (default: monkey,tiger,koala,parrot).
 *           Each needs a `root` node, a `body` mesh and the four `leg-*` meshes.
 *
 * See game/docs/animation.md.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Box3, Matrix4, Vector3 } from 'three';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const repo = process.argv[2] ?? process.env.REPO ?? fileURLToPath(new URL('../../', import.meta.url));
const models = (process.env.MODELS ?? 'monkey,tiger,koala,parrot').split(',');
await MeshoptDecoder.ready;

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
	const pad = (4 - (text.length % 4)) % 4;
	text = Buffer.concat([text, Buffer.alloc(pad, 0x20)]);
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

const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);
const parse = (ab) => new Promise((resolve, reject) => loader.parse(ab, '', resolve, reject));

const fmt = (v) => v.toFixed(4);
const results = {};
for (const model of models) {
	const buffer = readFileSync(join(repo, 'game/src/assets/models', `${model}.glb`));
	const gltf = await parse(stripTextures(buffer));
	const scene = gltf.scene;
	const root = scene.getObjectByName('root');
	if (!root) throw new Error(`${model}.glb has no root node`);
	scene.updateMatrixWorld(true);
	// Root space: root has an identity transform and so does its parent, but be explicit.
	const toRoot = new Matrix4().copy(root.matrixWorld).invert();
	const boxes = {};
	root.traverse((o) => {
		if (!o.isMesh) return;
		// The mesh may be a child of the named node (multi-primitive) or the node itself.
		const named = o.name && !/^mesh|_\d+$/.test(o.name) ? o : o.parent;
		const key = named.name || o.name;
		const pos = o.geometry.attributes.position;
		const m = new Matrix4().multiplyMatrices(toRoot, o.matrixWorld);
		const v = new Vector3();
		const box = boxes[key] ?? new Box3();
		for (let i = 0; i < pos.count; i++) {
			v.fromBufferAttribute(pos, i).applyMatrix4(m);
			box.expandByPoint(v);
		}
		boxes[key] = box;
	});
	const all = new Box3();
	for (const b of Object.values(boxes)) all.union(b);
	const headBox = boxes.head;
	const bodyBox = boxes.body;
	const legs = ['leg-front-left', 'leg-front-right', 'leg-back-left', 'leg-back-right']
		.map((n) => boxes[n])
		.filter(Boolean);
	const feet = Math.min(...legs.map((b) => b.min.y));
	// Nose to rump, tail excluded: body + head + legs along z.
	const torso = new Box3();
	for (const [k, b] of Object.entries(boxes)) if (k !== 'tail' && k !== 'Group') torso.union(b);
	const noCrest = new Box3();
	for (const [k, b] of Object.entries(boxes)) if (k !== 'Group') noCrest.union(b);
	const r = {
		feet,
		headTop: headBox ? headBox.max.y : Number.NaN,
		bodyTop: bodyBox.max.y,
		allTop: all.max.y,
		noCrestTop: noCrest.max.y,
		noseZ: torso.max.z,
		rumpZ: torso.min.z,
		bodyLength: torso.max.z - torso.min.z,
		totalLength: noCrest.max.z - noCrest.min.z,
		boxes: Object.fromEntries(
			Object.entries(boxes).map(([k, b]) => [
				k,
				{ min: b.min.toArray().map((x) => +fmt(x)), max: b.max.toArray().map((x) => +fmt(x)) }
			])
		)
	};
	results[model] = r;
	console.log(
		`${model.padEnd(7)} feet ${fmt(feet)}  head top ${fmt(r.headTop)}  body top ${fmt(r.bodyTop)}  ` +
			`all top ${fmt(r.allTop)}  top w/o crest ${fmt(r.noCrestTop)}  nose ${fmt(r.noseZ)}  rump ${fmt(r.rumpZ)}  ` +
			`body length ${fmt(r.bodyLength)}  total length ${fmt(r.totalLength)}`
	);
	for (const [k, b] of Object.entries(r.boxes))
		console.log(`    ${k.padEnd(16)} min ${b.min.join(', ')}  max ${b.max.join(', ')}`);
}
console.log(JSON.stringify(results, (k, v) => (k === 'boxes' ? undefined : v)));
