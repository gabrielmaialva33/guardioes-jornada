import { Group } from 'three';
import type { createLocalSave } from '../data/local-save.ts';
import type { Checkpoint } from '../engine/checkpoints.ts';
import type { StoryLevel } from '../level/types.ts';
import type { ZoneId } from '../level/zones/spec.ts';
import { createLivingWorld } from '../life/index.ts';
import { loadParkProps } from '../mechanics/park-props.ts';
import { ParkRuntime } from '../mechanics/park-runtime.ts';
import { loadStoryProps } from '../missions/props.ts';
import type { StoryGame } from '../missions/story.ts';
import { BlockGrid, PoolSet } from '../render/index.ts';
import { loadModel } from '../scene/avatar.ts';
import type { SceneEnvironment } from '../scene/environment.ts';
import { testing } from '../scene/testing.ts';
import { heightAt } from '../survival/terrain.ts';
import type { SurvivalWorld } from '../survival/types.ts';
import { AvatarGroundContext } from './avatar-context.ts';
import { buildMapCollision, prefabProxies } from './collision.ts';
import { MapCheckpoints, riverSurfaceAt } from './navigation.ts';
import { loadWorldPlacements, withoutPlacement } from './placements.ts';
import { createStreamScene } from './streaming/stream-visual.ts';
import { loadZoneMap, type ZoneMap, zoneSpawn } from './streaming/zone-loader.ts';
import { createMapVisual } from './visual.ts';

export function createMapEnvironment(
	world: SurvivalWorld,
	level: StoryLevel | undefined,
	save: ReturnType<typeof createLocalSave>,
	story?: StoryGame,
	options: { streaming?: boolean; zone?: ZoneId | null; zoneMap?: ZoneMap | null } = {}
) {
	level = story?.level ?? level;
	const localStart = level?.start ??
		options.zoneMap?.level.start ?? {
			id: 'start',
			spawn: world.base.spawn,
			yaw: Math.atan2(world.base.yawS, world.base.yawC),
			min: { x: world.base.spawn.x - 2, y: world.base.spawn.y - 0.3, z: world.base.spawn.z - 2 },
			max: { x: world.base.spawn.x + 2, y: world.base.spawn.y + 3, z: world.base.spawn.z + 2 }
		};
	const localCheckpoints =
		level?.checkpoints ??
		options.zoneMap?.level.checkpoints ??
		world.pois.map((p) => ({
			id: `poi-${p.id}`,
			spawn: { x: p.x, y: p.y, z: p.z },
			yaw: Math.atan2(p.yawS, p.yawC),
			min: { x: p.x - 2, y: p.y - 0.3, z: p.z - 2 },
			max: { x: p.x + 2, y: p.y + 3, z: p.z + 2 }
		}));
	const ox = options.zoneMap?.offsetX ?? 0,
		oz = options.zoneMap?.offsetZ ?? 0;
	const shift = (c: Checkpoint): Checkpoint =>
		ox || oz
			? {
					...c,
					spawn: { ...c.spawn, x: c.spawn.x + ox, z: c.spawn.z + oz },
					min: { ...c.min, x: c.min.x + ox, z: c.min.z + oz },
					max: { ...c.max, x: c.max.x + ox, z: c.max.z + oz }
				}
			: c;
	const start = shift(localStart),
		checkpoints = localCheckpoints.map(shift);
	const mapKey = `${options.zoneMap ? `zone:${options.zoneMap.id}` : level ? 'story' : 'survival'}:${world.generatorVersion}:${world.checksum}`;
	const tracker = new MapCheckpoints(
		world,
		start,
		checkpoints,
		level?.killY ?? -20,
		level?.pool,
		(c) => save.setCheckpoint(mapKey, c.id),
		options.streaming ? (x, z) => streamScene?.stream.water(x, z) ?? null : undefined
	);
	const stored = save.checkpoint(mapKey);
	const saved = level && stored === 'mirante' ? 'mirante-topo' : stored;
	const checkpoint = [start, ...checkpoints].find((c) => c.id === saved) ?? start;
	tracker.current = checkpoint;
	const targets =
		level?.missions.map((m) => ({ ...m.target, name: m.name })) ??
		world.pois.map((p, i) => ({ ...p, name: `Explore o ponto ${i + 1}` }));
	let targetIndex = 0;
	const observed = level?.landmarks.find((l) => l.kind === 'observation-rock');
	const replacedRock =
		story && observed
			? Array.from({ length: world.rocks.count }, (_, i) => i).find(
					(i) => Math.hypot(world.rocks.x[i] - observed.x, world.rocks.z[i] - observed.z) < 0.1
				)
			: undefined;
	const renderWorld =
		replacedRock === undefined ? world : { ...world, rocks: withoutPlacement(world.rocks, replacedRock) };
	const streamScene = options.streaming
		? createStreamScene({
				world: renderWorld,
				level,
				pads: [localStart, ...localCheckpoints],
				zone: options.zone,
				offsetX: ox,
				offsetZ: oz,
				fixture: testing
			})
		: null;
	const grid = streamScene?.grid ?? BlockGrid.covering(0, 0, world.size, world.size);
	const baseCollision = streamScene?.collision ?? buildMapCollision(world, prefabProxies(world, level));
	const park = level?.act1 && story ? new ParkRuntime(level, world, story, baseCollision) : undefined;
	const collision = park?.collision ?? baseCollision;
	const environment: SceneEnvironment = {
		kind: 'map',
		streaming: streamScene?.stream,
		park,
		avatarGround: streamScene
			? {
					update(input, character) {
						streamScene.avatarGround.update(input, character);
					}
				}
			: new AvatarGroundContext(collision, world, level),
		loadLife: testing
			? undefined
			: (quality, signal, blobs, onHowl) =>
					createLivingWorld({ world, level, quality, signal, blobs, onHowl, loadGlb: loadModel }),
		story,
		loadStoryAssets:
			level && story
				? async (signal) => {
						const results = await Promise.allSettled([
							loadStoryProps(level, story, signal, world.crossings),
							park ? loadParkProps(park, signal) : undefined
						]);
						const objects = results.flatMap((r) => (r.status === 'fulfilled' && r.value ? [r.value] : []));
						const failed = results.find((r) => r.status === 'rejected');
						if (failed?.status === 'rejected') {
							for (const o of objects) o.dispose();
							throw failed.reason;
						}
						const object = new Group();
						for (const o of objects) object.add(o.object);
						return {
							object,
							update(dt: number) {
								for (const o of objects) o.update(dt);
							},
							sync() {
								for (const o of objects) o.sync();
							},
							dispose() {
								for (const o of objects) o.dispose();
							}
						};
					}
				: undefined,
		start,
		checkpoints,
		grid,
		collision,
		placements: renderWorld.trees.count + renderWorld.rocks.count + renderWorld.decorations.count,
		createVisual: () => {
			if (streamScene) return streamScene.visual;
			const visual = createMapVisual(world, level, [start, ...checkpoints], !!story);
			return visual;
		},
		loadPlacements: (quality, signal) =>
			streamScene
				? streamScene.loadPlacements(quality, signal)
				: testing
					? Promise.resolve({
							pools: new PoolSet([], []),
							dispose() {
								this.pools.dispose();
							}
						})
					: loadWorldPlacements(grid, quality, renderWorld, signal, level?.trails, level),
		get target() {
			if (story?.completed(6) && environment.streaming) {
				const portals = level?.portals ?? (level?.portal ? [level.portal] : []);
				const portal = portals[targetIndex % Math.max(1, portals.length)];
				return targetIndex % (portals.length + 1) === portals.length || !portal
					? { ...start.spawn, name: 'Volte para a base da Iara' }
					: { ...portal.outside, name: portal.sign.label };
			}
			return (
				story?.target(story.position) ?? targets[targetIndex] ?? { ...world.base.spawn, name: 'Volte à base' }
			);
		},
		nextTarget() {
			targetIndex =
				(targetIndex + 1) %
				Math.max(1, story?.completed(6) ? (level?.portals?.length ?? 1) + 1 : targets.length);
		}
	};
	const stones = level?.obbies.find((o) => o.id === 'stones');
	const crossing = world.crossings.find((c) => c.kind === 'stepping-stones');
	const point = stones?.takeoff ?? crossing?.from ?? start.spawn;
	const next = stones?.landing ?? crossing?.to ?? start.spawn;
	const mirante = level?.mirante ?? world.pois.find((p) => p.kind === 'lookout') ?? start.spawn;
	const debugPoses: Record<string, typeof checkpoint> = {
		spawn: start,
		ledges: { ...start, spawn: level?.obbies.find((o) => o.id === 'ledges')?.takeoff ?? start.spawn, yaw: 0 },
		edge: {
			...start,
			spawn: { x: 2, y: world.heights[Math.floor(world.size / 2) * world.grid + 2], z: world.size / 2 },
			yaw: -Math.PI / 2
		},
		stones: { ...start, spawn: point, yaw: Math.atan2(next.x - point.x, next.z - point.z) },
		mirante: { ...start, spawn: mirante, yaw: -Math.PI / 2 },
		bridge: {
			...start,
			spawn: world.crossings.find((c) => c.kind === 'bridge')?.from ?? point,
			yaw: Math.PI / 2
		}
	};
	if (level?.portal) debugPoses.portal = { ...start, spawn: { ...level.portal.inside }, yaw: Math.PI / 2 };
	if (typeof location !== 'undefined' && new URLSearchParams(location.search).get('pose') === 'vale') {
		const vale = loadZoneMap('vale');
		debugPoses.vale = { ...start, spawn: zoneSpawn('vale', vale.level), yaw: Math.PI / 2 };
	}
	if (level?.act1) {
		const bird = level.act1.birds[0];
		if (bird)
			debugPoses.birds = {
				...start,
				spawn: { x: bird.x, y: heightAt(world.heights, bird.x, bird.z + 10), z: bird.z + 10 },
				yaw: Math.PI
			};
		debugPoses.deck = { ...start, spawn: level.act1.zipline.start, yaw: -Math.PI / 2 };
		debugPoses.treehouse = {
			...start,
			spawn: level.act1.treehouse.ladder.bottom,
			yaw: level.act1.treehouse.ladder.yaw
		};
	}
	if (import.meta.env.DEV) {
		const stone = stones?.pieces[0] ?? crossing?.stones[0];
		if (stone) debugPoses['stone-top'] = { ...start, spawn: { x: stone.x, y: stone.y, z: stone.z }, yaw: 0 };
		if (
			level &&
			typeof location !== 'undefined' &&
			new URLSearchParams(location.search).get('pose') === 'wading'
		) {
			outer: for (
				let z = Math.max(1, Math.floor(level.pool.z - 20));
				z < Math.min(world.size, level.pool.z + 20);
				z++
			)
				for (
					let x = Math.max(1, Math.floor(level.pool.x - 20));
					x < Math.min(world.size, level.pool.x + 20);
					x++
				) {
					const y = world.heights[z * world.grid + x],
						water = riverSurfaceAt(world, x, z, level.pool);
					if (water !== null && water - y > 0.2 && water - y < 0.35) {
						debugPoses.wading = { ...start, spawn: { x, y, z }, yaw: 0 };
						break outer;
					}
				}
		}
	}
	return { environment, tracker, checkpoint, debugPoses };
}
