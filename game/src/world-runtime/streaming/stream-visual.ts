/** Scene-side ownership of the stream. The same native model bank and P32 material factories are reused. */
import { type Box3, Group, PerspectiveCamera, type Ray } from 'three';
import type { ExtendedTriangle } from 'three-mesh-bvh';
import type { AvatarInput } from '../../animation/avatar-animator.ts';
import type { Checkpoint } from '../../engine/checkpoints.ts';
import type { CollisionQuery } from '../../engine/world.ts';
import type { StoryLevel } from '../../level/types.ts';
import type { ZoneId } from '../../level/zones/spec.ts';
import type { Quality } from '../../render/index.ts';
import { PoolSet } from '../../render/index.ts';
import type { SurvivalWorld } from '../../survival/types.ts';
import { AvatarGroundContext } from '../avatar-context.ts';
import { type PropProxy, prefabProxies } from '../collision.ts';
import { loadWorldPlacements } from '../placements.ts';
import { createMapVisual } from '../visual.ts';
import { createParkBoundary } from './boundary.ts';
import { lightAt } from './navigation.ts';
import { createStreamingRuntime, type StreamingRuntime } from './runtime.ts';
import { ChunkPlacements, ToroidalBlockGrid } from './slots.ts';
import type { StreamChunk } from './types.ts';

export interface StreamSceneOptions {
	world: SurvivalWorld;
	level?: StoryLevel;
	pads: readonly Checkpoint[];
	zone?: ZoneId | null;
	offsetX?: number;
	offsetZ?: number;
	fixture?: boolean;
}

export function createStreamScene(options: StreamSceneOptions) {
	const { world, level, zone } = options;
	const x0 = options.offsetX ?? 0,
		z0 = options.offsetZ ?? 0;
	const grid = new ToroidalBlockGrid(9);
	const baseVisual = createMapVisual(world, level, options.pads, true, { streaming: true });
	baseVisual.object.position.set(x0, 0, z0);
	const object = new Group();
	object.add(baseVisual.object);
	const localCamera = new PerspectiveCamera(),
		localTarget = { x: 0, z: 0 };
	const visual = {
		...baseVisual,
		object,
		update(x: number, y: number, z: number, target: { x: number; z: number }) {
			localTarget.x = target.x - x0;
			localTarget.z = target.z - z0;
			baseVisual.update(x - x0, y, z - z0, localTarget);
		},
		dispose() {
			baseVisual.dispose();
			object.removeFromParent();
			object.clear();
		}
	};
	const query =
		typeof location === 'undefined' ? new URLSearchParams() : new URLSearchParams(location.search);
	const boundary = zone ? null : createParkBoundary(level, query.has('debug') && query.has('streamStress'));
	const reserveProps = prefabProxies(world, level);
	const propCache = new WeakMap<StreamChunk, PropProxy[]>();
	let runtime: StreamingRuntime | null = null,
		disposed = false;
	let focusX = world.base.spawn.x + x0,
		focusZ = world.base.spawn.z + z0;
	let lastX = NaN,
		lastZ = NaN;
	const collision: CollisionQuery & { dispose(): void } = {
		shapecast(bounds: Box3, visit: (t: ExtendedTriangle) => void) {
			runtime?.collision.shapecast(bounds, visit);
			boundary?.shapecast(bounds, visit);
		},
		raycast(ray: Ray, far: number) {
			let nearest = runtime?.collision.raycast(ray, far) ?? null;
			const hit = boundary?.raycast(ray, nearest ?? far) ?? null;
			if (hit !== null && (nearest === null || hit < nearest)) nearest = hit;
			return nearest;
		},
		dispose() {
			if (disposed) return;
			disposed = true;
			runtime?.dispose();
			boundary?.dispose();
		}
	};
	const props = (chunk: StreamChunk) => {
		const cached = propCache.get(chunk);
		if (cached) return cached;
		const list =
			chunk.zone === 'reserva'
				? reserveProps
				: (chunk.story?.level.landmarks
						.filter(
							(l) =>
								![
									'waterfall',
									'bridge',
									'mirante',
									'butterflies',
									'jequitiba',
									'ipe-amarelo',
									'spring'
								].includes(l.kind)
						)
						.map((l) => ({
							name: l.id,
							x: l.x + (chunk.story?.offsetX ?? 0),
							y: l.y,
							z: l.z + (chunk.story?.offsetZ ?? 0),
							sx: l.kind === 'tower' ? 3 : 0.8,
							sy: l.height,
							sz: l.kind === 'tower' ? 3 : 0.8
						})) ?? []);
		const result = list.filter(
			(p) => p.x >= chunk.x0 && p.x < chunk.x0 + 40 && p.z >= chunk.z0 && p.z < chunk.z0 + 40
		);
		propCache.set(chunk, result);
		return result;
	};
	const stream = {
		get runtime() {
			return runtime;
		},
		get ready() {
			return runtime?.ready ?? false;
		},
		light(time: number) {
			return lightAt(time, query.get('time'));
		},
		relocate(position?: { x: number; z: number }) {
			if (position) {
				focusX = position.x;
				focusZ = position.z;
				lastX = focusX;
				lastZ = focusZ;
			}
			runtime?.relocate();
		},
		update(position: { x: number; z: number }, yaw: number) {
			focusX = position.x;
			focusZ = position.z;
			if ((focusX - lastX) ** 2 + (focusZ - lastZ) ** 2 > 400) runtime?.relocate();
			lastX = focusX;
			lastZ = focusZ;
			return runtime?.update(focusX, focusZ, Math.sin(yaw), Math.cos(yaw)) ?? false;
		},
		water(x: number, z: number) {
			return runtime?.water(x, z) ?? null;
		},
		debug() {
			return runtime
				? {
						...runtime.ring.stats,
						ready: runtime.ready,
						maxStepMs: Array.from(runtime.ring.stats.maxStepMs),
						worker: { ...runtime.stream.stats },
						generator: runtime.generator
							? { ...runtime.generator.stats, bytes: runtime.generator.cache.bytes }
							: null,
						farChunks: runtime.far?.size ?? 0,
						instances: runtime.ring.placements?.live ?? 0,
						dropped: runtime.ring.placements?.dropped ?? 0
					}
				: null;
		}
	};
	async function loadPlacements(quality: Quality, signal: AbortSignal) {
		const loaded = options.fixture
			? {
					pools: new PoolSet([], []),
					dispose() {
						this.pools.dispose();
					}
				}
			: await loadWorldPlacements(grid, quality, world, signal, level?.trails, level, {
					radius: quality === 'high' ? 3 : 2
				});
		if (signal.aborted || disposed) {
			loaded.dispose();
			signal.throwIfAborted();
			throw new Error('stream-disposed');
		}
		const bank = 'stream' in loaded ? loaded.stream : undefined;
		const sink = bank ? new ChunkPlacements(grid, bank.route) : null;
		runtime = createStreamingRuntime({
			zone,
			quality,
			ground: visual.streamMaterials.ground,
			water: visual.streamMaterials.water,
			path: visual.streamMaterials.path,
			placements: sink,
			props
		});
		const ownedRuntime = runtime;
		ownedRuntime.ring.onRender = (chunk) => bank?.mountScenery(chunk);
		visual.object.add(ownedRuntime.ring.object);
		try {
			await new Promise<void>((resolve, reject) => {
				let frame = 0;
				const deadline = performance.now() + 30_000;
				const cancel = () => {
					cancelAnimationFrame(frame);
					signal.removeEventListener('abort', cancel);
					reject(new DOMException('Aborted', 'AbortError'));
				};
				const tick = () => {
					if (signal.aborted || disposed) {
						cancel();
						return;
					}
					if (ownedRuntime.update(focusX, focusZ)) {
						signal.removeEventListener('abort', cancel);
						resolve();
						return;
					}
					if (performance.now() > deadline || ownedRuntime.ring.stats.failed) {
						signal.removeEventListener('abort', cancel);
						reject(new Error('stream-initial-load-failed'));
						return;
					}
					frame = requestAnimationFrame(tick);
				};
				signal.addEventListener('abort', cancel, { once: true });
				tick();
			});
		} catch (error) {
			ownedRuntime.dispose();
			loaded.dispose();
			throw error;
		}
		let released = false;
		return {
			...loaded,
			dispose() {
				if (released) return;
				released = true;
				ownedRuntime.dispose();
				loaded.dispose();
			}
		};
	}
	const ground = new AvatarGroundContext(collision, world, level);
	const avatarGround = {
		update(input: AvatarInput, character: Parameters<AvatarGroundContext['update']>[1]) {
			ground.update(input, character);
			if (!character.grounded) return;
			const p = character.position,
				water = runtime?.water(p.x, p.z);
			if (water !== undefined && water !== null && water - p.y > 0.01 && water - p.y <= 0.65)
				input.surface = 'water';
		}
	};
	const prepare = visual.prepareFrame.bind(visual);
	visual.prepareFrame = (camera, time, quality, night) => {
		localCamera.position.copy(camera.position);
		localCamera.position.x -= x0;
		localCamera.position.z -= z0;
		prepare(localCamera, time, quality, night);
		runtime?.ring.updateWaterfalls(camera);
	};
	return { grid, visual, stream, collision, loadPlacements, avatarGround };
}
