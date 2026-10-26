export interface GameDebug {
	goldenReady?: boolean;
	visualTime?: number;
	worldKind: string;
	cameraYaw: number;
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
	var __gameGoldenMask: ((hide: boolean) => void) | undefined;
	var __gameDebug: (() => GameDebug) | undefined;
}
