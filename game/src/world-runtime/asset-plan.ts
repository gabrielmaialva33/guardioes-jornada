/** Render-only choices; the authored world arrays and collision remain untouched. */
import type { StoryLevel } from '../level/types.ts';
import { FLAG, type Placements, type SurvivalWorld, ZONE } from '../survival/types.ts';
import { terrainHeight } from './paths.ts';
import { segmentDistance, shoreAt } from './terrain.ts';
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
	const mappedCover = remapPlacements(world.decorations, (kind, i) => {
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
	const coverItems: SceneryPlacement[] = Array.from({ length: mappedCover.count }, (_, i) => ({
		kind: mappedCover.kinds[mappedCover.kind[i]],
		x: mappedCover.x[i],
		y: mappedCover.y[i],
		z: mappedCover.z[i],
		scale: mappedCover.scale[i],
		yaw: Math.atan2(mappedCover.yawS[i], mappedCover.yawC[i])
	}));
	// Sparse edge tufts reuse the existing native cover pools; never cover the navigable ribbon.
	for (const trail of level?.trails ?? [])
		for (let j = 1; j < trail.points.length; j++) {
			const a = trail.points[j - 1],
				b = trail.points[j],
				dx = b[0] - a[0],
				dz = b[1] - a[1],
				length = Math.hypot(dx, dz);
			for (let t = 3; t < length; t += 7)
				for (const side of [-1, 1]) {
					const distance = trail.halfWidth + 0.65 + 0.2 * Math.sin(t * 1.3),
						x = a[0] + (dx * t) / length - (dz / length) * distance * side,
						z = a[1] + (dz * t) / length + (dx / length) * distance * side;
					if (x < 1 || z < 1 || x >= world.size - 1 || z >= world.size - 1) continue;
					const cell = Math.round(z) * world.grid + Math.round(x);
					if (
						world.flags[cell] & (FLAG.base | FLAG.river) ||
						shoreAt(world, x, z, level?.pool)[1] < 1.5 ||
						level?.obbies.some((o) => o.pieces.some((p) => Math.hypot(p.x - x, p.z - z) < p.radius + 3))
					)
						continue;
					coverItems.push({
						kind: world.flags[cell] & FLAG.forest ? 'understorey-fern-a' : 'understorey-flowers-ground-a',
						x,
						y: terrainHeight(world, x, z),
						z,
						scale: 0.65 + 0.2 * Math.sin(x + z) ** 2,
						yaw: x + z
					});
				}
		}
	const cover = sceneryArrays(coverItems);
	const mappedRocks = remapPlacements(world.rocks, (kind, i) => {
		if (kind === 'log') return 'log';
		const wet = shoreAt(world, world.rocks.x[i], world.rocks.z[i], level?.pool)[1] < 3;
		if (wet) return ['ground-shore-rocks-a', 'ground-shore-rocks-b', 'ground-shore-rocks-c'][i % 3];
		return kind === 'stone'
			? ['rock-polyone-01', 'rock-polyone-02', 'rock-polyone-06'][i % 3]
			: ['rock-polyone-03', 'rock-polyone-04', 'rock-polyone-11'][i % 3];
	});
	const scales = mappedRocks.scale.slice();
	for (let i = 0; i < world.rocks.count; i++)
		if (world.rocks.kinds[world.rocks.kind[i]] === 'stone')
			scales[i] *= 0.25 / (mappedRocks.kinds[mappedRocks.kind[i]].startsWith('ground-shore') ? 1.1 : 0.3);
	const rocks = { ...mappedRocks, scale: scales };
	const scenery: SceneryPlacement[] = [];
	const safe = (x: number, z: number, radius: number) =>
		!level?.obbies.some((o) => o.pieces.some((p) => Math.hypot(p.x - x, p.z - z) < radius + p.radius + 1.5));
	// The raised plateau has an authored edge; locate it from heights instead of burying rocks behind it.
	for (let z = 48; z <= 92; z += 6) {
		let edge = 118;
		while (edge < 142 && terrainHeight(world, edge, z) < 14.5) edge++;
		if (edge === 142) continue;
		const x = edge - 0.25,
			top = terrainHeight(world, edge, z);
		if (safe(x, z, 3))
			scenery.push({
				kind: z % 12 ? 'rock-cliff-a' : 'rock-cliff-b',
				x,
				y: top - 4.5,
				z,
				scale: 1.12,
				yaw: -Math.PI / 2 + 0.12 * Math.sin(z)
			});
		if (z % 12 === 0 && safe(edge + 1, z, 6))
			scenery.push({ kind: 'rock-deadzik-1', x: edge + 1, y: top - 7.2, z, scale: 0.9, yaw: -Math.PI / 2 });
	}
	// Existing pooled materials cover the rim and approach: no additional texture or per-prop mesh.
	for (const [x, z] of [
		[130, 60],
		[134, 66],
		[137, 75],
		[136, 90],
		[132, 89]
	]) {
		if (!safe(x, z, 3)) continue;
		// Buried grass-topped cliff caps read as flat boards here; keep only the upright bromelias.
		scenery.push({
			kind: 'bromelia',
			x: x + 0.8,
			y: terrainHeight(world, x + 0.8, z),
			z,
			scale: 0.75,
			yaw: z
		});
	}
	// A few native red epiphytes sit against stout trunks at the child's eye line, off the trail.
	const epiphytes = Array.from({ length: world.trees.count }, (_, i) => i)
		.filter((i) => {
			const kind = world.trees.kinds[world.trees.kind[i]];
			if (!['jequitiba', 'ipe-amarelo', 'ipe-rosa', 'pau-brasil', 'embauba'].includes(kind)) return false;
			const x = world.trees.x[i],
				z = world.trees.z[i];
			if (z > world.base.spawn.z + 4) return false;
			return level?.trails.some((t) =>
				t.points.some(
					(b, j) =>
						j > 0 &&
						segmentDistance(x, z, t.points[j - 1][0], t.points[j - 1][1], b[0], b[1]) < t.halfWidth + 5
				)
			);
		})
		.sort(
			(a, b) =>
				(world.trees.x[a] - world.base.spawn.x) ** 2 +
				(world.trees.z[a] - world.base.spawn.z) ** 2 -
				(world.trees.x[b] - world.base.spawn.x) ** 2 -
				(world.trees.z[b] - world.base.spawn.z) ** 2
		)
		.slice(0, 6);
	for (const i of epiphytes) {
		const kind = world.trees.kinds[world.trees.kind[i]],
			trunk =
				(kind === 'jequitiba' ? 0.65 : kind === 'embauba' ? 0.4 : kind === 'pau-brasil' ? 0.28 : 0.25) *
					world.trees.scale[i] +
				0.15;
		const yaw = Math.atan2(world.base.spawn.x - world.trees.x[i], world.base.spawn.z - world.trees.z[i]);
		scenery.push({
			kind: 'bromelia-red',
			x: world.trees.x[i] + Math.sin(yaw) * trunk,
			y: world.trees.y[i] + 1.6,
			z: world.trees.z[i] + Math.cos(yaw) * trunk,
			scale: 0.65,
			yaw
		});
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
