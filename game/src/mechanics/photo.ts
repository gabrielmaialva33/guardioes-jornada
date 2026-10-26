import type { Vec3 } from './common.ts';
export interface PhotoSubject {
	id: string;
	species: string;
	position: Vec3;
	enabled?: boolean;
}
export interface PhotoFrame {
	origin: Vec3;
	forward: Vec3;
	right: Vec3;
	up: Vec3;
	tanHalfFov: number;
	aspect: number;
}
/** Exactly one occlusion segment per geometrically eligible subject. Exclude that subject's own mesh. */
export type OcclusionTest = (origin: Vec3, target: Vec3, distance: number) => boolean;
export class PhotoCamera {
	phase: 'idle' | 'framing' | 'saved' = 'idle';
	readonly valid: Uint8Array;
	readonly screenX: Float64Array;
	readonly screenY: Float64Array;
	/** Reused capture buffer, read only [0,savedCount). Persist species through the game's guide API. */
	readonly saved: (PhotoSubject | undefined)[];
	savedCount = 0;
	validCount = 0;
	revision = 0;
	constructor(readonly subjects: readonly PhotoSubject[]) {
		this.valid = new Uint8Array(subjects.length);
		this.screenX = new Float64Array(subjects.length);
		this.screenY = new Float64Array(subjects.length);
		this.saved = new Array(subjects.length);
	}
	evaluate(frame: PhotoFrame, occluded: OcclusionTest) {
		this.validCount = 0;
		for (let i = 0; i < this.subjects.length; i++) {
			this.valid[i] = 0;
			const s = this.subjects[i];
			if (s.enabled === false) continue;
			const x = s.position.x - frame.origin.x,
				y = s.position.y - frame.origin.y,
				z = s.position.z - frame.origin.z;
			const d = Math.hypot(x, y, z),
				depth = x * frame.forward.x + y * frame.forward.y + z * frame.forward.z;
			if (!(d <= 25 && depth > 0 && frame.tanHalfFov > 0 && frame.aspect > 0)) continue;
			const nx =
				(x * frame.right.x + y * frame.right.y + z * frame.right.z) /
				(depth * frame.tanHalfFov * frame.aspect);
			const ny = (x * frame.up.x + y * frame.up.y + z * frame.up.z) / (depth * frame.tanHalfFov);
			this.screenX[i] = nx;
			this.screenY[i] = ny;
			// NDC runs from -1 to 1: central 40% is [-0.4,0.4] on each axis.
			if (Math.abs(nx) > 0.4 || Math.abs(ny) > 0.4 || occluded(frame.origin, s.position, d)) continue;
			this.valid[i] = 1;
			this.validCount++;
		}
	}
	action() {
		if (this.phase !== 'framing') {
			if (this.validCount > 0) this.phase = 'framing';
			return this.phase;
		}
		if (!this.validCount) return this.phase;
		this.savedCount = 0;
		for (let i = 0; i < this.subjects.length; i++)
			if (this.valid[i]) this.saved[this.savedCount++] = this.subjects[i];
		this.revision++;
		this.phase = 'saved';
		return this.phase;
	}
	cancel() {
		this.phase = 'idle';
	}
}
