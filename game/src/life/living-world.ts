/**
 * The living-world layer assembled from loaded parts: the animals (fauna.ts
 * over pets.ts meshes), the flocks, the ambient particles and the wind clock.
 * It owns one Group (`object3d`) the scene adds once, and it has no renderer
 * and no loop of its own: the game calls update() once per frame.
 *
 * Budget (ART.md §4/§8, measured in p8-life.md): at most one draw per visible
 * animal (≤ 13 on the story map) + butterflies + birds + particles ≤ 16 draws,
 * about 11.8k triangles with everything in view, and well under 1 ms of CPU per
 * frame on a mid phone. update() allocates nothing.
 */
import { type Camera, Group, type Texture } from 'three';
import { type AnyAnimal, OncaBehaviour, type SpeciesId } from '../animation/animals/index.ts';
import type { StoryLevel } from '../level/types.ts';
import type { Quality } from '../render/quality.ts';
import type { SurvivalWorld } from '../survival/types.ts';
import { Fauna, type HowlEvent, LIFE_TIERS, type LifeBlobs } from './fauna.ts';
import { BIRD_COUNT, LifeFlocks } from './flocks.ts';
import type { LifePlan } from './homes.ts';
import { AmbientParticles } from './particles.ts';
import { createPet, type PetInstance, type PetTemplate } from './pets.ts';
import { subSeed } from './rng.ts';
import { windClock } from './wind.ts';

export interface Vec3Like {
	x: number;
	y: number;
	z: number;
}

/** What update() reads every frame. Reuse one object. */
export interface LifeFrame {
	/** Seconds since the last frame (clamped to 0.25). */
	dt: number;
	/** The camera this frame renders with (its pose already applied). */
	camera: Camera;
	/** Player feet and velocity, u and u/s. */
	playerPosition: Vec3Like;
	playerVelocity: Vec3Like;
	/** The visual clock, seconds (drives the wind; frozen in golden captures). */
	time: number;
	/** prefers-reduced-motion or the in-game toggle (ART.md §7). */
	reducedMotion: boolean;
	/** Optional: the player is on the ground (default true), and jumped this frame (the companion hops). */
	playerGrounded?: boolean;
	playerJumped?: boolean;
}

/** The part of StoryGame the layer reads (structural). */
export interface LifeStoryState {
	completed(id: number): boolean;
	progress(id: number): number;
}

export interface LifeDebug {
	animals: number;
	animated: number;
	cap: number;
	near: number;
	far: number;
	frozen: number;
	visible: number;
	companion: boolean;
	companionState: string;
	onca: { state: string; distance: number; leaving: boolean };
	howls: number;
	choruses: number;
	particles: { live: number; leaves: number; pollen: number; limit: number; peak: number };
	butterflies: number;
	birds: number;
	/** Estimated draws and triangles of the layer this frame (visible animals, flocks, particles). */
	draws: number;
	triangles: number;
	/** update() cost over the last 120 frames, ms. */
	cpu: { mean: number; p95: number; max: number; samples: number };
}

export interface LivingWorld {
	readonly object3d: Group;
	update(frame: LifeFrame): void;
	/** Story state changed (call with the StoryGame after every revision; idempotent). */
	onStory(state: LifeStoryState): void;
	/** The renderer's tier changed. */
	setQuality(quality: Quality): void;
	/** A bugio chorus now (it also calls onHowl). */
	howl(): void;
	debug(): LifeDebug;
	dispose(): void;
}

export interface LivingWorldParts {
	plan: LifePlan;
	world: SurvivalWorld;
	level?: StoryLevel;
	quality: Quality;
	/** One baked template per species present in the plan. */
	templates: ReadonlyMap<SpeciesId, PetTemplate>;
	/** Textures the layer owns and disposes (the palettes). */
	textures?: readonly Texture[];
	onHowl?: (event: HowlEvent) => void;
	blobs?: LifeBlobs;
}

const CPU_WINDOW = 120;

export class LivingWorldRuntime implements LivingWorld {
	readonly object3d = new Group();
	readonly fauna: Fauna;
	readonly flocks: LifeFlocks;
	readonly particles: AmbientParticles;
	readonly pets: (PetInstance | null)[];
	readonly #templates: ReadonlyMap<SpeciesId, PetTemplate>;
	readonly #textures: readonly Texture[];
	readonly #cpu = new Float64Array(CPU_WINDOW);
	readonly #sorted = new Float64Array(CPU_WINDOW);
	#cpuCount = 0;
	#cpuAt = 0;
	#disposed = false;
	#profile = false;
	#story = { known: false, summit: false };

	constructor(parts: LivingWorldParts) {
		const { plan, world } = parts;
		this.object3d.name = 'life';
		this.object3d.matrixAutoUpdate = false;
		this.#templates = parts.templates;
		this.#textures = parts.textures ?? [];
		this.fauna = new Fauna(plan, world.heights, parts.quality);
		this.fauna.onHowl = parts.onHowl ?? null;
		this.pets = this.fauna.animals.map((animal) => {
			const template = parts.templates.get(animal.species.id);
			if (!template) return null;
			const pet = createPet(template);
			this.object3d.add(pet.group);
			return pet;
		});
		this.pets.forEach((pet, i) => {
			if (pet) this.fauna.bodies[i] = pet;
		});
		this.fauna.attachBlobs(parts.blobs ?? null);
		this.fauna.placeAll();
		this.flocks = new LifeFlocks(plan);
		this.object3d.add(this.flocks.butterflyMesh.mesh, this.flocks.birdMesh.mesh);
		this.particles = new AmbientParticles({
			canopy: plan.canopy,
			heights: world.heights,
			flags: world.flags,
			size: world.size,
			seed: subSeed(plan.seed, 0x9a),
			limit: LIFE_TIERS[parts.quality].particles
		});
		this.object3d.add(this.particles.mesh);
		this.object3d.updateMatrixWorld(true);
	}

	update(frame: LifeFrame) {
		if (this.#disposed) return;
		// The CPU timer starts with the first debug() call: performance.now() returns a heap number.
		const start = this.#profile ? performance.now() : 0;
		const dt = frame.dt > 0 ? Math.min(frame.dt, 0.25) : 0;
		const reduced = frame.reducedMotion;
		windClock.time = frame.time;
		windClock.reducedMotion = reduced;
		windClock.update();
		const p = frame.playerPosition;
		const v = frame.playerVelocity;

		const f = this.fauna.frame;
		f.dt = dt;
		f.playerX = p.x;
		f.playerY = p.y;
		f.playerZ = p.z;
		f.playerVx = v.x;
		f.playerVz = v.z;
		f.playerGrounded = frame.playerGrounded !== false;
		f.playerJumped = frame.playerJumped === true;
		f.reducedMotion = reduced;
		f.camera = frame.camera;
		this.fauna.update();

		const flock = this.flocks.frame;
		flock.dt = dt;
		flock.time = frame.time;
		flock.reducedMotion = reduced;
		this.flocks.update();

		const particles = this.particles.frame;
		particles.dt = dt;
		particles.time = frame.time;
		particles.playerX = p.x;
		particles.playerY = p.y;
		particles.playerZ = p.z;
		particles.reducedMotion = reduced;
		particles.camera = frame.camera;
		this.particles.update();

		if (this.#profile) {
			this.#cpu[this.#cpuAt] = performance.now() - start;
			this.#cpuAt = (this.#cpuAt + 1) % CPU_WINDOW;
			if (this.#cpuCount < CPU_WINDOW) this.#cpuCount++;
		}
	}

	onStory(state: LifeStoryState) {
		if (this.#disposed) return;
		const corridor = state.completed(1);
		this.fauna.setCompanion(corridor);
		this.flocks.setCorridor(corridor);
		this.flocks.setButterflies(state.progress(4));
		const summit = state.completed(6);
		// The finale's fly-past only when the summit is reached now, not when a finished save loads.
		if (this.#story.known && summit && !this.#story.summit) this.fauna.celebrate();
		this.#story.known = true;
		this.#story.summit = summit;
	}

	setQuality(quality: Quality) {
		this.fauna.setQuality(quality);
		this.particles.setLimit(LIFE_TIERS[quality].particles);
	}

	howl() {
		if (!this.#disposed) this.fauna.chorus();
	}

	debug(): LifeDebug {
		this.#profile = true;
		const fauna = this.fauna;
		let triangles = 0;
		let visible = 0;
		this.pets.forEach((pet, i) => {
			if (!pet) return;
			const sphere = pet.mesh.boundingSphere;
			// Same test as the fauna's frustum pass; animals beyond the fog are culled by the far plane.
			if (sphere && fauna.isVisible(i)) {
				visible++;
				triangles += this.#templates.get(fauna.animals[i].species.id)?.triangles ?? 0;
			}
		});
		const butterflies = this.flocks.active;
		triangles += butterflies * 10 + BIRD_COUNT * 6 + this.particles.live * 2;
		const draws = visible + (butterflies > 0 ? 1 : 0) + 1 + (this.particles.live > 0 ? 1 : 0);
		const companion = fauna.companion >= 0 ? fauna.animals[fauna.companion] : null;
		const onca = fauna.animals.find((a: AnyAnimal) => a.behaviour instanceof OncaBehaviour);
		const n = this.#cpuCount;
		this.#sorted.set(this.#cpu);
		const window = this.#sorted.subarray(0, n).sort();
		let sum = 0;
		for (let i = 0; i < n; i++) sum += window[i];
		return {
			animals: fauna.animals.length,
			animated: fauna.animated,
			cap: fauna.cap,
			near: fauna.near,
			far: fauna.far,
			frozen: fauna.frozen,
			visible: fauna.visible,
			companion: fauna.companionActive,
			companionState: companion?.state ?? '',
			onca: {
				state: onca?.state ?? '',
				distance: fauna.oncaDistance(),
				leaving: onca?.behaviour instanceof OncaBehaviour ? onca.behaviour.leaving : false
			},
			howls: fauna.howls,
			choruses: fauna.choruses,
			particles: {
				live: this.particles.live,
				leaves: this.particles.leaves,
				pollen: this.particles.pollen,
				limit: this.particles.limit,
				peak: this.particles.peak
			},
			butterflies,
			birds: BIRD_COUNT,
			draws,
			triangles,
			cpu: {
				mean: n ? sum / n : 0,
				p95: n ? window[Math.min(n - 1, Math.floor(n * 0.95))] : 0,
				max: n ? window[n - 1] : 0,
				samples: n
			}
		};
	}

	dispose() {
		if (this.#disposed) return;
		this.#disposed = true;
		this.fauna.dispose();
		for (const pet of this.pets) pet?.dispose();
		for (const template of this.#templates.values()) {
			template.geometry.dispose();
			template.material.dispose();
		}
		for (const texture of this.#textures) {
			texture.dispose();
			if (typeof ImageBitmap !== 'undefined' && texture.image instanceof ImageBitmap) texture.image.close();
		}
		this.flocks.dispose();
		this.particles.dispose();
		this.object3d.clear();
		this.object3d.removeFromParent();
	}
}
