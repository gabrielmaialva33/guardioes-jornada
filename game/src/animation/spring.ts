/**
 * Critically damped spring, integrated with its exact solution: it never
 * overshoots, and any dt (0, a 200 ms hitch, a resumed tab) stays stable.
 *
 * For x'' = -ω²(x - target) - 2ω x', with y = x - target:
 *   y(t) = (y0 + (v0 + ω y0) t) e^(-ωt)
 *   v(t) = (v0 - ω (v0 + ω y0) t) e^(-ωt)
 */
export class Spring {
	value = 0;
	velocity = 0;
	/** Angular frequency in rad/s; the response settles in about 4/ω seconds. */
	omega = 0;

	constructor(omega: number) {
		this.omega = omega;
	}

	/**
	 * Target and time step for update(): hot paths set these fields instead of
	 * passing numbers, which V8 boxes when a call is not inlined (track.ts Playhead).
	 */
	target = 0;
	dt = 0;

	step(target: number, dt: number): number {
		this.target = target;
		this.dt = dt;
		this.update();
		return this.value;
	}

	/** Advances toward `this.target` by `this.dt` seconds; read `value` after. */
	update() {
		const dt = this.dt;
		if (!(dt > 0)) return;
		const target = this.target;
		const omega = this.omega;
		const offset = this.value - target;
		const slope = this.velocity + omega * offset;
		const decay = Math.exp(-omega * dt);
		this.value = target + (offset + slope * dt) * decay;
		this.velocity = (this.velocity - omega * slope * dt) * decay;
	}

	/**
	 * Adds a velocity impulse that, from rest, peaks at `amount` away from the
	 * target: x(t) = v t e^(-ωt) peaks at v / (ω e) after 1/ω seconds.
	 */
	kick(amount: number) {
		if (Number.isFinite(amount)) this.velocity += amount * this.omega * Math.E;
	}

	reset(value = 0) {
		this.value = value;
		this.velocity = 0;
	}
}
