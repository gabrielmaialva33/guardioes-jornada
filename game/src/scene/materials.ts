import {
	type BufferGeometry,
	DataTexture,
	Float32BufferAttribute,
	MeshLambertMaterial,
	NearestFilter,
	SRGBColorSpace
} from 'three';
import { ACCENT, RAMPS } from '../style/palette.ts';

/** Preserve COLOR_0 from the AO bake; proxies without a bake multiply by white. */
export function ensureVertexColors(geometry: BufferGeometry) {
	if (!geometry.getAttribute('color'))
		geometry.setAttribute(
			'color',
			new Float32BufferAttribute(new Float32Array(geometry.getAttribute('position').count * 3).fill(1), 3)
		);
}
export function proxyColor(name: string, kind: string): string {
	if (name === 'ground') return RAMPS.grass[2];
	if (name.endsWith('-pad')) return ACCENT.gold;
	if (kind === 'log' || name.startsWith('obby-') || name.includes('bridge')) return RAMPS.wood[2];
	return RAMPS.rock[2];
}
/** One shared one-pixel palette swatch per colour, with no filtered/mipmapped edge. */
export function paletteMaterial(hex: string) {
	const value = Number.parseInt(hex.slice(1), 16);
	const map = new DataTexture(new Uint8Array([value >> 16, (value >> 8) & 255, value & 255, 255]), 1, 1);
	map.colorSpace = SRGBColorSpace;
	map.magFilter = map.minFilter = NearestFilter;
	map.generateMipmaps = false;
	map.needsUpdate = true;
	return new MeshLambertMaterial({ map, flatShading: true, vertexColors: true });
}
