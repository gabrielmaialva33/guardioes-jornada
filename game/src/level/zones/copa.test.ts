import { describe, expect, it } from 'vitest';
import { Boardwalk } from '../../mechanics/boardwalk.ts';
import { Ladder } from '../../mechanics/ladder.ts';
import { PhotoCamera, type PhotoFrame } from '../../mechanics/photo.ts';
import { heightAt } from '../../survival/terrain.ts';
import { FLAG, TREE_SPECIES, WALK_SLOPE } from '../../survival/types.ts';
import { distance, polylineDistance } from '../geometry.ts';
import { TRAIL_MARKS as RESERVA_TRAIL_MARKS } from '../layout.ts';
import { groundTargets, walkwayLine } from './copa.ts';
import {
	ANIMALS,
	LOOKOUTS,
	MAX_INSTANCES,
	STAIR,
	TOWER,
	TRAIL_MARKS,
	TRAILS,
	VOVO,
	WALKWAY,
	WALKWAY_CLEARANCE
} from './copa-layout.ts';
import { buildZone } from './park.ts';

/**
 * Zone 'copa' (PARK.md §4.2, P31), measured from the built output. World
 * coordinates where the layout gives them: local = (x − 160, z + 160).
 */
const copa = buildZone('copa');
const { world, level } = copa;
const content = level.content;
if (!content) throw new Error('the Copa has no content');
const mechanics = content.mechanics;
const OX = copa.offsetX;
const OZ = copa.offsetZ;
const n = world.grid;
const cell = (x: number, z: number) => Math.floor(z + 0.5) * n + Math.floor(x + 0.5);
const ground = (x: number, z: number) => heightAt(world.heights, x, z);
const toWorld = (p: { x: number; z: number }): [number, number] => [p.x + OX, p.z + OZ];
const boardwalks = mechanics.boardwalks;
const loop = boardwalks.slice(1);
const subjects = mechanics.photoSubjects ?? [];
const ladder = (mechanics.ladders ?? [])[0];
const stair = (mechanics.stairs ?? [])[0];
const seeds = content.seeds ?? [];

/** The forest floor's reachability, rebuilt from the output (the walkway and tower stand over it). */
function reachableGround(): Uint8Array {
	const { flags, heights } = world;
	const walkable = (q: number) => (flags[q] & FLAG.walkable) !== 0;
	const seen = new Uint8Array(n * n);
	const start = cell(level.spawn.x, level.spawn.z);
	const queue = [start];
	seen[start] = 1;
	for (let head = 0; head < queue.length; head++) {
		const q = queue[head];
		const i = q % n;
		const j = (q - i) / n;
		for (let dz = -1; dz <= 1; dz++)
			for (let dx = -1; dx <= 1; dx++) {
				if ((dx === 0 && dz === 0) || i + dx < 0 || i + dx >= n || j + dz < 0 || j + dz >= n) continue;
				const next = q + dz * n + dx;
				if (seen[next] || !walkable(next)) continue;
				const diagonal = dx !== 0 && dz !== 0;
				if (diagonal && !(walkable(q + dx) && walkable(q + dz * n))) continue;
				if (Math.abs(heights[next] - heights[q]) > WALK_SLOPE * (diagonal ? 1.41 : 1)) continue;
				seen[next] = 1;
				queue.push(next);
			}
	}
	return seen;
}
const floor = reachableGround();

/** Whether the straight line from a to b passes under the ground or through a trunk (the engine's cylinders). */
function occluded(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }): boolean {
	const len = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
	const cylinders: number[] = [];
	for (const block of world.blocks) for (const c of block.cylinders) cylinders.push(c);
	for (let s = 0.2; s < len - 0.5; s += 0.2) {
		const t = s / len;
		const x = a.x + (b.x - a.x) * t;
		const y = a.y + (b.y - a.y) * t;
		const z = a.z + (b.z - a.z) * t;
		if (y < ground(x, z) + 0.2) return true;
		for (let k = 0; k < cylinders.length; k += 5) {
			const [cx, cy, cz, r, h] = cylinders.slice(k, k + 5);
			if (Math.hypot(x - cx, z - cz) <= r && y >= cy && y <= cy + h) return true;
		}
	}
	return false;
}

/** A photo frame from `origin` aimed at `target`, 70° tall, 16:9. */
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

/** Deck points every half unit along the walkway, at eye height. */
function deckEyes(): { x: number; y: number; z: number }[] {
	const out = [];
	for (const b of boardwalks) {
		const len = Math.hypot(b.end.x - b.start.x, b.end.z - b.start.z);
		for (let s = 0; s <= len; s += 0.5) {
			const t = s / len;
			out.push({
				x: b.start.x + (b.end.x - b.start.x) * t,
				y: b.start.y + (b.end.y - b.start.y) * t + 1.6,
				z: b.start.z + (b.end.z - b.start.z) * t
			});
		}
	}
	return out;
}

describe('the Copa: forest floor', () => {
	it('keeps the forest floor at 30–40 past its seams, flat under the stair, the tower and Vovó', () => {
		for (let j = 0; j < n; j++)
			for (let i = 0; i < n; i++) {
				const [x, z] = [i + OX, j + OZ];
				if (x < 200 || z > -40) continue;
				const h = world.heights[j * n + i];
				expect(h, `${x},${z}`).toBeGreaterThanOrEqual(30);
				expect(h, `${x},${z}`).toBeLessThanOrEqual(40);
			}
		expect(stair.top.y - stair.bottom.y).toBeCloseTo(WALKWAY.deck, 9);
		expect(Math.abs(ground(stair.top.x, stair.top.z) - stair.bottom.y)).toBeLessThan(1e-4);
		expect(Math.abs(ground(ladder.base.x, ladder.base.z) - ladder.base.y)).toBeLessThan(1e-4);
		for (const [dx, dz] of [
			[2, 0],
			[0, 2],
			[-2, 0],
			[0, -2]
		])
			expect(Math.abs(ground(TOWER.at[0] - OX + dx, TOWER.at[1] - OZ + dz) - ladder.base.y)).toBeLessThan(
				1e-4
			);
	});
});

describe('the Copa: canopy walkway (C1)', () => {
	it('is a stair, an access and a closed loop of BoardwalkSpecs, end to start, about 200 u round (240, −70)', () => {
		expect(boardwalks).toHaveLength(1 + WALKWAY.sides);
		for (let k = 1; k < boardwalks.length; k++) expect(boardwalks[k].start).toEqual(boardwalks[k - 1].end);
		expect(loop[loop.length - 1].end).toEqual(loop[0].start);
		expect(stair.top).toEqual(boardwalks[0].start);
		expect(stair.boardwalk).toBe(boardwalks[0].id);
		let length = 0;
		for (const b of loop) {
			length += Math.hypot(b.end.x - b.start.x, b.end.z - b.start.z);
			expect(b.width).toBe(2);
			const [x, z] = toWorld(b.start);
			expect(distance(x, z, WALKWAY.centre[0], WALKWAY.centre[1])).toBeCloseTo(WALKWAY.radius, 9);
			expect(() => new Boardwalk(b)).not.toThrow();
		}
		expect(length).toBeGreaterThan(195);
		expect(length).toBeLessThan(205);
		expect(new Set(boardwalks.map((b) => b.id)).size).toBe(boardwalks.length);
	});

	it('keeps the deck 4 u over the ground (3.7–4.3 between vertices) and gentle', () => {
		for (const b of boardwalks) {
			const len = Math.hypot(b.end.x - b.start.x, b.end.z - b.start.z);
			expect(Math.abs(b.end.y - b.start.y) / len, b.id).toBeLessThan(0.2);
			for (let t = 0; t <= 1; t += 0.05) {
				const x = b.start.x + (b.end.x - b.start.x) * t;
				const z = b.start.z + (b.end.z - b.start.z) * t;
				const clearance = b.start.y + (b.end.y - b.start.y) * t - ground(x, z);
				expect(clearance, `${b.id} ${t}`).toBeGreaterThan(3.7);
				expect(clearance, `${b.id} ${t}`).toBeLessThan(4.3);
			}
		}
		for (const b of loop) expect(b.start.y - ground(b.start.x, b.start.z)).toBeCloseTo(WALKWAY.deck, 4);
	});

	it('is climbed by a walkable stair at (225, −30) whose foot the forest floor reaches', () => {
		expect(toWorld(stair.bottom)).toEqual([...STAIR.foot]);
		const run = distance(stair.bottom.x, stair.bottom.z, stair.top.x, stair.top.z);
		expect(run).toBeCloseTo(5.6, 9);
		expect((stair.top.y - stair.bottom.y) / run).toBeLessThan(WALK_SLOPE);
		expect(floor[cell(stair.bottom.x, stair.bottom.z)]).toBe(1);
	});

	it('runs clear of every trunk, which keep off the deck', () => {
		const line = walkwayLine(content);
		for (let k = 0; k < world.trees.count; k++)
			expect(polylineDistance(line, world.trees.x[k], world.trees.z[k]), `tree ${k}`).toBeGreaterThanOrEqual(
				WALKWAY_CLEARANCE
			);
	});

	it('has 4 lookouts on its deck, each framing an animal in a crown, and the Boardwalk mechanic takes them', () => {
		const lookouts = loop.flatMap((b) => b.lookouts.map((l) => ({ l, b })));
		expect(lookouts).toHaveLength(4);
		expect(lookouts.map(({ l }) => l.id).sort()).toEqual(LOOKOUTS.map((l) => `mirante-${l.subject}`).sort());
		for (const { l, b } of lookouts) {
			// On the segment's centre line, at the deck's height there.
			const len = Math.hypot(b.end.x - b.start.x, b.end.z - b.start.z);
			const t =
				((l.position.x - b.start.x) * (b.end.x - b.start.x) +
					(l.position.z - b.start.z) * (b.end.z - b.start.z)) /
				(len * len);
			expect(t).toBeGreaterThan(0.2);
			expect(t).toBeLessThan(0.8);
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
			expect(l.position.y).toBeCloseTo(b.start.y + (b.end.y - b.start.y) * t, 9);
			expect(l.camera.y).toBeGreaterThan(l.position.y);
			const subject = subjects.find((s) => s.position.x === l.target.x && s.position.z === l.target.z);
			expect(subject, l.id).toBeDefined();
			expect(
				Math.hypot(l.target.x - l.position.x, l.target.y - l.position.y, l.target.z - l.position.z)
			).toBeLessThan(15);
			const walk = new Boardwalk(b);
			expect(walk.action(l.position, false)).toBe(true);
			expect(walk.lookout?.id).toBe(l.id);
		}
	});

	it('counts C1 done at 8 waypoints round the deck, out of reach of anyone walking under it', () => {
		const c1 = level.missions[0];
		const waypoints = level.triggers.filter((t) => t.kind === 'walkway');
		expect(waypoints).toHaveLength(8);
		expect(c1.count).toBe(8);
		expect(c1.triggers).toEqual(waypoints.map((w) => w.id));
		const line = walkwayLine(content);
		for (const w of waypoints) {
			expect(polylineDistance(line, w.x, w.z)).toBeLessThan(1e-9);
			expect(w.minY).toBeGreaterThan(ground(w.x, w.z) + 2);
			expect(w.maxY).toBeGreaterThan(w.y + 1.5);
		}
	});
});

describe('the Copa: photos from above (C2)', () => {
	it('poses a tucano, a saíra, a preguiça, a mico and a bugio in the crowns, each photographable from the deck', () => {
		expect(subjects.map((s) => s.species).sort()).toEqual(
			['bugio', 'mico-leao-dourado', 'preguica', 'saira', 'tucano'].sort()
		);
		const eyes = deckEyes();
		for (const s of subjects) {
			// Up in a crown, over a hand-placed tree of its home.
			expect(s.position.y - ground(s.position.x, s.position.z)).toBeGreaterThan(7);
			const tree = Array.from({ length: world.trees.count }, (_, k) => k).find(
				(k) =>
					Math.abs(world.trees.x[k] - s.position.x) < 1e-3 && Math.abs(world.trees.z[k] - s.position.z) < 1e-3
			);
			expect(tree, s.id).toBeDefined();
			expect(TREE_SPECIES[world.trees.kind[tree as number]]).toBe(ANIMALS[s.species].tree[0]);
			// The photo camera saves it from some point of the deck within 20 u.
			const camera = new PhotoCamera([s]);
			const from = eyes.find((e) => {
				if (Math.hypot(s.position.x - e.x, s.position.y - e.y, s.position.z - e.z) > 20) return false;
				camera.evaluate(frameAt(e, s.position), (o, t) => occluded(o, t));
				return camera.valid[0] === 1;
			});
			expect(from, s.id).toBeDefined();
		}
	});

	it("frames each lookout's subject from its camera", () => {
		for (const b of loop)
			for (const l of b.lookouts) {
				const s = subjects.find((x) => x.position.x === l.target.x && x.position.z === l.target.z);
				if (!s) throw new Error(l.id);
				const camera = new PhotoCamera([s]);
				camera.evaluate(frameAt(l.camera, l.target), (o, t) => occluded(o, t));
				expect(camera.valid[0], l.id).toBe(1);
			}
	});
});

describe('the Copa: Vovó Jequitibá (C3) and the tower (C4)', () => {
	it('makes Vovó Jequitibá a 20 u+ mother tree with a fog-free silhouette and six seeds round her', () => {
		const vovo = level.landmarks.find((l) => l.id === 'vovo-jequitiba');
		expect(vovo?.kind).toBe('jequitiba');
		expect(vovo?.label).toBe('Vovó Jequitibá');
		expect(vovo?.silhouette).toBe(true);
		expect(vovo?.height).toBeGreaterThan(20);
		expect(vovo && toWorld(vovo)).toEqual([...VOVO.at]);
		const tree = Array.from({ length: world.trees.count }, (_, k) => k).find(
			(k) => world.trees.x[k] === VOVO.at[0] - OX && world.trees.z[k] === VOVO.at[1] - OZ
		);
		expect(tree).toBeDefined();
		expect(TREE_SPECIES[world.trees.kind[tree as number]]).toBe('jequitiba');
		expect(world.trees.scale[tree as number]).toBe(VOVO.scale);
		// Her clearing: no other trunk within it.
		for (let k = 0; k < world.trees.count; k++)
			if (k !== tree)
				expect(
					distance(world.trees.x[k], world.trees.z[k], VOVO.at[0] - OX, VOVO.at[1] - OZ)
				).toBeGreaterThan(VOVO.clearing);
		expect(seeds).toHaveLength(6);
		for (const s of seeds) {
			expect(s.species).toBe('jequitiba');
			expect(s.mission).toBe(3);
			const d = distance(s.x, s.z, VOVO.at[0] - OX, VOVO.at[1] - OZ);
			expect(d).toBeGreaterThan(3);
			expect(d).toBeLessThan(7);
			expect(floor[cell(s.x, s.z)], s.id).toBe(1);
		}
		expect(level.missions[2].triggers).toEqual(seeds.map((s) => s.id));
	});

	it("climbs the 12 u tower by a LadderSpec at the props' nodes, its top reached from the floor", () => {
		expect(() => new Ladder(ladder)).not.toThrow();
		expect(ladder.top.y - ladder.base.y).toBe(TOWER.ladder.top);
		expect(ladder.radius).toBe(0.85);
		// base (0, 0, 3.2), top (0, 12, 3.2), exit (0, 12, 1.2) in the model, its +z facing west.
		const near = (p: { x: number; z: number }, along: number) => {
			const [x, z] = toWorld(p);
			expect(x).toBeCloseTo(TOWER.at[0] + TOWER.front[0] * along, 9);
			expect(z).toBeCloseTo(TOWER.at[1] + TOWER.front[1] * along, 9);
		};
		near(ladder.base, 3.2);
		near(ladder.top, 3.2);
		near(ladder.exit, 1.2);
		expect(ladder.exit.y).toBe(ladder.top.y);
		// The base is reached on foot; the ladder's own volume takes it to the top.
		expect(floor[cell(ladder.base.x, ladder.base.z)]).toBe(1);
		const climb = new Ladder(ladder);
		expect(climb.contains(ladder.base)).toBe(true);
		expect(climb.enter(ladder.base)).toBe(true);
		const top = level.triggers.find((t) => t.id === 'torre-topo');
		expect(top && [top.x, top.y, top.z]).toEqual([ladder.exit.x, ladder.exit.y, ladder.exit.z]);
		expect(level.missions[3].triggers).toEqual(['torre-topo']);
		const tower = level.landmarks.find((l) => l.kind === 'tower');
		expect(tower?.silhouette).toBe(true);
		expect(tower && toWorld(tower)).toEqual([...TOWER.at]);
		// Its front (local +z) faces the trail's end.
		expect([tower?.yawS, tower?.yawC]).toEqual([...TOWER.front]);
	});
});

describe('the Copa: story data and reachability', () => {
	it('has missions C1–C4: the walkway first, then any order', () => {
		expect(level.missions.map((m) => [m.id, m.key, m.name, m.requires])).toEqual([
			[1, 'passarela-nas-copas', 'Passarela nas copas', []],
			[2, 'fotos-do-alto', 'Fotos do alto', [1]],
			[3, 'vovo-jequitiba', 'Vovó Jequitibá', [1]],
			[4, 'a-torre', 'A torre', [1]]
		]);
		expect(level.missions[1].triggers).toEqual(subjects.map((s) => s.id));
	});

	it('reaches every place on the floor from the way in from the Vale', () => {
		for (const p of groundTargets(level)) expect(floor[cell(p.x, p.z)], p.id).toBe(1);
		for (const t of level.trails)
			for (const [x, z] of t.points) expect(floor[cell(x, z)], `${t.id} ${x},${z}`).toBe(1);
		expect(world.problems).toEqual([]);
		// The only way out is the crossing back to the Vale.
		expect(floor[cell(222 - OX, 160)]).toBe(1);
		for (const x of [200, 250, 300]) expect(world.flags[160 * n + x - OX] & FLAG.walkable, `${x}`).toBe(0);
	});

	it('puts the checkpoints at the way in, the stair, Vovó and the tower, on reachable ground', () => {
		expect([level.start.id, ...level.checkpoints.map((c) => c.id)]).toEqual([
			'entrada',
			'escada',
			'vovo',
			'torre'
		]);
		const [, escada, vovo, torre] = [level.start, ...level.checkpoints].map((c) => c.spawn);
		expect(distance(escada.x, escada.z, stair.bottom.x, stair.bottom.z)).toBeLessThan(5);
		expect(distance(vovo.x + OX, vovo.z + OZ, VOVO.at[0], VOVO.at[1])).toBeLessThan(VOVO.clearing + 2);
		expect(distance(torre.x, torre.z, ladder.base.x, ladder.base.z)).toBeLessThan(5);
	});

	it('writes every text in pt-BR, each fact keyed with its source to check', () => {
		const keys = [
			...level.missions.flatMap((m) => m.dialogue),
			...content.homes.map((h) => h.fact),
			'COPA_MARCAS_VOLTE'
		];
		for (const key of keys) expect(content.text[key]?.text, key).toBeTruthy();
		const facts = Object.entries(content.text).filter(([key]) => key.startsWith('FACT_'));
		expect(facts.length).toBeGreaterThanOrEqual(10);
		for (const [key, t] of facts)
			expect(t.source === 'TODO-SOURCE' || !!t.source?.startsWith('https://'), key).toBe(true);
		for (const [key, t] of Object.entries(content.text))
			if (!key.startsWith('FACT_')) expect(t.source, key).toBeUndefined();
	});

	it("follows park-plan.py's trails round the walkway, marked the Reserva's way", () => {
		expect(level.trails.map((t) => t.id)).toEqual(Object.keys(TRAILS));
		expect(TRAIL_MARKS).toEqual(RESERVA_TRAIL_MARKS);
		const line = walkwayLine(content);
		for (const t of level.trails) {
			const marks = content.trailMarks.filter((m) => m.trail === t.id);
			let length = 0;
			for (let k = 1; k < t.points.length; k++)
				length += distance(t.points[k - 1][0], t.points[k - 1][1], t.points[k][0], t.points[k][1]);
			expect(marks, t.id).toHaveLength(Math.max(1, Math.floor(length / TRAIL_MARKS.spacing + 0.5)));
			// The trails go round the walkway, never under it.
			for (let s = 0; s <= length; s += 1) {
				let rest = s;
				for (let k = 1; k < t.points.length; k++) {
					const [ax, az] = t.points[k - 1];
					const [bx, bz] = t.points[k];
					const seg = distance(ax, az, bx, bz);
					if (rest <= seg) {
						const x = ax + ((bx - ax) * rest) / seg;
						const z = az + ((bz - az) * rest) / seg;
						if (distance(x, z, stair.bottom.x, stair.bottom.z) > 4)
							expect(polylineDistance(line, x, z), `${t.id} ${x},${z}`).toBeGreaterThan(t.halfWidth + 1);
						break;
					}
					rest -= seg;
				}
			}
		}
	});
});

describe('the Copa: animals and the old forest', () => {
	it('homes tucanos, saíras, a preguiça, micos and bugios in their trees', () => {
		expect(content.homes.map((h) => h.species).sort()).toEqual(
			['bugio', 'mico-leao-dourado', 'preguica', 'saira', 'tucano'].sort()
		);
		// The bugios howl when groups meet, at any hour; the sloth browses young leaves of a big broadleaf crown.
		expect(content.homes.find((h) => h.species === 'bugio')?.time).toBe('day');
		expect(['jequitiba', 'ipe-rosa', 'ipe-amarelo', 'pau-brasil']).toContain(ANIMALS.preguica.tree[0]);
		for (const h of content.homes) {
			expect(h.tree).not.toBeNull();
			expect(content.text[h.fact]?.source).toMatch(/^(TODO-SOURCE$|https:\/\/)/);
		}
		expect(world.animals.map((a) => a.species).sort()).toEqual(
			['bugio', 'mico-leao-dourado', 'preguica', 'tucano'].sort()
		);
	});

	it('grows the oldest forest under the 1,600 cap: tall jequitibás first, a dense understorey', () => {
		const total = world.trees.count + world.rocks.count + world.decorations.count;
		expect(total).toBeLessThanOrEqual(MAX_INSTANCES);
		expect(world.counts.instances).toBe(total);
		const counts = TREE_SPECIES.map((s) => world.counts[`tree:${s}`]);
		expect(Math.max(...counts)).toBe(world.counts['tree:jequitiba']);
		for (const s of ['jequitiba', 'embauba', 'xaxim', 'jucara'])
			expect(world.counts[`tree:${s}`], s).toBeGreaterThan(80);
		let scale = 0;
		for (let k = 0; k < world.trees.count; k++) scale += world.trees.scale[k];
		expect(scale / world.trees.count).toBeGreaterThan(1.1);
		expect(world.counts['decoration:fern'] + world.counts['decoration:bromelia']).toBeGreaterThan(550);
	});
});
