import { Color } from 'three';
import { expect, it } from 'vitest';
import { generateWorld } from '../survival/generate.ts';
import { FLAG } from '../survival/types.ts';
import { boundaryTerrain } from './boundary.ts';
import { terrainChunk } from './terrain.ts';

const world = generateWorld(20261025);
it('shoreline colours are shared and blended across adjacent chunk edges, not painted as whole square cells', () => {
	const flags = world.flags.slice(),
		zones = world.zones.slice();
	for (let z = 0; z < world.grid; z++)
		for (let x = 0; x < world.grid; x++) {
			flags[z * world.grid + x] = x < 80 ? FLAG.forest : FLAG.river;
			zones[z * world.grid + x] = 4;
		}
	const map = { ...world, flags, zones };
	const left = terrainChunk(map, { x0: 40, z0: 0 }),
		right = terrainChunk(map, { x0: 80, z0: 0 });
	const sample = (g: typeof left) => {
		const p = g.getAttribute('position'),
			c = g.getAttribute('color');
		const values = [];
		for (let i = 0; i < p.count; i++)
			if (p.getX(i) === 80 && p.getZ(i) === 10) values.push([c.getX(i), c.getY(i), c.getZ(i)]);
		return values;
	};
	const l = sample(left),
		r = sample(right);
	expect(l.length).toBeGreaterThan(0);
	expect(r.length).toBeGreaterThan(0);
	for (const value of [...l, ...r]) expect(value).toEqual(l[0]);
	const dry = new Color('#3f7d4f'),
		wet = new Color('#6b4f3a');
	expect(l[0]).not.toEqual([dry.r, dry.g, dry.b]);
	expect(l[0]).not.toEqual([wet.r, wet.g, wet.b]);
	left.dispose();
	right.dispose();
});
it('the exterior terrain continues every exact border sample into a rising skirt past the far plane', () => {
	const chunks = boundaryTerrain(world);
	expect(chunks).toHaveLength(16);
	let minX = Infinity,
		maxX = -Infinity,
		inner = 0,
		outer = 0;
	for (const g of chunks) {
		const p = g.getAttribute('position'),
			n = g.getAttribute('normal');
		for (let i = 0; i < p.count; i++) {
			const x = p.getX(i),
				z = p.getZ(i);
			minX = Math.min(minX, x);
			maxX = Math.max(maxX, x);
			expect(n.getY(i)).toBeGreaterThan(0);
			if (x >= 0 && z >= 0 && x <= world.size && z <= world.size) {
				inner++;
				expect(p.getY(i)).toBe(world.heights[Math.round(z) * world.grid + Math.round(x)]);
			} else if (x === -160 || x === world.size + 160 || z === -160 || z === world.size + 160) {
				outer++;
				const bx = (x + 160) / 3,
					bz = (z + 160) / 3;
				expect(p.getY(i)).toBeGreaterThan(world.heights[Math.round(bz) * world.grid + Math.round(bx)] + 17);
			}
		}
		g.dispose();
	}
	expect(inner).toBeGreaterThan(600);
	expect(outer).toBeGreaterThan(600);
	expect(minX).toBe(-160);
	expect(maxX).toBe(world.size + 160);
});
it('the invisible boundary stops the capsule while the visible terrain continues beyond it', async () => {
	const { buildMapCollision } = await import('./collision.ts');
	const { Character } = await import('../engine/character.ts');
	const map = {
		...world,
		heights: new Float32Array(world.heights.length).fill(1),
		blocks: world.blocks.map((b) => ({
			...b,
			heights: new Float32Array(b.heights.length).fill(1),
			cylinders: new Float32Array(),
			boxes: new Float32Array(),
			decks: new Float32Array()
		}))
	};
	const collision = buildMapCollision(map),
		character = new Character(collision, { x: 2, y: 1, z: 80 });
	for (let i = 0; i < 90; i++)
		character.step(1 / 60, { moveX: -1, moveZ: 0, jumpHeld: false, faceYaw: null });
	expect(character.position.x).toBeGreaterThanOrEqual(0.99);
	expect(character.position.x).toBeLessThan(1.1);
	expect(character.grounded).toBe(true);
	collision.dispose();
});
