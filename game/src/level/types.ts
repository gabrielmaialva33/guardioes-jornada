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

export type MissionKey = 'sementes' | 'corte-ilegal' | 'pedras' | 'mudas' | 'armadilhas' | 'mirante';

export interface Mission {
	/** 1 to 6, the suggested order; the arrow points at `target`. */
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

export type ObbyPiece = 'stone' | 'ledge';

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
	id: 'stones' | 'ledges';
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
	| 'butterflies';

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
	/** Stable hash of everything above. */
	checksum: number;
}

export interface StoryBuild {
	world: StoryWorld;
	level: StoryLevel;
}
