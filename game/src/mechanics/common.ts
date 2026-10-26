import type { Vec3 } from '../engine/character.ts';

export type { Vec3 };
export const clamp = (v: number, low: number, high: number) => Math.max(low, Math.min(high, v));
export const axis = (v: number) => (Number.isFinite(v) ? clamp(v, -1, 1) : 0);
export const distance = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
export function copy(out: Vec3, p: Vec3) {
	out.x = p.x;
	out.y = p.y;
	out.z = p.z;
}
export function validPoint(p: Vec3) {
	return Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z);
}
