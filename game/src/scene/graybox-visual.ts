import { type BufferGeometry, Group, Matrix4, Mesh } from 'three';
import { type Graybox, proxyGeometry } from '../engine/graybox.ts';
import { mergePieces } from '../render/index.ts';
import { paletteMaterial, proxyColor } from './materials.ts';

export function createGrayboxVisual(level: Graybox) {
	const object = new Group();
	const groups = new Map<string, BufferGeometry[]>();
	const identity = new Matrix4();
	for (const proxy of level.proxies) {
		// The model supplies the visible trunk; these boxes only feed the capsule BVH.
		if (proxy.name.startsWith('forest-trunk-')) continue;
		const color = proxyColor(proxy.name, proxy.kind);
		const bucket = groups.get(color) ?? [];
		bucket.push(proxyGeometry(proxy));
		groups.set(color, bucket);
	}
	for (const [color, geometries] of groups) {
		const geometry = mergePieces(geometries.map((geometry) => ({ geometry, matrix: identity })));
		for (const source of geometries) source.dispose();
		object.add(new Mesh(geometry, paletteMaterial(color)));
	}
	return {
		object,
		dispose() {
			for (const child of object.children)
				if (child instanceof Mesh) {
					child.geometry.dispose();
					child.material.map?.dispose();
					child.material.dispose();
				}
			object.removeFromParent();
			object.clear();
		}
	};
}
