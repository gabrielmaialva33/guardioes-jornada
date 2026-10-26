/** Isolated DEV acceptance surface using the actual placement loader and its study hook. */
import { NoToneMapping, PerspectiveCamera, Scene, SRGBColorSpace, WebGLRenderer } from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { buildStoryWorld } from '../level/build.ts';
import { updateWind } from '../life/wind.ts';
import {
	applyFog,
	BlockGrid,
	createHemisphere,
	fogSettings,
	type Quality,
	ShadowRig
} from '../render/index.ts';
import { lighting } from '../render/stylized.ts';
import { loadWorldPlacements } from '../world-runtime/placements.ts';
import { createMapVisual } from '../world-runtime/visual.ts';

if (!import.meta.env.DEV) throw new Error('dev preview only');
const query = new URLSearchParams(location.search);
let quality: Quality =
	query.get('quality') === 'high' ? 'high' : query.get('quality') === 'low' ? 'low' : 'medium';
const status = document.querySelector<HTMLElement>('#status');
const { world, level } = buildStoryWorld(),
	abort = new AbortController();
const renderer = new WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.outputColorSpace = SRGBColorSpace;
renderer.toneMapping = NoToneMapping;
renderer.setPixelRatio(1);
renderer.setSize(innerWidth, innerHeight);
document.body.prepend(renderer.domElement);
const scene = new Scene(),
	camera = new PerspectiveCamera(55, innerWidth / innerHeight, 0.1, 160),
	controls = new OrbitControls(camera, renderer.domElement);
applyFog(scene, camera, fogSettings(quality));
const grid = BlockGrid.covering(0, 0, world.size, world.size),
	visual = createMapVisual(world, level, undefined, true),
	shadows = new ShadowRig(renderer, { blobs: 0 });
shadows.setTier(quality, scene);
scene.add(visual.object, createHemisphere('daylight'), shadows.object);
const ground = (x: number, z: number) => world.heights[Math.round(z) * world.grid + Math.round(x)];
function pose(name: string) {
	const positions: Record<string, [number, number, number, number]> = {
		trilha: [58, 47, 63, 30],
		mata: [67, 33, 65, 21],
		margem: [77, 98, 86, 90]
	};
	const [x, z, tx, tz] = positions[name] ?? positions.trilha;
	camera.position.set(x, ground(x, z) + 4, z);
	controls.target.set(tx, ground(tx, tz) + 3, tz);
	controls.update();
}
pose(query.get('pose') ?? 'trilha');
const draw = () => {
	updateWind(6, matchMedia('(prefers-reduced-motion: reduce)').matches);
	lighting.uVisualTime.value = 6;
	grid.update(camera);
	shadows.update(camera.position.x, camera.position.y, camera.position.z);
	renderer.render(scene, camera);
};
controls.addEventListener('change', draw);
const pending = loadWorldPlacements(grid, quality, world, abort.signal, level.trails, level);
try {
	const placements = await pending;
	scene.add(placements.pools.object);
	draw();
	const setQuality = (q: Quality) => {
		quality = q;
		placements.setQuality(q);
		shadows.setTier(q, scene);
		applyFog(scene, camera, fogSettings(q));
		draw();
	};
	const select = document.querySelector('select');
	if (select) {
		select.value = quality;
		select.addEventListener('change', () => setQuality(select.value as Quality));
	}
	for (const button of document.querySelectorAll<HTMLButtonElement>('[data-pose]'))
		button.addEventListener('click', () => {
			pose(button.dataset.pose ?? 'trilha');
			draw();
		});
	if (status) status.textContent = 'Floresta pronta. Arraste para explorar.';
	Object.assign(globalThis, {
		__vegetationPreview: {
			ready: true,
			stats: () => placements.stats(),
			setQuality,
			pose: (name: string) => {
				pose(name);
				draw();
			},
			render: draw,
			dispose: () => {
				abort.abort();
				placements.dispose();
				visual.dispose();
				shadows.dispose();
				controls.dispose();
				renderer.dispose();
			}
		}
	});
	window.addEventListener(
		'pagehide',
		() => {
			abort.abort();
			placements.dispose();
			visual.dispose();
			shadows.dispose();
			controls.dispose();
			renderer.dispose();
		},
		{ once: true }
	);
} catch (error) {
	if (status) status.textContent = String(error);
	Object.assign(globalThis, { __vegetationPreview: { ready: false, error: String(error) } });
	console.error(error);
}
window.addEventListener('resize', () => {
	camera.aspect = innerWidth / innerHeight;
	camera.updateProjectionMatrix();
	renderer.setSize(innerWidth, innerHeight);
	draw();
});
