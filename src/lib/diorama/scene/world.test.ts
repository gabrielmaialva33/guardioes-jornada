import { Color, type Mesh } from 'three';
import { expect, it, vi } from 'vitest';
import { type Palette, TONES } from './palette.ts';
import { World } from './world.ts';

it.each(['lite', 'full'] as const)(
	'cooperatively builds the same %s geometry and motion state',
	async (quality) => {
		const pause = vi.fn(async () => {});
		const palette: Palette = { colors: TONES.map(() => new Color('#65b887')), dark: true };
		const synchronous = new World(quality, palette),
			asynchronous = await World.create(quality, palette, pause);
		expect(pause.mock.calls.length).toBeGreaterThan(5);
		expect(asynchronous.triangles).toBe(synchronous.triangles);
		const geometries = (world: World) =>
			world.scene.children.flatMap((child) => {
				const mesh = child as Mesh;
				return mesh.geometry
					? [
							Array.from(mesh.geometry.getAttribute('position').array),
							Array.from(mesh.geometry.getAttribute('color')?.array ?? [])
						]
					: [];
			});
		expect(geometries(asynchronous)).toEqual(geometries(synchronous));
		synchronous.snap(5, true);
		asynchronous.snap(5, true);
		expect(asynchronous.stage).toBe(5);
		expect(asynchronous.oath).toBe(true);
		synchronous.dispose();
		asynchronous.dispose();
	}
);
