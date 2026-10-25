/**
 * Animation LOD for animals (animacoes.md §8, rule 6):
 * - near the camera: an update every frame;
 * - far: an update every `farInterval` frames with the skipped time accumulated,
 *   so the animal covers the same ground and ends in the same pose;
 * - offscreen or beyond `cullDistance`: frozen. No time accumulates, and when
 *   it shows again it resumes from where it stopped. A companion sets
 *   `keepAlive` and is never frozen (it keeps following at the far rate).
 *
 * Everything downstream integrates exactly for any dt up to MAX_DT (substepped
 * behaviours, the fixed-step pendulum, exact springs, distance-driven gaits), so
 * changing the rate changes the cost, not the result (a test checks this).
 * Far animals update on different frames: each takes a stagger slot.
 */
import { MAX_DT, safeDt } from './scalar.ts';

export type LodTier = 'near' | 'far' | 'frozen';

export interface LodOptions {
	/** Full rate up to this camera distance, u. */
	nearDistance?: number;
	/** Frozen beyond this distance, u. */
	cullDistance?: number;
	/** Frames between updates when far. */
	farInterval?: number;
	/** Never freeze (the companion). */
	keepAlive?: boolean;
	/** Stagger slot, so far animals spread over frames (any integer; e.g. the animal's index). */
	slot?: number;
}

/** Defaults [engine]: 12 u ≈ 20 studs, a third of the 24 u camera reach beyond it. */
export const LOD_DEFAULTS = { nearDistance: 12, cullDistance: 60, farInterval: 3 } as const;

export class AnimationLod {
	nearDistance: number;
	cullDistance: number;
	farInterval: number;
	keepAlive: boolean;
	tier: LodTier = 'near';
	/** The dt to pass to this frame's update when tick() returned true. */
	dt = 0;
	/** Time accumulated since the last update, seconds. */
	pending = 0;
	#frame = 0;

	constructor(options: LodOptions = {}) {
		this.nearDistance = options.nearDistance ?? LOD_DEFAULTS.nearDistance;
		this.cullDistance = options.cullDistance ?? LOD_DEFAULTS.cullDistance;
		this.farInterval = Math.max(1, Math.floor(options.farInterval ?? LOD_DEFAULTS.farInterval));
		this.keepAlive = options.keepAlive ?? false;
		this.#frame = Math.abs(Math.floor(options.slot ?? 0));
	}

	/**
	 * Call once per rendered frame. Returns true when the animal should update
	 * this frame, with `this.dt` as its time step.
	 */
	tick(frameDt: number, distance: number, visible: boolean): boolean {
		const dt = safeDt(frameDt);
		this.#frame++;
		const hidden = !visible || !(distance <= this.cullDistance);
		if (hidden && !this.keepAlive) {
			this.tier = 'frozen';
			this.pending = 0;
			this.dt = 0;
			return false;
		}
		this.pending += dt;
		const near = !hidden && distance <= this.nearDistance;
		this.tier = near ? 'near' : 'far';
		if (!near && this.#frame % this.farInterval !== 0) {
			this.dt = 0;
			return false;
		}
		this.dt = Math.min(this.pending, MAX_DT);
		this.pending = 0;
		return true;
	}

	/** Drops accumulated time (after a teleport or a respawn). */
	reset() {
		this.pending = 0;
		this.dt = 0;
		this.tier = 'near';
	}
}
