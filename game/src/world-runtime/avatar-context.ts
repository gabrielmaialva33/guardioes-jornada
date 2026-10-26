import type { Vector3 } from 'three';
import type { AvatarInput } from '../animation/avatar-animator.ts';
import type { CollisionWorld } from '../engine/world.ts';
import type { StoryLevel } from '../level/types.ts';
import type { SurvivalWorld } from '../survival/types.ts';
import { DownProbe } from './down-probe.ts';
import { riverSurfaceAt } from './navigation.ts';

interface Footing {
	x: number;
	y: number;
	z: number;
	hx: number;
	hz: number;
	c: number;
	s: number;
	rise: number;
	circle: boolean;
}
interface GroundCharacter {
	position: Readonly<Vector3>;
	previousPosition: Readonly<Vector3>;
	groundNormal: Readonly<Vector3>;
	grounded: boolean;
}
/** One reusable BVH query; no raycastFirst hit objects or per-frame temporary vectors. */
export class AvatarGroundContext {
	readonly #probe: DownProbe;
	readonly #footings: Footing[] = [];
	constructor(
		readonly collision: CollisionWorld,
		readonly world: SurvivalWorld,
		readonly level?: StoryLevel
	) {
		this.#probe = new DownProbe(collision);
		for (const c of world.crossings) {
			const dx = c.to.x - c.from.x,
				dz = c.to.z - c.from.z,
				length = Math.hypot(dx, dz) || 1;
			if (c.kind !== 'stepping-stones')
				this.#footings.push({
					x: (c.from.x + c.to.x) / 2,
					y: (c.from.y + c.to.y) / 2,
					z: (c.from.z + c.to.z) / 2,
					hx: c.halfWidth,
					hz: length / 2,
					c: dz / length,
					s: dx / length,
					rise: (c.to.y - c.from.y) / length,
					circle: false
				});
			for (const p of c.stones)
				this.#footings.push({ x: p.x, y: p.y, z: p.z, hx: p.r, hz: p.r, c: 1, s: 0, rise: 0, circle: true });
		}
		for (const o of level?.obbies ?? [])
			for (const p of o.pieces) {
				if (p.piece !== 'stone' && p.variant !== 'log') continue;
				this.#footings.push({
					x: p.x,
					y: p.y,
					z: p.z,
					hx: p.radius,
					hz: p.radius,
					c: p.yawC,
					s: p.yawS,
					rise: 0,
					circle: p.piece === 'stone'
				});
			}
		const rocks = world.rocks;
		for (let i = 0; i < rocks.count; i++)
			if (rocks.kinds[rocks.kind[i]] === 'log') {
				const k = rocks.scale[i];
				this.#footings.push({
					x: rocks.x[i],
					y: rocks.y[i] + 0.6 * k,
					z: rocks.z[i],
					hx: 1.2 * k,
					hz: 0.3 * k,
					c: rocks.yawC[i],
					s: rocks.yawS[i],
					rise: 0,
					circle: false
				});
			}
	}
	update(input: AvatarInput, character: GroundCharacter) {
		input.surface = 'ground';
		input.slope = 0;
		input.edgeAhead = Infinity;
		if (!character.grounded) return;
		const p = character.position,
			n = character.groundNormal;
		const sin = Math.sin(input.yaw),
			cos = Math.cos(input.yaw);
		input.slope = Math.atan2(-(n.x * sin + n.z * cos), n.y);
		const water = riverSurfaceAt(this.world, p.x, p.z, this.level?.pool);
		if (water !== null && water - p.y > 0.01 && water - p.y <= 0.65) input.surface = 'water';
		else
			for (const f of this.#footings) {
				const dx = p.x - f.x,
					dz = p.z - f.z,
					x = dx * f.c - dz * f.s,
					z = dx * f.s + dz * f.c;
				if (Math.abs(p.y - f.y - z * f.rise) > 0.25) continue;
				if (f.circle ? dx * dx + dz * dz <= f.hx * f.hx : Math.abs(x) <= f.hx && Math.abs(z) <= f.hz) {
					input.surface = 'narrow';
					break;
				}
			}
		let dx = p.x - character.previousPosition.x,
			dz = p.z - character.previousPosition.z;
		const length = Math.hypot(dx, dz);
		if (length > 0.001 && input.speed > 0.05) {
			dx /= length;
			dz /= length;
		} else {
			dx = sin;
			dz = cos;
		}
		const x = p.x + dx * 0.4,
			z = p.z + dz * 0.4;
		this.#probe.x=x; this.#probe.y=p.y+.3; this.#probe.z=z; this.#probe.depth=1.31; this.#probe.sample();
		if (p.y - this.#probe.height > 1) input.edgeAhead = 0.39;
	}
}
