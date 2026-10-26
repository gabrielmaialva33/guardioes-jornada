/**
 * The animals at run time: one Animal per plan (game/src/animation/animals),
 * driven every frame under the module's LOD contract (near every frame, far
 * every 3rd frame, offscreen or beyond 60 u frozen, the companion never
 * frozen), plus a hard cap per quality tier on how many animate at once: the
 * nearest visible ones win and the rest freeze in place.
 *
 * Scene rules that live here rather than in the behaviours:
 * - the companion mico (after mission 1) follows the player with the module's
 *   follow behaviour and the ground from the map's heights; when it starts in
 *   the canopy next to the player it climbs down over DESCENT seconds instead of
 *   dropping;
 * - the onça keeps LEVEL.md's 15 u: its behaviour moves off inside its own
 *   personal space (15 studs, 9 u), so it is shown the player scaled toward
 *   itself by that ratio. The direction is unchanged, so it still watches the
 *   player and still always walks away, never toward;
 * - the bugios' howls: every start of a howl and every chorus (a seeded clock
 *   of 45–100 s, or howl()) calls onHowl, for the audio landmark.
 *
 * update() allocates nothing: scratch arrays are sized at construction and
 * numbers travel through object fields (p3-animals.md, V8 rules).
 */
import { type Camera, Matrix4 } from 'three';
import {
	type AnimalWorld,
	type AnyAnimal,
	BugioBehaviour,
	createAnimal,
	createAnimalWorld,
	MicoBehaviour,
	ONCA,
	OncaBehaviour,
	TucanoBehaviour
} from '../animation/animals/index.ts';
import type { Quality } from '../render/quality.ts';
import { GroundSampler } from './ground.ts';
import type { AnimalPlan, LifePlan } from './homes.ts';
import { LifeRng, subSeed } from './rng.ts';
import { DT_MAX, DT_STEPS, DT_TAGGED } from './tagged.ts';

/** Per-tier limits [engine]: animals animated at once, and live leaves + pollen (butterflies come on top, ≤ 15). */
export const LIFE_TIERS: Readonly<Record<Quality, { animated: number; particles: number }>> = {
	low: { animated: 7, particles: 80 },
	medium: { animated: 10, particles: 150 },
	high: { animated: 16, particles: 150 }
};

/** Seconds the companion takes to climb down from the canopy when it joins the player. */
export const DESCENT = 1.4;

/** Seconds between bugio choruses (the north-west's sound landmark). */
const CHORUS = [45, 100] as const;

export interface FaunaBody {
	/** Writes the animal's last update onto its meshes; called only when the animal updated. */
	place(animal: AnyAnimal): void;
}

/** The blob-shadow API the scene's ShadowRig.blobs offers (structural, so tests need no renderer). */
export interface LifeBlobs {
	add(kind: 'actor' | 'item'): number;
	set(id: number, x: number, groundY: number, z: number, radius: number, height?: number): void;
	hide(id: number): void;
	remove(id: number): void;
}

/** What onHowl receives (one reused object: copy what you keep). */
export class HowlEvent {
	x = 0;
	y = 0;
	z = 0;
	/** Index of the bugio among the animals, or -1 for a chorus (all of them, at their centre). */
	index = -1;
	chorus = false;
}

/** The numbers update() reads, refilled by the living world each frame. */
export class FaunaFrame {
	dt = 0;
	playerX = 0;
	playerY = 0;
	playerZ = 0;
	playerVx = Number.NaN;
	playerVz = Number.NaN;
	playerGrounded = true;
	playerJumped = false;
	reducedMotion = false;
	camera: Camera | null = null;
}

export function createPlannedAnimal(plan: AnimalPlan, slot: number): AnyAnimal {
	// x, y, z: the mico starts at its route's first point (it places only x and z until its first update).
	const route = plan.route;
	return createAnimal(plan.species, {
		seed: plan.seed,
		x: route?.[0],
		y: route?.[1],
		z: route?.[2],
		route: route ?? undefined,
		loop: plan.loop,
		perches: plan.perches ?? undefined,
		start: plan.start,
		lod: { slot }
	});
}

export class Fauna {
	readonly plan: LifePlan;
	readonly animals: AnyAnimal[];
	readonly bodies: (FaunaBody | null)[];
	readonly world: AnimalWorld = createAnimalWorld();
	readonly frame = new FaunaFrame();
	readonly howl = new HowlEvent();
	/** Called on every howl start and every chorus. */
	onHowl: ((event: HowlEvent) => void) | null = null;
	/** Most animals animated in one frame. */
	cap: number;
	/** Index of the companion mico, -1 when the map has none. */
	readonly companion: number;
	companionActive = false;
	// --- stats of the last update (debug) ---
	animated = 0;
	near = 0;
	far = 0;
	frozen = 0;
	visible = 0;
	updated = 0;
	howls = 0;
	choruses = 0;
	// --- scratch ---
	readonly #distance: Float64Array;
	readonly #order: Int32Array;
	readonly #visible: Uint8Array;
	readonly #permitted: Uint8Array;
	readonly #howling: Uint8Array;
	/** Visibility sphere radius per animal, u (generous: hangs, swings and flights stay inside). */
	readonly #radius: Float64Array;
	/** The camera's six frustum planes, packed nx, ny, nz, d (three's Frustum math, written out). */
	readonly #planes = new Float64Array(24);
	readonly #matrix = new Matrix4();
	readonly #ground: GroundSampler;
	readonly #blobIds: Int32Array;
	readonly #blobRadius: Float64Array;
	#blobs: LifeBlobs | null = null;
	readonly #rng: LifeRng;
	readonly #oncaShrink: number;
	readonly #bugios: number[];
	#companionWanted = false;
	#descent = -1;
	#descentFrom = 0;
	#chorus: number;

	constructor(plan: LifePlan, heights: Float32Array, quality: Quality = 'low') {
		this.plan = plan;
		this.animals = plan.animals.map((p, i) => createPlannedAnimal(p, i));
		this.bodies = this.animals.map(() => null);
		const n = this.animals.length;
		this.cap = LIFE_TIERS[quality].animated;
		this.companion = plan.companion;
		this.#distance = new Float64Array(n);
		this.#order = new Int32Array(n);
		this.#visible = new Uint8Array(n);
		this.#permitted = new Uint8Array(n);
		this.#howling = new Uint8Array(n);
		this.#blobIds = new Int32Array(n).fill(-1);
		this.#blobRadius = new Float64Array(n);
		this.#radius = Float64Array.from(this.animals, (a) => a.species.size * 2 + 0.5);
		this.#ground = new GroundSampler(heights, plan.size);
		this.#rng = new LifeRng(subSeed(plan.seed, 0xb06));
		this.#oncaShrink = ONCA.avoidRadius / Math.max(1e-3, plan.oncaAvoidRadius);
		this.#bugios = this.animals.flatMap((a, i) => (a.behaviour instanceof BugioBehaviour ? [i] : []));
		this.#chorus = this.#rng.range(CHORUS[0] * 0.3, CHORUS[1] * 0.3);
	}

	setQuality(quality: Quality) {
		this.cap = LIFE_TIERS[quality].animated;
	}

	/** The mission-1 state: true makes the planned mico the player's companion (applied on the next update). */
	setCompanion(on: boolean) {
		this.#companionWanted = on && this.companion >= 0;
	}

	/** Attaches blob shadows for the animals that walk on the ground (the onça, the companion). */
	attachBlobs(blobs: LifeBlobs | null) {
		this.detachBlobs();
		this.#blobs = blobs;
		if (!blobs) return;
		for (let i = 0; i < this.animals.length; i++) {
			if (this.plan.animals[i].arboreal && i !== this.companion) continue;
			this.#blobIds[i] = blobs.add('actor');
			this.#blobRadius[i] = this.animals[i].species.size * 0.42;
			blobs.hide(this.#blobIds[i]);
		}
	}

	detachBlobs() {
		const blobs = this.#blobs;
		if (blobs)
			for (let i = 0; i < this.#blobIds.length; i++)
				if (this.#blobIds[i] >= 0) blobs.remove(this.#blobIds[i]);
		this.#blobIds.fill(-1);
		this.#blobs = null;
	}

	/** A chorus now: every bugio howls (dawn, a mission beat). */
	chorus() {
		const bugios = this.#bugios;
		if (bugios.length === 0) return;
		const event = this.howl;
		event.x = event.y = event.z = 0;
		for (let k = 0; k < bugios.length; k++) {
			const i = bugios[k];
			const behaviour = this.animals[i].behaviour as BugioBehaviour;
			behaviour.howl(this.#rng.range(5, 9));
			this.#howling[i] = behaviour.state === 'howl' ? 1 : 0;
			event.x += behaviour.motion.x / bugios.length;
			event.y += behaviour.motion.y / bugios.length;
			event.z += behaviour.motion.z / bugios.length;
		}
		event.index = -1;
		event.chorus = true;
		this.choruses++;
		this.onHowl?.(event);
	}

	/**
	 * The mission 6 finale: every toucan flies across to the other tree (the plan lists two perches
	 * per araucária, so half the list away is the other tree).
	 */
	celebrate() {
		for (const animal of this.animals) {
			const behaviour = animal.behaviour;
			if (behaviour instanceof TucanoBehaviour && behaviour.perchCount > 1)
				behaviour.flyTo(
					(behaviour.perch + Math.max(1, Math.floor(behaviour.perchCount / 2))) % behaviour.perchCount
				);
		}
	}

	/** True when animal i was inside the camera frustum in the last update. */
	isVisible(i: number): boolean {
		return this.#visible[i] === 1;
	}

	/** Puts every animal's current pose on its body (after binding, before the first frame). */
	placeAll() {
		for (let i = 0; i < this.animals.length; i++) this.bodies[i]?.place(this.animals[i]);
	}

	/** One frame. Reads this.frame. Allocates nothing. */
	update() {
		const frame = this.frame;
		const dt = frame.dt > 0 ? Math.min(frame.dt, DT_MAX) : 0;
		// Number arguments: a tagged frame time and whole-unit distances (Smis), so nothing is boxed.
		const dtTagged = DT_TAGGED[Math.round(dt * DT_STEPS)];
		const animals = this.animals;
		const n = animals.length;
		const world = this.world;
		world.playerX = frame.playerX;
		world.playerY = frame.playerY;
		world.playerZ = frame.playerZ;
		world.playerVx = frame.playerVx;
		world.playerVz = frame.playerVz;
		world.playerGrounded = frame.playerGrounded;
		world.playerJumped = frame.playerJumped;
		world.reducedMotion = frame.reducedMotion;
		world.groundY = Number.NaN;

		this.#applyCompanion();

		// Camera position and frustum.
		const camera = frame.camera;
		let cx = frame.playerX;
		let cy = frame.playerY + 6;
		let cz = frame.playerZ;
		const planes = this.#planes;
		if (camera) {
			camera.updateMatrixWorld();
			const e = camera.matrixWorld.elements;
			cx = e[12];
			cy = e[13];
			cz = e[14];
			// Frustum.setFromProjectionMatrix (WebGL clip space) without its calls: three's
			// setComponents/normalize take numbers, and V8 boxed 24 of them per frame (measured).
			const m = this.#matrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse).elements;
			for (let k = 0; k < 6; k++) {
				// Rows: k = 0, 1 → x (−, +); 2, 3 → y (+, −); 4, 5 → z (−, +).
				const row = k < 2 ? 0 : k < 4 ? 1 : 2;
				const sign = k === 1 || k === 2 || k === 5 ? 1 : -1;
				const a = m[3] + sign * m[row];
				const b = m[7] + sign * m[row + 4];
				const c = m[11] + sign * m[row + 8];
				const d = m[15] + sign * m[row + 12];
				const inverse = 1 / Math.sqrt(a * a + b * b + c * c);
				planes[k * 4] = a * inverse;
				planes[k * 4 + 1] = b * inverse;
				planes[k * 4 + 2] = c * inverse;
				planes[k * 4 + 3] = d * inverse;
			}
		}

		// Distances, visibility and the candidates for the cap, nearest first (the companion first of all).
		const distance = this.#distance;
		const visible = this.#visible;
		const order = this.#order;
		let candidates = 0;
		let seen = 0;
		for (let i = 0; i < n; i++) {
			const motion = animals[i].motion;
			const dx = motion.x - cx;
			const dy = motion.y - cy;
			const dz = motion.z - cz;
			distance[i] = Math.sqrt(dx * dx + dy * dy + dz * dz);
			// Frustum.intersectsSphere, written out.
			let inView = true;
			if (camera) {
				const sy = motion.y + animals[i].species.size * 0.5;
				const r = this.#radius[i];
				for (let k = 0; k < 24; k += 4)
					if (planes[k] * motion.x + planes[k + 1] * sy + planes[k + 2] * motion.z + planes[k + 3] < -r) {
						inView = false;
						break;
					}
			}
			visible[i] = inView ? 1 : 0;
			if (inView) seen++;
			const companion = i === this.companion && this.companionActive;
			if (!companion && !(inView && distance[i] <= animals[i].lod.cullDistance)) continue;
			// Insertion by key: the companion sorts before everything.
			const key = companion ? -1 : distance[i];
			let k = candidates++;
			while (k > 0) {
				const other = order[k - 1];
				const otherKey = other === this.companion && this.companionActive ? -1 : distance[other];
				if (otherKey <= key) break;
				order[k] = other;
				k--;
			}
			order[k] = i;
		}
		this.visible = seen;

		// The first `cap` candidates may animate this frame.
		const permitted = this.#permitted;
		permitted.fill(0);
		const limit = Math.min(candidates, this.cap);
		for (let k = 0; k < limit; k++) permitted[order[k]] = 1;

		let animated = 0;
		let near = 0;
		let far = 0;
		let updated = 0;
		const companion = this.companion;
		const ground = this.#ground;
		for (let i = 0; i < n; i++) {
			const animal = animals[i];
			const motion = animal.motion;
			const isCompanion = i === companion && this.companionActive;
			if (isCompanion) {
				ground.x = motion.x;
				ground.z = motion.z;
				ground.sample();
				let groundY = ground.y;
				if (this.#descent >= 0) {
					this.#descent += dt / DESCENT;
					if (this.#descent >= 1) this.#descent = -1;
					else {
						const t = this.#descent;
						const ease = t * t * (3 - 2 * t);
						groundY = ground.y + (this.#descentFrom - ground.y) * (1 - ease);
					}
				}
				world.groundY = groundY;
			}
			const behaviour = animal.behaviour;
			const onca = behaviour instanceof OncaBehaviour;
			if (onca) {
				// Personal space of LEVEL.md: show the player nearer by the behaviour's radius ratio.
				world.playerX = motion.x + (frame.playerX - motion.x) * this.#oncaShrink;
				world.playerZ = motion.z + (frame.playerZ - motion.z) * this.#oncaShrink;
			}
			const changed = animal.frame(
				dtTagged,
				world,
				Math.ceil(distance[i]),
				visible[i] === 1 && permitted[i] === 1
			);
			if (onca) {
				world.playerX = frame.playerX;
				world.playerZ = frame.playerZ;
			}
			world.groundY = Number.NaN;
			const tier = animal.lod.tier;
			if (tier === 'near') near++;
			else if (tier === 'far') far++;
			if (tier !== 'frozen') animated++;
			if (changed) {
				updated++;
				this.bodies[i]?.place(animal);
				const blob = this.#blobIds[i];
				if (blob >= 0 && this.#blobs) {
					if (this.plan.animals[i].arboreal && !isCompanion) this.#blobs.hide(blob);
					else {
						ground.x = motion.x;
						ground.z = motion.z;
						ground.sample();
						this.#blobs.set(blob, motion.x, ground.y, motion.z, this.#blobRadius[i], motion.y - ground.y);
					}
				}
			}
			if (behaviour instanceof BugioBehaviour) {
				const howling = behaviour.state === 'howl' ? 1 : 0;
				if (howling === 1 && this.#howling[i] === 0) {
					const event = this.howl;
					event.x = motion.x;
					event.y = motion.y;
					event.z = motion.z;
					event.index = i;
					event.chorus = false;
					this.howls++;
					this.onHowl?.(event);
				}
				this.#howling[i] = howling;
			}
		}
		this.animated = animated;
		this.near = near;
		this.far = far;
		this.frozen = n - animated;
		this.updated = updated;

		// The chorus clock runs whatever the LOD: the howl is heard across the map.
		this.#chorus -= dt;
		if (this.#chorus <= 0) {
			this.#chorus = this.#rng.range(CHORUS[0], CHORUS[1]);
			this.chorus();
		}
	}

	#applyCompanion() {
		const wanted = this.#companionWanted;
		if (wanted === this.companionActive || this.companion < 0) return;
		const animal = this.animals[this.companion];
		const mico = animal.behaviour as MicoBehaviour;
		if (!(mico instanceof MicoBehaviour)) return;
		this.companionActive = wanted;
		animal.lod.keepAlive = wanted;
		if (!wanted) {
			this.#descent = -1;
			mico.setCompanion(false);
			const blob = this.#blobIds[this.companion];
			if (blob >= 0) this.#blobs?.hide(blob);
			return;
		}
		const motion = mico.motion;
		const frame = this.frame;
		const dx = motion.x - frame.playerX;
		const dz = motion.z - frame.playerZ;
		this.#ground.x = motion.x;
		this.#ground.z = motion.z;
		this.#ground.sample();
		// Near the player it climbs down; far away the behaviour teleports it behind the player.
		const close = dx * dx + dz * dz < 28 * 28;
		this.#descent = close && motion.y > this.#ground.y + 0.3 ? 0 : -1;
		this.#descentFrom = motion.y;
		mico.setCompanion(true);
		animal.lod.reset();
	}

	/** Planar distance from the onça to the player in its last update, u (debug, tests). */
	oncaDistance(): number {
		for (const animal of this.animals) {
			if (animal.behaviour instanceof OncaBehaviour) {
				const m = animal.motion;
				return Math.hypot(m.x - this.frame.playerX, m.z - this.frame.playerZ);
			}
		}
		return Number.NaN;
	}

	dispose() {
		this.detachBlobs();
		this.onHowl = null;
		this.bodies.fill(null);
		this.frame.camera = null;
	}
}
