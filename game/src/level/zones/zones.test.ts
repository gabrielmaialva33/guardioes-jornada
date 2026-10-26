import { describe, expect, it } from 'vitest';
import { checksumOf } from '../../survival/checksum.ts';
import { FLAG, WALK_SLOPE, ZONE } from '../../survival/types.ts';
import { buildStoryWorld } from '../build.ts';
import { insidePolygon } from '../geometry.ts';
import { RIVER, STORY_SEED, STORY_VERSION } from '../layout.ts';
import { buildPark, buildParkFresh, buildZone } from './park.ts';
import {
	BUILD_ORDER,
	COSTAO,
	ENTRIES,
	MANGUE,
	PARK_RIVER,
	PARK_SEED,
	PARK_ZONES,
	RESERVA_RIVER_SPAN,
	SEAMS,
	ZONE_IDS,
	type ZoneId,
	zoneOfChunk
} from './spec.ts';
import { buildSkeletonZone, type ZoneBuild, zoneHeight } from './zone.ts';

const park = buildPark();
const story = buildStoryWorld();
const skeletons = ZONE_IDS.filter((id): id is Exclude<ZoneId, 'reserva'> => id !== 'reserva');

/** World (x, z) of every vertex of a zone, with its height and flags. */
function* vertices(b: ZoneBuild) {
	const { world } = b;
	for (let j = 0; j <= b.depth; j++)
		for (let i = 0; i <= b.width; i++) {
			const q = j * world.grid + i;
			yield {
				x: b.offsetX + i,
				z: b.offsetZ + j,
				h: world.heights[q],
				f: world.flags[q],
				zone: world.zones[q]
			};
		}
}

describe('the park layout (PARK.md §2)', () => {
	it('places the five zones on their chunk rectangles, without overlap', () => {
		expect(
			[PARK_ZONES.reserva, PARK_ZONES.vale, PARK_ZONES.copa, PARK_ZONES.praia, PARK_ZONES.manguezal].map(
				(z) => [z.x0, z.z0, z.x1, z.z1]
			)
		).toEqual([
			[0, 0, 160, 160],
			[160, 0, 320, 160],
			[160, -160, 320, 0],
			[-40, -160, 160, 0],
			[-40, 160, 160, 320]
		]);
		let chunks = 0;
		for (let cz = -6; cz <= 9; cz++)
			for (let cx = -3; cx <= 9; cx++) {
				const owners = ZONE_IDS.filter((id) => {
					const z = PARK_ZONES[id];
					return cx >= z.cx0 && cx <= z.cx1 && cz >= z.cz0 && cz <= z.cz1;
				});
				expect(owners.length).toBeLessThanOrEqual(1);
				expect(zoneOfChunk(cx, cz)).toBe(owners[0] ?? null);
				chunks += owners.length;
			}
		expect(chunks).toBe(16 + 16 + 16 + 20 + 20);
		expect(PARK_SEED).toBe(STORY_SEED);
		expect(BUILD_ORDER).toEqual(expect.arrayContaining([...ZONE_IDS]));
	});

	it("follows park-plan.py's river, the Reserva's stretch exactly the level's, and the water only falls", () => {
		const plan = [
			[300, 20],
			[272, 30],
			[256, 38],
			[238, 46],
			[210, 42],
			[180, 34],
			[132, 30],
			[118, 42],
			[104, 58],
			[94, 76],
			[84, 94],
			[70, 112],
			[56, 128],
			[40, 144],
			[28, 160],
			[18, 190],
			[6, 214],
			[-8, 232],
			[-26, 240]
		];
		const stations = PARK_RIVER.map((s) => [s.x, s.z]);
		let k = 0;
		for (const p of plan) {
			while (k < stations.length && (stations[k][0] !== p[0] || stations[k][1] !== p[1])) k++;
			expect(k, `${p}`).toBeLessThan(stations.length);
		}
		const [a, b] = RESERVA_RIVER_SPAN;
		expect(PARK_RIVER.slice(a, b + 1).map((s) => [s.x, s.z])).toEqual(RIVER.map(([x, z]) => [x, z]));
		expect(PARK_RIVER.slice(a, b + 1).map((s) => s.water)).toEqual(
			story.world.river.points.map((p) => p.water)
		);
		for (let n = 1; n < PARK_RIVER.length; n++)
			expect(PARK_RIVER[n].water).toBeLessThanOrEqual(PARK_RIVER[n - 1].water);
		// Falls: drops steeper than 2 u per unit of run. The Cachoeira Grande (50 → 30) and the Reserva's small waterfall at (132, 30).
		const falls = PARK_RIVER.slice(1)
			.map((s, n) => {
				const a = PARK_RIVER[n];
				const run = Math.hypot(s.x - a.x, s.z - a.z);
				return { drop: a.water - s.water, at: [s.x, s.z], steep: (a.water - s.water) / run };
			})
			.filter((f) => f.steep > 2);
		expect(falls.map((f) => f.drop)).toEqual([20, expect.closeTo(5.6, 1)]);
		expect(falls[1].at).toEqual([132, 30]);
		expect(PARK_RIVER[0].water).toBeGreaterThan(58);
		expect(PARK_RIVER[PARK_RIVER.length - 1].water).toBe(-0.5);
	});
});

describe('zone builds', () => {
	it("give the Reserva the level's own world and level, checksums untouched", () => {
		const reserva = buildZone('reserva');
		expect(reserva.world.checksum).toBe(story.world.checksum);
		expect(reserva.level.checksum).toBe(story.level.checksum);
		expect(checksumOf(reserva.world)).toBe(reserva.world.checksum);
		expect(checksumOf(reserva.level)).toBe(reserva.level.checksum);
		expect(reserva.world.generatorVersion).toBe(STORY_VERSION);
		expect([reserva.offsetX, reserva.offsetZ, reserva.width, reserva.depth]).toEqual([0, 0, 160, 160]);
		expect(reserva.level.portal?.id).toBe('leste');
	});

	it.each(skeletons)('give %s the survival shapes in zone-local coordinates', (id) => {
		const b = buildZone(id);
		const spec = PARK_ZONES[id];
		const { world, level } = b;
		expect([b.offsetX, b.offsetZ, b.width, b.depth]).toEqual([
			spec.x0,
			spec.z0,
			spec.x1 - spec.x0,
			spec.z1 - spec.z0
		]);
		expect(world.size).toBe(b.width);
		expect(world.grid).toBe(b.width + 1);
		for (const a of [world.heights, world.zones, world.flags, world.baseSteps])
			expect(a).toHaveLength((b.width + 1) * (b.depth + 1));
		expect(world.blocks).toHaveLength((b.width / 40) * (b.depth / 40));
		for (const block of world.blocks) expect(block.heights).toHaveLength(21 * 21);
		expect(Object.keys(world).sort()).toEqual(Object.keys(story.world).sort());
		expect(
			Object.keys(level)
				.filter((k) => k !== 'arrival')
				.sort()
		).toEqual(
			Object.keys(story.level)
				.filter((k) => k !== 'portal')
				.sort()
		);
		expect(checksumOf(world)).toBe(world.checksum);
		expect(checksumOf(level)).toBe(level.checksum);
		expect(world.problems).toEqual([]);
		// It is entered through its PARK.md opening, on the right edge, and spawns just inside on walkable ground.
		const entry = ENTRIES[id];
		const arrival = level.arrival;
		if (!arrival) throw new Error('no arrival');
		expect(arrival.requires).toBe('mirante');
		expect(arrival.gap.side).toBe(entry.side);
		const { x, z } = level.spawn;
		expect(x).toBeGreaterThanOrEqual(0);
		expect(x).toBeLessThanOrEqual(b.width);
		expect(z).toBeGreaterThanOrEqual(0);
		expect(z).toBeLessThanOrEqual(b.depth);
		const q = Math.round(z) * world.grid + Math.round(x);
		expect(world.flags[q] & FLAG.walkable).toBeTruthy();
		expect(world.baseSteps[q]).toBe(0);
		expect(level.missions).toEqual([]);
	});
});

describe('macro skeletons (PARK.md §2)', () => {
	const at = (id: ZoneId, x: number, z: number) => zoneHeight(buildZone(id), x, z);

	it('give the Vale a 20–30 floor, its portal ridge 26, the waterfall top 50 and the spring 60', () => {
		for (const v of vertices(buildZone('vale')))
			if (v.x >= 200 && v.x <= 244 && !(v.f & FLAG.river) && Math.abs(v.z - 40) > 14) {
				expect(v.h, `${v.x},${v.z}`).toBeGreaterThanOrEqual(20);
				expect(v.h, `${v.x},${v.z}`).toBeLessThanOrEqual(30.5);
			}
		expect(at('vale', 200, 70)).toBeCloseTo(26, 0);
		expect(Math.abs(at('vale', 257, 30) - 50)).toBeLessThan(1);
		expect(Math.abs(at('vale', 300, 26) - 60)).toBeLessThan(1);
	});

	it('give the Copa a 30–40 forest floor', () => {
		for (const v of vertices(buildZone('copa')))
			if (v.x >= 200 && v.z <= -40) {
				expect(v.h, `${v.x},${v.z}`).toBeGreaterThanOrEqual(30);
				expect(v.h, `${v.x},${v.z}`).toBeLessThanOrEqual(40);
			}
	});

	it('give the coast 0–2 with the costão raised, and the mangrove 0–1.5', () => {
		let rock = 0;
		for (const v of vertices(buildZone('praia'))) {
			// Past the band that meets the Reserva's edge (its 2.5 u edge lip blends in there).
			if (v.zone === ZONE.beach && v.z < -40) {
				expect(v.h, `${v.x},${v.z}`).toBeGreaterThanOrEqual(-0.6);
				expect(v.h, `${v.x},${v.z}`).toBeLessThanOrEqual(2);
			}
			if (insidePolygon(COSTAO, v.x, v.z) && v.h > 3) rock++;
		}
		expect(rock).toBeGreaterThan(40);
		let mud = 0;
		for (const v of vertices(buildZone('manguezal')))
			if (v.zone === ZONE.mangrove) {
				mud++;
				expect(insidePolygon(MANGUE, v.x, v.z)).toBe(true);
				expect(v.h, `${v.x},${v.z}`).toBeGreaterThanOrEqual(-0.6);
				expect(v.h, `${v.x},${v.z}`).toBeLessThanOrEqual(1.5);
			}
		expect(mud).toBeGreaterThan(3000);
	});

	it('carve the park river through the Vale and the Manguezal, wet along its centre line', () => {
		for (const s of PARK_RIVER) {
			const id = (['vale', 'manguezal'] as const).find((z) => {
				const r = PARK_ZONES[z];
				return s.x > r.x0 + 2 && s.x < r.x1 - 2 && s.z > r.z0 + 2 && s.z < r.z1 - 2;
			});
			if (!id) continue;
			const b = buildZone(id);
			const q = Math.round(s.z - b.offsetZ) * b.world.grid + Math.round(s.x - b.offsetX);
			expect(b.world.flags[q] & FLAG.river, `${s.x},${s.z}`).toBeTruthy();
			expect(b.world.heights[q]).toBeLessThan(s.water);
		}
	});
});

describe('zone ↔ zone seams', () => {
	it.each(SEAMS.map((s) => [s.id, s] as const))('%s has no step anywhere on the seam', (_, seam) => {
		const fixed = buildZone(seam.fixed);
		const zone = buildZone(seam.zone);
		for (let k = seam.from; k <= seam.to; k++) {
			const [x, z] = seam.side === 'west' || seam.side === 'east' ? [seam.at, k] : [k, seam.at];
			expect(Math.abs(zoneHeight(zone, x, z) - zoneHeight(fixed, x, z)), `${x},${z}`).toBeLessThanOrEqual(
				0.25
			);
			expect(Object.is(zoneHeight(zone, x, z), zoneHeight(fixed, x, z))).toBe(true);
		}
	});

	it.each(SEAMS.filter((s) => s.crossings.length > 0).map((s) => [s.id, s] as const))(
		'%s is walkable through its crossing, 40 u into the zone',
		(_, seam) => {
			const zone = buildZone(seam.zone);
			const [dx, dz] =
				seam.side === 'west'
					? [1, 0]
					: seam.side === 'east'
						? [-1, 0]
						: seam.side === 'north'
							? [0, 1]
							: [0, -1];
			for (const [lo, hi] of seam.crossings)
				for (let a = lo; a <= hi; a++) {
					let [x, z] = seam.side === 'west' || seam.side === 'east' ? [seam.at, a] : [a, seam.at];
					let prev = zoneHeight(zone, x, z);
					for (let k = 1; k <= 40; k++) {
						x += dx;
						z += dz;
						const h = zoneHeight(zone, x, z);
						expect(Math.abs(h - prev), `${x},${z}`).toBeLessThanOrEqual(WALK_SLOPE);
						prev = h;
					}
				}
		}
	);

	it.each(skeletons)('keeps every step inside %s band within the walking limits', (id) => {
		const b = buildZone(id);
		const onSeam = (x: number, z: number) =>
			SEAMS.some(
				(s) =>
					s.zone === id &&
					(s.side === 'west' || s.side === 'east'
						? x === s.at && z >= s.from && z <= s.to
						: z === s.at && x >= s.from && x <= s.to)
			);
		const band = (x: number, z: number) =>
			SEAMS.some((s) => {
				if (s.zone !== id) return false;
				const vertical = s.side === 'west' || s.side === 'east';
				const across = vertical ? x - s.at : z - s.at;
				const along = vertical ? z : x;
				const over = along < s.from ? s.from - along : along > s.to ? along - s.to : 0;
				return across * across + over * over < 40 * 40;
			});
		const h = (x: number, z: number) => zoneHeight(b, x, z);
		let checked = 0;
		for (const v of vertices(b))
			for (const [dx, dz, limit] of [
				[1, 0, WALK_SLOPE],
				[0, 1, WALK_SLOPE],
				[1, 1, WALK_SLOPE * 1.41],
				[1, -1, WALK_SLOPE * 1.41]
			]) {
				const x2 = v.x + dx;
				const z2 = v.z + dz;
				if (x2 > b.offsetX + b.width || z2 > b.offsetZ + b.depth || z2 < b.offsetZ) continue;
				if (!band(v.x, v.z) || !band(x2, z2) || onSeam(v.x, v.z) || onSeam(x2, z2)) continue;
				// The river's carved channel keeps its own banks.
				if (v.f & FLAG.river || zoneHeight(b, x2, z2) < -0.5) continue;
				checked++;
				expect(Math.abs(h(x2, z2) - v.h), `(${v.x},${v.z})→(${x2},${z2})`).toBeLessThanOrEqual(limit + 1e-4);
			}
		expect(checked).toBeGreaterThan(5000);
	});
});

describe('determinism', () => {
	it('builds the same park every time, in any order', () => {
		const again = buildParkFresh();
		for (const id of ZONE_IDS) {
			expect(again.get(id)?.world.checksum, id).toBe(park.get(id)?.world.checksum);
			expect(again.get(id)?.level.checksum, id).toBe(park.get(id)?.level.checksum);
		}
		// The Copa from a map holding only what it reads, built in another order.
		const built = new Map<ZoneId, ZoneBuild>();
		built.set('reserva', buildZone('reserva'));
		built.set('praia', buildSkeletonZone('praia', built));
		built.set('vale', buildSkeletonZone('vale', built));
		expect(buildSkeletonZone('copa', built).world.checksum).toBe(park.get('copa')?.world.checksum);
	});
});
