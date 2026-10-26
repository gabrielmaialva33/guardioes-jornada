import { MeshLambertMaterial, Texture } from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StudyCatalog, StudyTerrainTexture } from './data.ts';

const mocks = vi.hoisted(() => ({ enabled: vi.fn(), catalog: vi.fn(), fetch: vi.fn(), decode: vi.fn() }));
vi.mock('./gate.ts', async (original) => ({ ...(await original<object>()), studyEnabled: mocks.enabled }));
vi.mock('./data.ts', () => ({ loadStudyCatalog: mocks.catalog }));

import { loadStudyTerrain, terrainRole } from './terrain.ts';

const entry = (layer: string, role: StudyTerrainTexture['role'] = 'albedo'): StudyTerrainTexture => ({
	kind: 'terrain',
	id: layer,
	path: `fixtures/${layer}.png`,
	bytes: 10,
	width: 2,
	height: 2,
	role,
	layer
});

beforeEach(() => {
	vi.restoreAllMocks();
	vi.clearAllMocks();
	mocks.enabled.mockReturnValue(true);
	mocks.catalog.mockResolvedValue({
		terrain: [
			entry('dried_leaves'),
			entry('mud_a'),
			entry('mud_b'),
			entry('moss'),
			entry('river_stones'),
			entry('grass'),
			entry('roots_leaves'),
			entry('mud', 'normal'),
			entry('', 'heightmap'),
			entry('unknown')
		]
	} as StudyCatalog);
	mocks.fetch.mockImplementation(async () => ({ ok: true, blob: async () => new Blob() }));
	mocks.decode.mockImplementation(async () => ({ width: 2, height: 2, close: vi.fn() }));
	vi.stubGlobal('fetch', mocks.fetch);
	vi.stubGlobal('createImageBitmap', mocks.decode);
});

afterEach(() => vi.unstubAllGlobals());

describe('study terrain', () => {
	it('selects semantic roles and rejects unrelated or geometry-control images', () => {
		expect(terrainRole(entry('dried_leaves'))).toBe('leafLitter');
		expect(terrainRole(entry('roots_leaves'))).toBe('leafLitter');
		expect(terrainRole(entry('sand'))).toBe('sand');
		expect(terrainRole(entry('soil'))).toBe('soil');
		expect(terrainRole(entry('mud', 'normal'))).toBeNull();
		expect(terrainRole(entry('', 'heightmap'))).toBeNull();
		expect(terrainRole(entry('unknown'))).toBeNull();
	});

	it('does not access the catalog or images when disabled', async () => {
		mocks.enabled.mockReturnValue(false);
		expect(await loadStudyTerrain()).toBeNull();
		expect(mocks.catalog).not.toHaveBeenCalled();
		expect(mocks.fetch).not.toHaveBeenCalled();
	});

	it('keeps every albedo variant and preserves the existing shader when applying and restoring', async () => {
		const terrain = await loadStudyTerrain({ look: 'raw' });
		if (!terrain) throw new Error('study disabled');
		expect(terrain?.layers.mud).toHaveLength(2);
		expect(terrain?.layers.leafLitter).toHaveLength(2);
		expect(mocks.fetch).toHaveBeenCalledTimes(7);
		const original = new Texture();
		const material = new MeshLambertMaterial({ map: original });
		const compile = vi.fn();
		material.onBeforeCompile = compile;
		const restore = terrain.apply(material, 'mud', 1);
		expect(material.map).toBe(terrain.layers.mud[1].texture);
		expect(material.onBeforeCompile).toBe(compile);
		restore();
		restore();
		expect(material.map).toBe(original);
		terrain.dispose();
	});

	it('restores active bindings and disposes owned textures and bitmaps exactly once', async () => {
		const terrain = await loadStudyTerrain({ look: 'raw' });
		if (!terrain) throw new Error('study disabled');
		const material = new MeshLambertMaterial();
		terrain.apply(material, 'moss');
		const disposals = Object.values(terrain.layers)
			.flat()
			.map(({ texture }) => vi.spyOn(texture, 'dispose'));
		terrain.dispose();
		terrain.dispose();
		expect(material.map).toBeNull();
		for (const dispose of disposals) expect(dispose).toHaveBeenCalledOnce();
		for (const decoded of await Promise.all(mocks.decode.mock.results.map((r) => r.value)))
			expect(decoded.close).toHaveBeenCalledOnce();
		expect(() => terrain.apply(material, 'moss')).toThrow(/disposed/);
	});

	it('closes a decoded image if cancellation arrives while decoding', async () => {
		const controller = new AbortController();
		const close = vi.fn();
		mocks.decode.mockImplementationOnce(async () => {
			controller.abort();
			return { width: 2, height: 2, close };
		});
		await expect(loadStudyTerrain({ signal: controller.signal, look: 'raw' })).rejects.toMatchObject({
			name: 'AbortError'
		});
		expect(close).toHaveBeenCalledOnce();
	});

	it('disposes earlier images on a partial load failure', async () => {
		const close = vi.fn();
		mocks.decode
			.mockResolvedValueOnce({ width: 2, height: 2, close })
			.mockRejectedValueOnce(new Error('decode failed'));
		await expect(loadStudyTerrain({ look: 'raw' })).rejects.toThrow('decode failed');
		expect(close).toHaveBeenCalledOnce();
	});

	it('defaults to painted albedos, bounds their size and ignores source smoothness alpha', async () => {
		mocks.catalog.mockResolvedValue({ terrain: [entry('soil')] } as StudyCatalog);
		const close = vi.fn();
		mocks.decode.mockResolvedValue({ width: 1024, height: 512, close });
		const pixels = { data: new Uint8ClampedArray([60, 110, 70, 0]) };
		const context = { drawImage: vi.fn(), getImageData: vi.fn(() => pixels), putImageData: vi.fn() };
		const canvas = { width: 0, height: 0, getContext: () => context };
		vi.stubGlobal('document', { createElement: () => canvas });
		const terrain = await loadStudyTerrain();
		if (!terrain) throw new Error('study disabled');
		expect(terrain.look).toBe('painted');
		expect(canvas.width).toBe(256);
		expect(canvas.height).toBe(128);
		expect(pixels.data[3]).toBe(255);
		expect(close).toHaveBeenCalledOnce();
		expect(terrain.textureBytes).toBe(Math.round(256 * 128 * 4 * (4 / 3)));
		terrain.dispose();
		expect(close).toHaveBeenCalledOnce();
	});

	it('replaces a binding without restoring an old study map and leaves unavailable roles alone', async () => {
		const terrain = await loadStudyTerrain({ look: 'raw' });
		if (!terrain) throw new Error('study disabled');
		const original = new Texture();
		const material = new MeshLambertMaterial({ map: original });
		const oldRestore = terrain.apply(material, 'mud');
		terrain.apply(material, 'moss');
		oldRestore();
		expect(material.map).toBe(terrain.layers.moss[0].texture);
		terrain.apply(material, 'sand')();
		expect(material.map).toBe(terrain.layers.moss[0].texture);
		terrain.dispose();
		expect(material.map).toBe(original);
	});
});
