/**
 * The 3D engine: one WebGL2 renderer and one canvas for the whole page
 * (see host.svelte.ts). Lives in its own lazily loaded chunk with three.js.
 *
 * Renders on demand only: a frame is drawn when something changes (stage,
 * theme, size) and the rAF loop runs only while the world is moving. Idle
 * means zero frames. The loop also stops when the page is hidden or the
 * diorama is scrolled off-screen.
 */
import { MathUtils, NoToneMapping, PerspectiveCamera, Vector2, Vector3, WebGLRenderer } from 'three';
import { softwareGpu, weakGpu } from '../tier.ts';
import { readPalette } from './palette.ts';
import { type Quality, type View, World } from './world.ts';

export type { View } from './world.ts';
export type FailReason = 'slow' | 'lost';

export interface Engine {
	readonly quality: Quality;
	/**
	 * Moves the canvas into `host` and shows `view`. A fresh world starts
	 * from `from` (what the class saw last) so new stages grow in.
	 */
	attach(
		host: HTMLElement,
		view: View,
		from: { stage: number; oath: boolean } | null,
		onReady: () => void
	): void;
	detach(host: HTMLElement): void;
	update(view: View): void;
	/** A tap: pauses running motion, otherwise replays the celebration. */
	poke(reducedMotion: boolean): void;
	/** Diagnostics: last frame's draw calls and triangles, frames rendered so far. */
	stats(): {
		quality: Quality;
		calls: number;
		triangles: number;
		frames: number;
		pixelRatio: number;
		gpu: string;
	};
	dispose(): void;
}

const FOV = 28;
const ELEVATION = MathUtils.degToRad(19);
const TARGET = new Vector3(0, 0.62, 0);
/** Half the scene's width and height that must stay in frame. */
const HALF_WIDTH = 5.3;
const HALF_HEIGHT = 2.55;

/** Frames slower than this count against the device (about 20 fps). */
const SLOW_FRAME_MS = 50;

export async function createEngine(opts: {
	tier: Quality;
	onFail: (reason: FailReason) => void;
}): Promise<Engine> {
	const canvas = document.createElement('canvas');
	canvas.setAttribute('aria-hidden', 'true');
	canvas.style.cssText =
		'position:absolute;inset:0;width:100%;height:100%;display:block;touch-action:manipulation';

	const attributes: WebGLContextAttributes = {
		antialias: opts.tier === 'full',
		alpha: true,
		powerPreference: 'low-power',
		stencil: false
	};
	// Probe before Three.js logs errors or builds geometry on software renderers.
	const gl = canvas.getContext('webgl2', attributes);
	if (!gl) throw new Error('WebGL2 unavailable');
	const debug = gl.getExtension('WEBGL_debug_renderer_info');
	const gpu = String(gl.getParameter(debug ? debug.UNMASKED_RENDERER_WEBGL : gl.RENDERER) ?? '');
	if (softwareGpu(gpu)) {
		gl.getExtension('WEBGL_lose_context')?.loseContext();
		throw new Error('Software WebGL is too slow');
	}
	const renderer = new WebGLRenderer({ canvas, context: gl, ...attributes });
	renderer.setClearColor(0x000000, 0);
	renderer.toneMapping = NoToneMapping;
	renderer.info.autoReset = true;

	const quality: Quality = opts.tier === 'full' && !weakGpu(gpu) ? 'full' : 'lite';

	let palette = readPalette(document.documentElement);
	const world = new World(quality, palette);
	const camera = new PerspectiveCamera(FOV, 2, 0.5, 40);
	let distance = 11;

	// Compile every shader now (in parallel where supported), not mid-animation.
	world.showAll();
	placeCamera();
	if (renderer.extensions.has('KHR_parallel_shader_compile'))
		await renderer.compileAsync(world.scene, camera);
	else renderer.compile(world.scene, camera);
	world.apply();

	let host: HTMLElement | null = null;
	let started = false;
	let dead = false;
	let raf = 0;
	let last = 0;
	let onscreen = true;
	let readyCallback: (() => void) | null = null;
	const probe = { skip: 0, frames: 0, slow: 0 };
	const size = new Vector2();

	function placeCamera() {
		const s = world.sway();
		const az = s.azimuth;
		const el = ELEVATION + s.lift;
		camera.position.set(
			TARGET.x + distance * Math.sin(az) * Math.cos(el),
			TARGET.y + distance * Math.sin(el),
			TARGET.z + distance * Math.cos(az) * Math.cos(el)
		);
		camera.lookAt(TARGET);
		world.faceCamera(camera);
	}

	function resize(w: number, h: number) {
		if (w < 2 || h < 2) return;
		// Pixel budget: sharp on small phone cards, bounded on tablets.
		const cap = quality === 'full' ? 2 : 1;
		const budget = quality === 'full' ? 1.1e6 : 0.42e6;
		const dpr = Math.max(0.75, Math.min(window.devicePixelRatio || 1, cap, Math.sqrt(budget / (w * h))));
		renderer.setPixelRatio(dpr);
		renderer.setSize(w, h, false);
		camera.aspect = w / h;
		const vHalf = Math.tan(MathUtils.degToRad(FOV / 2));
		distance = Math.max(HALF_WIDTH / (vHalf * camera.aspect), HALF_HEIGHT / vHalf, 8);
		camera.updateProjectionMatrix();
		renderer.getDrawingBufferSize(size);
		world.setPointScale(size.y / (2 * vHalf));
		kick();
	}

	function frame(now: number) {
		raf = 0;
		if (dead || !host) return;
		const raw = last ? now - last : 16.7;
		const dt = Math.min(0.1, raw / 1000);
		last = now;
		const busy = world.step(dt);
		placeCamera();
		renderer.render(world.scene, camera);
		if (readyCallback) {
			readyCallback();
			readyCallback = null;
		}
		if (busy && watch(raw)) return;
		if (busy && onscreen && !document.hidden) raf = requestAnimationFrame(frame);
		else last = 0;
	}

	/** Slow-frame probe: sustained slowness while animating demotes the tier. */
	function watch(raw: number): boolean {
		if (probe.skip > 0) {
			probe.skip--;
			return false;
		}
		probe.frames++;
		if (raw > SLOW_FRAME_MS) probe.slow++;
		if (probe.frames >= 45) {
			const tooSlow = probe.slow >= 30;
			probe.frames = probe.slow = 0;
			if (tooSlow) {
				opts.onFail('slow');
				return true;
			}
		}
		return false;
	}

	function kick() {
		if (dead || !host || raf) return;
		if (!last) probe.skip = 6; // first frames after a pause include uploads
		raf = requestAnimationFrame(frame);
	}

	const resizeObserver = new ResizeObserver(([entry]) => {
		const { width, height } = entry.contentRect;
		resize(width, height);
	});
	const intersection = new IntersectionObserver(([entry]) => {
		onscreen = entry.isIntersecting;
		if (onscreen) kick();
	});
	const onVisibility = () => {
		if (document.hidden) {
			cancelAnimationFrame(raf);
			raf = 0;
			last = 0;
		} else kick();
	};
	document.addEventListener('visibilitychange', onVisibility);

	// Theme switch (Mata / Sol): repaint once.
	const themeObserver = new MutationObserver(() => {
		palette = readPalette(host ?? document.documentElement);
		world.recolor(palette);
		kick();
	});
	themeObserver.observe(document.documentElement, {
		attributes: true,
		attributeFilter: ['data-theme', 'class', 'style']
	});

	const onLost = (e: Event) => {
		e.preventDefault();
		if (dead) return;
		dead = true;
		cancelAnimationFrame(raf);
		opts.onFail('lost');
	};
	canvas.addEventListener('webglcontextlost', onLost);

	const engine: Engine = {
		quality,

		attach(el, view, from, onReady) {
			if (dead) return;
			if (host && host !== el) engine.detach(host);
			host = el;
			el.appendChild(canvas);
			resizeObserver.observe(el);
			intersection.observe(el);
			palette = readPalette(el);
			world.recolor(palette);
			if (!started) {
				started = true;
				const start = from && from.stage <= view.stage ? from : view;
				world.snap(start.stage, start.oath && view.oath);
			}
			world.setTarget(view);
			readyCallback = onReady;
			const rect = el.getBoundingClientRect();
			resize(rect.width, rect.height);
			kick();
		},

		detach(el) {
			if (host !== el) return;
			cancelAnimationFrame(raf);
			raf = 0;
			last = 0;
			resizeObserver.unobserve(el);
			intersection.unobserve(el);
			canvas.remove();
			host = null;
			readyCallback = null;
		},

		update(view) {
			world.setTarget(view);
			kick();
		},

		poke(reducedMotion) {
			if (reducedMotion) return;
			if (world.moving) world.stop();
			else if (world.oath) world.celebrate(10, 0.12);
			else world.celebrate(4, 0.07);
			kick();
		},

		stats() {
			return {
				quality,
				calls: renderer.info.render.calls,
				triangles: renderer.info.render.triangles,
				frames: renderer.info.render.frame,
				pixelRatio: renderer.getPixelRatio(),
				gpu
			};
		},

		dispose() {
			dead = true;
			cancelAnimationFrame(raf);
			resizeObserver.disconnect();
			intersection.disconnect();
			themeObserver.disconnect();
			document.removeEventListener('visibilitychange', onVisibility);
			canvas.removeEventListener('webglcontextlost', onLost);
			world.dispose();
			renderer.dispose();
			// Free the context now instead of waiting for garbage collection.
			if (!gl.isContextLost()) renderer.forceContextLoss();
			canvas.remove();
			host = null;
		}
	};
	return engine;
}
