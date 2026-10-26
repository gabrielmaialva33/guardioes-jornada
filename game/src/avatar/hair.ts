import { type BufferGeometry, type Group, Mesh, MeshLambertMaterial, type Object3D } from 'three';
import { stylize } from '../render/stylized.ts';
import { ensureVertexColors } from '../scene/materials.ts';
import type { HairStyle } from './atlas.ts';

/** One child/material, shared source geometries. Head animation supplies the entire accessory transform. */
export class HairAccessories {
	readonly mesh: Mesh<BufferGeometry, MeshLambertMaterial>;
	readonly #styles: readonly HairStyle[];
	readonly #geometries = new Map<string, BufferGeometry>();
	constructor(source: Group, head: Object3D, styles: readonly HairStyle[]) {
		this.#styles = styles;
		for (const style of styles) {
			if (style.mesh === null) continue;
			const node = source.getObjectByName(style.mesh);
			if (!(node instanceof Mesh)) throw new Error('avatar-hair-missing');
			ensureVertexColors(node.geometry);
			this.#geometries.set(style.id, node.geometry);
		}
		const first = this.#geometries.values().next().value;
		if (!first) throw new Error('avatar-hair-empty');
		this.mesh = new Mesh(
			first,
			stylize(new MeshLambertMaterial({ flatShading: true, vertexColors: true }), { rim: true })
		);
		this.mesh.name = 'avatar-hair-accessory';
		this.mesh.visible = false;
		head.add(this.mesh);
	}
	apply(id: string, colors: { hair: string; shirt: string }) {
		const style = this.#styles.find((s) => s.id === id);
		const geometry = this.#geometries.get(id);
		this.mesh.visible = !!geometry;
		if (geometry) this.mesh.geometry = geometry;
		this.mesh.material.color.set(colors[style?.tint ?? 'hair']);
	}
	dispose() {
		this.mesh.removeFromParent();
		this.mesh.material.dispose();
	}
}
