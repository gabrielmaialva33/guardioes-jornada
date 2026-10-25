import { describe, expect, it } from 'vitest';
import { generateWorld } from './generate.ts';
import { FLAG, POI_KINDS, type SurvivalWorld, WALK_SLOPE } from './types.ts';

/** About 7 s on an i9-13900K. */
const SEEDS = 300;

/**
 * Reachability rebuilt from the generator's output alone, as a second
 * implementation of the rules: walkable cells, 8 neighbours without cutting
 * corners, a rise of at most WALK_SLOPE per unit of run, bridge decks at the
 * height of the line between their ends.
 */
function reachable(world: SurvivalWorld): Uint8Array {
	const n = world.grid;
	const { flags } = world;
	const surface = Float32Array.from(world.heights);
	const decks = world.crossings.filter((c) => c.kind !== 'stepping-stones');
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
	const walkable = (q: number) => (flags[q] & FLAG.walkable) !== 0;
	const seen = new Uint8Array(n * n);
	const start = world.base.z * n + world.base.x;
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
	}
	return seen;
}

describe('survival solvability', () => {
	it(`reaches every POI and objective from the base on ${SEEDS} seeds`, () => {
		const attempts: number[] = [];
		for (let seed = 9000; seed < 9000 + SEEDS; seed++) {
			const world = generateWorld(seed);
			const reach = reachable(world);
			const at = (p: { x: number; z: number }) =>
				reach[Math.floor(p.z + 0.5) * world.grid + Math.floor(p.x + 0.5)] === 1;
			const failures: string[] = [...world.problems];
			let disagree = 0;
			for (let q = 0; q < reach.length; q++) if ((reach[q] === 1) !== world.baseSteps[q] >= 0) disagree++;
			if (disagree > 0) failures.push(`${disagree} cells disagree with baseSteps`);
			for (const kind of POI_KINDS) if (!world.pois.some((p) => p.kind === kind)) failures.push(`no ${kind}`);
			for (const poi of world.pois) if (poi.kind !== 'stepping-stones' && !at(poi)) failures.push(poi.kind);
			for (const crossing of world.crossings)
				if (!at(crossing.from) || !at(crossing.to)) failures.push(`${crossing.kind} banks`);
			for (const slot of world.threats) if (!at(slot)) failures.push(`threat ${slot.id}`);
			for (const cell of world.corridor.cells) if (!at(cell)) failures.push(`planting ${cell.cell}`);
			for (const spot of world.cameraSpots) if (!at(spot)) failures.push(`camera ${spot.id}`);
			for (const node of world.resources) if (!at(node)) failures.push(`resource ${node.id}`);
			expect(failures, `seed ${seed}`).toEqual([]);
			attempts[world.attempt] = (attempts[world.attempt] ?? 0) + 1;
		}
		// The research measured 281 of 300 valid on the first try; stay in that range.
		expect(attempts[1]).toBeGreaterThanOrEqual(0.9 * SEEDS);
	}, 30_000);
});
