import { BoxGeometry, Float32BufferAttribute, NearestFilter, SRGBColorSpace } from 'three';
import { expect, it } from 'vitest';
import { ACCENT, RAMPS } from '../style/palette.ts';
import { ensureVertexColors, paletteMaterial, proxyColor } from './materials.ts';

it('keeps baked AO and supplies white vertex colours only when absent', () => {
	const geometry = new BoxGeometry();
	ensureVertexColors(geometry);
	expect(geometry.getAttribute('color').getX(0)).toBe(1);
	const ao = new Float32BufferAttribute(
		new Float32Array(geometry.getAttribute('position').count * 3).fill(0.5),
		3
	);
	geometry.setAttribute('color', ao);
	ensureVertexColors(geometry);
	expect(geometry.getAttribute('color')).toBe(ao);
	geometry.dispose();
});
it('uses palette textures and reserves gold for checkpoints', () => {
	expect(proxyColor('ground', 'box')).toBe(RAMPS.grass[2]);
	expect(proxyColor('obby-1', 'box')).toBe(RAMPS.wood[2]);
	expect(proxyColor('summit-pad', 'box')).toBe(ACCENT.gold);
	const material = paletteMaterial(RAMPS.wood[2]);
	expect(material.vertexColors && material.flatShading).toBe(true);
	expect(material.map?.colorSpace).toBe(SRGBColorSpace);
	expect(material.map?.minFilter).toBe(NearestFilter);
	expect(material.map?.generateMipmaps).toBe(false);
	material.map?.dispose();
	material.dispose();
});
