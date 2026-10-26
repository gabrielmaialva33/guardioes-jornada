/**
 * Waterfalls of streamed zones (P37), from the level's data: every landmark
 * of kind 'waterfall' (the Reserva's small fall, the Vale's Cachoeira Grande)
 * gives the lip (x, y, z) and the drop (`height`); the zone's river gives the
 * way the water runs from there (the polyline runs from the serra to the sea),
 * which faces the model and puts the spray SPRAY_OUT u downstream at the foot.
 * Nothing is hardcoded per fall.
 *
 * The falling-water model goes through the placement pools like any other
 * (family 'scenery', kind 'waterfall'); the spray is waterfall-foam.ts's own
 * batch, placed by spray.ts createWaterfallSpray. Pure and three-free: the
 * streaming Worker computes these with the zone cut.
 */
import type { ZoneId } from '../../level/zones/spec.ts';
import type { ZoneBuild } from '../../level/zones/zone.ts';
import type { Placements } from '../../survival/types.ts';
import { chunkOf } from './types.ts';

/** The spray sits this far downstream of the lip, at the foot (waterfall-foam.ts's 3 u). */
export const SPRAY_OUT = 3;
/**
 * The drop the kit's `ground-waterfall` model spans at scale 1: asset-plan.ts
 * sizes it 1.35 for the Reserva's 5.567 u drop.
 */
export const WATERFALL_MODEL_DROP = 5.567256302954132 / 1.35;

export interface StreamWaterfall {
	id: string;
	zone: ZoneId;
	/** The lip, world coordinates (the landmark). */
	x: number;
	y: number;
	z: number;
	/** The drop (the landmark's height); the foot is at y − height. */
	height: number;
	foot: number;
	/** Unit direction the water runs from the lip (the river downstream, else the landmark's heading). */
	flowX: number;
	flowZ: number;
	/** Engine yaw facing downstream (0 faces +z): the model's turn. */
	yaw: number;
	/** Where the spray rises: SPRAY_OUT u downstream, at the foot. */
	sprayX: number;
	sprayZ: number;
}

/** The point at arc length `s` along a polyline, from its nearest point to (x, z) onwards. */
function downstream(
	points: readonly { x: number; z: number }[],
	x: number,
	z: number,
	s: number
): [number, number] | null {
	if (points.length < 2) return null;
	let best = Number.POSITIVE_INFINITY;
	let seg = 0;
	let at = 0;
	for (let i = 1; i < points.length; i++) {
		const a = points[i - 1];
		const b = points[i];
		const dx = b.x - a.x;
		const dz = b.z - a.z;
		const len2 = dx * dx + dz * dz || 1;
		const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / len2));
		const px = a.x + dx * t - x;
		const pz = a.z + dz * t - z;
		const d = px * px + pz * pz;
		if (d < best) {
			best = d;
			seg = i;
			at = t;
		}
	}
	const a = points[seg - 1];
	let px = a.x + (points[seg].x - a.x) * at;
	let pz = a.z + (points[seg].z - a.z) * at;
	let left = s;
	for (let i = seg; i < points.length; i++) {
		const b = points[i];
		const len = Math.hypot(b.x - px, b.z - pz);
		if (len >= left && len > 0) return [px + ((b.x - px) * left) / len, pz + ((b.z - pz) * left) / len];
		left -= len;
		px = b.x;
		pz = b.z;
	}
	return [px, pz];
}

/** A zone's waterfalls, world coordinates. */
export function waterfallsOf(build: ZoneBuild): StreamWaterfall[] {
	const out: StreamWaterfall[] = [];
	for (const l of build.level.landmarks) {
		if (l.kind !== 'waterfall') continue;
		let fx = l.yawS;
		let fz = l.yawC;
		const end = downstream(build.world.river.points, l.x, l.z, SPRAY_OUT);
		if (end) {
			const start = downstream(build.world.river.points, l.x, l.z, 0) as [number, number];
			const dx = end[0] - start[0];
			const dz = end[1] - start[1];
			const len = Math.hypot(dx, dz);
			if (len > 1e-6) {
				fx = dx / len;
				fz = dz / len;
			}
		}
		const x = l.x + build.offsetX;
		const z = l.z + build.offsetZ;
		out.push({
			id: l.id,
			zone: build.id,
			x,
			y: l.y,
			z,
			height: l.height,
			foot: l.y - l.height,
			flowX: fx,
			flowZ: fz,
			yaw: Math.atan2(fx, fz),
			sprayX: x + fx * SPRAY_OUT,
			sprayZ: z + fz * SPRAY_OUT
		});
	}
	return out;
}

/** The falls whose lip lies in chunk (cx, cz). */
export function waterfallsIn(falls: readonly StreamWaterfall[], cx: number, cz: number): StreamWaterfall[] {
	return falls.filter((f) => chunkOf(f.x) === cx && chunkOf(f.z) === cz);
}

/**
 * The falls as scenery placements (kind 'waterfall'): at the foot, facing
 * downstream, scaled so the model spans the drop.
 */
export function waterfallPlacements(falls: readonly StreamWaterfall[]): Placements<'waterfall'> {
	const n = falls.length;
	const p: Placements<'waterfall'> = {
		kinds: ['waterfall'],
		count: n,
		kind: new Uint8Array(n),
		block: new Uint8Array(n),
		x: new Float32Array(n),
		y: new Float32Array(n),
		z: new Float32Array(n),
		scale: new Float32Array(n),
		yawC: new Float32Array(n),
		yawS: new Float32Array(n)
	};
	falls.forEach((f, k) => {
		p.x[k] = f.x;
		p.y[k] = f.foot;
		p.z[k] = f.z;
		p.scale[k] = f.height / WATERFALL_MODEL_DROP;
		p.yawC[k] = Math.cos(f.yaw);
		p.yawS[k] = Math.sin(f.yaw);
	});
	return p;
}
