import {
	Box3,
	BoxGeometry,
	DataTexture,
	Group,
	Mesh,
	MeshBasicMaterial,
	MeshStandardMaterial,
	PerspectiveCamera,
	Texture,
	Vector3
} from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildStoryWorld } from '../level/build.ts';
import { BlockGrid, InstancePool, PoolSet } from '../render/index.ts';
import { loadModel } from '../scene/avatar.ts';
import { FLAG, ZONE } from '../survival/types.ts';
import { loadStudyCatalog, type StudyCatalog } from './data.ts';
import { studyEnabled } from './gate.ts';
import {
	loadStudyVegetation,
	prepareFoliageMaterials,
	prepareVegetationModel,
	shareVegetationTextures
} from './vegetation.ts';

vi.mock('./gate.ts', () => ({
	studyEnabled: vi.fn(() => true),
	studyLook: () => 'raw',
	studyUrl: (p: string) => `/local/${p}`
}));
vi.mock('./data.ts', () => ({ loadStudyCatalog: vi.fn() }));
vi.mock('../scene/avatar.ts', () => ({ loadModel: vi.fn() }));
vi.mock('./stylize.ts', () => ({
	stylizeModel: () => ({
		look: 'raw',
		materials: [],
		textures: [],
		textureBytes: 0,
		outlines: 0,
		dispose: vi.fn()
	})
}));
afterEach(() => {
	vi.clearAllMocks();
	vi.unstubAllEnvs();
	vi.mocked(studyEnabled).mockReturnValue(true);
});
function defined<T>(value: T | null | undefined): T {
	if (value == null) throw new Error('fixture value missing');
	return value;
}
function model() {
	const scene = new Group();
	scene.position.set(900, -400, 2000);
	const mesh = new Mesh(
		new BoxGeometry(2, 4, 2),
		new MeshStandardMaterial({ map: new Texture(), transparent: true, metalness: 1 })
	);
	mesh.position.y = 2;
	mesh.name = 'plant_LOD0';
	scene.add(mesh);
	return scene;
}
function fixture() {
	const world = buildStoryWorld().world;
	world.flags.fill(FLAG.walkable | FLAG.forest);
	world.zones.fill(ZONE.lowland);
	world.heights.fill(2);
	return {
		world,
		grid: BlockGrid.covering(0, 0, world.size, world.size),
		quality: 'high' as const,
		signal: new AbortController().signal,
		look: 'raw' as const
	};
}
const catalog = (): StudyCatalog => ({
	generatedAt: '',
	jobs: 2,
	animals: [],
	sounds: [],
	terrain: [],
	plants: [
		{
			kind: 'plant',
			id: 'a',
			role: 'groundcover',
			fit: 'pick',
			path: 'a.glb',
			bytes: 1,
			tris: 12,
			meshes: 1,
			casters: 0,
			textures: []
		},
		{
			kind: 'plant',
			id: 'b',
			role: 'understorey',
			fit: 'pick',
			path: 'b.glb',
			bytes: 1,
			tris: 12,
			meshes: 1,
			casters: 0,
			textures: []
		}
	]
});

describe('vegetation preparation', () => {
	it('keeps bark opaque when its texture alpha stores smoothness', () => {
		const scene = model(),
			m = (scene.children[0] as Mesh).material as MeshStandardMaterial;
		m.name = 'tree_bark';
		prepareFoliageMaterials(scene);
		expect(m.alphaTest).toBe(0);
		expect(m.transparent).toBe(false);
	});

	it('shares equal atlas pixels without merging distinct cutouts of the same name', () => {
		const cache = new Map<string, Texture>();
		const make = (value: number) => {
			const s = new Group(),
				map = new DataTexture(new Uint8Array([value, 100, 50, 255]), 1, 1);
			map.name = 'atlas';
			s.add(new Mesh(new BoxGeometry(), new MeshStandardMaterial({ map })));
			return s;
		};
		const a = make(10),
			b = make(10),
			c = make(20);
		for (const m of [a, b, c]) shareVegetationTextures(m, cache);
		const map = (g: Group) => ((g.children[0] as Mesh).material as MeshStandardMaterial).map;
		expect(map(a)).toBe(map(b));
		expect(map(a)).not.toBe(map(c));
	});

	it('shares atlas uploads across UV transforms without moving either sampler', () => {
		const a = model(),
			b = model();
		const maps = [a, b].map((s) => (s.children[0] as Mesh).material as MeshStandardMaterial);
		for (const m of maps) {
			m.map = new DataTexture(new Uint8Array([1, 2, 3, 255]), 1, 1);
			m.map.name = 'atlas';
		}
		defined(maps[1].map).offset.x = 0.25;
		const cache = new Map<string, Texture>();
		shareVegetationTextures(a, cache);
		shareVegetationTextures(b, cache);
		expect(defined(maps[0].map).source).toBe(defined(maps[1].map).source);
		expect(defined(maps[1].map).offset.x).toBe(0.25);
		expect(defined(maps[0].map).offset.x).toBe(0);
	});
	it('drops explicit shadow duplicates and normalizes a remote origin at the base', () => {
		const scene = model(),
			shadow = new Mesh(new BoxGeometry(200, 200, 200), new MeshBasicMaterial());
		shadow.name = 'plant_caster';
		scene.add(shadow);
		expect(prepareVegetationModel(scene)).toBe(4);
		const box = new Box3().setFromObject(defined(scene.parent));
		expect(box.min.y).toBeCloseTo(0);
		expect(box.max.y).toBeCloseTo(1);
		expect(box.min.x + box.max.x).toBeCloseTo(0);
		expect(shadow.parent).toBeNull();
	});
	it('drops anonymous packed shadow meshes by material when the main surface exists', () => {
		const scene = model(),
			shadow = new Mesh(new BoxGeometry(100, 100, 100), new MeshBasicMaterial());
		shadow.name = '';
		shadow.material.name = 'atlas_caster';
		scene.add(shadow);
		expect(prepareVegetationModel(scene)).toBe(4);
		expect(shadow.parent).toBeNull();
	});
	it('anchors an asymmetric canopy at the trunk instead of moving its collider', () => {
		const scene = new Group(),
			trunk = new Mesh(new BoxGeometry(1, 4, 1), new MeshBasicMaterial());
		trunk.position.y = 2;
		scene.add(trunk);
		const crown = new Mesh(new BoxGeometry(8, 3, 8), new MeshBasicMaterial());
		crown.position.set(5, 5, 0);
		scene.add(crown);
		const height = prepareVegetationModel(scene);
		defined(scene.parent).updateMatrixWorld(true);
		const foot = trunk.localToWorld(new Vector3(0, -2, 0));
		expect(foot.x).toBeCloseTo(0);
		expect(foot.y).toBeCloseTo(0);
		expect(height).toBeCloseTo(6.5);
	});
	it('keeps a real liana with a caster-named material and sets cutout foliage', () => {
		const scene = model(),
			mesh = scene.children[0] as Mesh,
			material = mesh.material as MeshStandardMaterial;
		mesh.name = 'liana';
		material.name = 'atlas_caster';
		prepareVegetationModel(scene);
		prepareFoliageMaterials(scene);
		expect(mesh.parent).toBe(scene);
		expect(material.transparent).toBe(false);
		expect(material.alphaTest).toBe(0.5);
		expect(material.metalness).toBe(0);
		expect(material.depthWrite).toBe(true);
	});
	it('rejects nonfinite and empty sources before creating pools', () => {
		expect(() => prepareVegetationModel(new Group())).toThrow(/bounds/);
		const scene = model();
		scene.position.x = NaN;
		expect(() => prepareVegetationModel(scene)).toThrow(/bounds/);
	});
});

describe('local vegetation ownership', () => {
	it('keeps native families on partial replacement and restores complete swaps on abort', async () => {
		vi.stubEnv('DEV', true);
		const c = catalog();
		for (const p of c.plants) p.role = 'tree';
		vi.mocked(loadStudyCatalog).mockResolvedValue(c);
		const host = fixture(),
			names = ['tree:pau-brasil', 'tree:jequitiba'];
		const existing = new PoolSet(
			names.map(
				(name) =>
					new InstancePool([{ geometry: new BoxGeometry(), material: new MeshBasicMaterial() }], {
						name,
						capacity: 1,
						grid: host.grid
					})
			),
			[]
		);
		vi.mocked(loadModel).mockImplementation(async (url) => {
			if (url.endsWith('b.glb')) throw Error('missing');
			return model();
		});
		const partial = defined(await loadStudyVegetation({ ...host, existingPools: existing }));
		expect(partial.replaces).toEqual([]);
		for (const name of names) expect(existing.get(name).object.visible).toBe(true);
		partial.dispose();
		vi.mocked(loadModel).mockImplementation(async () => model());
		const abort = new AbortController();
		const complete = defined(
			await loadStudyVegetation({ ...host, existingPools: existing, signal: abort.signal })
		);
		expect([...complete.replaces].sort()).toEqual([...names].sort());
		for (const name of names) expect(existing.get(name).object.visible).toBe(false);
		abort.abort();
		for (const name of names) expect(existing.get(name).object.visible).toBe(true);
		complete.dispose();
		existing.dispose();
	});

	it('never requests the catalog outside DEV or when the shared gate is closed', async () => {
		vi.stubEnv('DEV', false);
		expect(await loadStudyVegetation(fixture())).toBeNull();
		vi.stubEnv('DEV', true);
		vi.mocked(studyEnabled).mockReturnValue(false);
		expect(await loadStudyVegetation(fixture())).toBeNull();
		expect(loadStudyCatalog).not.toHaveBeenCalled();
	});
	it('builds a partial additive layer, thins quality and owns disposal', async () => {
		vi.stubEnv('DEV', true);
		vi.mocked(loadStudyCatalog).mockResolvedValue(catalog());
		const sources: Group[] = [];
		vi.mocked(loadModel).mockImplementation(async (url) => {
			if (url.endsWith('b.glb')) throw Error('missing');
			const scene = model();
			sources.push(scene);
			return scene;
		});
		const host = fixture(),
			layer = await loadStudyVegetation(host);
		expect(layer).not.toBeNull();
		expect(defined(layer).debug().failed).toEqual(['b']);
		expect(defined(layer).debug().instances).toBeGreaterThan(50);
		expect(defined(layer).object).toBe(defined(layer).pools.object);
		expect(defined(layer).replaces).toEqual([]);
		const before = defined(layer).debug().instances;
		defined(layer).setQuality('low');
		expect(defined(layer).debug().instances).toBeLessThan(before);
		const camera = new PerspectiveCamera(60, 1, 0.1, 100);
		camera.position.set(80, 10, 80);
		camera.lookAt(80, 2, 90);
		camera.updateMatrixWorld();
		host.grid.update(camera);
		expect(defined(layer).debug().visible).toBeGreaterThan(0);
		const texture = (sources[0].children[0] as Mesh).material as MeshStandardMaterial;
		const dispose = vi.spyOn(defined(texture.map), 'dispose');
		defined(layer).dispose();
		defined(layer).dispose();
		expect(dispose).toHaveBeenCalledTimes(1);
		expect(defined(layer).pools.pools.size).toBe(0);
	});
	it('cleans up a decode finishing after abort and creates no pools', async () => {
		vi.stubEnv('DEV', true);
		vi.mocked(loadStudyCatalog).mockResolvedValue(catalog());
		const abort = new AbortController(),
			source = model();
		const dispose = vi.spyOn((source.children[0] as Mesh).geometry, 'dispose');
		vi.mocked(loadModel).mockImplementation(async () => {
			abort.abort();
			return source;
		});
		await expect(loadStudyVegetation({ ...fixture(), signal: abort.signal })).rejects.toThrow();
		expect(dispose).toHaveBeenCalled();
	});
});
