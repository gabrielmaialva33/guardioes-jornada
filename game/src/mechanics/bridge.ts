import { clamp, type Vec3, validPoint } from './common.ts';
export interface BridgeSpec {
	id: string;
	start: Vec3;
	end: Vec3;
	width: number;
	planks: number;
}
export class SuspensionBridge {
	readonly offsets: Float64Array;
	readonly velocities: Float64Array;
	readonly length: number;
	readonly dx: number;
	readonly dz: number;
	phase: 'still' | 'swaying' = 'still';
	constructor(readonly spec: BridgeSpec) {
		this.length = Math.hypot(spec.end.x - spec.start.x, spec.end.z - spec.start.z);
		this.dx = (spec.end.x - spec.start.x) / this.length;
		this.dz = (spec.end.z - spec.start.z) / this.length;
		if (
			!validPoint(spec.start) ||
			!validPoint(spec.end) ||
			this.length < 1 ||
			!Number.isInteger(spec.planks) ||
			spec.planks < 2 ||
			spec.planks > 256 ||
			!Number.isFinite(spec.width) ||
			spec.width < 1
		)
			throw new Error('Invalid bridge');
		this.offsets = new Float64Array(spec.planks);
		this.velocities = new Float64Array(spec.planks);
	}
	baseHeight(t: number) {
		return this.spec.start.y + (this.spec.end.y - this.spec.start.y) * t - 0.5 * Math.sin(Math.PI * t);
	}
	heightAt(x: number, z: number) {
		const a = x - this.spec.start.x,
			b = z - this.spec.start.z,
			s = a * this.dx + b * this.dz,
			side = a * this.dz - b * this.dx;
		if (s < 0 || s > this.length || Math.abs(side) > this.spec.width / 2) return null;
		const i = Math.min(this.spec.planks - 1, Math.floor((s / this.length) * this.spec.planks));
		return this.baseHeight((i + 0.5) / this.spec.planks) + this.offsets[i];
	}
	step(dt: number, feet: Vec3, speed: number, reducedMotion: boolean) {
		this.phase = 'still';
		const height = this.heightAt(feet.x, feet.z),
			on = height !== null && Math.abs(feet.y - height) < 0.7;
		const along = (feet.x - this.spec.start.x) * this.dx + (feet.z - this.spec.start.z) * this.dz;
		for (let i = 0; i < this.offsets.length; i++) {
			if (reducedMotion) {
				this.offsets[i] = this.velocities[i] = 0;
				continue;
			}
			const gap = Math.abs(((i + 0.5) / this.offsets.length) * this.length - along);
			const load = on ? -Math.max(0, 1 - gap / 2) * (4 + Math.min(10, Math.abs(speed)) * 0.6) : 0;
			this.velocities[i] += (load - 65 * this.offsets[i] - 9 * this.velocities[i]) * dt;
			this.offsets[i] = clamp(this.offsets[i] + this.velocities[i] * dt, -0.25, 0.25);
			if (Math.abs(this.offsets[i]) >= 0.25) this.velocities[i] = 0;
			if (Math.abs(this.offsets[i]) > 0.0001) this.phase = 'swaying';
		}
	}
}
