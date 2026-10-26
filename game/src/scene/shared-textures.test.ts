import { BoxGeometry, Group, Mesh, MeshLambertMaterial, Texture } from 'three';
import { expect, it, vi } from 'vitest';
import { SharedModelTextures } from './shared-textures.ts';

it('shares declared identical external atlas names without merging distinct maps or disposing the live atlas', () => {
	const maps = Array.from({ length: 4 }, () => new Texture());
	maps[0].name = maps[1].name = 'foliage-atlas';
	maps[2].name = 'trees-atlas';
	maps[3].name = 'PaletteBaseColor';
	const disposed = maps.map((t) => vi.spyOn(t, 'dispose')),
		root = new Group();
	root.add(...maps.map((map) => new Mesh(new BoxGeometry(), new MeshLambertMaterial({ map }))));
	new SharedModelTextures().adopt(root);
	expect((root.children[1] as Mesh<BoxGeometry, MeshLambertMaterial>).material.map).toBe(maps[0]);
	expect(disposed[0]).not.toHaveBeenCalled();
	expect(disposed[1]).toHaveBeenCalledOnce();
	expect(disposed[2]).not.toHaveBeenCalled();
	expect(disposed[3]).not.toHaveBeenCalled();
});
