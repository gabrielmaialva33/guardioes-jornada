/**
 * The three.js side of a flock: one InstancedMesh per kind with the wing-flap
 * shader (wing-flap.ts), so a flock is one draw call (animacoes.md §8 rule 8).
 *
 *   const flock = new Flock({ kind: 'butterfly', count: 14, bounds: [-6, 0.5, -6, 6, 3, 6] });
 *   const butterflies = new FlockMesh(flock);         // scene.add(butterflies.mesh)
 *   // every frame: flock.update(delta); butterflies.update(flock);
 *
 * Shadows: leave castShadow off (each caster is another draw in the shadow
 * pass; ART.md §5 gives small animals a blob shadow at most). Culling: the
 * bounding sphere is set once from the flock's box, so three never recomputes
 * it from the instance matrices.
 */
import {
	BufferAttribute,
	BufferGeometry,
	Color,
	type ColorRepresentation,
	DoubleSide,
	DynamicDrawUsage,
	InstancedBufferAttribute,
	InstancedMesh,
	MeshLambertMaterial,
	Sphere,
	Vector3
} from 'three';
import type { Flock, FlockKind } from './flock.ts';
import {
	createWingFlapUniforms,
	patchWingFlap,
	WING_FLAP_ATTRIBUTE,
	WING_FLAP_CACHE_KEY,
	WING_FLAP_PRESETS,
	type WingFlapSettings,
	type WingFlapUniforms
} from './wing-flap.ts';

/**
 * Low-poly flyer facing +z, wings along ±x in the y = 0 plane, hinge at
 * |x| = hinge. Butterfly: a thin body and a fore and a hind wing per side
 * (10 triangles). Bird: a body wedge and one wing per side (6 triangles).
 */
export function createFlyerGeometry(kind: FlockKind): BufferGeometry {
	const hinge = WING_FLAP_PRESETS[kind].hinge;
	const quads: number[][] =
		kind === 'butterfly'
			? [
					// body (vertical sliver so it reads from the side)
					[0, -0.02, -0.12, 0, -0.02, 0.12, 0, 0.02, 0.12, 0, 0.02, -0.12],
					// fore wings
					[hinge, 0, 0.1, 0.32, 0, 0.18, 0.36, 0, -0.02, hinge, 0, -0.02],
					[-hinge, 0, -0.02, -0.36, 0, -0.02, -0.32, 0, 0.18, -hinge, 0, 0.1],
					// hind wings
					[hinge, 0, -0.02, 0.26, 0, -0.04, 0.2, 0, -0.22, hinge, 0, -0.12],
					[-hinge, 0, -0.12, -0.2, 0, -0.22, -0.26, 0, -0.04, -hinge, 0, -0.02]
				]
			: [
					// body: two slanted quads forming a wedge, beak forward
					[-hinge, 0, -0.18, hinge, 0, -0.18, 0, 0.05, 0.2, 0, 0.05, 0.2],
					[hinge, 0, -0.18, -hinge, 0, -0.18, 0, -0.05, 0.16, 0, -0.05, 0.16],
					[hinge, 0, 0.08, 0.34, 0, 0.0, 0.3, 0, -0.1, hinge, 0, -0.08],
					[-hinge, 0, -0.08, -0.3, 0, -0.1, -0.34, 0, 0.0, -hinge, 0, 0.08]
				];
	const positions: number[] = [];
	const normals: number[] = [];
	for (const q of quads) {
		const corners = [0, 1, 2, 0, 2, 3];
		for (const c of corners) positions.push(q[c * 3], q[c * 3 + 1], q[c * 3 + 2]);
	}
	const geometry = new BufferGeometry();
	geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
	geometry.computeVertexNormals();
	for (let i = 0; i < positions.length; i++) normals.push(0);
	geometry.computeBoundingSphere();
	return geometry;
}

export interface FlockMeshOptions {
	/** One colour for all, or a palette cycled over the instances (per-instance colour keeps 1 draw call). */
	colors?: readonly ColorRepresentation[];
	/** World size of one flyer (the geometry spans about 0.7 units across the wings). */
	scale?: number;
	settings?: Partial<WingFlapSettings>;
}

export class FlockMesh {
	readonly mesh: InstancedMesh;
	readonly uniforms: WingFlapUniforms;
	readonly material: MeshLambertMaterial;
	/** World size of one flyer (read by Flock.writeMatrices). */
	scale: number;

	constructor(flock: Flock, options: FlockMeshOptions = {}) {
		const settings = { ...WING_FLAP_PRESETS[flock.kind], ...options.settings };
		this.uniforms = createWingFlapUniforms(settings);
		this.scale = options.scale ?? (flock.kind === 'butterfly' ? 0.5 : 0.6);
		const geometry = createFlyerGeometry(flock.kind);
		geometry.setAttribute(
			WING_FLAP_ATTRIBUTE,
			new InstancedBufferAttribute(Float32Array.from(flock.phase), 1)
		);
		const material = new MeshLambertMaterial({ side: DoubleSide, flatShading: true });
		const uniforms = this.uniforms;
		material.onBeforeCompile = (shader) => {
			patchWingFlap(shader, uniforms);
		};
		material.customProgramCacheKey = () => WING_FLAP_CACHE_KEY;
		this.material = material;
		const mesh = new InstancedMesh(geometry, material, flock.count);
		mesh.instanceMatrix.setUsage(DynamicDrawUsage);
		mesh.castShadow = false;
		mesh.receiveShadow = false;
		const colors =
			options.colors ??
			(flock.kind === 'butterfly' ? ['#3e9ccf', '#f2c94c', '#ff9fb7'] : ['#4f9a6e', '#73cbf0']);
		const color = new Color();
		for (let i = 0; i < flock.count; i++) mesh.setColorAt(i, color.set(colors[i % colors.length]));
		const b = flock.bounds;
		const center = new Vector3((b[0] + b[3]) / 2, (b[1] + b[4]) / 2, (b[2] + b[5]) / 2);
		const radius = Math.hypot(b[3] - b[0], b[4] - b[1], b[5] - b[2]) / 2 + this.scale;
		mesh.boundingSphere = new Sphere(center, radius);
		this.mesh = mesh;
		this.update(flock);
	}

	/** Copies the flock into the instance matrices and advances the wing clock. No allocation. */
	update(flock: Flock) {
		flock.writeMatrices(this.mesh.instanceMatrix.array as Float32Array, this);
		this.mesh.instanceMatrix.needsUpdate = true;
		this.uniforms.uFlapTime.value = flock.time;
	}

	dispose() {
		this.mesh.geometry.dispose();
		this.material.dispose();
		this.mesh.dispose();
	}
}
