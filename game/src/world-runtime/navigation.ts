import type { Vec3 } from '../engine/character.ts';
import { type Checkpoint, type CheckpointEvent, CheckpointTracker } from '../engine/checkpoints.ts';
import type { Pool } from '../level/types.ts';
import type { SurvivalWorld } from '../survival/types.ts';

export function riverSurfaceAt(world: SurvivalWorld, x: number, z: number, pool?: Pool): number | null {
	if (pool) {
		const dx = x - pool.x,
			dz = z - pool.z;
		const along = dx * pool.axisX + dz * pool.axisZ,
			across = -dx * pool.axisZ + dz * pool.axisX;
		if ((along / pool.halfLength) ** 2 + (across / pool.halfWidth) ** 2 <= 1) return pool.water;
	}
	let distance = Infinity,
		water: number | null = null;
	for (let i = 1; i < world.river.points.length; i++) {
		const a = world.river.points[i - 1],
			b = world.river.points[i],
			dx = b.x - a.x,
			dz = b.z - a.z;
		const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz || 1)));
		const d = Math.hypot(x - a.x - t * dx, z - a.z - t * dz);
		if (d < distance && d <= world.river.halfWidth) {
			distance = d;
			water = a.water + (b.water - a.water) * t;
		}
	}
	if (
		water === null &&
		x >= 0 &&
		z >= 0 &&
		x <= world.size &&
		z <= world.size &&
		world.zones[Math.round(z) * world.grid + Math.round(x)] === 0
	)
		return world.waterLevel;
	return water;
}
/** Extends the fixed-tick checkpoint path rather than checking only interpolated render poses. */
export class MapCheckpoints extends CheckpointTracker {
	constructor(
		readonly map: SurvivalWorld,
		start: Checkpoint,
		checkpoints: readonly Checkpoint[],
		killY: number,
		readonly pool?: Pool,
		readonly onCheckpoint?: (checkpoint: Checkpoint) => void
	) {
		super(start, checkpoints, killY);
	}
	override reset() {
		super.reset();
		this.onCheckpoint?.(this.start);
	}
	override update(dt: number, feet: Vec3): CheckpointEvent | null {
		const water = riverSurfaceAt(this.map, feet.x, feet.z, this.pool);
		const event = super.update(
			dt,
			water !== null && feet.y < water - 0.65 ? { x: feet.x, y: this.killY - 1, z: feet.z } : feet
		);
		if (event?.type === 'checkpoint') this.onCheckpoint?.(event.checkpoint);
		return event;
	}
}
