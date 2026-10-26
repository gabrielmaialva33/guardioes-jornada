import type { LifeDebug } from '../life/index.ts';
import type { createStreamScene } from '../world-runtime/streaming/stream-visual.ts';
export interface GameDebug {
	textureBreakdown?: { name: string; width: number; height: number; bytes: number }[];
	streaming?: ReturnType<ReturnType<typeof createStreamScene>['stream']['debug']>;
	park?: { mode: string; house: boolean; ziplineUnlocked: boolean; photoCount: number };
	avatarContext?: {
		surface: string;
		slope: number;
		edgeAhead: number;
		talking: boolean;
		look: { x: number; y: number; z: number } | null;
		gesture: string | null;
		lastGesture: string | null;
		hairPitch: number;
		hairRoll: number;
		hairAppliedPitch: number;
	};
	life?: LifeDebug;
	goldenReady?: boolean;
	visualTime?: number;
	textureBytes?: number;
	worldKind: string;
	testing?: boolean;
	simulationTime?: number;
	cameraYaw: number;
	cameraMode?: string;
	cameraDistance?: number;
	canopiesFading?: number;
	storyProgress: (number | undefined)[];
	storyFinished: boolean;
	fps: number;
	frameP95Ms: number;
	drawCalls: number;
	triangles: number;
	dpr: number;
	quality: string;
	avatarStyle: string;
	avatarHair: string;
	avatarSkin: string;
	avatarTextureVersion: number;
	avatarAtlasSource: string;
	proxyDraws: number;
	floraDraws: number;
	geometryLods?: { near: number; far: number; overlap: number; atlasTextures: number };
	floraInstances: number;
	qualityReason: string;
	shadowRenders: number;
	fogNear: number;
	fogFar: number;
	verticalFov: number;
	horizontalFov: number;
	ready: boolean;
	geometries: number;
	textures: number;
	programs: number;
	heapMB?: number;
	x: number;
	y: number;
	z: number;
	grounded: boolean;
	checkpoint: string;
	animation: string;
	/** Sound engine state, voices and the cost of the per-frame sound update (ms, last 256 frames). */
	audio?: { state: string; voices: number; mean: number; p95: number; max: number; samples: number };
}
export interface HudState {
	target?: string;
	distance?: number;
	splash?: boolean;
	notice: string;
	shiftLock: boolean;
	ready: boolean;
	debug: GameDebug | null;
}
declare global {
	/** DEV-only deterministic streaming traversal; real-control gameplay has separate e2e coverage. */
	var __gameStreamTest:
		| { advance(x: number, z: number, yaw: number): boolean; warm(): Promise<void>; end(): void }
		| undefined;
	var __gameGoldenMask: ((hide: boolean) => void) | undefined;
	var __gameDebug: (() => GameDebug) | undefined;
}
