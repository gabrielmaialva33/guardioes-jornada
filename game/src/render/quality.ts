/**
 * Quality tiers, the first pick from device capabilities, the DPR governor and
 * the WebGL context-loss contract.
 *
 * - low: the target phones (Mali-G52/G57, Adreno 610, 3–4 GB). No shadow map,
 *   blob shadows, DPR 0.75–1, the shortest fog. It must hold 30 FPS there.
 * - medium: 1024 shadow map for the avatar and animals, DPR up to 1.25. Phones
 *   only get it with evidence (`mobileMedium`), see plano.md "Render".
 * - high: 2048 shadow map, DPR up to 1.5. Desktop-class GPUs only.
 *
 * The pick is a starting point: the DPR governor then trades resolution for
 * frame time within the tier, and `DprGovernor.saturated` tells the caller when
 * even the lowest DPR is too slow (the bottleneck is then draws or JS, not pixels).
 */

export type Quality = 'low' | 'medium' | 'high';

export const QUALITIES: readonly Quality[] = ['low', 'medium', 'high'];

/** The DPR ladder the governor walks (roblox-web-stack.md §6). */
export const DPR_STEPS: readonly number[] = [0.75, 0.85, 1, 1.25, 1.5];

export interface QualityPreset {
	/** DPR the governor starts at. */
	readonly dprStart: number;
	/** Highest DPR of the tier, before the screen and pixel caps. */
	readonly dprMax: number;
	/** Drawing-buffer pixel cap: the DPR never makes width × height exceed it. */
	readonly maxPixels: number;
}

export const QUALITY: Readonly<Record<Quality, QualityPreset>> = {
	// 360 × 800 CSS px at DPR 1 is 0.29 MP; the cap leaves room for 412 × 915 phones.
	low: { dprStart: 1, dprMax: 1, maxPixels: 0.5e6 },
	medium: { dprStart: 1, dprMax: 1.25, maxPixels: 1.1e6 },
	high: { dprStart: 1.25, dprMax: 1.5, maxPixels: 2.4e6 }
};

// --- Capabilities -------------------------------------------------------------

export interface Capabilities {
	/** A WebGL2 context was actually created. */
	webgl2: boolean;
	/** UNMASKED_RENDERER_WEBGL when exposed, else RENDERER; '' when unknown. */
	renderer: string;
	/** navigator.deviceMemory: a hint in GB, rounded down to a power of two (a 3 GB phone reports 2). */
	deviceMemory?: number;
	/** navigator.hardwareConcurrency. */
	cores?: number;
	/** The Save-Data request (navigator.connection.saveData). */
	saveData?: boolean;
	/** Touch-first device (coarse pointer or a mobile user agent). */
	mobile?: boolean;
}

/** Software rasterizers: the game cannot hold any frame rate on them. */
const SOFTWARE_GPU = /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i;

/**
 * GPUs that struggle with fill rate or draw calls: every target phone. Extends
 * the diorama's list (src/lib/diorama/tier.ts) with the older Mali-G7x of
 * budget Exynos/Helio parts and Adreno names without "(TM)".
 */
const WEAK_GPU =
	/Mali-(4\d\d|T\d+|G(31|51|52|57|68|71|72|76)\b)|PowerVR|\bIMG\b|Adreno(?: \(TM\))? ([2-5]\d\d|6[01]\d)\b|GE8\d{3}/i;

/** Mobile GPUs strong enough for medium once a phone of that class is measured. */
const STRONG_MOBILE_GPU =
	/Adreno(?: \(TM\))? (6[2-9]\d|[7-9]\d\d)\b|Mali-G(6[1-9]\d|7[1-9]\d|[89]\d\d)\b|Immortalis|Xclipse|Apple GPU|Apple A\d/i;

/** Names that only mobile GPUs carry. */
const MOBILE_GPU = /Mali|Adreno|PowerVR|\bIMG\b|Immortalis|Xclipse|Apple GPU|Apple A\d|GE8\d{3}|Maleoon/i;

/** Discrete or Apple-silicon desktop GPUs. */
const DESKTOP_GPU = /GeForce|RTX|Quadro|NVIDIA|Radeon (RX|Pro)|Apple M\d|Intel\(R\) Arc|\bArc\b/i;

/** Masked or generic renderer strings that say nothing about the GPU. */
const MASKED_GPU = /^(WebKit WebGL|Mozilla|Generic Renderer)?$|^ANGLE \(Unknown/i;

interface NavigatorHints {
	deviceMemory?: number;
	hardwareConcurrency?: number;
	connection?: { saveData?: boolean };
	userAgent?: string;
	userAgentData?: { mobile?: boolean };
}

/**
 * Capabilities from a live WebGL2 context. Pass the game renderer's own
 * context (`renderer.getContext()`) so no second context is ever created on a
 * 3 GB phone; `gl` null means WebGL2 failed.
 */
export function readCapabilities(
	gl: WebGL2RenderingContext | null,
	nav: NavigatorHints = globalThis.navigator ?? {},
	coarsePointer = false
): Capabilities {
	let renderer = '';
	if (gl) {
		const debug = gl.getExtension('WEBGL_debug_renderer_info');
		renderer = String(gl.getParameter(debug ? debug.UNMASKED_RENDERER_WEBGL : gl.RENDERER) ?? '');
	}
	const mobile =
		coarsePointer ||
		nav.userAgentData?.mobile === true ||
		/Android|iPhone|iPad|iPod|Mobile/i.test(nav.userAgent ?? '');
	return {
		webgl2: gl !== null,
		renderer,
		deviceMemory: nav.deviceMemory,
		cores: nav.hardwareConcurrency,
		saveData: nav.connection?.saveData === true,
		mobile
	};
}

/**
 * Probes with a throwaway canvas and releases its context at once. Prefer
 * readCapabilities() on the renderer's context; use this only before the game
 * canvas exists (e.g. to decide whether to offer the game at all).
 */
export function probeCapabilities(): Capabilities {
	const coarse = globalThis.matchMedia?.('(pointer: coarse)').matches ?? false;
	if (typeof document === 'undefined') return readCapabilities(null, undefined, coarse);
	const canvas = document.createElement('canvas');
	let gl: WebGL2RenderingContext | null = null;
	try {
		gl = canvas.getContext('webgl2', { powerPreference: 'low-power', antialias: false, stencil: false });
	} catch {
		gl = null;
	}
	const caps = readCapabilities(gl, undefined, coarse);
	gl?.getExtension('WEBGL_lose_context')?.loseContext();
	return caps;
}

export interface QualityChoice {
	/** False when the game cannot run at all (no WebGL2, software GPU). */
	canRender: boolean;
	quality: Quality;
	/** Why, for the debug overlay and logs. */
	reason: string;
}

export interface PickOptions {
	/** Let strong phones start at medium. Off until a mid phone (Galaxy A57) is measured. */
	mobileMedium?: boolean;
	/** Allow high on desktop-class GPUs. */
	allowHigh?: boolean;
}

/**
 * The starting tier. Low is the default for anything mobile, weak, masked or
 * short on memory; medium and high need a GPU known to cope.
 */
export function pickQuality(caps: Capabilities, options: PickOptions = {}): QualityChoice {
	const { mobileMedium = false, allowHigh = true } = options;
	const gpu = caps.renderer.trim();
	if (!caps.webgl2) return { canRender: false, quality: 'low', reason: 'no-webgl2' };
	if (SOFTWARE_GPU.test(gpu)) return { canRender: false, quality: 'low', reason: 'software-gpu' };
	const low = (reason: string): QualityChoice => ({ canRender: true, quality: 'low', reason });
	if (caps.saveData) return low('save-data');
	if (WEAK_GPU.test(gpu)) return low('weak-gpu');
	// deviceMemory rounds down: 2 is a 2–3 GB phone, 4 is 4–7 GB. Both are the target class.
	if (caps.deviceMemory !== undefined && caps.deviceMemory <= 4 && (caps.mobile || !DESKTOP_GPU.test(gpu)))
		return low('low-memory');
	if (caps.cores !== undefined && caps.cores > 0 && caps.cores <= 4) return low('few-cores');
	const mobile = caps.mobile === true || MOBILE_GPU.test(gpu);
	if (MASKED_GPU.test(gpu))
		return mobile ? low('masked-gpu') : { canRender: true, quality: 'medium', reason: 'masked-gpu' };
	if (mobile) {
		if (mobileMedium && STRONG_MOBILE_GPU.test(gpu))
			return { canRender: true, quality: 'medium', reason: 'strong-mobile-gpu' };
		return low('mobile');
	}
	if (
		allowHigh &&
		DESKTOP_GPU.test(gpu) &&
		(caps.deviceMemory === undefined || caps.deviceMemory >= 8) &&
		(caps.cores === undefined || caps.cores >= 8)
	)
		return { canRender: true, quality: 'high', reason: 'desktop-gpu' };
	return { canRender: true, quality: 'medium', reason: 'desktop' };
}

/** Is this renderer string one of the weak GPUs (exported for tests and the debug overlay)? */
export function isWeakGpu(renderer: string): boolean {
	return WEAK_GPU.test(renderer);
}

// --- DPR governor -------------------------------------------------------------

/**
 * Highest DPR that keeps the drawing buffer within `maxPixels` and never above
 * the screen's own DPR (rendering above it costs fill rate for nothing).
 */
export function dprLimit(cssWidth: number, cssHeight: number, screenDpr: number, maxPixels: number): number {
	const area = Math.max(1, cssWidth * cssHeight);
	return Math.min(screenDpr > 0 ? screenDpr : 1, Math.sqrt(maxPixels / area));
}

export interface GovernorOptions {
	/** DPR ladder, ascending. */
	steps?: readonly number[];
	/** Initial DPR, snapped down to a step. */
	start: number;
	/** Highest DPR allowed (tier and screen), snapped down to a step. */
	max: number;
	/** Frame interval to hold, in ms (30 FPS). */
	targetMs?: number;
	/** Frames per decision window. */
	windowFrames?: number;
	/** A window is slow when its p75 interval exceeds targetMs × slowFactor. */
	slowFactor?: number;
	/** A window is fast when its p75 interval is below targetMs × fastFactor. */
	fastFactor?: number;
	/** Consecutive slow windows before one step down. */
	slowWindows?: number;
	/** Consecutive fast windows before one step up. */
	fastWindows?: number;
	/** Windows ignored after a change while the new buffer size settles. */
	settleWindows?: number;
	/** Drops from the same step before the ceiling closes below it for good. */
	dropsToClose?: number;
}

/**
 * Resolution governor with hysteresis. Every `windowFrames` frames it takes the
 * p75 of the frame intervals: slow windows in a row lower the DPR one step,
 * fast windows in a row raise it, anything between resets both counts. After a
 * change it ignores `settleWindows` windows. Each drop from a step is counted;
 * after `dropsToClose` drops from the same step the ceiling closes below that
 * step and never opens again in this session ("a ceiling that only closes").
 *
 * Lowering the DPR only helps when the GPU is fill-bound; `saturated` reports
 * slow windows at the floor so the caller can lower the tier instead.
 * Allocation-free per frame.
 */
export class DprGovernor {
	readonly steps: readonly number[];
	readonly targetMs: number;
	readonly #window: Float32Array;
	readonly #scratch: Float32Array;
	readonly #drops: Uint8Array;
	readonly #slowMs: number;
	readonly #fastMs: number;
	readonly #slowWindows: number;
	readonly #fastWindows: number;
	readonly #settleWindows: number;
	readonly #dropsToClose: number;
	#filled = 0;
	#index: number;
	/** Highest step index the tier and screen allow right now. */
	#limit: number;
	/** Highest step index this session may ever use again. Only decreases. */
	#ceiling: number;
	#slow = 0;
	#fast = 0;
	#settle = 0;
	#slowAtFloor = 0;
	#lastP75 = 0;

	constructor(options: GovernorOptions) {
		this.steps = options.steps ?? DPR_STEPS;
		this.targetMs = options.targetMs ?? 1000 / 30;
		const frames = options.windowFrames ?? 45;
		this.#window = new Float32Array(frames);
		this.#scratch = new Float32Array(frames);
		this.#drops = new Uint8Array(this.steps.length);
		this.#slowMs = this.targetMs * (options.slowFactor ?? 1.1);
		this.#fastMs = this.targetMs * (options.fastFactor ?? 0.6);
		this.#slowWindows = options.slowWindows ?? 2;
		this.#fastWindows = options.fastWindows ?? 4;
		this.#settleWindows = options.settleWindows ?? 1;
		this.#dropsToClose = options.dropsToClose ?? 2;
		this.#ceiling = this.steps.length - 1;
		this.#limit = this.#stepAtOrBelow(options.max);
		this.#index = Math.min(this.#stepAtOrBelow(options.start), this.#limit);
	}

	/** The DPR to render at. */
	get dpr(): number {
		return this.steps[this.#index];
	}

	/** The highest DPR the governor may still reach. */
	get ceiling(): number {
		return this.steps[Math.min(this.#limit, this.#ceiling)];
	}

	/** p75 frame interval of the last full window, in ms (0 before the first). */
	get lastP75(): number {
		return this.#lastP75;
	}

	/** Slow windows in a row at the lowest DPR: lowering resolution no longer helps. */
	get saturated(): number {
		return this.#slowAtFloor;
	}

	/**
	 * Feeds one frame interval in ms (rAF timestamp delta). Returns true when
	 * `dpr` changed; then apply it (`renderer.setPixelRatio`, or Threlte's
	 * `dpr.set`). Intervals of a second or more (a hidden tab) are ignored.
	 */
	sample(intervalMs: number): boolean {
		if (!(intervalMs > 0 && intervalMs < 1000)) return false;
		this.#window[this.#filled++] = intervalMs;
		if (this.#filled < this.#window.length) return false;
		this.#filled = 0;
		const p75 = this.#percentile(0.75);
		this.#lastP75 = p75;
		if (this.#settle > 0) {
			this.#settle--;
			return false;
		}
		if (p75 > this.#slowMs) {
			this.#fast = 0;
			this.#slow++;
			if (this.#index === 0) this.#slowAtFloor++;
			if (this.#slow >= this.#slowWindows && this.#index > 0) {
				const from = this.#index;
				this.#drops[from]++;
				if (this.#drops[from] >= this.#dropsToClose) this.#ceiling = Math.min(this.#ceiling, from - 1);
				return this.#set(from - 1);
			}
			return false;
		}
		this.#slowAtFloor = 0;
		if (p75 < this.#fastMs) {
			this.#slow = 0;
			this.#fast++;
			if (this.#fast >= this.#fastWindows && this.#index < Math.min(this.#limit, this.#ceiling))
				return this.#set(this.#index + 1);
			return false;
		}
		// The dead band between the thresholds: hold, and forget partial streaks.
		this.#slow = 0;
		this.#fast = 0;
		return false;
	}

	/**
	 * The tier or screen cap changed (resize, rotation, tier switch). Lowers the
	 * DPR at once if it is above the new limit; never reopens a closed ceiling.
	 * Returns true when `dpr` changed.
	 */
	setLimit(maxDpr: number): boolean {
		this.#limit = this.#stepAtOrBelow(maxDpr);
		if (this.#index > this.#limit) return this.#set(this.#limit);
		return false;
	}

	/** Drops the current window and streaks (after a pause, resize or context restore). */
	reset(): void {
		this.#filled = 0;
		this.#slow = 0;
		this.#fast = 0;
		this.#slowAtFloor = 0;
		this.#settle = this.#settleWindows;
	}

	#set(index: number): boolean {
		this.#slow = 0;
		this.#fast = 0;
		this.#settle = this.#settleWindows;
		if (index === this.#index) return false;
		this.#index = index;
		return true;
	}

	#stepAtOrBelow(value: number): number {
		let index = 0;
		for (let i = 0; i < this.steps.length; i++) if (this.steps[i] <= value + 1e-6) index = i;
		return index;
	}

	/** Insertion sort of a copy: 45 floats once per window, no allocation. */
	#percentile(q: number): number {
		const values = this.#scratch;
		const n = this.#window.length;
		for (let i = 0; i < n; i++) {
			const v = this.#window[i];
			let j = i - 1;
			while (j >= 0 && values[j] > v) {
				values[j + 1] = values[j];
				j--;
			}
			values[j + 1] = v;
		}
		return values[Math.min(n - 1, Math.ceil(q * n) - 1)];
	}
}

// --- Context loss ---------------------------------------------------------------

/**
 * What the game does when the GPU drops the WebGL context (Android does this
 * under memory pressure or when the GPU process restarts):
 *
 * - `lost()`: stop the loop (`renderer.setAnimationLoop(null)`), pause game
 *   time and show "Recarregando gráficos…". Never touch GL here.
 * - `restored()`: three.js rebuilds its GL state by itself and re-uploads
 *   geometry, instance buffers and textures that still hold their data on the
 *   CPU. The game then: `shadows.invalidate()` (the shadow map is not
 *   auto-updated), `governor.reset()`, `budget.reset()`, optionally
 *   `renderer.compileAsync(scene, camera)`, and restarts the loop.
 * - `failed(losses)`: `maxLosses` within `windowMs` means memory pressure:
 *   leave the game with a message, or restart it one tier lower.
 */
export interface ContextLossHandlers {
	lost(): void;
	restored(): void;
	failed?(losses: number): void;
}

export interface ContextLossOptions {
	/** Losses within `windowMs` that count as failure. */
	maxLosses?: number;
	windowMs?: number;
	signal?: AbortSignal;
	now?: () => number;
}

/**
 * Wires the contract to the canvas. Calls `preventDefault()` on loss so the
 * browser may restore the context. Returns a function that removes the listeners.
 */
export function watchContextLoss(
	canvas: EventTarget,
	handlers: ContextLossHandlers,
	options: ContextLossOptions = {}
): () => void {
	const { maxLosses = 2, windowMs = 3 * 60 * 1000, signal, now = () => performance.now() } = options;
	const losses: number[] = [];
	const onLost = (event: Event) => {
		event.preventDefault();
		const at = now();
		losses.push(at);
		while (losses.length > 0 && at - losses[0] > windowMs) losses.shift();
		handlers.lost();
		if (losses.length >= maxLosses) handlers.failed?.(losses.length);
	};
	const onRestored = () => handlers.restored();
	canvas.addEventListener('webglcontextlost', onLost, { signal });
	canvas.addEventListener('webglcontextrestored', onRestored, { signal });
	return () => {
		canvas.removeEventListener('webglcontextlost', onLost);
		canvas.removeEventListener('webglcontextrestored', onRestored);
	};
}
