/**
 * Test fixtures: the real node trees of game/src/assets/models/*.glb (names and
 * rest transforms, read from the GLB's JSON chunk; meshes are not needed), and
 * small simulation helpers. Only imported by *.test.ts files.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Group, Object3D, Vector3 } from 'three';
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
