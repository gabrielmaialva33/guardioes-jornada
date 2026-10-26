import { type PerspectiveCamera, Ray, Vector3 } from 'three';
import type { CollisionWorld } from '../engine/world.ts';
import type { PhotoCamera, PhotoFrame } from './photo.ts';
/** Reusable projection/ray adapter. The BVH must omit the subjects themselves. */
export class PhotoProjection {
	readonly frame: PhotoFrame = {
		origin: new Vector3(),
		forward: new Vector3(),
		right: new Vector3(),
		up: new Vector3(),
		tanHalfFov: 1,
		aspect: 1
	};
	readonly #ray = new Ray();
	constructor(readonly world: CollisionWorld) {}
	readonly occluded = (
		origin: { x: number; y: number; z: number },
		target: { x: number; y: number; z: number },
		distance: number
	) => {
		this.#ray.origin.copy(origin);
		this.#ray.direction.set(target.x - origin.x, target.y - origin.y, target.z - origin.z).normalize();
		return this.world.raycast(this.#ray, Math.max(0, distance - 0.05)) !== null;
	};
	evaluate(photo: PhotoCamera, camera: PerspectiveCamera) {
		camera.updateMatrixWorld();
		const e = camera.matrixWorld.elements,
			f = this.frame;
		(f.origin as Vector3).setFromMatrixPosition(camera.matrixWorld);
		(f.right as Vector3).set(e[0], e[1], e[2]);
		(f.up as Vector3).set(e[4], e[5], e[6]);
		(f.forward as Vector3).set(-e[8], -e[9], -e[10]);
		f.tanHalfFov = Math.tan((camera.fov * Math.PI) / 360) / camera.zoom;
		f.aspect = camera.aspect;
		photo.evaluate(f, this.occluded);
	}
}
