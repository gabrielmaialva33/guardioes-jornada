/**
 * One animal: its behaviour (state machine and world motion), its animator
 * (pose) and its LOD. Pure TypeScript; the three.js side is in bind.ts.
 *
 *   const animal = createAnimal('mico-leao-dourado', { companion: true, seed: 7 });
 *   // every frame:
 *   if (animal.frame(delta, world, cameraDistance, visible)) placeAnimal(animal, group, rig);
 */
import type { Pose } from '../skeleton.ts';
import { AnimalAnimator } from './animal-animator.ts';
import type { Behaviour } from './behaviour.ts';
import { BugioBehaviour } from './bugio.ts';
import { AnimationLod, type LodOptions } from './lod.ts';
import { MicoBehaviour } from './mico.ts';
import type { AnimalMotion, AnimalWorld } from './motion.ts';
import { MuriquiBehaviour } from './muriqui.ts';
import { OncaBehaviour } from './onca.ts';
import { PreguicaBehaviour } from './preguica.ts';
import { Route } from './route.ts';
import type { SpeciesId, SpeciesParams } from './species.ts';
import { type Perch, TucanoBehaviour } from './tucano.ts';

export class Animal<B extends Behaviour = Behaviour> {
	readonly behaviour: B;
	readonly animator: AnimalAnimator;
	readonly lod: AnimationLod;

	constructor(behaviour: B, options: { hasHead?: boolean; lod?: LodOptions } = {}) {
		this.behaviour = behaviour;
		this.animator = new AnimalAnimator(behaviour.species, { hasHead: options.hasHead });
		this.lod = new AnimationLod(options.lod);
		this.animator.update(0, behaviour.motion);
	}

	get species(): SpeciesParams {
		return this.behaviour.species;
	}

	/** Placement (x, y, z, yaw) and the motion channels of the last update. */
	get motion(): AnimalMotion {
		return this.behaviour.motion;
	}

	get pose(): Pose {
		return this.animator.pose;
	}

	get state(): string {
		return this.behaviour.state;
	}

	/** Updates behaviour and pose by `dt` seconds, ignoring the LOD. */
	update(dt: number, world: AnimalWorld): Pose {
		this.behaviour.step(dt, world);
		this.animator.reducedMotion = world.reducedMotion;
		return this.animator.update(dt, this.behaviour.motion);
	}

	/**
	 * The per-frame entry with LOD: returns true when the animal updated and the
	 * scene should apply its pose and placement. Player jumps are latched for
	 * frames the LOD skips.
	 */
	frame(frameDt: number, world: AnimalWorld, cameraDistance: number, visible: boolean): boolean {
		const behaviour = this.behaviour;
		if (world.playerJumped && behaviour instanceof MicoBehaviour) behaviour.notifyPlayerJump();
		const lod = this.lod;
		if (!lod.tick(frameDt, cameraDistance, visible)) return false;
		behaviour.stepFrom(lod, world);
		this.animator.reducedMotion = world.reducedMotion;
		this.animator.updateFrom(lod, behaviour.motion);
		return true;
	}

	/** Settles the pose and drops pending LOD time (after a teleport or respawn). */
	reset() {
		this.behaviour.reset();
		this.animator.reset();
		this.lod.reset();
	}
}

export interface AnimalOptions {
	seed?: number;
	/** Set from bindAnimal's result when the model has its own head node. */
	hasHead?: boolean;
	lod?: LodOptions;
	/**
	 * Where it lives, in world points: the trail (onça), the branch top (bugio,
	 * mico), the branch underside (preguiça) or the handholds (muriqui).
	 */
	route?: Route | readonly number[];
	/** Closed trail (onça). */
	loop?: boolean;
	/** Toucan perches. */
	perches?: readonly Perch[];
	/** Mico: start as the player's companion. */
	companion?: boolean;
	/** Start arc length, handhold or perch index. */
	start?: number;
	/** Mico without a route: start position. */
	x?: number;
	y?: number;
	z?: number;
}

const routeOf = (options: AnimalOptions, species: SpeciesId): Route => {
	const route = options.route;
	if (route instanceof Route) return route;
	if (route && route.length >= 3) return new Route(route, options.loop ?? false);
	throw new Error(`${species} needs a route`);
};

export type AnyAnimal = Animal<
	MicoBehaviour | MuriquiBehaviour | BugioBehaviour | OncaBehaviour | PreguicaBehaviour | TucanoBehaviour
>;

/** Builds one animal of a species with its behaviour. Load time only (allocates). */
export function createAnimal(species: 'mico-leao-dourado', options?: AnimalOptions): Animal<MicoBehaviour>;
export function createAnimal(species: 'muriqui', options: AnimalOptions): Animal<MuriquiBehaviour>;
export function createAnimal(species: 'bugio-ruivo', options: AnimalOptions): Animal<BugioBehaviour>;
export function createAnimal(species: 'onca-pintada', options: AnimalOptions): Animal<OncaBehaviour>;
export function createAnimal(
	species: 'preguica-de-coleira',
	options: AnimalOptions
): Animal<PreguicaBehaviour>;
export function createAnimal(
	species: 'tucano-de-bico-verde',
	options: AnimalOptions
): Animal<TucanoBehaviour>;
export function createAnimal(species: SpeciesId, options?: AnimalOptions): AnyAnimal;
export function createAnimal(species: SpeciesId, options: AnimalOptions = {}): AnyAnimal {
	const base = { seed: options.seed };
	const wrap = { hasHead: options.hasHead, lod: options.lod };
	switch (species) {
		case 'mico-leao-dourado': {
			const route = options.route ? routeOf(options, species) : null;
			const mico = new MicoBehaviour({
				...base,
				route,
				companion: options.companion,
				x: options.x,
				y: options.y,
				z: options.z
			});
			return new Animal(mico, { ...wrap, lod: { keepAlive: options.companion, ...options.lod } });
		}
		case 'muriqui':
			return new Animal(
				new MuriquiBehaviour({ ...base, anchors: routeOf(options, species), start: options.start }),
				wrap
			);
		case 'bugio-ruivo':
			return new Animal(
				new BugioBehaviour({ ...base, branch: routeOf(options, species), start: options.start }),
				wrap
			);
		case 'onca-pintada':
			return new Animal(
				new OncaBehaviour({ ...base, route: routeOf(options, species), start: options.start }),
				wrap
			);
		case 'preguica-de-coleira':
			return new Animal(
				new PreguicaBehaviour({ ...base, branch: routeOf(options, species), start: options.start }),
				wrap
			);
		case 'tucano-de-bico-verde':
			if (!options.perches || options.perches.length === 0)
				throw new Error('tucano-de-bico-verde needs perches');
			return new Animal(
				new TucanoBehaviour({ ...base, perches: options.perches, start: options.start }),
				wrap
			);
	}
}
