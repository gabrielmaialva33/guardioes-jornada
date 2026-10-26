/**
 * The animals' meshes: each Cube Pets GLB (monkey, tiger, koala, parrot and the
 * P23 species models) plus its species attachment (the mico's mane, the
 * toucan's bill, the onça's rosettes) is baked once into a single geometry with
 * rigid skinning: every vertex follows exactly one node of the original rig.
 *
 * Animals are then drawn in pools (createPetPool), ONE SkinnedMesh and ONE draw
 * call each: every animal's geometry copied in, each copy skinned to its own
 * Bones (with the GLB's names and rest transforms, under its own Group that
 * carries the placement), all in one Skeleton, every species' palette in one
 * atlas (paletteAtlas) so one material serves them all. bindAnimal /
 * placeAnimal from game/src/animation/animals drive each copy's bones exactly
 * as they would drive the GLB. A pool's bounding sphere follows its animals
 * every frame, so a pool out of view costs no draw.
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
	DataTexture,
	DoubleSide,
	Group,
	type Material,
	Matrix3,
	Matrix4,
	Mesh,
	MeshLambertMaterial,
	NearestFilter,
	type Object3D,
	Quaternion,
	Skeleton,
	SkinnedMesh,
	Sphere,
	SRGBColorSpace,
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

const RIG_NODES = new Set<string>(Object.values(MODEL_RIGS).flatMap((rig) => Object.values(rig.nodes)));

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
	/** The animal's own node: its placement (position, yaw, species scale) and its bones. */
	readonly group: Group;
	/** The pool's mesh, shared with the other animals drawn in the same call. */
	readonly mesh: SkinnedMesh;
	readonly bones: readonly Bone[];
	readonly rig: AnimalRig;
	/** placeAnimal, then the explicit matrix refresh (the pet's nodes do not auto-update). */
	place(animal: AnyAnimal): void;
	dispose(): void;
}

/** Animals drawn together: one SkinnedMesh, one draw call. */
export interface PetPool {
	readonly mesh: SkinnedMesh;
	/** One per animal, in the order of the entries (each entry's `count` in a row). */
	readonly instances: readonly PetInstance[];
	/** Triangles drawn when the pool is in view (every animal in it). */
	readonly triangles: number;
	/** Fits the bounding sphere around the animals' current places (once per frame, no allocation). */
	updateBounds(): void;
	dispose(): void;
}

/** One kind of animal in a pool: its template, how many, and its palette's slot in the atlas (-1: the template's own palette). */
export interface PoolEntry {
	readonly template: PetTemplate;
	readonly count: number;
	readonly slot: number;
}

/** Every species palette side by side in one texture, so one material (one draw) serves them all. */
export interface PaletteAtlas {
	readonly texture: Texture;
	readonly columns: number;
	readonly rows: number;
}

/** Texels per side of a species palette (ART.md §6: palette textures are at most 64 × 64). */
export const PALETTE_SIZE = 64;

/**
 * Packs the species palettes into one atlas (nearest copies, slot k at column k % columns,
 * row ⌊k / columns⌋, row 0 at the top as the palettes load with flipY false). Load time only.
 * DataTextures (tests, Node) are copied texel by texel; images go through a 2D canvas.
 */
export function paletteAtlas(palettes: readonly (Texture | null)[]): PaletteAtlas {
	const n = Math.max(1, palettes.length);
	const columns = Math.ceil(Math.sqrt(n));
	const rows = Math.ceil(n / columns);
	const width = columns * PALETTE_SIZE;
	const height = rows * PALETTE_SIZE;
	const isData = (t: Texture | null) =>
		!t || (t.image !== null && typeof t.image === 'object' && 'data' in t.image);
	let texture: Texture;
	if (palettes.every(isData)) {
		const data = new Uint8Array(width * height * 4).fill(255);
		palettes.forEach((palette, k) => {
			if (!palette) return;
			const image = palette.image as { data: ArrayLike<number>; width: number; height: number };
			const channels = Math.max(1, Math.round(image.data.length / (image.width * image.height)));
			const x0 = (k % columns) * PALETTE_SIZE;
			const y0 = Math.floor(k / columns) * PALETTE_SIZE;
			for (let y = 0; y < PALETTE_SIZE; y++)
				for (let x = 0; x < PALETTE_SIZE; x++) {
					const sx = Math.min(image.width - 1, Math.floor((x * image.width) / PALETTE_SIZE));
					const sy = Math.min(image.height - 1, Math.floor((y * image.height) / PALETTE_SIZE));
					const from = (sy * image.width + sx) * channels;
					const to = ((y0 + y) * width + x0 + x) * 4;
					for (let c = 0; c < 3; c++) data[to + c] = image.data[from + Math.min(c, channels - 1)];
				}
		});
		texture = new DataTexture(data, width, height);
	} else {
		const canvas =
			typeof OffscreenCanvas !== 'undefined'
				? new OffscreenCanvas(width, height)
				: Object.assign(document.createElement('canvas'), { width, height });
		const context = canvas.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
		context.imageSmoothingEnabled = false;
		palettes.forEach((palette, k) => {
			if (!palette) return;
			const x = (k % columns) * PALETTE_SIZE;
			const y = Math.floor(k / columns) * PALETTE_SIZE;
			context.drawImage(palette.image as CanvasImageSource, x, y, PALETTE_SIZE, PALETTE_SIZE);
		});
		texture = new Texture(canvas as unknown as HTMLCanvasElement);
	}
	texture.flipY = false;
	texture.colorSpace = SRGBColorSpace;
	texture.magFilter = NearestFilter;
	texture.minFilter = NearestFilter;
	texture.generateMipmaps = false;
	texture.needsUpdate = true;
	return { texture, columns, rows };
}

/** Model-space radius generous enough for every posture (hangs, swings, stretched limbs). */
const BOUNDS_RADIUS = 2.8;

/** One animal's bone tree under its own group. Load time only (allocates). */
function instanceBones(template: PetTemplate) {
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
	for (const bone of bones) bone.updateMatrix();
	group.matrixAutoUpdate = false;
	return { group, bones };
}

/**
 * Animals of several species in one SkinnedMesh: each entry's template geometry copied
 * `count` times, each copy skinned to its own run of bones in one Skeleton, its palette UVs
 * moved into its atlas slot. The mesh sits at the layer's origin (attached bind mode: the
 * bones carry the world placement); the caller adds the mesh and every instance's group to
 * the same parent. Load time only (allocates).
 */
export function createPetPool(
	entries: readonly PoolEntry[],
	material: MeshLambertMaterial,
	atlas: PaletteAtlas | null,
	name: string
): PetPool {
	let vertices = 0;
	let indices = 0;
	let triangles = 0;
	for (const { template, count } of entries) {
		const geometry = template.geometry;
		vertices += geometry.getAttribute('position').count * count;
		indices += (geometry.index?.count ?? geometry.getAttribute('position').count) * count;
		triangles += template.triangles * count;
	}
	const floats = { position: 3, normal: 3, uv: 2, color: 3, [PET_MAP_ATTRIBUTE]: 1, skinWeight: 4 } as const;
	const arrays = Object.fromEntries(
		Object.entries(floats).map(([key, size]) => [key, new Float32Array(vertices * size)])
	) as Record<keyof typeof floats, Float32Array>;
	const skinIndex = new Uint16Array(vertices * 4);
	const index = vertices > 65535 ? new Uint32Array(indices) : new Uint16Array(indices);
	const parts: { group: Group; bones: Bone[]; template: PetTemplate }[] = [];
	let v = 0;
	let w = 0;
	let boneBase = 0;
	for (const { template, count, slot } of entries) {
		const source = template.geometry;
		const V = source.getAttribute('position').count;
		const sourceIndex = source.index;
		const I = sourceIndex ? sourceIndex.count : V;
		const B = template.bones.length;
		const su = atlas && slot >= 0 ? (slot % atlas.columns) / atlas.columns : 0;
		const sv = atlas && slot >= 0 ? Math.floor(slot / atlas.columns) / atlas.rows : 0;
		const ku = atlas && slot >= 0 ? 1 / atlas.columns : 1;
		const kv = atlas && slot >= 0 ? 1 / atlas.rows : 1;
		for (let k = 0; k < count; k++) {
			for (const [key, size] of Object.entries(floats) as [keyof typeof floats, number][])
				arrays[key].set((source.getAttribute(key) as BufferAttribute).array as Float32Array, v * size);
			const uv = arrays.uv;
			for (let i = 0; i < V; i++) {
				uv[(v + i) * 2] = su + uv[(v + i) * 2] * ku;
				uv[(v + i) * 2 + 1] = sv + uv[(v + i) * 2 + 1] * kv;
			}
			const skin = (source.getAttribute('skinIndex') as BufferAttribute).array;
			for (let i = 0; i < V * 4; i++) skinIndex[v * 4 + i] = skin[i] + boneBase;
			for (let i = 0; i < I; i++) index[w + i] = (sourceIndex ? sourceIndex.getX(i) : i) + v;
			parts.push({ ...instanceBones(template), template });
			v += V;
			w += I;
			boneBase += B;
		}
	}
	const geometry = new BufferGeometry();
	for (const [key, size] of Object.entries(floats) as [keyof typeof floats, number][])
		geometry.setAttribute(key, new BufferAttribute(arrays[key], size));
	geometry.setAttribute('skinIndex', new BufferAttribute(skinIndex, 4));
	geometry.setIndex(new BufferAttribute(index, 1));
	geometry.name = name;

	const mesh = new SkinnedMesh(geometry, material);
	mesh.name = name;
	mesh.castShadow = false;
	mesh.receiveShadow = false;
	mesh.matrixAutoUpdate = false;
	mesh.updateMatrix();
	const sphere = new Sphere(new Vector3(), BOUNDS_RADIUS);
	mesh.boundingSphere = sphere;
	// Bind at rest with every copy at the origin, as each animal's own mesh was bound before.
	for (const part of parts) part.group.updateMatrixWorld(true);
	mesh.updateMatrixWorld(true);
	const skeleton = new Skeleton(parts.flatMap((part) => part.bones));
	mesh.bind(skeleton);
	const radii = new Float64Array(parts.length);
	const instances: PetInstance[] = parts.map(({ group, bones, template }, i) => {
		// After the bind: bindAnimal stretches long limbs from the rest the inverses were taken at.
		const rig = bindAnimal(bones[0], template.species);
		for (const bone of bones) bone.updateMatrix();
		const scale = SPECIES[template.species].scale;
		radii[i] = BOUNDS_RADIUS * scale;
		group.scale.setScalar(scale);
		group.updateMatrix();
		return {
			group,
			mesh,
			bones,
			rig,
			place(animal: AnyAnimal) {
				placeAnimal(animal, group, rig);
				group.updateMatrix();
				for (let j = 0; j < bones.length; j++) bones[j].updateMatrix();
			},
			dispose() {
				group.removeFromParent();
				group.clear();
			}
		};
	});
	const min = new Vector3();
	const max = new Vector3();
	const pool: PetPool = {
		mesh,
		instances,
		triangles,
		updateBounds() {
			min.set(Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY);
			max.set(Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY);
			for (let i = 0; i < instances.length; i++) {
				const p = instances[i].group.position;
				const r = radii[i];
				if (p.x - r < min.x) min.x = p.x - r;
				if (p.y - r < min.y) min.y = p.y - r;
				if (p.z - r < min.z) min.z = p.z - r;
				if (p.x + r > max.x) max.x = p.x + r;
				if (p.y + r > max.y) max.y = p.y + r;
				if (p.z + r > max.z) max.z = p.z + r;
			}
			sphere.center.addVectors(min, max).multiplyScalar(0.5);
			sphere.radius = 0.5 * min.distanceTo(max);
		},
		dispose() {
			for (const instance of instances) instance.dispose();
			skeleton.dispose();
			geometry.dispose();
			mesh.removeFromParent();
		}
	};
	pool.updateBounds();
	return pool;
}

/** Every animal of one species with its own palette (the lineup page): one pool, one draw. */
export function createPetBatch(template: PetTemplate, count: number): PetPool {
	return createPetPool([{ template, count, slot: -1 }], template.material, null, `life-${template.species}`);
}

/** One animal alone (its mesh inside the animal's group): previews and tests. Load time only. */
export function createPet(template: PetTemplate): PetInstance {
	const batch = createPetBatch(template, 1);
	const instance = batch.instances[0];
	instance.group.add(batch.mesh);
	// Inside the animal's group the sphere is in model space (the group scales and places it).
	batch.mesh.boundingSphere = new Sphere(new Vector3(0, 0.7, 0), BOUNDS_RADIUS);
	return {
		group: instance.group,
		mesh: instance.mesh,
		bones: instance.bones,
		rig: instance.rig,
		place: instance.place,
		dispose() {
			batch.dispose();
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
