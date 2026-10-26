/**
 * Curation of the LOCAL-ONLY Green Hell study mode: which of the owner's
 * extracted animals the study world shows, how tall (ART.md §3: feet to the top
 * of the silhouette, ×1.5 life size against the 3.0 u avatar) and which clip
 * plays each role. Keys and clip names only: paths, sizes, tris and clip lists
 * are asset data, served at runtime from tmp/ (data.ts), never kept in the repo.
 * DEV only, behind the study gate (gate.ts).
 */

export interface StudyPick {
	/** pt-BR common name. */
	name: string;
	/** u, feet to the top of the silhouette. */
	height: number;
	idle: string;
	walk: string;
	run: string;
	eat: string;
	alerted: string;
	/** Idles played now and then (any match). */
	extra?: RegExp;
	/** Ends `alerted` when that is a hide (the jabuti's shell). */
	show?: string;
}

/** `clips` lists idle, walk, run, eat and alerted, space separated. */
const pick = (name: string, height: number, clips: string, extra?: RegExp, show?: string): StudyPick => {
	const [idle, walk, run, eat, alerted] = clips.split(' ');
	return { name, height, idle, walk, run, eat, alerted, extra, show };
};

/** Keyed by the Green Hell model name. The onça is ours already; the rest are left out (see the report). */
export const STUDY_PICKS: Readonly<Record<string, StudyPick>> = {
	Capybara: pick(
		'capivara',
		1.75,
		'idle_look_around walk_forward_reduced run_forward eat alerted',
		/^(idle_scratch|sit_down_idle)$/
	),
	Tapir: pick(
		'anta',
		2.7,
		'tapir_idle tapir_walk_forward tapir_trot_forward tapir_eat tapir_alerted',
		/^tapir_idle_[bc]$/
	),
	Tapir_baby: pick(
		'filhote de anta',
		1.6,
		'tapir_idle tapir_walk_forward tapir_run_forward tapir_eat tapir_alerted'
	),
	Peccary: pick('cateto', 1.6, 'idle_look_around walk_forward trot_forward idle_smells alerted', /^eat$/),
	// Stands in for the tatu-galinha, whose clips the conversion broke: it rolls up instead of running.
	ArmadilloThreeBanded: pick(
		'tatu-bola',
		0.55,
		'arm3_idle_A arm3_walk_A arm3_walk_B arm3_idle_B arm3_roll',
		/^arm3_idle_B$/,
		'arm3_unroll'
	),
	CaneToad: pick('sapo-cururu', 0.35, 'toad_idle_1 toad_jump toad_jump toad_idle_2 toad_idle_2'),
	Crab: pick('caranguejo', 0.3, 'crab_idle crab_run_right crab_run_right crab_idle crab_idle'),
	Puma: pick('onça-parda', 2.1, 'idle_tail walk_forward run_forward_spine drink idle_tail'),
	RedFootedTortoise: pick(
		'jabuti',
		0.5,
		'Idle_Look_Around Walk_Forward Walk_Forward Idle_Eat hide',
		undefined,
		'show'
	),
	GiantAnteater: pick(
		'tamanduá-bandeira',
		2.1,
		'anteater_idle anteater_walk_forward anteater_run_forward anteater_eat anteater_idle'
	),
	Toucan: pick('tucano (A/B)', 0.9, 'ToucanIdle ToucanIdle ToucanFlap ToucanIdle ToucanFlap'),
	ParrotMacaw: pick('arara-vermelha (verificar)', 1.3, 'MacawIdle MacawIdle MacawFlap MacawIdle MacawFlap')
};
