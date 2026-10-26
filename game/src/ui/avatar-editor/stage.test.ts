/**
 * The stage's lifecycle without a GPU: a fake renderer that counts the
 * geometries, materials and textures it "uploads" and forgets them on their
 * dispose events (as three.js's info.memory does), a fake avatar loader and a
 * manual frame clock.
 */
import {
	BoxGeometry,
	type BufferGeometry,
	CanvasTexture,
	type EventDispatcher,
	Group,
	type Material,
	Mesh,
	MeshLambertMaterial,
	type Object3D,
	type Texture,
	type WebGLRenderer,
	type WebGLRenderTarget
} from 'three';
import { describe, expect, it, vi } from 'vitest';
import { BLOCKY_RIG } from '../../animation/joints.ts';
import { DEFAULT_AVATAR } from '../../avatar/catalog.ts';
import type { AvatarProfile } from '../../data/local-save.ts';
import type { AvatarInstance } from '../../scene/avatar.ts';
import { THUMB_BACK_YAW, THUMB_FRAMINGS } from './framing.ts';
import { createAvatarStage, type StageOptions } from './stage.ts';
import { ThumbnailCache } from './thumbnails.ts';

type Disposable = EventDispatcher<{ dispose: object }>;

function fakeRenderer() {
	const live = { geometries: new Set<unknown>(), textures: new Set<unknown>(), programs: new Set<unknown>() };
	const track = (set: Set<unknown>, item: Disposable) => {
		if (set.has(item)) return;
		set.add(item);
		const forget = () => {
			set.delete(item);
			item.removeEventListener('dispose', forget);
		};
		item.addEventListener('dispose', forget);
	};
	const calls = { render: 0, toTarget: 0, read: 0, disposed: false, lost: false, thumbYaws: [] as number[] };
	let target: WebGLRenderTarget | null = null;
	const info = {
		memory: {
			get geometries() {
				return live.geometries.size;
			},
			get textures() {
				return live.textures.size;
			}
		},
		get programs() {
			return [...live.programs];
		},
		render: { calls: 0, triangles: 0 }
	};
	const renderer = {
		info,
		shadowMap: { enabled: true },
		outputColorSpace: '',
		toneMapping: 0,
		getContext: () => ({}),
		setClearColor() {},
		setPixelRatio() {},
		setSize() {},
		setRenderTarget(next: WebGLRenderTarget | null) {
			target = next;
			if (next) track(live.textures, next as unknown as Disposable);
		},
		render(scene: Object3D) {
			calls.render++;
			if (target) {
				calls.toTarget++;
				const stand = scene.getObjectByName('avatar-editor-thumb-stand');
				if (stand) calls.thumbYaws.push(stand.rotation.y);
			}
			scene.traverseVisible((object) => {
				if (!(object instanceof Mesh)) return;
				track(live.geometries, object.geometry as BufferGeometry);
				const material = object.material as Material & { map?: Texture | null };
				track(live.programs, material);
				if (material.map) track(live.textures, material.map);
			});
		},
		readRenderTargetPixels(_t: unknown, _x: number, _y: number, _w: number, _h: number, buffer: Uint8Array) {
			calls.read++;
			buffer.fill(200);
		},
		compileAsync: async () => {},
		dispose() {
			calls.disposed = true;
		},
		forceContextLoss() {
			calls.lost = true;
		}
	};
	return { renderer: renderer as unknown as WebGLRenderer, calls, live };
}

/** A blocky stand-in: the rig's named nodes and one textured box per part. */
function fakeAvatar(): AvatarInstance & { applied: AvatarProfile[]; disposed: boolean } {
	const model = new Group();
	const texture = new CanvasTexture({ width: 64, height: 64 } as unknown as HTMLCanvasElement);
	const material = new MeshLambertMaterial({ map: texture });
	for (const name of Object.values(BLOCKY_RIG.nodes)) {
		const node = name === 'root' ? new Group() : new Mesh(new BoxGeometry(), material);
		node.name = name;
		model.add(node);
	}
	const applied: AvatarProfile[] = [];
	const instance = {
		model,
		applied,
		disposed: false,
		appearance: {
			texture,
			dispose: () => texture.dispose(),
			apply: async (profile: AvatarProfile) => {
				applied.push(profile);
				return true;
			}
		},
		dispose() {
			instance.disposed = true;
			model.traverse((object) => {
				if (object instanceof Mesh) object.geometry.dispose();
			});
			material.dispose();
			texture.dispose();
			model.removeFromParent();
		}
	};
	return instance;
}

function fakeCanvas() {
	return Object.assign(new EventTarget(), {
		clientWidth: 320,
		clientHeight: 330,
		setPointerCapture() {}
	}) as unknown as HTMLCanvasElement;
}

function pointer(type: string, x: number, seconds: number) {
	const event = new Event(type);
	Object.defineProperties(event, {
		pointerId: { value: 1 },
		button: { value: 0 },
		clientX: { value: x },
		timeStamp: { value: seconds * 1000 }
	});
	return event;
}

async function setup(overrides: Partial<StageOptions> = {}) {
	const { renderer, calls, live } = fakeRenderer();
	const avatars: ReturnType<typeof fakeAvatar>[] = [];
	const callbacks = new Map<number, (time: number) => void>();
	let next = 1;
	let time = 0;
	const onready = vi.fn();
	const onthumbnail = vi.fn();
	const onstatus = vi.fn();
	const canvas = fakeCanvas();
	const stage = createAvatarStage({
		canvas,
		profile: DEFAULT_AVATAR,
		quality: 'medium',
		openedAt: 0,
		createRenderer: () => renderer,
		loadAvatar: async () => {
			const avatar = fakeAvatar();
			avatars.push(avatar);
			return avatar;
		},
		cache: new ThumbnailCache<HTMLCanvasElement>(),
		onready,
		onthumbnail,
		onstatus,
		host: {
			now: () => time,
			requestFrame(callback) {
				callbacks.set(next, callback);
				return next++;
			},
			cancelFrame(id) {
				callbacks.delete(id);
			},
			paint: (_pixels, size) => ({ width: size, height: size }) as HTMLCanvasElement
		},
		...overrides
	});
	const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
	/** Runs the queued animation frames `count` times, letting promises settle in between. */
	const tick = async (count = 1, ms = 16) => {
		for (let i = 0; i < count; i++) {
			await flush();
			time += ms;
			const due = [...callbacks.values()];
			callbacks.clear();
			for (const callback of due) callback(time);
		}
		await flush();
	};
	return {
		stage,
		calls,
		live,
		avatars,
		tick,
		onready,
		onthumbnail,
		onstatus,
		canvas,
		scheduled: () => callbacks.size
	};
}

describe('AvatarStage', () => {
	it('loads its own avatar, compiles and draws the first frame, reporting the open time', async () => {
		const { stage, calls, avatars, tick, onready, onstatus } = await setup();
		expect(stage.status).toBe('loading');
		await tick(2);
		expect(avatars).toHaveLength(2); // the preview avatar, then the hidden thumbnail one
		expect(calls.render).toBeGreaterThan(0);
		expect(stage.status).toBe('ready');
		expect(onstatus).toHaveBeenCalledWith('ready');
		expect(onready).toHaveBeenCalledTimes(1);
		expect(onready.mock.calls[0][0].firstFrameMs).toBeGreaterThan(0);
		expect(stage.metrics().thumbSize).toBe(128);
		stage.dispose();
	});

	it('applies draft changes to its own avatar only', async () => {
		const { stage, avatars, tick } = await setup();
		await tick(2);
		const next: AvatarProfile = { ...DEFAULT_AVATAR, style: 'kenney', kenneySkin: 'f' };
		await stage.setProfile(next);
		expect(avatars[0].applied.at(-1)).toBe(next);
		stage.dispose();
	});

	it('renders requested thumbnails into the target, reads them back and caches them', async () => {
		const { stage, calls, avatars, tick, onthumbnail } = await setup();
		await tick(2);
		const profiles = ['a', 'b', 'c'].map(
			(skin): AvatarProfile => ({ ...DEFAULT_AVATAR, style: 'kenney', kenneySkin: skin })
		);
		stage.requestThumbnails(profiles.map((profile, i) => ({ key: `k${i}`, profile, framing: 'body' })));
		await tick(12);
		expect(onthumbnail.mock.calls.map((call) => call[0])).toEqual(['k0', 'k1', 'k2']);
		expect(calls.read).toBe(3);
		expect(calls.toTarget).toBe(3);
		expect(avatars[1].applied.slice(-3)).toEqual(profiles);
		expect(stage.thumbnail('k1')).toMatchObject({ width: 128 });
		expect(stage.metrics().thumbnails).toMatchObject({ count: 3, cached: 3, pending: 0 });
		// The preview avatar never wore the thumbnails' looks.
		expect(avatars[0].applied).not.toContain(profiles[0]);
		stage.dispose();
	});

	it('turns the thumbnail avatar 135° for back views, and keeps the front pose otherwise', async () => {
		const { stage, calls, tick } = await setup();
		await tick(2);
		const rabo: AvatarProfile = { ...DEFAULT_AVATAR, style: 'classic', hairStyle: 'rabo' };
		stage.requestThumbnails([
			{ key: 'front', profile: DEFAULT_AVATAR, framing: 'head' },
			{ key: 'back', profile: rabo, framing: 'head', view: 'back' }
		]);
		await tick(8);
		expect(calls.thumbYaws).toHaveLength(2);
		expect(calls.thumbYaws[0]).toBeCloseTo(THUMB_FRAMINGS.head.yaw);
		expect(calls.thumbYaws[1]).toBeCloseTo((-135 * Math.PI) / 180);
		expect(THUMB_BACK_YAW).toBeCloseTo((-135 * Math.PI) / 180);
		stage.dispose();
	});

	it('keeps drawing for the idle, but with reduced motion only while something changes', async () => {
		const normal = await setup();
		await normal.tick(6);
		const before = normal.calls.render;
		await normal.tick(5);
		expect(normal.calls.render - before).toBe(5);
		normal.stage.dispose();

		const reduced = await setup({ reducedMotion: true });
		await reduced.tick(30);
		const idle = reduced.calls.render;
		await reduced.tick(5);
		expect(reduced.calls.render).toBe(idle);
		expect(reduced.scheduled()).toBe(0);
		reduced.stage.react('cheer');
		await reduced.tick(5);
		expect(reduced.calls.render).toBe(idle + 5);
		reduced.stage.turn(1);
		await reduced.tick(1);
		expect(reduced.stage.degrees).not.toBe(0);
		reduced.stage.dispose();
	});

	it('turns with a drag and reports where it came to rest', async () => {
		const onturn = vi.fn();
		const { stage, canvas, tick } = await setup({ onturn });
		await tick(2);
		const start = stage.degrees;
		canvas.dispatchEvent(pointer('pointerdown', 0, 1));
		canvas.dispatchEvent(pointer('pointermove', 60, 1.05));
		canvas.dispatchEvent(pointer('pointermove', 120, 1.1));
		canvas.dispatchEvent(pointer('pointerup', 120, 1.1));
		await tick(400);
		expect(stage.degrees).not.toBe(start);
		expect(onturn).toHaveBeenCalledTimes(1);
		expect(onturn).toHaveBeenCalledWith(stage.degrees);
		stage.dispose();
	});

	it('pauses on context loss and resumes on restore', async () => {
		const { stage, calls, canvas, tick, onstatus } = await setup();
		await tick(3);
		canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
		expect(stage.status).toBe('lost');
		const frozen = calls.render;
		await tick(5);
		expect(calls.render).toBe(frozen);
		canvas.dispatchEvent(new Event('webglcontextrestored'));
		await tick(2);
		expect(stage.status).toBe('ready');
		expect(calls.render).toBeGreaterThan(frozen);
		canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
		expect(onstatus).toHaveBeenLastCalledWith('failed');
		stage.dispose();
	});

	it('disposes every geometry, material and texture it uploaded, then the context', async () => {
		const { stage, calls, live, avatars, tick } = await setup();
		await tick(2);
		stage.requestThumbnails([{ key: 'x', profile: DEFAULT_AVATAR, framing: 'head' }]);
		await tick(6);
		expect(live.geometries.size).toBeGreaterThan(2);
		expect(live.textures.size).toBeGreaterThan(1);
		const report = stage.dispose();
		expect(report).toEqual({ geometries: 0, textures: 0, programs: 0 });
		expect(avatars.every((avatar) => avatar.disposed)).toBe(true);
		expect(calls.disposed).toBe(true);
		expect(calls.lost).toBe(true);
		// Idempotent, and nothing runs afterwards.
		expect(stage.dispose()).toBe(report);
		const after = calls.render;
		await tick(3);
		expect(calls.render).toBe(after);
	});

	it('disposes an avatar that finishes loading after the editor closed', async () => {
		let resolve: ((value: AvatarInstance) => void) | undefined;
		const late = fakeAvatar();
		const { stage, tick } = await setup({
			loadAvatar: () =>
				new Promise<AvatarInstance>((done) => {
					resolve = done;
				})
		});
		stage.dispose();
		resolve?.(late);
		await tick(1);
		expect(late.disposed).toBe(true);
	});
});
