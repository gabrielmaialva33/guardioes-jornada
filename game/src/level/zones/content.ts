/**
 * What a zone with content adds to the StoryLevel shapes (PARK.md §4–§7):
 * zone missions and their trigger, landmark and text kinds, trail marks,
 * the new mechanics' specs as data, animal homes and still water. Types plus
 * small pure helpers, Worker-safe like the rest of the zone builder. The
 * mechanics' spec types come from game/src/mechanics as types only.
 */
import type { BoardwalkSpec, Lookout } from '../../mechanics/boardwalk.ts';
import type { BridgeSpec } from '../../mechanics/bridge.ts';
import type { LadderSpec } from '../../mechanics/ladder.ts';
import type { PhotoSubject } from '../../mechanics/photo.ts';
import { floor } from '../../survival/noise.ts';
import type { Placed, Point } from '../../survival/types.ts';
import { arcLengths, direction, distance, headingTo, polylineDistance } from '../geometry.ts';
import type {
	Landmark,
	LandmarkKind,
	Mission,
	SeedSpot,
	Trail,
	TrailMark,
	TriggerKind,
	TriggerZone
} from '../types.ts';
import type { XZ } from './spec.ts';

/** pB's trail mark and seed spot (level/types.ts, the Reserva's Act 1): the zones use the very same shapes. */
export type { SeedSpot, TrailMark };

/** A zone mission: the Reserva's Mission with the zone's own key (its id counts from 1 within the zone). */
export interface ZoneMission extends Omit<Mission, 'key'> {
	key: string;
}

/**
 * Trigger kinds the zones add: a lookout, a bridge end, a camera-trap mount, a
 * point on a raised walkway, ground the runtime warns about stepping on
 * (`fragile`), a place to call for help by radio.
 */
export type ZoneTriggerKind =
	| TriggerKind
	| 'lookout'
	| 'bridge'
	| 'camera-trap'
	| 'walkway'
	| 'fragile'
	| 'radio';
export interface ZoneTrigger extends Omit<TriggerZone, 'kind'> {
	kind: ZoneTriggerKind;
}

/** Landmark kinds the zones add. */
export type ZoneLandmarkKind = LandmarkKind | 'lookout' | 'spring' | 'camera-trunk' | 'zone-sign' | 'tower';
export interface ZoneLandmark extends Omit<Landmark, 'kind'> {
	kind: ZoneLandmarkKind;
}

/** A camera-trap mount (mechanics CameraTrap(species, ownerMission)): the marked trunk, and where the device sits. */
export interface CameraTrapSpot {
	id: string;
	species: string;
	/** Mission key that owns it: the trap resolves after any other mission is completed. */
	ownerMission: string;
	mission: number;
	/** The trunk's base centre and radius. */
	trunk: Point;
	trunkRadius: number;
	/** The device on the trunk's face, about 1.2 u up, and the unit heading it looks along (yawC, yawS). */
	mount: Point;
	yawC: number;
	yawS: number;
	/** Where the photo's subject lives (the home it watches). */
	subject: Point;
}

/** A fixed stair from the ground up to a raised walkway (the props' `passarela-escada`): straight, `width` wide. */
export interface Stair {
	id: string;
	/** Feet at its foot on the ground and at its head on the deck. */
	bottom: Point;
	top: Point;
	width: number;
	/** The boardwalk segment its head meets. */
	boardwalk: string;
}

/** The new mechanics a zone uses, as their own spec types (game/src/mechanics). */
export interface ZoneMechanics {
	bridges: BridgeSpec[];
	/** Raised walkways as straight segments, in walking order; a loop's last end is its first start. */
	boardwalks: BoardwalkSpec[];
	/** Lookouts that stand on their own ground, not on a boardwalk. */
	lookouts: Lookout[];
	cameraTraps: CameraTrapSpot[];
	ladders?: LadderSpec[];
	stairs?: Stair[];
	/** Animals posed for the photo camera, where a mission needs them found. */
	photoSubjects?: PhotoSubject[];
}

export type Rarity = 'common' | 'uncommon' | 'rare' | 'legendary';

/** An animal's home in a zone, album species or not (the jacutinga is not in survival's ALBUM yet). */
export interface ZoneHome extends Point {
	id: string;
	species: string;
	/** How many live there (a group), and how far they roam. */
	group: number;
	radius: number;
	rarity: Rarity;
	/** When it is out: PARK.md §7. */
	time: 'day' | 'dawn' | 'dusk';
	/** The tree it lives in, when it has one. */
	tree: Point | null;
	/** Text key of its fact. */
	fact: string;
}

/**
 * Still water outside the river's channel: a capsule from `a` to `b` (a
 * circle when they meet) of radius `radius`, its surface at `water`. Shallow
 * ground under it (`wade` deep or less) is walkable: wading.
 */
export interface Basin {
	id: string;
	a: XZ;
	b: XZ;
	radius: number;
	water: number;
	wade: number;
}

/** One player-facing text (pt-BR). Facts carry their source; 'TODO-SOURCE' until the coordinator checks it. */
export interface ZoneText {
	text: string;
	source?: string;
}

/**
 * Ground the runtime warns about when someone steps on it off the paths (the
 * restinga, a tide pool): a polygon or a circle (zone-local), and the text key
 * of the warning.
 */
export type FragileArea = { id: string; kind: string; text: string } & (
	| { shape: 'polygon'; points: XZ[] }
	| { shape: 'circle'; x: number; z: number; radius: number }
);

/** An animal posed at one spot, for a model (the props' `custom-*`), with what it is doing. */
export interface CreatureSpot extends Placed {
	id: string;
	species: string;
	/** The props' model, when one exists. */
	model: string;
	/** 'feeding', 'entangled', 'resting'…: what the runtime animates and the missions read. */
	state: string;
	/** The tide pool or place it belongs to. */
	place: string;
}

/** A plant of a kind survival's placements do not have (cactus, pitangueira…), placed like one. */
export interface PlantSpot extends Placed {
	id: string;
	species: string;
	scale: number;
}

export interface ZoneContent {
	trailMarks: TrailMark[];
	mechanics: ZoneMechanics;
	homes: ZoneHome[];
	basins: Basin[];
	/** Fallen seeds to pick up (pB's Act 1 shape). */
	seeds?: SeedSpot[];
	fragile?: FragileArea[];
	creatures?: CreatureSpot[];
	plants?: PlantSpot[];
	/** Trash variants by material, for a count of plastic against the rest. */
	trashMaterials?: Record<string, 'plastic' | 'other'>;
	/** Every text key the missions, homes and landmarks use. */
	text: Record<string, ZoneText>;
}

/** The facing angles of level/layout.ts FACING (engine yaw, 0 faces +z), copied so zones never import the layout. */
// biome-ignore lint/suspicious/noApproximativeNumericConstant: the determinism scan allows no Math member but the exact operations; this literal is Math.PI's exact double (as level/layout.ts).
const PI = 3.141592653589793;
export const FACING = {
	north: PI,
	northEast: (3 * PI) / 4,
	east: PI / 2,
	southEast: PI / 4,
	south: 0,
	southWest: -PI / 4,
	west: -PI / 2,
	northWest: (-3 * PI) / 4
} as const;
export type Facing = keyof typeof FACING;
const SQRT_HALF = Math.sqrt(0.5);
/** Unit headings (yawC, yawS) of the facings: front = (yawS, yawC). */
export const HEADING: Record<Facing, [number, number]> = {
	north: [-1, 0],
	northEast: [-SQRT_HALF, SQRT_HALF],
	east: [0, 1],
	southEast: [SQRT_HALF, SQRT_HALF],
	south: [1, 0],
	southWest: [SQRT_HALF, -SQRT_HALF],
	west: [0, -1],
	northWest: [-SQRT_HALF, -SQRT_HALF]
};

/** How trail marks are placed: level/layout.ts TRAIL_MARKS's fields (vale-layout.ts copies its values). */
export interface TrailMarkRule {
	spacing: number;
	trunkReach: number;
	postOut: number;
	postSearch: number;
	height: number;
}

/**
 * Trail marks (PARK.md §3) as the Reserva places them (level/build.ts
 * trailMarks): about every `spacing` u along each trail, at the middle of
 * equal pieces; on the nearest trunk within `trunkReach` of the spot, else on
 * a post `postOut` off the trail's edge (right, then left, or up to
 * `postSearch` further out where a trail doubles back), facing the trail.
 * If none has been seen for 30 s, Iara says on the radio to turn back.
 */
export function placeTrailMarks(
	trails: readonly Trail[],
	trees: readonly { x: number; z: number }[],
	ground: (x: number, z: number) => number,
	rule: TrailMarkRule
): TrailMark[] {
	const marks: TrailMark[] = [];
	for (const trail of trails) {
		const arcs = arcLengths(trail.points);
		const length = arcs[arcs.length - 1];
		const count = Math.max(1, floor(length / rule.spacing + 0.5));
		for (let k = 0; k < count; k++) {
			const arc = (length * (k + 0.5)) / count;
			let seg = 0;
			while (seg + 2 < arcs.length && arcs[seg + 1] < arc) seg++;
			const [ax, az] = trail.points[seg];
			const [bx, bz] = trail.points[seg + 1];
			const t = (arc - arcs[seg]) / (arcs[seg + 1] - arcs[seg]);
			const px = ax + (bx - ax) * t;
			const pz = az + (bz - az) * t;
			let best = -1;
			let bestD = rule.trunkReach;
			for (let n = 0; n < trees.length; n++) {
				const d = distance(px, pz, trees[n].x, trees[n].z);
				if (d <= bestD) {
					bestD = d;
					best = n;
				}
			}
			const [dx, dz] = direction(ax, az, bx, bz);
			const [mx, mz] =
				best >= 0
					? [trees[best].x, trees[best].z]
					: postBeside(trails, px, pz, dx, dz, trail.halfWidth, rule);
			const [yawC, yawS] = headingTo(mx, mz, px, pz);
			marks.push({
				trail: trail.id,
				on: best >= 0 ? 'trunk' : 'post',
				x: mx,
				y: ground(mx, mz),
				z: mz,
				yawC,
				yawS,
				height: rule.height
			});
		}
	}
	return marks;
}

/** A post off the trail's edge, on the first side clear of every trail by `postOut` (level/build.ts postBeside). */
function postBeside(
	trails: readonly Trail[],
	px: number,
	pz: number,
	dx: number,
	dz: number,
	halfWidth: number,
	rule: TrailMarkRule
): XZ {
	for (let extra = 0; extra <= rule.postSearch; extra += 0.5)
		for (const side of [1, -1]) {
			const out = side * (halfWidth + rule.postOut + extra);
			const x = px - dz * out;
			const z = pz + dx * out;
			if (trails.every((t) => polylineDistance(t.points, x, z) >= t.halfWidth + rule.postOut - 1e-9))
				return [x, z];
		}
	throw new Error(`no room for a trail post near ${px},${pz}`);
}
