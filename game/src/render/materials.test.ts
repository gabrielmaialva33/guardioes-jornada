import { LinearFilter, LinearMipmapLinearFilter, MeshStandardMaterial, Texture } from 'three';
import { expect, it } from 'vitest';
import { houseMaterial } from './materials.ts';

it('keeps a shared painted atlas linear with mipmaps when rocks are converted after vegetation', () => {
	const map = new Texture();
	map.image = { width: 512, height: 512 };
	const plant = new MeshStandardMaterial({ map }),
		rock = new MeshStandardMaterial({ map });
	plant.userData.vegetation = true;
	const a = houseMaterial(plant),
		b = houseMaterial(rock);
	expect(a.map).toBe(b.map);
	expect(map.magFilter).toBe(LinearFilter);
	expect(map.minFilter).toBe(LinearMipmapLinearFilter);
	expect(map.generateMipmaps).toBe(true);
	a.dispose();
	b.dispose();
	plant.dispose();
	rock.dispose();
	map.dispose();
});
