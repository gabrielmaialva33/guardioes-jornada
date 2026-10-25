import {
	BoxGeometry,
	BufferGeometry,
	CylinderGeometry,
	Float32BufferAttribute,
	Group,
	Matrix4,
	Mesh,
	type MeshLambertMaterial,
	RingGeometry,
	Shape,
	ShapeGeometry
} from 'three';
import type { Checkpoint } from '../engine/checkpoints.ts';
import type { StoryLevel } from '../level/types.ts';
import { mergePieces } from '../render/index.ts';
import { ensureVertexColors } from '../scene/materials.ts';

import { BLOCK_SIZE, type SurvivalWorld } from '../survival/types.ts';
import { boundaryTerrain } from './boundary.ts';
import { deckGeometry, prefabProxies, propGeometry } from './collision.ts';
import { createMapMaterials } from './materials.ts';
import { terrainChunk } from './terrain.ts';

export function createMapVisual(
	world: SurvivalWorld,
	level?: StoryLevel,
	pads: readonly Checkpoint[] = level ? [level.start, ...level.checkpoints] : []
) {
	const object = new Group();
	const ownedGeometries: BufferGeometry[] = [];
	const materials = createMapMaterials();
	const { ground: groundMaterial, rock, wood, proxy: gray, checkpoint: gold } = materials;
	const add = (geometry: BufferGeometry, m: MeshLambertMaterial) => {
		ensureVertexColors(geometry);
		ownedGeometries.push(geometry);
		const mesh = new Mesh(geometry, m);
		object.add(mesh);
		return mesh;
	};
	for (const b of world.blocks) {
		const mesh = add(terrainChunk(world, b, level?.trails), groundMaterial);
		mesh.name = `terrain-${b.index}`;
	}
	for (const geometry of boundaryTerrain(world)) {
		const mesh = add(geometry, groundMaterial);
		mesh.name = 'terrain-exterior';
	}
	// Join the ribbon at shared control-point cross sections, with no independently overlapping segments.
	const p: number[] = [],
		indices: number[] = [];
	world.river.points.forEach((point, i) => {
		const a = world.river.points[Math.max(0, i - 1)],
			b = world.river.points[Math.min(world.river.points.length - 1, i + 1)];
		const dx = b.x - a.x,
			dz = b.z - a.z,
			k = world.river.halfWidth / (Math.hypot(dx, dz) || 1);
		p.push(point.x - dz * k, point.water, point.z + dx * k, point.x + dz * k, point.water, point.z - dx * k);
		if (i > 0) {
			const n = 2 * i;
			indices.push(n - 2, n, n - 1, n - 1, n, n + 1);
		}
	});
	const water = new BufferGeometry();
	water.setAttribute('position', new Float32BufferAttribute(p, 3));
	water.setIndex(indices);
	water.computeVertexNormals();
	const waterMaterial = materials.water;
	add(water, waterMaterial);
	if (level?.pool) {
		const pool = level.pool;
		const points: number[] = [pool.x, pool.water + 0.005, pool.z],
			faces: number[] = [];
		for (let i = 0; i <= 48; i++) {
			const t = (i / 48) * Math.PI * 2,
				along = Math.cos(t) * pool.halfLength,
				across = Math.sin(t) * pool.halfWidth;
			points.push(
				pool.x + along * pool.axisX - across * pool.axisZ,
				pool.water + 0.005,
				pool.z + along * pool.axisZ + across * pool.axisX
			);
			if (i) faces.push(0, i, i + 1);
		}
		const g = new BufferGeometry();
		g.setAttribute('position', new Float32BufferAttribute(points, 3));
		g.setIndex(faces);
		g.computeVertexNormals();
		add(g, waterMaterial);
	}
	// Every bridge/stone is drawn at the same authored top as its collider.
	for (const c of world.crossings) {
		if (c.kind !== 'stepping-stones')
			add(deckGeometry([c.from.x, c.from.y, c.from.z, c.to.x, c.to.y, c.to.z, c.halfWidth, 0.3]), wood);
		for (const s of c.stones) {
			const height = s.y - (c.water - world.river.depth);
			add(new CylinderGeometry(s.r, s.r * 1.1, height, 8).translate(s.x, s.y - height / 2, s.z), rock);
		}
	}
	if (level)
		for (const obby of level.obbies)
			if (obby.id === 'ledges')
				for (const p of obby.pieces) {
					// Graybox geometry shows the exact support volume used by the authored collider.
					add(
						new BoxGeometry(p.radius * 2, Math.max(0.1, p.y - p.bottom), p.radius * 2)
							.rotateY(Math.atan2(p.yawS, p.yawC))
							.translate(p.x, (p.y + p.bottom) / 2, p.z),
						p.variant === 'rock' ? rock : wood
					);
				}
	const grayByBlock = new Map<number, BufferGeometry[]>();
	const props = prefabProxies(world, level);
	for (const p of props) {
		const b = Math.floor(p.z / BLOCK_SIZE) * 4 + Math.floor(p.x / BLOCK_SIZE),
			bucket = grayByBlock.get(b) ?? [];
		bucket.push(propGeometry(p));
		grayByBlock.set(b, bucket);
	}
	if (level) {
		for (const t of level.triggers)
			if (t.kind === 'trap' || t.kind === 'logger') {
				const b = Math.floor(t.z / BLOCK_SIZE) * 4 + Math.floor(t.x / BLOCK_SIZE),
					bucket = grayByBlock.get(b) ?? [];
				bucket.push(new BoxGeometry(1, 0.7, 1).translate(t.x, t.y + 0.35, t.z));
				grayByBlock.set(b, bucket);
			}
		for (const c of level.collectibles) {
			const b = Math.floor(c.z / BLOCK_SIZE) * 4 + Math.floor(c.x / BLOCK_SIZE),
				bucket = grayByBlock.get(b) ?? [];
			bucket.push(new BoxGeometry(0.4, 0.5, 0.4).translate(c.x, c.y + 0.25, c.z));
			grayByBlock.set(b, bucket);
		}
	}
	for (const geometries of grayByBlock.values()) {
		add(mergePieces(geometries.map((geometry) => ({ geometry, matrix: new Matrix4() }))), gray);
		for (const g of geometries) g.dispose();
	}
	const checkpoints = pads;
	for (const c of checkpoints)
		add(
			new RingGeometry(1.1, 1.35, 24).rotateX(-Math.PI / 2).translate(c.spawn.x, c.spawn.y + 0.04, c.spawn.z),
			gold
		);
	const shape = new Shape();
	shape.moveTo(0, 1.4);
	shape.lineTo(-0.7, 0.3);
	shape.lineTo(-0.26, 0.3);
	shape.lineTo(-0.26, -0.65);
	shape.lineTo(0.26, -0.65);
	shape.lineTo(0.26, 0.3);
	shape.lineTo(0.7, 0.3);
	shape.closePath();
	const arrowMaterial = materials.arrow;
	const arrow = add(new ShapeGeometry(shape).rotateX(-Math.PI / 2), arrowMaterial);
	arrow.renderOrder = 2;
	return {
		object,
		props,
		update(x: number, y: number, z: number, target: { x: number; z: number }) {
			arrow.position.set(x, y + 0.08, z);
			arrow.rotation.y = Math.atan2(target.x - x, target.z - z) + Math.PI;
		},
		dispose() {
			for (const g of ownedGeometries) g.dispose();
			materials.dispose();
			object.removeFromParent();
			object.clear();
		}
	};
}
