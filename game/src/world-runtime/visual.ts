import type { PerspectiveCamera } from 'three';
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
import type { Quality } from '../render/index.ts';
import { mergePieces } from '../render/index.ts';
import { lighting, visualStep } from '../render/stylized.ts';
import { ensureVertexColors } from '../scene/materials.ts';
import { BLOCK_SIZE, type SurvivalWorld } from '../survival/types.ts';
import { createAtmosphere } from './atmosphere.ts';
import { boundaryTerrain } from './boundary.ts';
import { bakeCanopy } from './canopy.ts';
import { deckGeometry, prefabProxies, propGeometry } from './collision.ts';
import { createFarTerrain, detailDistances } from './far-field.ts';
import { createMapMaterials } from './materials.ts';
import { terrainChunk } from './terrain.ts';

export function createMapVisual(
	world: SurvivalWorld,
	level?: StoryLevel,
	pads: readonly Checkpoint[] = level ? [level.start, ...level.checkpoints] : [],
	storyProps = false
) {
	const object = new Group();
	const farTerrain = createFarTerrain(world, level?.trails);
	object.add(farTerrain.object);
	const detailed: Mesh[] = [];
	const ownedGeometries: BufferGeometry[] = [];
	const materials = createMapMaterials();
	const canopy = bakeCanopy(world);
	lighting.uShadeMap.value = canopy.texture;
	lighting.uShadeSize.value = world.size;
	lighting.uShadeEnabled.value = visualStep() >= 3 ? 1 : 0;
	lighting.uHeightFog.value = visualStep() >= 4 ? 1 : 0;
	const atmosphere = visualStep() >= 4 ? createAtmosphere(world.size, world.waterLevel) : undefined;
	if (atmosphere) object.add(atmosphere.object);
	const { ground: groundMaterial, rock, wood, proxy: gray, checkpoint: gold } = materials;
	const add = (geometry: BufferGeometry, m: MeshLambertMaterial) => {
		ensureVertexColors(geometry);
		if (m === groundMaterial && !geometry.getAttribute('shore')) {
			const shore = new Float32Array(geometry.getAttribute('position').count * 2);
			for (let i = 0; i < shore.length; i += 2) {
				shore[i] = -10000;
				shore[i + 1] = 10000;
			}
			geometry.setAttribute('shore', new Float32BufferAttribute(shore, 2));
		}
		ownedGeometries.push(geometry);
		const mesh = new Mesh(geometry, m);
		object.add(mesh);
		return mesh;
	};
	for (const b of world.blocks) {
		const mesh = add(terrainChunk(world, b, level?.trails, level?.pool), groundMaterial);
		mesh.name = `terrain-${b.index}`;
		mesh.geometry.computeBoundingBox();
		detailed.push(mesh);
	}
	for (const geometry of boundaryTerrain(world)) {
		const mesh = add(geometry, groundMaterial);
		mesh.name = 'terrain-exterior';
		mesh.geometry.computeBoundingBox();
		detailed.push(mesh);
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
		if (!storyProps && c.kind !== 'stepping-stones')
			add(deckGeometry([c.from.x, c.from.y, c.from.z, c.to.x, c.to.y, c.to.z, c.halfWidth, 0.3]), wood);
		for (const s of storyProps ? [] : c.stones) {
			const height = s.y - (c.water - world.river.depth);
			add(new CylinderGeometry(s.r, s.r * 1.1, height, 8).translate(s.x, s.y - height / 2, s.z), rock);
		}
	}
	if (level && !storyProps)
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
	for (const p of storyProps ? [] : props) {
		const b = Math.floor(p.z / BLOCK_SIZE) * 4 + Math.floor(p.x / BLOCK_SIZE),
			bucket = grayByBlock.get(b) ?? [];
		bucket.push(propGeometry(p));
		grayByBlock.set(b, bucket);
	}
	if (level && !storyProps) {
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
		setBackgroundVisible(visible: boolean) {
			if (atmosphere) atmosphere.sky.visible = visible;
		},
		prepareFrame(camera: PerspectiveCamera, time: number, quality: Quality, night: boolean) {
			lighting.uVisualTime.value = time;
			lighting.uTreeRange.value = detailDistances(quality).trees;
			farTerrain.update(camera, quality, night);
			for (const mesh of detailed) {
				const b = mesh.geometry.boundingBox;
				if (!b) continue;
				const dx = Math.max(b.min.x - camera.position.x, 0, camera.position.x - b.max.x),
					dz = Math.max(b.min.z - camera.position.z, 0, camera.position.z - b.max.z);
				mesh.visible = Math.hypot(dx, dz) <= detailDistances(quality).terrain;
			}
			atmosphere?.update(camera, time, quality, night ? 'night' : 'day');
		},
		dispose() {
			if (lighting.uShadeMap.value === canopy.texture) {
				lighting.uShadeEnabled.value = 0;
				lighting.uShadeMap.value = null;
			}
			canopy.dispose();
			farTerrain.dispose();
			atmosphere?.dispose();
			for (const g of ownedGeometries) g.dispose();
			materials.dispose();
			object.removeFromParent();
			object.clear();
		}
	};
}
