import { describe, expect, it } from 'vitest';
import { jumpReach } from '../engine/graybox.ts';
import { FLAG, type SurvivalWorld, WALK_SLOPE } from '../survival/types.ts';
import { buildStoryWorld, reachTargets } from './build.ts';
import { distance, polylineDistance } from './geometry.ts';
import { GROTTO, RIVER } from './layout.ts';
import type { Obby, StoryLevel } from './types.ts';

const { world, level } = buildStoryWorld();
const n = world.grid;
const cell = (x: number, z: number) => Math.floor(z + 0.5) * n + Math.floor(x + 0.5);

/** The grotto's pad, where its run starts, GROTTO.padBack behind the take-off. */
const padCell = (o: Obby) =>
	cell(o.takeoff.x - o.dirX * GROTTO.padBack, o.takeoff.z - o.dirZ * GROTTO.padBack);
/** Feet cell just before an obby's first jump and just after its last one. */
const startCell = (o: Obby) => cell(o.takeoff.x - o.dirX * 1.5, o.takeoff.z - o.dirZ * 1.5);
const endCell = (o: Obby) => cell(o.landing.x + o.dirX * 1.5, o.landing.z + o.dirZ * 1.5);

/** Every jump of the run within the reach of a full-speed jump, measured from the positions. */
function runnable(o: Obby): boolean {
	const ends = [
		{ x: o.takeoff.x, y: o.takeoff.y, z: o.takeoff.z, r: 0 },
		...o.pieces.map((p) => ({ x: p.x, y: p.y, z: p.z, r: p.radius }))
	];
	for (let k = 1; k < ends.length; k++) {
		const a = ends[k - 1];
		const b = ends[k];
		if (distance(a.x, a.z, b.x, b.z) - a.r - b.r > jumpReach(b.y - a.y)) return false;
	}
	return true;
}

/**
 * Reachability rebuilt from the output alone, as a second implementation:
 * walkable cells, 8 neighbours without cutting corners, a rise of at most
 * WALK_SLOPE per unit of run, bridge decks at the height of their line, and
 * each allowed obby as a jump from its start cell to its end cell (the stones
 * both ways, the ledges only up, the grotto's stones both ways between their
 * pad and the niche).
 */
function reachable(
	w: SurvivalWorld,
	l: StoryLevel,
	use: { stones: boolean; ledges: boolean; bridge: boolean; grotto: boolean }
) {
	const { flags } = w;
	const surface = Float32Array.from(w.heights);
	const decks = w.crossings.filter((c) => c.kind === 'bridge');
	for (let q = 0; q < n * n; q++) {
		if ((flags[q] & FLAG.crossing) === 0) continue;
		const i = q % n;
		const j = (q - i) / n;
		for (const { from, to, halfWidth } of decks) {
			const sx = to.x - from.x;
			const sz = to.z - from.z;
			const span2 = sx * sx + sz * sz;
			const t = ((i - from.x) * sx + (j - from.z) * sz) / span2;
			const off = Math.abs((i - from.x) * sz - (j - from.z) * sx) / Math.sqrt(span2);
			if (t >= 0 && t <= 1 && off <= halfWidth + 0.01) surface[q] = from.y + (to.y - from.y) * t;
		}
	}
	const walkable = (q: number) =>
		(flags[q] & FLAG.walkable) !== 0 && (use.bridge || (flags[q] & FLAG.crossing) === 0);
	const jumps = new Map<number, number[]>();
	const [stones, ledges] = l.obbies;
	if (use.stones && runnable(stones)) {
		jumps.set(startCell(stones), [endCell(stones)]);
		jumps.set(endCell(stones), [startCell(stones)]);
	}
	if (use.ledges && runnable(ledges)) jumps.set(startCell(ledges), [endCell(ledges)]);
	const grotto = l.act1?.grotto.obby;
	if (use.grotto && grotto && runnable(grotto)) {
		const landing = cell(grotto.landing.x, grotto.landing.z);
		jumps.set(padCell(grotto), [...(jumps.get(padCell(grotto)) ?? []), landing]);
		jumps.set(landing, [...(jumps.get(landing) ?? []), padCell(grotto)]);
	}
	const seen = new Uint8Array(n * n);
	const start = cell(l.spawn.x, l.spawn.z);
	const queue = [start];
	seen[start] = 1;
	for (let head = 0; head < queue.length; head++) {
		const q = queue[head];
		for (let dz = -1; dz <= 1; dz++)
			for (let dx = -1; dx <= 1; dx++) {
				const next = q + dz * n + dx;
				if (next === q || seen[next] || !walkable(next)) continue;
				const diagonal = dx !== 0 && dz !== 0;
				if (diagonal && !(walkable(q + dx) && walkable(q + dz * n))) continue;
				if (Math.abs(surface[next] - surface[q]) > WALK_SLOPE * (diagonal ? 1.41 : 1)) continue;
				seen[next] = 1;
				queue.push(next);
			}
		for (const next of jumps.get(q) ?? [])
			if (!seen[next]) {
				seen[next] = 1;
				queue.push(next);
			}
	}
	return seen;
}

const all = { stones: true, ledges: true, bridge: true, grotto: true };

describe('story map reachability', () => {
	const reach = reachable(world, level, all);
	const at = (p: { x: number; z: number }) => reach[cell(p.x, p.z)] === 1;

	it('agrees with the builder’s baseSteps', () => {
		let disagree = 0;
		for (let q = 0; q < reach.length; q++) if ((reach[q] === 1) !== world.baseSteps[q] >= 0) disagree++;
		expect(disagree).toBe(0);
	});

	it('reaches every mission target, checkpoint, collectible, planting spot and the mirante top on foot', () => {
		const [stones, ledges] = level.obbies;
		const act1 = level.act1;
		if (!act1) throw new Error('no act1');
		// Off the ground: the treehouse deck by its ladder, the zipline's end by its cable, the canopy leaf by the branches.
		const onObby: Record<string, () => boolean> = {
			stones: () => reach[startCell(stones)] === 1 && runnable(stones),
			ledges: () => reach[startCell(ledges)] === 1 && runnable(ledges),
			casa: () => at(act1.treehouse.ladder.bottom),
			tirolesa: () => at(act1.zipline.start),
			copa: () => at(act1.canopy.obby.takeoff) && runnable(act1.canopy.obby)
		};
		const failures: string[] = [];
		for (const target of reachTargets(level)) {
			const ok = target.onObby === '' ? at(target) : (onObby[target.onObby]?.() ?? false);
			if (!ok) failures.push(target.id);
		}
		expect(failures).toEqual([]);
		expect(at(level.mirante)).toBe(true);
		for (const t of level.triggers)
			if (t.kind === 'trap' || t.kind === 'observation') expect(at(t), t.id).toBe(true);
	});

	it('only reaches the grotto’s niche by its stones', () => {
		const leaf = level.act1?.grotto.leaf;
		if (!leaf) throw new Error('no grotto');
		expect(at(leaf)).toBe(true);
		expect(reachable(world, level, { ...all, grotto: false })[cell(leaf.x, leaf.z)]).toBe(0);
	});

	it('only reaches the mirante top by the ledges', () => {
		const without = reachable(world, level, { ...all, ledges: false });
		expect(without[cell(level.mirante.x, level.mirante.z)]).toBe(0);
	});

	it('reaches the east bank by the bridge without the stones, and not without both', () => {
		const east = level.checkpoints.find((c) => c.id === 'pedras-leste');
		if (!east) throw new Error('no east bank checkpoint');
		const q = cell(east.spawn.x, east.spawn.z);
		expect(reachable(world, level, { ...all, stones: false })[q]).toBe(1);
		expect(reachable(world, level, { stones: false, ledges: false, bridge: false, grotto: true })[q]).toBe(0);
	});

	it('never walks on river cells except on the bridge deck', () => {
		let river = 0;
		for (let q = 0; q < n * n; q++) {
			if ((world.flags[q] & FLAG.river) === 0) continue;
			river++;
			if (world.flags[q] & FLAG.walkable) expect(world.flags[q] & FLAG.crossing).toBeTruthy();
			expect(world.heights[q]).toBeLessThan(10);
		}
		expect(river).toBeGreaterThan(800);
		// The centre line is water all the way, away from the plateau corner it brushes.
		for (let k = 1; k < RIVER.length - 1; k++) {
			const [x, z] = RIVER[k];
			expect(world.flags[cell(x, z)] & FLAG.river, `${x}, ${z}`).toBeTruthy();
		}
		expect(polylineDistance(RIVER, level.spawn.x, level.spawn.z)).toBeGreaterThan(20);
	});

	it('walks to the east portal from the spawn, but only over the mirante (the ledges)', () => {
		const { gap, inside } = level.portal;
		const without = reachable(world, level, { ...all, ledges: false });
		expect(at(inside)).toBe(true);
		let cells = 0;
		for (let z = gap.from; z <= gap.to; z++)
			for (let x = 148; x <= gap.at; x++) {
				const q = cell(x, z);
				expect(reach[q], `${x},${z}`).toBe(1);
				expect(without[q], `${x},${z} without the ledges`).toBe(0);
				cells++;
			}
		expect(cells).toBeGreaterThan(100);
	});

	it('opens the east fence only in the portal’s gap', () => {
		const { gap } = level.portal;
		for (let z = 2; z < n - 2; z++)
			for (const x of [n - 2, n - 1]) {
				const open = (world.flags[cell(x, z)] & FLAG.walkable) !== 0;
				expect(open, `${x},${z}`).toBe(z >= gap.from && z <= gap.to);
				if (open) expect(reach[cell(x, z)]).toBe(1);
			}
	});
});
