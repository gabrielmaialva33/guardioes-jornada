import { describe, expect, it } from 'vitest';
import { jumpReach as engineReach } from '../../engine/graybox.ts';
import { SuspensionBridge } from '../../mechanics/bridge.ts';
import { heightAt } from '../../survival/terrain.ts';
import { DECORATION_KINDS, FLAG, TREE_SPECIES, WALK_SLOPE, ZONE } from '../../survival/types.ts';
import { distance, polylineDistance } from '../geometry.ts';
import { TRAIL_MARKS as RESERVA_TRAIL_MARKS } from '../layout.ts';
import { buildZone } from './park.ts';
import { PARK_RIVER } from './spec.ts';
import { faceX, jumpReach, reachTargets } from './vale.ts';
import {
	BRIDGE,
	CAMERA_TRUNK,
	FALL,
	HOMES,
	LOOKOUT,
	MAX_INSTANCES,
	POOL,
	SPRING,
	STONES,
	TRAIL_CLEARANCE,
	TRAIL_MARKS,
	TRAILS
} from './vale-layout.ts';

/**
 * Zone 'vale' (PARK.md §4.1, P25), measured from the built output in world
 * coordinates where the layout gives them (local = world − 160 in x).
 */
const vale = buildZone('vale');
const { world, level } = vale;
const content = level.content;
if (!content) throw new Error('the Vale has no content');
const OX = vale.offsetX;
const n = world.grid;
const cell = (x: number, z: number) => Math.floor(z + 0.5) * n + Math.floor(x + 0.5);
/** Height and flags at a world vertex. */
const H = (x: number, z: number) => world.heights[z * n + x - OX];
const F = (x: number, z: number) => world.flags[z * n + x - OX];
const ground = (x: number, z: number) => heightAt(world.heights, x - OX, z);
const obby = level.obbies[0];

/**
 * Reachability rebuilt from the output alone (level/reachability.test.ts's
 * second implementation): walkable vertices, 8 neighbours without cutting
 * corners, a rise of at most WALK_SLOPE per unit, bridge decks at the height
 * of their line, and the stones as one jump up from before the take-off to
 * the landing when every jump of the run is within reach.
 */
function reachable(use: { bridge: boolean; stones: boolean }): Uint8Array {
	const { flags } = world;
	const surface = Float32Array.from(world.heights);
	for (let q = 0; q < n * n; q++) {
		if ((flags[q] & FLAG.crossing) === 0) continue;
		const i = q % n;
		const j = (q - i) / n;
		for (const { from, to, halfWidth } of world.crossings) {
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
	const jumps = new Map<number, number>();
	if (use.stones && runnable())
		jumps.set(
			cell(obby.takeoff.x - obby.dirX * 1.5, obby.takeoff.z - obby.dirZ * 1.5),
			cell(obby.landing.x, obby.landing.z)
		);
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
				if (dx === 0 && dz === 0) continue;
				if (i + dx < 0 || i + dx >= n || j + dz < 0 || j + dz >= n) continue;
				const next = q + dz * n + dx;
				if (seen[next] || !walkable(next)) continue;
				const diagonal = dx !== 0 && dz !== 0;
				if (diagonal && !(walkable(q + dx) && walkable(q + dz * n))) continue;
				if (Math.abs(surface[next] - surface[q]) > WALK_SLOPE * (diagonal ? 1.41 : 1)) continue;
				seen[next] = 1;
				queue.push(next);
			}
		const to = jumps.get(q);
		if (to !== undefined && !seen[to]) {
			seen[to] = 1;
			queue.push(to);
		}
	}
	return seen;
}

/** Every jump of the stones within the reach of a full-speed jump, measured from the positions. */
function runnable(): boolean {
	const ends = [
		{ x: obby.takeoff.x, y: obby.takeoff.y, z: obby.takeoff.z, r: 0 },
		...obby.pieces.map((p) => ({ x: p.x, y: p.y, z: p.z, r: p.radius }))
	];
	for (let k = 1; k < ends.length; k++) {
		const a = ends[k - 1];
		const b = ends[k];
		if (distance(a.x, a.z, b.x, b.z) - a.r - b.r > jumpReach(b.y - a.y)) return false;
	}
	return true;
}

const all = reachable({ bridge: true, stones: true });
const noBridge = reachable({ bridge: false, stones: true });
const noStones = reachable({ bridge: true, stones: false });
const reached = (seen: Uint8Array, x: number, z: number) => seen[cell(x, z)] === 1;

describe('the Vale: terrain (PARK.md §4.1)', () => {
	it("uses the engine's own jump numbers", () => {
		for (const rise of [0, 1.5, 3, 4.5]) expect(jumpReach(rise)).toBe(engineReach(rise));
	});

	it('drops the Cachoeira Grande 20 u down one sheer face, from 50 to its pool at 30', () => {
		const lip = PARK_RIVER.find((s) => s.face && s.water === FALL.top);
		expect(lip && [lip.x, lip.z]).toEqual([...FALL.lip]);
		const z = Math.round(FALL.lip[1]);
		expect(H(251, z)).toBeGreaterThan(FALL.top - 1.2);
		expect(H(250, z)).toBeLessThan(FALL.bottom);
		// The face stands one vertex wide along the fall and the stones, everywhere 15 u or more.
		for (let zz = 30; zz <= 112; zz++) {
			const x = Math.floor(faceX(zz));
			expect(H(x + 1, zz) - H(x, zz), `${x},${zz}`).toBeGreaterThan(10);
		}
		const fall = level.landmarks.find((l) => l.kind === 'waterfall');
		expect(fall?.height).toBe(20);
		expect([fall && fall.x + OX, fall?.y, fall?.z]).toEqual([FALL.lip[0], FALL.top, FALL.lip[1]]);
		expect(fall?.silhouette).toBe(true);
		expect(fall?.label).toBe('Cachoeira Grande');
	});

	it('gives the plunge pool a deep centre and a wadeable rim, on the south side only', () => {
		const [cx, cz] = POOL.b;
		expect(POOL.water - H(cx, cz)).toBeGreaterThanOrEqual(2.5);
		expect(F(cx, cz) & FLAG.walkable).toBe(0);
		expect(F(cx, cz) & FLAG.river).toBeTruthy();
		let south = 0;
		for (let z = 30; z <= 60; z++)
			for (let x = 226; x <= 250; x++) {
				const f = F(x, z);
				if (!(f & FLAG.river) || !(f & FLAG.walkable)) continue;
				const depth = POOL.water - H(x, z);
				// Within the pool's basin: shallow, and south of its axis.
				if (distance(x, z, cx, cz) > 16) continue;
				expect(depth, `${x},${z}`).toBeLessThanOrEqual(POOL.wade);
				const across = (x - POOL.a[0]) * 0.4061 + (z - POOL.a[1]) * 0.9138;
				expect(across, `${x},${z}`).toBeGreaterThan(1);
				south++;
			}
		expect(south).toBeGreaterThan(40);
		// The runtime's pool ellipse covers the basin's centre at its water.
		const { pool } = level;
		expect(pool.water).toBe(POOL.water);
		const dx = cx - OX - pool.x;
		const dz = cz - pool.z;
		const a = (dx * pool.axisX + dz * pool.axisZ) / pool.halfLength;
		const b = (-dx * pool.axisZ + dz * pool.axisX) / pool.halfWidth;
		expect(a * a + b * b).toBeLessThan(1);
	});

	it('has the spring basin at (300, 20): deep eye, wadeable rim, the upper valley at 60 round it', () => {
		const [sx, sz] = SPRING.centre;
		expect(SPRING.water - H(sx, sz)).toBeGreaterThanOrEqual(1.2);
		expect(F(sx, sz) & FLAG.walkable).toBe(0);
		let rim = 0;
		for (let z = sz - 6; z <= sz + 6; z++)
			for (let x = sx - 6; x <= sx + 6; x++)
				if (F(x, z) & FLAG.river && F(x, z) & FLAG.walkable) {
					rim++;
					expect(SPRING.water - H(x, z)).toBeLessThanOrEqual(SPRING.wade);
				}
		expect(rim).toBeGreaterThan(12);
		for (const [dx, dz] of [
			[0, -7],
			[7, 0],
			[0, 7]
		])
			expect(Math.abs(H(sx + dx, sz + dz) - 60)).toBeLessThan(1);
		expect(content.basins.map((b) => [b.id, b.water])).toEqual([
			['poco', 30],
			['nascente', 59]
		]);
	});

	it('cuts a gorge 5–7 u deep under the bridge at x 205, walls too steep to climb', () => {
		const water = world.crossings[0].water;
		const wet = [];
		for (let z = 34; z <= 50; z++) if (F(205, z) & FLAG.river) wet.push(z);
		const north = Math.min(...wet) - 1;
		const south = Math.max(...wet) + 1;
		expect(H(205, north - 1) - water).toBeGreaterThanOrEqual(6);
		expect(H(205, south + 1) - water).toBeGreaterThanOrEqual(4.5);
		// Both walls rise more than a jump in one step somewhere: nobody walks down into the gorge here.
		for (const x of [200, 205, 210, 220])
			for (const side of [-1, 1]) {
				let steepest = 0;
				for (let z = 30; z <= 54; z++) steepest = Math.max(steepest, side * (H(x, z) - H(x, z + 1)));
				expect(steepest, `${x} ${side}`).toBeGreaterThan(2);
			}
	});

	it('keeps the deck of the bridge 16 u long, from bank to bank, above the water', () => {
		const deck = world.crossings[0];
		expect(deck.kind).toBe('rope-bridge');
		expect([deck.from.x + OX, deck.from.z, deck.to.x + OX, deck.to.z]).toEqual([
			...BRIDGE.from,
			...BRIDGE.to
		]);
		expect(distance(deck.from.x, deck.from.z, deck.to.x, deck.to.z)).toBe(16);
		expect(deck.from.y - deck.water).toBeGreaterThan(5);
		expect(deck.to.y - deck.water).toBeGreaterThan(5);
		for (const end of [deck.from, deck.to]) {
			expect(F(end.x + OX, end.z) & FLAG.river).toBe(0);
			expect(Math.abs(ground(end.x + OX, end.z) - end.y)).toBeLessThan(0.05);
		}
	});
});

describe('the Vale: the stones (V5)', () => {
	const reach = jumpReach(STONES.rise);

	it('climbs 7 stones, 1.5 u higher each, from the shelf at 39.5 to the rim at 50', () => {
		expect(obby.id).toBe('stones');
		expect(obby.mission).toBe(5);
		expect(obby.pieces).toHaveLength(7);
		expect(obby.takeoff.y).toBe(39.5);
		obby.pieces.forEach((p, k) => {
			expect(p.y).toBe(39.5 + 1.5 * (k + 1));
			expect(p.bottom).toBeLessThan(p.y - 4);
		});
		expect(Math.abs(obby.pieces[6].y - obby.landing.y)).toBeLessThan(0.1);
		// The takeoff stands on the shelf, the landing on the upper valley.
		expect(Math.abs(ground(obby.takeoff.x + OX, obby.takeoff.z) - 39.5)).toBeLessThan(0.01);
		expect(obby.landing.x + OX).toBeGreaterThan(faceX(obby.landing.z));
	});

	it('keeps every gap at 0.45–0.6 of jumpReach(1.5), measured from the positions', () => {
		const ends = [
			{ x: obby.takeoff.x, z: obby.takeoff.z, y: obby.takeoff.y, r: 0 },
			...obby.pieces.map((p) => ({ x: p.x, z: p.z, y: p.y, r: p.radius }))
		];
		for (let k = 1; k < ends.length; k++) {
			const a = ends[k - 1];
			const b = ends[k];
			const gap = distance(a.x, a.z, b.x, b.z) - a.r - b.r;
			expect(gap / reach, `gap ${k}`).toBeGreaterThanOrEqual(0.45 - 1e-9);
			expect(gap / reach, `gap ${k}`).toBeLessThanOrEqual(0.6 + 1e-9);
			expect(gap).toBeCloseTo(obby.gaps[k - 1].gap, 9);
			expect(gap).toBeLessThan(engineReach(b.y - a.y));
			expect(b.y - a.y).toBe(1.5);
		}
		expect(obby.gaps.map((g) => g.fraction)).toEqual([...STONES.gapFractions]);
		expect(runnable()).toBe(true);
	});

	it('lands the last stone on the rim beside the fall', () => {
		const last = obby.pieces[6];
		expect(distance(last.x + OX, last.z, FALL.lip[0], FALL.lip[1])).toBeLessThan(8);
		let touches = false;
		for (let z = Math.floor(last.z - 2); z <= last.z + 2; z++)
			for (let x = Math.floor(last.x + OX); x <= last.x + OX + 3; x++)
				if (H(x, z) >= last.y - 0.1 && distance(x, z, last.x + OX, last.z) <= last.radius + 0.3)
					touches = true;
		expect(touches).toBe(true);
	});

	it('cannot be skipped: from the lower valley only the first stone is in reach, and the rim from none below the sixth', () => {
		const pieces = obby.pieces.map((p) => ({ ...p, x: p.x + OX }));
		for (let q = 0; q < n * n; q++) {
			if (!noStones[q]) continue;
			const x = (q % n) + OX;
			const z = (q - (q % n)) / n;
			const h = world.heights[q];
			pieces.forEach((p, k) => {
				if (k === 0) return;
				const d = distance(x, z, p.x, p.z) - p.radius;
				if (d > 6) return;
				expect(d, `stone ${k + 1} from ${x},${z}`).toBeGreaterThan(jumpReach(p.y - h));
			});
		}
		for (let q = 0; q < n * n; q++) {
			const x = (q % n) + OX;
			const z = (q - (q % n)) / n;
			if (x < faceX(z) || !(world.flags[q] & FLAG.walkable)) continue;
			pieces.slice(0, 5).forEach((p, k) => {
				const d = distance(x, z, p.x, p.z) - p.radius;
				if (d > 7) return;
				expect(d, `rim ${x},${z} from stone ${k + 1}`).toBeGreaterThan(jumpReach(world.heights[q] - p.y));
			});
		}
	});
});

describe('the Vale: reachability', () => {
	it('reaches everything on foot from the portal: the pool, the bridge, the spring', () => {
		for (const p of reachTargets(level)) expect(reached(all, p.x, p.z), p.id).toBe(true);
		expect(world.problems).toEqual([]);
		// The survival steps agree: every target has a walking distance, the spring the longest of the missions.
		for (const p of reachTargets(level))
			expect(world.baseSteps[cell(p.x, p.z)], p.id).toBeGreaterThanOrEqual(0);
		const steps = level.missions.map((m) => world.baseSteps[cell(m.target.x, m.target.z)]);
		expect(Math.max(...steps)).toBe(steps[4]);
	});

	it('needs the bridge for the north bank: V3, V4 and the climb to the Copa', () => {
		for (const id of [3, 4]) {
			const m = level.missions[id - 1];
			expect(reached(noBridge, m.target.x, m.target.z), `V${id}`).toBe(false);
		}
		expect(reached(noBridge, 222 - OX, 1)).toBe(false);
		expect(reached(all, 222 - OX, 1)).toBe(true);
		// The pool and its trash stay on the south bank.
		for (const c of level.collectibles.filter((c) => c.kind === 'trash'))
			expect(reached(noBridge, c.x, c.z), c.id).toBe(true);
	});

	it('needs the stones for the upper valley: V5 and the spring', () => {
		const v5 = level.missions[4];
		expect(reached(noStones, v5.target.x, v5.target.z)).toBe(false);
		for (const p of level.planting) expect(reached(noStones, p.x, p.z), p.id).toBe(false);
		expect(reached(noStones, obby.landing.x, obby.landing.z)).toBe(false);
		expect(reached(noStones, obby.takeoff.x, obby.takeoff.z)).toBe(true);
	});
});

describe('the Vale: story data', () => {
	it('has missions V1–V5: the arrival first, then any order', () => {
		expect(level.missions.map((m) => [m.id, m.key, m.name, m.requires])).toEqual([
			[1, 'som-da-agua', 'Siga o som da água', []],
			[2, 'poco-limpo', 'O poço limpo', [1]],
			[3, 'ponte-pensil', 'Ponte pênsil', [1]],
			[4, 'censo-muriquis', 'Censo dos muriquis', [1]],
			[5, 'nascente', 'A nascente', [1]]
		]);
		const v1 = level.missions[0].target;
		expect(distance(v1.x + OX, v1.z, LOOKOUT.at[0], LOOKOUT.at[1])).toBeLessThan(0.5);
		expect(level.missions[1].count).toBe(6);
		expect(level.missions[4].count).toBe(5);
		const ids = new Set([
			...level.triggers.map((t) => t.id),
			...level.collectibles.map((c) => c.id),
			...level.planting.map((p) => p.id)
		]);
		for (const m of level.missions) for (const t of m.triggers) expect(ids.has(t), t).toBe(true);
	});

	it('writes every text in pt-BR, each fact keyed with its source to check', () => {
		const keys = [
			...level.missions.flatMap((m) => m.dialogue),
			...content.homes.map((h) => h.fact),
			'VALE_MARCAS_VOLTE'
		];
		for (const key of keys) expect(content.text[key]?.text, key).toBeTruthy();
		const facts = Object.entries(content.text).filter(([key]) => key.startsWith('FACT_'));
		expect(facts.length).toBeGreaterThanOrEqual(10);
		for (const [key, t] of facts)
			expect(t.source === 'TODO-SOURCE' || !!t.source?.startsWith('https://'), key).toBe(true);
		for (const [key, t] of Object.entries(content.text))
			if (!key.startsWith('FACT_')) expect(t.source, key).toBeUndefined();
		for (const m of level.missions)
			expect(
				m.dialogue.some((k) => k.startsWith('FACT_')),
				m.key
			).toBe(true);
	});

	it('puts checkpoints at the portal, the pool, the bridge north end and the spring, on walkable ground', () => {
		expect([level.start.id, ...level.checkpoints.map((c) => c.id)]).toEqual([
			'portal',
			'poco',
			'ponte-norte',
			'nascente'
		]);
		const [portal, pool, north, spring] = [level.start, ...level.checkpoints].map((c) => c.spawn);
		expect(distance(portal.x + OX, portal.z, 160, 70)).toBeLessThan(8);
		expect(distance(pool.x + OX, pool.z, POOL.b[0], POOL.b[1])).toBeLessThan(16);
		expect(distance(north.x + OX, north.z, BRIDGE.to[0], BRIDGE.to[1])).toBeLessThan(5);
		expect(distance(spring.x + OX, spring.z, SPRING.centre[0], SPRING.centre[1])).toBeLessThan(12);
		for (const c of [level.start, ...level.checkpoints]) {
			const q = cell(c.spawn.x, c.spawn.z);
			expect(world.flags[q] & FLAG.walkable, c.id).toBeTruthy();
			expect(world.flags[q] & FLAG.river, c.id).toBe(0);
			expect(Math.abs(c.spawn.y - heightAt(world.heights, c.spawn.x, c.spawn.z))).toBeLessThan(1e-4);
		}
	});

	it('scatters six pieces of trash round the pool, a bottle, a can, a bag and an orange peel among them', () => {
		const trash = level.collectibles.filter((c) => c.kind === 'trash');
		expect(trash).toHaveLength(6);
		expect(trash.map((t) => t.variant)).toEqual(
			expect.arrayContaining(['bottle', 'can', 'bag', 'orange-peel'])
		);
		for (const t of trash) {
			expect(distance(t.x + OX, t.z, POOL.b[0], POOL.b[1]), t.id).toBeLessThan(18);
			expect(world.flags[cell(t.x, t.z)] & FLAG.river, t.id).toBe(0);
		}
	});
});

describe('the Vale: trails and their marks', () => {
	it("follows park-plan.py's trails", () => {
		expect(level.trails.map((t) => t.id)).toEqual(Object.keys(TRAILS));
		const main = level.trails[0].points.map(([x, z]) => [x + OX, z]);
		expect(main).toEqual([
			[160, 70],
			[200, 70],
			[222, 64],
			[236, 58]
		]);
		// No trail runs through water.
		for (const t of level.trails)
			for (const [x, z] of t.points)
				expect(world.flags[cell(x, z)] & FLAG.river, `${t.id} ${x},${z}`).toBe(0);
	});

	it('marks every trail with a mico paw about every 20 u, as the Reserva does: on a trunk by it, else a post', () => {
		expect(TRAIL_MARKS).toEqual(RESERVA_TRAIL_MARKS);
		for (const t of level.trails) {
			const marks = content.trailMarks.filter((m) => m.trail === t.id);
			let length = 0;
			for (let k = 1; k < t.points.length; k++)
				length += distance(t.points[k - 1][0], t.points[k - 1][1], t.points[k][0], t.points[k][1]);
			expect(marks, t.id).toHaveLength(Math.max(1, Math.floor(length / TRAIL_MARKS.spacing + 0.5)));
			for (const m of marks) {
				const d = polylineDistance(t.points, m.x, m.z);
				expect(m.height).toBe(TRAIL_MARKS.height);
				expect(Math.abs(m.yawC * m.yawC + m.yawS * m.yawS - 1)).toBeLessThan(1e-9);
				expect(Math.abs(m.y - heightAt(world.heights, m.x, m.z))).toBeLessThan(1e-4);
				if (m.on === 'post') {
					expect(d, `${t.id} post`).toBeGreaterThanOrEqual(t.halfWidth + TRAIL_MARKS.postOut - 1e-9);
					expect(d, `${t.id} post`).toBeLessThanOrEqual(
						t.halfWidth + TRAIL_MARKS.postOut + TRAIL_MARKS.postSearch
					);
					expect(world.flags[cell(m.x, m.z)] & FLAG.river, `${t.id} post`).toBe(0);
				} else {
					expect(d, `${t.id} trunk`).toBeLessThanOrEqual(TRAIL_MARKS.trunkReach);
					const trunk = Array.from({ length: world.trees.count }, (_, k) => k).some(
						(k) => Math.abs(world.trees.x[k] - m.x) < 1e-3 && Math.abs(world.trees.z[k] - m.z) < 1e-3
					);
					expect(trunk, `${t.id} trunk at ${m.x},${m.z}`).toBe(true);
				}
			}
		}
		// The forest comes up to the trails: most marks are painted on trunks.
		const onTrunks = content.trailMarks.filter((m) => m.on === 'trunk').length;
		expect(onTrunks).toBeGreaterThan(content.trailMarks.length / 2);
		expect(world.counts.trailMark).toBe(content.trailMarks.length);
	});
});

describe('the Vale: mechanics as data', () => {
	it('specs the suspension bridge (205, 52) → (205, 36), 16 u, a plank per half unit', () => {
		const [spec] = content.mechanics.bridges;
		expect([spec.start.x + OX, spec.start.z, spec.end.x + OX, spec.end.z]).toEqual([
			...BRIDGE.from,
			...BRIDGE.to
		]);
		expect(spec.planks).toBe(32);
		expect(spec.width).toBe(2);
		const bridge = new SuspensionBridge(spec);
		expect(bridge.length).toBe(16);
		expect(bridge.offsets).toHaveLength(32);
		// The north end is V3's trigger.
		const v3 = level.triggers.find((t) => t.id === 'ponte-norte');
		expect(v3 && distance(v3.x, v3.z, spec.end.x, spec.end.z)).toBeLessThan(3);
	});

	it('marks the camera-trap trunk near the muriquis (216, 12): a jequitibá with the mount on its face', () => {
		const [trap] = content.mechanics.cameraTraps;
		expect(trap.species).toBe('muriqui');
		expect(trap.ownerMission).toBe('censo-muriquis');
		expect(trap.mission).toBe(4);
		expect(
			distance(trap.trunk.x + OX, trap.trunk.z, HOMES.muriquis.at[0], HOMES.muriquis.at[1])
		).toBeLessThan(10);
		expect(distance(trap.trunk.x + OX, trap.trunk.z, CAMERA_TRUNK.at[0], CAMERA_TRUNK.at[1])).toBe(0);
		const tree = Array.from({ length: world.trees.count }, (_, k) => k).find(
			(k) => world.trees.x[k] === trap.trunk.x && world.trees.z[k] === trap.trunk.z
		);
		expect(tree).toBeDefined();
		expect(TREE_SPECIES[world.trees.kind[tree as number]]).toBe('jequitiba');
		expect(distance(trap.mount.x, trap.mount.z, trap.trunk.x, trap.trunk.z)).toBeCloseTo(
			trap.trunkRadius + 0.08,
			9
		);
		expect(trap.mount.y - trap.trunk.y).toBeCloseTo(1.2, 9);
		// It looks at the group.
		const toward = { x: trap.subject.x - trap.trunk.x, z: trap.subject.z - trap.trunk.z };
		expect(trap.yawS * toward.x + trap.yawC * toward.z).toBeGreaterThan(
			0.99 * Math.hypot(toward.x, toward.z)
		);
	});

	it('frames the pool viewpoint lookout on the fall', () => {
		const [lookout] = content.mechanics.lookouts;
		expect(distance(lookout.position.x + OX, lookout.position.z, LOOKOUT.at[0], LOOKOUT.at[1])).toBe(0);
		expect(lookout.position.y).toBeCloseTo(LOOKOUT.y, 5);
		expect(lookout.camera.y).toBeGreaterThan(lookout.position.y);
		expect(lookout.target.y).toBeGreaterThan(FALL.bottom);
		expect(lookout.target.y).toBeLessThan(FALL.top);
		expect(distance(lookout.target.x + OX, lookout.target.z, FALL.foot[0], FALL.foot[1])).toBeLessThan(2);
	});
});

describe('the Vale: animals and forest', () => {
	it('homes the muriqui group, the bugios, a sloth in a big broadleaf crown by the pool and a rare jacutinga', () => {
		const homes = Object.fromEntries(content.homes.map((h) => [h.species, h]));
		expect(Object.keys(homes)).toEqual(['muriqui', 'bugio', 'preguica', 'jacutinga']);
		expect(homes.muriqui.group).toBeGreaterThan(2);
		expect([homes.muriqui.x + OX, homes.muriqui.z]).toEqual([...HOMES.muriquis.at]);
		expect(homes.jacutinga.rarity).toBe('legendary');
		const sloth = homes.preguica;
		expect(sloth.tree).not.toBeNull();
		expect(distance(sloth.x + OX, sloth.z, POOL.b[0], POOL.b[1])).toBeLessThan(20);
		const crown = Array.from({ length: world.trees.count }, (_, k) => k).find(
			(k) => world.trees.x[k] === sloth.tree?.x && world.trees.z[k] === sloth.tree?.z
		);
		expect(crown).toBeDefined();
		expect(['jequitiba', 'ipe-rosa', 'ipe-amarelo', 'pau-brasil']).toContain(
			TREE_SPECIES[world.trees.kind[crown as number]]
		);
		// No dawn chorus for the bugios: they howl when groups meet, at any hour.
		expect(homes.bugio.time).toBe('day');
		expect(world.animals.map((a) => a.species)).toEqual(['preguica', 'bugio', 'muriqui']);
		for (const h of content.homes) expect(world.flags[cell(h.x, h.z)] & FLAG.river, h.id).toBe(0);
	});

	it('grows a dense Atlantic Forest under the 1,600 cap, close to the trails, with clearings at the pool and the spring', () => {
		const total = world.trees.count + world.rocks.count + world.decorations.count;
		expect(total).toBeLessThanOrEqual(MAX_INSTANCES);
		expect(world.counts.instances).toBe(total);
		expect(world.trees.count).toBeGreaterThan(450);
		for (const s of ['jucara', 'xaxim', 'embauba', 'jequitiba'])
			expect(world.counts[`tree:${s}`], s).toBeGreaterThan(40);
		const understorey = ['fern', 'bromelia'].map((k) => world.counts[`decoration:${k}`]);
		expect(understorey[0] + understorey[1]).toBeGreaterThan(500);
		expect(DECORATION_KINDS).toContain('fern');
		let nearTrail = 0;
		for (let k = 0; k < world.trees.count; k++) {
			const x = world.trees.x[k];
			const z = world.trees.z[k];
			const d = Math.min(...level.trails.map((t) => polylineDistance(t.points, x, z)));
			// Trunks keep the trail clear, but the forest comes right up to it.
			if (d < TRAIL_CLEARANCE + 1.5) nearTrail++;
			const wx = x + OX;
			expect(distance(wx, z, SPRING.centre[0], SPRING.centre[1]), `tree ${wx},${z}`).toBeGreaterThan(
				SPRING.clearing
			);
			if (wx < faceX(z)) {
				const axis = polylineDistance([POOL.a, POOL.b], wx, z);
				expect(axis, `tree ${wx},${z}`).toBeGreaterThan(POOL.clearing);
			}
			expect(world.flags[cell(x, z)] & FLAG.river, `tree ${wx},${z}`).toBe(0);
		}
		expect(nearTrail).toBeGreaterThan(30);
		for (let q = 0; q < n * n; q++)
			if (world.zones[q] === ZONE.river) expect(world.flags[q] & FLAG.river).toBeTruthy();
	});
});
