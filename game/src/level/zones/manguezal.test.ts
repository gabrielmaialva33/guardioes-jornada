import { describe, expect, it } from 'vitest';
import { JUMP_HEIGHT } from '../../engine/constants.ts';
import { jumpReach as engineReach } from '../../engine/graybox.ts';
import { Boardwalk } from '../../mechanics/boardwalk.ts';
import { Canoe } from '../../mechanics/canoe.ts';
import { checksumOf } from '../../survival/checksum.ts';
import { FLAG, TREE_SPECIES, WALK_SLOPE, WATER_LEVEL, ZONE } from '../../survival/types.ts';
import { distance, insidePolygon, polygonEdgeDistance, polylineDistance } from '../geometry.ts';
import { buildManguezalZone, cellOf, deckAt, jumpReach, loopVertices, reachTargets } from './manguezal.ts';
import {
	ARRIVAL_TRAIL,
	BOARDWALK,
	CANOE,
	CRAB_BANKS,
	HIDE,
	JUNCTION,
	LEVEE,
	MAX_INSTANCES,
	PATCH,
	SEAM_KEEP,
	TIDAL,
	TIDE
} from './manguezal-layout.ts';
import { MANGUE_MISSION_NAMES, MANGUE_TEXT } from './manguezal-text.ts';
import { buildPark, buildParkFresh } from './park.ts';
import { buildSkeletonZone } from './zone.ts';

/**
 * Zone 'manguezal' (PARK.md §5.2, P30), measured from the built output. The
 * layout gives world points; the output is zone-local (x + 40, z − 160).
 *
 * Its golden checksums live with the other zones' in golden.test.ts (they
 * move with the Reserva's heights, which the zone stitches to).
 */
const zone = buildManguezalZone(buildPark());
const { world, level } = zone;
const { content } = level;
const OX = zone.offsetX;
const OZ = zone.offsetZ;
const n = world.grid;
const rows = world.heights.length / n;
const local = ([x, z]: readonly [number, number]): [number, number] => [x - OX, z - OZ];
const walkable = (q: number) => (world.flags[q] & FLAG.walkable) !== 0;
const onDeck = (q: number) => (world.flags[q] & FLAG.crossing) !== 0;

/** The surface underfoot at each vertex: the deck's height where there is one (from the content's decks), else the ground. */
const surface = Float32Array.from(world.heights);
for (let q = 0; q < surface.length; q++) {
	if (!onDeck(q)) continue;
	const i = q % n;
	const y = deckAt(content.decks, i, (q - i) / n);
	if (!Number.isNaN(y)) surface[q] = y;
}

/**
 * Reachability rebuilt from the output alone (vale.test.ts's): walkable
 * vertices, 8 neighbours without cutting corners, a rise of at most WALK_SLOPE
 * per unit, decks at their own height, and the canoe as one link between the
 * two landings' exits when `canoe`.
 */
function reachable(canoe: boolean): Uint8Array {
	const seen = new Uint8Array(n * rows);
	const [a, b] = content.canoes[0].landings.map((l) => cellOf(l.exit.x, l.exit.z));
	const start = cellOf(level.spawn.x, level.spawn.z);
	const queue = [start];
	seen[start] = 1;
	for (let head = 0; head < queue.length; head++) {
		const q = queue[head];
		const i = q % n;
		const j = (q - i) / n;
		for (let dz = -1; dz <= 1; dz++)
			for (let dx = -1; dx <= 1; dx++) {
				if (dx === 0 && dz === 0) continue;
				if (i + dx < 0 || i + dx >= n || j + dz < 0 || j + dz >= rows) continue;
				const next = q + dz * n + dx;
				if (seen[next] || !walkable(next)) continue;
				const diagonal = dx !== 0 && dz !== 0;
				if (diagonal && !(walkable(q + dx) && walkable(q + dz * n))) continue;
				if (Math.abs(surface[next] - surface[q]) > WALK_SLOPE * (diagonal ? 1.41 : 1)) continue;
				seen[next] = 1;
				queue.push(next);
			}
		if (canoe && (q === a || q === b)) {
			const other = q === a ? b : a;
			if (!seen[other]) {
				seen[other] = 1;
				queue.push(other);
			}
		}
	}
	return seen;
}

const onFoot = reachable(false);
const withCanoe = reachable(true);
const reached = (seen: Uint8Array, x: number, z: number) => seen[cellOf(x, z)] === 1;

/**
 * The best jump from any `from` vertex to any `to` vertex: the smallest margin
 * left after a full-speed jump (jumpReach of the rise, from a rail's top where
 * the take-off is a deck), with 0.5 u of footing either side. Positive
 * everywhere means no jump crosses.
 */
function closestJump(
	from: Uint8Array,
	to: (q: number) => boolean
): { spare: number; at: [number, number]; to: [number, number] } {
	let best = {
		spare: Number.POSITIVE_INFINITY,
		at: [0, 0] as [number, number],
		to: [0, 0] as [number, number]
	};
	const R = 9;
	for (let q = 0; q < from.length; q++) {
		if (!to(q)) continue;
		const i = q % n;
		const j = (q - i) / n;
		for (let b = Math.max(0, j - R); b <= Math.min(rows - 1, j + R); b++)
			for (let a = Math.max(0, i - R); a <= Math.min(n - 1, i + R); a++) {
				const p = b * n + a;
				if (!from[p]) continue;
				const takeoff = surface[p] + (onDeck(p) ? BOARDWALK.railHeight : 0);
				const rise = surface[q] - takeoff;
				if (rise > JUMP_HEIGHT) continue;
				const spare = distance(a, b, i, j) - 2 * 0.5 - jumpReach(rise);
				if (spare < best.spare) best = { spare, at: [a + OX, b + OZ], to: [i + OX, j + OZ] };
			}
	}
	return best;
}

describe('the Manguezal: build', () => {
	it("uses the engine's own jump numbers", () => {
		for (const rise of [-6, -3, 0, 1.5, 4]) expect(jumpReach(rise)).toBeCloseTo(engineReach(rise), 9);
	});

	it('builds without problems, and the same bits every time', () => {
		expect(world.problems).toEqual([]);
		expect(checksumOf(world)).toBe(world.checksum);
		expect(checksumOf(level)).toBe(level.checksum);
		const again = buildManguezalZone(buildParkFresh());
		expect([again.world.checksum, again.level.checksum]).toEqual([world.checksum, level.checksum]);
	});

	it('leaves the seam with the Reserva as the skeleton stitched it', () => {
		const skeleton = buildSkeletonZone('manguezal', buildPark());
		expect(skeleton.world.grid).toBe(n);
		expect(Array.from(world.heights.subarray(0, SEAM_KEEP * n))).toEqual(
			Array.from(skeleton.world.heights.subarray(0, SEAM_KEEP * n))
		);
	});
});

describe('the Manguezal: the high tide', () => {
	it('floods the mangrove 0.9 u deep as sea, too deep to wade, past its shore', () => {
		let checked = 0;
		for (let q = 0; q < world.heights.length; q++) {
			const i = q % n;
			const x = i + OX;
			const z = (q - i) / n + OZ;
			if (!insidePolygon(TIDAL, x, z) || polygonEdgeDistance(TIDAL, x, z) < TIDE.shore) continue;
			if (world.zones[q] === ZONE.river) continue;
			if (polylineDistance(ARRIVAL_TRAIL, x, z) < LEVEE.halfWidth + (LEVEE.top - TIDE.floor) / LEVEE.slope)
				continue;
			const banks = [...CRAB_BANKS, [40, 214] as const, PATCH.centre];
			if (banks.some(([bx, bz]) => distance(x, z, bx, bz) < PATCH.radius + TIDE.shore)) continue;
			expect(world.zones[q]).toBe(ZONE.sea);
			expect(world.heights[q]).toBeLessThanOrEqual(TIDE.floor + 1e-6);
			expect(WATER_LEVEL - world.heights[q]).toBeGreaterThan(0.65);
			expect(walkable(q) && !onDeck(q)).toBe(false);
			checked++;
		}
		expect(checked).toBeGreaterThan(5000);
	});

	it('raises the arrival trail on a sandy levee, dry from the portal to the first pier', () => {
		for (let k = 1; k < ARRIVAL_TRAIL.length; k++) {
			const [ax, az] = local(ARRIVAL_TRAIL[k - 1]);
			const [bx, bz] = local(ARRIVAL_TRAIL[k]);
			for (let t = 0; t <= 1; t += 0.05) {
				const q = cellOf(ax + (bx - ax) * t, az + (bz - az) * t);
				expect(world.heights[q]).toBeGreaterThanOrEqual(LEVEE.top - 1e-6);
				expect(onFoot[q]).toBe(1);
			}
		}
	});

	it('shows mud on the crab banks and the propagule patch, 0.6 u over the water', () => {
		for (const bank of content.banks) {
			const q = cellOf(bank.x, bank.z);
			expect(world.heights[q]).toBeCloseTo(TIDE.mud, 5);
			expect(world.zones[q]).toBe(ZONE.mangrove);
			expect(walkable(q)).toBe(true);
		}
		expect(content.banks.map((b) => b.id)).toEqual([
			'banco-1',
			'banco-2',
			'banco-3',
			'banco-4',
			'banco-5',
			'banco-defeso',
			'clareira-propagulos'
		]);
	});
});

describe('the Manguezal: the boardwalk', () => {
	const chords = content.decks.slice(0, BOARDWALK.segments);
	const byId = (id: string) => {
		const deck = content.decks.find((d) => d.id === id);
		if (!deck) throw new Error(id);
		return deck;
	};

	it('closes a loop of 36 chords of radius 26 round (24, 256), each end meeting the next', () => {
		const [cx, cz] = local(BOARDWALK.centre);
		expect(chords.map((c) => c.id)).toEqual(chords.map((_, k) => `passarela-${k + 1}`));
		chords.forEach((c, k) => {
			expect(distance(c.from.x, c.from.z, cx, cz)).toBeCloseTo(BOARDWALK.radius, 9);
			expect(c.to).toEqual(chords[(k + 1) % chords.length].from);
			expect(c.halfWidth * 2).toBe(BOARDWALK.width);
		});
		expect(loopVertices()).toHaveLength(BOARDWALK.segments);
	});

	it('connects every deck: the spurs and the second pier leave from loop vertices, the first pier from the levee', () => {
		const vertices = loopVertices();
		const starts: Record<string, number> = {
			'ramal-esconderijo': JUNCTION.hide,
			'ramal-propagulos': JUNCTION.patch,
			'pier-desembarque': JUNCTION.pier
		};
		for (const [id, v] of Object.entries(starts)) {
			const d = byId(id);
			expect(distance(d.from.x, d.from.z, vertices[v][0], vertices[v][1])).toBeLessThan(1e-9);
			expect(d.from.y).toBe(chords[v].from.y);
		}
		const tip = local(ARRIVAL_TRAIL[ARRIVAL_TRAIL.length - 1]);
		expect(byId('pier-embarque').from).toEqual({ x: tip[0], y: LEVEE.top, z: tip[1] });
		expect(byId('plataforma-propagulos').from).toEqual(byId('ramal-propagulos').to);
		// The hide's deck holds the spur's end.
		const hide = byId('esconderijo');
		const spur = byId('ramal-esconderijo');
		expect(deckAt([hide], spur.to.x, spur.to.z)).toBe(BOARDWALK.y);
		// Every deck reaches every other on the deck graph (ends within another deck's width).
		const linked = new Set(['passarela-1']);
		for (let changed = true; changed; ) {
			changed = false;
			for (const d of content.decks) {
				if (linked.has(d.id)) continue;
				const touches = content.decks.some(
					(e) =>
						linked.has(e.id) &&
						([d.from, d.to].some((p) => !Number.isNaN(deckAt([e], p.x, p.z))) ||
							[e.from, e.to].some((p) => !Number.isNaN(deckAt([d], p.x, p.z))))
				);
				if (touches) {
					linked.add(d.id);
					changed = true;
				}
			}
		}
		expect([...linked].sort()).toEqual(
			content.decks
				.map((d) => d.id)
				.filter((id) => id !== 'pier-embarque')
				.sort()
		);
	});

	it('stays 1.5 u over the water, never steeper than 0.5 per u, and arches 2.6 u over the canoe channel', () => {
		for (const d of content.decks) {
			const len = distance(d.from.x, d.from.z, d.to.x, d.to.z);
			expect(Math.abs(d.to.y - d.from.y) / len).toBeLessThanOrEqual(0.5);
			expect(Math.min(d.from.y, d.to.y)).toBeGreaterThanOrEqual(PATCH.platformY);
		}
		const channel = content.canoes[0].channel;
		const ends = content.canoes[0].landings.map((l) => l.water);
		let over = 0;
		for (let k = 1; k < channel.length; k++)
			for (let t = 0; t <= 1; t += 0.02)
				for (let off = -CANOE.halfWidth; off <= CANOE.halfWidth; off += 0.25) {
					const a = channel[k - 1];
					const b = channel[k];
					const len = distance(a.x, a.z, b.x, b.z);
					const x = a.x + (b.x - a.x) * t - ((b.z - a.z) / len) * off;
					const z = a.z + (b.z - a.z) * t + ((b.x - a.x) / len) * off;
					if (ends.some((e) => distance(e.x, e.z, x, z) < 4)) continue;
					const y = deckAt(content.decks, x, z);
					if (Number.isNaN(y)) continue;
					expect(y - WATER_LEVEL).toBeGreaterThanOrEqual(BOARDWALK.archOverWater - 1e-9);
					over++;
				}
		expect(over).toBeGreaterThan(50);
	});

	it('rails every deck but at the spurs, the piers’ ends and the patch’s step; screens the hide towards the roost', () => {
		const screens = content.rails.filter((r) => r.height === HIDE.screenHeight);
		expect(screens).toHaveLength(2);
		// No rail crosses the way onto a spur at its junction.
		const vertices = loopVertices();
		for (const v of Object.values(JUNCTION)) {
			const spur = content.decks.find(
				(d) => distance(d.from.x, d.from.z, vertices[v][0], vertices[v][1]) < 1e-9
			);
			if (!spur) throw new Error(`no spur at ${v}`);
			const len = distance(spur.from.x, spur.from.z, spur.to.x, spur.to.z);
			const px = spur.from.x + ((spur.to.x - spur.from.x) * 1.1) / len;
			const pz = spur.from.z + ((spur.to.z - spur.from.z) * 1.1) / len;
			const blocked = content.rails.some(
				(r) => Math.sqrt(segment2(r.x0, r.z0, r.x1, r.z1, px, pz)) < 0.3 + 0.5
			);
			expect(blocked).toBe(false);
		}
		const outer = content.rails.filter((r) => r.height === BOARDWALK.railHeight).length;
		expect(outer).toBeGreaterThan(2 * BOARDWALK.segments);
	});
});

function segment2(ax: number, az: number, bx: number, bz: number, x: number, z: number) {
	const dx = bx - ax;
	const dz = bz - az;
	const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)));
	return (x - ax - t * dx) ** 2 + (z - az - t * dz) ** 2;
}

describe('the Manguezal: the canoe is the only way over', () => {
	const [first, second] = content.canoes[0].landings;

	it('reaches the first landing on foot, and nothing past the water', () => {
		expect(reached(onFoot, first.exit.x, first.exit.z)).toBe(true);
		expect(reached(onFoot, second.exit.x, second.exit.z)).toBe(false);
		for (const d of content.decks)
			if (d.id !== 'pier-embarque') expect(reached(onFoot, d.to.x, d.to.z), d.id).toBe(false);
		for (const id of ['desembarque', 'propagulos', 'esconderijo']) {
			const c = level.checkpoints.find((p) => p.id === id);
			if (!c) throw new Error(id);
			expect(reached(onFoot, c.spawn.x, c.spawn.z), id).toBe(false);
		}
	});

	it('reaches every story place with the canoe; the trash from the deck beside it', () => {
		for (const p of reachTargets(level)) expect(reached(withCanoe, p.x, p.z), p.id).toBe(true);
		for (const c of level.collectibles.filter((p) => p.kind === 'trash')) {
			let near = false;
			for (let q = 0; q < withCanoe.length && !near; q++) {
				if (!withCanoe[q] || !onDeck(q)) continue;
				const i = q % n;
				const j = (q - i) / n;
				const feet = { x: i, y: surface[q], z: j };
				near =
					Math.hypot(feet.x - c.x, feet.y - c.y, feet.z - c.z) <= c.radius + 0.35 &&
					Math.abs(feet.y - c.y) <= 1.4;
			}
			expect(near, c.id).toBe(true);
		}
	});

	it('cannot be jumped: no vertex reached on foot is within a full-speed jump of the other side', () => {
		// The other side: what only the canoe reaches (the decks, the patch).
		const jump = closestJump(onFoot, (q) => withCanoe[q] === 1 && !onFoot[q]);
		expect(jump.spare, `from ${jump.at} to ${jump.to}`).toBeGreaterThan(0);
	});

	it('keeps the crab banks out of a jump from the boardwalk, even from its rails', () => {
		// The banks' mud: walkable, reached by nothing.
		const banks = content.banks.filter((b) => b.id.startsWith('banco'));
		const onBank = (q: number) => {
			const i = q % n;
			const j = (q - i) / n;
			return (
				walkable(q) && !withCanoe[q] && banks.some((b) => distance(i, j, b.x, b.z) <= b.radius + TIDE.shore)
			);
		};
		const jump = closestJump(withCanoe, onBank);
		expect(jump.spare, `from ${jump.at} to ${jump.to}`).toBeGreaterThan(0);
		for (const [x, z] of CRAB_BANKS.map(local)) expect(reached(withCanoe, x, z)).toBe(false);
	});

	it('boards and lands the canoe at both landings (mechanics/canoe.ts)', () => {
		const canoe = new Canoe(content.canoes[0]);
		expect(canoe.board({ ...first.exit })).toBe(true);
		canoe.position.x = second.water.x;
		canoe.position.z = second.water.z;
		expect(canoe.leave()).toBe(true);
		expect(canoe.position).toEqual(second.exit);
		for (const l of [first, second]) {
			expect(distance(l.water.x, l.water.z, l.exit.x, l.exit.z)).toBeLessThanOrEqual(3);
			expect(deckAt(content.decks, l.exit.x, l.exit.z)).toBe(BOARDWALK.y);
		}
	});

	it('floats the canoe on water at least 0.8 u deep wherever its hull can go, clear of trunks', () => {
		const channel = content.canoes[0].channel;
		const t = world.trees;
		for (let k = 1; k < channel.length; k++) {
			const a = channel[k - 1];
			const b = channel[k];
			const len = distance(a.x, a.z, b.x, b.z);
			for (let s = 0; s <= 1; s += 0.02)
				for (let off = -(CANOE.halfWidth - 1); off <= CANOE.halfWidth - 1; off += 0.5) {
					const x = a.x + (b.x - a.x) * s - ((b.z - a.z) / len) * off;
					const z = a.z + (b.z - a.z) * s + ((b.x - a.x) / len) * off;
					const q = cellOf(x, z);
					expect([ZONE.sea, ZONE.river]).toContain(world.zones[q]);
					expect(WATER_LEVEL - world.heights[q], `${x + OX}, ${z + OZ}`).toBeGreaterThanOrEqual(0.8);
				}
		}
		const path = channel.map((p) => [p.x, p.z] as [number, number]);
		for (let k = 0; k < t.count; k++)
			expect(polylineDistance(path, t.x[k], t.z[k])).toBeGreaterThan(CANOE.halfWidth);
	});
});

describe('the Manguezal: story data', () => {
	it('has missions M1–M5: the crossing first, then any order', () => {
		expect(level.missions.map((m) => [m.id, m.key, m.name, m.requires])).toEqual([
			[1, 'travessia-canoa', 'Travessia de canoa', []],
			[2, 'caranguejo-uca', 'Caranguejo-uçá', [1]],
			[3, 'propagulos', 'Propágulos', [1]],
			[4, 'lixo-raizes', 'Lixo nas raízes', [1]],
			[5, 'colhereiros', MANGUE_MISSION_NAMES[4], [1]]
		]);
		const ids = new Set([
			...level.triggers.map((t) => t.id),
			...level.collectibles.map((c) => c.id),
			...level.planting.map((p) => p.id)
		]);
		for (const m of level.missions) {
			expect(m.triggers).toHaveLength(m.count);
			for (const id of m.triggers) expect(ids.has(id), id).toBe(true);
		}
		expect(level.missions.map((m) => m.count)).toEqual([1, 5, 6, 5, 1]);
		expect(content.colhereiros.time).toBe('dusk');
	});

	it('writes every text in pt-BR, each fact keyed with its source still to check', () => {
		const keys = [...level.missions.flatMap((m) => m.dialogue), ...content.homes.map((h) => h.fact)];
		for (const key of keys) expect(MANGUE_TEXT[key], key).toBeDefined();
		for (const [key, value] of Object.entries(MANGUE_TEXT)) {
			if (key.startsWith('FACT_'))
				expect(value.source === 'TODO-SOURCE' || !!value.source?.startsWith('https://'), key).toBe(true);
			expect(value.text).not.toMatch(/\b(alun[oa]s?|escola|PENAP|TODO)\b/i);
		}
		for (const l of level.landmarks) expect(l.label.length).toBeGreaterThan(0);
	});

	it('watches each crab from its own stretch of deck: no two crab triggers overlap', () => {
		const watch = level.triggers.filter((t) => t.id.startsWith('caranguejo-'));
		expect(watch).toHaveLength(CRAB_BANKS.length);
		for (let a = 0; a < watch.length; a++)
			for (let b = a + 1; b < watch.length; b++)
				expect(distance(watch[a].x, watch[a].z, watch[b].x, watch[b].z)).toBeGreaterThan(
					watch[a].radius + watch[b].radius
				);
	});

	it('puts checkpoints at the portal, the first landing, the second, the patch and the hide', () => {
		expect([level.start, ...level.checkpoints].map((c) => c.id)).toEqual([
			'chegada',
			'embarque',
			'desembarque',
			'propagulos',
			'esconderijo'
		]);
		for (const c of [level.start, ...level.checkpoints]) {
			const q = cellOf(c.spawn.x, c.spawn.z);
			expect(withCanoe[q], c.id).toBe(1);
			expect(c.spawn.y).toBeCloseTo(surface[q], 1);
		}
	});

	it('plants six propagules on a ring in the patch, and catches five pieces of trash in the roots', () => {
		const [px, pz] = local(PATCH.centre);
		expect(level.planting).toHaveLength(PATCH.spots);
		for (const p of level.planting) {
			expect(distance(p.x, p.z, px, pz)).toBeCloseTo(PATCH.ring, 9);
			expect(p.y).toBeCloseTo(TIDE.mud, 5);
		}
		const trash = level.collectibles.filter((c) => c.kind === 'trash');
		expect(trash.map((c) => c.variant)).toEqual(['bottle', 'bag', 'can', 'bottle', 'bag']);
		for (const c of trash) expect(world.zones[cellOf(c.x, c.z)]).toBe(ZONE.sea);
	});

	it('specs a Boardwalk per deck, the hide’s with a lookout on the roost (mechanics/boardwalk.ts)', () => {
		const { boardwalks } = content.mechanics;
		expect(boardwalks).toHaveLength(content.decks.length);
		const hide = boardwalks.find((b) => b.id === 'esconderijo');
		if (!hide) throw new Error('no hide');
		const walk = new Boardwalk(hide);
		expect(walk.action(hide.lookouts[0].position, false)).toBe(true);
		const [rx, rz] = local(HIDE.roost);
		expect(hide.lookouts[0].target).toMatchObject({ x: rx, z: rz });
	});

	it('marks the trail and the loop with mico paws', () => {
		const byTrail = (id: string) => content.trailMarks.filter((m) => m.trail === id);
		expect(byTrail('trilha-mangue').length).toBeGreaterThanOrEqual(3);
		expect(byTrail('passarela')).toHaveLength(8);
		for (const m of byTrail('passarela')) expect(m.on).toBe('post');
	});
});

describe('the Manguezal: animals and plants', () => {
	it('homes the caranguejos-uçás, the colhereiros on their roost, a garça-branca and the capivaras by the river', () => {
		expect(content.homes.map((h) => [h.species, h.time])).toEqual([
			['caranguejo-uca', 'day'],
			['colhereiro', 'dusk'],
			['garca-branca', 'day'],
			['capivara', 'day']
		]);
		expect(world.animals.map((a) => a.species)).toEqual(['caranguejo-uca']);
		const capivara = content.homes[3];
		expect(reached(onFoot, capivara.x, capivara.z)).toBe(true);
	});

	it('grows red mangroves over the flood, forest inland, under the 1,600 cap, none on a deck', () => {
		const t = world.trees;
		const mangue = TREE_SPECIES.indexOf('mangue-vermelho');
		expect(world.counts.instances).toBeLessThanOrEqual(MAX_INSTANCES);
		let mangroves = 0;
		for (let k = 0; k < t.count; k++) {
			const wet = insidePolygon(TIDAL, t.x[k] + OX, t.z[k] + OZ);
			expect(t.kind[k] === mangue, `${t.x[k] + OX}, ${t.z[k] + OZ}`).toBe(wet);
			if (wet) mangroves++;
			for (const d of content.decks) {
				const { x, z } = { x: t.x[k], z: t.z[k] };
				expect(Math.sqrt(segment2(d.from.x, d.from.z, d.to.x, d.to.z, x, z))).toBeGreaterThan(
					d.halfWidth + 0.5
				);
			}
		}
		expect(mangroves).toBeGreaterThan(200);
		// No trunk in the flood is a step: their colliders rise past a jump from the deck.
		for (const block of world.blocks)
			for (let k = 0; k < block.cylinders.length; k += 5)
				if (insidePolygon(TIDAL, block.cylinders[k] + OX, block.cylinders[k + 2] + OZ))
					expect(block.cylinders[k + 1] + block.cylinders[k + 4]).toBeGreaterThan(
						BOARDWALK.archOverWater + WATER_LEVEL + BOARDWALK.railHeight + JUMP_HEIGHT
					);
	});
});
