/**
 * Test fixtures for the living world: the story map built once, real GLBs
 * parsed in Node (textures stripped: Node has no image decoder), a stub palette
 * loader, a camera, and disposal tracking. Only imported by *.test.ts files.
 */
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	type BufferGeometry,
	DataTexture,
	type Material,
	Mesh,
	type Object3D,
	PerspectiveCamera,
	type Texture
} from 'three';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { buildStoryWorld } from '../level/build.ts';
import type { StoryBuild } from '../level/types.ts';

let story: StoryBuild | undefined;
/** The story map ("Reserva da Iara"), built once per test file. */
export function storyMap(): StoryBuild {
	story ??= buildStoryWorld();
	return story;
}

const MODELS_DIR = fileURLToPath(new URL('../assets/models/', import.meta.url));

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

/** loadGlb for Node: any URL whose basename names a file in game/src/assets/models. */
export async function nodeLoadGlb(url: string, signal?: AbortSignal): Promise<Object3D> {
	await MeshoptDecoder.ready;
	signal?.throwIfAborted();
	const name = basename(url.split('?')[0]);
	const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
	const gltf = await loader.parseAsync(withoutTextures(readFileSync(`${MODELS_DIR}${name}`)), '');
	return gltf.scene;
}

/** Palette loader stub: a 1×1 texture per URL. */
export async function stubTexture(_url: string): Promise<Texture> {
	const texture = new DataTexture(new Uint8Array([200, 160, 90, 255]), 1, 1);
	texture.needsUpdate = true;
	return texture;
}

/** A camera at `from` looking at `to`, matrices updated. */
export function cameraAt(from: [number, number, number], to: [number, number, number], far = 90) {
	const camera = new PerspectiveCamera(60, 16 / 9, 0.1, far);
	camera.position.set(...from);
	camera.lookAt(...to);
	camera.updateMatrixWorld();
	return camera;
}

/** Counts dispose() calls of every geometry, material and texture reachable from `root` now. */
export function trackDisposal(root: Object3D) {
	const resources = new Set<BufferGeometry | Material | Texture>();
	root.traverse((object) => {
		if (!(object instanceof Mesh)) return;
		resources.add(object.geometry);
		for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
			resources.add(material);
			for (const value of Object.values(material))
				if (value && (value as Texture).isTexture) resources.add(value as Texture);
			const uniforms = (material as Material & { uniforms?: Record<string, { value: unknown }> }).uniforms;
			for (const u of Object.values(uniforms ?? {}))
				if (u.value && (u.value as Texture).isTexture) resources.add(u.value as Texture);
		}
	});
	const disposed = new Set<unknown>();
	for (const resource of resources) resource.addEventListener('dispose', () => disposed.add(resource));
	return {
		resources,
		pending: () => [...resources].filter((r) => !disposed.has(r))
	};
}
