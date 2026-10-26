import type { Vec3 } from '../engine/character.ts';
/** Upper-crown ellipsoids, built once from each model's bounds and uniform placement scale. */
export interface CanopyVolume {
	x: number;
	y: number;
	z: number;
	rx: number;
	ry: number;
	rz: number;
	id: number;
	setFade: (id: number, opacity: number) => boolean;
}
/** First segment parameter intersecting an ellipsoid; the trunk below it is excluded. */
export function segmentEntry(c: CanopyVolume, a: Vec3, b: Vec3): number | null {
	const x = (a.x - c.x) / c.rx,
		y = (a.y - c.y) / c.ry,
		z = (a.z - c.z) / c.rz;
	const dx = (b.x - a.x) / c.rx,
		dy = (b.y - a.y) / c.ry,
		dz = (b.z - a.z) / c.rz;
	const cc = x * x + y * y + z * z - 1;
	if (cc <= 0) return 0;
	const aa = dx * dx + dy * dy + dz * dz;
	if (aa < 1e-12) return null;
	const bb = x * dx + y * dy + z * dz,
		discriminant = bb * bb - aa * cc;
	if (discriminant < 0) return null;
	const t = (-bb - Math.sqrt(discriminant)) / aa;
	return t >= 0 && t <= 1 ? t : null;
}
function contains(c: CanopyVolume, p: Vec3) {
	return ((p.x - c.x) / c.rx) ** 2 + ((p.y - c.y) / c.ry) ** 2 + ((p.z - c.z) / c.rz) ** 2 <= 1;
}
export class CanopyVisibility {
	readonly #opacity: Float32Array;
	readonly #desired: Uint8Array;
	readonly #end = { x: 0, y: 0, z: 0 };
	fading = 0;
	constructor(readonly volumes: readonly CanopyVolume[]) {
		this.#opacity = new Float32Array(volumes.length).fill(1);
		this.#desired = new Uint8Array(volumes.length);
	}
	/** An extra popper only for a desired camera inside foliage; normal trunk BVH remains authoritative. */
	occlusion = (head: Vec3, direction: Vec3, reach: number): number | null => {
		const end = this.#end;
		end.x = head.x + direction.x * reach;
		end.y = head.y + direction.y * reach;
		end.z = head.z + direction.z * reach;
		this.#desired.fill(0);
		let limit = reach;
		for (let i = 0; i < this.volumes.length; i++) {
			const c = this.volumes[i],
				entry = segmentEntry(c, head, end);
			if (entry === null) continue;
			this.#desired[i] = 1;
			// A head already inside foliage must stay visible: fade it instead of forcing first person.
			if (contains(c, end) && entry > 0) limit = Math.min(limit, Math.max(1.8, entry * reach - 0.3));
		}
		return limit < reach ? limit : null;
	};
	/** No allocations and no transparent sorting or extra draw calls: one opaque dither attribute. */
	update(camera: Vec3, head: Vec3, dt: number, reducedMotion = false) {
		this.fading = 0;
		const step = reducedMotion ? 1 : Math.max(0, dt) / 0.15;
		for (let i = 0; i < this.volumes.length; i++) {
			const c = this.volumes[i];
			const selected = this.#desired[i] === 1 || segmentEntry(c, head, camera) !== null;
			const target = selected ? 0 : 1,
				previous = this.#opacity[i];
			const next = target < previous ? Math.max(target, previous - step) : Math.min(target, previous + step);
			if (next !== previous) {
				this.#opacity[i] = next;
				c.setFade(c.id, next);
			}
			if (next < 0.999) this.fading++;
		}
		this.#desired.fill(0);
	}
}
