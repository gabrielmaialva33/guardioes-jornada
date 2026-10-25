import type { ColliderProxy } from '../engine/graybox.ts';
import type { PlacementArrays } from '../render/index.ts';

export const FOREST_KINDS = [
	'embauba',
	'jequitiba-rosa',
	'ipe-amarelo',
	'ipe-rosa',
	'palmeira-jucara',
	'araucaria'
] as const;
export type ForestKind = (typeof FOREST_KINDS)[number];
/** A small render integration clearing; leave every graybox feature and the obby approach free. */
export function forestLayout() {
	const positions: [number, number][] = [];
	for (const x of [-36, 36]) for (const z of [-24, -12, 0, 14, 28, 36]) positions.push([x, z]);
	for (const x of [-24, -12, 0, 12, 24]) positions.push([x, -25]);
	for (const x of [-24, -12, 12, 24]) positions.push([x, 36]);
	positions.sort(
		(a, b) =>
			Math.floor((a[1] + 40) / 40) * 2 +
			Math.floor((a[0] + 40) / 40) -
			(Math.floor((b[1] + 40) / 40) * 2 + Math.floor((b[0] + 40) / 40))
	);
	const count = positions.length;
	const placements: PlacementArrays<ForestKind> = {
		kinds: FOREST_KINDS,
		count,
		kind: Uint8Array.from(positions, (_, i) => i % FOREST_KINDS.length),
		x: Float32Array.from(positions, (p) => p[0]),
		y: new Float32Array(count),
		z: Float32Array.from(positions, (p) => p[1]),
		scale: new Float32Array(count).fill(1),
		yawC: Float32Array.from(positions, (_, i) => Math.cos(i * 2.4)),
		yawS: Float32Array.from(positions, (_, i) => Math.sin(i * 2.4))
	};
	const colliders: ColliderProxy[] = positions.map(([x, z], i) => ({
		kind: 'box',
		name: `forest-trunk-${i}`,
		center: [x, 4.25, z],
		size: [0.8, 8.5, 0.8]
	}));
	return { placements, colliders };
}
