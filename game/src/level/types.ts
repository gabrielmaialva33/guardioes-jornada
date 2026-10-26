/**
 * Story-only data of the "Reserva da Iara" map (game/LEVEL.md §2): missions,
 * checkpoints, obby pieces, collectibles, trigger zones and landmarks. The map
 * itself is a SurvivalWorld, so the renderer, collision and animal wiring
 * serve both modes; this is what the story adds on top.
 *
 * Headings follow survival/types.ts: (yawC, yawS) = (cos θ, sin θ), local +z
 * (the front) goes to (yawS, 0, yawC). Checkpoints keep the engine's `yaw`
 * angle (0 faces +z).
 */
import type { Checkpoint } from '../engine/checkpoints.ts';
import type { Placed, Point, SurvivalWorld } from '../survival/types.ts';

/** The map has exactly the survival map's shape. */
export type StoryWorld = SurvivalWorld;

export type MissionKey =
	| 'sementes'
	| 'corte-ilegal'
	| 'pedras'
	| 'mudas'
	| 'armadilhas'
	| 'mirante'
	| 'casa-na-arvore'
	| 'sementes-viveiro'
	| 'fotografe-aves';

export interface Mission {
	/** 1 to 6, the suggested order; the arrow points at `target`. Act 1's additions are 0, 7 and 8. */
	id: number;
	key: MissionKey;
	/** Player-facing name (pt-BR). */
	name: string;
	/** Missions that must be done first: 1 before the rest, 1–5 before 6. */
	requires: number[];
	target: Point;
	/** How many things complete it (fruits planted, spots, traps…), 1 when it is a place. */
	count: number;
	/** Text keys of conteudo-jogo.md (sections 2 and 4). */
	dialogue: string[];
	/** Ids of the trigger zones, collectibles or planting spots the mission uses. */
	triggers: string[];
}

export interface StoryCheckpoint extends Checkpoint {
	/** The mission this checkpoint belongs to, 0 for none. */
	mission: number;
}

/** Stones and branches are disks, ledges oriented squares. */
export type ObbyPiece = 'stone' | 'ledge' | 'branch';

/** One obby top: a disk (stones) or an oriented square (ledges), its top at `y`. */
export interface ObbyTop extends Placed {
	piece: ObbyPiece;
	/** Disk radius, or half the square's side. */
	radius: number;
	/** Ledge look: rock, root or log; stones: variant 0–2. */
	variant: string;
	/** Ground under the piece: its collider runs from here to the top. */
	bottom: number;
}

/** One jump: from the edge of one top (or a take-off point) to the edge of the next. */
export interface ObbyGap {
	gap: number;
	rise: number;
	/** LEVEL.md's fraction of jumpReach(base) this gap was built from. */
	fraction: number;
	/** The rise the fraction refers to (0 for the stones, 1.5 for the ledges). */
	reachRise: number;
}

export interface Obby {
	/** The river stones and the mirante ledges; Act 1 adds the grotto's stones and the canopy branches. */
	id: 'stones' | 'ledges' | 'gruta' | 'copa';
	mission: number;
	/** Where the first jump starts and the last one lands (feet on the ground or the plateau). */
	takeoff: Point;
	landing: Point;
	/** Walking direction of the line, unit (x, z). */
	dirX: number;
	dirZ: number;
	pieces: ObbyTop[];
	gaps: ObbyGap[];
}

export type CollectibleKind = 'jucara-fruit' | 'trash' | 'gold-leaf';

export interface Collectible extends Point {
	id: string;
	kind: CollectibleKind;
	/** Trash look (bottle, can, bag); empty otherwise. */
	variant: string;
	/** The mission it belongs to (fruits: 1, leaves: their mission, trash: 0). */
	mission: number;
	radius: number;
	/** Obby piece it sits on, '' when on the ground. */
	on: string;
}

export type TriggerKind =
	| 'mission'
	| 'planting'
	| 'observation'
	| 'logger'
	| 'trap'
	| 'onca'
	| 'mirante'
	| 'npc';

/** A vertical cylinder: inside when the feet are within `radius` on the ground plane and between minY and maxY. */
export interface TriggerZone extends Point {
	id: string;
	kind: TriggerKind;
	radius: number;
	minY: number;
	maxY: number;
	mission: number;
}

export type LandmarkKind =
	| 'npc-iara'
	| 'viveiro'
	| 'ipe-amarelo'
	| 'trail-sign'
	| 'observation-rock'
	| 'cutting'
	| 'cutting-tree'
	| 'bridge'
	| 'jequitiba'
	| 'waterfall'
	| 'mirante'
	| 'butterflies'
	| 'portal-sign';

export interface Landmark extends Placed {
	id: string;
	kind: LandmarkKind;
	/** Player-facing label (pt-BR), '' when it has none. */
	label: string;
	/** Drawn fog-free as a silhouette (the two orientation landmarks, LEVEL.md §9). */
	silhouette: boolean;
	/** Height in units where it matters (jequitibá 18, boulder 4, waterfall drop). */
	height: number;
}

export interface Trail {
	id: string;
	halfWidth: number;
	/** Centre line, (x, z) pairs. */
	points: [number, number][];
}

export interface PlantingSpot extends Point {
	id: string;
	mission: number;
	/** survival PLANT_GRID cell id (gz * PLANT_GRID + gx) for the corridor; −1 in the clareira. */
	cell: number;
}

/** The stones pool: an ellipse around `centre`, its long axis along the crossing. */
export interface Pool {
	x: number;
	z: number;
	water: number;
	axisX: number;
	axisZ: number;
	/** Half length along the axis and half width across it. */
	halfLength: number;
	halfWidth: number;
}

/** One portal post: an upright cylinder from the ground. */
export interface PortalPost extends Point {
	radius: number;
	height: number;
}

export type PortalId = 'leste' | 'norte' | 'sul';
/** The map edge a portal opens: east (x = 160) to the Vale, north (z = 0) to the Praia, south (z = 160) to the Manguezal. */
export type PortalSide = 'east' | 'north' | 'south';

/** The opening in an edge rail: the edge's own coordinate (`at`: x for east, z for north and south), the range along it, its floor height. */
export interface PortalGap {
	at: number;
	from: number;
	to: number;
	y: number;
}

/**
 * An edge portal (F1, WORLD.md §3; PARK.md §2): data only, the runtime draws
 * the posts, the sign and the gate, opens its edge rail inside `gap`, and keeps
 * the gate closed until the mission named by `requires` is done.
 */
export interface Portal {
	id: PortalId;
	side: PortalSide;
	/** The mission that opens the gate ('mirante', mission 6), and its id. */
	requires: MissionKey;
	mission: number;
	gap: PortalGap;
	posts: [PortalPost, PortalPost];
	/** "Rumo à serra" and so on, beside the trail that leads here, facing it. */
	sign: Landmark;
	/** The closed gate, between the posts, until `requires` is done. */
	gate: { from: Point; to: Point; height: number };
	/** Where "voltar" lands, facing home (yaw as the engine's), and the first step out of the map. */
	inside: Point & { yaw: number };
	outside: Point;
	/** The trail spur that leads here. */
	trail: string;
}

/** A railing: a straight segment from (x0, z0) to (x1, z1), standing `height` u on `y`. */
export interface Rail {
	x0: number;
	z0: number;
	x1: number;
	z1: number;
	y: number;
	height: number;
}

/** A flat walkable deck over x0..x1, z0..z1, its top at `y`, with its rails. */
export interface Deck {
	id: string;
	x0: number;
	x1: number;
	z0: number;
	z1: number;
	y: number;
	rails: Rail[];
}

/**
 * A ladder (the ladder mechanic's anchor): feet at `bottom` on the ground, the
 * top dismount at `top` on the deck. The climber faces (yawS, yawC), the engine's
 * `yaw`, towards the ladder.
 */
export interface Ladder {
	id: string;
	bottom: Point;
	top: Point;
	yaw: number;
	yawC: number;
	yawS: number;
	width: number;
	/** The deck it leads to. */
	deck: string;
}

/** The zipline (PARK.md §6): a straight cable `cableAbove` over the rider's feet from `start` to `end`. */
export interface Zipline {
	id: string;
	start: Point;
	end: Point;
	cableAbove: number;
	/** Length along the cable and its drop, in u. */
	length: number;
	drop: number;
	/** Ground clearance kept on either side of the cable's line (no tree, rock or ground cover). */
	clearance: number;
	brake: number;
	maxSpeed: number;
	/** It opens with this mission (the mirante, mission 6). */
	requires: MissionKey;
	mission: number;
	startDeck: string;
	endDeck: string;
}

/**
 * Water that is neither the river nor the stones pool: a stream along `points`, with
 * its surface and its banks' distances north and south of the line per point (linear
 * between), over a flat bed `depth` under the surface.
 */
export interface Stream {
	id: string;
	points: { x: number; z: number; water: number; north: number; south: number }[];
	depth: number;
}

/** The grotto behind the small waterfall: its niche floor, the plunge pool and the stones across it. */
export interface Grotto {
	niche: { x0: number; x1: number; z0: number; z1: number; y: number };
	pool: Pool;
	obby: Obby;
	leaf: Collectible;
	/** Iara's hidden note, with its text key. */
	note: Point & { text: string };
}

/** The canopy gold leaf: the branch path and the crown tree it climbs into. */
export interface Canopy {
	obby: Obby;
	leaf: Collectible;
	tree: Point;
}

export interface Npc extends Placed {
	id: 'ana' | 'ze';
	name: string;
	mission: number;
}

/** A fallen seed to pick up, of one tree species. */
export interface SeedSpot extends Point {
	id: string;
	species: string;
	mission: number;
	radius: number;
}

/** A bird to photograph, perched over the ground. */
export interface BirdPerch extends Point {
	id: string;
	species: string;
	mission: number;
}

/** A yellow and black mico-paw trail mark, on a post or on a trunk, facing the trail (front (yawS, yawC)). */
export interface TrailMark extends Placed {
	trail: string;
	on: 'post' | 'trunk';
	/** Height of the mark's centre over `y` (the ground). */
	height: number;
}

/**
 * Act 1's additions (PARK.md §3): data only for now. The runtime merges
 * `missions` into the story when their mechanics land: mission 0 runs first
 * (mission 1 then requires it, `firstRequires`), the two NPC missions open after
 * mission 1.
 */
export interface Act1 {
	missions: Mission[];
	firstRequires: number[];
	triggers: TriggerZone[];
	treehouse: { tree: Point; deck: Deck; ladder: Ladder };
	zipline: Zipline;
	decks: Deck[];
	gorge: Stream;
	grotto: Grotto;
	canopy: Canopy;
	npcs: Npc[];
	seeds: SeedSpot[];
	birds: BirdPerch[];
	marks: TrailMark[];
	/** pt-BR lines by key; 'TODO-SOURCE' marks a fact still to be written from a source. */
	text: Record<string, string>;
}

export interface StoryLevel {
	version: number;
	spawn: Placed & { yaw: number };
	/** Checkpoint 0 at the spawn. */
	start: StoryCheckpoint;
	checkpoints: StoryCheckpoint[];
	killY: number;
	missions: Mission[];
	obbies: Obby[];
	collectibles: Collectible[];
	triggers: TriggerZone[];
	landmarks: Landmark[];
	trails: Trail[];
	planting: PlantingSpot[];
	pool: Pool;
	/** The mirante top the last mission reaches. */
	mirante: Point;
	/** Muriqui branch handholds along the canopy row by the cutting, in order. */
	handholds: Point[];
	/** The east portal, also portals[0]: kept for the zone adapter (level/zones/reserva.ts). */
	portal: Portal;
	/** Every edge portal, east first. Optional only so the skeleton zones' levels keep their shape. */
	portals?: Portal[];
	/** Act 1's additions (PARK.md §3); optional for the same reason. */
	act1?: Act1;
	/** Stable hash of everything above. */
	checksum: number;
}

export interface StoryBuild {
	world: StoryWorld;
	level: StoryLevel;
}
