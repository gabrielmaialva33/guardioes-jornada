/** The park stays finite in F1. Portal gaps are physical openings; ParkRuntime owns their gates. */
import { BoxGeometry } from 'three';
import { CollisionWorld } from '../../engine/world.ts';
import type { StoryLevel } from '../../level/types.ts';
import { PARK_ZONES, ZONE_IDS, zoneOfChunk } from '../../level/zones/spec.ts';

export function createParkBoundary(level?: StoryLevel, unbounded = false) {
	const parts: BoxGeometry[] = [];
	const rail = (x0: number, z0: number, x1: number, z1: number) => {
		if (Math.abs(x1 - x0) + Math.abs(z1 - z0) < 0.01) return;
		parts.push(
			new BoxGeometry(Math.max(0.3, Math.abs(x1 - x0)), 100, Math.max(0.3, Math.abs(z1 - z0))).translate(
				(x0 + x1) / 2,
				30,
				(z0 + z1) / 2
			)
		);
	};
	if (!unbounded)
		for (const id of ZONE_IDS) {
			const spec = PARK_ZONES[id];
			for (let cz = spec.cz0; cz <= spec.cz1; cz++) {
				if (!zoneOfChunk(spec.cx0 - 1, cz)) rail(spec.x0, cz * 40, spec.x0, (cz + 1) * 40);
				if (!zoneOfChunk(spec.cx1 + 1, cz)) rail(spec.x1, cz * 40, spec.x1, (cz + 1) * 40);
			}
			for (let cx = spec.cx0; cx <= spec.cx1; cx++) {
				if (!zoneOfChunk(cx, spec.cz0 - 1)) rail(cx * 40, spec.z0, (cx + 1) * 40, spec.z0);
				if (!zoneOfChunk(cx, spec.cz1 + 1)) rail(cx * 40, spec.z1, (cx + 1) * 40, spec.z1);
			}
		}
	if (level) {
		const portals = level.portals ?? [level.portal];
		for (const side of ['east', 'north', 'south'] as const) {
			const gaps = portals
				.filter((p) => p.side === side)
				.map((p) => p.gap)
				.sort((a, b) => a.from - b.from);
			let start = 0;
			for (const gap of gaps) {
				if (side === 'east') rail(160, start, 160, gap.from);
				else rail(start, side === 'north' ? 0 : 160, gap.from, side === 'north' ? 0 : 160);
				start = gap.to;
			}
			if (side === 'east') rail(160, start, 160, 160);
			else rail(start, side === 'north' ? 0 : 160, 160, side === 'north' ? 0 : 160);
		}
	}
	try {
		return new CollisionWorld(parts.map((geometry) => ({ geometry })));
	} finally {
		for (const p of parts) p.dispose();
	}
}
