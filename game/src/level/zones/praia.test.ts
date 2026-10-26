import { describe, expect, it } from 'vitest';
import { Boardwalk } from '../../mechanics/boardwalk.ts';
import { PhotoCamera, type PhotoFrame } from '../../mechanics/photo.ts';
import { FLAG, TREE_SPECIES, WALK_SLOPE, WATER_LEVEL, ZONE } from '../../survival/types.ts';
import { distance, insidePolygon, polylineDistance } from '../geometry.ts';
import { TRAIL_MARKS as RESERVA_TRAIL_MARKS } from '../layout.ts';
import { buildZone } from './park.ts';
import { groundTargets, praiaShape, runEnds } from './praia.ts';
import {
	BOARDWALK,
	COSTAO_LOOKOUT,
	COSTAO_ROCK,
	HOMES,
	MAX_INSTANCES,
	POOL_WATER,
	POOLS,
	RESTINGA_SUBJECTS,
	TRAIL_MARKS,
	TRAILS,
	TURTLES
} from './praia-layout.ts';
import { COSTAO, ENTRIES } from './spec.ts';
import { heightIn } from './zone.ts';

/**
 * Zone 'praia' (PARK.md §5.1, P33), measured from the built output. World
 * coordinates where the layout gives them: local = (x + 40, z + 160).
 */
const praia = buildZone('praia');
const { world, level } = praia;
const content = level.content;
if (!content) throw new Error('the Praia has no content');
const mechanics = content.mechanics;
const OX = praia.offsetX;
const OZ = praia.offsetZ;
const side = world.grid;
const rows = world.heights.length / side;
const cell = (x: number, z: number) => Math.floor(z + 0.5) * side + Math.floor(x + 0.5);
const ground = (x: number, z: number) => heightIn(world.heights, side, x, z);
/** Height and zone at a world vertex. */
const H = (x: number, z: number) => world.heights[(z - OZ) * side + x - OX];
const Z = (x: number, z: number) => world.zones[(z - OZ) * side + x - OX];
const toLocal = ([x, z]: readonly [number, number]): [number, number] => [x - OX, z - OZ];
const subjects = mechanics.photoSubjects ?? [];
const creatures = content.creatures ?? [];
const fragile = content.fragile ?? [];

/** The ground's reachability, rebuilt from the output (the boardwalk stands over it). */
function reachable(): Uint8Array {
	const { flags, heights } = world;
	const walkable = (q: number) => (flags[q] & FLAG.walkable) !== 0;
	const seen = new Uint8Array(side * rows);
	const start = cell(level.spawn.x, level.spawn.z);
	const queue = [start];
	seen[start] = 1;
	for (let head = 0; head < queue.length; head++) {
		const q = queue[head];
		const i = q % side;
		const j = (q - i) / side;
		for (let dz = -1; dz <= 1; dz++)
			for (let dx = -1; dx <= 1; dx++) {
				if ((dx === 0 && dz === 0) || i + dx < 0 || i + dx >= side || j + dz < 0 || j + dz >= rows) continue;
				const next = q + dz * side + dx;
				if (seen[next] || !walkable(next)) continue;
				const diagonal = dx !== 0 && dz !== 0;
				if (diagonal && !(walkable(q + dx) && walkable(q + dz * side))) continue;
				if (Math.abs(heights[next] - heights[q]) > WALK_SLOPE * (diagonal ? 1.41 : 1)) continue;
				seen[next] = 1;
				queue.push(next);
			}
	}
	return seen;
}
const floor = reachable();
const reached = (x: number, z: number) => floor[cell(x, z)] === 1;

/** Whether the line from a to b dips under the ground (or the sea's surface) or meets a trunk. */
function occluded(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }): boolean {
	const len = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
	const cylinders: number[] = [];
	for (const block of world.blocks) for (const c of block.cylinders) cylinders.push(c);
	for (let s = 0.2; s < len - 0.5; s += 0.2) {
		const t = s / len;
		const x = a.x + (b.x - a.x) * t;
		const y = a.y + (b.y - a.y) * t;
		const z = a.z + (b.z - a.z) * t;
		if (y < ground(x, z) + 0.1) return true;
		for (let k = 0; k < cylinders.length; k += 5) {
			const [cx, cy, cz, r, h] = cylinders.slice(k, k + 5);
			if (Math.hypot(x - cx, z - cz) <= r && y >= cy && y <= cy + h) return true;
		}
	}
	return false;
}

function frameAt(origin: { x: number; y: number; z: number }, target: { x: number; y: number; z: number }) {
	const fx = target.x - origin.x;
	const fy = target.y - origin.y;
	const fz = target.z - origin.z;
	const fl = Math.hypot(fx, fy, fz);
	const forward = { x: fx / fl, y: fy / fl, z: fz / fl };
	const rl = Math.hypot(forward.z, forward.x);
	const right = { x: -forward.z / rl, y: 0, z: forward.x / rl };
	const up = {
		x: right.y * forward.z - right.z * forward.y,
		y: right.z * forward.x - right.x * forward.z,
		z: right.x * forward.y - right.y * forward.x
	};
	return {
		origin,
		forward,
		right,
		up,
		tanHalfFov: Math.tan((35 * Math.PI) / 180),
		aspect: 16 / 9
	} as PhotoFrame;
}

const photographable = (from: { x: number; y: number; z: number }, s: (typeof subjects)[number]) => {
	const camera = new PhotoCamera([s]);
	camera.evaluate(frameAt(from, s.position), (o, t) => occluded(o, t));
	return camera.valid[0] === 1;
};

describe('the Praia: sea, beach, restinga, forest (PARK.md §5.1)', () => {
	it('runs the sea west of x 0 to a gentle beach, the restinga from x 2 to 40, the forest from x 40', () => {
		// Past the band that meets the Reserva's edge (z > −40), as zones.test.ts.
		for (let z = -150; z <= -40; z += 4) {
			if (z >= -104 && z <= -66) continue; // the costão and its shelf
			// One shoreline per row, the ground rising from it, gently.
			let crossings = 0;
			for (let x = -39; x <= 10; x++) if (H(x, z) < WATER_LEVEL !== H(x - 1, z) < WATER_LEVEL) crossings++;
			expect(crossings, `z ${z}`).toBe(1);
			for (let x = -16; x <= 2; x++) expect(Math.abs(H(x, z) - H(x - 1, z)), `${x},${z}`).toBeLessThan(0.6);
			expect(Z(-8, z) === ZONE.beach || H(-8, z) < WATER_LEVEL, `${-8},${z}`).toBe(true);
			expect(Z(1, z), `1,${z}`).toBe(ZONE.beach);
			expect(Z(20, z), `20,${z}`).toBe(ZONE.restinga);
			expect([ZONE.lowland, ZONE.slope]).toContain(Z(60, z));
			expect(H(-30, z)).toBeLessThan(WATER_LEVEL - 1);
		}
	});

	it('changes nothing on its edges: the Reserva seam, the Copa seam and the open sea keep their heights', () => {
		// The shaping stays far from the edges: none of its features reaches within 2 u of one.
		for (let z = -160; z <= 0; z += 2)
			for (const x of [-40, -38, 158, 160]) expect(praiaShape(x, z, 1.25)).toBe(1.25);
		for (let x = -40; x <= 160; x += 2)
			for (const z of [-160, -158, -2, 0]) expect(praiaShape(x, z, 1.25)).toBe(1.25);
	});
});

describe('the Praia: the costão and its tide pools', () => {
	it('raises the costão as a walkable rock, highest at its viewpoint (−12, −88), in safe ledges', () => {
		const [px, pz] = COSTAO_ROCK.peak;
		expect([px, pz]).toEqual([...COSTAO_LOOKOUT.at]);
		let top = Number.NEGATIVE_INFINITY;
		let rock = 0;
		for (let z = -96; z <= -78; z++)
			for (let x = -36; x <= -12; x++) {
				if (!insidePolygon(COSTAO, x, z)) continue;
				top = Math.max(top, H(x, z));
				if (Z(x, z) === ZONE.highland) rock++;
				// Its top steps in low ledges only.
				for (const [dx, dz] of [
					[1, 0],
					[0, 1]
				])
					if (insidePolygon(COSTAO, x + dx, z + dz))
						expect(Math.abs(H(x + dx, z + dz) - H(x, z)), `${x},${z}`).toBeLessThanOrEqual(0.5 + 1e-6);
				expect(H(x, z)).toBeGreaterThanOrEqual(COSTAO_ROCK.floor);
			}
		expect(rock).toBeGreaterThan(150);
		expect(H(px, pz)).toBe(COSTAO_ROCK.top);
		expect(top).toBeLessThanOrEqual(COSTAO_ROCK.top);
		// Walkable from the trail to its far tip.
		expect(reached(...toLocal([px, pz]))).toBe(true);
		expect(reached(...toLocal([-32, -87]))).toBe(true);
		// At its far tip it ends in a low ledge over the water's edge.
		expect(H(-34, -87)).toBeGreaterThanOrEqual(COSTAO_ROCK.floor);
		expect(H(-36, -87)).toBeLessThan(0.6);
	});

	it('looks out from the viewpoint at two green turtles in the water, one feeding and one caught in line', () => {
		const [lookout] = mechanics.lookouts;
		expect(lookout.id).toBe('mirante-costao');
		expect([lookout.position.x + OX, lookout.position.z + OZ]).toEqual([...COSTAO_LOOKOUT.at]);
		const turtles = creatures.filter((c) => c.species === 'tartaruga-verde');
		expect(turtles.map((t) => [t.state, t.model])).toEqual(TURTLES.map((t) => [t.state, t.model]));
		expect(turtles.map((t) => t.model)).toEqual(['custom-tartaruga-verde', 'custom-tartaruga-verde-linha']);
		const eye = { ...lookout.position, y: lookout.position.y + 1.6 };
		for (const t of turtles) {
			expect(ground(t.x, t.z), t.id).toBeLessThan(WATER_LEVEL - 0.8);
			expect(t.y).toBeLessThan(WATER_LEVEL);
			const s = subjects.find((x) => x.id === `foto-${t.id}`);
			if (!s) throw new Error(t.id);
			expect(photographable(eye, s), t.id).toBe(true);
		}
		expect(lookout.target).toEqual({ x: turtles[0].x, y: turtles[0].y, z: turtles[0].z });
		const ids = level.triggers.filter((t) => t.kind === 'lookout' || t.kind === 'radio').map((t) => t.id);
		expect(ids).toEqual(['mirante-costao', 'resgate-tartaruga']);
	});

	it('keeps four tide pools of water at the costão foot, each with its creature, "não pise" round them off every path', () => {
		expect(POOLS.map((p) => p.species)).toEqual([
			'ourico-do-mar',
			'estrela-do-mar',
			'anemona',
			'peixe-de-poca'
		]);
		const noStep = fragile.filter((f) => f.kind === 'tide-pool');
		expect(noStep).toHaveLength(4);
		const lines = level.trails.map((t) => ({ t, line: t.points }));
		for (const pool of POOLS) {
			const [x, z] = toLocal(pool.at);
			expect(world.flags[cell(x, z)] & FLAG.walkable, pool.id).toBe(0);
			expect(POOL_WATER.surface - ground(x, z)).toBeGreaterThan(0.4);
			const basin = content.basins.find((b) => b.id === pool.id);
			expect(basin?.water).toBe(POOL_WATER.surface);
			const creature = creatures.find((c) => c.place === pool.id);
			expect(creature?.species).toBe(pool.species);
			expect(distance(creature?.x ?? 0, creature?.z ?? 0, x, z)).toBeLessThan(pool.radius);
			const area = noStep.find((f) => f.id === `nao-pise-${pool.id}`);
			if (area?.shape !== 'circle') throw new Error(pool.id);
			// No trail's walking width comes into the "não pise" ring.
			for (const { t, line } of lines)
				expect(polylineDistance(line, area.x, area.z), `${t.id} ${pool.id}`).toBeGreaterThan(
					area.radius + t.halfWidth
				);
			// No ring overlaps another pool's.
			for (const other of noStep)
				if (other !== area && other.shape === 'circle')
					expect(distance(area.x, area.z, other.x, other.z)).toBeGreaterThan(area.radius + other.radius);
		}
		// P2: where to stand to look in, outside every ring, on dry reachable rock.
		const looks = level.triggers.filter((t) => t.kind === 'observation');
		expect(looks).toHaveLength(4);
		expect(level.missions[1].triggers).toEqual(looks.map((l) => l.id));
		for (const l of looks) {
			expect(reached(l.x, l.z), l.id).toBe(true);
			for (const area of noStep)
				if (area.shape === 'circle')
					expect(distance(l.x, l.z, area.x, area.z), l.id).toBeGreaterThan(area.radius);
		}
	});
});

describe('the Praia: the restinga boardwalk (P4)', () => {
	const runs = BOARDWALK.runs.map((run) => mechanics.boardwalks.filter((b) => b.id.startsWith(`${run.id}-`)));

	it('runs along x 4 from z −20 to −140 in two contiguous runs, ramped onto the sand at each end', () => {
		expect(runs.map((r) => r.length > 2)).toEqual([true, true]);
		for (const run of runs) {
			for (let k = 1; k < run.length; k++) expect(run[k].start).toEqual(run[k - 1].end);
			const first = run[0];
			const last = run[run.length - 1];
			expect(first.start.y).toBeCloseTo(ground(first.start.x, first.start.z), 4);
			expect(last.end.y).toBeCloseTo(ground(last.end.x, last.end.z), 4);
			for (const b of run) {
				expect(b.start.x + OX).toBe(BOARDWALK.x);
				expect(b.width).toBe(2);
				expect(() => new Boardwalk(b)).not.toThrow();
				const len = Math.hypot(b.end.x - b.start.x, b.end.z - b.start.z);
				expect(Math.abs(b.end.y - b.start.y) / len, b.id).toBeLessThan(0.45);
			}
			// Between its ramps the deck stays about 1 u over the sand.
			for (const b of run.slice(1, -1))
				for (let t = 0; t <= 1; t += 0.1) {
					const x = b.start.x + (b.end.x - b.start.x) * t;
					const z = b.start.z + (b.end.z - b.start.z) * t;
					const clearance = b.start.y + (b.end.y - b.start.y) * t - ground(x, z);
					expect(clearance, b.id).toBeGreaterThan(0.5);
					expect(clearance, b.id).toBeLessThan(1.8);
				}
		}
		expect(runs[0][0].start.z + OZ).toBe(-20);
		expect(runs[1][runs[1].length - 1].end.z + OZ).toBe(-140);
		for (const end of runEnds(mechanics.boardwalks)) expect(reached(end.x, end.z), end.id).toBe(true);
		// The trail to the costão crosses between the runs, on the sand: no deck over it.
		const trail = level.trails.find((t) => t.id === 'praia-trilha');
		if (!trail) throw new Error('trail');
		for (const b of mechanics.boardwalks)
			for (let t = 0; t <= 1; t += 0.1) {
				const x = b.start.x + (b.end.x - b.start.x) * t;
				const z = b.start.z + (b.end.z - b.start.z) * t;
				expect(polylineDistance(trail.points, x, z), b.id).toBeGreaterThan(trail.halfWidth + 1);
			}
	});

	it('has 2 lookouts on its deck framing a bromélia and a cactus; the pitangueira is in view from the deck', () => {
		const lookouts = mechanics.boardwalks.flatMap((b) => b.lookouts.map((l) => ({ l, b })));
		expect(lookouts.map(({ l }) => l.id)).toEqual(['mirante-bromelia', 'mirante-cacto']);
		for (const { l, b } of lookouts) {
			expect(
				polylineDistance(
					[
						[b.start.x, b.start.z],
						[b.end.x, b.end.z]
					],
					l.position.x,
					l.position.z
				)
			).toBeLessThan(1e-9);
			const walk = new Boardwalk(b);
			expect(walk.action(l.position, false)).toBe(true);
			const s = subjects.find((x) => x.position.x === l.target.x && x.position.z === l.target.z);
			if (!s) throw new Error(l.id);
			expect(photographable(l.camera, s), l.id).toBe(true);
		}
		const eyes = mechanics.boardwalks.flatMap((b) => {
			const out = [];
			for (let t = 0; t <= 1; t += 0.1)
				out.push({
					x: b.start.x + (b.end.x - b.start.x) * t,
					y: b.start.y + (b.end.y - b.start.y) * t + 1.6,
					z: b.start.z + (b.end.z - b.start.z) * t
				});
			return out;
		});
		for (const species of RESTINGA_SUBJECTS.map((r) => r.species)) {
			const s = subjects.find((x) => x.species === species);
			if (!s) throw new Error(species);
			expect(
				eyes.some((e) => photographable(e, s)),
				species
			).toBe(true);
			expect((content.plants ?? []).some((p) => p.species === species && p.x === s.position.x)).toBe(true);
		}
		expect(level.missions[3].triggers).toEqual(['foto-bromelia', 'foto-pitangueira', 'foto-cacto']);
	});

	it('flags the restinga off the boardwalk as fragile ground the runtime warns about', () => {
		const restinga = fragile.find((f) => f.kind === 'restinga');
		if (restinga?.shape !== 'polygon') throw new Error('restinga');
		expect(content.text[restinga.text]?.text).toContain('frágil');
		for (let z = -148; z <= -12; z += 4)
			for (const x of [6, 20, 38])
				expect(insidePolygon(restinga.points, x - OX, z - OZ), `${x},${z}`).toBe(true);
		for (const x of [-10, 45]) expect(insidePolygon(restinga.points, x - OX, -80 - OZ)).toBe(false);
		// Stepping off is possible: the restinga is walkable ground.
		expect(reached(...toLocal([20, -100]))).toBe(true);
	});
});

describe('the Praia: story data and reachability', () => {
	it('has missions P1–P4: the beach clean-up first, then any order', () => {
		expect(level.missions.map((m) => [m.id, m.key, m.name, m.requires, m.count])).toEqual([
			[1, 'limpeza-da-praia', 'Limpeza da praia', [], 8],
			[2, 'pocas-de-mare', 'Poças de maré', [1], 4],
			[3, 'tartaruga-no-costao', 'Tartaruga no costão', [1], 2],
			[4, 'restinga', 'Restinga', [1], 3]
		]);
	});

	it('scatters 8 pieces of trash on the beach, most of them plastic, for the counter', () => {
		const trash = level.collectibles.filter((c) => c.kind === 'trash');
		expect(trash).toHaveLength(8);
		const materials = content.trashMaterials ?? {};
		for (const t of trash) {
			expect(materials[t.variant], t.variant).toBeDefined();
			expect(world.zones[cell(t.x, t.z)], t.id).toBe(ZONE.beach);
			expect(reached(t.x, t.z), t.id).toBe(true);
		}
		expect(trash.filter((t) => materials[t.variant] === 'plastic').length).toBeGreaterThan(trash.length / 2);
	});

	it('reaches every place on the ground from the north portal, the only way in', () => {
		for (const p of groundTargets(level)) expect(reached(p.x, p.z), p.id).toBe(true);
		expect(world.problems).toEqual([]);
		const portal = ENTRIES.praia.at[0] - OX;
		expect(world.flags[160 * side + portal] & FLAG.walkable).toBeTruthy();
		for (const x of [20, 120]) expect(world.flags[160 * side + x] & FLAG.walkable).toBe(0);
		expect(world.flags[80 * side] & FLAG.walkable).toBe(0);
	});

	it('puts the checkpoints at the way in, the beach, the costão and the restinga, on reachable ground', () => {
		expect([level.start.id, ...level.checkpoints.map((c) => c.id)]).toEqual([
			'entrada',
			'praia',
			'costao',
			'restinga'
		]);
		for (const c of [level.start, ...level.checkpoints])
			expect(reached(c.spawn.x, c.spawn.z), c.id).toBe(true);
	});

	it('writes every text in pt-BR, each fact keyed with its source to check', () => {
		const keys = [
			...level.missions.flatMap((m) => m.dialogue),
			...content.homes.map((h) => h.fact),
			...fragile.map((f) => f.text),
			'PRAIA_MARCAS_VOLTE'
		];
		for (const key of keys) expect(content.text[key]?.text, key).toBeTruthy();
		const facts = Object.entries(content.text).filter(([key]) => key.startsWith('FACT_'));
		expect(facts.length).toBeGreaterThanOrEqual(10);
		for (const [key, t] of facts)
			expect(t.source === 'TODO-SOURCE' || !!t.source?.startsWith('https://'), key).toBe(true);
		for (const [key, t] of Object.entries(content.text))
			if (!key.startsWith('FACT_')) expect(t.source, key).toBeUndefined();
	});

	it("follows PARK.md's trail to the costão and marks the trails the Reserva's way", () => {
		expect(level.trails.map((t) => t.id)).toEqual(Object.keys(TRAILS));
		expect(level.trails[0].points.map(([x, z]) => [x + OX, z + OZ])).toEqual(
			expect.arrayContaining([
				[70, 0],
				[60, -30],
				[30, -60],
				[6, -80],
				[-12, -88]
			])
		);
		expect(TRAIL_MARKS).toEqual(RESERVA_TRAIL_MARKS);
		for (const t of level.trails) {
			let length = 0;
			for (let k = 1; k < t.points.length; k++)
				length += distance(t.points[k - 1][0], t.points[k - 1][1], t.points[k][0], t.points[k][1]);
			const marks = content.trailMarks.filter((m) => m.trail === t.id);
			expect(marks, t.id).toHaveLength(Math.max(1, Math.floor(length / TRAIL_MARKS.spacing + 0.5)));
			for (const [x, z] of t.points) expect(reached(x, z), `${t.id} ${x},${z}`).toBe(true);
		}
	});
});

describe('the Praia: animals and plants', () => {
	it('homes green turtles in the water, crabs on the rocks, seabirds, and the saíra and sabiá at the forest edge', () => {
		const homes = Object.fromEntries(content.homes.map((h) => [h.species, h]));
		expect(Object.keys(homes).sort()).toEqual(Object.keys(HOMES).sort());
		const at = (s: string) => [homes[s].x + OX, homes[s].z + OZ] as [number, number];
		expect(H(...(at('tartaruga-verde').map(Math.round) as [number, number]))).toBeLessThan(WATER_LEVEL);
		expect(insidePolygon(COSTAO, ...at('caranguejo-de-pedra'))).toBe(true);
		expect(insidePolygon(COSTAO, ...at('atoba'))).toBe(true);
		for (const s of ['saira', 'sabia']) {
			expect(at(s)[0]).toBeGreaterThanOrEqual(40);
			expect(at(s)[0]).toBeLessThanOrEqual(50);
		}
		expect(world.animals.map((a) => a.species)).toEqual(['sabia']);
	});

	it('keeps the forest from x 40, a few palms in the restinga, ground cover and its plants under the 1,600 cap', () => {
		const plants = content.plants ?? [];
		const total = world.trees.count + world.rocks.count + world.decorations.count + plants.length;
		expect(total).toBeLessThanOrEqual(MAX_INSTANCES);
		for (let k = 0; k < world.trees.count; k++) {
			const x = world.trees.x[k] + OX;
			const species = TREE_SPECIES[world.trees.kind[k]];
			expect(x, species).toBeGreaterThanOrEqual(12);
			if (x < 39.5) expect(['jeriva', 'embauba']).toContain(species);
		}
		expect(world.counts['tree:jeriva']).toBeGreaterThan(10);
		const cactus = plants.filter((p) => p.species === 'cacto').length;
		const pitanga = plants.filter((p) => p.species === 'pitangueira').length;
		expect(cactus).toBeGreaterThan(8);
		expect(pitanga).toBeGreaterThan(8);
		for (const p of plants) {
			expect(p.x + OX).toBeGreaterThanOrEqual(6);
			expect(p.x + OX).toBeLessThanOrEqual(38);
			expect(Math.abs(p.y - ground(p.x, p.z))).toBeLessThan(1e-4);
		}
		expect(world.counts['decoration:bromelia'] + world.counts['decoration:bush']).toBeGreaterThan(300);
		expect(world.counts['decoration:beach-grass']).toBeGreaterThan(20);
	});
});
