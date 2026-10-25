/**
 * A damped spring with a damping ratio, for the presets in src/style/motion.ts:
 * bodies at ζ 1 (critically damped) and appendages at ζ 0.6 (a little
 * overshoot). ../spring.ts only covers ζ = 1, so this is its generalization;
 * see p3-animals.md for the proposed change there.
 *
 * Integrated with the exact solution for a target held over the step, so any
 * dt is stable and two half steps equal one full step when the target does not
 * change. For x'' = -ω²(x - target) - 2ζω x', with y = x - target, a = ζω and
 * b = ω√(1 - ζ²):
 *   y(t) = e^(-at) (y0 cos bt + (v0 + a y0) / b · sin bt)
 *   v(t) = e^(-at) (v0 cos bt - (a v0 + ω² y0) / b · sin bt)
 * ζ = 1 uses the critically damped limit; ζ > 1 is clamped to 1.
 *
 * The coefficients depend only on dt, so they are cached: at a steady frame
 * rate each step is a few multiplications.
 */
import { SPRING } from '../../style/motion.ts';
import { TAU } from './scalar.ts';

export interface SpringPreset {
	/** Natural frequency in Hz. */
	readonly hz: number;
	/** Damping ratio: 1 settles without overshoot, below 1 overshoots. */
	readonly damping: number;
}

export type SpringPresetId = keyof typeof SPRING;

export class DampedSpring {
	value = 0;
	velocity = 0;
	/** Angular frequency, rad/s. */
	omega = 1;
	/** Damping ratio in (0, 1]. */
	zeta = 1;
	// Cached step coefficients: y' = cyy y + cyv v, v' = cvy y + cvv v.
	#dt = -1;
	#cyy = 1;
	#cyv = 0;
	#cvy = 0;
	#cvv = 1;

	constructor(preset: SpringPreset, tempo = 1) {
		this.configure(preset, tempo);
	}

	/**
	 * Sets the frequency from a preset scaled by `tempo` (a slower animal has
	 * tempo < 1; the species table documents each factor). The damping ratio is
	 * the preset's.
	 */
	configure(preset: SpringPreset, tempo = 1) {
		const hz = preset.hz * (tempo > 0 ? tempo : 1);
		this.omega = TAU * hz;
		this.zeta = Math.min(1, Math.max(0.05, preset.damping));
		this.#dt = -1;
	}

	/** Advances toward `target` by `dt` seconds and returns the new value. */
	step(target: number, dt: number): number {
		if (!(dt > 0)) return this.value;
		if (dt !== this.#dt) this.#coefficients(dt);
		const offset = this.value - target;
		const velocity = this.velocity;
		this.value = target + this.#cyy * offset + this.#cyv * velocity;
		this.velocity = this.#cvy * offset + this.#cvv * velocity;
		return this.value;
	}

	/**
	 * Adds a velocity impulse that, from rest and with ζ = 1, peaks at `amount`
	 * away from the target (x(t) = v t e^(-ωt) peaks at v / (ω e)); with ζ < 1 the
	 * peak is a little higher. Callers keep `amount` inside LIMITS.
	 */
	kick(amount: number) {
		if (Number.isFinite(amount)) this.velocity += amount * this.omega * Math.E;
	}

	reset(value = 0) {
		this.value = Number.isFinite(value) ? value : 0;
		this.velocity = 0;
	}

	#coefficients(dt: number) {
		const omega = this.omega;
		const zeta = this.zeta;
		this.#dt = dt;
		if (zeta >= 1) {
			const decay = Math.exp(-omega * dt);
			this.#cyy = (1 + omega * dt) * decay;
			this.#cyv = dt * decay;
			this.#cvy = -omega * omega * dt * decay;
			this.#cvv = (1 - omega * dt) * decay;
			return;
		}
		const a = zeta * omega;
		const b = omega * Math.sqrt(1 - zeta * zeta);
		const decay = Math.exp(-a * dt);
		const cos = Math.cos(b * dt);
		const sin = Math.sin(b * dt);
		this.#cyy = decay * (cos + (a / b) * sin);
		this.#cyv = (decay * sin) / b;
		this.#cvy = (-decay * omega * omega * sin) / b;
		this.#cvv = decay * (cos - (a / b) * sin);
	}
}
