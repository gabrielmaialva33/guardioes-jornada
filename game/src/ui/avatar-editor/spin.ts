/**
 * Drag-to-rotate for the preview's turntable, with a fling: while dragging the
 * yaw follows the pointer; on release the measured speed keeps turning it and
 * decays exponentially. Keyboard steps and the auto-turn of a new framing ease
 * toward a goal instead. Times are seconds (event.timeStamp / 1000), x is CSS px.
 *
 * Reduced motion: the caller never auto-turns, and keyboard steps cut at once;
 * a drag still follows the finger (it is the child's own input) but does not fling.
 * No allocation per call.
 */
const TAU = Math.PI * 2;

export const SPIN = {
	/** Radians per CSS pixel of drag: a whole turn over about 520 px. */
	perPixel: TAU / 520,
	/** Fling decay rate, 1/s: the fling covers speed / friction radians in all. */
	friction: 3.2,
	/** Fastest fling, rad/s. */
	maxSpeed: 14,
	/** Below this speed (rad/s) the fling stops. */
	rest: 0.04,
	/** A release this long after the last move (s) is a stop, not a fling. */
	stale: 0.12,
	/** Time constant of the speed estimate while dragging, s. */
	smoothing: 0.05,
	/** One arrow-key turn. */
	keyStep: Math.PI / 6,
	/** Rate (1/s) at which a goal is approached. */
	seek: 9
} as const;

export class Spin {
	/** Turntable yaw, radians (0: facing the camera). */
	yaw = 0;
	/** Fling speed, rad/s. */
	velocity = 0;
	dragging = false;
	/** Fling on release; off with reduced motion. */
	inertia = true;
	#goal = 0;
	#seeking = false;
	#lastX = 0;
	#lastT = 0;
	#speed = 0;

	/** Something still moves: keep rendering. */
	get active(): boolean {
		return this.dragging || this.#seeking || this.velocity !== 0;
	}

	down(x: number, t: number) {
		this.dragging = true;
		this.velocity = 0;
		this.#seeking = false;
		this.#lastX = x;
		this.#lastT = t;
		this.#speed = 0;
	}

	move(x: number, t: number) {
		if (!this.dragging || !Number.isFinite(x)) return;
		const turn = (x - this.#lastX) * SPIN.perPixel;
		this.yaw += turn;
		const dt = t - this.#lastT;
		if (dt > 0) {
			const k = 1 - Math.exp(-dt / SPIN.smoothing);
			this.#speed += (turn / dt - this.#speed) * k;
		}
		this.#lastX = x;
		this.#lastT = t;
	}

	up(t: number) {
		if (!this.dragging) return;
		this.dragging = false;
		const fresh = t - this.#lastT <= SPIN.stale;
		const speed = Math.min(SPIN.maxSpeed, Math.max(-SPIN.maxSpeed, this.#speed));
		this.velocity = this.inertia && fresh && Math.abs(speed) >= SPIN.rest ? speed : 0;
		this.#speed = 0;
	}

	/** Pointer lost (pointercancel, blur): stop without a fling. */
	cancel() {
		this.dragging = false;
		this.velocity = 0;
		this.#speed = 0;
	}

	/** Arrow keys: one step left (−1) or right (+1); `instant` with reduced motion. */
	turn(direction: number, instant: boolean) {
		const base = this.#seeking ? this.#goal : this.yaw;
		this.velocity = 0;
		this.#goal = base + Math.sign(direction) * SPIN.keyStep;
		this.#seeking = !instant;
		if (instant) this.yaw = this.#goal;
	}

	/** Turns to `yaw` the short way round (a new framing's preferred angle). */
	face(yaw: number, instant: boolean) {
		if (this.dragging) return;
		const goal = yaw + TAU * Math.round((this.yaw - yaw) / TAU);
		this.velocity = 0;
		this.#goal = goal;
		this.#seeking = !instant;
		if (instant) this.yaw = goal;
	}

	/** Advances the fling or the seek by `dt` seconds; true if the yaw changed. */
	step(dt: number): boolean {
		const h = Number.isFinite(dt) && dt > 0 ? Math.min(dt, 0.1) : 0;
		if (this.dragging || h === 0) return false;
		if (this.#seeking) {
			const k = 1 - Math.exp(-SPIN.seek * h);
			this.yaw += (this.#goal - this.yaw) * k;
			if (Math.abs(this.#goal - this.yaw) < 1e-3) {
				this.yaw = this.#goal;
				this.#seeking = false;
				this.#wrap();
			}
			return true;
		}
		if (this.velocity === 0) return false;
		// Exact integral of v·e^(−f·t) over the step, so the fling's reach does not depend on the frame rate.
		const decay = Math.exp(-SPIN.friction * h);
		this.yaw += (this.velocity * (1 - decay)) / SPIN.friction;
		this.velocity *= decay;
		if (Math.abs(this.velocity) < SPIN.rest) {
			this.velocity = 0;
			this.#wrap();
		}
		return true;
	}

	/** Keeps the yaw in (−π, π] once at rest; the view does not change. */
	#wrap() {
		this.yaw -= TAU * Math.round(this.yaw / TAU);
	}
}
