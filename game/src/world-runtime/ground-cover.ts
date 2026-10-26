import {
	BufferGeometry,
	Color,
	DoubleSide,
	Float32BufferAttribute,
	Group,
	InstancedBufferAttribute,
	InstancedMesh,
	MeshLambertMaterial,
	type PerspectiveCamera,
	Vector2
} from 'three';
import type { StoryLevel } from '../level/types.ts';
import { applyWind } from '../life/wind.ts';
import type { Quality } from '../render/quality.ts';
import { stylize } from '../render/stylized.ts';
import { FLAG, type SurvivalWorld } from '../survival/types.ts';
import { bakeGroundField } from './ground-field.ts';
import { OVERLOOK } from './overlook.ts';
import { terrainHeight } from './paths.ts';
import { waterField } from './shore.ts';

const hash = (x: number, z: number) => {
	let n = Math.imul(x ^ 0x45d9f3b, z ^ 0x27d4eb2d);
	n = Math.imul(n ^ (n >>> 16), 0x45d9f3b);
	return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
};
/** Eight opaque blades and six petals share one draw. Inactive petals collapse in the vertex stage. */
function coverGeometry() {
	const p: number[] = [],
		c: number[] = [],
		n: number[] = [],
		bloom: number[] = [];
	const base = new Color('#526e36'),
		tip = new Color('#a4bc5b');
	for (let i = 0; i < 8; i++) {
		const angle = i * 2.39996,
			x = Math.cos(angle) * 0.28,
			z = Math.sin(angle) * 0.28,
			w = 0.045 + 0.02 * (i % 3),
			h = 0.35 + 0.28 * hash(i, 37),
			dx = Math.cos(angle) * w,
			dz = Math.sin(angle) * w;
		p.push(
			x - dx,
			0.015,
			z - dz,
			x + dx,
			0.015,
			z + dz,
			x + Math.sin(angle) * 0.1,
			h,
			z + Math.cos(angle) * 0.1
		);
		c.push(base.r, base.g, base.b, base.r, base.g, base.b, tip.r, tip.g, tip.b);
		n.push(0, 1, 0, 0, 1, 0, 0, 1, 0);
		bloom.push(0, 0, 0);
	}
	for (let i = 0; i < 6; i++) {
		const a = (i * Math.PI) / 3,
			b = a + 0.7;
		p.push(
			0,
			0.72,
			0,
			Math.cos(a) * 0.17,
			0.76,
			Math.sin(a) * 0.17,
			Math.cos(b) * 0.17,
			0.74,
			Math.sin(b) * 0.17
		);
		for (let j = 0; j < 3; j++) {
			c.push(1, 1, 1);
			n.push(0, 1, 0);
			bloom.push(1);
		}
	}
	const g = new BufferGeometry();
	g.setAttribute('position', new Float32BufferAttribute(p, 3));
	g.setAttribute('color', new Float32BufferAttribute(c, 3));
	g.setAttribute('normal', new Float32BufferAttribute(n, 3));
	g.setAttribute('bloom', new Float32BufferAttribute(bloom, 1));
	return g;
}
export function createGroundCover(
	world: SurvivalWorld,
	level: StoryLevel,
	sharedField?: ReturnType<typeof bakeGroundField>
) {
	const field = sharedField ?? bakeGroundField(world, level.trails),
		ownedField = !sharedField;
	const allowed = new Uint8Array(world.grid * world.grid);
	for (let z = 1; z < world.size; z++)
		for (let x = 1; x < world.size; x++) {
			const i = z * world.grid + x;
			if (world.flags[i] & (FLAG.river | FLAG.base) || field.sample(x, z) < 0.45) continue;
			if (
				Math.abs(world.heights[i + 1] - world.heights[i - 1]) +
					Math.abs(world.heights[i + world.grid] - world.heights[i - world.grid]) >
				1.5
			)
				continue;
			if (
				level.obbies.some((o) => o.pieces.some((p) => (p.x - x) ** 2 + (p.z - z) ** 2 < (p.radius + 1) ** 2))
			)
				continue;
			allowed[i] = 1;
		}
	const water = { height: 0, distance: 0, depth: 0 },
		decks = [OVERLOOK, ...(level.act1?.decks ?? [])];
	const eligible = (x: number, z: number) => {
		if (
			x < 1 ||
			z < 1 ||
			x >= world.size - 1 ||
			z >= world.size - 1 ||
			allowed[Math.round(z) * world.grid + Math.round(x)] !== 1
		)
			return false;
		const ground = terrainHeight(world, x, z);
		for (const deck of decks)
			if (
				x >= deck.x0 - 0.4 &&
				x <= deck.x1 + 0.4 &&
				z >= deck.z0 - 0.4 &&
				z <= deck.z1 + 0.4 &&
				ground + 0.9 >= deck.y &&
				ground <= deck.y + 0.2
			)
				return false;
		waterField(world, level.pool, x, z, water);
		if (water.distance < 0.15 && water.depth > 0.02) return false;
		for (const crossing of world.crossings) {
			if (crossing.kind === 'stepping-stones') continue;
			const dx = crossing.to.x - crossing.from.x,
				dz = crossing.to.z - crossing.from.z,
				t = Math.max(
					0,
					Math.min(1, ((x - crossing.from.x) * dx + (z - crossing.from.z) * dz) / (dx * dx + dz * dz || 1))
				);
			const height = crossing.from.y + (crossing.to.y - crossing.from.y) * t;
			if (
				(x - crossing.from.x - dx * t) ** 2 + (z - crossing.from.z - dz * t) ** 2 <
					(crossing.halfWidth + 0.4) ** 2 &&
				ground + 0.9 >= height &&
				ground <= height + 0.2
			)
				return false;
		}
		return true;
	};
	const geometry = coverGeometry(),
		material = stylize(new MeshLambertMaterial({ color: '#ffffff', vertexColors: true, side: DoubleSide }), {
			vegetation: true,
			cover: true
		});
	applyWind(material, { amplitude: 0.12, from: 0.05, to: 0.8, sample: 'vertex' });
	const center = { value: new Vector2() },
		flower = new InstancedBufferAttribute(new Float32Array(1600), 1),
		accents = new InstancedBufferAttribute(new Float32Array(1600 * 3), 3);
	geometry.setAttribute('flower', flower);
	geometry.setAttribute('flowerColor', accents);
	const previous = material.onBeforeCompile.bind(material),
		key = material.customProgramCacheKey();
	material.onBeforeCompile = (shader, renderer) => {
		previous(shader, renderer);
		shader.uniforms.uCoverCenter = center;
		shader.vertexShader = shader.vertexShader.replace(
			'#include <common>',
			'#include <common>\nattribute float bloom,flower;attribute vec3 flowerColor;uniform vec2 uCoverCenter;varying float vCoverBloom;varying vec3 vFlowerColor;'
		);
		shader.vertexShader = shader.vertexShader.replace(
			'#include <begin_vertex>',
			`#include <begin_vertex>
vCoverBloom=bloom;vFlowerColor=flowerColor;
vec4 coverRoot=modelMatrix*instanceMatrix*vec4(0.,0.,0.,1.);
float coverFade=1.-smoothstep(13.,18.,length(coverRoot.xz-uCoverCenter));
transformed*=coverFade*(bloom>.5?flower:1.);`
		);
		shader.fragmentShader = shader.fragmentShader.replace(
			'#include <common>',
			'#include <common>\nvarying float vCoverBloom;varying vec3 vFlowerColor;'
		);
		shader.fragmentShader = shader.fragmentShader.replace(
			'#include <color_fragment>',
			'#include <color_fragment>\ndiffuseColor.rgb=mix(diffuseColor.rgb,vFlowerColor,vCoverBloom);'
		);
	};
	material.customProgramCacheKey = () => `${key}|opaque-cover-p32`;
	const mesh = new InstancedMesh(geometry, material, 1600),
		object = new Group();
	mesh.count = 0;
	mesh.frustumCulled = false;
	mesh.name = 'living-floor';
	mesh.userData.noShadow = true;
	object.add(mesh);
	const palette = [new Color('#edc85b'), new Color('#e37c9d'), new Color('#e9e6cb')];
	let lastX = Infinity,
		lastZ = Infinity,
		lastQuality: Quality = 'low',
		disposed = false;
	return {
		object,
		mesh,
		eligible,
		update(camera: PerspectiveCamera, _time: number, quality: Quality) {
			center.value.set(camera.position.x, camera.position.z);
			const cx = Math.floor(camera.position.x / 2),
				cz = Math.floor(camera.position.z / 2);
			if (cx === lastX && cz === lastZ && quality === lastQuality) return;
			lastX = cx;
			lastZ = cz;
			lastQuality = quality;
			const matrices = mesh.instanceMatrix.array,
				capacity = quality === 'low' ? 800 : quality === 'medium' ? 1200 : 1600;
			let count = 0;
			for (let dz = -9; dz <= 9; dz++)
				for (let dx = -9; dx <= 9; dx++) {
					if (dx * dx + dz * dz > 81) continue;
					const bx = cx + dx,
						bz = cz + dz;
					for (let j = 0; j < 4 && count < capacity; j++) {
						const h = hash(bx * 7 + j, bz * 11 - j),
							x = bx * 2 + hash(bx * 13 + j, bz * 23) * 2,
							z = bz * 2 + hash(bx * 3 - j, bz * 17 + j) * 2;
						if (!eligible(x, z)) continue;
						const cluster = 0.5 + 0.5 * Math.sin(x * 0.4 + Math.sin(z * 0.3)) * Math.cos(z * 0.45),
							scale = 0.65 + h * 0.65,
							angle = h * 6.283,
							c = Math.cos(angle) * scale,
							s = Math.sin(angle) * scale,
							i = count * 16;
						matrices[i] = c;
						matrices[i + 1] = 0;
						matrices[i + 2] = -s;
						matrices[i + 3] = 0;
						matrices[i + 4] = 0;
						matrices[i + 5] = scale;
						matrices[i + 6] = 0;
						matrices[i + 7] = 0;
						matrices[i + 8] = s;
						matrices[i + 9] = 0;
						matrices[i + 10] = c;
						matrices[i + 11] = 0;
						matrices[i + 12] = x;
						matrices[i + 13] = terrainHeight(world, x, z) + 0.015;
						matrices[i + 14] = z;
						matrices[i + 15] = 1;
						flower.array[count] = cluster > 0.68 && h > 0.45 ? 1 : 0;
						const tint = palette[Math.floor(hash(bx, bz) * palette.length)];
						accents.array[count * 3] = tint.r;
						accents.array[count * 3 + 1] = tint.g;
						accents.array[count * 3 + 2] = tint.b;
						count++;
					}
				}
			mesh.count = count;
			mesh.instanceMatrix.needsUpdate = true;
			flower.needsUpdate = true;
			accents.needsUpdate = true;
		},
		dispose() {
			if (disposed) return;
			disposed = true;
			object.removeFromParent();
			object.clear();
			mesh.dispose();
			geometry.dispose();
			material.dispose();
			if (ownedField) field.dispose();
		}
	};
}
