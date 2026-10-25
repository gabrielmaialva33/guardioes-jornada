import { CAMERA_FOV } from '../engine/constants.ts';

const DEG = Math.PI / 180;
const REFERENCE_ASPECT = 16 / 9;
/** Landscape keeps the engine's vertical FOV; narrower views preserve its horizontal field. */
export function verticalFov(aspect: number): number {
	const safeAspect = Number.isFinite(aspect) && aspect > 0 ? aspect : REFERENCE_ASPECT;
	return (
		(2 *
			Math.atan(
				(Math.tan((CAMERA_FOV * DEG) / 2) * REFERENCE_ASPECT) / Math.min(safeAspect, REFERENCE_ASPECT)
			)) /
		DEG
	);
}
export function horizontalFov(vertical: number, aspect: number): number {
	return (2 * Math.atan(Math.tan((vertical * DEG) / 2) * aspect)) / DEG;
}
