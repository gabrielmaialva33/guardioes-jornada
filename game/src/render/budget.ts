/**
 * Per-frame render accounting across all passes, and the gates it is checked
 * against (plano.md "Render", revisao-codex.md "Ordem, orçamento e esforço").
 *
 * three.js resets `renderer.info` at the start of every `render()` call, so a
 * frame with a shadow pass plus a HUD or post pass would only report its last
 * call. FrameBudget turns `autoReset` off and resets once per frame instead:
 * `beginFrame()` runs before the frame's first render, reads the totals the
 * previous frame left in `renderer.info` (main pass, shadow map, every other
 * render call), stores them in rolling windows and resets the counters.
 *
 * `debugSnapshot()` reads the active budget; Codex exposes it as
 * `globalThis.__gameDebug` under `?debug`.
 */
import type { Object3D, Texture } from 'three';
import type { Quality } from './quality.ts';

/** The gates on the target phone. */
export const BUDGET = {
	/** Draw calls per frame, all passes. */
	drawCalls: 200,
	/** Where to aim when it is easy. */
	comfortableDrawCalls: 150,
	/** p95 frame interval for 30 FPS. */
	frameP95Ms: 1000 / 30,
	/** Visible triangles per frame, all passes (a starting hypothesis, not a Mali limit). */
	triangles: 200_000,
	/** Texture memory in a level (ART.md §6); shadow maps are counted apart, see shadowMapBytes. */
	textureBytes: 4 * 1024 * 1024
} as const;

/** The part of WebGLRenderer the budget reads (structural, so tests need no WebGL). */
export interface InfoRenderer {
	info: {
		autoReset: boolean;
		reset(): void;
		render: { calls: number; triangles: number };
		memory: { geometries: number; textures: number };
		programs: readonly unknown[] | null;
	};
	getPixelRatio(): number;
}

export interface DebugSnapshot {
	/** Rolling frames per second over the window. */
	fps: number;
	/** 95th percentile frame interval over the window, ms. */
	frameP95Ms: number;
	/** Draw calls of the last complete frame, all passes. */
	drawCalls: number;
	/** Triangles of the last complete frame, all passes. */
	triangles: number;
	dpr: number;
	quality: Quality;
	programs: number;
	geometries: number;
	textures: number;
}

export interface FrameStats {
	frames: number;
	fps: number;
	frameP50Ms: number;
	frameP95Ms: number;
	drawCalls: number;
	drawCallsMax: number;
	triangles: number;
	trianglesMax: number;
	/** Frames in the window over BUDGET.drawCalls. */
	framesOverDrawBudget: number;
	/** Frames in the window slower than BUDGET.frameP95Ms. */
	slowFrames: number;
}

export interface FrameBudgetOptions {
	/** Frames in the rolling window (120 = 4 s at 30 FPS). */
	window?: number;
	quality?: Quality;
	/** Make this the budget debugSnapshot() reads (default true). */
	activate?: boolean;
}

let active: FrameBudget | null = null;

export class FrameBudget {
	quality: Quality;
	readonly #renderer: InfoRenderer;
	readonly #oldAutoReset: boolean;
	readonly #intervals: Float32Array;
	readonly #calls: Float32Array;
	readonly #triangles: Float32Array;
	readonly #scratch: Float32Array;
	#next = 0;
	#filled = 0;
	#lastStart = -1;
	#lastCalls = 0;
	#lastTriangles = 0;
	#open = false;

	constructor(renderer: InfoRenderer, options: FrameBudgetOptions = {}) {
		const size = options.window ?? 120;
		this.#renderer = renderer;
		this.quality = options.quality ?? 'low';
		this.#oldAutoReset = renderer.info.autoReset;
		renderer.info.autoReset = false;
		renderer.info.reset();
		this.#intervals = new Float32Array(size);
		this.#calls = new Float32Array(size);
		this.#triangles = new Float32Array(size);
		this.#scratch = new Float32Array(size);
		if (options.activate ?? true) active = this;
	}

	/**
	 * Call once per frame before any render pass, with the frame's timestamp
	 * (the rAF time, or performance.now()). Closes the previous frame with
	 * everything rendered since the last call, then resets renderer.info.
	 */
	beginFrame(now: number = performance.now()): void {
		const info = this.#renderer.info;
		if (this.#open) {
			const interval = this.#lastStart >= 0 ? now - this.#lastStart : 0;
			this.#lastCalls = info.render.calls;
			this.#lastTriangles = info.render.triangles;
			// A second or more is a pause (hidden tab), not a frame.
			if (interval > 0 && interval < 1000) {
				this.#intervals[this.#next] = interval;
				this.#calls[this.#next] = this.#lastCalls;
				this.#triangles[this.#next] = this.#lastTriangles;
				this.#next = (this.#next + 1) % this.#intervals.length;
				this.#filled = Math.min(this.#filled + 1, this.#intervals.length);
			}
		}
		info.reset();
		this.#lastStart = now;
		this.#open = true;
	}

	/** Forgets the window (after a pause, a tier change or a context restore). */
	reset(): void {
		this.#next = 0;
		this.#filled = 0;
		this.#lastStart = -1;
		this.#open = false;
		this.#renderer.info.reset();
	}

	/** Rolling statistics over the window; sorts a copy (call a few times a second, not per frame). */
	stats(): FrameStats {
		const n = this.#filled;
		let sum = 0;
		let callsMax = 0;
		let trianglesMax = 0;
		let overDraws = 0;
		let slow = 0;
		for (let i = 0; i < n; i++) {
			sum += this.#intervals[i];
			if (this.#calls[i] > callsMax) callsMax = this.#calls[i];
			if (this.#triangles[i] > trianglesMax) trianglesMax = this.#triangles[i];
			if (this.#calls[i] > BUDGET.drawCalls) overDraws++;
			if (this.#intervals[i] > BUDGET.frameP95Ms) slow++;
		}
		return {
			frames: n,
			fps: sum > 0 ? (1000 * n) / sum : 0,
			frameP50Ms: this.#percentile(0.5),
			frameP95Ms: this.#percentile(0.95),
			drawCalls: this.#lastCalls,
			drawCallsMax: callsMax,
			triangles: this.#lastTriangles,
			trianglesMax,
			framesOverDrawBudget: overDraws,
			slowFrames: slow
		};
	}

	snapshot(): DebugSnapshot {
		const stats = this.stats();
		const info = this.#renderer.info;
		return {
			fps: stats.fps,
			frameP95Ms: stats.frameP95Ms,
			drawCalls: stats.drawCalls,
			triangles: stats.triangles,
			dpr: this.#renderer.getPixelRatio(),
			quality: this.quality,
			programs: info.programs?.length ?? 0,
			geometries: info.memory.geometries,
			textures: info.memory.textures
		};
	}

	/** Makes this the budget debugSnapshot() reads. */
	activate(): void {
		active = this;
	}

	/** Restores renderer.info.autoReset and stops being the active budget. */
	dispose(): void {
		this.#renderer.info.autoReset = this.#oldAutoReset;
		if (active === this) active = null;
	}

	#percentile(q: number): number {
		const n = this.#filled;
		if (n === 0) return 0;
		const values = this.#scratch;
		for (let i = 0; i < n; i++) {
			const v = this.#intervals[i];
			let j = i - 1;
			while (j >= 0 && values[j] > v) {
				values[j + 1] = values[j];
				j--;
			}
			values[j + 1] = v;
		}
		return values[Math.min(n - 1, Math.max(0, Math.ceil(q * n) - 1))];
	}
}

const EMPTY: DebugSnapshot = {
	fps: 0,
	frameP95Ms: 0,
	drawCalls: 0,
	triangles: 0,
	dpr: 0,
	quality: 'low',
	programs: 0,
	geometries: 0,
	textures: 0
};

/** The active budget's numbers, or zeros before the game renders. For `globalThis.__gameDebug`. */
export function debugSnapshot(): DebugSnapshot {
	return active ? active.snapshot() : { ...EMPTY };
}

// --- Memory estimates -----------------------------------------------------------------

/** Every texture referenced by the materials under `root`. */
export function collectTextures(root: Object3D, into: Set<Texture> = new Set()): Set<Texture> {
	root.traverse((object) => {
		const material = (object as Object3D & { material?: unknown }).material;
		const list = Array.isArray(material) ? material : material ? [material] : [];
		for (const m of list)
			for (const value of Object.values(m as Record<string, unknown>))
				if ((value as Texture | null)?.isTexture) into.add(value as Texture);
	});
	return into;
}

/** GPU bytes of textures as RGBA8, with a third more for mipmaps where they are generated. */
export function textureBytes(textures: Iterable<Texture>): number {
	let bytes = 0;
	for (const texture of textures) {
		const image = texture.image as { width?: number; height?: number } | null | undefined;
		const width = image?.width ?? 0;
		const height = image?.height ?? 0;
		const base = width * height * 4;
		bytes += texture.generateMipmaps ? Math.ceil((base * 4) / 3) : base;
	}
	return bytes;
}

/**
 * GPU bytes of a directional shadow map in three r186: an RGBA8 colour target
 * plus a 32-bit depth texture of mapSize², so 8 MiB at 1024 and 32 MiB at 2048.
 */
export function shadowMapBytes(mapSize: number): number {
	return mapSize * mapSize * 8;
}
