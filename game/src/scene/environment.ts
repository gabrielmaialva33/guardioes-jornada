import type { Group } from 'three';
import type { Checkpoint } from '../engine/checkpoints.ts';
import type { CollisionWorld } from '../engine/world.ts';
import type { BlockGrid, PoolSet, Quality } from '../render/index.ts';

export interface SceneVisual {
	object: Group;
	update?: (x: number, y: number, z: number, target: { x: number; z: number }) => void;
	dispose(): void;
}
export interface SceneEnvironment {
	kind: 'graybox' | 'map';
	start: Checkpoint;
	checkpoints: readonly Checkpoint[];
	collision: CollisionWorld;
	grid: BlockGrid;
	placements: number;
	createVisual(): SceneVisual;
	loadPlacements(
		quality: Quality,
		signal: AbortSignal
	): Promise<{ pools: PoolSet; setQuality?: (quality: Quality) => void; dispose(): void }>;
	target: { x: number; z: number; name: string };
	nextTarget(): void;
}
