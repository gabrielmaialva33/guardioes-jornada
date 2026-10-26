import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

for (const name of [
	'ipe-amarelo',
	'ipe-rosa',
	'pau-brasil',
	'jequitiba-rosa',
	'jeriva',
	'palmeira-jucara',
	'mangue-vermelho'
])
	it(`${name} keeps separate LOD nodes, volume normals and alpha-MASK after compression`, () => {
		const bytes = readFileSync(new URL(`../assets/models/trees/tree-${name}.glb`, import.meta.url));
		const length = bytes.readUInt32LE(12);
		const glb = JSON.parse(bytes.subarray(20, 20 + length).toString());
		const nodes = glb.nodes.map((n: { name: string }) => n.name);
		expect(nodes).toContain(`tree-${name}-lod0`);
		expect(nodes).toContain(`tree-${name}-lod1`);
		for (const m of glb.materials) {
			expect(m.alphaMode).toBe('MASK');
			expect(m.alphaCutoff).toBe(0.5);
			expect(m.doubleSided).toBe(true);
		}
		for (const mesh of glb.meshes)
			for (const p of mesh.primitives) expect(p.attributes.NORMAL).toBeTypeOf('number');
	});
