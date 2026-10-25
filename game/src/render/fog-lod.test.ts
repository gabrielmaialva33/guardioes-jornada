import { Color, Fog, PerspectiveCamera, Scene } from 'three';
import { describe, expect, it } from 'vitest';
import { LIGHT, VIEW } from '../style/palette.ts';
import { applyFog, fogSettings, keepFraction, lodProfilesFor, lodRank } from './fog-lod.ts';

describe('fog', () => {
	it('takes distances from VIEW and the colour from the horizon', () => {
		for (const quality of ['low', 'medium', 'high'] as const) {
			const fog = fogSettings(quality);
			expect(fog).toEqual({
				color: LIGHT.daylight.horizon,
				near: VIEW[quality].fogNear,
				far: VIEW[quality].far,
				cameraFar: VIEW[quality].far
			});
		}
		expect(fogSettings('low')).toMatchObject({ near: 30, far: 70 });
		const night = fogSettings('low', 'night');
		expect(night.color).toBe(LIGHT.night.horizon);
		expect(night.far).toBeLessThan(70);
		expect(night.near).toBeLessThan(night.far);
	});

	it('applies to the scene and camera, reusing the Fog', () => {
		const scene = new Scene();
		const camera = new PerspectiveCamera(70, 1, 0.1, 500);
		const fog = applyFog(scene, camera, fogSettings('low'));
		expect(scene.fog).toBe(fog);
		expect(camera.far).toBe(70);
		expect((scene.background as Color).equals(new Color(LIGHT.daylight.horizon))).toBe(true);
		const again = applyFog(scene, camera, fogSettings('medium', 'night'));
		expect(again).toBe(fog);
		expect(fog).toBeInstanceOf(Fog);
		expect(fog.far).toBe(camera.far);
		expect(fog.color.equals(new Color(LIGHT.night.horizon))).toBe(true);
	});
});

describe('LOD', () => {
	it('cuts its bands from the tier view distance', () => {
		const low = lodProfilesFor('low');
		expect(low.tree.map((band) => band.until)).toEqual([30, 50, 70]);
		expect(keepFraction(low.tree, 10)).toBe(1);
		expect(keepFraction(low.tree, 40)).toBe(0.5);
		expect(keepFraction(low.tree, 65)).toBe(0.25);
		expect(keepFraction(low.tree, 71)).toBe(0);
		expect(keepFraction(low.cover, 31)).toBe(0);
		expect(keepFraction(low.gameplay, 69)).toBe(1);
		expect(lodProfilesFor('high').tree.at(-1)?.until).toBe(120);
	});

	it('ranks slots so any run keeps an even, nested share', () => {
		const ranks = Array.from({ length: 256 }, (_, slot) => lodRank(slot));
		expect(new Set(ranks).size).toBe(256);
		for (let start = 0; start < 240; start += 7) {
			const run = ranks.slice(start, start + 16);
			expect(run.filter((r) => r < 128)).toHaveLength(8);
			expect(run.filter((r) => r < 64)).toHaveLength(4);
		}
	});
});
