/** Render-only choices; the authored world arrays and collision remain untouched. */
import type { StoryLevel } from '../level/types.ts';
import { FLAG, type Placements, type SurvivalWorld, ZONE } from '../survival/types.ts';
import { terrainHeight } from './paths.ts';
import { shoreAt } from './terrain.ts';
export function remapPlacements(
	source: Placements<string>,
	choose: (kind: string, index: number) => string
): Placements<string> {
	const kinds: string[] = [],
		kind = new Uint8Array(source.count);
	for (let i = 0; i < source.count; i++) {
		const name = choose(source.kinds[source.kind[i]], i);
		let k = kinds.indexOf(name);
		if (k < 0) {
			k = kinds.length;
			kinds.push(name);
		}
		kind[i] = k;
	}
	return { ...source, kinds, kind };
}
export interface SceneryPlacement {
	kind: string;
	x: number;
	y: number;
	z: number;
	scale: number;
	yaw: number;
}
function sceneryArrays(items: SceneryPlacement[]): Placements<string> {
	items.sort(
		(a, b) =>
			Math.floor(a.z / 40) * 4 + Math.floor(a.x / 40) - (Math.floor(b.z / 40) * 4 + Math.floor(b.x / 40))
	);
	const kinds = [...new Set(items.map((i) => i.kind))];
	return {
		count: items.length,
		kinds,
		kind: Uint8Array.from(items.map((i) => kinds.indexOf(i.kind))),
		block: Uint8Array.from(
			items.map((i) => Math.max(0, Math.min(15, Math.floor(i.z / 40) * 4 + Math.floor(i.x / 40))))
		),
		x: Float32Array.from(items.map((i) => i.x)),
		y: Float32Array.from(items.map((i) => i.y)),
		z: Float32Array.from(items.map((i) => i.z)),
		scale: Float32Array.from(items.map((i) => i.scale)),
		yawC: Float32Array.from(items.map((i) => Math.cos(i.yaw))),
		yawS: Float32Array.from(items.map((i) => Math.sin(i.yaw)))
	};
}
export function renderAssetPlan(world: SurvivalWorld, level?: StoryLevel) {
	const cover = remapPlacements(world.decorations, (kind, i) => {
		if (kind === 'bromelia') return i % 3 ? 'bromelia' : 'bromelia-red';
		const x = world.decorations.x[i],
			z = world.decorations.z[i],
			f = world.flags[Math.round(z) * world.grid + Math.round(x)],
			wet = shoreAt(world, x, z, level?.pool)[1] < 4;
		if (kind === 'flower') return i % 2 ? 'understorey-flowers-ground-a' : 'understorey-flowers-tall-a';
		if (kind === 'beach-grass') return 'ground-sand-foliage';
		if (wet) return i % 2 ? 'understorey-taioba' : 'understorey-heliconia';
		if (kind === 'bush') return i % 3 ? 'understorey-bush' : 'understorey-palm-a';
		if (kind === 'fern' || f & FLAG.forest)
			return ['understorey-fern-a', 'understorey-fern-b', 'understorey-monstera-a', 'understorey-monstera-b'][
				i % 4
			];
		return i % 3 ? 'understorey-flowers-ground-b' : 'understorey-flowers-tall-b';
	});
	const rocks = remapPlacements(world.rocks, (kind, i) => {
		if (kind === 'log') return 'log';
		const wet = shoreAt(world, world.rocks.x[i], world.rocks.z[i], level?.pool)[1] < 3;
		if (wet) return ['ground-shore-rocks-a', 'ground-shore-rocks-b', 'ground-shore-rocks-c'][i % 3];
		return kind === 'stone'
			? ['rock-polyone-01', 'rock-polyone-02', 'rock-polyone-06'][i % 3]
			: ['rock-polyone-03', 'rock-polyone-04', 'rock-polyone-11'][i % 3];
	});
	const scenery: SceneryPlacement[] = [];
	const safe = (x: number, z: number, radius: number) =>
		!level?.obbies.some((o) => o.pieces.some((p) => Math.hypot(p.x - x, p.z - z) < radius + p.radius + 1.5));
	// Insets keep decorative formations behind the collision-matched cliff, away from the obby supports.
	for (let z = 48; z <= 116; z += 12) {
		const x = 129,
			front = terrainHeight(world, x - 4, z),
			top = terrainHeight(world, x, z);
		if (top - front < 3 || !safe(x, z, 3)) continue;
		scenery.push({
			kind: z % 24 ? 'rock-cliff-a' : 'rock-cliff-b',
			x,
			y: front - 0.5,
			z,
			scale: 1.15,
			yaw: -Math.PI / 2
		});
		if (z % 24 === 0)
			scenery.push({ kind: 'rock-deadzik-1', x: x + 2, y: front - 3, z, scale: 0.6, yaw: -Math.PI / 2 });
	}
	for (let z = 8; z < world.size; z += 20)
		for (let x = 4; x < world.size; x += 20) {
			const q = Math.round(z) * world.grid + Math.round(x);
			if (world.zones[q] !== ZONE.beach) continue;
			scenery.push({ kind: 'ground-sand-patch', x, y: world.heights[q] - 0.05, z, scale: 0.7, yaw: x + z });
		}
	if (level?.landmarks.some((p) => p.kind === 'waterfall'))
		scenery.push({ kind: 'ground-waterfall', x: 132, y: 3, z: 30, scale: 1.35, yaw: -Math.PI / 2 });
	return { trees: world.trees, rocks, cover, scenery: sceneryArrays(scenery) };
}
export function geometryRanges(q: 'low' | 'medium' | 'high', family: string) {
	if (family === 'tree')
		return q === 'low'
			? { near: 26, far: 56 }
			: q === 'medium'
				? { near: 34, far: 72 }
				: { near: 42, far: 88 };
	if (family === 'cover')
		return q === 'low'
			? { near: 12, far: 32 }
			: q === 'medium'
				? { near: 18, far: 42 }
				: { near: 24, far: 56 };
	return q === 'low'
		? { near: 28, far: 72 }
		: q === 'medium'
			? { near: 38, far: 100 }
			: { near: 50, far: 140 };
}
