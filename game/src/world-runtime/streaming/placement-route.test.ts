import { Box3, BoxGeometry, MeshLambertMaterial, Vector3 } from 'three';
import { expect, it } from 'vitest';
import { buildZone } from '../../level/zones/park.ts';
import { InstancePool, PoolSet } from '../../render/index.ts';
import { createPlacementRoute, type PlacementModel, placementKind } from './placement-route.ts';
import { ChunkPlacements, ToroidalBlockGrid } from './slots.ts';
import { cutZone } from './zone-cut.ts';

it('routes tree near/far bands exclusively and releases ids and canopy volumes with the chunk', () => {
	const grid = new ToroidalBlockGrid(7),
		material = new MeshLambertMaterial();
	const pool = (name: string) =>
		new InstancePool([{ geometry: new BoxGeometry(), material }], {
			name,
			grid,
			capacity: 1000,
			fades: true
		});
	const near = pool('tree:jucara'),
		far = pool('tree:jucara:lod1');
	const pools = new PoolSet([near, far], [material]);
	const models: PlacementModel[] = [
		{
			family: 'tree',
			kind: 'jucara',
			near: near.name,
			far: far.name,
			bounds: new Box3(new Vector3(-1, 0, -1), new Vector3(1, 8, 1)),
			scale: 1,
			count: 1,
			trunkRadius: 0.2,
			canopyBase: 4
		}
	];
	const bank = createPlacementRoute(pools, models, 'low');
	const zone = buildZone('reserva'),
		chunk = cutZone(zone, new Map([['reserva', zone]])).chunks.find((c) => c.trees.count > 0);
	if (!chunk) throw new Error('fixture');
	const sink = new ChunkPlacements(grid, bank.route);
	sink.add(chunk);
	expect(near.size).toBeGreaterThan(0);
	expect(far.size).toBe(near.size);
	expect(near.distanceBand?.max).toBe(far.distanceBand?.min);
	expect(bank.canopies.volumes).toHaveLength(near.size);
	sink.removeChunk(chunk);
	expect(near.size).toBe(0);
	expect(far.size).toBe(0);
	expect(bank.canopies.volumes).toHaveLength(0);
	bank.dispose();
	pools.dispose();
});

it('maps decoration and rock families deterministically without touching the source arrays', () => {
	const zone = buildZone('reserva'),
		chunk = cutZone(zone, new Map([['reserva', zone]])).chunks[0];
	const kinds = chunk.decorations.kind.slice();
	expect(placementKind('tree', 'jequitiba', chunk, 0)).toBe('jequitiba');
	expect(placementKind('rock', 'log', chunk, 0)).toBe('log');
	if (chunk.decorations.count) {
		const a = placementKind('decoration', 'bromelia', chunk, 0);
		expect(['bromelia', 'bromelia-red']).toContain(a);
		expect(placementKind('decoration', 'bromelia', chunk, 0)).toBe(a);
	}
	expect(chunk.decorations.kind).toEqual(kinds);
});
