/** A persistent low-detail reserve behind the nearby collision-matched chunks. */
import {
	BufferGeometry,
	Color,
	Float32BufferAttribute,
	Mesh,
	MeshLambertMaterial,
	type PerspectiveCamera
} from 'three';
import type { Trail } from '../level/types.ts';
import type { Quality } from '../render/quality.ts';
import { type ShaderSource, stylize } from '../render/stylized.ts';
import { LIGHT, VIEW } from '../style/palette.ts';
import type { SurvivalWorld } from '../survival/types.ts';
import { smooth, terrainTint } from './terrain.ts';
export function detailDistances(q: Quality) {
	return q === 'low'
		? { terrain: 56, trees: 48 }
		: q === 'medium'
			? { terrain: 72, trees: 64 }
			: { terrain: 96, trees: 80 };
}
export const farUniforms = {
	uFarMist: { value: new Color(LIGHT.daylight.horizon) },
	uFarEnd: { value: 140 },
	uFarNear: { value: 56 }
};
/** Clamp distant background depth instead of cutting the floor at the detail camera's far plane. */
export function patchFarShader(shader: ShaderSource) {
	Object.assign(shader.uniforms, farUniforms);
	shader.vertexShader = shader.vertexShader.replace(
		'#include <project_vertex>',
		`#include <project_vertex>
 gl_Position.z=min(gl_Position.z,gl_Position.w*(1.0-0.000001));`
	);
	shader.fragmentShader = shader.fragmentShader.replace(
		'#include <common>',
		`#include <common>
 uniform vec3 uFarMist;uniform float uFarEnd,uFarNear;`
	);
	shader.fragmentShader = shader.fragmentShader.replace(
		'#include <colorspace_fragment>',
		`
 float farDistance=length(vStylizedWorld.xz-cameraPosition.xz);
 if(farDistance<uFarNear-8.0)discard;
 // Retain land contrast beyond the detail fog end: haze is not an opaque sky-coloured wall.
 float farHaze=smoothstep(uFarNear,uFarEnd*1.3,farDistance)*0.48;
 gl_FragColor.rgb=mix(gl_FragColor.rgb,uFarMist,farHaze);
 #include <colorspace_fragment>`
	);
}
export function coarseTerrain(world: SurvivalWorld, trails: readonly Trail[] = []) {
	const positions: number[] = [],
		colors: number[] = [],
		indices: number[] = [],
		n = world.size / 4 + 1;
	const height = (x: number, z: number) => {
		let y = Infinity;
		for (let dz = -2; dz <= 2; dz++)
			for (let dx = -2; dx <= 2; dx++) {
				const xx = Math.max(0, Math.min(world.size, x + dx)),
					zz = Math.max(0, Math.min(world.size, z + dz));
				y = Math.min(y, world.heights[zz * world.grid + xx]);
			}
		return y - 0.25;
	};
	for (let z = 0; z <= world.size; z += 4)
		for (let x = 0; x <= world.size; x += 4) {
			positions.push(x, height(x, z), z);
			const c = terrainTint(world, x, z, trails);
			colors.push(c.r, c.g, c.b);
		}
	for (let z = 0; z < n - 1; z++)
		for (let x = 0; x < n - 1; x++) {
			const a = z * n + x;
			indices.push(a, a + n, a + 1, a + 1, a + n, a + n + 1);
		}
	// Sparse concentric rings close all four corners, without making a dense 480 x 480 grid.
	const rings = [0, 12, 40, 88, 160],
		half = world.size / 2,
		cols = world.size / 4 + 1;
	for (let side = 0; side < 4; side++) {
		const base = positions.length / 3;
		for (const d of rings)
			for (let t = 0; t <= world.size; t += 4) {
				const x = side === 0 ? t : side === 1 ? world.size : side === 2 ? world.size - t : 0,
					z = side === 0 ? 0 : side === 1 ? t : side === 2 ? world.size : world.size - t;
				const k = 1 + d / half,
					xx = half + (x - half) * k,
					zz = half + (z - half) * k,
					coast = smooth(0, 36, -xx);
				const raised = height(x, z) + 18 * (d / 160) ** 1.4,
					y = raised * (1 - coast) + world.waterLevel * coast;
				positions.push(xx, y, zz);
				const c = terrainTint(world, x, z, trails).lerp(new Color('#73cbf0'), coast * 0.85);
				colors.push(c.r, c.g, c.b);
			}
		for (let r = 0; r < rings.length - 1; r++)
			for (let t = 0; t < cols - 1; t++) {
				const a = base + r * cols + t;
				indices.push(a, a + 1, a + cols, a + 1, a + cols + 1, a + cols);
			}
	}
	const g = new BufferGeometry();
	g.setAttribute('position', new Float32BufferAttribute(positions, 3));
	g.setAttribute('color', new Float32BufferAttribute(colors, 3));
	g.setIndex(indices);
	g.computeVertexNormals();
	g.computeBoundingSphere();
	return g;
}
export function createFarTerrain(world: SurvivalWorld, trails: readonly Trail[] = []) {
	const geometry = coarseTerrain(world, trails),
		material = stylize(new MeshLambertMaterial({ vertexColors: true, fog: false }), { vegetation: true });
	const compile = material.onBeforeCompile.bind(material),
		key = material.customProgramCacheKey();
	material.onBeforeCompile = (shader, renderer) => {
		compile(shader, renderer);
		patchFarShader(shader);
	};
	material.customProgramCacheKey = () => `${key}|far-reserve-v1`;
	const object = new Mesh(geometry, material);
	object.name = 'far-reserve';
	object.frustumCulled = false;
	object.renderOrder = -2000;
	object.userData.noShadow = true;
	return {
		object,
		update(_camera: PerspectiveCamera, quality: Quality, night: boolean) {
			farUniforms.uFarNear.value = detailDistances(quality).terrain;
			farUniforms.uFarEnd.value = VIEW[quality].far;
			farUniforms.uFarMist.value.set(night ? LIGHT.night.horizon : LIGHT.daylight.horizon);
		},
		dispose() {
			object.removeFromParent();
			geometry.dispose();
			material.dispose();
		}
	};
}
