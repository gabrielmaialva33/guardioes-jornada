/**
 * The whole diorama: builds every stage once, then only moves uniforms.
 * Ten draw calls in total: island, stage 1, river water, river bed, deep
 * forest, birds, mountains, araucárias, glow and fireflies.
 *
 * Growth is a set of tweens (one per stage plus the oath) advanced by
 * `step(dt)`, which reports whether anything is still moving; the engine
 * stops rendering as soon as it returns false.
 */
import { type BufferAttribute, type Camera, Fog, type Material, Mesh, MeshBasicMaterial, Scene } from 'three';
import { araucaria } from './araucaria.ts';
import { MeshBuilder, type Paintable, repaint, smoothstep, type V3 } from './builder.ts';
import { Birds, Fireflies, glowDisc } from './fauna.ts';
import { buildDeepForest, buildFirstTrees } from './flora.ts';
import { ARAUCARIA, heightAt, YOUNG_ARAUCARIAS } from './layout.ts';
import {
	type GrowthUniforms,
	growthMaterial,
	setFireflyBlending,
	type WaterUniforms,
	waterMaterial
} from './materials.ts';
import { type Palette, TONE } from './palette.ts';
import { buildRiver } from './river.ts';
import { buildIsland, buildMountains, buildTrail } from './terrain.ts';
import { yieldToMain } from './yield.ts';

export type Quality = 'lite' | 'full';

export interface View {
	/** Missions completed, 0..5. */
	stage: number;
	oath: boolean;
	/** False under prefers-reduced-motion: snap, never tween. */
	animate: boolean;
}

const DETAIL = {
	full: {
		rings: 16,
		segments: 72,
		flowers: 70,
		grass: 170,
		river: 8,
		forest: 21,
		birds: 7,
		fireflies: 72,
		whorls: 6,
		branches: 6,
		peakSides: 9
	},
	lite: {
		rings: 10,
		segments: 44,
		flowers: 36,
		grass: 60,
		river: 5,
		forest: 12,
		birds: 5,
		fireflies: 28,
		whorls: 4,
		branches: 5,
		peakSides: 7
	}
};

/** Seconds each stage takes to grow (index = stage). */
const GROW_SECONDS = [0, 1.9, 2.1, 2.2, 2.0, 2.9];
const OATH_SECONDS = 1.6;
/** Gap between stages when several unlock at once. */
const STAGGER = 0.55;

interface StagePart {
	mesh: Mesh;
	uniforms: GrowthUniforms | WaterUniforms;
}

export class World {
	readonly scene = new Scene();
	private triangleCount = 0;
	get triangles() { return this.triangleCount; }
	private readonly paintables: Paintable[] = [];
	private readonly parts: StagePart[][] = [[], [], [], [], [], []];
	private water!: WaterUniforms;
	private birds!: Birds;
	private fireflies!: Fireflies;
	private glow!: { mesh: Mesh; alpha: Float32Array };

	// Tweens: index 0..5 are stages (0 is always grown), 6 is the oath.
	private readonly value = [1, 0, 0, 0, 0, 0, 0];
	private readonly target = [1, 0, 0, 0, 0, 0, 0];
	private readonly delay = [0, 0, 0, 0, 0, 0, 0];

	/** Clock for flowing water, birds and fireflies: only runs while in motion. */
	private time = 0;
	private motion = { elapsed: 0, remaining: 0, amp: 0 };

	private building: Generator<void>;

	constructor(quality: Quality, palette: Palette, deferred = false) {
		this.building = this.build(quality, palette);
		if (!deferred) while (!this.building.next().done) { /* Keep the synchronous constructor available. */ }
	}

	static async create(quality: Quality, palette: Palette, pause = yieldToMain): Promise<World> {
		const world = new World(quality, palette, true);
		while (!world.building.next().done) await pause();
		return world;
	}

	private *build(quality: Quality, palette: Palette): Generator<void> {
		const d = DETAIL[quality];
		let triangles = 0;

		const add = (
			b: MeshBuilder,
			material: Material,
			stage: number,
			uniforms?: GrowthUniforms | WaterUniforms,
			extraName?: string
		) => {
			const p = b.build(palette, { growth: stage > 0, extraName });
			this.paintables.push(p);
			const mesh = new Mesh(p.geometry, material);
			mesh.matrixAutoUpdate = false;
			mesh.updateMatrix();
			this.scene.add(mesh);
			triangles += b.triangles;
			if (uniforms) this.parts[stage].push({ mesh, uniforms });
			return mesh;
		};
		const growing = (stage: number, build: (b: MeshBuilder) => void) => {
			const b = new MeshBuilder();
			build(b);
			const { material, uniforms } = growthMaterial();
			add(b, material, stage, uniforms);
		};

		// Stage 0: the island and its clearing.
		const island = new MeshBuilder();
		buildIsland(island, d);
		add(island, new MeshBasicMaterial({ vertexColors: true }), 0);
		yield;

		// Stage 1: the trail, then the first canelas and cedros.
		growing(1, (b) => {
			buildTrail(b, 0, 0.35);
			buildFirstTrees(b, 0.2);
		});
		yield;

		// Stage 2: the spring and the river.
		const waterB = new MeshBuilder(2);
		const bedB = new MeshBuilder();
		buildRiver(waterB, bedB, d.river);
		const water = waterMaterial();
		this.water = water.uniforms;
		add(waterB, water.material, 2, water.uniforms, 'aFlow');
		const bed = growthMaterial();
		add(bedB, bed.material, 2, bed.uniforms);
		yield;

		// Stage 3: the deep forest and the birds.
		growing(3, (b) => buildDeepForest(b, d.forest));
		this.birds = new Birds(d.birds);
		this.scene.add(this.birds.mesh);
		triangles += d.birds * 4;
		yield;

		// Stage 4: the mountains.
		growing(4, (b) => buildMountains(b, d.peakSides));
		yield;

		// Stage 5: the araucária, with two young ones further back.
		growing(5, (b) => {
			const base: V3 = [ARAUCARIA[0], heightAt(ARAUCARIA[0], ARAUCARIA[2]), ARAUCARIA[2]];
			araucaria(b, base, { height: 2.5, whorls: d.whorls, branches: d.branches, order: 0, seed: 3 });
			YOUNG_ARAUCARIAS.forEach(([x, z, h], i) => {
				araucaria(b, [x, heightAt(x, z), z], {
					height: h,
					whorls: Math.max(3, d.whorls - 1),
					branches: d.branches,
					order: 0.3 + i * 0.12,
					seed: 11 + i * 5
				});
			});
		});
		this.glow = glowDisc(1.55, quality === 'full' ? 24 : 16);
		this.scene.add(this.glow.mesh);
		yield;

		// The oath: fireflies.
		this.fireflies = new Fireflies(d.fireflies);
		this.scene.add(this.fireflies.points);

		yield;
		this.triangleCount = triangles;
		this.scene.fog = new Fog(0x000000, 10, 24);
		this.recolor(palette);
		this.apply();
	}

	/** Repaints everything for a theme change. */
	recolor(palette: Palette) {
		for (const p of this.paintables) repaint(p, palette);
		const c = (t: keyof typeof TONE) => palette.colors[TONE[t]];
		(this.scene.fog as Fog).color.copy(c('sky-bottom'));
		this.birds.setColor(c('text-soft'));
		const fly = palette.dark ? c('gold').clone() : c('sun').clone().lerp(c('gold'), 0.45);
		this.fireflies.uniforms.uColor.value.copy(fly);
		setFireflyBlending(this.fireflies.points.material as never, palette.dark);

		// Glow: sun-coloured, a little stronger at night.
		const colors = (this.glow.mesh.geometry.getAttribute('color') as BufferAttribute).array as Float32Array;
		const sun = c('sun');
		const gain = palette.dark ? 1 : 0.85;
		for (let i = 0; i < this.glow.alpha.length; i++) {
			colors.set([sun.r, sun.g, sun.b, this.glow.alpha[i] * gain], i * 4);
		}
		this.glow.mesh.geometry.getAttribute('color').needsUpdate = true;
	}

	/** Jumps straight to a state, no animation. */
	snap(stage: number, oath: boolean) {
		for (let k = 1; k <= 5; k++) {
			this.value[k] = this.target[k] = stage >= k ? 1 : 0;
			this.delay[k] = 0;
		}
		this.value[6] = this.target[6] = oath ? 1 : 0;
		this.delay[6] = 0;
		this.motion.remaining = 0;
		this.apply();
	}

	get stage() {
		let s = 0;
		for (let k = 1; k <= 5; k++) if (this.target[k] === 1) s = k;
		return s;
	}

	get oath() {
		return this.target[6] === 1;
	}

	/** Sets the state to show; with `animate`, new stages grow one after the other. */
	setTarget(view: View) {
		const stage = Math.max(0, Math.min(5, Math.floor(view.stage)));
		let wait = 0;
		let longest = 0;
		let grew = false;
		for (let k = 1; k <= 5; k++) {
			const t = stage >= k ? 1 : 0;
			if (t === this.target[k]) continue;
			this.target[k] = t;
			if (!view.animate) {
				this.value[k] = t;
			} else if (t === 1) {
				this.delay[k] = wait;
				longest = Math.max(longest, wait + GROW_SECONDS[k] * (1 - this.value[k]));
				wait += STAGGER;
				grew = true;
			} else {
				// Forests never shrink in the story: going back (a reset, another
				// journey) is a cut, not an animation.
				this.value[k] = 0;
				this.delay[k] = 0;
			}
		}
		const oath = view.oath ? 1 : 0;
		if (oath !== this.target[6]) {
			this.target[6] = oath;
			if (!view.animate || !oath) this.value[6] = oath;
			else {
				this.delay[6] = longest * 0.6;
				this.celebrate(Math.max(5, longest + 2), 0.11);
			}
		}
		if (view.animate && grew) this.move(longest + 0.6, 0.07);
		if (!view.animate) {
			this.motion.remaining = 0;
			this.apply();
		}
	}

	/** Starts (or extends) the gentle celebration loop: fireflies, birds, a slow sway. */
	celebrate(seconds: number, amp = 0.12) {
		this.move(seconds, amp);
	}

	private move(seconds: number, amp: number) {
		if (this.motion.remaining <= 0) {
			this.motion.elapsed = 0;
			this.motion.amp = amp;
		} else {
			this.motion.amp = Math.max(this.motion.amp, amp);
		}
		this.motion.remaining = Math.max(this.motion.remaining, seconds);
	}

	/** Stops all motion where it is (tap to pause, or reduced motion). */
	stop() {
		for (let k = 1; k <= 6; k++) {
			this.value[k] = this.target[k];
			this.delay[k] = 0;
		}
		this.motion.remaining = 0;
		this.apply();
	}

	get moving() {
		return this.motion.remaining > 0 || this.value.some((v, k) => v !== this.target[k]);
	}

	/** Advances the tweens; returns true while anything still moves. */
	step(dt: number): boolean {
		let busy = false;
		for (let k = 1; k <= 6; k++) {
			if (this.value[k] === this.target[k]) continue;
			busy = true;
			if (this.delay[k] > 0) {
				this.delay[k] -= dt;
				continue;
			}
			const seconds = k === 6 ? OATH_SECONDS : GROW_SECONDS[k];
			const dir = Math.sign(this.target[k] - this.value[k]);
			this.value[k] += (dir * dt) / seconds;
			if ((dir > 0 && this.value[k] >= this.target[k]) || (dir < 0 && this.value[k] <= this.target[k])) {
				this.value[k] = this.target[k];
			}
		}
		if (this.motion.remaining > 0) {
			this.motion.remaining = Math.max(0, this.motion.remaining - dt);
			this.motion.elapsed += dt;
			busy = true;
		}
		if (busy) this.time += dt;
		this.apply();
		return busy;
	}

	/** Camera sway in radians: eases in and out, zero when idle. */
	sway(): { azimuth: number; lift: number } {
		const m = this.motion;
		if (m.remaining <= 0) return { azimuth: 0, lift: 0 };
		const env = smoothstep(0, 1.2, m.remaining) * smoothstep(0, 1.2, m.elapsed);
		return {
			azimuth: m.amp * env * Math.sin((m.elapsed / 7) * Math.PI * 2),
			lift: m.amp * 0.25 * env * Math.sin((m.elapsed / 5) * Math.PI * 2)
		};
	}

	/** Keeps the glow facing the camera. */
	faceCamera(camera: Camera) {
		this.glow.mesh.quaternion.copy(camera.quaternion);
	}

	/** Shows every mesh so the renderer can compile all shaders up front. */
	showAll() {
		for (const parts of this.parts) for (const p of parts) p.mesh.visible = true;
		this.glow.mesh.visible = true;
		this.fireflies.points.visible = true;
		this.birds.update(0, 1);
	}

	/** Pushes tween values into uniforms and visibility. */
	apply() {
		for (let k = 1; k <= 5; k++) {
			const v = this.value[k];
			for (const p of this.parts[k]) {
				p.uniforms.uGrowth.value = v;
				p.mesh.visible = v > 0.001;
			}
		}
		this.water.uTime.value = this.time;
		this.birds.update(this.time, smoothstep(0.35, 1, this.value[3]));

		const g = this.value[5];
		this.glow.mesh.visible = g > 0.4;
		const pulse = this.value[6] > 0 ? 1 + 0.05 * Math.sin(this.time * 1.4) : 1;
		this.glow.mesh.scale.setScalar(Math.max(0.001, smoothstep(0.4, 1, g)) * pulse);

		const f = this.fireflies.uniforms;
		f.uTime.value = this.time;
		f.uOpacity.value = smoothstep(0, 1, this.value[6]);
		this.fireflies.points.visible = this.value[6] > 0.001;
	}

	setPointScale(px: number) {
		this.fireflies.uniforms.uScale.value = px;
	}

	dispose() {
		this.scene.traverse((o) => {
			const m = o as Mesh;
			m.geometry?.dispose();
			const mat = m.material as Material | Material[] | undefined;
			if (Array.isArray(mat))
				mat.forEach((x) => {
					x.dispose();
				});
			else mat?.dispose();
		});
		this.birds.mesh.dispose();
	}
}
