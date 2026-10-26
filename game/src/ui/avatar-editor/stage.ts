/**
 * The editor's live 3D preview and its thumbnail renderer, on one small WebGL
 * context of its own (created when the editor opens, disposed and force-lost
 * when it closes). The game's avatar is never touched: the stage loads its own
 * avatar for the preview and a second, hidden one that poses for thumbnails.
 *
 * Preview: the avatar on a mossy pedestal, in the game's daylight colours,
 * playing the animator's idle (breathing, idle variants) and a short gesture on
 * request; drag or arrow keys turn the turntable (spin.ts); tabs change the
 * camera framing (framing.ts). No shadows besides the pedestal's blob.
 *
 * Thumbnails: each grid option is rendered into a 128² (96² on low) sRGB
 * render target, read back with readPixels and copied into a small canvas,
 * cached per option key for the whole session (ThumbnailCache) and scheduled
 * a few per frame within ~4 ms (ThumbnailQueue), only for the visible tab.
 *
 * Frames: requestAnimationFrame only while the canvas is on screen and the page
 * visible; 30 FPS on low; with reduced motion the idle is frozen (no breathing,
 * no idle variants) and frames are drawn only when something changes. The loop
 * allocates nothing. Context loss pauses everything; three.js restores its own
 * resources and the stage resumes (twice in three minutes: it gives up).
 */
import {
	DirectionalLight,
	Group,
	type Mesh,
	NoToneMapping,
	type Object3D,
	PerspectiveCamera,
	Scene,
	SRGBColorSpace,
	Vector3,
	WebGLRenderer,
	WebGLRenderTarget
} from 'three';
import { AvatarAnimator, createAvatarInput } from '../../animation/avatar-animator.ts';
import { AVATAR_LAYOUT, BLOCKY_RIG } from '../../animation/joints.ts';
import { applyToRig, bindRig, type RigBinding } from '../../animation/rig.ts';
import type { AvatarProfile } from '../../data/local-save.ts';
import {
	dprLimit,
	pickQuality,
	type Quality,
	readCapabilities,
	watchContextLoss
} from '../../render/quality.ts';
import { createHemisphere, LIGHT_INTENSITY } from '../../render/shadows.ts';
import { lighting } from '../../render/stylized.ts';
import { type AvatarInstance, loadAvatar } from '../../scene/avatar.ts';
import { LIGHT } from '../../style/palette.ts';
import type { FramingId } from './editor.ts';
import {
	type CameraPlacement,
	FOV_DEG,
	FRAMINGS,
	FramingTween,
	placeCamera,
	THUMB_FRAMINGS
} from './framing.ts';
import { createPedestal } from './pedestal.ts';
import { Spin } from './spin.ts';
import { readbackToImage, ThumbnailCache, ThumbnailQueue, type ThumbnailStats } from './thumbnails.ts';

export interface StageTier {
	/** Highest device pixel ratio, and the drawing-buffer pixel cap. */
	dprMax: number;
	maxPixels: number;
	thumbSize: number;
	/** MSAA samples of the thumbnail target; antialias of the preview context. */
	samples: number;
	antialias: boolean;
	/** Minimum time between preview frames, ms (0: every display frame). */
	frameMs: number;
}

export const STAGE_TIERS: Readonly<Record<Quality, Readonly<StageTier>>> = {
	low: { dprMax: 1.5, maxPixels: 0.45e6, thumbSize: 96, samples: 0, antialias: false, frameMs: 1000 / 30 },
	medium: { dprMax: 2, maxPixels: 1e6, thumbSize: 128, samples: 4, antialias: true, frameMs: 0 },
	high: { dprMax: 2, maxPixels: 1.8e6, thumbSize: 128, samples: 4, antialias: true, frameMs: 0 }
};

/** Thumbnail work per frame, ms. */
export const THUMB_BUDGET_MS = 4;

export type StageStatus = 'loading' | 'ready' | 'lost' | 'failed';
export type StageGesture = 'wave' | 'cheer';

export interface StageThumbnailRequest {
	key: string;
	profile: AvatarProfile;
	framing: FramingId;
}

/** Everything the stage needs from the page; tests replace it. */
export interface StageHost {
	now(): number;
	requestFrame(callback: (time: number) => void): number;
	cancelFrame(id: number): void;
	/** Copies `size`² read-back pixels into a new image for the cache; undefined if it cannot. */
	paint(pixels: Uint8Array, size: number): HTMLCanvasElement | undefined;
}

export interface StageOptions {
	canvas: HTMLCanvasElement;
	profile: AvatarProfile;
	framing?: FramingId;
	/** The game's tier; measured from this context when omitted. */
	quality?: Quality;
	reducedMotion?: boolean;
	/** performance.now() when the editor started opening, for the first-frame metric. */
	openedAt?: number;
	onstatus?: (status: StageStatus) => void;
	/** The first preview frame is on screen. */
	onready?: (metrics: StageMetrics) => void;
	/** A thumbnail was stored: repaint tiles showing `key`. */
	onthumbnail?: (key: string) => void;
	/** The turntable came to rest after user input (degrees, for aria-valuenow). */
	onturn?: (degrees: number) => void;
	/** The child dragged the preview for the first time. */
	ondrag?: () => void;
	// Seams for tests and the preview page.
	createRenderer?: (canvas: HTMLCanvasElement, antialias: boolean) => WebGLRenderer;
	loadAvatar?: (signal: AbortSignal, profile: AvatarProfile) => Promise<AvatarInstance>;
	host?: Partial<StageHost>;
	cache?: ThumbnailCache<HTMLCanvasElement>;
}

export interface StageMetrics {
	quality: Quality;
	gpu: string;
	dpr: number;
	thumbSize: number;
	/** From openedAt to the first preview frame; and its parts. */
	firstFrameMs: number | null;
	rendererMs: number;
	avatarMs: number | null;
	compileMs: number | null;
	thumbnails: ThumbnailStats & { cached: number; pending: number };
	drawCalls: number;
	triangles: number;
	/** Preview frames drawn so far (idle with reduced motion: it stops growing). */
	frames: number;
}

export interface DisposeReport {
	/** GPU objects still counted by the renderer after the stage freed its own (should be 0). */
	geometries: number;
	textures: number;
	programs: number;
}

export interface AvatarStage {
	readonly status: StageStatus;
	readonly quality: Quality;
	readonly thumbSize: number;
	/** Turntable yaw in whole degrees, 0–359. */
	readonly degrees: number;
	setProfile(profile: AvatarProfile): Promise<void>;
	setFraming(framing: FramingId): void;
	setReducedMotion(reduced: boolean): void;
	react(gesture: StageGesture): void;
	/** Arrow keys: one step left (−1) or right (+1). */
	turn(direction: -1 | 1): void;
	requestThumbnails(requests: readonly StageThumbnailRequest[]): void;
	thumbnail(key: string): HTMLCanvasElement | undefined;
	metrics(): StageMetrics;
	dispose(): DisposeReport;
}

/** One cache for the game session: reopening the editor reuses every thumbnail made so far. */
export const sessionThumbnails = new ThumbnailCache<HTMLCanvasElement>({
	maxEntries: 72,
	release(canvas) {
		canvas.width = canvas.height = 0;
	}
});

/** Frees the session's thumbnails (call when the game itself closes). */
export function releaseThumbnails() {
	sessionThumbnails.clear();
}

const HAIR_DANGLES = ['avatar-hair-dangle-0', 'avatar-hair-dangle-1'];
/** After a gesture ends with reduced motion, keep animating this long for its fade back to idle (s). */
const SETTLE_SECONDS = 0.4;

function defaultRenderer(canvas: HTMLCanvasElement, antialias: boolean): WebGLRenderer {
	return new WebGLRenderer({
		canvas,
		antialias,
		alpha: true,
		stencil: false,
		powerPreference: 'low-power',
		preserveDrawingBuffer: false
	});
}

function defaultHost(): StageHost {
	let scratch: ImageData | undefined;
	return {
		now: () => performance.now(),
		requestFrame: (callback) => requestAnimationFrame(callback),
		cancelFrame: (id) => cancelAnimationFrame(id),
		paint(pixels, size) {
			const canvas = document.createElement('canvas');
			canvas.width = canvas.height = size;
			const context = canvas.getContext('2d');
			if (!context) return undefined;
			if (!scratch || scratch.width !== size) scratch = context.createImageData(size, size);
			readbackToImage(pixels, scratch.data, size, size);
			context.putImageData(scratch, 0, 0);
			return canvas;
		}
	};
}

function swayStyle(profile: AvatarProfile): string {
	return profile.style === 'classic' ? (profile.hairStyle ?? 'curto') : 'curto';
}

function findDangles(model: Object3D): Mesh[] {
	const dangles: Mesh[] = [];
	for (const name of HAIR_DANGLES) {
		const node = model.getObjectByName(name);
		if (node && 'isMesh' in node) dangles.push(node as Mesh);
	}
	return dangles;
}

export function createAvatarStage(options: StageOptions): AvatarStage {
	const host: StageHost = { ...defaultHost(), ...options.host };
	const openedAt = options.openedAt ?? host.now();
	const canvas = options.canvas;
	const coarse = globalThis.matchMedia?.('(pointer: coarse)').matches ?? false;
	let reduced = options.reducedMotion ?? false;

	// --- Renderer ------------------------------------------------------------------
	const guess: Quality = options.quality ?? (coarse ? 'low' : 'medium');
	const renderer = (options.createRenderer ?? defaultRenderer)(canvas, STAGE_TIERS[guess].antialias);
	let gpu = '';
	let quality = guess;
	if (!options.quality) {
		const gl = renderer.getContext();
		const caps = readCapabilities(
			typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext ? gl : null,
			globalThis.navigator,
			coarse
		);
		gpu = caps.renderer;
		quality = pickQuality(caps, { mobileMedium: false }).quality;
	}
	const tier = STAGE_TIERS[quality];
	renderer.outputColorSpace = SRGBColorSpace;
	renderer.toneMapping = NoToneMapping;
	renderer.shadowMap.enabled = false;
	renderer.setClearColor(0x000000, 0);
	const rendererMs = host.now() - openedAt;

	// --- Scene -----------------------------------------------------------------------
	const scene = new Scene();
	const hemisphere = createHemisphere('daylight');
	const sun = new DirectionalLight(LIGHT.daylight.sun, LIGHT_INTENSITY.daylight.sun);
	const root = new Group();
	sun.position.set(-2.6, 5, 4.2);
	sun.target = root;
	const turntable = new Group();
	const thumbStand = new Group();
	thumbStand.visible = false;
	const floor = createPedestal();
	turntable.add(floor.object);
	root.add(turntable, thumbStand);
	scene.add(hemisphere, sun, root);
	const camera = new PerspectiveCamera(FOV_DEG, 1, 0.1, 60);
	const thumbCamera = new PerspectiveCamera(FOV_DEG, 1, 0.1, 60);
	const placement: CameraPlacement = { x: 0, y: 0, z: 0, targetY: 0 };
	/** The avatar looks at the viewer: the camera, in world units (the turntable stands at the origin). */
	const eye = new Vector3(0, FRAMINGS.body.targetY, 10);

	// --- State -----------------------------------------------------------------------
	let framing: FramingId = options.framing ?? 'body';
	const tween = new FramingTween(FRAMINGS[framing]);
	const spin = new Spin();
	spin.yaw = FRAMINGS[framing].yaw;
	spin.inertia = !reduced;
	const animator = new AvatarAnimator({ seed: 0x7a11 });
	const input = createAvatarInput();
	input.lookTarget = eye;
	let status: StageStatus = 'loading';
	let disposed = false;
	let lost = false;
	let failed = false;
	let visible = true;
	let pageHidden = typeof document !== 'undefined' ? document.hidden : false;
	let dirty = true;
	let frameId = 0;
	let lastTime = -1;
	let settle = 0;
	let pending: StageGesture | null = null;
	let omega = 0;
	let lastYaw = spin.yaw;
	let pointerId: number | null = null;
	let dragged = false;
	let dpr = 1;
	let profile = options.profile;
	let profileGeneration = 0;
	let avatar: AvatarInstance | undefined;
	let rig: RigBinding | undefined;
	let dangles: Mesh[] = [];
	let firstFrameAt: number | null = null;
	let frames = 0;
	let avatarMs: number | null = null;
	let compileMs: number | null = null;
	let report: DisposeReport | undefined;
	const abort = new AbortController();
	const listeners = new AbortController();
	const load = options.loadAvatar ?? loadAvatar;

	// --- Thumbnails --------------------------------------------------------------------
	const cache = options.cache ?? sessionThumbnails;
	const thumbSize = tier.thumbSize;
	const queue = new ThumbnailQueue<HTMLCanvasElement>({
		cache,
		budgetMs: THUMB_BUDGET_MS,
		now: host.now,
		onready: (key) => options.onthumbnail?.(key),
		prepare: (key) => prepare(key)
	});
	const target = new WebGLRenderTarget(thumbSize, thumbSize, {
		samples: tier.samples,
		depthBuffer: true,
		stencilBuffer: false
	});
	// sRGB storage: the GPU encodes the linear output, so the read-back bytes are display-ready.
	target.texture.colorSpace = SRGBColorSpace;
	const readBuffer = new Uint8Array(thumbSize * thumbSize * 4);
	const requests = new Map<string, StageThumbnailRequest>();
	let lastRequest: readonly StageThumbnailRequest[] = [];
	let thumb: AvatarInstance | undefined;
	let thumbLoading = false;
	let thumbFailed = false;
	/** The render-target variant of the avatar's shaders is compiled (it outputs linear colour). */
	let thumbShaders = false;
	let job: { key: string; ready: boolean; failed: boolean } | null = null;

	const setStatus = (next: StageStatus) => {
		if (status === next) return;
		status = next;
		options.onstatus?.(next);
	};

	/** The game's canopy shade map belongs to its renderer: never sample (or upload) it here. */
	const renderNeutral = (renderTarget: WebGLRenderTarget | null, view: PerspectiveCamera) => {
		const shadeMap = lighting.uShadeMap.value;
		const shadeEnabled = lighting.uShadeEnabled.value;
		lighting.uShadeMap.value = null;
		lighting.uShadeEnabled.value = 0;
		renderer.setRenderTarget(renderTarget);
		renderer.render(scene, view);
		lighting.uShadeMap.value = shadeMap;
		lighting.uShadeEnabled.value = shadeEnabled;
	};

	const renderThumbnail = (request: StageThumbnailRequest): HTMLCanvasElement | undefined => {
		const shot = THUMB_FRAMINGS[request.framing];
		thumbStand.rotation.y = shot.yaw;
		placeCamera(shot, 1, placement);
		thumbCamera.position.set(placement.x, placement.y, placement.z);
		thumbCamera.lookAt(0, placement.targetY, 0);
		turntable.visible = false;
		thumbStand.visible = true;
		renderNeutral(target, thumbCamera);
		renderer.readRenderTargetPixels(target, 0, 0, thumbSize, thumbSize, readBuffer);
		renderer.setRenderTarget(null);
		turntable.visible = true;
		thumbStand.visible = false;
		return host.paint(readBuffer, thumbSize);
	};

	/** One key per call: start its skin change, then (a later frame) render it. See ThumbnailWork. */
	/**
	 * Compiles every program the preview can need for `renderTarget`, in parallel where the
	 * driver allows: three only compiles visible objects, so the hidden hair accessory is
	 * shown for the (synchronous) compile call. Resolves when the programs are ready.
	 */
	const compile = (renderTarget: WebGLRenderTarget | null, view: PerspectiveCamera): Promise<unknown> => {
		const hair = avatar?.model.getObjectByName('avatar-hair-accessory');
		const shown = hair?.visible ?? false;
		if (hair) hair.visible = true;
		renderer.setRenderTarget(renderTarget);
		let done: Promise<unknown> = Promise.resolve();
		try {
			done = renderer.compileAsync?.(scene, view) ?? done;
		} finally {
			renderer.setRenderTarget(null);
			if (hair) hair.visible = shown;
		}
		return done;
	};

	/** Starts dressing the hidden avatar for `key` (async for Kenney skins); idempotent. */
	const prepare = (key: string) => {
		const request = requests.get(key);
		const model = thumb;
		if (!request || !model || !thumbShaders || job?.key === key) return;
		const current = { key, ready: false, failed: false };
		job = current;
		model.appearance.apply(request.profile).then(
			() => {
				current.ready = true;
				wake();
			},
			() => {
				current.failed = true;
				wake();
			}
		);
	};

	const work = (key: string): HTMLCanvasElement | null | undefined => {
		const request = requests.get(key);
		if (!request) return undefined;
		if (!thumb || !thumbShaders) return null;
		if (!job || job.key !== key) {
			prepare(key);
			return null;
		}
		if (job.failed) {
			job = null;
			return undefined;
		}
		if (!job.ready) return null;
		job = null;
		return renderThumbnail(request);
	};

	const loadThumbnailAvatar = () => {
		if (thumbLoading || disposed) return;
		thumbLoading = true;
		load(abort.signal, profile).then(
			(instance) => {
				if (disposed) {
					instance.dispose();
					return;
				}
				thumb = instance;
				thumbStand.add(instance.model);
				// A still idle pose: the animator's first idle frame, hair at rest.
				const pose = new AvatarAnimator({ seed: 3 }).update(1 / 60, createAvatarInput());
				applyToRig(pose, bindRig(instance.model, AVATAR_LAYOUT, BLOCKY_RIG));
				wake();
			},
			() => {
				// Thumbnails stay as placeholders; the preview keeps working, and nothing waits for them.
				thumbFailed = true;
				queue.reset();
			}
		);
	};

	// --- Frame loop -------------------------------------------------------------------
	const canRun = () => !disposed && !lost && !failed && visible && !pageHidden && avatar !== undefined;

	const stop = () => {
		if (frameId !== 0) host.cancelFrame(frameId);
		frameId = 0;
		lastTime = -1;
	};

	const needsFrames = () =>
		dirty ||
		!reduced ||
		spin.active ||
		tween.moving ||
		pending !== null ||
		settle > 0 ||
		animator.states.emoting ||
		queue.pending > 0;

	const draw = () => {
		placeCamera(tween.current, camera.aspect, placement);
		camera.position.set(placement.x, placement.y, placement.z);
		camera.lookAt(0, placement.targetY, 0);
		eye.copy(camera.position);
		renderNeutral(null, camera);
		dirty = false;
		frames++;
		if (firstFrameAt === null) {
			firstFrameAt = host.now();
			setStatus('ready');
			options.onready?.(metrics());
			loadThumbnailAvatar();
			compile(target, thumbCamera).then(
				() => {
					thumbShaders = true;
					wake();
				},
				() => {
					thumbShaders = true;
				}
			);
		}
	};

	const animate = (dt: number): boolean => {
		const model = rig;
		if (!model) return false;
		if (pending !== null) {
			if (pending === 'cheer' && animator.states.emoting && animator.states.emote !== 'cheer')
				animator.stopEmote();
			if (animator.playGesture(pending)) {
				pending = null;
				settle = SETTLE_SECONDS;
			}
		}
		if (animator.states.emoting) settle = SETTLE_SECONDS;
		const moving = !reduced || animator.states.emoting || pending !== null || settle > 0;
		if (!moving) return false;
		if (settle > 0 && !animator.states.emoting) settle = Math.max(0, settle - dt);
		input.reducedMotion = reduced;
		input.yaw = spin.yaw;
		applyToRig(animator.update(dt, input), model);
		// The turn itself swings the loose hair: it trails the spin and lifts a little.
		const rate = dt > 0 ? (spin.yaw - lastYaw) / dt : 0;
		omega += (rate - omega) * (1 - Math.exp(-10 * dt));
		lastYaw = spin.yaw;
		const fling = reduced ? 0 : Math.min(0.45, Math.max(-0.45, -omega * 0.07));
		const lift = reduced ? 0 : Math.min(0.35, omega * omega * 0.006);
		const hair = animator.hair;
		for (let i = 0; i < dangles.length; i++) {
			const dangle = dangles[i];
			if (dangle.visible) dangle.rotation.set(hair.pitch + lift, 0, hair.roll + fling, 'YXZ');
		}
		return true;
	};

	const frame = (time: number) => {
		frameId = 0;
		if (!canRun()) {
			lastTime = -1;
			return;
		}
		if (lastTime >= 0 && tier.frameMs > 0 && time - lastTime < tier.frameMs - 2) {
			frameId = host.requestFrame(frame);
			return;
		}
		const dt = lastTime >= 0 ? Math.min(0.1, Math.max(0, (time - lastTime) / 1000)) : 1 / 60;
		lastTime = time;
		let changed = spin.step(dt);
		if (tween.step(dt)) changed = true;
		if (animate(dt)) changed = true;
		turntable.rotation.y = spin.yaw;
		if (queue.pending > 0) queue.pump(work);
		if (changed || dirty) draw();
		if (!spin.active && pointerId === null && dragged) {
			dragged = false;
			options.onturn?.(degrees());
		}
		if (needsFrames()) frameId = host.requestFrame(frame);
	};

	function wake() {
		if (!canRun()) return;
		if (frameId === 0) frameId = host.requestFrame(frame);
	}

	const degrees = () => {
		const turn = Math.round((-spin.yaw * 180) / Math.PI) % 360;
		return turn < 0 ? turn + 360 : turn;
	};

	// --- Size, visibility, input, context loss -----------------------------------------
	const resize = () => {
		const width = Math.max(1, canvas.clientWidth || 1);
		const height = Math.max(1, canvas.clientHeight || 1);
		const screen = globalThis.devicePixelRatio || 1;
		dpr = Math.min(tier.dprMax, dprLimit(width, height, screen, tier.maxPixels));
		renderer.setPixelRatio(dpr);
		renderer.setSize(width, height, false);
		camera.aspect = width / height;
		camera.updateProjectionMatrix();
		dirty = true;
		wake();
	};
	resize();
	const resizeObserver = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : undefined;
	resizeObserver?.observe(canvas);
	const intersection =
		typeof IntersectionObserver !== 'undefined'
			? new IntersectionObserver((entries) => {
					const entry = entries[entries.length - 1];
					visible = entry ? entry.isIntersecting : true;
					if (visible) wake();
					else stop();
				})
			: undefined;
	intersection?.observe(canvas);
	if (typeof document !== 'undefined')
		document.addEventListener(
			'visibilitychange',
			() => {
				pageHidden = document.hidden;
				if (pageHidden) stop();
				else {
					dirty = true;
					wake();
				}
			},
			{ signal: listeners.signal }
		);

	const release = (event: PointerEvent, fling: boolean) => {
		if (event.pointerId !== pointerId) return;
		pointerId = null;
		if (fling) spin.up(event.timeStamp / 1000);
		else spin.cancel();
		dirty = true;
		wake();
	};
	canvas.addEventListener(
		'pointerdown',
		(event) => {
			if (pointerId !== null || event.button > 0) return;
			pointerId = event.pointerId;
			canvas.setPointerCapture?.(event.pointerId);
			spin.down(event.clientX, event.timeStamp / 1000);
			wake();
		},
		{ signal: listeners.signal }
	);
	canvas.addEventListener(
		'pointermove',
		(event) => {
			if (event.pointerId !== pointerId) return;
			spin.move(event.clientX, event.timeStamp / 1000);
			if (!dragged) options.ondrag?.();
			dragged = true;
			dirty = true;
			wake();
		},
		{ signal: listeners.signal }
	);
	canvas.addEventListener('pointerup', (event) => release(event, true), { signal: listeners.signal });
	canvas.addEventListener('pointercancel', (event) => release(event, false), { signal: listeners.signal });
	canvas.addEventListener('lostpointercapture', (event) => release(event, true), {
		signal: listeners.signal
	});

	const unwatch = watchContextLoss(
		canvas,
		{
			lost() {
				lost = true;
				job = null;
				stop();
				setStatus('lost');
			},
			restored() {
				if (failed || disposed) return;
				lost = false;
				// Every program is gone with the old context: compile the thumbnails' variant again, off the frame.
				if (thumbShaders) {
					thumbShaders = false;
					compile(target, thumbCamera).then(
						() => {
							thumbShaders = true;
							wake();
						},
						() => {
							thumbShaders = true;
						}
					);
				}
				queue.reset();
				if (!thumbFailed) queue.request(lastRequest.map((request) => request.key));
				dirty = true;
				setStatus(avatar ? 'ready' : 'loading');
				wake();
			},
			failed() {
				failed = true;
				stop();
				setStatus('failed');
			}
		},
		{ signal: listeners.signal }
	);

	// --- Avatar ---------------------------------------------------------------------------
	const loadStarted = host.now();
	load(abort.signal, profile)
		.then(async (instance) => {
			if (disposed) {
				instance.dispose();
				return;
			}
			avatar = instance;
			avatarMs = host.now() - loadStarted;
			turntable.add(instance.model);
			rig = bindRig(instance.model, AVATAR_LAYOUT, BLOCKY_RIG);
			dangles = findDangles(instance.model);
			animator.hairStyle = swayStyle(profile);
			applyToRig(animator.update(1 / 60, input), rig);
			if (options.profile !== profile) await instance.appearance.apply(profile);
			const compileStarted = host.now();
			placeCamera(tween.current, camera.aspect, placement);
			camera.position.set(placement.x, placement.y, placement.z);
			camera.lookAt(0, placement.targetY, 0);
			eye.copy(camera.position);
			// Parallel shader compile where the driver has it: the first frame does not block on it.
			await compile(null, camera);
			compileMs = host.now() - compileStarted;
			if (disposed) return;
			dirty = true;
			wake();
		})
		.catch(() => {
			if (disposed) return;
			failed = true;
			setStatus('failed');
		});

	function metrics(): StageMetrics {
		const info = renderer.info;
		return {
			quality,
			gpu,
			dpr,
			thumbSize,
			firstFrameMs: firstFrameAt === null ? null : firstFrameAt - openedAt,
			rendererMs,
			avatarMs,
			compileMs,
			thumbnails: { ...queue.stats(), cached: cache.size, pending: queue.pending },
			drawCalls: info.render.calls,
			triangles: info.render.triangles,
			frames
		};
	}

	return {
		get status() {
			return status;
		},
		get quality() {
			return quality;
		},
		get thumbSize() {
			return thumbSize;
		},
		get degrees() {
			return degrees();
		},
		setProfile(next) {
			profile = next;
			const instance = avatar;
			if (!instance) return Promise.resolve();
			const generation = ++profileGeneration;
			return instance.appearance.apply(next).then(() => {
				if (disposed || generation !== profileGeneration) return;
				const style = swayStyle(next);
				if (animator.hairStyle !== style) animator.hairStyle = style;
				dirty = true;
				wake();
			});
		},
		setFraming(next) {
			if (next === framing) return;
			framing = next;
			tween.set(FRAMINGS[next], reduced);
			if (!reduced) spin.face(FRAMINGS[next].yaw, false);
			dirty = true;
			wake();
		},
		setReducedMotion(next) {
			reduced = next;
			spin.inertia = !next;
			if (next) spin.velocity = 0;
			dirty = true;
			wake();
		},
		react(gesture) {
			if (gesture === 'wave' && (animator.states.emoting || pending !== null)) return;
			pending = gesture;
			wake();
		},
		turn(direction) {
			spin.turn(direction, reduced);
			dirty = true;
			if (reduced) options.onturn?.(degrees());
			else dragged = true;
			wake();
		},
		requestThumbnails(next) {
			requests.clear();
			for (const request of next) requests.set(request.key, request);
			lastRequest = next;
			if (!thumbFailed) queue.request(next.map((request) => request.key));
			wake();
		},
		thumbnail(key) {
			return cache.peek(key);
		},
		metrics,
		dispose() {
			if (report) return report;
			disposed = true;
			stop();
			abort.abort();
			listeners.abort();
			unwatch();
			resizeObserver?.disconnect();
			intersection?.disconnect();
			avatar?.dispose();
			thumb?.dispose();
			avatar = thumb = undefined;
			floor.dispose();
			target.dispose();
			sun.dispose();
			hemisphere.dispose();
			scene.clear();
			const info = renderer.info;
			report = {
				geometries: info.memory.geometries,
				textures: info.memory.textures,
				programs: info.programs?.length ?? 0
			};
			renderer.dispose();
			renderer.forceContextLoss();
			return report;
		}
	};
}
