import type { Group, PerspectiveCamera, Texture } from 'three';
import type { Checkpoint } from '../engine/checkpoints.ts';
import type { CollisionQuery } from '../engine/world.ts';
import type { HowlEvent, LifeBlobs, LivingWorld } from '../life/index.ts';
import type { ParkRuntime } from '../mechanics/park-runtime.ts';
import type { StoryGame } from '../missions/story.ts';
import type { CanopyVisibility } from '../render/canopy-visibility.ts';
import type { BlockGrid, PoolSet, Quality } from '../render/index.ts';
import type { AvatarGroundContext } from '../world-runtime/avatar-context.ts';
import type { createStreamScene } from '../world-runtime/streaming/stream-visual.ts';

export interface SceneVisual {
	object: Group;
	load?: (signal: AbortSignal) => Promise<void>;
	textures?: readonly Texture[];
	update?: (x: number, y: number, z: number, target: { x: number; z: number }) => void;
	setBackgroundVisible?: (visible: boolean) => void;
	prepareFrame?: (camera: PerspectiveCamera, time: number, quality: Quality, night: boolean) => void;
	dispose(): void;
}
export interface SceneEnvironment {
	kind: 'graybox' | 'map';
	streaming?: ReturnType<typeof createStreamScene>['stream'];
	park?: ParkRuntime;
	avatarGround?: Pick<AvatarGroundContext, 'update'>;
	loadLife?: (
		quality: Quality,
		signal: AbortSignal,
		blobs?: LifeBlobs,
		onHowl?: (event: HowlEvent) => void
	) => Promise<LivingWorld>;
	story?: StoryGame;
	loadStoryAssets?: (
		signal: AbortSignal
	) => Promise<{ object: Group; update: (dt: number) => void; sync: () => void; dispose: () => void }>;
	start: Checkpoint;
	checkpoints: readonly Checkpoint[];
	collision: CollisionQuery & { dispose(): void };
	grid: BlockGrid;
	placements: number;
	createVisual(): SceneVisual;
	loadPlacements(
		quality: Quality,
		signal: AbortSignal
	): Promise<{
		canopies?: Pick<CanopyVisibility, 'occlusion' | 'update' | 'fading'>;
		stats?: () => { near: number; far: number; overlap: number; atlasTextures: number };
		pools: PoolSet;
		setQuality?: (quality: Quality) => void;
		dispose(): void;
	}>;
	target: { x: number; z: number; name: string };
	nextTarget(): void;
}
