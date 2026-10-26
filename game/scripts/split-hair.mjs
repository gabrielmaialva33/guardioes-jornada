#!/usr/bin/env node
/**
 * Hair contract v3: cuts the dangling parts of avatar-hair.glb into child nodes
 * (HAIR_DANGLES in src/animation/hair-sway.ts) so HairSway can swing them:
 * `hair-ponytail-tail`, `hair-braids-left`/`-right` and `hair-bun-knot`, each with
 * its origin at its pivot.
 *
 * A surgery on the packed GLB, not a rebuild: the meshopt-compressed buffer, its
 * buffer views and every accessor of `cap`, `hair-afro` and `hair-long` stay
 * bit-identical, and the six style nodes keep their names and transforms. Only
 * the three split styles change, and only by indices: the parent keeps its own
 * vertex accessors with a new index list of the triangles it keeps, the children
 * get small plain (uncompressed) accessors of their triangles, moved by -pivot.
 * The packed file is not what scripts/blender/models/avatar_hair.py builds today
 * (different triangle counts), so a rebuild could not keep the other styles.
 *
 * Usage (from the repo root):
 *   node game/scripts/split-hair.mjs [--in file.glb] [--out file.glb] [--check]
 * Defaults to splitting game/src/assets/models/avatar-hair.glb in place; a file
 * that is already split is left alone. `--check` only verifies a split file
 * against the original (--in original --out split).
 */
import { Buffer } from 'node:buffer';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { HAIR_DANGLES } from '../src/animation/hair-sway.ts';

const here = dirname(fileURLToPath(import.meta.url));
const DEFAULT = join(here, '../src/assets/models/avatar-hair.glb');
const STYLE_NODES = { rabo: 'hair-ponytail', trancas: 'hair-braids', coque: 'hair-bun' };

/**
 * Which child a face (a connected triangle group: the builder's boxes are flat
 * shaded, so every quad is its own component) goes to, by its bounds; -1 keeps it
 * on the parent. Head units, glTF axes: +y up, +z the face, +x the character's left.
 */
const CLASSIFY = {
	// The three arched tail segments behind the hair tie (the tie and the back panel stay).
	'hair-ponytail': (min, max) => (Math.max(-min[0], max[0]) <= 0.15 && min[2] < -0.52 ? 0 : -1),
	// Side and back braids hang below the scalp cap (top at 0.78); left (+x) is child 0.
	'hair-braids': (min, max) => (max[1] <= 0.785 ? (min[0] + max[0] > 0 ? 0 : 1) : -1),
	// The six-sided knot sits on the wrap band (top at 0.92) from 0.90 up.
	'hair-bun': (min) => (min[1] >= 0.895 ? 0 : -1)
};

const args = new Map();
for (let i = 2; i < process.argv.length; i++) {
	const key = process.argv[i];
	if (!key.startsWith('--')) throw new Error(`unexpected argument: ${key}`);
	const next = process.argv[i + 1];
	if (next === undefined || next.startsWith('--')) args.set(key.slice(2), 'true');
	else args.set(key.slice(2), process.argv[++i]);
}

await MeshoptDecoder.ready;

function readGlb(file) {
	const data = readFileSync(file);
	if (data.readUInt32LE(0) !== 0x46546c67) throw new Error(`${file}: not a GLB`);
	const jsonLength = data.readUInt32LE(12);
	const json = JSON.parse(data.subarray(20, 20 + jsonLength).toString('utf8'));
	const binStart = 20 + jsonLength;
	const bin = data.subarray(binStart + 8, binStart + 8 + data.readUInt32LE(binStart));
	return { json, bin };
}

/** Raw bytes of every buffer view, meshopt views decoded. */
function decodeViews({ json, bin }) {
	return json.bufferViews.map((view) => {
		const ext = view.extensions?.EXT_meshopt_compression;
		if (!ext) return bin.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength);
		const out = new Uint8Array(ext.count * ext.byteStride);
		const source = bin.subarray(ext.byteOffset ?? 0, (ext.byteOffset ?? 0) + ext.byteLength);
		MeshoptDecoder.decodeGltfBuffer(out, ext.count, ext.byteStride, source, ext.mode, ext.filter);
		return out;
	});
}

const SIZE = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
const COUNT = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };

/** One accessor as { bytes per element, stride, view bytes, offset } for copying elements. */
function element(json, views, index) {
	const accessor = json.accessors[index];
	const view = json.bufferViews[accessor.bufferView];
	const size = SIZE[accessor.componentType] * COUNT[accessor.type];
	const stride = view.extensions?.EXT_meshopt_compression?.byteStride ?? view.byteStride ?? size;
	return { accessor, size, stride, bytes: views[accessor.bufferView], offset: accessor.byteOffset ?? 0 };
}

function readIndices(json, views, index) {
	const { accessor, bytes, offset } = element(json, views, index);
	const out = new Uint32Array(accessor.count);
	const data = new DataView(bytes.buffer, bytes.byteOffset + offset);
	for (let i = 0; i < accessor.count; i++)
		out[i] = accessor.componentType === 5125 ? data.getUint32(i * 4, true) : data.getUint16(i * 2, true);
	return out;
}

function readPositions(json, views, index) {
	const { accessor, stride, bytes, offset } = element(json, views, index);
	if (accessor.componentType !== 5126) throw new Error('positions must be float (gltfpack -vpf)');
	const data = new DataView(bytes.buffer, bytes.byteOffset + offset);
	const out = new Float32Array(accessor.count * 3);
	for (let i = 0; i < accessor.count; i++)
		for (let d = 0; d < 3; d++) out[i * 3 + d] = data.getFloat32(i * stride + d * 4, true);
	return out;
}

/** Triangles grouped into connected faces, with their bounds. */
function faces(indices, positions) {
	const parent = Array.from({ length: positions.length / 3 }, (_, i) => i);
	const find = (x) => {
		let root = x;
		while (parent[root] !== root) root = parent[root];
		parent[x] = root;
		return root;
	};
	for (let t = 0; t < indices.length; t += 3) {
		parent[find(indices[t + 1])] = find(indices[t]);
		parent[find(indices[t + 2])] = find(indices[t]);
	}
	const groups = new Map();
	for (let t = 0; t < indices.length; t += 3) {
		const root = find(indices[t]);
		const group = groups.get(root) ?? { triangles: [], min: [1e9, 1e9, 1e9], max: [-1e9, -1e9, -1e9] };
		group.triangles.push(t);
		for (let k = 0; k < 3; k++)
			for (let d = 0; d < 3; d++) {
				const value = positions[indices[t + k] * 3 + d];
				group.min[d] = Math.min(group.min[d], value);
				group.max[d] = Math.max(group.max[d], value);
			}
		groups.set(root, group);
	}
	return [...groups.values()];
}

function split(file) {
	const glb = readGlb(file);
	const { json, bin } = glb;
	const views = decodeViews(glb);
	if (json.nodes.some((node) => node.children?.length)) return null;

	const chunks = [];
	let binLength = bin.length;
	const bufferIndex = json.buffers.findIndex((buffer) => buffer.uri === undefined && !buffer.extensions);
	if (bufferIndex < 0) throw new Error('no GLB-stored buffer');
	/** Appends a plain buffer view to the GLB buffer, 4-byte aligned. */
	const addView = (bytes, target, byteStride) => {
		const pad = (4 - (binLength % 4)) % 4;
		if (pad) chunks.push(new Uint8Array(pad));
		binLength += pad;
		const view = { buffer: bufferIndex, byteOffset: binLength, byteLength: bytes.length, target };
		if (byteStride) view.byteStride = byteStride;
		chunks.push(bytes);
		binLength += bytes.length;
		json.bufferViews.push(view);
		return json.bufferViews.length - 1;
	};
	const addIndices = (list) => {
		const data = new Uint16Array(list);
		const view = addView(new Uint8Array(data.buffer), 34963);
		json.accessors.push({ bufferView: view, componentType: 5123, count: list.length, type: 'SCALAR' });
		return json.accessors.length - 1;
	};

	const report = [];
	for (const [style, nodeName] of Object.entries(STYLE_NODES)) {
		const dangles = HAIR_DANGLES[style];
		const nodeIndex = json.nodes.findIndex((node) => node.name === nodeName);
		if (nodeIndex < 0) throw new Error(`missing node ${nodeName}`);
		const node = json.nodes[nodeIndex];
		const mesh = json.meshes[node.mesh];
		if (mesh.primitives.length !== 1) throw new Error(`${nodeName}: one primitive expected`);
		const primitive = mesh.primitives[0];
		const indices = readIndices(json, views, primitive.indices);
		const positions = readPositions(json, views, primitive.attributes.POSITION);
		const keep = [];
		const parts = dangles.map(() => []);
		for (const face of faces(indices, positions)) {
			const part = CLASSIFY[nodeName](face.min, face.max);
			for (const t of face.triangles)
				(part < 0 ? keep : parts[part]).push(indices[t], indices[t + 1], indices[t + 2]);
		}
		if (parts.some((part) => part.length === 0))
			throw new Error(`${nodeName}: a dangling part came out empty`);

		// The parent keeps its vertex accessors; only its index list shrinks (a new accessor in place).
		const kept = addIndices(keep);
		json.accessors[primitive.indices] = json.accessors[kept];
		json.accessors.pop();

		node.children = [];
		dangles.forEach(({ node: childName, pivot }, part) => {
			const used = [...new Set(parts[part])];
			const remap = new Map(used.map((vertex, i) => [vertex, i]));
			const attributes = {};
			for (const [semantic, accessorIndex] of Object.entries(primitive.attributes)) {
				const source = element(json, views, accessorIndex);
				const stride = Math.ceil(source.size / 4) * 4;
				const out = new Uint8Array(used.length * stride);
				for (const [i, vertex] of used.entries()) {
					const from = source.offset + vertex * source.stride;
					out.set(source.bytes.subarray(from, from + source.size), i * stride);
				}
				const accessor = { ...source.accessor, count: used.length };
				delete accessor.byteOffset;
				delete accessor.min;
				delete accessor.max;
				if (semantic === 'POSITION') {
					const floats = new Float32Array(out.buffer);
					const min = [1e9, 1e9, 1e9];
					const max = [-1e9, -1e9, -1e9];
					for (let i = 0; i < used.length; i++)
						for (let d = 0; d < 3; d++) {
							floats[i * 3 + d] = Math.fround(floats[i * 3 + d] - pivot[d]);
							min[d] = Math.min(min[d], floats[i * 3 + d]);
							max[d] = Math.max(max[d], floats[i * 3 + d]);
						}
					accessor.min = min;
					accessor.max = max;
				}
				accessor.bufferView = addView(out, 34962, stride);
				json.accessors.push(accessor);
				attributes[semantic] = json.accessors.length - 1;
			}
			const childIndices = addIndices(parts[part].map((vertex) => remap.get(vertex)));
			json.meshes.push({ primitives: [{ ...primitive, attributes, indices: childIndices }] });
			json.nodes.push({ name: childName, mesh: json.meshes.length - 1, translation: [...pivot] });
			node.children.push(json.nodes.length - 1);
			report.push(`${nodeName} > ${childName}: ${parts[part].length / 3} tris, ${used.length} verts`);
		});
		report.push(`${nodeName}: keeps ${keep.length / 3} of ${indices.length / 3} tris`);
	}

	const buffer = json.buffers[bufferIndex];
	const newBin = Buffer.concat([
		bin,
		...chunks.map((chunk) => Buffer.from(chunk.buffer, chunk.byteOffset, chunk.length))
	]);
	buffer.byteLength = newBin.length;
	return { bytes: writeGlb(json, newBin), report };
}

function writeGlb(json, bin) {
	let text = Buffer.from(JSON.stringify(json), 'utf8');
	text = Buffer.concat([text, Buffer.alloc((4 - (text.length % 4)) % 4, 0x20)]);
	const body = Buffer.concat([bin, Buffer.alloc((4 - (bin.length % 4)) % 4)]);
	const header = Buffer.alloc(12);
	header.writeUInt32LE(0x46546c67, 0);
	header.writeUInt32LE(2, 4);
	header.writeUInt32LE(12 + 8 + text.length + 8 + body.length, 8);
	const chunk = (type, data) => {
		const head = Buffer.alloc(8);
		head.writeUInt32LE(data.length, 0);
		head.writeUInt32LE(type, 4);
		return Buffer.concat([head, data]);
	};
	return Buffer.concat([header, chunk(0x4e4f534a, text), chunk(0x004e4942, body)]);
}

/** World-space triangles of a node (and its children), as sorted strings, for comparison. */
function triangles(glb, views, nodeIndex, offset = [0, 0, 0]) {
	const { json } = glb;
	const node = json.nodes[nodeIndex];
	const at = node.translation ?? [0, 0, 0];
	const origin = [offset[0] + at[0], offset[1] + at[1], offset[2] + at[2]];
	const out = [];
	if (node.mesh !== undefined)
		for (const primitive of json.meshes[node.mesh].primitives) {
			const indices = readIndices(json, views, primitive.indices);
			const positions = readPositions(json, views, primitive.attributes.POSITION);
			const extra = Object.entries(primitive.attributes)
				.filter(([semantic]) => semantic !== 'POSITION')
				.map(([, index]) => element(json, views, index));
			for (let t = 0; t < indices.length; t += 3) {
				const corners = [0, 1, 2].map((k) => {
					const vertex = indices[t + k];
					const p = [0, 1, 2].map((d) => (positions[vertex * 3 + d] + origin[d]).toFixed(5)).join(',');
					const rest = extra
						.map((e) =>
							[...e.bytes.subarray(e.offset + vertex * e.stride, e.offset + vertex * e.stride + e.size)].join(
								'.'
							)
						)
						.join('|');
					return `${p}|${rest}`;
				});
				// Keep the winding: rotate so the smallest corner leads.
				const lead = corners.indexOf([...corners].sort()[0]);
				out.push([0, 1, 2].map((k) => corners[(lead + k) % 3]).join(' '));
			}
		}
	for (const child of node.children ?? []) out.push(...triangles(glb, views, child, origin));
	return out.sort();
}

function check(originalFile, splitFile) {
	const before = readGlb(originalFile);
	const after = readGlb(splitFile);
	const beforeViews = decodeViews(before);
	const afterViews = decodeViews(after);
	const problems = [];
	if (!after.bin.subarray(0, before.bin.length).equals(before.bin))
		problems.push('the original buffer bytes changed');
	before.json.bufferViews.forEach((view, i) => {
		if (JSON.stringify(view) !== JSON.stringify(after.json.bufferViews[i]))
			problems.push(`buffer view ${i} changed`);
	});
	const names = (glb) => glb.json.scenes[glb.json.scene ?? 0].nodes.map((i) => glb.json.nodes[i].name);
	if (JSON.stringify(names(before)) !== JSON.stringify(names(after)))
		problems.push('top-level nodes changed');
	const split = new Set(Object.values(STYLE_NODES));
	before.json.nodes.forEach((node, i) => {
		const other = after.json.nodes[i];
		const { children: _, ...rest } = other;
		if (JSON.stringify(node) !== JSON.stringify(rest)) problems.push(`node ${node.name} changed`);
		if (!split.has(node.name)) {
			const a = JSON.stringify(
				before.json.meshes[node.mesh].primitives.map((p) =>
					[p.attributes, p.indices].map((x) => JSON.stringify(x))
				)
			);
			const b = JSON.stringify(
				after.json.meshes[other.mesh].primitives.map((p) =>
					[p.attributes, p.indices].map((x) => JSON.stringify(x))
				)
			);
			const accessors = (glb, primitive) =>
				JSON.stringify(
					[...Object.values(primitive.attributes), primitive.indices].map(
						(index) => glb.json.accessors[index]
					)
				);
			if (
				a !== b ||
				accessors(before, before.json.meshes[node.mesh].primitives[0]) !==
					accessors(after, after.json.meshes[other.mesh].primitives[0])
			)
				problems.push(`${node.name} is not bit-identical`);
		}
		const t0 = triangles(before, beforeViews, i);
		const t1 = triangles(after, afterViews, i);
		if (t0.length !== t1.length || t0.some((t, k) => t !== t1[k]))
			problems.push(
				`${node.name}: the triangles (with their normals and colours) differ once the children are put back`
			);
	});
	for (const [style, nodeName] of Object.entries(STYLE_NODES)) {
		const node = after.json.nodes.find((n) => n.name === nodeName);
		const children = (node.children ?? []).map((i) => after.json.nodes[i]);
		HAIR_DANGLES[style].forEach(({ node: childName, pivot }, k) => {
			const child = children[k];
			if (!child || child.name !== childName) problems.push(`${nodeName}: child ${k} should be ${childName}`);
			else if (JSON.stringify(child.translation) !== JSON.stringify(pivot))
				problems.push(`${childName}: origin is not its pivot`);
		});
	}
	return problems;
}

if (args.has('check')) {
	const problems = check(args.get('in'), args.get('out'));
	for (const problem of problems) console.error(`[split-hair] ${problem}`);
	if (problems.length) process.exit(1);
	console.log('[split-hair] check passed');
} else {
	const input = args.get('in') ?? DEFAULT;
	const output = args.get('out') ?? input;
	const result = split(input);
	if (result === null) console.log(`[split-hair] ${input} is already split; nothing to do`);
	else {
		const original = readFileSync(input);
		writeFileSync(output, result.bytes);
		for (const line of result.report) console.log(`[split-hair] ${line}`);
		const scratch = `${output}.check-original`;
		writeFileSync(scratch, original);
		const problems = check(scratch, output);
		rmSync(scratch);
		if (problems.length) {
			writeFileSync(output, original);
			for (const problem of problems) console.error(`[split-hair] ${problem}`);
			console.error('[split-hair] verification failed: the original file was restored');
			process.exit(1);
		}
		console.log(`[split-hair] wrote ${output} (${original.length} -> ${result.bytes.length} B), verified`);
	}
}
