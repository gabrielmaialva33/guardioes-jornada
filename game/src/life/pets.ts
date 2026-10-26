/**
 * The animals' meshes: each Cube Pets GLB (monkey, tiger, koala, parrot) plus
 * its species attachment (the mico's mane, the toucan's bill, the onça's
 * rosettes) is baked once into a single geometry with rigid skinning: every
 * vertex follows exactly one node of the original rig. Each animal is then one
 * SkinnedMesh (ONE draw call, instead of 7–28 for the node tree) over Bones
 * with the GLB's names and rest transforms, so bindAnimal / placeAnimal from
 * game/src/animation/animals drive it exactly as they would drive the GLB.
 *
 * Material: the house Lambert family (stylize, with the character rim of
 * ART.md §5) with the species palette (palette-*.png) as its map. Attachments
 * carry vertex colours and no UVs, so a per-vertex `lifeMap` weight turns the
 * palette off for them (one material, one draw).
 */
import {
	Bone,
	BufferAttribute,
	BufferGeometry,
	DoubleSide,
	Group,
	type Material,
	Matrix3,
	Matrix4,
	Mesh,
	MeshLambertMaterial,
	type Object3D,
	Quaternion,
	Skeleton,
	SkinnedMesh,
	Sphere,
	Texture,
	Vector3
} from 'three';
import {
	type AnimalRig,
	type AnyAnimal,
	bindAnimal,
	MODEL_RIGS,
	placeAnimal,
	SPECIES,
	type SpeciesId
} from '../animation/animals/index.ts';
import { stylize } from '../render/stylized.ts';

const RIG_NODES = new Set<string>([
	...Object.values(MODEL_RIGS.monkey.nodes),
	...Object.values(MODEL_RIGS.parrot.nodes)
]);

/** Rosette pieces painted on the head that the asset groups under the body: they follow the head here. */
const HEAD_SPOTS = /^pinta-(cabeca|testa)/;

export interface BoneRest {
	name: string;
	/** Index of the parent bone, -1 for the root. */
	parent: number;
	position: Vector3;
	quaternion: Quaternion;
	scale: Vector3;
}

export interface PetTemplate {
	species: SpeciesId;
	geometry: BufferGeometry;
	material: MeshLambertMaterial;
	bones: BoneRest[];
	triangles: number;
}

/** The per-vertex palette switch: 1 samples the species palette, 0 keeps the vertex colour. */
export const PET_MAP_ATTRIBUTE = 'lifeMap';

function insertAfter(source: string, anchor: string, code: string, stage: string): string {
	const first = source.indexOf(anchor);
	if (first < 0 || source.indexOf(anchor, first + anchor.length) >= 0)
		throw new Error(`life pets: expected exactly one ${anchor} in the ${stage} shader`);
	return source.replace(anchor, `${anchor}\n${code}`);
}

/** onBeforeCompile patch of the pet material (exported for the shader test). */
export function patchPetShader(shader: { vertexShader: string; fragmentShader: string }) {
	shader.vertexShader = insertAfter(
		shader.vertexShader,
		'#include <common>',
		`attribute float ${PET_MAP_ATTRIBUTE};\nvarying float vLifeMap;`,
		'vertex'
	);
	shader.vertexShader = insertAfter(
		shader.vertexShader,
		'#include <begin_vertex>',
		`vLifeMap = ${PET_MAP_ATTRIBUTE};`,
		'vertex'
	);
	shader.fragmentShader = insertAfter(
		shader.fragmentShader,
		'#include <common>',
		'varying float vLifeMap;',
		'fragment'
	);
	const map = '#include <map_fragment>';
	if (shader.fragmentShader.split(map).length !== 2)
		throw new Error(`life pets: expected exactly one ${map} in the fragment shader`);
	shader.fragmentShader = shader.fragmentShader.replace(
		map,
		`#ifdef USE_MAP
	vec4 sampledDiffuseColor = texture2D( map, vMapUv );
	diffuseColor *= mix( vec4( 1.0 ), sampledDiffuseColor, vLifeMap );
#endif`
	);
}

/** The species material: palette map, vertex colours, flat Lambert with the character rim. */
export function petMaterial(palette: Texture | null): MeshLambertMaterial {
	const material = new MeshLambertMaterial({
		name: 'life-pet',
		map: palette,
		vertexColors: true,
		side: DoubleSide,
		flatShading: true
	});
	material.onBeforeCompile = (shader) => patchPetShader(shader);
	stylize(material, { rim: true });
	const key = material.customProgramCacheKey;
	material.customProgramCacheKey = () => `${key.call(material)}|life-pet`;
	return material;
}

interface Part {
	mesh: Mesh;
	bone: number;
	/** Model (root) space at rest. */
	matrix: Matrix4;
	/** Takes the palette (1) or keeps vertex colours (0). */
	map: number;
}

/**
 * Bakes a Cube Pets scene (and its attachment scene, if any) into one rigidly
 * skinned geometry. Load time only (allocates). The template meshes are only
 * read; release them afterwards.
 */
export function bakePet(
	species: SpeciesId,
	model: Object3D,
	attachment: Object3D | null,
	palette: Texture | null
): PetTemplate {
	const root = model.getObjectByName('root');
	if (!root) throw new Error(`life pets: ${species} model has no root node`);
	model.updateMatrixWorld(true);
	const toRoot = new Matrix4().copy(root.matrixWorld).invert();
	const nodes: Object3D[] = [];
	const bones: BoneRest[] = [];
	const rest: Matrix4[] = [];
	root.traverse((node) => {
		if (node !== root && !RIG_NODES.has(node.name)) return;
		let parent = -1;
		for (let up = node.parent; up && parent < 0 && node !== root; up = up.parent) parent = nodes.indexOf(up);
		const world = new Matrix4().multiplyMatrices(toRoot, node.matrixWorld);
		const local = parent < 0 ? world.clone() : new Matrix4().copy(rest[parent]).invert().multiply(world);
		const bone: BoneRest = {
			name: node.name,
			parent,
			position: new Vector3(),
			quaternion: new Quaternion(),
			scale: new Vector3()
		};
		local.decompose(bone.position, bone.quaternion, bone.scale);
		nodes.push(node);
		bones.push(bone);
		rest.push(world);
	});
	const boneOf = (object: Object3D) => {
		for (let up: Object3D | null = object; up; up = up.parent) {
			const index = nodes.indexOf(up);
			if (index >= 0) return index;
		}
		return 0;
	};
	const named = (name: string) =>
		Math.max(
			0,
			nodes.findIndex((n) => n.name === name)
		);

	const parts: Part[] = [];
	root.traverse((node) => {
		if (node instanceof Mesh)
			parts.push({
				mesh: node,
				bone: boneOf(node),
				matrix: new Matrix4().multiplyMatrices(toRoot, node.matrixWorld),
				map: 1
			});
	});
	if (attachment) {
		attachment.updateMatrixWorld(true);
		const fromAttachment = new Matrix4().copy(attachment.matrixWorld).invert();
		attachment.traverse((node) => {
			if (!(node instanceof Mesh)) return;
			// Rosettes are grouped per target node ('rosetas-<node>'); the mane follows the body, the bill the head.
			let group: Object3D | null = null;
			for (let up = node.parent; up && !group; up = up.parent) if (up.name.startsWith('rosetas-')) group = up;
			let target: number;
			let local: Matrix4;
			if (group) {
				target = named(group.name.slice('rosetas-'.length));
				local = new Matrix4().copy(group.matrixWorld).invert().multiply(node.matrixWorld);
			} else {
				target = named(species === 'tucano-de-bico-verde' ? 'head' : 'body');
				local = new Matrix4().multiplyMatrices(fromAttachment, node.matrixWorld);
			}
			const bone = HEAD_SPOTS.test(node.name) ? named('head') : target;
			parts.push({ mesh: node, bone, matrix: new Matrix4().multiplyMatrices(rest[target], local), map: 0 });
		});
	}

	let vertexCount = 0;
	let indexCount = 0;
	for (const part of parts) {
		const geometry = part.mesh.geometry;
		vertexCount += geometry.getAttribute('position').count;
		indexCount += geometry.index ? geometry.index.count : geometry.getAttribute('position').count;
	}
	const position = new Float32Array(vertexCount * 3);
	const normal = new Float32Array(vertexCount * 3);
	const uv = new Float32Array(vertexCount * 2);
	const color = new Float32Array(vertexCount * 3);
	const lifeMap = new Float32Array(vertexCount);
	const skinIndex = new Uint16Array(vertexCount * 4);
	const skinWeight = new Float32Array(vertexCount * 4);
	const index = vertexCount > 65535 ? new Uint32Array(indexCount) : new Uint16Array(indexCount);
	const point = new Vector3();
	const normalMatrix = new Matrix3();
	let v = 0;
	let w = 0;
	for (const part of parts) {
		const geometry = part.mesh.geometry;
		const p = geometry.getAttribute('position');
		const n = geometry.getAttribute('normal');
		const t = geometry.getAttribute('uv');
		const c = geometry.getAttribute('color');
		normalMatrix.getNormalMatrix(part.matrix);
		const base = v;
		for (let i = 0; i < p.count; i++, v++) {
			point.fromBufferAttribute(p, i).applyMatrix4(part.matrix);
			point.toArray(position, v * 3);
			if (n)
				point
					.fromBufferAttribute(n, i)
					.applyMatrix3(normalMatrix)
					.normalize()
					.toArray(normal, v * 3);
			else normal[v * 3 + 1] = 1;
			if (t && part.map === 1) {
				uv[v * 2] = t.getX(i);
				uv[v * 2 + 1] = t.getY(i);
			}
			if (c && part.map === 0) {
				color[v * 3] = c.getX(i);
				color[v * 3 + 1] = c.getY(i);
				color[v * 3 + 2] = c.getZ(i);
			} else color.fill(1, v * 3, v * 3 + 3);
			lifeMap[v] = part.map;
			skinIndex[v * 4] = part.bone;
			skinWeight[v * 4] = 1;
		}
		if (geometry.index)
			for (let i = 0; i < geometry.index.count; i++, w++) index[w] = base + geometry.index.getX(i);
		else for (let i = 0; i < p.count; i++, w++) index[w] = base + i;
	}
	const geometry = new BufferGeometry();
	geometry.setAttribute('position', new BufferAttribute(position, 3));
	geometry.setAttribute('normal', new BufferAttribute(normal, 3));
	geometry.setAttribute('uv', new BufferAttribute(uv, 2));
	geometry.setAttribute('color', new BufferAttribute(color, 3));
	geometry.setAttribute(PET_MAP_ATTRIBUTE, new BufferAttribute(lifeMap, 1));
	geometry.setAttribute('skinIndex', new BufferAttribute(skinIndex, 4));
	geometry.setAttribute('skinWeight', new BufferAttribute(skinWeight, 4));
	geometry.setIndex(new BufferAttribute(index, 1));
	geometry.name = `life-${species}`;
	return { species, geometry, material: petMaterial(palette), bones, triangles: indexCount / 3 };
}

export interface PetInstance {
	readonly group: Group;
	readonly mesh: SkinnedMesh;
	readonly bones: readonly Bone[];
	readonly rig: AnimalRig;
	/** placeAnimal, then the explicit matrix refresh (the pet's nodes do not auto-update). */
	place(animal: AnyAnimal): void;
	dispose(): void;
}

/** Model-space bounds generous enough for every posture (hangs, swings, stretched limbs). */
const BOUNDS_CENTRE = new Vector3(0, 0.7, 0);
const BOUNDS_RADIUS = 2.8;

/** One animal's mesh over its own bones. Load time only (allocates). */
export function createPet(template: PetTemplate): PetInstance {
	const bones = template.bones.map((rest) => {
		const bone = new Bone();
		bone.name = rest.name;
		bone.position.copy(rest.position);
		bone.quaternion.copy(rest.quaternion);
		bone.scale.copy(rest.scale);
		bone.matrixAutoUpdate = false;
		return bone;
	});
	template.bones.forEach((rest, i) => {
		if (rest.parent >= 0) bones[rest.parent].add(bones[i]);
	});
	const group = new Group();
	group.name = `life-${template.species}`;
	group.add(bones[0]);
	const mesh = new SkinnedMesh(template.geometry, template.material);
	mesh.name = group.name;
	mesh.castShadow = false;
	mesh.receiveShadow = false;
	mesh.boundingSphere = new Sphere(BOUNDS_CENTRE.clone(), BOUNDS_RADIUS);
	group.add(mesh);
	for (const bone of bones) bone.updateMatrix();
	group.updateMatrixWorld(true);
	const skeleton = new Skeleton(bones);
	mesh.bind(skeleton);
	// Binding after the skeleton: bindAnimal stretches long limbs from the rest the inverses were taken at.
	const rig = bindAnimal(bones[0], template.species);
	for (const bone of bones) bone.updateMatrix();
	group.matrixAutoUpdate = false;
	mesh.matrixAutoUpdate = false;
	mesh.updateMatrix();
	group.scale.setScalar(SPECIES[template.species].scale);
	group.updateMatrix();
	return {
		group,
		mesh,
		bones,
		rig,
		place(animal: AnyAnimal) {
			placeAnimal(animal, group, rig);
			group.updateMatrix();
			for (let i = 0; i < bones.length; i++) bones[i].updateMatrix();
		},
		dispose() {
			skeleton.dispose();
			group.removeFromParent();
			group.clear();
		}
	};
}

/** Disposes a loaded GLB scene the layer owns: geometries, materials, textures and their ImageBitmaps. */
export function releaseModel(model: Object3D) {
	const materials = new Set<Material>();
	const textures = new Set<Texture>();
	model.traverse((object) => {
		if (!(object instanceof Mesh)) return;
		object.geometry.dispose();
		for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
			materials.add(material);
			for (const value of Object.values(material)) if (value instanceof Texture) textures.add(value);
		}
	});
	for (const material of materials) material.dispose();
	for (const texture of textures) {
		texture.dispose();
		if (typeof ImageBitmap !== 'undefined' && texture.image instanceof ImageBitmap) texture.image.close();
	}
	model.removeFromParent();
}
