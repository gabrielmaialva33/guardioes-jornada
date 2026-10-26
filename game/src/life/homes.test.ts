import { describe, expect, it } from 'vitest';
import { heightAt } from '../survival/terrain.ts';
import { FLAG } from '../survival/types.ts';
import { storyMap } from './fixtures.test-helper.ts';
import { CROWNS, LIFE_SEED, POPULATION, planLife } from './homes.ts';

const { world, level } = storyMap();
const plan = planLife(world, level);

const points = (route: number[]) => {
	const out: [number, number, number][] = [];
	for (let k = 0; k < route.length; k += 3) out.push([route[k], route[k + 1], route[k + 2]]);
	return out;
};
const flagAt = (x: number, z: number) => world.flags[Math.round(z) * world.grid + Math.round(x)];

describe('life plan: animals at their homes', () => {
	it('places the LEVEL.md §10 population, one group per home', () => {
		for (const [species, count] of Object.entries(POPULATION))
			expect(plan.animals.filter((a) => a.species === species)).toHaveLength(count);
		expect(plan.animals[plan.companion].species).toBe('mico-leao-dourado');
	});

	it('keeps every route point near its home, inside the map and off the river', () => {
		for (const animal of plan.animals) {
			const all = animal.route
				? points(animal.route)
				: (animal.perches ?? []).map((p) => [p.x, p.y, p.z] as [number, number, number]);
			expect(all.length).toBeGreaterThan(0);
			for (const [x, y, z] of all) {
				expect(Math.hypot(x - animal.homeX, z - animal.homeZ), animal.key).toBeLessThan(26);
				expect(x).toBeGreaterThan(1);
				expect(z).toBeGreaterThan(1);
				expect(x).toBeLessThan(world.size - 1);
				expect(z).toBeLessThan(world.size - 1);
				expect(flagAt(x, z) & FLAG.river, `${animal.key} over the river`).toBe(0);
				expect(Number.isFinite(y)).toBe(true);
			}
		}
	});

	it('puts tree dwellers in a real crown: within its radius and between its base and top', () => {
		for (const animal of plan.animals.filter((a) => a.tree)) {
			const tree = animal.tree;
			if (!tree) continue;
			const crown = CROWNS[tree.kind];
			expect(crown.model, `${animal.key} on a placeholder pillar`).toBe(true);
			const all = animal.route
				? points(animal.route)
				: (animal.perches ?? []).map((p) => [p.x, p.y, p.z] as [number, number, number]);
			const own = all.filter(
				([x, , z]) => Math.hypot(x - tree.x, z - tree.z) <= crown.radius * tree.scale + 0.01
			);
			expect(own.length, animal.key).toBeGreaterThan(0);
			for (const [, y] of own) {
				expect(y - tree.y, animal.key).toBeGreaterThanOrEqual(crown.base * tree.scale - 0.6);
				expect(y - tree.y, animal.key).toBeLessThanOrEqual(crown.top * tree.scale);
			}
		}
	});

	it('uses the map homes: embaúba for the sloth, plateau araucárias for the toucans, the level row for the muriquis', () => {
		const sloth = plan.animals.find((a) => a.species === 'preguica-de-coleira');
		expect(sloth?.tree?.kind).toBe('embauba');
		expect(Math.hypot((sloth?.tree?.x ?? 0) - 127, (sloth?.tree?.z ?? 0) - 126.5)).toBeLessThan(0.01);
		for (const toucan of plan.animals.filter((a) => a.species === 'tucano-de-bico-verde')) {
			expect(toucan.perches?.length).toBeGreaterThanOrEqual(2);
			for (const p of toucan.perches ?? []) expect(heightAt(world.heights, p.x, p.z)).toBeGreaterThan(14);
			expect(toucan.tree?.kind).toBe('araucaria');
		}
		const [first, second] = plan.animals.filter((a) => a.species === 'muriqui');
		expect(points(first.route ?? []).map(([x, y, z]) => ({ x, y, z }))).toEqual(level.handholds);
		expect(second.start).toBe(level.handholds.length - 1);
		// The second row runs beside the first, at the same handhold spacing.
		const a = points(second.route ?? []);
		for (let k = 1; k < a.length; k++)
			expect(Math.hypot(a[k][0] - a[k - 1][0], a[k][2] - a[k - 1][2])).toBeLessThanOrEqual(1.33);
	});

	it("lays the onça's trail on the ground, closed, clear of trunks and inside its forest", () => {
		const onca = plan.animals.find((a) => a.species === 'onca-pintada');
		expect(onca?.loop).toBe(true);
		expect(onca?.arboreal).toBe(false);
		for (const [x, y, z] of points(onca?.route ?? [])) {
			expect(y).toBeCloseTo(heightAt(world.heights, x, z), 4);
			expect(flagAt(x, z) & FLAG.walkable).toBeTruthy();
			for (let i = 0; i < world.trees.count; i++)
				expect(Math.hypot(world.trees.x[i] - x, world.trees.z[i] - z)).toBeGreaterThan(
					0.6 * world.trees.scale[i]
				);
		}
	});

	it('boxes the butterflies over the clareira and lets the birds cross the corridor after mission 1', () => {
		const [x0, y0, z0, x1, y1, z1] = plan.butterflies.bounds;
		expect((x0 + x1) / 2).toBeCloseTo(112, 0);
		expect((z0 + z1) / 2).toBeCloseTo(118, 0);
		expect(y1).toBeGreaterThan(y0);
		expect(y0).toBeGreaterThan(heightAt(world.heights, 112, 118) - 2);
		const corridor = level.planting.filter((p) => p.mission === 1);
		const inside = (box: number[], p: { x: number; z: number }) =>
			p.x >= box[0] && p.x <= box[3] && p.z >= box[2] && p.z <= box[5];
		expect(corridor.some((p) => inside(plan.birds.bounds, p))).toBe(false);
		expect(corridor.every((p) => inside(plan.birds.after, p))).toBe(true);
		expect(z1).toBeGreaterThan(z0);
	});

	it('is deterministic for a seed and changes with it', () => {
		expect(JSON.stringify(planLife(world, level, LIFE_SEED).animals)).toBe(JSON.stringify(plan.animals));
		expect(JSON.stringify(planLife(world, level, 7).animals)).not.toBe(JSON.stringify(plan.animals));
	});

	it('finds canopy over the forest and none over the clareira', () => {
		const { canopy } = plan;
		const at = (x: number, z: number) =>
			canopy.high[Math.floor(z / canopy.cell) * canopy.side + Math.floor(x / canopy.cell)];
		let covered = 0;
		for (let q = 0; q < canopy.high.length; q++) if (canopy.high[q] > 0) covered++;
		expect(covered).toBeGreaterThan(100);
		expect(at(112, 118)).toBe(0);
		expect(at(127, 126.5)).toBeGreaterThan(heightAt(world.heights, 127, 126.5) + 8);
	});
});
