import {
	type BufferGeometry,
	type Group,
	Mesh,
	MeshLambertMaterial,
	type Object3D,
	type Vector3
} from 'three';
import { stylize } from '../render/stylized.ts';
import { ensureVertexColors } from '../scene/materials.ts';
import type { HairStyle } from './atlas.ts';

/**
 * One child/material, shared source geometries. Head animation supplies the entire accessory transform;
 * a style's dangling parts (contract v3) are children of it at their pivots, at rest until swung.
 */
export class HairAccessories {
	readonly mesh: Mesh<BufferGeometry, MeshLambertMaterial>;
	readonly #styles: readonly HairStyle[];
	readonly #geometries = new Map<string, BufferGeometry>();
	/**
	 * The visible style's dangling parts (contract v3: tail, braids, bun knot), children
	 * of `mesh` at their pivots; the runtime sets their YXZ rotation from HairSway each frame.
	 */
	readonly dangles: Mesh<BufferGeometry, MeshLambertMaterial>[] = [];
	readonly #parts = new Map<string, { geometry: BufferGeometry; pivot: Vector3 }[]>();
	constructor(source: Group, head: Object3D, styles: readonly HairStyle[]) {
		this.#styles = styles;
		for (const style of styles) {
			if (style.mesh === null) continue;
			const node = source.getObjectByName(style.mesh);
			if (!(node instanceof Mesh)) throw new Error('avatar-hair-missing');
			ensureVertexColors(node.geometry);
			this.#geometries.set(style.id, node.geometry);
			const parts = node.children.filter((child): child is Mesh => child instanceof Mesh);
			for (const part of parts) ensureVertexColors(part.geometry);
			this.#parts.set(
				style.id,
				parts.map((part) => ({ geometry: part.geometry, pivot: part.position }))
			);
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
		const most = Math.max(0, ...[...this.#parts.values()].map((parts) => parts.length));
		for (let i = 0; i < most; i++) {
			const dangle = new Mesh(first, this.mesh.material);
			dangle.name = `avatar-hair-dangle-${i}`;
			dangle.rotation.order = 'YXZ';
			dangle.visible = false;
			this.mesh.add(dangle);
			this.dangles.push(dangle);
		}
	}
	apply(id: string, colors: { hair: string; shirt: string }) {
		const style = this.#styles.find((s) => s.id === id);
		const geometry = this.#geometries.get(id);
		this.mesh.visible = !!geometry;
		if (geometry) this.mesh.geometry = geometry;
		this.mesh.material.color.set(colors[style?.tint ?? 'hair']);
		const parts = this.#parts.get(id) ?? [];
		this.dangles.forEach((dangle, i) => {
			const part = parts[i];
			dangle.visible = part !== undefined;
			dangle.rotation.set(0, 0, 0);
			if (part) {
				dangle.geometry = part.geometry;
				dangle.position.copy(part.pivot);
			}
		});
	}
	dispose() {
		this.mesh.removeFromParent();
		this.mesh.material.dispose();
	}
}
