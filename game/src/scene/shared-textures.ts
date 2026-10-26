/** Share the explicitly named external atlases within one disposable model batch. */
import { type Group, Mesh, Texture } from 'three';
export class SharedModelTextures {
	readonly #atlases = new Map<string, Texture>();
	adopt(model: Group) {
		model.traverse((node) => {
			if (!(node instanceof Mesh)) return;
			for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
				if (!('map' in material)) continue;
				const texture = material.map;
				if (!(texture instanceof Texture) || !/^(foliage|trees|decor)-atlas$/.test(texture.name)) continue;
				const key = `${texture.name}:${texture.flipY}:${texture.wrapS}:${texture.wrapT}`,
					shared = this.#atlases.get(key);
				if (!shared) {
					this.#atlases.set(key, texture);
					continue;
				}
				if (shared === texture) continue;
				material.map = shared;
				texture.dispose();
				if (
					typeof ImageBitmap !== 'undefined' &&
					texture.image instanceof ImageBitmap &&
					texture.image !== shared.image
				)
					texture.image.close();
			}
		});
	}
}
