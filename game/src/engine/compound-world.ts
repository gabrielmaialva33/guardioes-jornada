import type { Box3, Ray } from 'three';
import type { ExtendedTriangle } from 'three-mesh-bvh';
import { type ColliderSource, CollisionWorld } from './world.ts';
/** Static BVH plus independently updated small decks. Children are caller-owned. */
export class CompoundWorld extends CollisionWorld {
	constructor(
		sources: Iterable<ColliderSource>,
		readonly children: readonly CollisionWorld[]
	) {
		super(sources);
	}
	override shapecast(bounds: Box3, visit: (triangle: ExtendedTriangle) => void) {
		super.shapecast(bounds, visit);
		for (const world of this.children) world.shapecast(bounds, visit);
	}
	override raycast(ray: Ray, far: number) {
		let nearest = super.raycast(ray, far);
		for (const world of this.children) {
			const hit = world.raycast(ray, nearest ?? far);
			if (hit !== null && (nearest === null || hit < nearest)) nearest = hit;
		}
		return nearest;
	}
}
