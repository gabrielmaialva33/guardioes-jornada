import { describe, expect, it } from 'vitest';
import { JUMP_HEIGHT } from '../engine/constants.ts';
import { jumpReach } from '../engine/graybox.ts';
import { walkSteps } from '../survival/generate.ts';
import { heightAt } from '../survival/terrain.ts';
import { FLAG, type Placements, TREE_SPECIES, WALK_SLOPE } from '../survival/types.ts';
import { buildStoryWorld, gorgeBank } from './build.ts';
import { distance, insidePolygon, polylineDistance } from './geometry.ts';
import {
	ACT1_SOURCES,
	ACT1_TEXT,
	CANOPY,
	EDGE_PORTALS,
	FACING,
	GORGE,
	GROTTO,
	MIRANTE_DECK,
	PLATEAU,
	PORTAL,
	SERRA,
	TRAIL_HALF_WIDTH,
	TRAIL_MARKS,
	TREEHOUSE,
	WATERFALL,
	type XZ,
	ZIPLINE
} from './layout.ts';
import { PARK_RIVER, SEAMS } from './zones/spec.ts';

const { world, level } = buildStoryWorld();
const n = world.grid;
const cell = (x: number, z: number) => Math.floor(z + 0.5) * n + Math.floor(x + 0.5);
const act1 = level.act1;
if (!act1) throw new Error('no act1');
const portals = level.portals ?? [];
/** Largest trunk collider (build.ts MAX_TRUNK_RADIUS). */
const TRUNK = 0.6;
/** How far the zipline rider's feet may dip under the mirante plateau's lip, past the deck. */
const LIP_DIP = 0.2;

function* placed<K extends string>(set: Placements<K>) {
	for (let k = 0; k < set.count; k++)
		yield { kind: set.kinds[set.kind[k]], x: set.x[k], z: set.z[k], scale: set.scale[k] };
}
/** The placed tree standing at (x, z) (positions are stored as float32). */
const treeAt = (x: number, z: number) =>
	[...placed(world.trees)].find((t) => distance(t.x, t.z, x, z) < 1e-3);
const walkOnly = walkSteps(world.flags, world.heights, cell(level.spawn.x, level.spawn.z));

describe('Act 1: the treehouse (mission 0)', () => {
	const { tree, deck, ladder } = act1.treehouse;

	it('puts a 5 × 5 deck 6 u up round the trunk of a placed tree, off the trilha', () => {
		expect(deck.x1 - deck.x0).toBe(2 * TREEHOUSE.deckHalf);
		expect(deck.z1 - deck.z0).toBe(2 * TREEHOUSE.deckHalf);
		expect(deck.y).toBeCloseTo(heightAt(world.heights, tree.x, tree.z) + 6, 6);
		expect(treeAt(tree.x, tree.z)?.kind).toBe(TREEHOUSE.species);
		const trilha = level.trails.find((t) => t.id === 'trilha')?.points ?? [];
		expect(polylineDistance(trilha, tree.x, tree.z)).toBeGreaterThanOrEqual(3 + TRUNK);
		// No other trunk or rock pierces the deck.
		for (const t of [...placed(world.trees), ...placed(world.rocks)])
			if (distance(t.x, t.z, tree.x, tree.z) > 1e-3)
				expect(
					t.x < deck.x0 - 1 || t.x > deck.x1 + 1 || t.z < deck.z0 - 1 || t.z > deck.z1 + 1,
					`${t.x},${t.z}`
				).toBe(true);
	});

	it('rails every side, leaving only the ladder’s top open', () => {
		const length = deck.rails.reduce((sum, r) => sum + distance(r.x0, r.z0, r.x1, r.z1), 0);
		expect(length).toBeCloseTo(4 * 2 * TREEHOUSE.deckHalf - TREEHOUSE.ladderWidth, 6);
		for (const r of deck.rails) expect([r.y, r.height]).toEqual([deck.y, TREEHOUSE.railHeight]);
	});

	it('anchors the ladder from walkable, reachable ground to the deck, the climber facing the tree', () => {
		const { bottom, top } = ladder;
		expect(world.flags[cell(bottom.x, bottom.z)] & FLAG.walkable).toBeTruthy();
		expect(world.baseSteps[cell(bottom.x, bottom.z)]).toBeGreaterThanOrEqual(0);
		expect(bottom.y).toBeCloseTo(heightAt(world.heights, bottom.x, bottom.z), 6);
		expect(bottom.z).toBeGreaterThan(deck.z1);
		expect(top.y).toBe(deck.y);
		expect(top.z).toBeLessThan(deck.z1);
		expect([bottom.x, top.x]).toEqual([tree.x, tree.x]);
		expect(ladder.yaw).toBe(FACING.north);
		// Front (yawS, yawC) points from the foot towards the deck (−z).
		expect([ladder.yawS, ladder.yawC]).toEqual([0, -1]);
		expect(ladder.deck).toBe(deck.id);
	});
});

describe('Act 1: the zipline', () => {
	const { zipline } = act1;
	const decks = new Map(act1.decks.map((d) => [d.id, d]));

	it('runs straight along z 84 from the mirante deck (feet y 15) to the base deck (feet y 4), opened by mission 6', () => {
		expect([zipline.start.x, zipline.start.y, zipline.start.z]).toEqual([129, 15, 84]);
		expect([zipline.end.x, zipline.end.y, zipline.end.z]).toEqual([46, 4, 84]);
		expect(zipline.drop).toBe(11);
		expect(zipline.length).toBeCloseTo(Math.hypot(83, 11), 9);
		expect(zipline.requires).toBe('mirante');
		expect(zipline.mission).toBe(6);
		const start = decks.get(zipline.startDeck);
		const end = decks.get(zipline.endDeck);
		if (!start || !end) throw new Error('no decks');
		expect([start.x0, start.x1, start.z0, start.z1, start.y]).toEqual([128, 134, 81.5, 86.5, 15]);
		for (const [d, p] of [
			[start, zipline.start],
			[end, zipline.end]
		] as const) {
			expect(p.x >= d.x0 && p.x <= d.x1 && p.z >= d.z0 && p.z <= d.z1).toBe(true);
			expect(p.y).toBe(d.y);
		}
	});

	it('rails the mirante deck north, south and east, with the 2 u opening on its west edge at z 84', () => {
		const deck = decks.get('mirante-deck');
		if (!deck) throw new Error('no mirante deck');
		const west = deck.rails.filter((r) => r.x0 === deck.x0 && r.x1 === deck.x0);
		expect(west.map((r) => [r.z0, r.z1])).toEqual([
			[deck.z0, MIRANTE_DECK.gapZ - 1],
			[MIRANTE_DECK.gapZ + 1, deck.z1]
		]);
		expect(deck.rails.filter((r) => r.z0 === deck.z0 && r.z1 === deck.z0)).toHaveLength(1);
		expect(deck.rails.filter((r) => r.z0 === deck.z1 && r.z1 === deck.z1)).toHaveLength(1);
		expect(deck.rails.filter((r) => r.x0 === deck.x1 && r.x1 === deck.x1)).toHaveLength(1);
		// The start stands on the plateau the ledges reach.
		expect(insidePolygon(PLATEAU, zipline.start.x, zipline.start.z)).toBe(true);
		expect(world.baseSteps[cell(zipline.start.x, zipline.start.z)]).toBeGreaterThanOrEqual(0);
	});

	it(`keeps every tree, rock and ground cover more than ${ZIPLINE.clearance} u off the cable’s line`, () => {
		const line: XZ[] = [ZIPLINE.start, ZIPLINE.end];
		let checked = 0;
		for (const set of [world.trees, world.rocks, world.decorations] as Placements<string>[])
			for (const p of placed(set)) {
				checked++;
				expect(polylineDistance(line, p.x, p.z), `${p.kind} at ${p.x},${p.z}`).toBeGreaterThan(
					zipline.clearance
				);
			}
		expect(checked).toBeGreaterThan(500);
	});

	it('keeps the rider’s feet over the ground all the way, and 2 u over the ledges it passes', () => {
		const { start, end } = zipline;
		for (let t = 0; t <= 1; t += 1 / 400) {
			const x = start.x + (end.x - start.x) * t;
			const feet = start.y + (end.y - start.y) * t;
			const ground = heightAt(world.heights, x, start.z);
			if (x > MIRANTE_DECK.x0 || x < 48) continue;
			// Leaving the deck the feet skim the plateau's lip (its top is the deck's 15): at most
			// LIP_DIP under it for its last 2 u, which the rider's ground clamp absorbs.
			if (x > MIRANTE_DECK.x0 - 2) expect(feet - ground, `x ${x.toFixed(1)}`).toBeGreaterThan(-LIP_DIP);
			else expect(feet - ground, `x ${x.toFixed(1)}`).toBeGreaterThan(1);
		}
		for (const obby of level.obbies)
			for (const p of obby.pieces) {
				const off = polylineDistance([ZIPLINE.start, ZIPLINE.end], p.x, p.z) - p.radius * Math.SQRT2;
				if (off > zipline.clearance) continue;
				const feet = start.y + ((end.y - start.y) * (start.x - p.x)) / (start.x - end.x);
				expect(feet - p.y, `${obby.id} piece at ${p.x.toFixed(1)}`).toBeGreaterThanOrEqual(2);
			}
	});
});

describe('Act 1: the gorge', () => {
	it('follows the park river from the Reserva’s edge to the lip, on its water', () => {
		const edge = PARK_RIVER.find((s) => s.x === GORGE.from[0]);
		const lip = PARK_RIVER.find((s) => s.x === GORGE.lip[0]);
		expect([edge?.z, edge?.water]).toEqual([GORGE.from[1], GORGE.waterFrom]);
		expect([lip?.z, lip?.water]).toEqual([GORGE.lip[1], GORGE.waterLip]);
		expect(act1.gorge.points.map((p) => p.water)).toEqual([9.4, 9, 9]);
	});

	it('cuts a never-walkable water channel through the serra, its walls standing over the water', () => {
		let wet = 0;
		for (let j = 22; j <= 42; j++)
			for (let i = 133; i <= 160; i++) {
				const { d, bank } = gorgeBank(i, j);
				const q = j * n + i;
				if (d <= bank) {
					wet++;
					expect(world.flags[q] & FLAG.river, `${i},${j}`).toBeTruthy();
					expect(world.flags[q] & FLAG.walkable, `${i},${j}`).toBeFalsy();
					expect(world.heights[q]).toBeLessThan(GORGE.waterFrom);
					expect(world.heights[q]).toBeGreaterThan(GORGE.waterLip - GORGE.depth - 0.01);
				} else if (
					d < bank + 1.5 &&
					insidePolygon(SERRA, i, j) &&
					!(i >= GROTTO.niche.x0 && i <= GROTTO.niche.x1 && j >= GROTTO.niche.z0 && j <= GROTTO.niche.z1)
				)
					expect(world.heights[q], `wall ${i},${j}`).toBeGreaterThan(GORGE.waterFrom + 1);
			}
		expect(wet).toBeGreaterThan(100);
		// The waterfall now falls from the gorge's lip to the river's head.
		const fall = level.landmarks.find((l) => l.kind === 'waterfall');
		expect(fall?.y).toBe(GORGE.waterLip);
		expect(fall?.height).toBeCloseTo(GORGE.waterLip - world.river.points[0].water, 9);
	});

	it('is 7 u across at the edge, as the park river, and at least that everywhere', () => {
		expect(GORGE.north[0] + GORGE.south[0]).toBe(
			2 * (PARK_RIVER.find((s) => s.x === GORGE.from[0])?.halfWidth ?? 0)
		);
		for (let x = GORGE.lip[0]; x <= GORGE.from[0]; x += 0.5) {
			const t = (GORGE.from[0] - x) / (GORGE.from[0] - GORGE.lip[0]);
			const z = GORGE.from[1] + (GORGE.lip[1] - GORGE.from[1]) * t;
			const across = gorgeBank(x, z - 0.01).bank + gorgeBank(x, z + 0.01).bank;
			expect(across, `x ${x}`).toBeGreaterThanOrEqual(7 - 1e-3);
		}
		expect(act1.gorge.points.map((p) => [p.north, p.south])).toEqual([
			[3.5, 3.5],
			[2, 5.5],
			[2, 2]
		]);
	});

	it('cannot be jumped: no reachable cell has a cell across it within a full-speed jump', () => {
		// The feet can stand up to half a cell past a walkable vertex, on either side.
		const STAND = 0.5;
		const sides: { i: number; j: number; h: number; south: boolean; reached: boolean }[] = [];
		for (let j = 10; j <= 50; j++)
			for (let i = WATERFALL[0]; i <= world.size; i++) {
				const q = j * n + i;
				const { d, bank, south } = gorgeBank(i, j);
				if (d <= bank || d > 14 || (world.flags[q] & FLAG.walkable) === 0) continue;
				sides.push({ i, j, h: world.heights[q], south, reached: world.baseSteps[q] >= 0 });
			}
		let pairs = 0;
		let closest = Number.POSITIVE_INFINITY;
		for (const a of sides)
			if (a.reached)
				for (const b of sides) {
					if (a.south === b.south) continue;
					const rise = b.h - a.h;
					if (rise > JUMP_HEIGHT) continue;
					pairs++;
					const spare = distance(a.i, a.j, b.i, b.j) - 2 * STAND - jumpReach(rise);
					closest = Math.min(closest, spare);
					expect(spare, `${a.i},${a.j} → ${b.i},${b.j}`).toBeGreaterThan(0);
				}
		expect(pairs).toBeGreaterThan(1000);
		expect(closest).toBeLessThan(2);
	});

	it('opens no way onto the serra or the mirante: off the ledges, none of it is reached, the grotto aside', () => {
		const niche = (i: number, j: number) =>
			i >= GROTTO.niche.x0 && i <= GROTTO.niche.x1 && j >= GROTTO.niche.z0 && j <= GROTTO.niche.z1;
		let high = 0;
		for (let j = 0; j < n; j++)
			for (let i = 0; i < n; i++) {
				if (!(insidePolygon(SERRA, i, j) || insidePolygon(PLATEAU, i, j)) || niche(i, j)) continue;
				high++;
				expect(walkOnly[j * n + i], `${i},${j}`).toBe(-1);
			}
		expect(high).toBeGreaterThan(2500);
	});
});

describe('Act 1: the grotto behind the small waterfall', () => {
	const { grotto } = act1;
	const { obby } = grotto;

	it('reaches the niche only over its three stones', () => {
		const floor = cell(grotto.leaf.x, grotto.leaf.z);
		expect(walkOnly[floor]).toBe(-1);
		expect(world.baseSteps[floor]).toBeGreaterThanOrEqual(0);
		const pad = cell(obby.takeoff.x - GROTTO.padBack, obby.takeoff.z);
		expect(walkOnly[pad]).toBeGreaterThanOrEqual(0);
		expect(obby.pieces).toHaveLength(3);
		for (const p of obby.pieces) expect(world.flags[cell(p.x, p.z)] & FLAG.river).toBeTruthy();
		expect(grotto.pool.water).toBe(world.river.points[0].water);
	});

	it('keeps each gap at its fraction of the flat reach, every jump within reach', () => {
		const ends = [
			{ x: obby.takeoff.x, z: obby.takeoff.z, y: obby.takeoff.y, r: 0 },
			...obby.pieces.map((p) => ({ x: p.x, z: p.z, y: p.y, r: p.radius })),
			{ x: obby.landing.x, z: obby.landing.z, y: obby.landing.y, r: 0 }
		];
		for (let k = 1; k < ends.length; k++) {
			const a = ends[k - 1];
			const b = ends[k];
			const gap = distance(a.x, a.z, b.x, b.z) - a.r - b.r;
			expect(gap).toBeCloseTo(GROTTO.gapFractions[k - 1] * jumpReach(0), 6);
			expect(gap).toBeLessThan(jumpReach(b.y - a.y));
		}
	});

	it('lays the niche floor flat, with the gold leaf and Iara’s note on it', () => {
		const { x0, x1, z0, z1, y } = grotto.niche;
		for (let j = z0; j <= z1; j++)
			for (let i = x0; i <= x1; i++) expect(world.heights[j * n + i]).toBeCloseTo(y, 5);
		expect((x1 - x0 + 1) * (z1 - z0 + 1)).toBe(20);
		for (const p of [grotto.leaf, grotto.note]) {
			expect(p.x >= x0 && p.x <= x1 && p.z >= z0 && p.z <= z1).toBe(true);
			expect(p.y).toBeCloseTo(y, 6);
		}
		expect(ACT1_TEXT[grotto.note.text]).toBeTruthy();
	});
});

describe('Act 1: the canopy gold leaf (obby)', () => {
	const { obby, leaf, tree } = act1.canopy;

	it('climbs 5 branches 1.8 u each over gaps of 0.45–0.55 of the flat reach, every jump within reach', () => {
		expect(obby.pieces).toHaveLength(5);
		const ends = [
			{ x: obby.takeoff.x, z: obby.takeoff.z, y: obby.takeoff.y, r: 0 },
			...obby.pieces.map((p) => ({ x: p.x, z: p.z, y: p.y, r: p.radius }))
		];
		for (let k = 1; k < ends.length; k++) {
			const a = ends[k - 1];
			const b = ends[k];
			const gap = distance(a.x, a.z, b.x, b.z) - a.r - b.r;
			expect(b.y - a.y).toBeCloseTo(CANOPY.rise, 9);
			expect(gap / jumpReach(0)).toBeGreaterThanOrEqual(0.45 - 1e-9);
			expect(gap / jumpReach(0)).toBeLessThanOrEqual(0.55 + 1e-9);
			expect(gap).toBeCloseTo(CANOPY.gapFractions[k - 1] * jumpReach(0), 6);
			expect(gap).toBeLessThan(jumpReach(b.y - a.y));
		}
		expect(world.baseSteps[cell(obby.takeoff.x, obby.takeoff.z)]).toBeGreaterThanOrEqual(0);
	});

	it('sets the leaf on the last branch at (60, 24), 9 u over the take-off, in the crown of the tree just past it', () => {
		const last = obby.pieces[obby.pieces.length - 1];
		expect([last.x, last.z].map((v) => Math.round(v * 1e9) / 1e9)).toEqual([60, 24]);
		expect(last.y - obby.takeoff.y).toBeCloseTo(9, 9);
		expect([leaf.x, leaf.y, leaf.z]).toEqual([last.x, last.y, last.z]);
		expect(leaf.on).toBe('galho-5');
		expect(treeAt(tree.x, tree.z)?.kind).toBe(CANOPY.species);
		expect(distance(last.x, last.z, tree.x, tree.z)).toBeCloseTo(CANOPY.treeBeyond, 9);
		// No other trunk stands in the jumps' air.
		for (const t of placed(world.trees)) {
			if (distance(t.x, t.z, tree.x, tree.z) < 1e-3) continue;
			expect(
				polylineDistance(
					[
						[obby.takeoff.x, obby.takeoff.z],
						[last.x, last.z]
					],
					t.x,
					t.z
				),
				`${t.kind} at ${t.x},${t.z}`
			).toBeGreaterThan(CANOPY.radius + 1);
		}
	});
});

describe('Act 1: NPCs, seeds, birds and missions', () => {
	it('places Ana at the clareira’s edge and Seu Zé on the north trail, on reachable ground', () => {
		expect(act1.npcs.map((p) => [p.id, p.x, p.z, p.mission])).toEqual([
			['ana', 112, 106, 7],
			['ze', 96, 30, 8]
		]);
		for (const p of act1.npcs) expect(world.baseSteps[cell(p.x, p.z)]).toBeGreaterThanOrEqual(0);
	});

	it('scatters six seeds of three species round the clareira, off the trails and reachable', () => {
		expect(act1.seeds).toHaveLength(6);
		const species = new Map<string, number>();
		for (const s of act1.seeds) species.set(s.species, (species.get(s.species) ?? 0) + 1);
		expect([...species.values()]).toEqual([2, 2, 2]);
		for (const s of species.keys()) expect(TREE_SPECIES).toContain(s);
		for (const s of act1.seeds) {
			expect(distance(s.x, s.z, 112, 118)).toBeGreaterThan(14);
			expect(distance(s.x, s.z, 112, 118)).toBeLessThan(20);
			expect(world.baseSteps[cell(s.x, s.z)], s.id).toBeGreaterThanOrEqual(0);
			for (const t of level.trails)
				expect(polylineDistance(t.points, s.x, s.z), `${s.id} ${t.id}`).toBeGreaterThan(TRAIL_HALF_WIDTH);
		}
	});

	it('perches the three birds within the camera’s 25 u of Seu Zé', () => {
		const ze = act1.npcs.find((p) => p.id === 'ze');
		if (!ze) throw new Error('no Zé');
		expect(act1.birds.map((b) => b.species)).toEqual(['tucano', 'saira', 'sabia']);
		for (const b of act1.birds) {
			expect(distance(b.x, b.z, ze.x, ze.z)).toBeLessThan(25);
			expect(b.y).toBeGreaterThan(heightAt(world.heights, b.x, b.z));
		}
	});

	it('adds missions 0, 7 and 8 in PARK.md §3’s order, every trigger and text key present', () => {
		expect(act1.missions.map((m) => [m.id, m.key, m.name, m.requires, m.count])).toEqual([
			[0, 'casa-na-arvore', 'Suba e veja a Reserva', [], 1],
			[7, 'sementes-viveiro', 'Sementes para o viveiro', [1], 6],
			[8, 'fotografe-aves', 'Fotografe 3 aves', [1], 3]
		]);
		expect(act1.firstRequires).toEqual([0]);
		const ids = new Set([
			...act1.triggers.map((t) => t.id),
			...act1.seeds.map((s) => s.id),
			...act1.birds.map((b) => b.id)
		]);
		for (const m of act1.missions) {
			for (const id of m.triggers) expect(ids, id).toContain(id);
			for (const key of m.dialogue) expect(act1.text[key], key).toBeTruthy();
			expect(world.baseSteps[cell(m.target.x, m.target.z)], `missao-${m.id}`).toBeGreaterThanOrEqual(0);
		}
		// Every fact carries its checked source.
		for (const key of Object.keys(act1.text))
			if (key.startsWith('FACT_')) expect(ACT1_SOURCES[key], key).toMatch(/^https:\/\//);
		expect(Object.keys(ACT1_SOURCES).every((key) => key in act1.text)).toBe(true);
		// The story's own six missions are untouched.
		expect(level.missions.map((m) => m.id)).toEqual([1, 2, 3, 4, 5, 6]);
		const deckTrigger = act1.triggers.find((t) => t.id === act1.treehouse.deck.id);
		expect(deckTrigger?.minY).toBeLessThan(act1.treehouse.deck.y);
		expect(deckTrigger?.minY).toBeGreaterThan(act1.treehouse.deck.y - 1);
	});
});

describe('Act 1: trail marks', () => {
	it(`marks every trail about every ${TRAIL_MARKS.spacing} u, on a trunk near it or a post just off it, facing it`, () => {
		for (const trail of level.trails) {
			const marks = act1.marks.filter((m) => m.trail === trail.id);
			let length = 0;
			for (let k = 1; k < trail.points.length; k++)
				length += distance(
					trail.points[k - 1][0],
					trail.points[k - 1][1],
					trail.points[k][0],
					trail.points[k][1]
				);
			expect(marks.length, trail.id).toBe(Math.max(1, Math.round(length / TRAIL_MARKS.spacing)));
			expect(length / marks.length, trail.id).toBeLessThan(TRAIL_MARKS.spacing * 1.5);
			for (const m of marks) {
				const off = polylineDistance(trail.points, m.x, m.z);
				if (m.on === 'post') {
					for (const t of level.trails)
						expect(
							polylineDistance(t.points, m.x, m.z),
							`${trail.id} post on ${t.id}`
						).toBeGreaterThanOrEqual(t.halfWidth + TRAIL_MARKS.postOut - 1e-6);
					expect(off).toBeLessThan(trail.halfWidth + TRAIL_MARKS.postOut + TRAIL_MARKS.postSearch + 0.01);
				} else {
					expect(off).toBeLessThanOrEqual(TRAIL_MARKS.trunkReach + 1e-3);
					expect(treeAt(m.x, m.z)).toBeDefined();
				}
				expect(Math.hypot(m.yawC, m.yawS)).toBeCloseTo(1, 9);
				expect(m.y).toBeCloseTo(heightAt(world.heights, m.x, m.z), 6);
			}
		}
		expect(act1.marks.some((m) => m.on === 'trunk')).toBe(true);
	});
});

describe('the north and south portals', () => {
	it('lists the three portals, east first, all gated by the mirante (mission 6)', () => {
		expect(portals.map((p) => [p.id, p.side])).toEqual([
			['leste', 'east'],
			['norte', 'north'],
			['sul', 'south']
		]);
		expect(portals[0]).toBe(level.portal);
		for (const p of portals) expect([p.requires, p.mission]).toEqual(['mirante', 6]);
	});

	it('opens each at its zone seam’s crossing, the fence open only there, the opening reachable', () => {
		for (const p of portals.slice(1)) {
			const seam = SEAMS.find((s) => s.id === (p.side === 'north' ? 'reserva-praia' : 'reserva-manguezal'));
			expect([p.gap.from, p.gap.to]).toEqual(seam?.crossings[0]);
			expect(p.gap.at).toBe(p.side === 'north' ? 0 : world.size);
			const rows = p.side === 'north' ? [0, 1] : [n - 2, n - 1];
			for (const j of rows)
				for (let i = 2; i < n - 2; i++) {
					const open = (world.flags[j * n + i] & FLAG.walkable) !== 0;
					expect(open, `${i},${j}`).toBe(i >= p.gap.from && i <= p.gap.to);
					if (open) expect(world.baseSteps[j * n + i], `${i},${j}`).toBeGreaterThanOrEqual(0);
				}
			expect(p.gap.y).toBeCloseTo(heightAt(world.heights, (p.gap.from + p.gap.to) / 2, p.gap.at), 6);
		}
	});

	it('leads to each by its own trail spur, walkable, its sign beside it and its posts in the opening', () => {
		for (const p of portals.slice(1)) {
			const spec = EDGE_PORTALS.find((e) => e.id === p.id);
			const spur = level.trails.find((t) => t.id === p.trail)?.points ?? [];
			expect(spur.length).toBeGreaterThan(1);
			const end = spur[spur.length - 1];
			expect(end[1]).toBe(p.gap.at);
			expect(end[0]).toBeGreaterThanOrEqual(p.gap.from);
			expect(end[0]).toBeLessThanOrEqual(p.gap.to);
			for (let k = 1; k < spur.length; k++) {
				const [ax, az] = spur[k - 1];
				const [bx, bz] = spur[k];
				const len = Math.hypot(bx - ax, bz - az);
				for (let t = 0; t + 0.5 <= len; t += 0.5) {
					const x0 = ax + ((bx - ax) * t) / len;
					const z0 = az + ((bz - az) * t) / len;
					const x1 = ax + ((bx - ax) * (t + 0.5)) / len;
					const z1 = az + ((bz - az) * (t + 0.5)) / len;
					expect(world.baseSteps[cell(x0, z0)], `${p.id} ${x0},${z0}`).toBeGreaterThanOrEqual(0);
					expect(
						Math.abs(heightAt(world.heights, x1, z1) - heightAt(world.heights, x0, z0))
					).toBeLessThanOrEqual(WALK_SLOPE * 0.5);
				}
			}
			const off = polylineDistance(spur, p.sign.x, p.sign.z);
			expect(off).toBeGreaterThan(TRAIL_HALF_WIDTH);
			expect(off).toBeLessThan(TRAIL_HALF_WIDTH + 3);
			expect(p.sign.label).toBe(spec?.label);
			for (const post of p.posts) {
				expect(post.x).toBeGreaterThan(p.gap.from);
				expect(post.x).toBeLessThan(p.gap.to);
				expect(Math.abs(post.z - p.gap.at)).toBeLessThan(1);
			}
			expect(p.posts[1].x - p.posts[0].x - 2 * PORTAL.postRadius).toBeGreaterThan(6);
			// "Voltar" lands inside, on reachable ground, facing into the Reserva; the outside is past the edge.
			expect(world.baseSteps[cell(p.inside.x, p.inside.z)]).toBeGreaterThanOrEqual(0);
			expect(p.inside.yaw).toBe(p.side === 'north' ? FACING.south : FACING.north);
			expect(p.side === 'north' ? p.outside.z < 0 : p.outside.z > world.size).toBe(true);
			// Nothing collides in the opening (the fence rows and the row inside them).
			for (const b of world.blocks)
				for (let k = 0; k < b.cylinders.length; k += 5) {
					const [x, , z] = b.cylinders.subarray(k, k + 3);
					expect(x >= p.gap.from - 1 && x <= p.gap.to + 1 && Math.abs(z - p.gap.at) < 2.5, `${x},${z}`).toBe(
						false
					);
				}
		}
	});
});
