/**
 * Checkpoints and the kill plane. Touching a checkpoint's volume makes it the
 * respawn point; falling below the kill plane (water, the obby void) respawns
 * there after RESPAWN_DELAY, without touching any other progress.
 */
import type { Vec3 } from './character.ts';
import { RESPAWN_DELAY } from './constants.ts';

export interface Checkpoint {
	id: string;
	/** Axis-aligned trigger volume the feet must enter. */
	min: Vec3;
	max: Vec3;
	/** Where the character reappears, and the yaw it faces. */
	spawn: Vec3;
	yaw: number;
}

export type CheckpointEvent =
	| { type: 'checkpoint'; checkpoint: Checkpoint }
	| { type: 'fell' }
	| { type: 'respawn'; checkpoint: Checkpoint };

export class CheckpointTracker {
	readonly start: Checkpoint;
	readonly checkpoints: readonly Checkpoint[];
	readonly killY: number;
	readonly delay: number;
	/** The respawn point: the start or the last checkpoint touched. */
	current: Checkpoint;
	#respawnIn = -1;

	constructor(start: Checkpoint, checkpoints: readonly Checkpoint[], killY: number, delay = RESPAWN_DELAY) {
		this.start = start;
		this.checkpoints = checkpoints;
		this.killY = killY;
		this.delay = delay;
		this.current = start;
	}

	/** True between falling out and respawning (the scene may fade out meanwhile). */
	get respawning(): boolean {
		return this.#respawnIn >= 0;
	}

	/** Call once per fixed tick with the feet position. */
	update(dt: number, feet: Vec3): CheckpointEvent | null {
		if (this.#respawnIn >= 0) {
			this.#respawnIn -= dt;
			if (this.#respawnIn > 1e-6) return null;
			this.#respawnIn = -1;
			return { type: 'respawn', checkpoint: this.current };
		}
		if (feet.y < this.killY) {
			this.#respawnIn = this.delay;
			return { type: 'fell' };
		}
		for (const checkpoint of this.checkpoints) {
			if (checkpoint !== this.current && inside(feet, checkpoint)) {
				this.current = checkpoint;
				return { type: 'checkpoint', checkpoint };
			}
		}
		return null;
	}

	/** Back to the start (new run); a pending respawn is cancelled. */
	reset() {
		this.current = this.start;
		this.#respawnIn = -1;
	}
}

function inside(point: Vec3, { min, max }: Checkpoint): boolean {
	return (
		point.x >= min.x &&
		point.x <= max.x &&
		point.y >= min.y &&
		point.y <= max.y &&
		point.z >= min.z &&
		point.z <= max.z
	);
}
