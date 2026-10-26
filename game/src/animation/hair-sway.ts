/**
 * Secondary motion of the hair accessories (avatar-regions-contract.md v2):
 * a pendulum per style that lags behind the head. A hanging tail settles at
 * the angle of the apparent gravity, so accelerating forward swings it back
 * and a stop swings it forward; an under-damped spring (ζ < 1) carries it past
 * that angle and back, and a share of the head's pitch is undone so the tail
 * keeps hanging when the child looks down.
 *
 * Output is two angles for the dangling part, in the rig's conventions
 * (joints.ts): `pitch` > 0 swings the tail's end back (away from the face) and
 * `roll` > 0 swings it to the character's left (+x). Set them on each of the
 * style's HAIR_DANGLES nodes (HairAccessories.dangles) as a YXZ rotation, after
 * applyToRig; the cap, short, long and afro styles have no dangling part.
 *
 * Reduced motion: off (both angles 0). No allocation per update: inputs are
 * fields, as in DampedSpring.
 */
import { GRAVITY } from '../engine/constants.ts';
import { DampedSpring } from './animals/damped-spring.ts';

const DEG = Math.PI / 180;

export interface HairSwayTuning {
	/** Natural frequency (Hz) and damping ratio of the swing. */
	readonly hz: number;
	readonly damping: number;
	/** Share of the apparent-gravity angle the tail follows. */
	readonly gain: number;
	/** Share of the head's pitch undone, so the tail keeps hanging. */
	readonly hang: number;
	readonly maxPitch: number;
	readonly maxRoll: number;
}

/** Per hair style id (avatar-regions.json v2); null: nothing dangles (the cap's brim is stiff). */
export const HAIR_SWAY: Readonly<Record<string, HairSwayTuning | null>> = {
	curto: null,
	longo: null,
	'black-power': null,
	bone: null,
	rabo: { hz: 1.8, damping: 0.3, gain: 1, hang: 0.8, maxPitch: 40 * DEG, maxRoll: 30 * DEG },
	trancas: { hz: 2.2, damping: 0.35, gain: 0.8, hang: 0.7, maxPitch: 30 * DEG, maxRoll: 25 * DEG },
	coque: { hz: 4.5, damping: 0.45, gain: 0.25, hang: 0, maxPitch: 8 * DEG, maxRoll: 8 * DEG }
};

/**
 * The dangling parts of avatar-hair.glb (avatar-regions-contract.md v3): child
 * nodes of the style's node, each with its origin at the pivot it swings about,
 * in the head node's units (the hair GLB shares the head's origin). Braids swing
 * as one pair, left (+x) first. game/scripts/split-hair.mjs cuts the GLB with
 * these, so the asset and HairSway agree.
 */
export const HAIR_DANGLES: Readonly<
	Record<string, readonly { readonly node: string; readonly pivot: readonly [number, number, number] }[]>
> = {
	rabo: [{ node: 'hair-ponytail-tail', pivot: [0, 0.63, -0.5] }],
	trancas: [
		{ node: 'hair-braids-left', pivot: [0.32, 0.78, -0.22] },
		{ node: 'hair-braids-right', pivot: [-0.32, 0.78, -0.22] }
	],
	coque: [{ node: 'hair-bun-knot', pivot: [0, 0.9, -0.24] }]
};

export class HairSway {
	/** The style's swing, or 0 when it has none or motion is reduced. */
	pitch = 0;
	roll = 0;
	// Inputs, set before update(): head acceleration in the head's frame (u/s²),
	// the head's pitch in the world (radians, forward positive) and the step.
	accelForward = 0;
	accelLeft = 0;
	accelUp = 0;
	headPitch = 0;
	dt = 0;
	reduced = false;
	#tuning: HairSwayTuning | null = null;
	readonly #pitch = new DampedSpring({ hz: 2, damping: 0.3 });
	readonly #roll = new DampedSpring({ hz: 2, damping: 0.3 });

	get style(): HairSwayTuning | null {
		return this.#tuning;
	}

	/** Picks the style by id (unknown ids sway like nothing) and settles the swing. */
	setStyle(id: string | null) {
		const tuning = (id !== null && Object.hasOwn(HAIR_SWAY, id) ? HAIR_SWAY[id] : null) ?? null;
		this.#tuning = tuning;
		if (tuning) {
			this.#pitch.configure(tuning);
			this.#roll.configure(tuning);
		}
		this.reset();
	}

	reset() {
		this.#pitch.reset();
		this.#roll.reset();
		this.pitch = this.roll = 0;
	}

	update() {
		const tuning = this.#tuning;
		if (tuning === null || this.reduced) {
			if (this.pitch !== 0 || this.roll !== 0) this.reset();
			return;
		}
		// Apparent gravity: g minus the head's acceleration; up-acceleration makes it heavier.
		// Inlined finite checks: a helper's float return would be boxed when not inlined.
		const accelUp = this.accelUp;
		const accelForward = this.accelForward;
		const accelLeft = this.accelLeft;
		const headPitch = this.headPitch;
		const down = Math.max(GRAVITY * 0.2, GRAVITY + (Number.isFinite(accelUp) ? accelUp : 0));
		const forward = Math.atan2(Number.isFinite(accelForward) ? accelForward : 0, down);
		const left = Math.atan2(Number.isFinite(accelLeft) ? accelLeft : 0, down);
		const pitchSpring = this.#pitch;
		pitchSpring.target = tuning.gain * forward - tuning.hang * (Number.isFinite(headPitch) ? headPitch : 0);
		pitchSpring.dt = this.dt;
		pitchSpring.update();
		const rollSpring = this.#roll;
		rollSpring.target = -tuning.gain * left;
		rollSpring.dt = this.dt;
		rollSpring.update();
		this.pitch = Math.min(tuning.maxPitch, Math.max(-tuning.maxPitch, pitchSpring.value));
		this.roll = Math.min(tuning.maxRoll, Math.max(-tuning.maxRoll, rollSpring.value));
	}
}
