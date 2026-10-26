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

	it('keeps every route point near its home, inside the map and off the river (but swimmers and waders)', () => {
		for (const animal of plan.animals) {
			// Capivaras and the antas swim where their bank loops dip in; colhereiros wade at the edge.
			const wet = animal.water != null || animal.species === 'colhereiro';
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
				if (!wet) expect(flagAt(x, z) & FLAG.river, `${animal.key} over the river`).toBe(0);
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

	it('uses the map homes: a broadleaf crown for the sloth, plateau araucárias for the toucans, the level row for the muriquis', () => {
		const sloth = plan.animals.find((a) => a.species === 'preguica-de-coleira');
		// Not an embaúba: the maned sloth browses young leaves of many broadleaf trees (p27 fact check).
		expect(['jequitiba', 'ipe-rosa', 'ipe-amarelo', 'pau-brasil']).toContain(sloth?.tree?.kind);
		expect(Math.hypot((sloth?.tree?.x ?? 0) - 128, (sloth?.tree?.z ?? 0) - 124)).toBeLessThan(24);
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

describe('life plan: the P23 species at their Reserva homes (the brief; PARK.md zones come later)', () => {
	const of = (species: string) => plan.animals.filter((a) => a.species === species);
	const routePoints = (species: string) => of(species).flatMap((a) => points(a.route ?? []));
	/** Distance to the river's centre line. */
	const toRiver = (x: number, z: number) => {
		let best = Number.POSITIVE_INFINITY;
		const pts = world.river.points;
		for (let i = 1; i < pts.length; i++) {
			const a = pts[i - 1];
			const b = pts[i];
			const dx = b.x - a.x;
			const dz = b.z - a.z;
			const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz)));
			best = Math.min(best, Math.hypot(x - a.x - t * dx, z - a.z - t * dz));
		}
		return best;
	};

	it('puts a capybara family on a river bank, swimming where its loop dips in', () => {
		const family = of('capivara');
		expect(family).toHaveLength(3);
		expect(new Set(family.map((a) => a.herd)).size).toBe(1);
		expect(family[0].herd).toBeGreaterThanOrEqual(0);
		for (const a of family) {
			expect(
				a.water?.some((w) => w === 1),
				a.key
			).toBe(true);
			expect(
				a.water?.some((w) => w === 0),
				a.key
			).toBe(true);
			for (const [x, , z] of points(a.route ?? [])) expect(toRiver(x, z)).toBeLessThan(12);
		}
	});

	it('puts the anta and her calf by the water in the south, together', () => {
		const [mother] = of('anta');
		const [calf] = of('anta-filhote');
		expect(mother.herd).toBe(calf.herd);
		expect(mother.herd).toBeGreaterThanOrEqual(0);
		for (const [x, , z] of points(mother.route ?? [])) {
			expect(z).toBeGreaterThan(120);
			expect(toRiver(x, z)).toBeLessThan(12);
		}
	});

	it('keeps the cateto band of five in one herd on the forest floor', () => {
		const band = of('cateto');
		expect(band).toHaveLength(5);
		expect(new Set(band.map((a) => a.herd)).size).toBe(1);
		const all = routePoints('cateto');
		const inForest = all.filter(([x, , z]) => flagAt(x, z) & FLAG.forest).length;
		expect(inForest / all.length).toBeGreaterThan(0.9);
	});

	it('puts the veado at a forest edge, the tapitis at the clareira and the toads by the stones pool', () => {
		const near = (x: number, z: number, flag: number, want: boolean, r: number) => {
			for (let dz = -r; dz <= r; dz++)
				for (let dx = -r; dx <= r; dx++) if (Boolean(flagAt(x + dx, z + dz) & flag) === want) return true;
			return false;
		};
		for (const [x, , z] of routePoints('veado-mateiro')) {
			expect(near(x, z, FLAG.forest, true, 10)).toBe(true);
			expect(near(x, z, FLAG.forest, false, 10)).toBe(true);
		}
		for (const [x, , z] of routePoints('tapiti')) expect(Math.hypot(x - 112, z - 118)).toBeLessThan(14 + 4);
		for (const [x, , z] of routePoints('sapo-cururu'))
			expect(Math.hypot(x - level.pool.x, z - level.pool.z)).toBeLessThan(level.pool.halfLength + 6);
	});

	it('puts the crabs on the mud by the river mouth (south-west), above the water', () => {
		expect(of('caranguejo-uca')).toHaveLength(4);
		for (const [x, , z] of routePoints('caranguejo-uca')) {
			expect(x).toBeLessThan(45);
			expect(z).toBeGreaterThan(135);
			expect(toRiver(x, z)).toBeLessThan(world.river.halfWidth + 4);
			expect(flagAt(x, z) & FLAG.river).toBe(0);
		}
	});

	it('walks the tatu along a trail and keeps the jabuti on the forest floor', () => {
		const trail = level.trails.find((t) => (t as { id?: string }).id === 'ponte');
		const pts = trail?.points ?? [];
		for (const [x, , z] of routePoints('tatu-galinha')) {
			let best = Number.POSITIVE_INFINITY;
			for (let i = 1; i < pts.length; i++) {
				const [ax, az] = pts[i - 1];
				const [bx, bz] = pts[i];
				const t = Math.max(
					0,
					Math.min(1, ((x - ax) * (bx - ax) + (z - az) * (bz - az)) / ((bx - ax) ** 2 + (bz - az) ** 2))
				);
				best = Math.min(best, Math.hypot(x - ax - t * (bx - ax), z - az - t * (bz - az)));
			}
			expect(best).toBeLessThan(0.5);
		}
		for (const [x, , z] of routePoints('jabuti-tinga')) expect(flagAt(x, z) & FLAG.forest).toBeTruthy();
	});

	it('keeps the rare cachorro-do-mato, jaguatirica and onça-parda alone in the south-east forest', () => {
		for (const species of ['cachorro-do-mato', 'jaguatirica', 'onca-parda']) {
			expect(of(species), species).toHaveLength(1);
			for (const [x, , z] of routePoints(species)) {
				expect(x, species).toBeGreaterThan(115);
				expect(z, species).toBeGreaterThan(100);
				expect(flagAt(x, z) & FLAG.forest, species).toBeTruthy();
			}
		}
	});

	it('perches the saíras in the canopy, the sabiá on the lawn and the ipê, the jacutinga in the juçaras, and wades the colhereiros by the river mouth', () => {
		for (const a of of('saira-sete-cores'))
			for (const p of a.perches ?? []) expect(p.y - heightAt(world.heights, p.x, p.z)).toBeGreaterThan(2);
		const [sabia] = of('sabia-laranjeira');
		expect(sabia.perches?.some((p) => p.ground)).toBe(true);
		expect(sabia.perches?.some((p) => !p.ground)).toBe(true);
		const [jacutinga] = of('jacutinga');
		expect(jacutinga.tree?.kind).toBe('jucara');
		const flock = of('colhereiro');
		expect(flock).toHaveLength(3);
		expect(new Set(flock.map((a) => a.herd)).size).toBe(1);
		for (const [x, y, z] of routePoints('colhereiro')) {
			// The restinga edge by the river mouth: south-west.
			expect(x).toBeLessThan(50);
			expect(z).toBeGreaterThan(135);
			expect(toRiver(x, z)).toBeLessThan(world.river.halfWidth + 2.5);
			expect(y).toBeCloseTo(heightAt(world.heights, x, z), 6);
		}
	});
});
