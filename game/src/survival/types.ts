/**
 * Data shapes and tables of the "5 Dias de Guardião" survival map. Everything
 * here is plain data: the renderer builds meshes and instance pools from it,
 * the engine builds one BVH per block from the collision description, and the
 * game reads slots and spots. Nothing in survival/ draws or collides.
 *
 * Units match game/src/engine/constants.ts (avatar H = 3 u). The map is the
 * square [0, 160] × [0, 160] of the ground plane, y up; x grows from the sea
 * (x = 0) to the serra (x = 160). Grids are row-major: cell (i, j) is the ground
 * point (x = i, z = j) at index j * GRID + i.
 *
 * Headings are unit vectors (yawC, yawS) = (cos θ, sin θ) of a yaw θ about +y,
 * because the generator never calls trigonometry: the object's local +x goes to
 * (yawC, 0, −yawS) and its local +z, its front, to (yawS, 0, yawC). In three.js,
 * `rotation.y = Math.atan2(yawS, yawC)` (render-side math may use trig).
 */

/** Bump on any change that alters the output for a seed; saves record it. */
export const GENERATOR_VERSION = 1;

export const WORLD_SIZE = 160;
/** Height samples per side, one per unit. */
export const GRID = WORLD_SIZE + 1;
/** Culling and collision blocks: 4 × 4 of 40 u. */
export const BLOCK_SIZE = 40;
export const BLOCKS_PER_SIDE = WORLD_SIZE / BLOCK_SIZE;
/** Terrain sample spacing of the collision description (render keeps the 1 u grid). */
export const COLLISION_STEP = 2;
/** Planting grid: 2 u cells; a cell id is gz * PLANT_GRID + gx, centred on (2gx + 1, 2gz + 1). */
export const PLANT_STEP = 2;
export const PLANT_GRID = WORLD_SIZE / PLANT_STEP;
/** Sea surface; the river surface descends to it from the serra. */
export const WATER_LEVEL = -0.5;
/** Ground below this is too deep to wade (the POC's value). */
export const WADE_LIMIT = -0.7;
/**
 * Steepest rise between neighbouring 1 u cells that the reachability pass
 * accepts: 0.9 per unit, about 42°, under the controller's MAX_SLOPE of 50°.
 */
export const WALK_SLOPE = 0.9;
/** Walking window of POIs from the base, in grid steps (about 3 to 11 s at 9.6 u/s). */
export const MIN_POI_STEPS = 25;
export const MAX_POI_STEPS = 110;
/** Threat slots never sit closer to the base than this, in a straight line. */
export const THREAT_MIN_BASE_DISTANCE = 20;

/** Zones from the sea to the serra, then the river. The index is the value stored in `zones`. */
export const ZONES = [
	'sea',
	'beach',
	'mangrove',
	'restinga',
	'lowland',
	'slope',
	'highland',
	'river'
] as const;
export type Zone = (typeof ZONES)[number];
export const ZONE = {
	sea: 0,
	beach: 1,
	mangrove: 2,
	restinga: 3,
	/** Floresta de baixada. */
	lowland: 4,
	/** Floresta de encosta. */
	slope: 5,
	/** Campo de altitude. */
	highland: 6,
	river: 7
} as const satisfies Record<Zone, number>;

/** Bits of `flags`, one byte per grid cell. */
export const FLAG = {
	/** Dry, inside the park fence, wadeable: a cell the reachability pass may enter. */
	walkable: 1,
	/** Under the river surface. */
	river: 2,
	/** Pasture: cleared lowland or restinga, the gaps between forest fragments. */
	cleared: 4,
	/** The flat pad of the base camp. */
	base: 8,
	/** Under a bridge deck (walkable at the deck height, not the ground). */
	crossing: 16,
	/** Standing forest (restinga, lowland or slope). */
	forest: 32,
	/** The shortest gap between two forest fragments: the planned ecological corridor. */
	corridor: 64
} as const;

/** Tree species: Kenney Nature Kit recolors, plus araucária and the red mangrove modelled from primitives (plano.md, modelos-3d.md §6). */
export const TREE_SPECIES = [
	'pau-brasil',
	'ipe-amarelo',
	'ipe-rosa',
	'jequitiba',
	'jucara',
	'embauba',
	'xaxim',
	'araucaria',
	'mangue-vermelho',
	'jeriva'
] as const;
export type TreeSpecies = (typeof TREE_SPECIES)[number];

/** Boulders and logs collide; stones are below the step height. */
export const ROCK_KINDS = ['boulder', 'stone', 'log'] as const;
export type RockKind = (typeof ROCK_KINDS)[number];

/** Ground cover, never collides. */
export const DECORATION_KINDS = ['grass', 'flower', 'bush', 'fern', 'bromelia', 'beach-grass'] as const;
export type DecorationKind = (typeof DECORATION_KINDS)[number];

/**
 * Day threats (research §2.1). The child reports them and an adult NPC handles
 * them: they are never touched (safety rules S3, S6, S9).
 */
export const THREAT_KINDS = ['trash', 'trap', 'fire', 'invasive-grass'] as const;
export type ThreatKind = (typeof THREAT_KINDS)[number];
export const RESPONDER = {
	trash: 'cleanup-crew',
	trap: 'wildlife-inspector',
	fire: 'fire-brigade',
	'invasive-grass': 'restoration-crew'
} as const satisfies Record<ThreatKind, string>;
export type Responder = (typeof RESPONDER)[ThreatKind];

/** Hand-made set pieces the generator places (research §3.2, step 5). */
export const POI_KINDS = [
	'lookout',
	'spring',
	'mother-tree',
	'abandoned-camp',
	'mangrove-boardwalk',
	'restinga-trail',
	'rope-bridge',
	'stepping-stones'
] as const;
export type PoiKind = (typeof POI_KINDS)[number];

/** Collectables are man-made only: nothing from the forest is taken or eaten (rules S1, S8). */
export const RESOURCE_KINDS = ['supply-crate', 'reclaimed-wood'] as const;
export type ResourceKind = (typeof RESOURCE_KINDS)[number];

/** Base camp pieces (Kenney Survival Kit); there is no campfire (rule S3). */
export const BASE_PIECES = [
	'tent',
	'bedroll',
	'workbench',
	'nursery',
	'water-tank',
	'supply-box',
	'radio-mast',
	'signpost'
] as const;
export type BasePieceKind = (typeof BASE_PIECES)[number];

/** Nursery seedlings by succession group (research §4.3). */
export const SEEDLINGS = {
	embauba: 'pioneer',
	'ipe-amarelo': 'secondary',
	jequitiba: 'climax',
	jucara: 'climax'
} as const satisfies Partial<Record<TreeSpecies, 'pioneer' | 'secondary' | 'climax'>>;
export type Seedling = keyof typeof SEEDLINGS;

export type Rarity = 'common' | 'uncommon' | 'rare' | 'legendary';
export type Clue = 'tracks' | 'gnawed-fruit' | 'chewed-leaves' | 'burrow' | 'feathers' | 'flowers';

/**
 * Species album, one home per species in its zone. Rarities from research §2.1
 * where given (sabiá, caranguejo, tucano, muriqui, bugio, onça); the rest and
 * the zone/clue pairing await the biologist review of research §8.7.
 */
export const ALBUM = [
	{ species: 'caranguejo-uca', zone: 'mangrove', rarity: 'common', clue: 'burrow' },
	{ species: 'coruja', zone: 'restinga', rarity: 'common', clue: 'feathers' },
	{ species: 'cachorro-do-mato', zone: 'restinga', rarity: 'uncommon', clue: 'tracks' },
	{ species: 'sabia', zone: 'lowland', rarity: 'common', clue: 'gnawed-fruit' },
	{ species: 'tucano', zone: 'lowland', rarity: 'uncommon', clue: 'gnawed-fruit' },
	{ species: 'preguica', zone: 'lowland', rarity: 'uncommon', clue: 'chewed-leaves' },
	{ species: 'mico-leao-dourado', zone: 'lowland', rarity: 'rare', clue: 'gnawed-fruit' },
	{ species: 'veado', zone: 'slope', rarity: 'uncommon', clue: 'tracks' },
	{ species: 'bugio', zone: 'slope', rarity: 'rare', clue: 'chewed-leaves' },
	{ species: 'muriqui', zone: 'slope', rarity: 'rare', clue: 'gnawed-fruit' },
	{ species: 'onca-pintada', zone: 'slope', rarity: 'legendary', clue: 'tracks' },
	{ species: 'abelha-nativa', zone: 'highland', rarity: 'common', clue: 'flowers' }
] as const satisfies readonly { species: string; zone: Zone; rarity: Rarity; clue: Clue }[];
export type AlbumSpecies = (typeof ALBUM)[number]['species'];

export interface Point {
	x: number;
	y: number;
	z: number;
}

export interface Placed extends Point {
	yawC: number;
	yawS: number;
}

/**
 * Instances of one family (trees, rocks, decorations) as parallel typed arrays,
 * sorted by block and then kind, so each (block, kind) run is contiguous.
 * Sized for InstancedMesh pools; `y` is the ground under the instance.
 */
export interface Placements<K extends string> {
	kinds: readonly K[];
	count: number;
	/** Index into `kinds`. */
	kind: Uint8Array;
	/** Block index, bz * BLOCKS_PER_SIDE + bx. */
	block: Uint8Array;
	x: Float32Array;
	y: Float32Array;
	z: Float32Array;
	scale: Float32Array;
	yawC: Float32Array;
	yawS: Float32Array;
}

/** River centre line control point and its surface height. */
export interface RiverPoint {
	x: number;
	z: number;
	water: number;
}

export interface River {
	/** From the serra to the sea; the surface is linear between points. */
	points: RiverPoint[];
	/** Half width of the water surface around the centre line. */
	halfWidth: number;
	/** Water depth over the flat bed. */
	depth: number;
}

/**
 * A way over the river. Bridges are walkable decks from bank to bank; the deck
 * height is the line from `from.y` to `to.y`, never lower than `water + 0.5`.
 * Stepping stones are an optional obby piece: their stone tops are listed and
 * the reachability pass does not count them.
 */
export interface Crossing {
	kind: 'bridge' | 'rope-bridge' | 'stepping-stones';
	from: Point;
	to: Point;
	halfWidth: number;
	water: number;
	/** Stone tops and radii (stepping stones only). */
	stones: { x: number; y: number; z: number; r: number }[];
}

export interface BasePiece extends Placed {
	kind: BasePieceKind;
}

export interface BaseCamp extends Placed {
	/** Radius of the flat pad. */
	radius: number;
	spawn: Point;
	pieces: BasePiece[];
}

export interface Poi extends Placed {
	id: number;
	kind: PoiKind;
	zone: Zone;
	/** Walking steps from the base. */
	steps: number;
}

export interface ThreatSlot extends Placed {
	id: number;
	kind: ThreatKind;
	responder: Responder;
	zone: Zone;
	steps: number;
	/** In the line of sight of the lookout over the terrain (rule 3 of research §3.4). */
	seenFromLookout: boolean;
}

export interface PlantingCell extends Point {
	/** gz * PLANT_GRID + gx. */
	cell: number;
	steps: number;
}

/** The corridor to plant: the shortest pasture gap from the largest forest fragment to another big one. */
export interface Corridor {
	/** Planting cells in order from the largest fragment to the other one. */
	cells: PlantingCell[];
	/** Length of the gap in grid steps. */
	length: number;
	/** Fragment sizes in cells: the largest, and the one the corridor reaches. */
	fromSize: number;
	toSize: number;
	/** True when the corridor joins the two largest fragments (the extra medal). */
	joinsTwoLargest: boolean;
}

export interface AnimalHome extends Point {
	id: number;
	species: AlbumSpecies;
	zone: Zone;
	/** Night roaming radius around the home. */
	radius: number;
}

/** Where a camera trap may go: by a clue, facing the animal's home. */
export interface CameraSpot extends Placed {
	id: number;
	species: AlbumSpecies;
	clue: Clue;
	zone: Zone;
	steps: number;
}

export interface ResourceNode extends Placed {
	id: number;
	kind: ResourceKind;
	steps: number;
}

/**
 * Collision of one 40 u block, as data for the engine's BVH. Prefab pieces
 * (base camp, POI set pieces, resources) are not here: the engine adds their
 * own colliders at their transforms, and dynamic things use analytic colliders.
 */
export interface CollisionBlock {
	index: number;
	bx: number;
	bz: number;
	/** Minimum corner; the block spans BLOCK_SIZE along x and z. */
	x0: number;
	z0: number;
	/** Ground height range, for bounds. */
	minY: number;
	maxY: number;
	/** (BLOCK_SIZE / COLLISION_STEP + 1)² ground heights every COLLISION_STEP u, row-major; edges repeat the neighbour's. */
	heights: Float32Array;
	/** Upright cylinders (trunks, boulders, stones): stride 5, [x, yBottom, z, radius, height]. */
	cylinders: Float32Array;
	/** Oriented boxes (logs): stride 8, [cx, cy, cz, halfX, halfY, halfZ, yawC, yawS]. */
	boxes: Float32Array;
	/** Bridge decks: stride 8, [x0, y0, z0, x1, y1, z1, halfWidth, thickness]; the top surface runs end to end. */
	decks: Float32Array;
}

export interface SurvivalWorld {
	generatorVersion: number;
	/** The seed asked for. */
	seed: number;
	/** Attempts used (1 = first try); later attempts use subSeed(seed, …). */
	attempt: number;
	/** The seed of the accepted attempt. */
	worldSeed: number;
	/** Empty when every check passed (the normal case). */
	problems: string[];
	size: number;
	grid: number;
	waterLevel: number;
	/** GRID² ground heights. */
	heights: Float32Array;
	/** GRID² zone indices (ZONE). */
	zones: Uint8Array;
	/** GRID² FLAG bits. */
	flags: Uint8Array;
	/** GRID² walking steps from the base, −1 where unreachable. */
	baseSteps: Int16Array;
	/** Height above which the ground counts as campo de altitude (the 95% quantile). */
	highlandHeight: number;
	river: River;
	crossings: Crossing[];
	base: BaseCamp;
	pois: Poi[];
	threats: ThreatSlot[];
	corridor: Corridor;
	animals: AnimalHome[];
	cameraSpots: CameraSpot[];
	resources: ResourceNode[];
	trees: Placements<TreeSpecies>;
	rocks: Placements<RockKind>;
	decorations: Placements<DecorationKind>;
	blocks: CollisionBlock[];
	/** Object counts per kind ("tree:jucara", "threat:fire", …) for pool sizing. */
	counts: Record<string, number>;
	/** Stable hash of everything above. */
	checksum: number;
}
