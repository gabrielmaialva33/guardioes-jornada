/**
 * Test fixtures: the real node trees of game/src/assets/models/*.glb (names and
 * rest transforms, read from the GLB's JSON chunk), the meshes' bounds where a
 * test measures the models, and small simulation helpers. Only imported by
 * *.test.ts files.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Box3, Group, Matrix4, type Mesh, Object3D, Vector3 } from 'three';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { Animal } from './animal.ts';
import { type AnimalRig, bindAnimal, placeAnimal } from './bind.ts';
import { type AnimalWorld, createAnimalWorld } from './motion.ts';
import type { ModelId } from './rigs.ts';
import type { SpeciesId } from './species.ts';

const MODELS_DIR = fileURLToPath(new URL('../../assets/models/', import.meta.url));

interface GltfNode {
	name?: string;
	translation?: number[];
	rotation?: number[];
	scale?: number[];
	children?: number[];
}

/** The model's scene graph with the GLB's names and rest transforms. */
export function loadNodeTree(model: ModelId): Group {
	const buffer = readFileSync(`${MODELS_DIR}${model}.glb`);
	const length = buffer.readUInt32LE(12);
	const json = JSON.parse(buffer.subarray(20, 20 + length).toString('utf8')) as {
		nodes: GltfNode[];
		scenes: { nodes: number[] }[];
		scene?: number;
	};
	const objects = json.nodes.map((node) => {
		const object = new Object3D();
		object.name = node.name ?? '';
		if (node.translation) object.position.fromArray(node.translation);
		if (node.rotation) object.quaternion.fromArray(node.rotation);
		if (node.scale) object.scale.fromArray(node.scale);
		return object;
	});
	json.nodes.forEach((node, i) => {
		for (const child of node.children ?? []) objects[i].add(objects[child]);
	});
	const scene = new Group();
	for (const root of json.scenes[json.scene ?? 0].nodes) scene.add(objects[root]);
	return scene;
}

/** The GLB with its images, textures and samplers removed (Node has no image decoder); geometry untouched. */
function withoutTextures(buffer: Buffer): ArrayBuffer {
	const length = buffer.readUInt32LE(12);
	const json = JSON.parse(buffer.subarray(20, 20 + length).toString('utf8'));
	delete json.images;
	delete json.textures;
	delete json.samplers;
	for (const material of json.materials ?? []) delete material.pbrMetallicRoughness?.baseColorTexture;
	const text = Buffer.from(JSON.stringify(json), 'utf8');
	const chunk = Buffer.concat([text, Buffer.alloc((4 - (text.length % 4)) % 4, 0x20)]);
	const rest = buffer.subarray(20 + length);
	const header = Buffer.alloc(20);
	header.writeUInt32LE(0x46546c67, 0);
	header.writeUInt32LE(2, 4);
	header.writeUInt32LE(20 + chunk.length + rest.length, 8);
	header.writeUInt32LE(chunk.length, 12);
	header.writeUInt32LE(0x4e4f534a, 16);
	const out = Buffer.concat([header, chunk, rest]);
	return out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength) as ArrayBuffer;
}

/**
 * Bounds of every named node's mesh in root space, rest pose: every vertex,
 * decoded with GLTFLoader and MeshoptDecoder (the GLBs are meshopt-compressed
 * and quantized). Load time of a test only.
 */
export async function meshBounds(model: ModelId): Promise<Record<string, Box3>> {
	await MeshoptDecoder.ready;
	const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
	const buffer = withoutTextures(readFileSync(`${MODELS_DIR}${model}.glb`));
	const gltf = await loader.parseAsync(buffer, '');
	const root = gltf.scene.getObjectByName('root');
	if (!root) throw new Error(`${model}.glb has no root`);
	gltf.scene.updateMatrixWorld(true);
	const toRoot = new Matrix4().copy(root.matrixWorld).invert();
	const boxes: Record<string, Box3> = {};
	const point = new Vector3();
	const matrix = new Matrix4();
	root.traverse((object) => {
		const mesh = object as Mesh;
		if (!mesh.isMesh) return;
		// Every Cube Pets node holds a one-primitive mesh, which GLTFLoader names after the node.
		const position = mesh.geometry.getAttribute('position');
		matrix.multiplyMatrices(toRoot, mesh.matrixWorld);
		const box = boxes[mesh.name] ?? new Box3();
		boxes[mesh.name] = box;
		for (let i = 0; i < position.count; i++)
			box.expandByPoint(point.fromBufferAttribute(position, i).applyMatrix4(matrix));
	});
	return boxes;
}

/** A placed, bound instance: `holder` plays the scene's group. */
export function instance(species: SpeciesId, model: ModelId) {
	const holder = new Group();
	const scene = loadNodeTree(model);
	holder.add(scene);
	const rig = bindAnimal(scene, species);
	return { holder, scene, rig };
}

/** World position of a point in a node's local space (default: a Cube Pets foot, 0.3 below the hip). */
export function pointOf(
	root: Object3D,
	name: string,
	local: readonly [number, number, number] = [0, -0.3, 0]
) {
	root.updateMatrixWorld(true);
	const node = root.getObjectByName(name);
	if (!node) throw new Error(`no node ${name}`);
	return node.localToWorld(new Vector3(local[0], local[1], local[2]));
}

export function apply(animal: Animal, holder: Object3D, rig: AnimalRig) {
	placeAnimal(animal, holder, rig);
	holder.updateMatrixWorld(true);
}

/** Runs `seconds` of frames at `hz`, calling `each` after every frame. */
export function run(
	animal: Animal,
	seconds: number,
	hz: number,
	world: AnimalWorld = createAnimalWorld(),
	each?: (t: number) => void
) {
	const dt = 1 / hz;
	const frames = Math.round(seconds * hz);
	for (let i = 0; i < frames; i++) {
		animal.update(dt, world);
		each?.((i + 1) * dt);
	}
	return world;
}

export const allFinite = (values: ArrayLike<number>) => {
	for (let i = 0; i < values.length; i++) if (!Number.isFinite(values[i])) return false;
	return true;
};

/** A straight branch or trail along +z at height y. */
export const straight = (length: number, y = 0, x = 0) => [x, y, 0, x, y, length];

/** `count` handholds `spacing` apart along +z at height y. */
export const holds = (count: number, spacing: number, y: number) =>
	Array.from({ length: count }, (_, i) => [0, y, i * spacing]).flat();
