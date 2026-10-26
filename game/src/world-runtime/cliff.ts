import {
	type BufferGeometry,
	Color,
	CylinderGeometry,
	Float32BufferAttribute,
	IcosahedronGeometry,
	Quaternion,
	Vector3
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { StoryLevel } from '../level/types.ts';
import { RAMPS } from '../style/palette.ts';
import type { CollisionBlock, SurvivalWorld } from '../survival/types.ts';
import { terrainHeight } from './paths.ts';

/** Render-only outcrops/roots are folded into their terrain block, with no new draw or collision. */
export function cliffDressing(
	world: SurvivalWorld,
	block: Pick<CollisionBlock, 'x0' | 'z0'>,
	level?: StoryLevel
): BufferGeometry | null {
	if (!level) return null;
	const parts: BufferGeometry[] = [],
		color = new Color(),
		mossColor = new Color(RAMPS.grass[1]),
		a = new Vector3(),
		b = new Vector3(),
		direction = new Vector3(),
		up = new Vector3(0, 1, 0),
		rotation = new Quaternion();
	const finish = (g: BufferGeometry, hex: string, moss = false) => {
		g.deleteAttribute('uv');
		const p = g.getAttribute('position'),
			n = g.getAttribute('normal'),
			colors: number[] = [],
			shore = new Float32Array(p.count * 2);
		for (let i = 0; i < p.count; i++) {
			color.set(hex);
			if (moss && n.getY(i) > 0.15) color.lerp(mossColor, Math.min(0.8, n.getY(i) * 0.8));
			color.multiplyScalar(0.92 + 0.08 * Math.sin(p.getY(i) * 1.1 + p.getZ(i)));
			colors.push(color.r, color.g, color.b);
			shore[i * 2] = -10000;
			shore[i * 2 + 1] = 10000;
		}
		g.setAttribute('color', new Float32BufferAttribute(colors, 3));
		g.setAttribute('shore', new Float32BufferAttribute(shore, 2));
		if (!g.index) g.setIndex(Array.from({ length: p.count }, (_, i) => i));
		parts.push(g);
	};
	for (let z = 18; z <= 101; z += 2.7) {
		let edge = 118;
		while (edge < 142 && terrainHeight(world, edge, z) < 14.5) edge++;
		if (edge === 142) continue;
		const x = edge - 0.3;
		if (x < block.x0 || x >= block.x0 + 40 || z < block.z0 || z >= block.z0 + 40) continue;
		// A generous exclusion leaves both the capsule and the camera clear above every authored ledge.
		if (level.obbies.some((o) => o.pieces.some((p) => Math.hypot(p.x - x, p.z - z) < p.radius + 3.5)))
			continue;
		const top = terrainHeight(world, edge, z),
			phase = Math.sin(z * 2.13);
		for (const band of [0, 1, 2]) {
			const y = top - (band === 0 ? 0.45 : band === 1 ? 3.5 : 6.5) - phase * 0.45;
			finish(
				new IcosahedronGeometry(1, 0)
					.scale(1.3 + Math.abs(phase) * 0.25, 1.05 + band * 0.25, 1.8 + Math.abs(phase) * 0.25)
					.rotateY(z)
					.translate(x + 0.1, y, z),
				RAMPS.rock[band ? 1 : 2],
				true
			);
		}
		if (phase > 0.1) {
			a.set(x + 0.4, top + 0.05, z);
			b.set(x - 0.35, top - 2.4 - phase, z + 0.4);
			const g = new CylinderGeometry(0.035, 0.085, a.distanceTo(b), 5, 3);
			g.applyQuaternion(rotation.setFromUnitVectors(up, direction.subVectors(b, a).normalize())).translate(
				(a.x + b.x) / 2,
				(a.y + b.y) / 2,
				(a.z + b.z) / 2
			);
			finish(g, RAMPS.wood[1]);
		}
	}
	if (!parts.length) return null;
	const merged = mergeGeometries(parts, false);
	for (const g of parts) g.dispose();
	return merged;
}
