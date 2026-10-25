import type { createLocalSave } from '../data/local-save.ts';
import type { StoryLevel } from '../level/types.ts';
import { BlockGrid } from '../render/index.ts';
import type { SceneEnvironment } from '../scene/environment.ts';
import type { SurvivalWorld } from '../survival/types.ts';
import { buildMapCollision, prefabProxies } from './collision.ts';
import { MapCheckpoints } from './navigation.ts';
import { loadWorldPlacements } from './placements.ts';
import { createMapVisual } from './visual.ts';

export function createMapEnvironment(
	world: SurvivalWorld,
	level: StoryLevel | undefined,
	save: ReturnType<typeof createLocalSave>
) {
	const start = level?.start ?? {
		id: 'start',
		spawn: world.base.spawn,
		yaw: Math.atan2(world.base.yawS, world.base.yawC),
		min: { x: world.base.spawn.x - 2, y: world.base.spawn.y - 0.3, z: world.base.spawn.z - 2 },
		max: { x: world.base.spawn.x + 2, y: world.base.spawn.y + 3, z: world.base.spawn.z + 2 }
	};
	const checkpoints =
		level?.checkpoints ??
		world.pois.map((p) => ({
			id: `poi-${p.id}`,
			spawn: { x: p.x, y: p.y, z: p.z },
			yaw: Math.atan2(p.yawS, p.yawC),
			min: { x: p.x - 2, y: p.y - 0.3, z: p.z - 2 },
			max: { x: p.x + 2, y: p.y + 3, z: p.z + 2 }
		}));
	const mapKey = `${level ? 'story' : 'survival'}:${world.generatorVersion}:${world.checksum}`;
	const tracker = new MapCheckpoints(world, start, checkpoints, level?.killY ?? -20, level?.pool, (c) =>
		save.setCheckpoint(mapKey, c.id)
	);
	const saved = save.checkpoint(mapKey);
	const checkpoint = [start, ...checkpoints].find((c) => c.id === saved) ?? start;
	tracker.current = checkpoint;
	const targets =
		level?.missions.map((m) => ({ ...m.target, name: m.name })) ??
		world.pois.map((p, i) => ({ ...p, name: `Explore o ponto ${i + 1}` }));
	let targetIndex = 0;
	const grid = BlockGrid.covering(0, 0, world.size, world.size);
	const environment: SceneEnvironment = {
		kind: 'map',
		start,
		checkpoints,
		grid,
		collision: buildMapCollision(world, prefabProxies(world, level)),
		placements: world.trees.count + world.rocks.count + world.decorations.count,
		createVisual: () => {
			const visual = createMapVisual(world, level, [start, ...checkpoints]);
			return visual;
		},
		loadPlacements: (quality, signal) => loadWorldPlacements(grid, quality, world, signal),
		get target() {
			return targets[targetIndex] ?? { ...world.base.spawn, name: 'Volte à base' };
		},
		nextTarget() {
			targetIndex = (targetIndex + 1) % Math.max(1, targets.length);
		}
	};
	const stones = level?.obbies.find((o) => o.id === 'stones');
	const crossing = world.crossings.find((c) => c.kind === 'stepping-stones');
	const point = stones?.takeoff ?? crossing?.from ?? start.spawn;
	const next = stones?.landing ?? crossing?.to ?? start.spawn;
	const mirante = level?.mirante ?? world.pois.find((p) => p.kind === 'lookout') ?? start.spawn;
	const debugPoses: Record<string, typeof checkpoint> = {
		spawn: start,
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
	return { environment, tracker, checkpoint, debugPoses };
}
