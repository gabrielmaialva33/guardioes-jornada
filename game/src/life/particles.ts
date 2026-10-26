/**
 * Ambient particles of ART.md §8: one pooled system, ONE draw call (an
 * InstancedMesh of alpha-blended quads in palette colours), for
 * - falling leaves, spawned in the crowns near the player (the canopy grid of
 *   homes.ts), fluttering and tumbling down in the wind, then lying flat and
 *   fading on the ground;
 * - pollen in the clearings (FLAG.cleared, no crown above), tiny squares facing
 *   the camera, drifting with the wind.
 *
 * The live count never exceeds the tier limit (LIFE_TIERS.particles: 80 on low,
 * 150 elsewhere), which leaves ART.md's 120 / 200 room for the ≤ 15 butterflies
 * and the water splashes. With reduced motion nothing spawns and what is alive
 * fades out in 120 ms. update() allocates nothing; draws come from a seeded
 * generator, so a seed replays the same particles.
 */
import {
	type Camera,
	Color,
	DoubleSide,
	DynamicDrawUsage,
	InstancedBufferAttribute,
	InstancedMesh,
	MeshBasicMaterial,
	PlaneGeometry
} from 'three';
import { REDUCED_MOTION_DURATION } from '../style/motion.ts';
import { RAMPS } from '../style/palette.ts';
import { FLAG } from '../survival/types.ts';
import { GroundSampler } from './ground.ts';
import type { CanopyGrid } from './homes.ts';
import { LifeRng } from './rng.ts';
import { WIND, WindSample } from './wind.ts';

/** Tuning [engine]. */
export const PARTICLES = {
	/** Pool size: the highest tier limit. */
	capacity: 150,
	/** Spawn attempts per second around the player, and the radius they land in, u. */
	leafRate: 7,
	pollenRate: 8,
	radius: 13,
	/** Beyond this distance from the player a particle is dropped, u. */
	keep: 22,
	/** Leaf quad, u (about 5 × 3 cm × ART.md's ×1.5 would vanish: drawn readable), and fall speed, u/s. */
	leafWidth: 0.24,
	leafHeight: 0.15,
	fall: [0.45, 0.85],
	/** Seconds a fallen leaf lies on the ground while it fades. */
	rest: 1.4,
	pollenSize: 0.075,
	pollenLife: [5, 9],
	/** Fade-in, s, and the largest opacity per kind. */
	fadeIn: 0.4,
	leafAlpha: 0.95,
	pollenAlpha: 0.8
} as const;

/** Palette colours (ART.md §2): live and dry leaves; pale seeds and pollen. */
export const PARTICLE_COLORS = {
	leaf: [RAMPS.leaf[1], RAMPS.leaf[2], RAMPS.grass[2], RAMPS.wood[2], RAMPS.soil[2]],
	pollen: [RAMPS.wood[3], RAMPS.grass[3], RAMPS.leaf[3], RAMPS.rock[3]]
} as const;

const LEAF = 0;
const POLLEN = 1;

/** The numbers update() reads, refilled by the living world each frame. */
export class ParticleFrame {
	dt = 0;
	time = 0;
	playerX = 0;
	playerY = 0;
	playerZ = 0;
	reducedMotion = false;
	camera: Camera | null = null;
}

export const PARTICLE_ALPHA = 'lifeAlpha';

export class ParticleState {
	kind: 'leaf' | 'pollen' = 'leaf';
	x = 0;
	y = 0;
	z = 0;
	alpha = 0;
	landed = false;
}

function insertAfter(source: string, anchor: string, code: string): string {
	const first = source.indexOf(anchor);
	if (first < 0 || source.indexOf(anchor, first + anchor.length) >= 0)
		throw new Error(`life particles: expected exactly one ${anchor}`);
	return source.replace(anchor, `${anchor}\n${code}`);
}

/** Per-instance opacity on MeshBasicMaterial (exported for the shader test). */
export function patchParticleShader(shader: { vertexShader: string; fragmentShader: string }) {
	shader.vertexShader = insertAfter(
		shader.vertexShader,
		'#include <common>',
		`attribute float ${PARTICLE_ALPHA};\nvarying float vLifeAlpha;`
	);
	shader.vertexShader = insertAfter(
		shader.vertexShader,
		'#include <begin_vertex>',
		`vLifeAlpha = ${PARTICLE_ALPHA};`
	);
	shader.fragmentShader = insertAfter(
		shader.fragmentShader,
		'#include <common>',
		'varying float vLifeAlpha;'
	);
	shader.fragmentShader = insertAfter(
		shader.fragmentShader,
		'#include <color_fragment>',
		'diffuseColor.a *= vLifeAlpha;'
	);
}

export class AmbientParticles {
	readonly mesh: InstancedMesh;
	readonly capacity: number;
	/** Live particles allowed now (the tier limit). */
	limit: number;
	readonly frame = new ParticleFrame();
	live = 0;
	leaves = 0;
	pollen = 0;
	/** Most particles alive at once since creation (tests, debug). */
	peak = 0;
	spawned = 0;
	readonly #kind: Uint8Array;
	readonly #x: Float64Array;
	readonly #y: Float64Array;
	readonly #z: Float64Array;
	readonly #vy: Float64Array;
	readonly #age: Float64Array;
	readonly #life: Float64Array;
	readonly #spin: Float64Array;
	readonly #spinRate: Float64Array;
	readonly #phase: Float64Array;
	readonly #landed: Uint8Array;
	readonly #alpha: Float32Array;
	readonly #colors: Float32Array;
	readonly #palette: Float32Array;
	readonly #matrices: Float32Array;
	readonly #alphaAttribute: InstancedBufferAttribute;
	readonly #colorAttribute: InstancedBufferAttribute;
	readonly #ranges = [
		{ start: 0, count: 0 },
		{ start: 0, count: 0 },
		{ start: 0, count: 0 }
	];
	readonly #material: MeshBasicMaterial;
	readonly #rng: LifeRng;
	readonly #wind = new WindSample();
	readonly #ground: GroundSampler;
	readonly #canopy: CanopyGrid;
	readonly #flags: Uint8Array;
	readonly #grid: number;
	readonly #size: number;
	#leafBudget = 0;
	#pollenBudget = 0;
	readonly #leafRate: number;
	readonly #pollenRate: number;

	constructor(options: {
		canopy: CanopyGrid;
		heights: Float32Array;
		flags: Uint8Array;
		size: number;
		seed: number;
		limit: number;
		capacity?: number;
		/** Spawn attempts per second (tests); default PARTICLES.leafRate and pollenRate. */
		rates?: { leaf: number; pollen: number };
	}) {
		const capacity = Math.max(1, Math.floor(options.capacity ?? PARTICLES.capacity));
		this.capacity = capacity;
		this.limit = Math.min(capacity, Math.max(0, Math.floor(options.limit)));
		this.#canopy = options.canopy;
		this.#flags = options.flags;
		this.#size = options.size;
		this.#grid = options.size + 1;
		this.#ground = new GroundSampler(options.heights, options.size);
		this.#rng = new LifeRng(options.seed);
		this.#leafRate = options.rates?.leaf ?? PARTICLES.leafRate;
		this.#pollenRate = options.rates?.pollen ?? PARTICLES.pollenRate;
		this.#kind = new Uint8Array(capacity);
		this.#landed = new Uint8Array(capacity);
		this.#x = new Float64Array(capacity);
		this.#y = new Float64Array(capacity);
		this.#z = new Float64Array(capacity);
		this.#vy = new Float64Array(capacity);
		this.#age = new Float64Array(capacity);
		this.#life = new Float64Array(capacity);
		this.#spin = new Float64Array(capacity);
		this.#spinRate = new Float64Array(capacity);
		this.#phase = new Float64Array(capacity);
		this.#colors = new Float32Array(capacity * 3);
		// Palette in linear RGB, leaves then pollen.
		const all = [...PARTICLE_COLORS.leaf, ...PARTICLE_COLORS.pollen];
		this.#palette = new Float32Array(all.length * 3);
		const color = new Color();
		all.forEach((hex, i) => {
			color.set(hex);
			this.#palette[i * 3] = color.r;
			this.#palette[i * 3 + 1] = color.g;
			this.#palette[i * 3 + 2] = color.b;
		});
		const geometry = new PlaneGeometry(1, 1);
		geometry.deleteAttribute('normal');
		geometry.deleteAttribute('uv');
		this.#alpha = new Float32Array(capacity);
		this.#alphaAttribute = new InstancedBufferAttribute(this.#alpha, 1);
		this.#alphaAttribute.setUsage(DynamicDrawUsage);
		geometry.setAttribute(PARTICLE_ALPHA, this.#alphaAttribute);
		const material = new MeshBasicMaterial({
			name: 'life-particles',
			transparent: true,
			depthWrite: false,
			side: DoubleSide,
			fog: true
		});
		material.onBeforeCompile = (shader) => patchParticleShader(shader);
		material.customProgramCacheKey = () => 'life-particles';
		this.#material = material;
		const mesh = new InstancedMesh(geometry, material, capacity);
		mesh.name = 'life-particles';
		mesh.count = 0;
		mesh.frustumCulled = false;
		mesh.castShadow = false;
		mesh.receiveShadow = false;
		mesh.matrixAutoUpdate = false;
		mesh.instanceMatrix.setUsage(DynamicDrawUsage);
		this.#colorAttribute = new InstancedBufferAttribute(this.#colors, 3);
		this.#colorAttribute.setUsage(DynamicDrawUsage);
		mesh.instanceColor = this.#colorAttribute;
		this.#matrices = mesh.instanceMatrix.array as Float32Array;
		mesh.instanceMatrix.updateRanges.push(this.#ranges[0]);
		this.#colorAttribute.updateRanges.push(this.#ranges[1]);
		this.#alphaAttribute.updateRanges.push(this.#ranges[2]);
		this.mesh = mesh;
	}

	/**
	 * A new tier limit. When it drops below the live count, the particles over it fade out in
	 * 120 ms (no pop) and nothing spawns until the count is under the limit again.
	 */
	setLimit(limit: number) {
		this.limit = Math.min(this.capacity, Math.max(0, Math.floor(limit)));
		for (let i = this.limit; i < this.live; i++) {
			const end = this.#age[i] + REDUCED_MOTION_DURATION;
			if (this.#life[i] > end) this.#life[i] = end;
		}
	}

	/** One frame. Reads this.frame. Allocates nothing. */
	update() {
		const frame = this.frame;
		const dt = frame.dt > 0 ? Math.min(frame.dt, 0.25) : 0;
		const reduced = frame.reducedMotion;
		const wind = this.#wind;
		wind.atX = frame.playerX;
		wind.atZ = frame.playerZ;
		wind.time = frame.time;
		wind.strength = reduced ? 0 : 1;
		wind.read();
		if (reduced) {
			// Stop decorative motion: no new particles; the live ones fade out in 120 ms where they are.
			this.#leafBudget = this.#pollenBudget = 0;
			for (let i = 0; i < this.live; i++) {
				const end = this.#age[i] + REDUCED_MOTION_DURATION;
				if (this.#life[i] > end) this.#life[i] = end;
			}
		} else {
			this.#leafBudget += this.#leafRate * dt;
			this.#pollenBudget += this.#pollenRate * dt;
			while (this.#leafBudget >= 1) {
				this.#leafBudget -= 1;
				this.#trySpawn(LEAF);
			}
			while (this.#pollenBudget >= 1) {
				this.#pollenBudget -= 1;
				this.#trySpawn(POLLEN);
			}
		}

		const motion = reduced ? 0 : dt;
		const airX = wind.x * WIND.speed;
		const airZ = wind.z * WIND.speed;
		const ground = this.#ground;
		const keep2 = PARTICLES.keep * PARTICLES.keep;
		let i = 0;
		while (i < this.live) {
			this.#age[i] += dt;
			const age = this.#age[i];
			const dx = this.#x[i] - frame.playerX;
			const dz = this.#z[i] - frame.playerZ;
			if (age >= this.#life[i] || dx * dx + dz * dz > keep2) {
				this.#remove(i);
				continue;
			}
			if (this.#kind[i] === LEAF) {
				if (this.#landed[i] === 0) {
					const phase = this.#phase[i] + age * 2.6;
					// Flutter: a side-to-side swing as it falls, carried by the wind.
					this.#x[i] += (airX * 0.8 + Math.sin(phase) * 0.35) * motion;
					this.#z[i] += (airZ * 0.8 + Math.cos(phase * 0.7) * 0.25) * motion;
					this.#y[i] += this.#vy[i] * motion;
					this.#spin[i] += this.#spinRate[i] * motion;
					ground.x = this.#x[i];
					ground.z = this.#z[i];
					ground.sample();
					if (this.#y[i] <= ground.y + 0.03) {
						this.#y[i] = ground.y + 0.03;
						this.#landed[i] = 1;
						const end = age + PARTICLES.rest;
						if (this.#life[i] > end) this.#life[i] = end;
					}
				}
			} else {
				const phase = this.#phase[i] + age * 1.3;
				this.#x[i] += (airX * 0.55 + Math.sin(phase) * 0.08) * motion;
				this.#z[i] += (airZ * 0.55 + Math.cos(phase * 1.3) * 0.08) * motion;
				this.#y[i] += Math.sin(phase * 1.7) * 0.12 * motion;
			}
			const max = this.#kind[i] === LEAF ? PARTICLES.leafAlpha : PARTICLES.pollenAlpha;
			const fadeOut = this.#landed[i] === 1 ? PARTICLES.rest : 1.2;
			let alpha = age < PARTICLES.fadeIn ? age / PARTICLES.fadeIn : 1;
			const left = this.#life[i] - age;
			if (left < fadeOut) alpha = Math.min(alpha, left / fadeOut);
			this.#alpha[i] = alpha * max;
			i++;
		}
		this.#write(frame.camera);
	}

	#trySpawn(kind: number) {
		if (this.live >= this.limit) return;
		const frame = this.frame;
		// Draws go through rng.step() / rng.value: a number returned from a call V8 does not inline is boxed.
		const rng = this.#rng;
		const canopy = this.#canopy;
		for (let attempt = 0; attempt < 3; attempt++) {
			rng.step();
			const r = PARTICLES.radius * Math.sqrt(rng.value);
			rng.step();
			const a = rng.value * Math.PI * 2;
			const x = frame.playerX + Math.sin(a) * r;
			const z = frame.playerZ + Math.cos(a) * r;
			if (x < 0 || z < 0 || x >= this.#size || z >= this.#size) continue;
			const cell = Math.floor(z / canopy.cell) * canopy.side + Math.floor(x / canopy.cell);
			const high = canopy.high[cell];
			const ground = this.#ground;
			ground.x = x;
			ground.z = z;
			ground.sample();
			const i = this.live;
			if (kind === LEAF) {
				if (high <= 0) continue;
				const low = canopy.low[cell];
				rng.step();
				this.#y[i] = low + (high - low) * rng.value * 0.6;
				rng.step();
				this.#vy[i] = -(PARTICLES.fall[0] + (PARTICLES.fall[1] - PARTICLES.fall[0]) * rng.value);
				this.#life[i] = 40;
				rng.step();
				this.#spinRate[i] = (rng.value - 0.5) * 5;
				rng.step();
				this.#setColor(i, Math.floor(rng.value * PARTICLE_COLORS.leaf.length));
			} else {
				const flags = this.#flags[Math.round(z) * this.#grid + Math.round(x)];
				if (high > 0 || !(flags & FLAG.cleared) || flags & FLAG.river) continue;
				rng.step();
				this.#y[i] = ground.y + 0.4 + 2.2 * rng.value;
				this.#vy[i] = 0;
				rng.step();
				this.#life[i] =
					PARTICLES.pollenLife[0] + (PARTICLES.pollenLife[1] - PARTICLES.pollenLife[0]) * rng.value;
				this.#spinRate[i] = 0;
				rng.step();
				this.#setColor(
					i,
					PARTICLE_COLORS.leaf.length + Math.floor(rng.value * PARTICLE_COLORS.pollen.length)
				);
			}
			this.#kind[i] = kind;
			this.#landed[i] = 0;
			this.#x[i] = x;
			this.#z[i] = z;
			this.#age[i] = 0;
			rng.step();
			this.#spin[i] = rng.value * Math.PI * 2;
			rng.step();
			this.#phase[i] = rng.value * Math.PI * 2;
			this.#alpha[i] = 0;
			this.live++;
			if (this.live > this.peak) this.peak = this.live;
			this.spawned++;
			return;
		}
	}

	#setColor(i: number, entry: number) {
		this.#colors[i * 3] = this.#palette[entry * 3];
		this.#colors[i * 3 + 1] = this.#palette[entry * 3 + 1];
		this.#colors[i * 3 + 2] = this.#palette[entry * 3 + 2];
	}

	/** Swap-removes particle i (the last live one takes its slot). */
	#remove(i: number) {
		const last = --this.live;
		if (i === last) return;
		this.#kind[i] = this.#kind[last];
		this.#landed[i] = this.#landed[last];
		this.#x[i] = this.#x[last];
		this.#y[i] = this.#y[last];
		this.#z[i] = this.#z[last];
		this.#vy[i] = this.#vy[last];
		this.#age[i] = this.#age[last];
		this.#life[i] = this.#life[last];
		this.#spin[i] = this.#spin[last];
		this.#spinRate[i] = this.#spinRate[last];
		this.#phase[i] = this.#phase[last];
		this.#alpha[i] = this.#alpha[last];
		this.#colors[i * 3] = this.#colors[last * 3];
		this.#colors[i * 3 + 1] = this.#colors[last * 3 + 1];
		this.#colors[i * 3 + 2] = this.#colors[last * 3 + 2];
	}

	/** Instance matrices (tumbling leaves, camera-facing pollen) and the upload ranges. */
	#write(camera: Camera | null) {
		const m = this.#matrices;
		let rx = 1;
		let ry = 0;
		let rz = 0;
		let ux = 0;
		let uy = 1;
		let uz = 0;
		let bx = 0;
		let by = 0;
		let bz = 1;
		if (camera) {
			const e = camera.matrixWorld.elements;
			rx = e[0];
			ry = e[1];
			rz = e[2];
			ux = e[4];
			uy = e[5];
			uz = e[6];
			bx = e[8];
			by = e[9];
			bz = e[10];
		}
		let leaves = 0;
		for (let i = 0; i < this.live; i++) {
			const o = i * 16;
			if (this.#kind[i] === LEAF) {
				leaves++;
				// R = Ry(spin) · Rx(tilt) on a quad in the xy plane; landed leaves lie flat.
				const spin = this.#spin[i];
				const tilt =
					this.#landed[i] === 1 ? -Math.PI / 2 : 0.9 * Math.sin(this.#phase[i] + this.#age[i] * 3.1);
				const cy = Math.cos(spin);
				const sy = Math.sin(spin);
				const cx = Math.cos(tilt);
				const sx = Math.sin(tilt);
				const w = PARTICLES.leafWidth;
				const h = PARTICLES.leafHeight;
				// Columns of Ry·Rx: x axis, y axis, z axis.
				m[o] = cy * w;
				m[o + 1] = 0;
				m[o + 2] = -sy * w;
				m[o + 3] = 0;
				m[o + 4] = sy * sx * h;
				m[o + 5] = cx * h;
				m[o + 6] = cy * sx * h;
				m[o + 7] = 0;
				m[o + 8] = sy * cx;
				m[o + 9] = -sx;
				m[o + 10] = cy * cx;
				m[o + 11] = 0;
			} else {
				const s = PARTICLES.pollenSize;
				m[o] = rx * s;
				m[o + 1] = ry * s;
				m[o + 2] = rz * s;
				m[o + 3] = 0;
				m[o + 4] = ux * s;
				m[o + 5] = uy * s;
				m[o + 6] = uz * s;
				m[o + 7] = 0;
				m[o + 8] = bx;
				m[o + 9] = by;
				m[o + 10] = bz;
				m[o + 11] = 0;
			}
			m[o + 12] = this.#x[i];
			m[o + 13] = this.#y[i];
			m[o + 14] = this.#z[i];
			m[o + 15] = 1;
		}
		this.leaves = leaves;
		this.pollen = this.live - leaves;
		const mesh = this.mesh;
		mesh.count = this.live;
		const live = this.live;
		this.#ranges[0].count = live * 16;
		this.#ranges[1].count = live * 3;
		this.#ranges[2].count = live;
		if (live > 0) {
			mesh.instanceMatrix.needsUpdate = true;
			this.#colorAttribute.needsUpdate = true;
			this.#alphaAttribute.needsUpdate = true;
		}
	}

	/** Particle i's state (tests, debug): `out` is filled and returned. */
	read(i: number, out: ParticleState): ParticleState {
		out.kind = this.#kind[i] === LEAF ? 'leaf' : 'pollen';
		out.x = this.#x[i];
		out.y = this.#y[i];
		out.z = this.#z[i];
		out.alpha = this.#alpha[i];
		out.landed = this.#landed[i] === 1;
		return out;
	}

	dispose() {
		this.live = 0;
		this.mesh.count = 0;
		this.mesh.removeFromParent();
		this.mesh.geometry.dispose();
		this.#material.dispose();
		this.mesh.dispose();
		this.frame.camera = null;
	}
}
