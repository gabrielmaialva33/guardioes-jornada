import { Mesh, PerspectiveCamera, SphereGeometry } from 'three';
import { expect, it } from 'vitest';
import { fogSettings } from '../render/fog-lod.ts';
import { createAtmosphere } from './atmosphere.ts';

it('keeps the night sky dome inside the shortened night camera far plane', () => {
	const backdrop = createAtmosphere(160, 0),
		camera = new PerspectiveCamera();
	backdrop.update(camera, 0, 'low', 'night');
	const dome = backdrop.sky.children.find(
		(child) => child instanceof Mesh && child.geometry instanceof SphereGeometry
	);
	if (!(dome instanceof Mesh) || !(dome.geometry instanceof SphereGeometry)) throw new Error('sky dome');
	expect(dome.geometry.parameters.radius * dome.scale.x).toBeLessThan(fogSettings('low', 'night').far);
	backdrop.dispose();
});
