import { readFileSync } from 'node:fs';
import { BoxGeometry, Group, Mesh, MeshLambertMaterial } from 'three';
import { expect, it, vi } from 'vitest';
import { HAIR_DANGLES } from '../animation/hair-sway.ts';
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
it("shows a style's dangling parts at their pivots and hides them for other styles", () => {
	const source = new Group(),
		head = new Group();
	const braids = new Mesh(new BoxGeometry(), new MeshLambertMaterial());
	braids.name = 'hair-braids';
	source.add(braids);
	const pivots: [number, number, number][] = [
		[0.32, 0.78, -0.22],
		[-0.32, 0.78, -0.22]
	];
	for (const [i, pivot] of pivots.entries()) {
		const part = new Mesh(new BoxGeometry(0.1, 0.7, 0.1), new MeshLambertMaterial());
		part.name = i === 0 ? 'hair-braids-left' : 'hair-braids-right';
		part.position.set(...pivot);
		braids.add(part);
	}
	const long = new Mesh(new BoxGeometry(), new MeshLambertMaterial());
	long.name = 'hair-long';
	source.add(long);
	const hair = new HairAccessories(source, head, [
		{ id: 'trancas', name: 'Tranças', mesh: 'hair-braids', tint: 'hair' },
		{ id: 'longo', name: 'Longo', mesh: 'hair-long', tint: 'hair' }
	]);
	expect(hair.dangles).toHaveLength(2);
	hair.apply('trancas', { hair: '#5e4330', shirt: '#2f7fb0' });
	for (const [i, dangle] of hair.dangles.entries()) {
		expect(dangle.visible).toBe(true);
		expect(dangle.parent).toBe(hair.mesh);
		expect(dangle.position.toArray()).toEqual(pivots[i]);
		expect(dangle.geometry).toBe((braids.children[i] as Mesh).geometry);
		expect(dangle.material).toBe(hair.mesh.material);
	}
	hair.dangles[0].rotation.x = 0.5;
	hair.apply('longo', { hair: '#5e4330', shirt: '#2f7fb0' });
	expect(hair.dangles.every((dangle) => !dangle.visible)).toBe(true);
	hair.apply('trancas', { hair: '#5e4330', shirt: '#2f7fb0' });
	expect(hair.dangles[0].rotation.x).toBe(0);
	hair.dispose();
	expect(head.children).toHaveLength(0);
});
it('the produced accessories keep all six named styles within 80 triangles each', () => {
	const data = readFileSync(new URL('../assets/models/avatar-hair.glb', import.meta.url));
	const glb = JSON.parse(data.subarray(20, 20 + data.readUInt32LE(12)).toString());
	type Node = { name: string; mesh?: number; children?: number[]; translation?: number[] };
	const nodes: Node[] = glb.nodes;
	const top = glb.scenes[glb.scene ?? 0].nodes.map((i: number) => nodes[i]);
	expect(top.map((n: Node) => n.name).sort()).toEqual([
		'cap',
		'hair-afro',
		'hair-braids',
		'hair-bun',
		'hair-long',
		'hair-ponytail'
	]);
	// Contract v3: the dangling parts are child nodes, with their origins at HairSway's pivots.
	const children = Object.fromEntries(
		top.map((n: Node) => [n.name, (n.children ?? []).map((i) => nodes[i])])
	) as Record<string, Node[]>;
	for (const [style, parent] of [
		['rabo', 'hair-ponytail'],
		['trancas', 'hair-braids'],
		['coque', 'hair-bun']
	] as const) {
		expect(children[parent].map((n) => n.name)).toEqual(HAIR_DANGLES[style].map((d) => d.node));
		expect(children[parent].map((n) => n.translation)).toEqual(HAIR_DANGLES[style].map((d) => [...d.pivot]));
	}
	for (const name of ['cap', 'hair-afro', 'hair-long']) expect(children[name]).toEqual([]);
	const triangles = (node: Node): number =>
		(node.mesh === undefined
			? 0
			: glb.meshes[node.mesh].primitives.reduce(
					(sum: number, p: { indices: number }) => sum + glb.accessors[p.indices].count / 3,
					0
				)) + (node.children ?? []).reduce((sum, i) => sum + triangles(nodes[i]), 0);
	for (const node of top) expect(triangles(node)).toBeLessThanOrEqual(80);
});
