import { BoxGeometry, BufferGeometry, CylinderGeometry, Float32BufferAttribute } from 'three';
import { CollisionWorld } from '../engine/world.ts';
import type { StoryLevel } from '../level/types.ts';
import { BLOCK_SIZE, type SurvivalWorld } from '../survival/types.ts';

/** Vertical thickness keeps the deck's top exactly on the authored endpoints. */
export function deckGeometry(d: ArrayLike<number>): BufferGeometry {
	const [ax, ay, az, bx, by, bz, w, h] = Array.from(d),
		len = Math.hypot(bx - ax, bz - az) || 1;
	const nx = ((bz - az) / len) * w,
		nz = (-(bx - ax) / len) * w;
	const points = [ax - nx, ay, az - nz, ax + nx, ay, az + nz, bx - nx, by, bz - nz, bx + nx, by, bz + nz];
	const g = new BufferGeometry();
	g.setAttribute(
		'position',
		new Float32BufferAttribute([...points, ...points.map((v, i) => (i % 3 === 1 ? v - h : v))], 3)
	);
	g.setIndex([
		0, 2, 1, 1, 2, 3, 4, 5, 6, 5, 7, 6, 0, 1, 4, 1, 5, 4, 2, 6, 3, 3, 6, 7, 0, 4, 2, 2, 4, 6, 1, 3, 5, 3, 7, 5
	]);
	g.computeVertexNormals();
	return g;
}
export interface PropProxy {
	name: string;
	x: number;
	y: number;
	z: number;
	sx: number;
	sy: number;
	sz: number;
	yaw?: number;
}
/** Step-one gray props. Obby/deck colliders already live in world.blocks; do not duplicate them. */
export function prefabProxies(world: SurvivalWorld, level?: StoryLevel): PropProxy[] {
	if (level)
		return level.landmarks
			.filter(
				(l) =>
					![
						'bridge',
						'waterfall',
						'butterflies',
						'observation-rock',
						'mirante',
						'ipe-amarelo',
						'jequitiba',
						'cutting-tree'
					].includes(l.kind)
			)
			.map((l) => ({
				name: l.kind,
				x: l.x,
				y: l.y,
				z: l.z,
				sx: l.kind === 'observation-rock' ? 5.8 : l.kind === 'viveiro' ? 4 : 1.4,
				sy: l.height || (l.kind === 'npc-iara' ? 3 : 2),
				sz: l.kind === 'observation-rock' ? 5.8 : l.kind === 'viveiro' ? 2 : 1.4,
				yaw: Math.atan2(l.yawS, l.yawC)
			}));
	return [
		...world.base.pieces.map((p) => ({
			name: p.kind,
			x: p.x,
			y: p.y,
			z: p.z,
			sx: p.kind === 'tent' ? 3 : 1.5,
			sy: p.kind === 'radio-mast' ? 5 : 1.8,
			sz: 2,
			yaw: Math.atan2(p.yawS, p.yawC)
		})),
		...world.pois.map((p) => ({ name: p.kind, x: p.x + 2.5, y: p.y, z: p.z, sx: 0.6, sy: 2, sz: 0.6 })),
		...world.resources.map((p) => ({ name: p.kind, x: p.x, y: p.y, z: p.z, sx: 1.2, sy: 0.8, sz: 1.2 }))
	];
}
export function propGeometry(p: PropProxy) {
	return new BoxGeometry(p.sx, p.sy, p.sz).rotateY(p.yaw ?? 0).translate(p.x, p.y + p.sy / 2, p.z);
}
/** Each block feeds the existing static BVH. Decoration and canopy never collide. */
export function buildMapCollision(world: SurvivalWorld, props: readonly PropProxy[] = []): CollisionWorld {
	const geometries: BufferGeometry[] = [];
	for (const block of world.blocks) {
		// Refine the block's coarse collision grid from the authored 1 u samples.
		// Otherwise a visible cliff lip between its 2 u samples has no support.
		const side = BLOCK_SIZE + 1,
			step = 1,
			points: number[] = [],
			indices: number[] = [];
		for (let z = 0; z < side; z++)
			for (let x = 0; x < side; x++)
				points.push(
					block.x0 + x * step,
					world.heights[(block.z0 + z) * world.grid + block.x0 + x],
					block.z0 + z * step
				);
		for (let z = 0; z < side - 1; z++)
			for (let x = 0; x < side - 1; x++) {
				const i = z * side + x;
				indices.push(i, i + side, i + 1, i + 1, i + side, i + side + 1);
			}
		const ground = new BufferGeometry();
		ground.setAttribute('position', new Float32BufferAttribute(points, 3));
		ground.setIndex(indices);
		geometries.push(ground);
		for (let i = 0; i < block.cylinders.length; i += 5) {
			const [x, y, z, r, h] = block.cylinders.subarray(i, i + 5);
			geometries.push(new CylinderGeometry(r, r, h, 8).translate(x, y + h / 2, z));
		}
		for (let i = 0; i < block.boxes.length; i += 8) {
			const [x, y, z, hx, hy, hz, c, s] = block.boxes.subarray(i, i + 8);
			geometries.push(new BoxGeometry(hx * 2, hy * 2, hz * 2).rotateY(Math.atan2(s, c)).translate(x, y, z));
		}
		for (let i = 0; i < block.decks.length; i += 8)
			geometries.push(deckGeometry(block.decks.subarray(i, i + 8)));
	}
	for (const p of props) geometries.push(propGeometry(p));
	// Physical edge rails are invisible; a child cannot walk off the authored square.
	for (const [x, z, sx, sz] of [
		[0, world.size / 2, 1, world.size],
		[world.size, world.size / 2, 1, world.size],
		[world.size / 2, 0, world.size, 1],
		[world.size / 2, world.size, world.size, 1]
	])
		geometries.push(new BoxGeometry(sx, 80, sz).translate(x, 20, z));
	try {
		return new CollisionWorld(geometries.map((geometry) => ({ geometry })));
	} finally {
		for (const g of geometries) g.dispose();
	}
}
