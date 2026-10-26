/**
 * The two flocks, one draw each (the fauna module's Flock boids and FlockMesh
 * wing-flap shader):
 * - butterflies over the clareira (LEVEL.md §10), more of them for every
 *   seedling planted in mission 4: the flock simulates its maximum all along and
 *   draws only the first `active`, so a new butterfly is already flying when it
 *   appears;
 * - a small mixed flock of saíras over the micos' fragment; once the corridor of
 *   mission 1 is planted, their box stretches across it.
 *
 * Both drift downwind with the shared wind field. With reduced motion they hold
 * still (wingbeats stop with the flock's clock): ART.md §8 counts butterflies
 * among the decorative effects.
 */
import { Flock, FlockMesh } from '../animation/animals/index.ts';
import type { Box, LifePlan } from './homes.ts';
import { subSeed } from './rng.ts';
import { DT_MAX, DT_STEPS, DT_TAGGED } from './tagged.ts';
import { FloatUniform, WIND, WindSample } from './wind.ts';

/** Butterflies [design]: a few at first, two more per seedling, at most BUTTERFLY_MAX (ART.md §8 counts them). */
export const BUTTERFLY_BASE = 3;
export const BUTTERFLY_PER_SEEDLING = 2;
export const BUTTERFLY_MAX = 15;
export const BIRD_COUNT = 7;
/** FlockMesh scale of a butterfly (its geometry spans about 0.72 across the wings). */
export const BUTTERFLY_SCALE = 0.7;

/** Share of the wind speed the flyers drift with, u/s per u/s. */
const DRIFT = { butterfly: 0.3, bird: 0.15 } as const;

export class FlockFrame {
	dt = 0;
	time = 0;
	reducedMotion = false;
}

export class LifeFlocks {
	readonly butterflies: Flock;
	readonly butterflyMesh: FlockMesh;
	readonly birds: Flock;
	readonly birdMesh: FlockMesh;
	readonly frame = new FlockFrame();
	/** Butterflies drawn now. */
	active = BUTTERFLY_BASE;
	readonly #wind = new WindSample();
	readonly #birdBounds: Box;
	readonly #birdAfter: Box;
	#corridor = false;
	/** Drift of this update, u per u/s of wind (a field: no number arguments on the hot path). */
	#share = 0;

	constructor(plan: LifePlan) {
		this.butterflies = new Flock({
			kind: 'butterfly',
			count: BUTTERFLY_MAX,
			bounds: plan.butterflies.bounds,
			seed: subSeed(plan.seed, 0xb7)
		});
		// ×1.5 like every animal (ART.md §3): a Morpho's 15 cm becomes about 0.5 u across the wings.
		this.butterflyMesh = new FlockMesh(this.butterflies, { scale: BUTTERFLY_SCALE });
		this.butterflyMesh.mesh.name = 'life-butterflies';
		// The wing clock as a FloatUniform (before the first compile, which reads these objects): FlockMesh
		// writes it every frame, and a plain { value } uniform boxed a new number on each write (measured).
		this.butterflyMesh.uniforms.uFlapTime = new FloatUniform(0);
		this.birds = new Flock({
			kind: 'bird',
			count: BIRD_COUNT,
			bounds: plan.birds.bounds,
			seed: subSeed(plan.seed, 0xb1)
		});
		this.birdMesh = new FlockMesh(this.birds);
		this.birdMesh.mesh.name = 'life-birds';
		this.birdMesh.uniforms.uFlapTime = new FloatUniform(0);
		this.#birdBounds = plan.birds.bounds;
		this.#birdAfter = plan.birds.after;
		this.setButterflies(0);
	}

	/** Seedlings planted in the clareira (0–6). */
	setButterflies(planted: number) {
		const count = BUTTERFLY_BASE + BUTTERFLY_PER_SEEDLING * Math.max(0, Math.floor(planted));
		this.active = Math.min(BUTTERFLY_MAX, count);
		this.butterflyMesh.mesh.count = this.active;
	}

	/** Mission 1 done: the birds' box spans the planted corridor. */
	setCorridor(open: boolean) {
		if (open === this.#corridor) return;
		this.#corridor = open;
		this.birds.setBounds(open ? this.#birdAfter : this.#birdBounds);
		// Widening the box makes the birds' bounding sphere stale.
		const b = open ? this.#birdAfter : this.#birdBounds;
		const sphere = this.birdMesh.mesh.boundingSphere;
		if (sphere) {
			sphere.center.set((b[0] + b[3]) / 2, (b[1] + b[4]) / 2, (b[2] + b[5]) / 2);
			sphere.radius = Math.hypot(b[3] - b[0], b[4] - b[1], b[5] - b[2]) / 2 + 1;
		}
	}

	/** One frame. Reads this.frame. Allocates nothing. */
	update() {
		const frame = this.frame;
		if (frame.reducedMotion) return;
		const dt = frame.dt > 0 ? Math.min(frame.dt, DT_MAX) : 0;
		const dtTagged = DT_TAGGED[Math.round(dt * DT_STEPS)];
		this.butterflies.update(dtTagged);
		this.#share = DRIFT.butterfly * dt;
		this.#drift(this.butterflies);
		this.butterflyMesh.update(this.butterflies);
		this.birds.update(dtTagged);
		this.#share = DRIFT.bird * dt;
		this.#drift(this.birds);
		this.birdMesh.update(this.birds);
	}

	/** Pushes every flyer downwind; the flock's soft walls push back, so they lean with the wind. */
	#drift(flock: Flock) {
		const b = flock.bounds;
		const wind = this.#wind;
		wind.atX = (b[0] + b[3]) / 2;
		wind.atZ = (b[2] + b[5]) / 2;
		wind.time = this.frame.time;
		wind.strength = 1;
		wind.read();
		const dx = wind.x * WIND.speed * this.#share;
		const dz = wind.z * WIND.speed * this.#share;
		const p = flock.position;
		for (let i = 0; i < flock.count; i++) {
			const at = i * 3;
			const x = p[at] + dx;
			const z = p[at + 2] + dz;
			p[at] = x < b[0] ? b[0] : Math.min(x, b[3]);
			p[at + 2] = z < b[2] ? b[2] : Math.min(z, b[5]);
		}
	}

	dispose() {
		this.butterflyMesh.mesh.removeFromParent();
		this.birdMesh.mesh.removeFromParent();
		this.butterflyMesh.dispose();
		this.birdMesh.dispose();
	}
}
