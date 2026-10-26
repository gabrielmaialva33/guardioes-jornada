/** Low-poly original fixture meshes. All allocations happen at construction/disposal, not update. */
import {
	BoxGeometry,
	type BufferGeometry,
	CylinderGeometry,
	Group,
	Mesh,
	MeshStandardMaterial,
	Quaternion,
	SphereGeometry,
	Vector3
} from 'three';
import { type ColliderSource, CollisionWorld } from '../engine/world.ts';
import type { Boardwalk } from './boardwalk.ts';
import type { SuspensionBridge } from './bridge.ts';
import type { CameraTrap } from './camera-trap.ts';
import type { Canoe } from './canoe.ts';
import type { Vec3 } from './common.ts';
import type { Ladder } from './ladder.ts';
import type { Zipline } from './zipline.ts';

const WOOD = 0x9b6844,
	ROPE = 0xe3cb95,
	METAL = 0x465b56;
export class MechanicMesh {
	readonly root = new Group();
	readonly colliders: ColliderSource[] = [];
	readonly #geometries = new Set<BufferGeometry>();
	readonly #materials = new Map<number, MeshStandardMaterial>();
	box(
		x: number,
		y: number,
		z: number,
		sx: number,
		sy: number,
		sz: number,
		color = WOOD,
		collider = false,
		parent = this.root
	) {
		const geometry = new BoxGeometry(sx, sy, sz);
		return this.add(geometry, color, x, y, z, collider, parent);
	}
	add(
		geometry: BufferGeometry,
		color: number,
		x: number,
		y: number,
		z: number,
		collider = false,
		parent = this.root
	) {
		let material = this.#materials.get(color);
		if (!material) {
			material = new MeshStandardMaterial({ color, roughness: 0.85 });
			this.#materials.set(color, material);
		}
		this.#geometries.add(geometry);
		const mesh = new Mesh(geometry, material);
		mesh.position.set(x, y, z);
		mesh.castShadow = true;
		mesh.receiveShadow = true;
		parent.add(mesh);
		mesh.userData.collider = collider;
		return mesh;
	}
	beam(a: Vec3, b: Vec3, radius: number, color = ROPE) {
		const start = new Vector3(a.x, a.y, a.z),
			end = new Vector3(b.x, b.y, b.z),
			direction = end.clone().sub(start);
		const mesh = this.add(
			new CylinderGeometry(radius, radius, direction.length(), 6),
			color,
			(a.x + b.x) / 2,
			(a.y + b.y) / 2,
			(a.z + b.z) / 2
		);
		mesh.quaternion.copy(new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), direction.normalize()));
		return mesh;
	}
	bake() {
		this.colliders.length = 0;
		this.root.updateWorldMatrix(true, true);
		this.root.traverse((o) => {
			if (o instanceof Mesh && o.userData.collider)
				this.colliders.push({ geometry: o.geometry, matrix: o.matrixWorld.clone() });
		});
		return this;
	}
	dispose() {
		for (const g of this.#geometries) g.dispose();
		for (const m of this.#materials.values()) m.dispose();
		this.root.removeFromParent();
	}
}
export function createLadderMesh(ladder: Ladder) {
	const v = new MechanicMesh(),
		s = ladder.spec,
		h = s.top.y - s.base.y;
	const exitDistance = Math.hypot(s.exit.x - s.base.x, s.exit.z - s.base.z);
	v.root.position.set(s.base.x, s.base.y, s.base.z);
	v.root.rotation.y = Math.atan2(s.exit.x - s.base.x, s.exit.z - s.base.z);
	for (const side of [-0.65, 0.65]) v.box(side, h / 2, 0, 0.14, h + 0.8, 0.16);
	for (let y = 0.3; y < h; y += 0.45) v.box(0, y, 0, 1.35, 0.11, 0.16, ROPE);
	const exitY = s.exit.y - s.base.y;
	v.box(0, exitY - 0.15, exitDistance, 3.2, 0.3, 3, WOOD, true);
	for (const side of [-1, 1]) v.box(side * 1.6, exitY + 0.6, exitDistance, 0.15, 1.2, 3, ROPE, true);
	v.box(0, exitY + 0.6, exitDistance + 1.5, 3.2, 1.2, 0.15, ROPE, true);
	return v.bake();
}
export function createZiplineMesh(zip: Zipline) {
	const v = new MechanicMesh(),
		s = zip.spec;
	v.beam(
		{ x: s.start.x, y: s.start.y + 3, z: s.start.z },
		{ x: s.end.x, y: s.end.y + 3, z: s.end.z },
		0.055,
		METAL
	);
	for (const p of [s.start, s.end]) {
		v.box(p.x + 1.7, p.y + 1.5, p.z, 0.3, 3.6, 0.3, WOOD, true);
		v.box(p.x, p.y - 0.15, p.z, 4, 0.3, 4, WOOD, true);
		v.box(p.x, p.y + 3.3, p.z, 3.7, 0.18, 0.2, WOOD);
	}
	const pulley = new Group();
	v.root.add(pulley);
	v.add(new CylinderGeometry(0.22, 0.22, 0.18, 8), METAL, 0, 3, 0, false, pulley).rotation.z = Math.PI / 2;
	v.box(0, 2.65, 0, 0.08, 0.6, 0.08, METAL, false, pulley);
	v.box(0, 2.4, 0, 1.2, 0.08, 0.08, METAL, false, pulley);
	return Object.assign(v.bake(), {
		update() {
			pulley.position.set(zip.position.x, zip.position.y, zip.position.z);
		}
	});
}
export function createCanoeMesh(canoe: Canoe) {
	const v = new MechanicMesh(),
		boat = new Group();
	v.root.add(boat);
	v.box(0, 0.1, 0, 1.5, 0.2, 3.7, 0xad5830, false, boat);
	for (const side of [-1, 1]) v.box(side * 0.8, 0.4, 0, 0.18, 0.65, 3.7, 0xd18943, false, boat);
	for (const end of [-1, 1]) {
		v.box(0, 0.3, end * 1.85, 1.5, 0.45, 0.15, WOOD, false, boat);
		v.box(0, 0.55, end * 0.7, 1.4, 0.15, 0.35, ROPE, false, boat);
	}
	const paddle = new Group();
	boat.add(paddle);
	paddle.position.set(1, 1, 0);
	v.box(0, 0, 0, 0.09, 2.6, 0.1, WOOD, false, paddle);
	v.box(0, -1.1, 0, 0.4, 0.65, 0.12, ROPE, false, paddle);
	return Object.assign(v, {
		update(reduced: boolean) {
			boat.position.set(
				canoe.position.x,
				canoe.position.y + (reduced ? 0 : Math.sin(canoe.stroke) * 0.035),
				canoe.position.z
			);
			boat.rotation.y = canoe.yaw;
			paddle.rotation.x = reduced ? 0 : Math.sin(canoe.stroke) * 0.5;
		}
	});
}
export function createBridgeMesh(bridge: SuspensionBridge) {
	const v = new MechanicMesh(),
		s = bridge.spec,
		planks: Mesh[] = [];
	const n = s.planks,
		step = bridge.length / n,
		yaw = Math.atan2(bridge.dx, bridge.dz);
	for (let i = 0; i < n; i++) {
		const t = (i + 0.5) / n;
		const m = v.box(
			s.start.x + (s.end.x - s.start.x) * t,
			bridge.baseHeight(t) - 0.1,
			s.start.z + (s.end.z - s.start.z) * t,
			s.width,
			0.2,
			step + 0.025,
			i % 2 ? WOOD : 0xb57a4b,
			true
		);
		m.rotation.y = yaw;
		planks.push(m);
	}
	for (const side of [-1, 1])
		for (let i = 0; i < n; i++) {
			const a = i / n,
				b = (i + 1) / n,
				sideX = ((bridge.dz * s.width) / 2) * side,
				sideZ = ((-bridge.dx * s.width) / 2) * side;
			const from = {
				x: s.start.x + (s.end.x - s.start.x) * a + sideX,
				y: bridge.baseHeight(a) + 1.25,
				z: s.start.z + (s.end.z - s.start.z) * a + sideZ
			};
			const to = {
				x: s.start.x + (s.end.x - s.start.x) * b + sideX,
				y: bridge.baseHeight(b) + 1.25,
				z: s.start.z + (s.end.z - s.start.z) * b + sideZ
			};
			v.beam(from, to, 0.055);
			if (i % 3 === 0) v.beam({ ...from, y: from.y - 1.35 }, from, 0.055);
			// Continuous solid side proxies block a walking capsule between the visible rope posts.
			const rail = v.box(
				(from.x + to.x) / 2,
				(from.y + to.y) / 2 - 0.6,
				(from.z + to.z) / 2,
				0.12,
				1.65,
				step + 0.03,
				ROPE,
				true
			);
			rail.rotation.y = yaw;
			rail.visible = false;
		}
	v.bake();
	// Bake the full +/-0.25 u sweep into immutable BVH node bounds, then restore
	// the live triangles. Their vertices always stay inside that envelope: no
	// per-tick BVH rebuild/refit (three-mesh-bvh.refit allocates typed-array views).
	const swept = v.colliders.map((source, i) =>
		i < n ? { geometry: source.geometry.clone().scale(1, 3.5, 1), matrix: source.matrix } : source
	);
	const world = new CollisionWorld(swept),
		positions = world.geometry.getAttribute('position');
	for (let i = 0; i < n; i++) swept[i].geometry.dispose();
	const previous = new Float64Array(n),
		baseY = new Float64Array(n * 24);
	for (let i = 0; i < n; i++)
		for (let vertex = i * 24; vertex < (i + 1) * 24; vertex++) {
			const center = planks[i].position.y;
			baseY[vertex] = center + (positions.getY(vertex) - center) / 3.5;
			positions.setY(vertex, baseY[vertex]);
		}
	const baseDispose = v.dispose.bind(v);
	return Object.assign(v, {
		world,
		update() {
			let changed = false;
			for (let i = 0; i < n; i++) {
				const delta = bridge.offsets[i] - previous[i];
				if (Math.abs(delta) < 1e-9) continue;
				changed = true;
				planks[i].position.y = bridge.baseHeight((i + 0.5) / n) - 0.1 + bridge.offsets[i];
				for (let vertex = i * 24; vertex < (i + 1) * 24; vertex++)
					positions.setY(vertex, baseY[vertex] + bridge.offsets[i]);
				previous[i] = bridge.offsets[i];
			}
			if (changed) {
				positions.needsUpdate = true;
			}
		},
		dispose() {
			world.dispose();
			baseDispose();
		}
	});
}
export function createBoardwalkMesh(boardwalk: Boardwalk) {
	const v = new MechanicMesh(),
		s = boardwalk.spec,
		length = Math.hypot(s.end.x - s.start.x, s.end.z - s.start.z),
		yaw = Math.atan2(s.end.x - s.start.x, s.end.z - s.start.z),
		dx = Math.cos(yaw),
		dz = -Math.sin(yaw);
	const deck = v.box(
		(s.start.x + s.end.x) / 2,
		(s.start.y + s.end.y) / 2 - 0.15,
		(s.start.z + s.end.z) / 2,
		s.width,
		0.3,
		length,
		WOOD,
		true
	);
	deck.rotation.set(Math.atan2(s.start.y - s.end.y, length), yaw, 0, 'YXZ');
	for (const side of [-1, 1]) {
		const rail = v.box(
			deck.position.x + ((dx * s.width) / 2) * side,
			deck.position.y + 0.85,
			deck.position.z + ((dz * s.width) / 2) * side,
			0.12,
			1.4,
			length,
			ROPE,
			true
		);
		rail.rotation.copy(deck.rotation);
	}
	for (const l of s.lookouts) {
		v.box(l.position.x, l.position.y - 0.15, l.position.z, 3.8, 0.3, 3.8, 0xb57a4b, true);
		v.box(l.position.x, l.position.y + 0.7, l.position.z + 0.7, 0.7, 1.4, 0.5, METAL);
	}
	for (let i = 0; i <= length; i += 3) {
		const t = i / length,
			x = s.start.x + (s.end.x - s.start.x) * t,
			z = s.start.z + (s.end.z - s.start.z) * t,
			y = s.start.y + (s.end.y - s.start.y) * t;
		for (const side of [-1, 1])
			v.box(
				x + ((dx * s.width) / 2) * side,
				y / 2,
				z + ((dz * s.width) / 2) * side,
				0.18,
				Math.max(0.1, y),
				0.18,
				WOOD
			);
	}
	return v.bake();
}
export function createPhotoCameraMesh() {
	const v = new MechanicMesh();
	v.box(0, 0, 0, 0.65, 0.45, 0.25, METAL);
	v.add(new CylinderGeometry(0.16, 0.16, 0.3, 12), 0x304f65, 0, 0, -0.2).rotation.x = Math.PI / 2;
	v.box(0.22, 0.27, 0, 0.16, 0.1, 0.15, ROPE);
	return v;
}
export function createCameraTrapMesh(trap: CameraTrap, position: Vec3) {
	const v = new MechanicMesh();
	v.box(position.x, position.y, position.z, 0.7, 1, 0.4, 0x617148);
	v.add(new SphereGeometry(0.15, 8, 6), 0x243d46, position.x, position.y + 0.1, position.z - 0.24);
	const lamp = v.add(
		new SphereGeometry(0.055, 6, 4),
		0xf5ce57,
		position.x + 0.2,
		position.y + 0.3,
		position.z - 0.24
	);
	return Object.assign(v, {
		update() {
			lamp.visible = trap.phase === 'ready';
		}
	});
}
