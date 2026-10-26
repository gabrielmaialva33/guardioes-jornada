import { describe, expect, it } from 'vitest';
import { MURIQUI_HOLDS } from '../animation/animals/index.ts';
import { checksumOf } from '../survival/checksum.ts';
import { generateWorld } from '../survival/generate.ts';
import { heightAt } from '../survival/terrain.ts';
import { FLAG, GRID, ROCK_KINDS, TREE_SPECIES } from '../survival/types.ts';
import { buildStoryWorld } from './build.ts';
import { distance, polylineDistance } from './geometry.ts';
import {
	ANIMALS,
	FRUITS,
	LANE_CLEARANCE,
	LEDGES,
	LOGGER_RADIUS,
	MAX_INSTANCES,
	MURIQUI_HANDHOLDS,
	ONCA_RADIUS,
	PLACES,
	SPAWN,
	STONES,
	STORY_VERSION,
	TRAIL_CLEARANCE,
	TRASH,
	type XZ
} from './layout.ts';

/**
 * Pinned for STORY_VERSION 3 (Act 1, the north and south portals, the gorge, then
 * the gorge widened to 7 u). A change here means the map changed: if it was meant
 * (a control point moved), re-pin, and bump STORY_VERSION if saves need it (the
 * runtime's checkpoint key already carries the checksum).
 */
const GOLDEN_WORLD = 0xdc12d197;
const GOLDEN_LEVEL = 0x15eafb12;
/**
 * The story's own gameplay, the same since STORY_VERSION 1: missions, checkpoints,
 * obbies, collectibles, triggers, planting, spawn, start, pool, mirante and handholds.
 */
const GOLDEN_CORE = 0x6664a6f2;

const { world, level } = buildStoryWorld();

describe('story map build', () => {
	it('keeps its golden checksums', () => {
		expect(world.generatorVersion).toBe(STORY_VERSION);
		expect(world.problems).toEqual([]);
		expect(world.checksum).toBe(GOLDEN_WORLD);
		expect(level.checksum).toBe(GOLDEN_LEVEL);
		expect(checksumOf(world)).toBe(world.checksum);
		expect(checksumOf(level)).toBe(level.checksum);
	});

	it('adds the portals, their trail spurs and Act 1, and changes no mission, checkpoint, obby or collectible', () => {
		const {
			missions,
			checkpoints,
			obbies,
			collectibles,
			triggers,
			planting,
			spawn,
			start,
			pool,
			mirante,
			handholds
		} = level;
		const core = {
			missions,
			checkpoints,
			obbies,
			collectibles,
			triggers,
			planting,
			spawn,
			start,
			pool,
			mirante,
			handholds
		};
		expect(`0x${checksumOf(core).toString(16)}`).toBe(`0x${GOLDEN_CORE.toString(16)}`);
	});

	it('rebuilds the same map', () => {
		const again = buildStoryWorld();
		expect(again.world.checksum).toBe(world.checksum);
		expect(again.world.heights).toEqual(world.heights);
		expect(again.level).toEqual(level);
	});

	it("has exactly the survival world's shape", () => {
		const survival = generateWorld(1);
		expect(Object.keys(world).sort()).toEqual(Object.keys(survival).sort());
		expect(world.heights).toHaveLength(GRID * GRID);
		expect(world.blocks).toHaveLength(16);
		expect(Object.keys(world.counts)).toEqual(expect.arrayContaining(Object.keys(survival.counts)));
		for (const set of [world.trees, world.rocks, world.decorations])
			for (let k = 1; k < set.count; k++)
				expect(set.block[k] * 256 + set.kind[k]).toBeGreaterThanOrEqual(
					set.block[k - 1] * 256 + set.kind[k - 1]
				);
	});

	it('stays within the instance budget', () => {
		expect(world.trees.count + world.rocks.count + world.decorations.count).toBeLessThanOrEqual(
			MAX_INSTANCES
		);
		expect(world.counts.instances).toBe(world.trees.count + world.rocks.count + world.decorations.count);
	});

	it('spawns on flat ground facing north-east', () => {
		const [sx, sz] = SPAWN.at;
		expect(level.spawn.y).toBeCloseTo(heightAt(world.heights, sx, sz), 5);
		for (let dz = -3; dz <= 3; dz += 0.5)
			for (let dx = -3; dx <= 3; dx += 0.5)
				expect(Math.abs(heightAt(world.heights, sx + dx, sz + dz) - level.spawn.y)).toBeLessThan(0.05);
		expect(world.flags[sz * GRID + sx] & FLAG.walkable).toBeTruthy();
		// Front (yawS, yawC) points to +x and −z.
		expect(level.spawn.yawS).toBeGreaterThan(0.7);
		expect(level.spawn.yawC).toBeLessThan(-0.7);
		expect(level.start.spawn).toEqual({ x: sx, y: level.spawn.y, z: sz });
	});

	it('has the six missions, in LEVEL.md order', () => {
		expect(level.missions.map((m) => m.name)).toEqual([
			'Sementes de juçara',
			'Olho no corte ilegal',
			'Pedras do rio',
			'Mudas na clareira',
			'Armadilhas',
			'Mirante'
		]);
		expect(level.missions[0].requires).toEqual([]);
		for (const m of level.missions.slice(1, 5)) expect(m.requires).toEqual([1]);
		expect(level.missions[5].requires).toEqual([1, 2, 3, 4, 5]);
		expect(level.missions.map((m) => m.count)).toEqual([5, 1, 1, 6, 3, 1]);
		const triggers = new Set([
			...level.triggers.map((t) => t.id),
			...level.collectibles.map((c) => c.id),
			...level.checkpoints.map((c) => c.id)
		]);
		for (const m of level.missions) for (const id of m.triggers) expect(triggers, id).toContain(id);
	});

	it('gives every planting cell, collectible, trigger and checkpoint its own id', () => {
		// Mission.triggers mixes these kinds, so an id must name one thing. The one
		// sharing is a planting zone, which is the trigger of the cell it is named after.
		const cells = new Map(level.planting.map((p) => [p.id, p]));
		const zones = level.triggers.filter((t) => t.kind === 'planting');
		expect(zones.map((t) => t.id).sort()).toEqual([...cells.keys()].sort());
		for (const t of zones) expect(t).toMatchObject({ x: cells.get(t.id)?.x, z: cells.get(t.id)?.z });
		const ids = [
			...level.planting.map((p) => p.id),
			...level.collectibles.map((c) => c.id),
			...level.triggers.filter((t) => t.kind !== 'planting').map((t) => t.id),
			...[level.start, ...level.checkpoints].map((c) => c.id)
		];
		expect(ids.filter((id, k) => ids.indexOf(id) !== k)).toEqual([]);
		const prefix = { 'jucara-fruit': 'jucara-', trash: 'lixo-', 'gold-leaf': 'folha-' };
		for (const c of level.collectibles) expect(c.id.startsWith(prefix[c.kind]), c.id).toBe(true);
	});

	it('places the collectibles: 5 fruits, 10 trash, a gold leaf on stone 4 and one per mission', () => {
		const of = (kind: string) => level.collectibles.filter((c) => c.kind === kind);
		expect(of('jucara-fruit').map((c) => [c.x, c.z])).toEqual(FRUITS);
		expect(of('trash')).toHaveLength(TRASH.length);
		expect(of('gold-leaf')).toHaveLength(7);
		const stone = level.obbies[0].pieces[STONES.goldLeafStone - 1];
		const leaf = of('gold-leaf').find((c) => c.on !== '');
		expect(leaf).toMatchObject({ x: stone.x, y: stone.y, z: stone.z, mission: 3 });
	});

	it('keeps the observation spot out of the logger radius, and the onça radius on its home', () => {
		const logger = level.triggers.find((t) => t.kind === 'logger');
		const hide = level.triggers.find((t) => t.kind === 'observation');
		const onca = level.triggers.find((t) => t.kind === 'onca');
		expect(logger).toMatchObject({ x: PLACES.cutting[0], z: PLACES.cutting[1], radius: LOGGER_RADIUS });
		expect(onca).toMatchObject({
			x: ANIMALS['onca-pintada'][0],
			z: ANIMALS['onca-pintada'][1],
			radius: ONCA_RADIUS
		});
		if (!logger || !hide) throw new Error('missing trigger');
		expect(distance(hide.x, hide.z, logger.x, logger.z)).toBeGreaterThan(LOGGER_RADIUS + hide.radius);
		expect(level.missions[1].target).toMatchObject({ x: hide.x, z: hide.z });
	});

	it("strings the muriqui handholds within the fauna module's spacing", () => {
		expect(MURIQUI_HANDHOLDS).toMatchObject({
			spacingMin: MURIQUI_HOLDS.min,
			spacingMax: MURIQUI_HOLDS.max,
			maxReach: MURIQUI_HOLDS.reach
		});
		expect(level.handholds.length).toBeGreaterThan(2);
		for (let k = 1; k < level.handholds.length; k++) {
			const a = level.handholds[k - 1];
			const b = level.handholds[k];
			const d = distance(a.x, a.z, b.x, b.z);
			expect(d).toBeGreaterThanOrEqual(MURIQUI_HOLDS.min - 1e-9);
			expect(d).toBeLessThanOrEqual(MURIQUI_HOLDS.max + 1e-9);
			expect(d).toBeLessThanOrEqual(MURIQUI_HOLDS.reach);
			expect(d).toBeLessThan(MURIQUI_HOLDS.limit);
		}
	});

	it('keeps tree and rock colliders off the trails and out of the obby lanes', () => {
		const stones = world.crossings.flatMap((c) => c.stones);
		const isStone = (x: number, z: number) =>
			stones.some((s) => Math.abs(s.x - x) < 1e-4 && Math.abs(s.z - z) < 1e-4);
		const ledges = level.obbies[1].pieces;
		const colliders: { x: number; z: number; r: number }[] = [];
		for (const block of world.blocks) {
			for (let k = 0; k < block.cylinders.length; k += 5) {
				const [x, , z, r] = block.cylinders.subarray(k, k + 4);
				if (!isStone(x, z)) colliders.push({ x, z, r });
			}
			for (let k = 0; k < block.boxes.length; k += 8) {
				const [x, , z, hx, , hz] = block.boxes.subarray(k, k + 6);
				if (!ledges.some((l) => Math.abs(l.x - x) < 1e-4 && Math.abs(l.z - z) < 1e-4))
					colliders.push({ x, z, r: Math.sqrt(hx * hx + hz * hz) });
			}
		}
		expect(colliders.length).toBe(
			world.trees.count + world.rocks.kind.filter((k) => ROCK_KINDS[k] !== 'stone').length
		);
		const [stoneRun, ledgeRun] = level.obbies;
		const lane = (o: typeof stoneRun): [XZ, XZ] => [
			[o.takeoff.x - o.dirX * 2, o.takeoff.z - o.dirZ * 2],
			[o.landing.x, o.landing.z]
		];
		const failures: string[] = [];
		for (const c of colliders) {
			for (const t of level.trails)
				if (polylineDistance(t.points, c.x, c.z) - c.r < TRAIL_CLEARANCE)
					failures.push(`${t.id} ${c.x},${c.z}`);
			if (polylineDistance(lane(stoneRun), c.x, c.z) - c.r < STONES.zigzag + STONES.radius + LANE_CLEARANCE)
				failures.push(`stones lane ${c.x},${c.z}`);
			if (polylineDistance(lane(ledgeRun), c.x, c.z) - c.r < LEDGES.size / 2 + LANE_CLEARANCE)
				failures.push(`ledge lane ${c.x},${c.z}`);
		}
		expect(failures).toEqual([]);
	});

	it('has one yellow canopy, the ipê at the base, and the landmark jequitibá', () => {
		const at = (species: string) => {
			const out: XZ[] = [];
			for (let k = 0; k < world.trees.count; k++)
				if (TREE_SPECIES[world.trees.kind[k]] === species) out.push([world.trees.x[k], world.trees.z[k]]);
			return out;
		};
		expect(at('ipe-amarelo')).toEqual([PLACES.ipe]);
		expect(at('jequitiba')).toContainEqual(PLACES.jequitiba);
		expect(level.landmarks.filter((l) => l.silhouette).map((l) => l.kind)).toEqual([
			'ipe-amarelo',
			'jequitiba'
		]);
	});
});
