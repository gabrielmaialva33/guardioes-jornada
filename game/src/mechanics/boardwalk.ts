import { distance, type Vec3 } from './common.ts';
export interface Lookout {
	id: string;
	position: Vec3;
	camera: Vec3;
	target: Vec3;
}
export interface BoardwalkSpec {
	id: string;
	start: Vec3;
	end: Vec3;
	width: number;
	lookouts: readonly Lookout[];
}
export class Boardwalk {
	phase: 'walking' | 'framing' = 'walking';
	lookout: Lookout | null = null;
	elapsed = 0;
	blend = 0;
	constructor(readonly spec: BoardwalkSpec) {}
	action(feet: Vec3, reducedMotion: boolean) {
		if (this.phase === 'framing') {
			this.cancel();
			return true;
		}
		for (const l of this.spec.lookouts)
			if (distance(feet, l.position) <= 2) {
				this.lookout = l;
				this.phase = 'framing';
				this.elapsed = 0;
				this.blend = reducedMotion ? 1 : 0;
				return true;
			}
		return false;
	}
	step(dt: number, reducedMotion: boolean) {
		if (this.phase !== 'framing') return;
		this.elapsed += dt;
		if (this.elapsed >= 3) {
			this.cancel();
			return;
		}
		this.blend = reducedMotion ? 1 : Math.min(1, this.elapsed / 0.3, (3 - this.elapsed) / 0.3);
	}
	cancel() {
		this.phase = 'walking';
		this.lookout = null;
		this.blend = 0;
	}
}
