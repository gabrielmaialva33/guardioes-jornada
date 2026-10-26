import { Mesh, MeshLambertMaterial, type PerspectiveCamera, SphereGeometry } from 'three';
import { stylize } from '../../render/stylized.ts';
import type { SurvivalWorld } from '../../survival/types.ts';

/** A steady warm point on the home radio mast; no extra light, post pass or flicker. */
export function createHomeBeacon(world: SurvivalWorld) {
	const mast = world.base.pieces.find((p) => p.kind === 'radio-mast') ?? world.base.spawn;
	const material = stylize(
		new MeshLambertMaterial({
			color: '#ffdc91',
			emissive: '#ffe2b5',
			emissiveIntensity: 0.7,
			fog: false,
			depthWrite: false
		})
	);
	const compile = material.onBeforeCompile.bind(material),
		key = material.customProgramCacheKey();
	material.onBeforeCompile = (shader, renderer) => {
		compile(shader, renderer);
		shader.vertexShader = shader.vertexShader.replace(
			'#include <project_vertex>',
			'#include <project_vertex>\ngl_Position.z=min(gl_Position.z,gl_Position.w*.999998);'
		);
	};
	material.customProgramCacheKey = () => `${key}|home-beacon`;
	const geometry = new SphereGeometry(0.2, 8, 6),
		object = new Mesh(geometry, material);
	object.name = 'home-beacon';
	object.position.set(mast.x, mast.y + 5.3, mast.z);
	object.frustumCulled = false;
	object.userData.noShadow = true;
	let disposed = false;
	return {
		object,
		update(camera: PerspectiveCamera) {
			object.scale.setScalar(Math.max(1, camera.position.distanceTo(object.position) / 60));
		},
		dispose() {
			if (disposed) return;
			disposed = true;
			object.removeFromParent();
			geometry.dispose();
			material.dispose();
		}
	};
}
