/**
 * The curated inventory of the LOCAL-ONLY Green Hell study mode: every animal,
 * plant and sound group the owner extracted into `tmp/greenhell-port/`, rated
 * for the Mata Atlântica. Measured from the files (glTF JSON chunk and
 * conversion-manifest.json, 26/10/2026); report: p14-estudo-greenhell.md.
 *
 * This file holds metadata only (names, sizes, clip names): no asset bytes. Paths
 * are relative to `tmp/greenhell-port/`; fetch them with `studyUrl(path)`.
 * DEV + `?estudo=greenhell` only: see gate.ts.
 *
 * Fit: `pick` goes in the study world, `existing` we already have (the onça),
 * `maybe` usable with care, `out` wrong biome or scary for kids.
 */

export type StudyFit = 'pick' | 'existing' | 'maybe' | 'out';

/** Clip names as `clipKey()` reads them from the glTF animation names. */
export interface StudyClipRoles {
	readonly idle: string;
	readonly walk: string;
	readonly run: string;
	readonly eat: string;
	readonly alerted: string;
	/** Extra idles played now and then. */
	readonly extra?: readonly string[];
}

export interface StudyAnimal {
	readonly kind: 'animal';
	/** The Green Hell model name. */
	readonly id: string;
	/** Brazilian Portuguese common name (what a child would call it). */
	readonly name: string;
	readonly path: string;
	readonly bytes: number;
	readonly tris: number;
	readonly joints: number;
	/** Embedded images, `name width×height`. */
	readonly textures: readonly string[];
	/** Every clip, by clipKey(). */
	readonly clips: readonly string[];
	readonly role: 'fauna' | 'fish' | 'reptile' | 'invertebrate';
	readonly fit: StudyFit;
	readonly why: string;
	/** Picks only: ART.md §3 height, feet to the top of the silhouette, world units (×1.5 life size). */
	readonly height?: number;
	/** Picks only: the clips the study behaviours play. */
	readonly roles?: StudyClipRoles;
}

export type StudyPlantRole =
	| 'tree'
	| 'tree-dead'
	| 'log'
	| 'banana'
	| 'understorey'
	| 'groundcover'
	| 'flowers'
	| 'litter'
	| 'liana'
	| 'rock'
	| 'rock-ivy';

export interface StudyPlant {
	readonly kind: 'plant';
	readonly id: string;
	readonly path: string;
	readonly bytes: number;
	/** Triangles of every mesh in the file, the `*_caster` shadow meshes included. */
	readonly tris: number;
	readonly role: StudyPlantRole;
	readonly fit: StudyFit;
	readonly why: string;
}

export type StudySoundRole =
	| 'bed-day'
	| 'bed-night'
	| 'bed-water'
	| 'oneshot-day'
	| 'oneshot-night'
	| 'weather'
	| 'call'
	| 'other';

export interface StudySoundGroup {
	readonly kind: 'sound';
	readonly id: string;
	readonly role: StudySoundRole;
	readonly fit: StudyFit;
	/** The StudyAnimal id these calls belong to. */
	readonly animal?: string;
	readonly note: string;
	/** WebM/Opus files; each has an `.m4a` (AAC) twin with the same stem for Safari. */
	readonly files: readonly string[];
}

export type StudyItem = StudyAnimal | StudyPlant | StudySoundGroup;

/**
 * The clip's own name from a glTF animation name: the converter wrote
 * `Armature|…|clip|Base Layer`, so it is the segment before the last.
 */
export function clipKey(name: string): string {
	const parts = name.split('|');
	return parts.length >= 3 ? parts[parts.length - 2] : name;
}

const plant = (
	id: string,
	bytes: number,
	tris: number,
	role: StudyPlantRole,
	fit: StudyFit,
	why: string
): StudyPlant => ({ kind: 'plant', id, path: `scenery/browser/${id}-web.glb`, bytes, tris, role, fit, why });

const animalPath = (id: string) => `animals/browser/${id}-web.glb`;

export const STUDY_ANIMALS: readonly StudyAnimal[] = [
	{
		kind: 'animal',
		id: 'Capybara',
		name: 'capivara',
		path: animalPath('Capybara'),
		bytes: 1211580,
		tris: 2982,
		joints: 42,
		textures: ['Capibara_color 1024×1024'],
		clips: [
			'alerted',
			'capybara_poisoned_lay_down',
			'capybara_poisoned',
			'capybara_stroking',
			'capybara_traphang',
			'capybara_turn_left_loop',
			'capybara_turn_right_loop',
			'death',
			'eat',
			'hit_reaction',
			'idle_look_around',
			'idle_scratch',
			'lie_down_to_stand_up',
			'run_forward',
			'run_left',
			'run_right',
			'sit_down_idle',
			'sit_down_to_stand_up',
			'sit_down',
			'start_run_forward',
			'start_run_left_back',
			'start_run_left',
			'start_run_right_back',
			'start_run_right',
			'walk_forward_reduced',
			'walk_left',
			'walk_right'
		],
		role: 'fauna',
		fit: 'pick',
		why: 'Hydrochoerus hydrochaeris lives on every river bank of the Mata Atlântica.',
		height: 1.75,
		roles: {
			idle: 'idle_look_around',
			walk: 'walk_forward_reduced',
			run: 'run_forward',
			eat: 'eat',
			alerted: 'alerted',
			extra: ['idle_scratch', 'sit_down_idle']
		}
	},
	{
		kind: 'animal',
		id: 'Tapir',
		name: 'anta',
		path: animalPath('Tapir'),
		bytes: 1151496,
		tris: 3250,
		joints: 35,
		textures: ['Tapir_Base_Color 1024×1024'],
		clips: [
			'tapir_alerted',
			'tapir_death',
			'tapir_eat',
			'tapir_hitreaction',
			'tapir_idle_b',
			'tapir_idle_c',
			'tapir_idle_to_poop',
			'tapir_idle',
			'tapir_lay_down',
			'tapir_poop_to_idle',
			'tapir_poop',
			'tapir_run_forward',
			'tapir_run_left',
			'tapir_run_right',
			'tapir_sleep',
			'tapir_stroking',
			'tapir_trap_hang_C_shaking_mirror',
			'tapir_trapkill',
			'tapir_trot_forward',
			'tapir_trot_left',
			'tapir_trot_right',
			'tapir_turn_left_loop',
			'tapir_turn_right_loop',
			'tapir_walk_forward',
			'tapir_walk_left',
			'tapir_walk_right'
		],
		role: 'fauna',
		fit: 'pick',
		why: 'Tapirus terrestris, the largest land mammal of the Mata Atlântica, always near water.',
		height: 2.7,
		roles: {
			idle: 'tapir_idle',
			walk: 'tapir_walk_forward',
			run: 'tapir_trot_forward',
			eat: 'tapir_eat',
			alerted: 'tapir_alerted',
			extra: ['tapir_idle_b', 'tapir_idle_c']
		}
	},
	{
		kind: 'animal',
		id: 'Tapir_baby',
		name: 'filhote de anta',
		path: animalPath('Tapir_baby'),
		bytes: 1273276,
		tris: 4243,
		joints: 35,
		textures: ['Tapir_Base_Color_legendary 1024×1024'],
		clips: [
			'tapir_alerted',
			'tapir_eat',
			'tapir_idle_b',
			'tapir_idle_c',
			'tapir_idle',
			'tapir_lay_down',
			'tapir_run_forward',
			'tapir_run_left',
			'tapir_run_right',
			'tapir_stroking',
			'tapir_walk_forward',
			'tapir_walk_left',
			'tapir_walk_right'
		],
		role: 'fauna',
		fit: 'pick',
		why: 'The striped calf: the stripes and spots are the real calf coat.',
		height: 1.6,
		roles: {
			idle: 'tapir_idle',
			walk: 'tapir_walk_forward',
			run: 'tapir_run_forward',
			eat: 'tapir_eat',
			alerted: 'tapir_alerted',
			extra: ['tapir_idle_b']
		}
	},
	{
		kind: 'animal',
		id: 'Peccary',
		name: 'cateto',
		path: animalPath('Peccary'),
		bytes: 1392220,
		tris: 1456,
		joints: 31,
		textures: ['peccary 1024×1024'],
		clips: [
			'peccary_big_poisoned_get_up',
			'peccary_big_start_left_back_copy',
			'alerted',
			'death',
			'eat',
			'hitreaction',
			'idle lay',
			'idle_look_around',
			'idle_smells',
			'lay_down_fast',
			'run_forward',
			'run_left',
			'run_right',
			'start_forward',
			'start_left_back',
			'start_left',
			'start_right_back',
			'start_right',
			'trap_hang_C_shaking',
			'trot_forward',
			'trot_left',
			'trot_right',
			'walk_forward',
			'walk_left',
			'walk_right',
			'peccary_turn_left_loop',
			'peccary_turn_right_loop'
		],
		role: 'fauna',
		fit: 'pick',
		why: 'Peccaries (cateto Pecari tajacu, queixada Tayassu pecari) roam the forest in bands.',
		height: 1.6,
		roles: {
			idle: 'idle_look_around',
			walk: 'walk_forward',
			run: 'trot_forward',
			eat: 'idle_smells',
			alerted: 'alerted',
			extra: ['eat']
		}
	},
	{
		kind: 'animal',
		id: 'Armadillo',
		name: 'tatu-galinha',
		path: animalPath('Armadillo'),
		bytes: 3922760,
		tris: 6542,
		joints: 63,
		textures: ['Armadillo_Nrm 1024×1024', 'Armadillo_AlbedoSmth 1024×1024'],
		clips: [
			'armadillo_alerted',
			'armadillo_death',
			'armadillo_digging',
			'armadillo_hide',
			'armadillo_hitreaction',
			'armadillo_idle_b',
			'armadillo_idle',
			'armadillo_poisoned_lay_down',
			'armadillo_poisoned',
			'armadillo_poop_end',
			'armadillo_poop_loop',
			'armadillo_poop_start',
			'armadillo_run_forward',
			'armadillo_run_left',
			'armadillo_run_right',
			'armadillo_tied',
			'armadillo_traphang',
			'armadillo_trapkill',
			'armadillo_turn_left',
			'armadillo_turn_right',
			'armadillo_walk_forward',
			'armadilo_lay_down',
			'armadilo_laying_idle',
			'armadilo_poisoned_stand_up',
			'armadilo_stroking'
		],
		role: 'fauna',
		fit: 'pick',
		why: 'Dasypus novemcinctus (tatu-galinha) is common in the Mata Atlântica; it digs for insects.',
		height: 0.7,
		roles: {
			idle: 'armadillo_idle',
			walk: 'armadillo_walk_forward',
			run: 'armadillo_run_forward',
			eat: 'armadillo_digging',
			alerted: 'armadillo_alerted',
			extra: ['armadillo_idle_b']
		}
	},
	{
		kind: 'animal',
		id: 'ArmadilloThreeBanded',
		name: 'tatu-bola',
		path: animalPath('ArmadilloThreeBanded'),
		bytes: 1318360,
		tris: 2876,
		joints: 22,
		textures: [
			'armadillo_three_banded_Nrm 512×512',
			'armadillo_three_banded_AlbedoSmth 512×512',
			'armadillo_three_banded_fur_Nrm 256×256',
			'armadillo_three_banded_fur_AlbedoOp 256×256'
		],
		clips: [
			'arm3_alerted',
			'arm3_death',
			'arm3_hitreaction',
			'arm3_idle_A',
			'arm3_idle_B',
			'arm3_lay_down',
			'arm3_laying_idle',
			'arm3_roll',
			'arm3_stroking',
			'arm3_traphang',
			'arm3_trapkill',
			'arm3_turn_left',
			'arm3_turn_right',
			'arm3_unroll',
			'arm3_walk_A',
			'arm3_walk_B'
		],
		role: 'fauna',
		fit: 'maybe',
		why: 'Tolypeutes tricinctus is a Caatinga and Cerrado armadillo; the roll-up is lovely but the tatu-galinha is the forest one.',
		height: 0.5,
		roles: {
			idle: 'arm3_idle_A',
			walk: 'arm3_walk_A',
			run: 'arm3_walk_B',
			eat: 'arm3_idle_B',
			alerted: 'arm3_roll'
		}
	},
	{
		kind: 'animal',
		id: 'CaneToad',
		name: 'sapo-cururu',
		path: animalPath('CaneToad'),
		bytes: 653632,
		tris: 4286,
		joints: 28,
		textures: ['Toad_Normal 512×512', 'Toad_Diffuse 512×512'],
		clips: ['toad_die', 'toad_idle_1', 'toad_idle_2', 'toad_jump', 'toad_trapkill'],
		role: 'fauna',
		fit: 'pick',
		why: 'The cururu (Rhinella icterica in the south-east, R. marina up north) sits on river stones at dusk.',
		height: 0.35,
		roles: {
			idle: 'toad_idle_1',
			walk: 'toad_jump',
			run: 'toad_jump',
			eat: 'toad_idle_2',
			alerted: 'toad_idle_2'
		}
	},
	{
		kind: 'animal',
		id: 'Crab',
		name: 'caranguejo',
		path: animalPath('Crab'),
		bytes: 815696,
		tris: 2148,
		joints: 28,
		textures: ['crab_Nrm 512×512', 'crab_AlbedoSmth 512×512'],
		clips: ['crab_catch', 'crab_death', 'crab_hitreaction', 'crab_idle', 'crab_run_right'],
		role: 'fauna',
		fit: 'pick',
		why: 'Mangrove and restinga crabs (caranguejo-uçá, guaiamum) live at the forest’s salty edge.',
		height: 0.3,
		roles: {
			idle: 'crab_idle',
			walk: 'crab_run_right',
			run: 'crab_run_right',
			eat: 'crab_idle',
			alerted: 'crab_idle'
		}
	},
	{
		kind: 'animal',
		id: 'Puma',
		name: 'onça-parda',
		path: animalPath('Puma'),
		bytes: 1845308,
		tris: 9084,
		joints: 37,
		textures: ['puma_Base_Color 1024×1024', 'puma_eyes_AlbedoSmth 512×512'],
		clips: [
			'attack_both',
			'attack_jump_both',
			'attack_jump_left',
			'attack_jump_right',
			'attack_left_back',
			'attack_left_soft',
			'attack_left',
			'attack_right_soft',
			'attack_right',
			'death',
			'drink',
			'eat',
			'growl',
			'hit_reaction_body',
			'hit_reaction_head_front',
			'hit_reaction_head_left',
			'hit_reaction_head_right',
			'idle_roar',
			'idle_tail',
			'jump_back',
			'lurking_walk_forward',
			'lurking_walk_left_stick',
			'lurking_walk_right_stick',
			'postattack_a',
			'postattack_b',
			'postattack_c',
			'run_forward_spine',
			'run_left',
			'run_right',
			'strafe_left',
			'strafe_right',
			'turn_left_135',
			'turn_left_180',
			'turn_left_45',
			'turn_left_90',
			'turn_right_135',
			'turn_right_180',
			'turn_right_45',
			'turn_right_90',
			'walk_forward',
			'walk_left',
			'walk_right'
		],
		role: 'fauna',
		fit: 'pick',
		why: 'Puma concolor still crosses the serras of the Mata Atlântica; shy, it walks away from people. No attack, growl or roar clips are used.',
		height: 2.1,
		roles: {
			idle: 'idle_tail',
			walk: 'walk_forward',
			run: 'run_forward_spine',
			eat: 'drink',
			alerted: 'idle_tail'
		}
	},
	{
		kind: 'animal',
		id: 'RedFootedTortoise',
		name: 'jabuti-piranga',
		path: animalPath('RedFootedTortoise'),
		bytes: 2370716,
		tris: 2928,
		joints: 19,
		textures: ['red_footed_tortoise_Nrm 1024×1024', 'red_footed_tortoise_AlbedoSmth 1024×1024'],
		clips: [
			'Death',
			'hide',
			'Hit_Reaction',
			'Idle_Eat',
			'Idle_Look_Around',
			'Rotate_Left',
			'Rotate_Right',
			'show',
			'Walk_Forward'
		],
		role: 'fauna',
		fit: 'pick',
		why: 'Chelonoidis carbonaria reaches the northern Mata Atlântica; kids love it, and it hides in its shell.',
		height: 0.5,
		roles: {
			idle: 'Idle_Look_Around',
			walk: 'Walk_Forward',
			run: 'Walk_Forward',
			eat: 'Idle_Eat',
			alerted: 'hide'
		}
	},
	{
		kind: 'animal',
		id: 'GiantAnteater',
		name: 'tamanduá-bandeira',
		path: animalPath('GiantAnteater'),
		bytes: 4943532,
		tris: 8993,
		joints: 59,
		textures: [
			'GiantAnteater_AlbSmth 2048×2048',
			'Woman_hair 512×512',
			'Hair_atlas_nrm 512×512',
			'Noise 512×512'
		],
		clips: [
			'anteater_attack_front',
			'anteater_attack_left',
			'anteater_attack_right',
			'anteater_death',
			'anteater_eat',
			'anteater_get_up',
			'anteater_hitreaction',
			'anteater_idle',
			'anteater_lay_down',
			'anteater_run_forward',
			'anteater_run_left',
			'anteater_run_right',
			'anteater_sleep',
			'anteater_stroking',
			'anteater_traphang',
			'anteater_trapkill',
			'anteater_turn_left_loop_OH',
			'anteater_turn_left',
			'anteater_turn_right_loop_OH',
			'anteater_turn_right',
			'anteater_walk_forward',
			'anteater_walk_left',
			'anteater_walk_right'
		],
		role: 'fauna',
		fit: 'pick',
		why: 'Myrmecophaga tridactyla, nearly gone from the Mata Atlântica: a good conservation story. Its 2048² albedo is the heaviest pick.',
		height: 2.1,
		roles: {
			idle: 'anteater_idle',
			walk: 'anteater_walk_forward',
			run: 'anteater_run_forward',
			eat: 'anteater_eat',
			alerted: 'anteater_idle'
		}
	},
	{
		kind: 'animal',
		id: 'Jaguar',
		name: 'onça-pintada',
		path: animalPath('Jaguar'),
		bytes: 4869056,
		tris: 10046,
		joints: 37,
		textures: ['jaguar_c 2048×2048', 'jaguar_e 256×256'],
		clips: [
			'Attack_Both',
			'Attack_Jump_Left',
			'Attack_Jump_Right',
			'Attack_Left_Soft',
			'Attack_Left',
			'Attack_Right_Soft',
			'Attack_Right',
			'Death',
			'Drink',
			'Eat',
			'Growl',
			'Hit_Reaction_Body',
			'Hit_Reaction_Head_Front',
			'Hit_Reaction_Head_Left',
			'Hit_Reaction_Head_Right',
			'Idle_Roar',
			'Idle_Tail',
			'jump_back',
			'low_to_jump_attack',
			'Lurking_Walk_Forward',
			'postattack_a',
			'postattack_b',
			'postattack_c',
			'run_forward_spine',
			'Run_Left',
			'Run_Right',
			'Strafe_Left',
			'Strafe_Right',
			'turn_left_135',
			'turn_left_180',
			'turn_left_45',
			'turn_left_90',
			'turn_right_135',
			'turn_right_180',
			'turn_right_45',
			'turn_right_90',
			'Walk_Forward',
			'Walk_Left_old',
			'Walk_Left',
			'Walk_Right_old',
			'Walk_Right'
		],
		role: 'fauna',
		fit: 'existing',
		why: 'Our game already has the onça (life/, animation/animals/onca.ts); not duplicated. Its gait clips are a reference for our procedural walk.'
	},
	{
		kind: 'animal',
		id: 'Mouse',
		name: 'rato-do-mato',
		path: animalPath('Mouse'),
		bytes: 300412,
		tris: 2218,
		joints: 21,
		textures: ['mouse_AlbedoSmth 512×512'],
		clips: ['Death', 'Idle_Look_Around', 'Run_Forward', 'trapkill', 'Walk_Forward'],
		role: 'fauna',
		fit: 'maybe',
		why: 'A generic rodent; fine as a tiny critter, not a story animal.'
	},
	{
		kind: 'animal',
		id: 'CaimanLizard',
		name: 'lagarto-jacuruxi',
		path: animalPath('CaimanLizard'),
		bytes: 2046800,
		tris: 2488,
		joints: 96,
		textures: ['caiman_lizard_Nrm 1024×1024', 'caiman_lizard_AlbedoSmth 256×256'],
		clips: [
			'death_b',
			'death',
			'eat',
			'hit_reaction',
			'idle',
			'run_forward',
			'run_left',
			'run_right',
			'walk_forward',
			'walk_left',
			'walk_right'
		],
		role: 'reptile',
		fit: 'out',
		why: 'Dracaena guianensis is Amazonian (a teiú would be our lizard).'
	},
	{
		kind: 'animal',
		id: 'GreenIguana',
		name: 'iguana',
		path: animalPath('GreenIguana'),
		bytes: 1899208,
		tris: 3904,
		joints: 103,
		textures: ['anisotropic_noise_Normal_OpenGL 256×256', 'Iguana_AlbedoSmth 1024×1024'],
		clips: [
			'death',
			'eat',
			'hit_reaction',
			'idle',
			'run_forward',
			'run_left',
			'run_right',
			'walk_forward',
			'walk_left',
			'walk_right'
		],
		role: 'reptile',
		fit: 'out',
		why: 'Left out by the brief (Amazonian / wrong biome for our Reserva).'
	},
	{
		kind: 'animal',
		id: 'PoisonDartFrog',
		name: 'sapinho-ponta-de-flecha',
		path: animalPath('PoisonDartFrog'),
		bytes: 722900,
		tris: 1856,
		joints: 19,
		textures: ['Noise 512×512', 'BluePoisonDartFrogLOD0 512×512'],
		clips: [
			'dartfrog_death',
			'dartfrog_idle',
			'dartfrog_jump_left',
			'dartfrog_jump_right',
			'dartfrog_jump',
			'dartfrog_trapkill'
		],
		role: 'fauna',
		fit: 'out',
		why: 'The blue Dendrobates is Amazonian/Guianan.'
	},
	{
		kind: 'animal',
		id: 'BlackCaiman',
		name: 'jacaré-açu',
		path: animalPath('BlackCaiman'),
		bytes: 17910388,
		tris: 17843,
		joints: 66,
		textures: [
			'snow_normal 512×512',
			'crocodile_head_AlbedoSmth 2048×2048',
			'crocodile_body_AlbedoSmth 2048×2048'
		],
		clips: [
			'caiman_attack_forward',
			'caiman_attack_left',
			'caiman_attack_right',
			'caiman_hit_body',
			'caiman_idle_long_B_x4',
			'caiman_idle_longloop_x4',
			'caiman_idle_v1',
			'caiman_idle_v3',
			'caiman_swim_attack_forward',
			'caiman_swim_attack_left',
			'caiman_swim_attack_right',
			'caiman_swim_forward',
			'caiman_swim_left',
			'caiman_swim_right',
			'caiman_swim_to_walk',
			'caiman_turn_left',
			'caiman_turn_right',
			'caiman_walk_forward',
			'caiman_walk_left',
			'caiman_walk_right',
			'caiman_walk_to_swim'
		],
		role: 'reptile',
		fit: 'out',
		why: 'Amazonian, attack clips, and 17.9 MB / 17.8k tris.'
	},
	{
		kind: 'animal',
		id: 'AlbinoCaiman',
		name: 'jacaré albino',
		path: animalPath('AlbinoCaiman'),
		bytes: 12846400,
		tris: 17843,
		joints: 66,
		textures: [
			'Rust_Detail_Nrm 256×256',
			'crocodile_head_AlbedoSmth_alt 2048×2048',
			'crocodile_body_AlbedoSmth_alt 2048×2048'
		],
		clips: ['caiman_attack_forward', 'caiman_idle_v1', 'caiman_swim_forward', 'caiman_walk_forward'],
		role: 'reptile',
		fit: 'out',
		why: 'A colour variant of the black caiman; same reasons.'
	},
	{
		kind: 'animal',
		id: 'SouthAmericanRattlesnake',
		name: 'cascavel',
		path: animalPath('SouthAmericanRattlesnake'),
		bytes: 2814452,
		tris: 6292,
		joints: 37,
		textures: [
			'rattlesnake_body_Nrm 1024×1024',
			'rattlesnake_body_AlbedoSmth 1024×1024',
			'rattlesnake_eyes_color 256×256'
		],
		clips: [
			'rattlesnake_attack_hit',
			'rattlesnake_attack_miss',
			'rattlesnake_hitrection',
			'rattlesnake_idle_b',
			'rattlesnake_idle_death',
			'rattlesnake_rot_left_b',
			'rattlesnake_rot_right_b'
		],
		role: 'reptile',
		fit: 'out',
		why: 'Crotalus durissus is open-country, and a striking snake is scary for kids.'
	},
	{
		kind: 'animal',
		id: 'Piranha',
		name: 'piranha',
		path: animalPath('Piranha'),
		bytes: 376148,
		tris: 882,
		joints: 22,
		textures: ['piranha_Nrm 512×256', 'piranha_Albedo 512×256'],
		clips: ['Piranha_catch', 'Piranha_idle', 'Piranha_swim'],
		role: 'fish',
		fit: 'out',
		why: 'Left out by the brief (Amazonian, and scary).'
	},
	{
		kind: 'animal',
		id: 'arowana',
		name: 'aruanã',
		path: animalPath('arowana'),
		bytes: 1435296,
		tris: 1090,
		joints: 19,
		textures: ['arowana_Nrm 1024×1024', 'arowana_Albedo 1024×1024'],
		clips: ['catch', 'idle', 'swim_forward'],
		role: 'fish',
		fit: 'out',
		why: 'Amazonian.'
	},
	{
		kind: 'animal',
		id: 'DiscusFish',
		name: 'acará-disco',
		path: animalPath('DiscusFish'),
		bytes: 198212,
		tris: 1066,
		joints: 10,
		textures: ['discus_fish_Nrm 256×256', 'discus_fish_AlbedoOp 256×256'],
		clips: [],
		role: 'fish',
		fit: 'out',
		why: 'Amazonian; no clips.'
	},
	{
		kind: 'animal',
		id: 'Angelfish',
		name: 'acará-bandeira',
		path: animalPath('Angelfish'),
		bytes: 223344,
		tris: 968,
		joints: 10,
		textures: ['angelfish_Nrm 256×256', 'angelfish_AlbedoOp 256×256'],
		clips: [],
		role: 'fish',
		fit: 'out',
		why: 'Amazonian; no clips.'
	},
	{
		kind: 'animal',
		id: 'PeacockBass',
		name: 'tucunaré',
		path: animalPath('PeacockBass'),
		bytes: 482700,
		tris: 1056,
		joints: 22,
		textures: ['Material _25_Normal_OpenGL 512×512', 'peacock_bass_Base_Color 512×512'],
		clips: ['Bass_catch', 'Bass_idle', 'Bass_swim'],
		role: 'fish',
		fit: 'out',
		why: 'Amazonian (invasive in the south-east).'
	},
	{
		kind: 'animal',
		id: 'stingray',
		name: 'arraia',
		path: animalPath('stingray'),
		bytes: 2442644,
		tris: 2470,
		joints: 33,
		textures: [
			'stingray_body_Nrm 1024×1024',
			'stingray_body_Albedo 1024×1024',
			'stingray_eye_Nrm 128×128',
			'stingray_eye_Albedo 128×128'
		],
		clips: ['catch_left', 'hit_b_pose', 'hit', 'idle', 'slide_forward', 'slide_left', 'slide_right'],
		role: 'fish',
		fit: 'out',
		why: 'Freshwater stingrays are Amazonian.'
	},
	{
		kind: 'animal',
		id: 'botfly',
		name: 'berne',
		path: animalPath('botfly'),
		bytes: 226788,
		tris: 670,
		joints: 7,
		textures: ['botfly_Nrm 256×256', 'botfly_AlbedoSmth 256×256'],
		clips: ['Failure', 'Movement'],
		role: 'invertebrate',
		fit: 'out',
		why: 'Scary for kids.'
	},
	{
		kind: 'animal',
		id: 'Leech',
		name: 'sanguessuga',
		path: animalPath('Leech'),
		bytes: 65460,
		tris: 626,
		joints: 14,
		textures: ['leech_Nrm 256×128', 'leech_AlbedoSmth 256×128'],
		clips: ['backpack_pose', 'drink_b', 'swing_left', 'swing_right'],
		role: 'invertebrate',
		fit: 'out',
		why: 'Scary for kids.'
	},
	{
		kind: 'animal',
		id: 'Scorpion',
		name: 'escorpião',
		path: animalPath('Scorpion'),
		bytes: 1056884,
		tris: 5312,
		joints: 30,
		textures: ['scorpion_Normal 512×512', 'scorpion_Base_Color 1024×1024'],
		clips: [
			'attack',
			'Death',
			'Idle_Danger',
			'idle',
			'Rotate_Left',
			'Rotate_Right',
			'trapkill',
			'Walk_Forward'
		],
		role: 'invertebrate',
		fit: 'out',
		why: 'Scary for kids.'
	},
	{
		kind: 'animal',
		id: 'Centipede',
		name: 'lacraia',
		path: animalPath('Centipede'),
		bytes: 807272,
		tris: 1556,
		joints: 73,
		textures: ['Rocky Dirt_Normal 512×512', 'Centipede_AlbedoSmth 64×64'],
		clips: ['centipede_death_flat_rot', 'centipede_escape_B_flat_rot'],
		role: 'invertebrate',
		fit: 'out',
		why: 'Scary for kids.'
	},
	{
		kind: 'animal',
		id: 'GoliathBirdEater',
		name: 'aranha-golias',
		path: animalPath('GoliathBirdEater'),
		bytes: 302364,
		tris: 2338,
		joints: 35,
		textures: ['GoliathBE_Nrm 256×256', 'GoliathBE_AlbedoSmth 256×256', 'GoliathBE_fur 128×16'],
		clips: [
			'goliath_attack',
			'goliath_die_b',
			'goliath_idle',
			'goliath_trapkill',
			'goliath_turn_left',
			'goliath_turn_right',
			'goliath_walk'
		],
		role: 'invertebrate',
		fit: 'out',
		why: 'Scary for kids (and Amazonian).'
	}
];

/** Their scenery. Roles are read from names and materials; P16 judges each by eye in the lineup. */
export const STUDY_PLANTS: readonly StudyPlant[] = [
	plant(
		'big_tree_01_log_static',
		6114876,
		2060,
		'log',
		'pick',
		'fallen trunk; has *_caster shadow meshes (hide them)'
	),
	plant(
		'big_tree_01_static',
		7822324,
		3498,
		'tree',
		'pick',
		'canopy or emergent tree; has *_caster shadow meshes (hide them)'
	),
	plant(
		'big_tree_02_static',
		7816548,
		2727,
		'tree',
		'pick',
		'canopy or emergent tree; has *_caster shadow meshes (hide them)'
	),
	plant(
		'big_tree_03_static',
		6791760,
		2229,
		'tree',
		'pick',
		'canopy or emergent tree; has *_caster shadow meshes (hide them)'
	),
	plant(
		'big_tree_04_static',
		6048672,
		2137,
		'tree',
		'pick',
		'canopy or emergent tree; has *_caster shadow meshes (hide them)'
	),
	plant(
		'big_tree_05_ivy_static',
		16863064,
		6129,
		'tree',
		'pick',
		'canopy or emergent tree; has *_caster shadow meshes (hide them)'
	),
	plant('big_tree_05_log_static', 12058532, 4503, 'log', 'pick', 'fallen trunk'),
	plant(
		'big_tree_05_static',
		11517900,
		7306,
		'tree',
		'pick',
		'canopy or emergent tree; has *_caster shadow meshes (hide them)'
	),
	plant(
		'big_tree_06_ivy_static',
		10573692,
		1376,
		'tree',
		'pick',
		'canopy or emergent tree; has *_caster shadow meshes (hide them)'
	),
	plant(
		'big_tree_06_spikes_static',
		5232724,
		1084,
		'tree',
		'maybe',
		'spiny trunk (palm-like; brejaúva/Astrocaryum grows in the Mata Atlântica); has *_caster shadow meshes (hide them)'
	),
	plant(
		'big_tree_06_static',
		5216456,
		1084,
		'tree',
		'pick',
		'canopy or emergent tree; has *_caster shadow meshes (hide them)'
	),
	plant(
		'big_tree_07_static',
		5209704,
		492,
		'tree',
		'pick',
		'canopy or emergent tree; has *_caster shadow meshes (hide them)'
	),
	plant(
		'big_tree_08_flower_static',
		2123928,
		4972,
		'banana',
		'maybe',
		'banana-like plant (big_tree_08_flower carries banana fruit); bananeira is exotic but common at forest edges; has *_caster shadow meshes (hide them)'
	),
	plant(
		'big_tree_08_static',
		4883852,
		2513,
		'banana',
		'maybe',
		'banana-like plant (big_tree_08_flower carries banana fruit); bananeira is exotic but common at forest edges; has *_caster shadow meshes (hide them)'
	),
	plant(
		'big_tree_09_static',
		3262512,
		774,
		'tree',
		'pick',
		'canopy or emergent tree; has *_caster shadow meshes (hide them)'
	),
	plant('big_tree_11_static', 6172516, 2281, 'tree', 'pick', 'canopy tree'),
	plant(
		'big_tree_12_dead_static',
		10060844,
		2976,
		'tree-dead',
		'maybe',
		'dead standing trunk; has *_caster shadow meshes (hide them)'
	),
	plant(
		'big_tree_12_static',
		10092988,
		6358,
		'tree',
		'pick',
		'canopy or emergent tree; has *_caster shadow meshes (hide them)'
	),
	plant(
		'big_tree_13_dead_static',
		8281712,
		3104,
		'tree-dead',
		'maybe',
		'dead standing trunk; has *_caster shadow meshes (hide them)'
	),
	plant(
		'big_tree_13_static',
		10083208,
		4687,
		'tree',
		'pick',
		'canopy or emergent tree; has *_caster shadow meshes (hide them)'
	),
	plant(
		'big_tree_14_static',
		10072232,
		3725,
		'tree',
		'pick',
		'canopy or emergent tree; has *_caster shadow meshes (hide them)'
	),
	plant(
		'Ivy_rocks_a',
		1804084,
		1500,
		'rock-ivy',
		'pick',
		'boulder wrapped in ivy and ferns; has *_caster shadow meshes (hide them)'
	),
	plant(
		'Ivy_rocks_b',
		1808660,
		1840,
		'rock-ivy',
		'pick',
		'boulder wrapped in ivy and ferns; has *_caster shadow meshes (hide them)'
	),
	plant(
		'Ivy_rocks_c',
		5365380,
		644,
		'rock-ivy',
		'pick',
		'boulder wrapped in ivy and ferns; has *_caster shadow meshes (hide them)'
	),
	plant(
		'Ivy_rocks_d',
		5372916,
		1184,
		'rock-ivy',
		'pick',
		'boulder wrapped in ivy and ferns; has *_caster shadow meshes (hide them)'
	),
	plant(
		'Ivy_rocks_e',
		7155248,
		1262,
		'rock-ivy',
		'pick',
		'boulder wrapped in ivy and ferns; has *_caster shadow meshes (hide them)'
	),
	plant('Lianas_set_a', 6248552, 79, 'liana', 'pick', 'cipós hanging from the canopy'),
	plant('Lianas_set_b', 6250556, 368, 'liana', 'pick', 'cipós hanging from the canopy'),
	plant('Lianas_set_c', 6250092, 281, 'liana', 'pick', 'cipós hanging from the canopy'),
	plant(
		'Lianas_set_d',
		2413380,
		36,
		'liana',
		'pick',
		'cipós hanging from the canopy; has *_caster shadow meshes (hide them)'
	),
	plant(
		'medium_plant_01_static',
		4449764,
		2231,
		'understorey',
		'pick',
		'broadleaf understorey plant; has *_caster shadow meshes (hide them)'
	),
	plant(
		'medium_plant_02_flower_static',
		3581748,
		506,
		'understorey',
		'pick',
		'broadleaf understorey plant; has *_caster shadow meshes (hide them)'
	),
	plant(
		'medium_plant_02_static',
		3595068,
		1666,
		'understorey',
		'pick',
		'broadleaf understorey plant; has *_caster shadow meshes (hide them)'
	),
	plant(
		'medium_plant_03_static',
		4353068,
		1672,
		'understorey',
		'pick',
		'broadleaf understorey plant; has *_caster shadow meshes (hide them)'
	),
	plant(
		'medium_plant_04_no_flower_static',
		4359924,
		2414,
		'understorey',
		'pick',
		'broadleaf understorey plant; has *_caster shadow meshes (hide them)'
	),
	plant(
		'medium_plant_04_static',
		4359768,
		2414,
		'understorey',
		'pick',
		'broadleaf understorey plant; has *_caster shadow meshes (hide them)'
	),
	plant(
		'medium_plant_06_static',
		5026224,
		1125,
		'understorey',
		'pick',
		'broadleaf understorey plant; has *_caster shadow meshes (hide them)'
	),
	plant(
		'medium_plant_07_static',
		4348472,
		1360,
		'understorey',
		'pick',
		'broadleaf understorey plant; has *_caster shadow meshes (hide them)'
	),
	plant(
		'medium_plant_08_static',
		5048600,
		2948,
		'understorey',
		'pick',
		'broadleaf understorey plant; has *_caster shadow meshes (hide them)'
	),
	plant(
		'medium_plant_09_static',
		3264444,
		1154,
		'understorey',
		'pick',
		'small bamboo (taquara/taquaruçu are native); has *_caster shadow meshes (hide them)'
	),
	plant(
		'medium_plant_10_static',
		2396012,
		1566,
		'understorey',
		'pick',
		'broadleaf understorey plant; has *_caster shadow meshes (hide them)'
	),
	plant('medium_plant_11_static', 8470808, 2055, 'understorey', 'pick', 'broadleaf understorey plant'),
	plant(
		'medium_plant_12_static',
		1908976,
		2368,
		'understorey',
		'pick',
		'broadleaf understorey plant; has *_caster shadow meshes (hide them)'
	),
	plant(
		'rock_floor_a',
		768608,
		8130,
		'rock',
		'maybe',
		'big stone set (normal maps only: albedo is the material colour)'
	),
	plant(
		'rock_floor_b',
		781984,
		10052,
		'rock',
		'maybe',
		'big stone set (normal maps only: albedo is the material colour)'
	),
	plant(
		'rock_wall_a_floor_a',
		810932,
		12420,
		'rock',
		'maybe',
		'big stone set (normal maps only: albedo is the material colour)'
	),
	plant(
		'rock_wall_a_floor_b',
		811392,
		12420,
		'rock',
		'maybe',
		'big stone set (normal maps only: albedo is the material colour)'
	),
	plant(
		'rock_wall_a',
		789688,
		9146,
		'rock',
		'maybe',
		'big stone set (normal maps only: albedo is the material colour)'
	),
	plant(
		'rock_wall_b_floor_a',
		809480,
		12420,
		'rock',
		'maybe',
		'big stone set (normal maps only: albedo is the material colour)'
	),
	plant(
		'rock_wall_b_floor_b',
		810440,
		12420,
		'rock',
		'maybe',
		'big stone set (normal maps only: albedo is the material colour)'
	),
	plant(
		'rock_wall_b',
		788740,
		9146,
		'rock',
		'maybe',
		'big stone set (normal maps only: albedo is the material colour)'
	),
	plant(
		'rock_wall_c_floor_a',
		811488,
		12420,
		'rock',
		'maybe',
		'big stone set (normal maps only: albedo is the material colour)'
	),
	plant(
		'rock_wall_c_floor_b',
		812424,
		12420,
		'rock',
		'maybe',
		'big stone set (normal maps only: albedo is the material colour)'
	),
	plant(
		'rock_wall_c',
		790712,
		9146,
		'rock',
		'maybe',
		'big stone set (normal maps only: albedo is the material colour)'
	),
	plant(
		'rock_wall_flat_a',
		537752,
		6734,
		'rock',
		'maybe',
		'big stone set (normal maps only: albedo is the material colour)'
	),
	plant(
		'rock_wall_flat_b',
		789672,
		9146,
		'rock',
		'maybe',
		'big stone set (normal maps only: albedo is the material colour)'
	),
	plant(
		'rock_wall_flat_short_a',
		536328,
		6734,
		'rock',
		'maybe',
		'big stone set (normal maps only: albedo is the material colour)'
	),
	plant(
		'rock_wall_flat_short_b',
		536328,
		6734,
		'rock',
		'maybe',
		'big stone set (normal maps only: albedo is the material colour)'
	),
	plant(
		'small_plant_01_static',
		4338440,
		422,
		'groundcover',
		'pick',
		'small herb or fern; has *_caster shadow meshes (hide them)'
	),
	plant(
		'small_plant_02_static',
		3579828,
		259,
		'groundcover',
		'pick',
		'small herb or fern; has *_caster shadow meshes (hide them)'
	),
	plant(
		'small_plant_03_static',
		4337432,
		328,
		'groundcover',
		'pick',
		'small herb or fern; has *_caster shadow meshes (hide them)'
	),
	plant(
		'small_plant_04_static',
		3579420,
		227,
		'groundcover',
		'pick',
		'small herb or fern; has *_caster shadow meshes (hide them)'
	),
	plant(
		'small_plant_05_static',
		3582024,
		573,
		'groundcover',
		'pick',
		'small herb or fern; has *_caster shadow meshes (hide them)'
	),
	plant(
		'small_plant_07_static',
		4338576,
		368,
		'groundcover',
		'pick',
		'small herb or fern; has *_caster shadow meshes (hide them)'
	),
	plant(
		'small_plant_08_static',
		4343760,
		827,
		'groundcover',
		'pick',
		'small herb or fern; has *_caster shadow meshes (hide them)'
	),
	plant(
		'small_plant_10_static',
		3590596,
		1042,
		'groundcover',
		'pick',
		'small herb or fern; has *_caster shadow meshes (hide them)'
	),
	plant(
		'small_plant_11_static',
		3583064,
		626,
		'groundcover',
		'pick',
		'small herb or fern; has *_caster shadow meshes (hide them)'
	),
	plant(
		'small_plant_12_pink_a_static',
		3583624,
		719,
		'flowers',
		'pick',
		'flowering herb (pink, red or yellow); has *_caster shadow meshes (hide them)'
	),
	plant(
		'small_plant_12_pink_b_static',
		3583692,
		719,
		'flowers',
		'pick',
		'flowering herb (pink, red or yellow); has *_caster shadow meshes (hide them)'
	),
	plant(
		'small_plant_12_red_a_static',
		3583628,
		719,
		'flowers',
		'pick',
		'flowering herb (pink, red or yellow); has *_caster shadow meshes (hide them)'
	),
	plant(
		'small_plant_12_red_b_static',
		3583644,
		719,
		'flowers',
		'pick',
		'flowering herb (pink, red or yellow); has *_caster shadow meshes (hide them)'
	),
	plant(
		'small_plant_12_yellow_a_static',
		3583712,
		719,
		'flowers',
		'pick',
		'flowering herb (pink, red or yellow); has *_caster shadow meshes (hide them)'
	),
	plant(
		'small_plant_12_yellow_b_static',
		3583684,
		719,
		'flowers',
		'pick',
		'flowering herb (pink, red or yellow); has *_caster shadow meshes (hide them)'
	),
	plant(
		'small_plant_13_static',
		1298524,
		475,
		'groundcover',
		'pick',
		'small herb or fern; has *_caster shadow meshes (hide them)'
	),
	plant(
		'small_plant_14_static',
		4551176,
		240,
		'groundcover',
		'pick',
		'Psychotria viridis (the genus is common in the Mata Atlântica)'
	),
	plant('tiny_plant_01_new_static', 1457776, 10, 'groundcover', 'pick', 'tiny herb card'),
	plant('tiny_plant_01_static', 598756, 23, 'groundcover', 'pick', 'tiny herb card'),
	plant(
		'tiny_plant_02_new_static',
		1460532,
		130,
		'groundcover',
		'pick',
		'tiny herb card; has *_caster shadow meshes (hide them)'
	),
	plant('tiny_plant_02_static', 599572, 87, 'groundcover', 'pick', 'tiny herb card'),
	plant('tiny_plant_03_new_static', 1458152, 49, 'groundcover', 'pick', 'tiny herb card'),
	plant('tiny_plant_03_static', 599000, 52, 'groundcover', 'pick', 'tiny herb card'),
	plant(
		'tiny_plant_04_new_static',
		1459520,
		48,
		'groundcover',
		'pick',
		'tiny herb card; has *_caster shadow meshes (hide them)'
	),
	plant('tiny_plant_04_static', 598728, 30, 'groundcover', 'pick', 'tiny herb card'),
	plant(
		'tiny_plant_05_new_static',
		1462108,
		205,
		'groundcover',
		'pick',
		'tiny herb card; has *_caster shadow meshes (hide them)'
	),
	plant('tiny_plant_dried_01_static', 768636, 5, 'litter', 'maybe', 'dry tuft'),
	plant('tiny_plant_dried_02_static', 768628, 4, 'litter', 'maybe', 'dry tuft'),
	plant('tiny_plant_dried_03_static', 768660, 4, 'litter', 'maybe', 'dry tuft'),
	plant('tiny_plant_dried_04_static', 768640, 3, 'litter', 'maybe', 'dry tuft')
];

/** Their sound groups, deduplicated by name (the extraction holds some clips twice). */
export const STUDY_SOUNDS: readonly StudySoundGroup[] = [
	{
		kind: 'sound',
		id: 'jungle-day-bed',
		role: 'bed-day',
		fit: 'pick',
		note: 'day forest bed, stereo loop',
		files: ['audio/16056-jungle_day_stereo_loop.webm']
	},
	{
		kind: 'sound',
		id: 'swamp-day-bed',
		role: 'bed-day',
		fit: 'pick',
		note: 'wet lowland day bed (river bank, mangue)',
		files: ['audio/20887-amb_swamp_day_stereo_loop.webm']
	},
	{
		kind: 'sound',
		id: 'birds-bed',
		role: 'bed-day',
		fit: 'maybe',
		note: 'generic birds bed',
		files: ['audio/16257-amb_birds_default_test.webm']
	},
	{
		kind: 'sound',
		id: 'jungle-night-bed',
		role: 'bed-night',
		fit: 'pick',
		note: 'night forest bed',
		files: ['audio/20974-jungle_night_stereo_loop.webm']
	},
	{
		kind: 'sound',
		id: 'swamp-night-bed',
		role: 'bed-night',
		fit: 'pick',
		note: 'night wetland bed (frogs)',
		files: ['audio/18097-amb_swamp_night_stereo_loop.webm']
	},
	{
		kind: 'sound',
		id: 'crickets',
		role: 'bed-night',
		fit: 'pick',
		note: 'cricket loops',
		files: [
			'audio/18128-amb_crickets_01_loop.webm',
			'audio/14861-amb_crickets_02_loop.webm',
			'audio/15333-amb_crickets_03_loop.webm',
			'audio/17014-amb_crickets_04_loop.webm'
		]
	},
	{
		kind: 'sound',
		id: 'stream',
		role: 'bed-water',
		fit: 'pick',
		note: 'calm stream: the Reserva river',
		files: ['audio/14731-amb_stream_calm_loop.webm']
	},
	{
		kind: 'sound',
		id: 'lake',
		role: 'bed-water',
		fit: 'maybe',
		note: 'still water',
		files: ['audio/16443-amb_lake_calm_loop.webm']
	},
	{
		kind: 'sound',
		id: 'waterfall',
		role: 'bed-water',
		fit: 'pick',
		note: 'waterfall loops: the cachoeira landmark',
		files: [
			'audio/17844-Waterfall_big_loop.webm',
			'audio/18834-Waterfall_medium_loop.webm',
			'audio/17829-Waterfall_small_loop.webm'
		]
	},
	{
		kind: 'sound',
		id: 'day-calls',
		role: 'oneshot-day',
		fit: 'pick',
		note: 'random day animal calls (birds, insects); listen before use, some are Amazonian species',
		files: [
			'audio/14815-jungle_day_animal_random_01.webm',
			'audio/16464-jungle_day_animal_random_02.webm',
			'audio/18638-jungle_day_animal_random_03.webm',
			'audio/14510-jungle_day_animal_random_04.webm',
			'audio/14628-jungle_day_animal_random_05.webm',
			'audio/18567-jungle_day_animal_random_06.webm',
			'audio/18510-jungle_day_animal_random_07.webm',
			'audio/15651-jungle_day_animal_random_08.webm',
			'audio/21365-jungle_day_animal_random_10.webm',
			'audio/20258-jungle_day_animal_random_11.webm',
			'audio/16704-jungle_day_animal_random_12.webm',
			'audio/14867-jungle_day_animal_random_13.webm',
			'audio/14393-jungle_day_animal_random_14.webm',
			'audio/19557-jungle_day_animal_random_15.webm',
			'audio/16162-jungle_day_animal_random_16.webm',
			'audio/21068-jungle_day_animal_random_17.webm',
			'audio/14340-jungle_day_animal_random_18.webm',
			'audio/14874-jungle_day_animal_random_19.webm',
			'audio/17021-jungle_day_animal_random_20.webm',
			'audio/14154-jungle_day_animal_random_21.webm',
			'audio/14170-jungle_day_animal_random_22.webm',
			'audio/14716-jungle_day_animal_random_23.webm'
		]
	},
	{
		kind: 'sound',
		id: 'night-calls',
		role: 'oneshot-night',
		fit: 'pick',
		note: 'random night calls; listen before use',
		files: [
			'audio/16452-jungle_night_animal_random_01.webm',
			'audio/15655-jungle_night_animal_random_02.webm',
			'audio/14851-jungle_night_animal_random_03.webm',
			'audio/15815-jungle_night_animal_random_04.webm',
			'audio/15875-jungle_night_animal_random_05.webm',
			'audio/15958-jungle_night_animal_random_06.webm',
			'audio/17022-jungle_night_animal_random_07.webm',
			'audio/15683-jungle_night_animal_random_08.webm',
			'audio/20947-jungle_night_animal_random_09.webm',
			'audio/20822-jungle_night_animal_random_10.webm',
			'audio/17848-jungle_night_animal_random_11.webm',
			'audio/16522-jungle_night_animal_random_12.webm',
			'audio/16405-jungle_night_animal_random_13.webm',
			'audio/19321-jungle_night_animal_random_14.webm',
			'audio/15131-jungle_night_animal_random_15.webm',
			'audio/16846-jungle_night_animal_random_16.webm',
			'audio/15923-jungle_night_animal_random_17.webm',
			'audio/20489-jungle_night_animal_random_18.webm',
			'audio/14679-jungle_night_animal_random_19.webm',
			'audio/18911-jungle_night_animal_random_20.webm',
			'audio/16760-jungle_night_animal_random_21.webm'
		]
	},
	{
		kind: 'sound',
		id: 'wind',
		role: 'weather',
		fit: 'maybe',
		note: 'wind beds',
		files: [
			'audio/15392-amb_wind_heavy_01.webm',
			'audio/15731-amb_wind_light_01.webm',
			'audio/21272-amb_wind_medium_01.webm'
		]
	},
	{
		kind: 'sound',
		id: 'foliage-wind',
		role: 'weather',
		fit: 'maybe',
		note: 'palm-leaf rustle',
		files: [
			'audio/14429-amb_foliage_palm_trees_wind_heavy_01.webm',
			'audio/17130-amb_foliage_palm_trees_wind_light_01.webm',
			'audio/14856-amb_foliage_palm_trees_wind_medium_01.webm'
		]
	},
	{
		kind: 'sound',
		id: 'rain',
		role: 'weather',
		fit: 'maybe',
		note: 'rain beds (tent variants left out)',
		files: [
			'audio/16132-jungle_rain_light_stereo_loop.webm',
			'audio/19091-jungle_rain_strong_stereo_loop.webm'
		]
	},
	{
		kind: 'sound',
		id: 'thunder',
		role: 'weather',
		fit: 'maybe',
		note: 'distant thunder; can startle small kids',
		files: [
			'audio/19058-amb_thunder_distant_01.webm',
			'audio/15551-amb_thunder_distant_02.webm',
			'audio/15758-amb_thunder_distant_03.webm',
			'audio/19487-amb_thunder_distant_04.webm',
			'audio/16181-amb_thunder_distant_05.webm',
			'audio/16951-amb_thunder_distant_06.webm',
			'audio/18151-amb_thunder_distant_07.webm',
			'audio/14527-amb_thunder_distant_08.webm',
			'audio/19169-amb_thunder_distant_09.webm'
		]
	},
	{
		kind: 'sound',
		id: 'capybara-calls',
		role: 'call',
		fit: 'pick',
		animal: 'Capybara',
		note: 'capivara whistles and clicks',
		files: [
			'audio/14247-anim_capybara_idle_01.webm',
			'audio/16005-anim_capybara_idle_02.webm',
			'audio/19336-anim_capybara_idle_03.webm',
			'audio/14584-anim_capybara_idle_04.webm',
			'audio/18243-anim_capybara_idle_05.webm',
			'audio/18439-anim_capybara_idle_06.webm',
			'audio/17902-anim_capybara_idle_07.webm',
			'audio/14953-anim_capybara_idle_08.webm',
			'audio/14696-anim_capybara_idle_09.webm',
			'audio/14312-anim_capybara_idle_10.webm',
			'audio/16770-anim_capybara_idle_11.webm',
			'audio/16076-anim_capybara_idle_12.webm',
			'audio/15325-anim_capybara_idle_13.webm',
			'audio/15885-anim_capybara_idle_14.webm',
			'audio/20627-anim_capybara_pet_01.webm'
		]
	},
	{
		kind: 'sound',
		id: 'capybara-alarm',
		role: 'call',
		fit: 'pick',
		animal: 'Capybara',
		note: 'capivara alarm bark (flee)',
		files: [
			'audio/15456-anim_capybara_scared_01.webm',
			'audio/17542-anim_capybara_scared_02.webm',
			'audio/14538-anim_capybara_scared_03.webm',
			'audio/15258-anim_capybara_scared_04.webm',
			'audio/18759-anim_capybara_scared_05.webm',
			'audio/15968-anim_capybara_scared_06.webm',
			'audio/15830-anim_capybara_scared_07.webm'
		]
	},
	{
		kind: 'sound',
		id: 'tapir-calls',
		role: 'call',
		fit: 'pick',
		animal: 'Tapir',
		note: 'anta whistles',
		files: [
			'audio/20090-anim_tapir_pet_01.webm',
			'audio/17221-tapir_idle_01.webm',
			'audio/14253-tapir_idle_02.webm',
			'audio/16236-tapir_idle_03.webm',
			'audio/14570-tapir_idle_04.webm',
			'audio/17966-tapir_idle_05.webm'
		]
	},
	{
		kind: 'sound',
		id: 'tapir-alarm',
		role: 'call',
		fit: 'pick',
		animal: 'Tapir',
		note: 'anta alarm and run',
		files: [
			'audio/17201-anim_tapir_scared_01.webm',
			'audio/16616-anim_tapir_scared_02.webm',
			'audio/17662-anim_tapir_scared_03.webm',
			'audio/15703-anim_tapir_scared_04.webm',
			'audio/18072-tapir_run_01.webm',
			'audio/14588-tapir_run_02.webm',
			'audio/18909-tapir_run_03.webm',
			'audio/15964-tapir_run_04.webm'
		]
	},
	{
		kind: 'sound',
		id: 'peccary-calls',
		role: 'call',
		fit: 'pick',
		animal: 'Peccary',
		note: 'cateto grunts',
		files: [
			'audio/17824-Peccary_Idle_01.webm',
			'audio/19899-Peccary_Idle_02.webm',
			'audio/20552-Peccary_Idle_03.webm',
			'audio/15922-Peccary_Idle_04.webm',
			'audio/15595-Peccary_Idle_05.webm',
			'audio/15749-Peccary_Idle_06.webm',
			'audio/16198-Peccary_Idle_07.webm',
			'audio/16237-Peccary_Idle_08.webm',
			'audio/15800-Peccary_Idle_09.webm',
			'audio/20345-anim_peccary_pet_01.webm'
		]
	},
	{
		kind: 'sound',
		id: 'peccary-alarm',
		role: 'call',
		fit: 'pick',
		animal: 'Peccary',
		note: 'cateto alarm (teeth clack)',
		files: [
			'audio/16062-Peccary_Panic_01.webm',
			'audio/16959-Peccary_Panic_02.webm',
			'audio/17216-Peccary_Panic_03.webm'
		]
	},
	{
		kind: 'sound',
		id: 'armadillo-calls',
		role: 'call',
		fit: 'pick',
		animal: 'Armadillo',
		note: 'tatu snuffles and scurry',
		files: [
			'audio/16563-armadillo_idle_01.webm',
			'audio/17275-armadillo_idle_02.webm',
			'audio/17938-armadillo_idle_03.webm',
			'audio/16550-armadillo_idle_04.webm',
			'audio/16313-armadillo_idle_05.webm',
			'audio/15194-armadillo_idle_06.webm',
			'audio/15688-armadillo_run_01.webm',
			'audio/14216-armadillo_run_02.webm'
		]
	},
	{
		kind: 'sound',
		id: 'toad-calls',
		role: 'call',
		fit: 'pick',
		animal: 'CaneToad',
		note: 'frog idle calls for the sapo-cururu',
		files: [
			'audio/17594-frog_idle_01.webm',
			'audio/17718-frog_idle_02.webm',
			'audio/14587-frog_idle_03.webm',
			'audio/18218-frog_stretcher_rnd_02.webm'
		]
	},
	{
		kind: 'sound',
		id: 'puma-calls',
		role: 'call',
		fit: 'pick',
		animal: 'Puma',
		note: 'onça-parda idle and lurk (no growls, no attacks)',
		files: [
			'audio/14427-Puma_Idle_01.webm',
			'audio/18518-Puma_Lurkin_01.webm',
			'audio/14986-Puma_Lurking_loop.webm'
		]
	},
	{
		kind: 'sound',
		id: 'toucan-calls',
		role: 'call',
		fit: 'maybe',
		note: 'toucan calls: we already have the tucano-de-bico-verde',
		files: [
			'audio/18394-Toucan SFX 1.webm',
			'audio/17214-Toucan SFX 2.webm',
			'audio/17596-Toucan SFX 3.webm',
			'audio/19489-Toucan SFX 4.webm'
		]
	},
	{
		kind: 'sound',
		id: 'jaguar-calls',
		role: 'call',
		fit: 'existing',
		animal: 'Jaguar',
		note: 'we already have the onça; for reference only',
		files: ['audio/15506-Jaguar_Idle_01.webm', 'audio/14320-Jaguar_Lurkin_01.webm']
	},
	{
		kind: 'sound',
		id: 'dart-frog-calls',
		role: 'call',
		fit: 'out',
		animal: 'PoisonDartFrog',
		note: 'Amazonian dart frog',
		files: [
			'audio/14514-dart_frog_call_01.webm',
			'audio/17511-dart_frog_call_02.webm',
			'audio/15153-dart_frog_call_03.webm',
			'audio/16009-dart_frog_call_04.webm',
			'audio/17726-dart_frog_call_05.webm'
		]
	},
	{
		kind: 'sound',
		id: 'predator-attacks',
		role: 'call',
		fit: 'out',
		note: 'attack, hit and death sounds: scary for kids',
		files: [
			'audio/19354-Jaguar_Attack_01.webm',
			'audio/17477-Jaguar_Attack_02.webm',
			'audio/18564-Jaguar_Attack_03.webm',
			'audio/14967-Jaguar_Attack_04.webm',
			'audio/17320-Jaguar_Death_01.webm',
			'audio/17161-Jaguar_Growl.webm',
			'audio/20717-Jaguar_Growl_01.webm',
			'audio/19966-Jaguar_Growl_02.webm',
			'audio/20225-Jaguar_Growl_03.webm',
			'audio/15882-Jaguar_Hit_01.webm',
			'audio/19530-Jaguar_Hit_02.webm',
			'audio/17996-Jaguar_Panic_01.webm',
			'audio/18038-Jaguar_Panic_02.webm',
			'audio/14278-Jaguar_Postattack_01.webm',
			'audio/19579-Jaguar_Postattack_02.webm',
			'audio/20159-Puma_Attack_01.webm',
			'audio/14952-Puma_Attack_02.webm',
			'audio/16758-Puma_Attack_03.webm',
			'audio/16259-Puma_Attack_04.webm',
			'audio/14905-Puma_Death_01.webm',
			'audio/14431-Puma_Death_02.webm',
			'audio/18330-Puma_Growl_01.webm',
			'audio/17094-Puma_Growl_02.webm',
			'audio/16827-Puma_Hit_01.webm',
			'audio/16647-Puma_Hit_02.webm',
			'audio/16183-Puma_Panic_01.webm',
			'audio/15383-Puma_Panic_02.webm',
			'audio/16042-Puma_PostAttack_01.webm',
			'audio/19460-Puma_PostAttack_02.webm',
			'audio/14555-Puma_PostAttack_03.webm'
		]
	},
	{
		kind: 'sound',
		id: 'prey-deaths',
		role: 'call',
		fit: 'out',
		note: 'death and hit sounds',
		files: [
			'audio/14835-Peccary_Death_01.webm',
			'audio/17250-Peccary_Death_02.webm',
			'audio/15373-Peccary_Hit_01.webm',
			'audio/16221-Peccary_Hit_02.webm',
			'audio/15858-armadillo_die_01.webm',
			'audio/16124-armadillo_die_02.webm',
			'audio/16242-armadillo_die_03.webm',
			'audio/15066-armadillo_hit_01.webm',
			'audio/19769-armadillo_hit_02.webm',
			'audio/14299-capybara_death_03.webm',
			'audio/21358-tapir_death_01.webm',
			'audio/14761-tapir_death_02.webm'
		]
	},
	{
		kind: 'sound',
		id: 'caiman',
		role: 'call',
		fit: 'out',
		note: 'caiman and caiman lizard: wrong biome',
		files: [
			'audio/14917-Caiman_Belly_Tail_Drag_01.webm',
			'audio/14238-Caiman_Belly_Tail_Drag_02.webm',
			'audio/14964-Caiman_Belly_Tail_Drag_03.webm',
			'audio/16377-Caiman_Belly_Tail_Drag_04.webm',
			'audio/20188-Caiman_Belly_Tail_Drag_05.webm',
			'audio/20782-Caiman_Belly_Tail_Drag_06.webm',
			'audio/19309-Caiman_Belly_Tail_Drag_07.webm',
			'audio/17558-Caiman_Belly_Tail_Drag_08.webm',
			'audio/16230-Caiman_Death_02.webm',
			'audio/20488-Caiman_Hit_01.webm',
			'audio/20077-Caiman_Hit_02.webm',
			'audio/14627-Caiman_Hit_03.webm',
			'audio/18188-Caiman_Lizard_Death_01.webm',
			'audio/14461-Caiman_Lizard_Death_02.webm',
			'audio/17436-Caiman_Lizard_Hit_01.webm',
			'audio/16789-Caiman_Lizard_Hit_02.webm',
			'audio/19396-Caiman_Lizard_Panic_01.webm',
			'audio/15600-Caiman_Lizard_Panic_02.webm',
			'audio/14563-Caiman_Lizard_Run_Begin_set01.webm',
			'audio/15211-Caiman_Lizard_Run_Begin_set02.webm',
			'audio/17169-Caiman_Lizard_Run_Loop_set01.webm',
			'audio/21088-Caiman_Lizard_Run_Loop_set02.webm',
			'audio/14454-Caiman_idle_01.webm',
			'audio/15759-caiman_attack.webm'
		]
	},
	{
		kind: 'sound',
		id: 'snakes-spiders',
		role: 'call',
		fit: 'out',
		note: 'rattlesnake, goliath bird-eater: scary',
		files: [
			'audio/17766-Bird_Eater_Attack_00.webm',
			'audio/17020-Bird_Eater_Attack_01.webm',
			'audio/15469-Bird_Eater_Death_00.webm',
			'audio/16475-Bird_Eater_Run_Loop.webm',
			'audio/19577-Bird_Eater_Walk_Loop.webm',
			'audio/16283-Rattlesnake_Attack.webm',
			'audio/17039-Rattlesnake_Attack_01.webm',
			'audio/14645-Rattlesnake_Attack_02.webm',
			'audio/18853-Rattlesnake_Death.webm',
			'audio/14978-Rattlesnake_Hit_01.webm',
			'audio/17419-Rattlesnake_Hit_02.webm',
			'audio/18235-Rattlesnake_Hit_03.webm',
			'audio/15795-Rattlesnake_Loop.webm',
			'audio/21354-Snake_pass_Stone_Push.webm'
		]
	},
	{
		kind: 'sound',
		id: 'other-ambience',
		role: 'other',
		fit: 'out',
		note: 'underwater, steamboat, interiors, the sanity mix (horror), tent rain',
		files: [
			'audio/20187-Ambient_Interrior_loop_stereo.webm',
			'audio/14319-amb_underwater_loop.webm',
			'audio/20308-ambient_murrderer_for_sanity_mix.webm',
			'audio/18521-ambient_steamboat_inside_loop.webm',
			'audio/17256-ambient_steamboat_outside_loop.webm',
			'audio/20681-jungle_rain_light_tent_stereo_loop.webm',
			'audio/19986-jungle_rain_strong_tent_stereo_loop.webm',
			'audio/19270-wind_stone_hole_loop_mono.webm'
		]
	}
];

/** Everything, for P15 (sound) and P16 (vegetation): filter by `kind`, `role` and `fit`. */
export const studyCatalog: readonly StudyItem[] = [...STUDY_ANIMALS, ...STUDY_PLANTS, ...STUDY_SOUNDS];

/** A catalogued animal by its Green Hell id. */
export function studyAnimal(id: string): StudyAnimal | undefined {
	return STUDY_ANIMALS.find((a) => a.id === id);
}
