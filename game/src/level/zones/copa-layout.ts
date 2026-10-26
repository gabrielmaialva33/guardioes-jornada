/**
 * The Copa das Árvores as control points (PARK.md §4.2, park-plan.py), in
 * world coordinates (x east, z south). copa.ts builds the zone from these.
 *
 * Shape: the park's oldest forest on a floor of 30–40, entered from the
 * Vale's north bank at (222, 0). A stair at (225, −30) climbs to the canopy
 * walkway: a 24-sided loop of radius 32 round (240, −70), 4 u over the ground,
 * whose four lookouts face into the old forest the loop rings, where the
 * animals of C2 sit in the crowns. Ground trails lead round the loop to Vovó
 * Jequitibá (210, −110) and to the observation tower (272, −100).
 */
import type { XZ } from './spec.ts';

// --- The canopy walkway (C1, C2) ---------------------------------------------------------

/**
 * A regular 24-gon (one vertex every 15°, angles from +x towards +z) of
 * radius 32 round the centre: about 200 u. Its deck is `deck` over the ground
 * at each vertex, `width` wide with rails (the props' walkway tiles); walking
 * starts at the vertex the stair's access reaches and goes round by
 * increasing angle.
 */
export const WALKWAY = {
	centre: [240, -70] as XZ,
	radius: 32,
	sides: 24,
	deck: 4,
	width: 2,
	/** Index of the vertex the access meets (120°, the loop's south-west). */
	startVertex: 8
} as const;

/**
 * The stair (props `passarela-escada`): 5.6 u long, climbing the deck's 4 u
 * northwards from its foot; the ground under it is flattened. An access deck
 * runs from its head to the loop.
 */
export const STAIR = {
	foot: [225, -30] as XZ,
	head: [225, -35.6] as XZ,
	width: 2.34,
	pad: { r0: 4, r1: 7 }
} as const;

/**
 * Lookouts: on the loop's segments (by the index of their first vertex),
 * facing into the ring, each aimed at an animal in a crown `inward` u inside
 * the deck. The bugios' giant stands 14 u inside the deck's west side, in
 * view from the walk between two lookouts.
 */
export const LOOKOUTS: readonly { segment: number; subject: string }[] = [
	{ segment: 10, subject: 'preguica' },
	{ segment: 16, subject: 'mico-leao-dourado' },
	{ segment: 22, subject: 'saira' },
	{ segment: 3, subject: 'tucano' }
];
/** How far inside the deck the lookouts' subjects sit, and where the camera stands behind the feet. */
export const LOOKOUT_VIEW = { inward: 12, cameraBack: 2.5, cameraLift: 2.4, platform: 3.8 } as const;

/** C1: waypoints on the deck, one every `every` vertices from the start, that walking the whole loop passes. */
export const WAYPOINTS = { every: 3, radius: 1.6 } as const;

// --- The animals (C2, PARK.md §4.2) ---------------------------------------------------------

/**
 * Homes and photo subjects. `tree` is the crown's species and scale (a
 * hand-placed tree); `lift` is the subject's height over the ground there.
 * The four lookout animals' places come from LOOKOUTS; the bugios' is given.
 */
export const ANIMALS: Record<
	string,
	{ group: number; radius: number; tree: [string, number]; lift: number; at?: XZ }
> = {
	tucano: { group: 3, radius: 10, tree: ['jequitiba', 1.6], lift: 11 },
	saira: { group: 4, radius: 8, tree: ['embauba', 1.3], lift: 9 },
	// The sloth browses young leaves of many broadleaf trees: a big crown, not an embaúba in particular.
	preguica: { group: 1, radius: 2, tree: ['jequitiba', 1.5], lift: 8 },
	'mico-leao-dourado': { group: 5, radius: 10, tree: ['ipe-rosa', 1.4], lift: 8 },
	bugio: { group: 4, radius: 12, tree: ['jequitiba', 2], lift: 12, at: [223.6, -76.8] }
};
/** No trunk within this of a lookout's line to its subject: a clear view through the crowns. */
export const VIEW_LANE = 2.5;

// --- Vovó Jequitibá (C3) ------------------------------------------------------------------

/**
 * The named mother tree: a jequitibá at scale `scale` (crown over 20 u; the
 * Reserva's at 2.2 stands 18), in a clearing, with six fallen seeds round it.
 */
export const VOVO = {
	at: [210, -110] as XZ,
	scale: 3,
	/** Crown top over the ground, for the fog-free silhouette. */
	height: 24.5,
	clearing: 9,
	seeds: { count: 6, radius: 5, pick: 1.2 },
	flat: { r0: 2.5, r1: 5 }
} as const;

// --- The tower (C4) --------------------------------------------------------------------------

/**
 * The observation tower (props `custom-torre-observacao`, 18.46 u with its
 * roof): its origin on a flattened pad, its front (model +z, the ladder side)
 * facing west, towards the trail. The props' ladder nodes, in the model's
 * axes: base (0, 0, 3.2), top (0, 12, 3.2), exit (0, 12, 1.2), radius 0.85.
 */
export const TOWER = {
	at: [272, -100] as XZ,
	/** Model +z goes to world (−1, 0): engine yaw −π/2. */
	front: [-1, 0] as XZ,
	height: 18.5,
	pad: { r0: 4.5, r1: 7 },
	footprint: 3.2,
	ladder: { base: 3.2, top: 12, exit: 1.2, radius: 0.85 }
} as const;

// --- Ground trails, checkpoints and signs -----------------------------------------------------

export const TRAIL_HALF_WIDTH = 2;
export const TRAIL_CLEARANCE = 2.9;
/** level/layout.ts TRAIL_MARKS (the Reserva's rule), copied so zones never import the layout. */
export const TRAIL_MARKS = { spacing: 20, trunkReach: 6, postOut: 0.6, postSearch: 3, height: 1.6 } as const;

/** park-plan.py TRAILS["Copa"]: up from the Vale to the stair, then round the loop to Vovó and to the tower. */
export const TRAILS: Record<string, readonly XZ[]> = {
	'copa-subida': [
		[222, 0],
		[223.5, -15],
		[225, -29]
	],
	'copa-jequitiba': [
		[224, -29],
		[206, -42],
		[199, -62],
		[200, -84],
		[205, -100]
	],
	'copa-torre': [
		[226, -29],
		[258, -33],
		[279, -56],
		[280, -82],
		[266.8, -98]
	]
};

/** Checkpoints besides the way in. */
export const CHECKPOINTS = {
	escada: [226.5, -27] as XZ,
	vovo: [204, -102] as XZ,
	torre: [265.5, -97] as XZ
} as const;

/** C3's target: the clearing's edge where the trail ends. */
export const VOVO_TARGET: XZ = [205.5, -102.5];

export const SIGNS = {
	copa: { at: [225.5, -8] as XZ, label: 'LABEL_COPA' },
	passarela: { at: [228, -28] as XZ, label: 'LABEL_PASSARELA' }
} as const;

// --- Vegetation (≤ 1,600 placements, PARK.md §8) -----------------------------------------------

export const MAX_INSTANCES = 1600;
export const TREE_SPACING = 5.3;
export const ROCK_SPACING = 9;
export const DECORATION_SPACING = 4.1;
/** Trunks keep this from the walkway's centre line (its half width, the rail, a step), plus their radius. */
export const WALKWAY_CLEARANCE = 2.2;
