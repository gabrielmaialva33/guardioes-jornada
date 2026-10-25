export interface GameDebug {
	fps: number;
	frameP95Ms: number;
	drawCalls: number;
	triangles: number;
	dpr: number;
	quality: string;
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
}
export interface HudState {
	notice: string;
	shiftLock: boolean;
	ready: boolean;
	debug: GameDebug | null;
}
declare global {
	var __gameDebug: (() => GameDebug) | undefined;
}
