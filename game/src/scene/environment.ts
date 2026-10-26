import type { Group, PerspectiveCamera } from 'three';
import type { Checkpoint } from '../engine/checkpoints.ts';
import type { CollisionWorld } from '../engine/world.ts';
import type { StoryGame } from '../missions/story.ts';
import type { BlockGrid, PoolSet, Quality } from '../render/index.ts';

export interface SceneVisual {
	object: Group;
	update?: (x: number, y: number, z: number, target: { x: number; z: number }) => void;
	setBackgroundVisible?: (visible: boolean) => void;
	prepareFrame?: (camera: PerspectiveCamera, time: number, quality: Quality, night: boolean) => void;
	dispose(): void;
}
export interface SceneEnvironment {
	kind: 'graybox' | 'map';
	story?: StoryGame;
	loadStoryAssets?: (
		signal: AbortSignal
	) => Promise<{ object: Group; update: (dt: number) => void; sync: () => void; dispose: () => void }>;
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
