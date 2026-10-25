/**
 * Preguiça-de-coleira (Bradypus torquatus), endemic to the Atlantic Forest.
 *
 * It hangs below a branch on its hooked claws and is mostly still: maned sloths
 * rest for most of the day (Chiarello 1998, J. Zool. 246:1–10). When it moves,
 * it moves one limb at a time, slowly: slow suspensory walks have duty factors
 * up to 0.89 and footfalls near a 25% phase, the even four-beat order hind
 * left, fore left, hind right, fore right (Nyakatura et al. 2010, Zoology
 * 113:221–234; Usherwood & Self Davies 2017, eLife 6:e29495). Each limb unhooks,
 * travels forward with easeInOutSine for 2.4–3.6 s (animacoes.md §5.1) and
 * hooks on again; the body follows the mean of the four holds, so it creeps
 * forward continuously while only one limb is ever in the air.
 *
 * The route is the underside line of the branch (where the claws hook), walked
 * back and forth; at an end the sloth turns around slowly.
 */
import { Behaviour, type BehaviourOptions } from './behaviour.ts';
import type { AnimalWorld } from './motion.ts';
import { MODELS } from './rigs.ts';
import { type Route, RouteCursor } from './route.ts';
import { clamp, DEG, easeInOutSine, wrapAngle } from './scalar.ts';

export const PREGUICA_STATES = ['idle', 'move', 'rest'] as const;
export type PreguicaState = (typeof PREGUICA_STATES)[number];

/** Limb order as slots front-left 0, front-right 1, back-left 2, back-right 3: LH, LF, RH, RF. */
export const SLOTH_LIMB_ORDER = [2, 0, 3, 1] as const;

export const PREGUICA = {
	/** One limb's reach forward, u, and how long it takes, seconds. */
	step: 0.35,
	limbMove: [2.4, 3.6],
	/** Still pause between two limbs, seconds. */
	limbPause: [0.6, 1.6],
	/** Full four-limb cycles per bout of moving. */
	cycles: [1, 2],
	idle: [6, 15],
	rest: [25, 60],
	restChance: 0.55,
	/** Feet spread ahead of (front) and behind (hind) their hips at rest, model units. */
	spread: 0.15,
	glance: [4, 9],
	glanceYaw: 70 * DEG,
	/** Slow posture fade for a slow animal. */
	fade: 1.5
} as const;

export interface PreguicaOptions extends BehaviourOptions {
	/** Underside line of its branch. */
	branch: Route;
	start?: number;
}

export class PreguicaBehaviour extends Behaviour<PreguicaState> {
	readonly states = PREGUICA_STATES;
	readonly branch: Route;
	readonly cursor = new RouteCursor();
	/** Arc length of each limb's hold on the branch (slots FL, FR, BL, BR). */
	readonly holds = new Float64Array(4);
	/** Limb in the air (slot), or -1; and how far through its move, 0..1. */
	moving = -1;
	progress = 0;
	/** Limbs moved in this bout. */
	moves = 0;
	readonly #from = new Float64Array(4);
	readonly #hipZ = new Float64Array(4);
	#movesLeft = 0;
	#orderIndex = 0;
	#duration = 1;
	#pause = 0;
	#glance = 0;
	#lookYaw = 0;
	#turning = false;

	constructor(options: PreguicaOptions) {
		super('preguica-de-coleira', 'idle', options);
		this.branch = options.branch;
		this.cursor.s = options.start ?? 0;
		this.branch.locate(this.cursor);
		this.motion.yaw = this.drive.targetYaw = this.cursor.yaw;
		const model = MODELS[this.species.model];
		const scale = this.species.scale;
		for (let leg = 0; leg < 4; leg++) {
			const front = leg < 2;
			this.#hipZ[leg] = (front ? model.hipZFront : model.hipZBack) * scale;
			this.holds[leg] =
				this.cursor.s +
				this.cursor.direction * (this.#hipZ[leg] + (front ? 1 : -1) * PREGUICA.spread * scale);
		}
		this.#place();
		this.enter('idle', PREGUICA.idle[0]);
	}

	/** Only ever one limb unhooked at a time. */
	get limbsInAir(): number {
		let count = 0;
		for (let leg = 0; leg < 4; leg++) if (this.motion.limbLift[leg] > 0) count++;
		return count;
	}

	protected advance(_world: AnimalWorld) {
		const h = this.clock.h;
		if (this.state === 'move') this.#moveLimbs();
		this.turn();
		if (this.state === 'idle') {
			this.#glance -= h;
			if (this.#glance <= 0) {
				this.#glance = this.cosmetic.range(PREGUICA.glance[0], PREGUICA.glance[1]);
				this.#lookYaw = this.cosmetic.range(-PREGUICA.glanceYaw, PREGUICA.glanceYaw);
			}
		} else this.#lookYaw = 0;
	}

	protected decide(_world: AnimalWorld) {
		const rng = this.rng;
		switch (this.state) {
			case 'idle':
				if (rng.chance(PREGUICA.restChance))
					this.enter('rest', rng.range(PREGUICA.rest[0], PREGUICA.rest[1]));
				else this.#startMoving();
				break;
			case 'move':
				// The bout ends when its limbs are done (see #moveLimbs); this is a safety net.
				if (this.moving < 0) this.enter('idle', rng.range(PREGUICA.idle[0], PREGUICA.idle[1]));
				else this.clock.timer = 1;
				break;
			default:
				this.enter('idle', rng.range(PREGUICA.idle[0], PREGUICA.idle[1]));
		}
	}

	protected finish(_world: AnimalWorld) {
		const motion = this.motion;
		motion.posture = this.state === 'rest' ? 'hang-curl' : 'hang-under';
		motion.fade = PREGUICA.fade;
		motion.speed = 0;
		motion.lookYaw = this.#lookYaw;
		motion.lookPitch = 0;
		const scale = this.species.scale;
		const direction = this.cursor.direction;
		const body = this.cursor.s;
		for (let leg = 0; leg < 4; leg++) {
			const along = (this.holds[leg] - body) * direction;
			motion.limbReach[leg] = (along - this.#hipZ[leg]) / scale;
			motion.limbLift[leg] = leg === this.moving ? Math.sin(Math.PI * this.progress) : 0;
		}
		this.#place();
	}

	#startMoving() {
		const branch = this.branch;
		const reach = PREGUICA.step * 4;
		const ahead = this.cursor.s + this.cursor.direction * reach;
		if (!branch.closed && (ahead > branch.length || ahead < 0)) {
			// End of the branch: turn around on the spot before the next bout. The holds
			// swap ends of the body (the front limbs now reach the other way).
			this.cursor.direction = -this.cursor.direction;
			branch.locate(this.cursor);
			this.drive.targetYaw = this.cursor.yaw;
			this.#turning = true;
			const body = this.cursor.s;
			for (let leg = 0; leg < 4; leg++) this.holds[leg] = body - (this.holds[leg] - body);
		}
		const cycles = Math.floor(this.rng.range(PREGUICA.cycles[0], PREGUICA.cycles[1] + 1));
		this.#movesLeft = cycles * 4;
		this.#orderIndex = 0;
		this.moves = 0;
		this.#pause = 0;
		this.moving = -1;
		this.enter('move', 1e9);
	}

	/**
	 * Pauses and limb moves hand their leftover time to each other within the
	 * substep, so the timing is exact at any frame rate (and under LOD).
	 */
	#moveLimbs() {
		const h = this.clock.h;
		const motion = this.motion;
		if (this.#turning) {
			if (Math.abs(wrapAngle(this.drive.targetYaw - motion.yaw)) > 0.02) return;
			this.#turning = false;
		}
		let left = h;
		for (let guard = 0; left > 1e-12 && guard < 8; guard++) {
			if (this.moving < 0) {
				if (this.#pause > left) {
					this.#pause -= left;
					return;
				}
				left -= this.#pause;
				this.#pause = 0;
				if (this.#movesLeft <= 0) {
					// The idle timer starts now, not at the start of this substep.
					this.enter('idle', this.rng.range(PREGUICA.idle[0], PREGUICA.idle[1]) + (h - left));
					return;
				}
				this.moving = SLOTH_LIMB_ORDER[this.#orderIndex];
				this.#orderIndex = (this.#orderIndex + 1) % 4;
				this.#from[this.moving] = this.holds[this.moving];
				this.#duration = this.rng.range(PREGUICA.limbMove[0], PREGUICA.limbMove[1]);
				this.progress = 0;
			}
			const leg = this.moving;
			const need = (1 - this.progress) * this.#duration;
			const used = Math.min(left, need);
			this.progress = used >= need ? 1 : this.progress + used / this.#duration;
			left -= used;
			const step = PREGUICA.step * this.cursor.direction;
			this.holds[leg] = this.#from[leg] + step * easeInOutSine(this.progress);
			this.#follow();
			if (this.progress >= 1) {
				this.moving = -1;
				this.moves++;
				this.#movesLeft--;
				this.#pause = this.rng.range(PREGUICA.limbPause[0], PREGUICA.limbPause[1]);
			}
		}
	}

	/** The body sits at the mean of the holds less the hips' offsets. */
	#follow() {
		const direction = this.cursor.direction;
		let sum = 0;
		for (let leg = 0; leg < 4; leg++) sum += this.holds[leg] - direction * this.#hipZ[leg];
		const branch = this.branch;
		const s = sum / 4;
		const before = this.cursor.s;
		this.cursor.s = branch.closed ? s : clamp(s, 0, branch.length);
		branch.locate(this.cursor);
		this.motion.distance += Math.abs(this.cursor.s - before);
	}

	#place() {
		this.motion.x = this.cursor.x;
		this.motion.y = this.cursor.y;
		this.motion.z = this.cursor.z;
	}
}
