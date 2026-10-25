/**
 * Living things that move: birds (stage 3) and fireflies (the oath), plus
 * the araucária's soft glow. Each is a single draw call. They only animate
 * while the scene is in motion; when idle they hold still and nothing renders.
 */
import {
	BufferAttribute,
	BufferGeometry,
	type Color,
	InstancedMesh,
	Matrix4,
	Mesh,
	type MeshBasicMaterial,
	Points,
	Quaternion,
	Vector3
} from 'three';
import { rng, type V3 } from './builder.ts';
import { ARAUCARIA, heightAt, RX, RZ, rimDistance } from './layout.ts';
import { birdMaterial, type FireflyUniforms, fireflyMaterial, glowMaterial } from './materials.ts';

const UP = new Vector3(0, 1, 0);

/** Birds circling above the forest, two instanced wings per bird. */
export class Birds {
	readonly mesh: InstancedMesh<BufferGeometry, MeshBasicMaterial>;
	private readonly matrix = new Matrix4();
	private readonly wing = new Matrix4();
	private readonly q = new Quaternion();
	private readonly pos = new Vector3();
	private readonly scl = new Vector3();
	private readonly flight: {
		cx: number;
		cy: number;
		cz: number;
		rx: number;
		rz: number;
		speed: number;
		phase: number;
		size: number;
	}[];

	constructor(count: number) {
		const geometry = new BufferGeometry();
		// One wing: root along z, tip out along +x, slightly swept back.
		geometry.setAttribute(
			'position',
			new BufferAttribute(
				new Float32Array([
					0, 0, 0.07, 0, 0, -0.05, 0.2, 0.01, -0.06, 0, 0, -0.05, 0.11, 0, -0.1, 0.2, 0.01, -0.06
				]),
				3
			)
		);
		this.mesh = new InstancedMesh(geometry, birdMaterial(), count * 2);
		this.mesh.frustumCulled = false;
		const rand = rng(77);
		this.flight = Array.from({ length: count }, (_, i) => ({
			cx: 0.2 + (rand() - 0.5) * 1.2,
			cy: 2.3 + rand() * 0.6,
			cz: -0.7 + (rand() - 0.5) * 0.6,
			rx: 1.5 + rand() * 1.2,
			rz: 0.7 + rand() * 0.5,
			speed: (0.22 + rand() * 0.12) * (i % 3 === 0 ? -1 : 1),
			phase: rand() * Math.PI * 2,
			size: 0.85 + rand() * 0.35
		}));
	}

	setColor(color: Color) {
		this.mesh.material.color.copy(color);
	}

	/** Places the birds at flight time `t`; `presence` (0..1) scales them in. */
	update(t: number, presence: number) {
		this.mesh.visible = presence > 0.001;
		if (!this.mesh.visible) return;
		this.flight.forEach((f, i) => {
			const a = f.phase + t * f.speed;
			const x = f.cx + Math.cos(a) * f.rx;
			const z = f.cz + Math.sin(a) * f.rz;
			const y = f.cy + Math.sin(a * 2 + f.phase) * 0.12;
			// Heading along the circle's tangent (local +z is the bird's nose).
			const dir = Math.sign(f.speed);
			const heading = Math.atan2(-Math.sin(a) * f.rx * dir, Math.cos(a) * f.rz * dir);
			const flap =
				0.28 + Math.sin(t * 9 + f.phase * 3) * 0.5 * Math.min(1, Math.abs(Math.sin(t * 0.7 + f.phase)) + 0.3);
			const s = f.size * presence;
			for (const side of [1, -1]) {
				this.q.setFromAxisAngle(UP, heading);
				this.pos.set(x, y, z);
				this.scl.set(s * side, s, s);
				this.matrix.compose(this.pos, this.q, this.scl);
				this.wing.makeRotationZ(flap);
				this.matrix.multiply(this.wing);
				this.mesh.setMatrixAt(i * 2 + (side > 0 ? 0 : 1), this.matrix);
			}
		});
		this.mesh.instanceMatrix.needsUpdate = true;
	}
}

/** Fireflies for the oath: drifting, twinkling points. */
export class Fireflies {
	readonly points: Points;
	readonly uniforms: FireflyUniforms;

	constructor(count: number) {
		const rand = rng(91);
		const pos: number[] = [];
		const phase: number[] = [];
		while (pos.length / 3 < count) {
			const nearTree = pos.length / 3 < count * 0.3;
			const x = nearTree ? ARAUCARIA[0] + (rand() - 0.5) * 2.2 : (rand() * 2 - 1) * RX * 0.92;
			const z = nearTree ? ARAUCARIA[2] + (rand() - 0.5) * 1.2 : (rand() * 2 - 1) * RZ * 0.9;
			if (rimDistance(x, z) > 0.92) continue;
			const y = heightAt(x, z) + (nearTree ? 0.8 + rand() * 1.6 : 0.15 + rand() * 1.1);
			pos.push(x, y, z);
			phase.push(rand());
		}
		const geometry = new BufferGeometry();
		geometry.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
		geometry.setAttribute('aPhase', new BufferAttribute(new Float32Array(phase), 1));
		const { material, uniforms } = fireflyMaterial();
		this.points = new Points(geometry, material);
		this.points.frustumCulled = false;
		this.uniforms = uniforms;
	}
}

/** A soft radial glow behind the araucária's crown, always facing the camera. */
export function glowDisc(radius: number, segments: number): { mesh: Mesh; alpha: Float32Array; centre: V3 } {
	const pos: number[] = [];
	const alpha: number[] = [];
	const rings = [
		{ r: 0, a: 0.34 },
		{ r: 0.45, a: 0.2 },
		{ r: 1, a: 0 }
	];
	const ring = (k: number, j: number): [number, number, number] => {
		const ang = (j / segments) * Math.PI * 2;
		return [Math.cos(ang) * rings[k].r * radius, Math.sin(ang) * rings[k].r * radius, 0];
	};
	for (let k = 0; k < rings.length - 1; k++) {
		for (let j = 0; j < segments; j++) {
			const quad = [ring(k, j), ring(k + 1, j), ring(k + 1, j + 1), ring(k, j + 1)];
			const al = [rings[k].a, rings[k + 1].a, rings[k + 1].a, rings[k].a];
			for (const idx of [0, 1, 2, 0, 2, 3]) {
				pos.push(...quad[idx]);
				alpha.push(al[idx]);
			}
		}
	}
	const geometry = new BufferGeometry();
	geometry.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
	geometry.setAttribute('color', new BufferAttribute(new Float32Array((pos.length / 3) * 4), 4));
	const mesh = new Mesh(geometry, glowMaterial());
	mesh.renderOrder = -1;
	const centre: V3 = [ARAUCARIA[0], heightAt(ARAUCARIA[0], ARAUCARIA[2]) + 1.85, ARAUCARIA[2] - 0.35];
	mesh.position.set(...centre);
	return { mesh, alpha: new Float32Array(alpha), centre };
}
