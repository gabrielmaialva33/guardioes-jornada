import { BoxGeometry, Color, Float32BufferAttribute } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RAMPS } from '../style/palette.ts';
import type { PropProxy } from './collision.ts';

/** Approved provisional P21 station: one deck shared with the future westbound zipline. */
export const OVERLOOK = {
	x0: 128,
	x1: 134,
	z0: 81.5,
	z1: 86.5,
	y: 15,
	gap0: 83,
	gap1: 85,
	railHeight: 1.4
} as const;
export function overlookColliders(): PropProxy[] {
	return [
		{ name: 'overlook-floor', x: 131, y: 14.88, z: 84, sx: 6, sy: 0.12, sz: 5 },
		{ name: 'overlook-north', x: 131, y: 15, z: 81.5, sx: 6, sy: 1.4, sz: 0.12 },
		{ name: 'overlook-south', x: 131, y: 15, z: 86.5, sx: 6, sy: 1.4, sz: 0.12 },
		{ name: 'overlook-east', x: 134, y: 15, z: 84, sx: 0.12, sy: 1.4, sz: 5 },
		{ name: 'overlook-west-north', x: 128, y: 15, z: 82.25, sx: 0.12, sy: 1.4, sz: 1.5 },
		{ name: 'overlook-west-south', x: 128, y: 15, z: 85.75, sx: 0.12, sy: 1.4, sz: 1.5 }
	];
}
/** Static wood is joined to the trail batch, not an additional mesh/material draw. */
export function overlookGeometry() {
	const parts: BoxGeometry[] = [];
	const box = (x: number, y: number, z: number, sx: number, sy: number, sz: number, hex: string) => {
		const g = new BoxGeometry(sx, sy, sz).translate(x, y, z),
			c = new Color(hex),
			count = g.getAttribute('position').count,
			colors = new Float32Array(count * 3);
		for (let i = 0; i < count; i++) {
			colors[i * 3] = c.r;
			colors[i * 3 + 1] = c.g;
			colors[i * 3 + 2] = c.b;
		}
		g.deleteAttribute('uv');
		g.setAttribute('color', new Float32BufferAttribute(colors, 3));
		g.setAttribute('trail', new Float32BufferAttribute(new Float32Array(count * 2), 2));
		parts.push(g);
	};
	for (let i = 0; i < 10; i++)
		box(131, 14.95, 81.75 + i * 0.5, 6, 0.1, 0.47, RAMPS.wood[i % 3 === 0 ? 1 : 2]);
	for (const p of overlookColliders().slice(1)) box(p.x, 16.1, p.z, p.sx, 0.18, p.sz, RAMPS.wood[1]);
	for (const [x, z] of [
		[128, 81.56],
		[131, 81.56],
		[133.94, 81.56],
		[128, 86.44],
		[131, 86.44],
		[133.94, 86.44],
		[133.94, 84],
		[128, 82.94],
		[128, 85.06]
	])
		box(x, 15.7, z, 0.12, 1.4, 0.12, RAMPS.wood[2]);
	const merged = mergeGeometries(parts, false);
	for (const g of parts) g.dispose();
	if (!merged) throw new Error('overlook-geometry');
	return merged;
}
