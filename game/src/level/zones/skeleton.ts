/**
 * Macro skeletons of the four new zones (PARK.md §2): smooth height fields,
 * no detail and no content yet, that later zone data shapes by hand.
 *
 * - Vale das Cachoeiras: a floor rising 20 → 30 to the east, a ridge carrying
 *   the F1 portal causeway in (26 by x 200), and past the Cachoeira Grande's
 *   wall (x 246–252) an upper valley rising 50 → 60 to the spring.
 * - Copa das Árvores: a forest floor rising 30 → 40 to the north and east.
 * - Praia e Costão and Manguezal: the Reserva's coast profile (world-gen's
 *   macro, calibrated on LEVEL.md §3) measured from park-plan.py's coast line
 *   inland, the costão's raised rock and its tide pools, and the mangrove's
 *   mud flats between 0 and 1.5.
 *
 * Every function is pure and exact (survival/random.ts's rules): the same
 * bits in any engine. The park river is carved into these by river.ts.
 */
import { valueNoise } from '../../survival/noise.ts';
import { macroHeight } from '../../world-gen/macro.ts';
import { smooth } from '../../world-gen/math.ts';
import { insidePolygon, polygonEdgeDistance } from '../geometry.ts';
import { COAST, COSTAO, MANGUE, PARK_SEED, TIDE_POOLS, type XZ, type ZoneId } from './spec.ts';

/** The Reserva's coast-to-serra-foot distance (world-gen macro.ts COSTAO_FOOT). */
const FOOT = 132;

/** park-plan.py's coast line at z: x of the shore, by linear interpolation along the sea's east chain. */
export function coastLine(z: number): number {
	if (z <= COAST[0][1]) return COAST[0][0];
	for (let k = 1; k < COAST.length; k++) {
		const [ax, az] = COAST[k - 1];
		const [bx, bz] = COAST[k];
		if (z <= bz) return az === bz ? bx : ax + ((bx - ax) * (z - az)) / (bz - az);
	}
	return COAST[COAST.length - 1][0];
}

/**
 * The coast profile at (x, z): world-gen's calibrated macro (sea, beach,
 * restinga, baixada, encosta, serra) read by the distance from the shore
 * near it, and by x itself inland, so the serra stays where the Reserva's is
 * however the shore bends.
 */
export function coastProfile(x: number, z: number): number {
	const e = x - coastLine(z);
	const inland = smooth(10, 40, e);
	return macroHeight(e + (x - e) * inland, FOOT);
}

const insideness = (polygon: readonly XZ[], x: number, z: number) =>
	insidePolygon(polygon, x, z) ? polygonEdgeDistance(polygon, x, z) : 0;

/** Praia e Costão: the coast, the costão's raised rock (up to 6.5 u, steep sides) and shallow tide pools at its foot. */
function praia(x: number, z: number): number {
	let h = coastProfile(x, z);
	const rock = insideness(COSTAO, x, z);
	if (rock > 0) h = Math.max(h, 1.5 + Math.min(5, 1.6 * rock));
	const dx = x - TIDE_POOLS[0];
	const dz = z - TIDE_POOLS[1];
	const pool = Math.sqrt(dx * dx + dz * dz);
	if (pool < 5) h -= 0.6 * (1 - smooth(0, 5, pool));
	return h;
}

/** Manguezal: the coast, and inside the mangrove mud flats from −0.2 at its rim to 1.2, blended over 6 u. */
function manguezal(x: number, z: number): number {
	const h = coastProfile(x, z);
	const inside = insideness(MANGUE, x, z);
	if (inside <= 0) return h;
	const flat = -0.2 + 1.4 * smooth(0, 30, inside);
	return h + (Math.min(flat, 1.5) - h) * smooth(0, 6, inside);
}

/** The Vale's floor: 20 → 30 eastwards, plus the ridge the F1 causeway runs on (26 by x 200). */
function valeFloor(x: number, z: number): number {
	const floor = 20 + 10 * smooth(170, 240, x);
	const dz = z - 70;
	const ridge = 2.5 * (1 - smooth(4, 14, dz < 0 ? -dz : dz)) * (1 - smooth(200, 236, x));
	return floor + ridge;
}

/** Vale das Cachoeiras: the floor, then the Cachoeira Grande's wall up to the upper valley (50 → 60 at the spring). */
function vale(x: number, z: number): number {
	const floor = valeFloor(x, z);
	const upper = 50 + 10 * smooth(252, 300, x);
	return floor + (upper - floor) * smooth(246, 252, x);
}

/** Gentle rolling of the Copa's floor, ±1 u at ~90 u. */
const copaSeed = (PARK_SEED ^ 0x0c09a) | 0;

/** Copa das Árvores: forest floor 30 → 40, rising north and east, gently rolling. */
function copa(x: number, z: number): number {
	return 31 + 6 * smooth(0, 140, -z) + 2 * smooth(180, 300, x) + valueNoise(x * 0.011, z * 0.011, copaSeed);
}

/** The skeleton of a new zone at world (x, z). */
export function skeletonHeight(zone: Exclude<ZoneId, 'reserva'>, x: number, z: number): number {
	switch (zone) {
		case 'vale':
			return vale(x, z);
		case 'copa':
			return copa(x, z);
		case 'praia':
			return praia(x, z);
		case 'manguezal':
			return manguezal(x, z);
	}
}
