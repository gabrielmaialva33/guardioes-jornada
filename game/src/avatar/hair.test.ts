import { readFileSync } from 'node:fs';
import { BoxGeometry, Group, Mesh, MeshLambertMaterial } from 'three';
import { expect, it, vi } from 'vitest';
import type { HairStyle } from './atlas.ts';
import { HairAccessories } from './hair.ts';

const styles: HairStyle[] = [
	{ id: 'curto', name: 'Curto', mesh: null, tint: 'hair' as const },
	{ id: 'longo', name: 'Longo', mesh: 'hair-long', tint: 'hair' as const },
	{ id: 'bone', name: 'Boné', mesh: 'cap', tint: 'shirt' as const }
];
it('swaps one head child with shared geometry, tints hair/cap and follows head animation', () => {
	const source = new Group(),
		head = new Group();
	for (const name of ['hair-long', 'cap']) {
		const m = new Mesh(new BoxGeometry(), new MeshLambertMaterial());
		m.name = name;
		source.add(m);
	}
	const hair = new HairAccessories(source, head, styles);
	hair.apply('longo', { hair: '#5e4330', shirt: '#2f7fb0' });
	expect(head.children).toHaveLength(1);
	const long = source.getObjectByName('hair-long');
	if (!(long instanceof Mesh)) throw new Error('hair-fixture');
	expect(hair.mesh.geometry).toBe(long.geometry);
	const material = hair.mesh.material;
	const old = hair.mesh.geometry;
	hair.apply('bone', { hair: '#5e4330', shirt: '#2f7fb0' });
	expect(hair.mesh.geometry).not.toBe(old);
	expect(hair.mesh.material).toBe(material);
	expect(material.color.getHexString()).toBe('2f7fb0');
	head.rotation.y = 0.4;
	head.updateMatrixWorld(true);
	expect(hair.mesh.matrixWorld.elements[0]).toBeCloseTo(Math.cos(0.4));
	hair.apply('curto', { hair: '#5e4330', shirt: '#2f7fb0' });
	expect(hair.mesh.visible).toBe(false);
	const dispose = vi.spyOn(material, 'dispose');
	hair.dispose();
	expect(head.children).toHaveLength(0);
	expect(dispose).toHaveBeenCalledOnce();
});
it('the produced accessories keep all six named styles within 80 triangles each', () => {
	const data = readFileSync(new URL('../assets/models/avatar-hair.glb', import.meta.url));
	const glb = JSON.parse(data.subarray(20, 20 + data.readUInt32LE(12)).toString());
	expect(glb.nodes.map((n: { name: string }) => n.name).sort()).toEqual([
		'cap',
		'hair-afro',
		'hair-braids',
		'hair-bun',
		'hair-long',
		'hair-ponytail'
	]);
	for (const mesh of glb.meshes) {
		let triangles = 0;
		for (const p of mesh.primitives) triangles += glb.accessors[p.indices].count / 3;
		expect(triangles).toBeLessThanOrEqual(80);
	}
});
