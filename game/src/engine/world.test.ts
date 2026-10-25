import { BoxGeometry, Group, Matrix4, Mesh, Ray, SkinnedMesh, Vector3 } from 'three';
import { expect, it } from 'vitest';
import { CollisionWorld } from './world.ts';

const down = (x: number, y: number, z: number) => new Ray(new Vector3(x, y, z), new Vector3(0, -1, 0));

it('bakes meshes in world space, so a scaled parent reports world distances', () => {
	const parent = new Group();
	parent.position.set(0, 5, 0);
	parent.scale.setScalar(2);
	parent.add(new Mesh(new BoxGeometry(1, 1, 1)));
	const world = CollisionWorld.fromObject(parent);
	expect(world.triangles).toBe(12);
	// The box spans y 4..6 once scaled; a ray from y = 10 hits its top 4 u below.
	expect(world.raycast(down(0, 10, 0), 100)).toBeCloseTo(4, 6);
	expect(world.raycast(down(0, 10, 0), 3)).toBeNull();
	expect(world.raycast(down(1.5, 10, 0), 100)).toBeNull();
});

it('leaves hidden and skinned meshes out unless asked', () => {
	const root = new Group();
	const hidden = new Mesh(new BoxGeometry(1, 1, 1));
	hidden.visible = false;
	root.add(new Mesh(new BoxGeometry(1, 1, 1)), hidden, new SkinnedMesh(new BoxGeometry(1, 1, 1)));
	expect(CollisionWorld.fromObject(root).triangles).toBe(12);
	expect(CollisionWorld.fromObject(root, () => true).triangles).toBe(24);
});

it('merges indexed and non-indexed sources into one BVH', () => {
	const indexed = new BoxGeometry(1, 1, 1);
	const flat = new BoxGeometry(1, 1, 1).toNonIndexed();
	const world = new CollisionWorld([
		{ geometry: indexed },
		{ geometry: flat, matrix: new Matrix4().makeTranslation(3, 0, 0) }
	]);
	expect(world.triangles).toBe(24);
	expect(world.raycast(down(3, 5, 0), 10)).toBeCloseTo(4.5, 6);
	world.dispose();
});
