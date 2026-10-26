import type { PerspectiveCamera } from 'three';
import {
	BoxGeometry,
	type BufferGeometry,
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
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Checkpoint } from '../engine/checkpoints.ts';
import type { StoryLevel } from '../level/types.ts';
import type { Quality } from '../render/index.ts';
import { mergePieces } from '../render/index.ts';
import { lookUniforms } from '../render/look.ts';
import { lighting, visualStep } from '../render/stylized.ts';
import { ensureVertexColors } from '../scene/materials.ts';
import { testing } from '../scene/testing.ts';
import { LIGHT, VIEW } from '../style/palette.ts';
import { BLOCK_SIZE, type SurvivalWorld } from '../survival/types.ts';
import { createAtmosphere } from './atmosphere.ts';
import { boundaryTerrain } from './boundary.ts';
import { bakeCanopy } from './canopy.ts';
import { cliffDressing } from './cliff.ts';
import { deckGeometry, prefabProxies, propGeometry } from './collision.ts';
import { createFarTerrain, detailDistances, farUniforms } from './far-field.ts';
import { createGroundCover } from './ground-cover.ts';
import { createMapMaterials } from './materials.ts';
import { overlookGeometry } from './overlook.ts';
import { pathRibbon } from './paths.ts';
import { waterSurface } from './shore.ts';
import { terrainChunk } from './terrain.ts';
import { createWaterfallFoam } from './waterfall-foam.ts';

export function createMapVisual(
	world: SurvivalWorld,
	level?: StoryLevel,
	pads: readonly Checkpoint[] = level ? [level.start, ...level.checkpoints] : [],
	storyProps = false,
	options: { streaming?: boolean } = {}
) {
	const object = new Group();
	const farTerrain = testing || options.streaming ? undefined : createFarTerrain(world, level?.trails);
	if (farTerrain) object.add(farTerrain.object);
	const detailed: Mesh[] = [];
	const ownedGeometries: BufferGeometry[] = [];
	const materials = createMapMaterials(world, level?.trails);
	const floorCover = level && !testing ? createGroundCover(world, level, materials.field) : undefined;
	if (floorCover) object.add(floorCover.object);
	const waterfallFoam = level && !testing && !options.streaming ? createWaterfallFoam(level) : undefined;
	if (waterfallFoam) object.add(waterfallFoam.object);
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
		if (options.streaming) {
			const dressing = cliffDressing(world, b, level);
			if (dressing) {
				const mesh = add(dressing, groundMaterial);
				mesh.name = 'stream-cliff-dressing';
				detailed.push(mesh);
			}
			continue;
		}
		const terrain = terrainChunk(world, b, level?.trails, level?.pool),
			dressing = cliffDressing(world, b, level);
		let geometry = terrain;
		if (dressing) {
			const merged = mergeGeometries([terrain, dressing], false);
			dressing.dispose();
			if (merged) {
				terrain.dispose();
				geometry = merged;
			}
		}
		const mesh = add(geometry, groundMaterial);
		mesh.name = `terrain-${b.index}`;
		mesh.geometry.computeBoundingBox();
		detailed.push(mesh);
	}
	for (const geometry of options.streaming ? [] : boundaryTerrain(world)) {
		const mesh = add(geometry, groundMaterial);
		mesh.name = 'terrain-exterior';
		mesh.geometry.computeBoundingBox();
		detailed.push(mesh);
	}
	if (level && visualStep() >= 2 && !options.streaming) {
		const ribbon = pathRibbon(world, level.trails);
		// Act 1's mechanics owns the authored deck; the old batch is only a legacy fallback.
		const deck = level.act1?.decks.some((d) => d.id === 'mirante-deck') ? undefined : overlookGeometry();
		const geometry = deck ? mergeGeometries([ribbon, deck], false) : ribbon;
		if (deck) {
			ribbon.dispose();
			deck.dispose();
		}
		if (!geometry) throw new Error('trail-deck-batch');
		const paths = add(geometry, materials.path);
		paths.name = 'trail-ribbons';
	}
	if (!options.streaming) {
		const water = add(waterSurface(world, level?.pool), materials.water);
		water.name = 'river-pool-surface';
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
		if (p.name.startsWith('overlook-')) continue;
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
	const padGeometry = checkpoints.map((c) =>
		new RingGeometry(1.1, 1.35, 24).rotateX(-Math.PI / 2).translate(c.spawn.x, c.spawn.y + 0.04, c.spawn.z)
	);
	if (padGeometry.length) {
		const merged = mergeGeometries(padGeometry, false);
		for (const g of padGeometry) g.dispose();
		if (merged) {
			const mesh = add(merged, gold);
			mesh.name = 'checkpoint-pads';
		}
	}
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
		streamMaterials: materials,
		props,
		load: materials.load,
		textures: materials.textures,
		update(x: number, y: number, z: number, target: { x: number; z: number }) {
			arrow.position.set(x, y + 0.08, z);
			arrow.rotation.y = Math.atan2(target.x - x, target.z - z) + Math.PI;
		},
		setBackgroundVisible(visible: boolean) {
			if (atmosphere) atmosphere.sky.visible = visible;
		},
		prepareFrame(camera: PerspectiveCamera, time: number, quality: Quality, night: boolean) {
			lighting.uVisualTime.value = time;
			lookUniforms.uLookNight.value = night ? 1 : 0;
			floorCover?.update(camera, time, quality);
			waterfallFoam?.update(camera);
			lighting.uTreeRange.value = detailDistances(quality).trees;
			farTerrain?.update(camera, quality, night);
			if (options.streaming) {
				farUniforms.uFarNear.value = detailDistances(quality).terrain;
				farUniforms.uFarEnd.value = VIEW[quality].far;
				farUniforms.uFarMist.value.set(night ? LIGHT.night.horizon : LIGHT.daylight.horizon);
			}
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
			floorCover?.dispose();
			waterfallFoam?.dispose();
			canopy.dispose();
			farTerrain?.dispose();
			atmosphere?.dispose();
			for (const g of ownedGeometries) g.dispose();
			materials.dispose();
			object.removeFromParent();
			object.clear();
		}
	};
}
