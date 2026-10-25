/** Small scalar helpers shared by the character and the camera. */

const TAU = Math.PI * 2;

export const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** Frame-rate independent smoothing factor: lerp(a, b, damp(rate, dt)). */
export function damp(rate: number, dt: number): number {
	return 1 - Math.exp(-rate * dt);
}

/** Wraps an angle to (-π, π]. */
export function wrapAngle(angle: number): number {
	const wrapped = (((angle + Math.PI) % TAU) + TAU) % TAU;
	return wrapped === 0 ? Math.PI : wrapped - Math.PI;
}

/** Interpolates along the shorter arc. */
export function lerpAngle(from: number, to: number, t: number): number {
	return wrapAngle(from + wrapAngle(to - from) * t);
}
