/**
 * Dev-only preview of the living world on the real story map, without the
 * game's Root: the map's terrain and trees (world-runtime), the layer, and an
 * Iara driven by IaraLife. Open with the game's Vite config:
 *
 *   ./node_modules/.bin/vite --config game/vite.config.ts --port 5191
 *   http://localhost:5191/src/life/preview.html?shot=muriquis&quality=medium
 *
 * `?manual` stops the animation loop: window.__life.step(frames) advances it in
 * fixed 1/60 s steps and renders once (deterministic captures, Playwright).
 * Nothing here ships: the game build's only input is src/main.ts.
 */
import { NoToneMapping, PerspectiveCamera, Scene, SRGBColorSpace, Vector3, WebGLRenderer } from 'three';
import { AvatarAnimator, createAvatarInput } from '../animation/avatar-animator.ts';
import { AVATAR_LAYOUT, BLOCKY_RIG } from '../animation/joints.ts';
import { applyToRig, bindRig } from '../animation/rig.ts';
import iaraPalette from '../assets/skins/palette-iara.png?url';
import { buildStoryWorld } from '../level/build.ts';
import {
	applyFog,
	BlockGrid,
	createHemisphere,
	fogSettings,
	type Quality,
	ShadowRig
} from '../render/index.ts';
import { lighting } from '../render/stylized.ts';
import { loadAvatar, loadModel } from '../scene/avatar.ts';
import { heightAt } from '../survival/terrain.ts';
import { loadWorldPlacements } from '../world-runtime/placements.ts';
import { createMapVisual } from '../world-runtime/visual.ts';
import { createLivingWorld } from './create.ts';
import { CROWNS } from './homes.ts';
import { IaraLife } from './iara.ts';
import type { LifeFrame, LifeStoryState, LivingWorldRuntime } from './living-world.ts';

type XYZ = [number, number, number];

interface Shot {
	label: string;
	/** Missions done, and seedlings planted in the clareira. */
	story: number[];
	planted?: number;
	/** Player feet (x, z) at t seconds into the shot. */
	player(t: number): [number, number];
	/** Camera position and target at t (y in world units). */
	camera(t: number, player: XYZ): [XYZ, XYZ];
	/** Iara's dialogue open from this time on (s). */
	talkFrom?: number;
	/**
	 * Frame this animal (plan key) instead of `camera`: distance and height offset, u, from the
	 * clearest side or from a fixed bearing (radians, 0 = +z).
	 */
	track?: { key: string; distance: number; lift: number; angle?: number };
}

const query = new URLSearchParams(location.search);
const quality = (
	['low', 'medium', 'high'].includes(query.get('quality') ?? '') ? query.get('quality') : 'medium'
) as Quality;
const manual = query.has('manual');
const { world, level } = buildStoryWorld();
const ground = (x: number, z: number) => heightAt(world.heights, x, z);
const still = (x: number, z: number) => (): [number, number] => [x, z];
const fixed = (from: XYZ, to: XYZ) => (): [XYZ, XYZ] => [from, to];

const SHOTS: Record<string, Shot> = {
	micos: {
		label: 'Micos-leões-dourados na copa (fragmento norte)',
		story: [],
		player: still(64, 41),
		camera: fixed([64, ground(64, 41) + 5, 41], [63, ground(63, 30) + 7, 30]),
		track: { key: 'mico-2', distance: 5.5, lift: -1 }
	},
	companion: {
		label: 'Missão 1 feita: o mico desce e acompanha a criança',
		story: [1],
		player: (t) => [58, 47 + Math.max(0, Math.min(t - 1, 9)) * 2.2],
		camera: (_t, p) => [
			[p[0] - 3.5, p[1] + 3.2, p[2] - 6.5],
			[p[0], p[1] + 1, p[2] + 1]
		]
	},
	bugios: {
		label: 'Bugios-ruivos no ipê-rosa (noroeste)',
		story: [],
		player: still(18, 23),
		camera: fixed([20, ground(20, 24) + 3, 24], [17.4, ground(17.4, 11.5) + 7.5, 11.5]),
		track: { key: 'bugio-0', distance: 8, lift: -3, angle: 0 }
	},
	muriquis: {
		label: 'Muriquis braquiando na fileira de apoios',
		story: [],
		player: still(115, 32),
		camera: fixed([115, ground(115, 32) + 6, 32], [108.5, ground(108.5, 25.5) + 9, 25.5]),
		track: { key: 'muriqui-0', distance: 9, lift: -1.5 }
	},
	preguica: {
		label: 'Preguiça-de-coleira na embaúba',
		story: [],
		player: still(133, 132),
		camera: fixed([132.5, ground(133, 132) + 4, 131.5], [128.6, ground(128.6, 126.4) + 7.3, 126.4]),
		track: { key: 'preguica-0', distance: 5, lift: -1.5 }
	},
	tucanos: {
		label: 'Tucanos nas araucárias do planalto',
		story: [],
		player: still(136, 66),
		camera: fixed([136, ground(136, 66) + 2.5, 66], [138, ground(138, 58) + 12, 57]),
		track: { key: 'tucano-0', distance: 4.5, lift: -0.8 }
	},
	onca: {
		label: 'Onça-pintada: anda para longe a 15 u',
		story: [],
		player: (t) => [146, 126 + Math.min(t, 7) * 2],
		camera: (_t, p) => [
			[p[0] - 1, p[1] + 4.5, p[2] - 8],
			[146, ground(146, 146) + 1, 146]
		],
		track: { key: 'onca-0', distance: 11, lift: 2.5 }
	},
	borboletas: {
		label: 'Borboletas na clareira plantada (6 mudas)',
		story: [],
		planted: 6,
		player: still(112, 125),
		camera: fixed([112, ground(112, 125) + 1.8, 125], [112, ground(112, 118) + 2.2, 117])
	},
	finale: {
		label: 'Missão 6: os tucanos voam entre as araucárias',
		story: [1, 2, 3, 4, 5, 6],
		planted: 6,
		player: still(136, 66),
		camera: fixed([136, ground(136, 66) + 2.5, 66], [138, ground(138, 58) + 12, 57]),
		track: { key: 'tucano-0', distance: 9, lift: -2 }
	},
	iara: {
		label: 'Iara: vira para a criança e gesticula ao falar',
		story: [],
		player: (t) => [38 + Math.max(0, 6 - t * 2.5), 76.5],
		camera: (_t, p) => [
			[p[0] - 2, p[1] + 3.2, p[2] - 4.5],
			[38, ground(38, 80) + 1.8, 80]
		],
		talkFrom: 3
	},
	folhas: {
		label: 'Folhas caindo sob a copa, pólen e vento no pasto',
		story: [],
		player: still(47, 44),
		camera: fixed([47, ground(47, 47) + 2.6, 47], [52, ground(52, 38) + 3, 38])
	},
	panorama: {
		label: 'Panorama: copa, saíras e corredor',
		story: [1],
		player: still(52, 60),
		camera: fixed([40, 34, 78], [60, 8, 40])
	}
};

/** Crowns and trunks of the drawn trees, for picking an unobstructed side to frame an animal from. */
const OBSTACLES = (() => {
	const t = world.trees;
	const out: { x: number; z: number; y: number; cy: number; r: number; trunk: number; top: number }[] = [];
	for (let i = 0; i < t.count; i++) {
		const crown = CROWNS[t.kinds[t.kind[i]]];
		const s = t.scale[i];
		const top = crown.model ? crown.top * s : 8;
		out.push({
			x: t.x[i],
			z: t.z[i],
			y: t.y[i],
			cy: t.y[i] + ((crown.base + crown.top) / 2) * s,
			r: crown.model ? crown.radius * s * 0.8 : 0,
			trunk: crown.model ? 0.5 * s : 1.3,
			top: t.y[i] + top
		});
	}
	return out;
})();

/** Obstruction of the segment a→b: crowns (spheres) and trunks (vertical cylinders) it passes through. */
function obstruction(a: XYZ, b: XYZ) {
	let score = 0;
	const dx = b[0] - a[0];
	const dy = b[1] - a[1];
	const dz = b[2] - a[2];
	const len2 = dx * dx + dy * dy + dz * dz;
	for (const o of OBSTACLES) {
		if (Math.hypot(o.x - b[0], o.z - b[2]) > 30) continue;
		// Closest point of the segment to the crown centre.
		const t = Math.max(0, Math.min(0.9, ((o.x - a[0]) * dx + (o.cy - a[1]) * dy + (o.z - a[2]) * dz) / len2));
		const d = Math.hypot(a[0] + dx * t - o.x, a[1] + dy * t - o.cy, a[2] + dz * t - o.z);
		if (d < o.r) score += 1 - d / o.r;
		// Trunk: horizontal distance at the closest approach, if the segment is below the tree top there.
		const h2 = dx * dx + dz * dz || 1;
		const u = Math.max(0, Math.min(0.95, ((o.x - a[0]) * dx + (o.z - a[2]) * dz) / h2));
		const ty = a[1] + dy * u;
		if (ty < o.top && Math.hypot(a[0] + dx * u - o.x, a[2] + dz * u - o.z) < o.trunk + 0.4) score += 1.5;
	}
	return score;
}

/** The clearest viewpoint around a target at about `distance`, `lift` above it (never below head height). */
function clearView(target: XYZ, distance: number, lift: number): XYZ {
	let best: XYZ = [target[0], target[1] + 2, target[2] + distance];
	let bestScore = Number.POSITIVE_INFINITY;
	for (let k = 0; k < 36; k++)
		for (const f of [1, 0.8, 1.3]) {
			const a = (k / 36) * Math.PI * 2;
			const x = target[0] + Math.sin(a) * distance * f;
			const z = target[2] + Math.cos(a) * distance * f;
			if (x < 2 || z < 2 || x > world.size - 2 || z > world.size - 2) continue;
			const y = Math.max(ground(x, z) + 1.6, target[1] + lift);
			const score = obstruction([x, y, z], target) + (f !== 1 ? 0.05 : 0);
			if (score < bestScore) {
				bestScore = score;
				best = [x, y, z];
			}
		}
	return best;
}

const hud = document.getElementById('hud') as HTMLElement;
const renderer = new WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.outputColorSpace = SRGBColorSpace;
renderer.toneMapping = NoToneMapping;
renderer.setPixelRatio(1);
renderer.setSize(innerWidth, innerHeight);
document.body.prepend(renderer.domElement);
const scene = new Scene();
const camera = new PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 120);
const settings = fogSettings(quality);
applyFog(scene, camera, settings);
const grid = BlockGrid.covering(0, 0, world.size, world.size);
const visual = createMapVisual(world, level, undefined, true);
scene.add(visual.object, createHemisphere('daylight'));
const shadows = new ShadowRig(renderer, { blobs: 48 });
shadows.setTier(quality, scene);
scene.add(shadows.object);
shadows.addReceiver(visual.object);
const abort = new AbortController();

const gl = renderer.getContext();
const info = gl.getExtension('WEBGL_debug_renderer_info');
const gpu = info
	? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL))
	: String(gl.getParameter(gl.RENDERER));

const [placements, life, npc] = await Promise.all([
	loadWorldPlacements(grid, quality, world, abort.signal, level.trails),
	createLivingWorld({
		world,
		level,
		quality,
		loadGlb: (url, signal) => loadModel(url, signal),
		signal: abort.signal,
		blobs: shadows.blobs,
		onHowl: (e) => console.info(`howl${e.chorus ? ' (chorus)' : ''} at ${e.x.toFixed(0)}, ${e.z.toFixed(0)}`)
	}) as Promise<LivingWorldRuntime>,
	loadAvatar(abort.signal, {
		style: 'classic',
		hairStyle: 'bone',
		face: 'smile',
		kenneySkin: 'a',
		colors: { skin: '#8d5a3b', hair: '#2b1d14', shirt: '#2d6a4f', pants: '#4f5c55', shoes: '#5e4330' }
	})
]);
scene.add(life.object3d);
if (query.get('trees') !== '0') scene.add(placements.pools.object);
shadows.addReceiver(placements.pools.object);

// Iara with the ranger palette, as missions/props.ts paints her.
const palette = await createImageBitmap(await (await fetch(iaraPalette)).blob(), {
	imageOrientation: 'none',
	premultiplyAlpha: 'none'
});
const skin = npc.appearance.texture.image as HTMLCanvasElement;
skin.getContext('2d')?.drawImage(palette, 0, 0, 64, 64);
palette.close();
npc.appearance.texture.needsUpdate = true;
const post = level.landmarks.find((l) => l.kind === 'npc-iara') ?? {
	x: 38,
	y: ground(38, 80),
	z: 80,
	yawS: 0,
	yawC: 1
};
const iara = new IaraLife({
	x: post.x,
	y: post.y,
	z: post.z,
	yaw: Math.atan2(post.yawS, post.yawC),
	trail: { x: 42, z: 70 }
});
npc.model.position.set(post.x, post.y, post.z);
scene.add(npc.model);
const iaraRig = bindRig(npc.model, AVATAR_LAYOUT, BLOCKY_RIG);
const iaraAnimator = new AvatarAnimator();
const iaraInput = createAvatarInput();
iaraInput.x = post.x;
iaraInput.y = post.y;
iaraInput.z = post.z;

const frame: LifeFrame = {
	dt: 1 / 60,
	camera,
	playerPosition: { x: 0, y: 0, z: 0 },
	playerVelocity: { x: 0, y: 0, z: 0 },
	time: 0,
	reducedMotion: query.has('reduced')
};
let shot: Shot = SHOTS.micos;
let shotName = 'micos';
let shotTime = 0;
const camFrom = new Vector3();
const camTo = new Vector3();
const story = (done: number[], planted: number): LifeStoryState => ({
	completed: (id) => done.includes(id),
	progress: (id) => (id === 4 ? planted : done.includes(id) ? 1 : 0)
});

let tracked: XYZ | null = null;

function trackedTarget(): XYZ | null {
	const key = shot.track?.key;
	const index = key ? life.fauna.plan.animals.findIndex((a) => a.key === key) : -1;
	if (index < 0) return null;
	const animal = life.fauna.animals[index];
	const m = animal.motion;
	return [m.x, m.y + animal.species.size * 0.4, m.z];
}

function place(t: number) {
	const target = shot.track && tracked ? trackedTarget() : null;
	let [px, pz] = shot.player(t);
	if (target && tracked) {
		// Stand where the camera is (particles, LOD and the onça read the player); the onça shot walks in.
		px = tracked[0];
		pz = tracked[2];
		if (shotName === 'onca') {
			const d = Math.hypot(target[0] - px, target[2] - pz);
			const walk = Math.min(Math.max(0, d - 9), t * 1.6);
			px += ((target[0] - px) / (d || 1)) * walk;
			pz += ((target[2] - pz) / (d || 1)) * walk;
		}
	}
	const py = ground(px, pz);
	const override = query.get('cam')?.split(',').map(Number);
	const [from, to] =
		override && override.length === 6
			? [override.slice(0, 3) as XYZ, override.slice(3) as XYZ]
			: target && tracked
				? ([shotName === 'onca' ? [px, py + 2.2, pz] : tracked, target] as [XYZ, XYZ])
				: shot.camera(t, [px, py, pz]);
	camFrom.set(...from);
	camTo.set(...to);
	camera.position.copy(camFrom);
	camera.lookAt(camTo);
	camera.updateMatrixWorld();
	return [px, py, pz] as const;
}

function useShot(name: string) {
	shot = SHOTS[name] ?? SHOTS.micos;
	shotName = SHOTS[name] ? name : 'micos';
	shotTime = 0;
	tracked = null;
	life.onStory(story([], 0));
	life.onStory(story(shot.story, shot.planted ?? 0));
	// ?track=<key>&dist=&lift=&angle= frames any animal from a fixed bearing (close-ups, turntables).
	const key = query.get('track');
	if (key) {
		shot = {
			...shot,
			track: { key, distance: Number(query.get('dist') ?? 3), lift: Number(query.get('lift') ?? 0) }
		};
	}
	const target = trackedTarget();
	if (target && shot.track) {
		const angle = query.get('angle') ?? (shot.track.angle !== undefined ? String(shot.track.angle) : null);
		tracked =
			angle !== null
				? [
						target[0] + Math.sin(Number(angle)) * shot.track.distance,
						target[1] + shot.track.lift,
						target[2] + Math.cos(Number(angle)) * shot.track.distance
					]
				: clearView(target, shot.track.distance, shot.track.lift);
	}
	const [x, y, z] = place(0);
	frame.playerPosition.x = x;
	frame.playerPosition.y = y;
	frame.playerPosition.z = z;
}

/** One fixed step of everything, no render. */
function step(dt: number) {
	shotTime += dt;
	frame.dt = dt;
	frame.time += dt;
	const before = frame.playerPosition;
	const [x, y, z] = place(shotTime);
	frame.playerVelocity.x = (x - before.x) / dt;
	frame.playerVelocity.y = 0;
	frame.playerVelocity.z = (z - before.z) / dt;
	before.x = x;
	before.y = y;
	before.z = z;
	life.update(frame);
	const f = iara.frame;
	f.dt = dt;
	f.playerX = x;
	f.playerY = y;
	f.playerZ = z;
	f.talking = shot.talkFrom !== undefined && shotTime >= shot.talkFrom;
	f.reducedMotion = frame.reducedMotion;
	f.busy = iaraAnimator.state === 'emote';
	iaraInput.yaw = iara.yaw;
	iaraInput.reducedMotion = frame.reducedMotion;
	npc.model.rotation.y = iara.yaw;
	applyToRig(iara.update(iaraAnimator.update(dt, iaraInput)), iaraRig);
}

function render() {
	lighting.uVisualTime.value = frame.time;
	visual.prepareFrame?.(camera, frame.time, quality, false);
	grid.update(camera);
	shadows.blobs.sync();
	shadows.update(frame.playerPosition.x, frame.playerPosition.y, frame.playerPosition.z);
	renderer.render(scene, camera);
	const d = life.debug();
	hud.textContent = [
		`${shot.label}  [${shotName}]  t=${shotTime.toFixed(1)} s  ${quality}`,
		`animais ${d.animals}: visíveis ${d.visible} · animados ${d.animated}/${d.cap} (perto ${d.near}, longe ${d.far})`,
		`camada: ~${d.draws} draws · ${d.triangles} tri · cpu ${d.cpu.mean.toFixed(3)} ms (p95 ${d.cpu.p95.toFixed(3)})`,
		`partículas ${d.particles.live}/${d.particles.limit} (folhas ${d.particles.leaves}, pólen ${d.particles.pollen}) · borboletas ${d.butterflies}`,
		`companheiro ${d.companion ? d.companionState : 'não'} · onça ${d.onca.state} a ${d.onca.distance.toFixed(1)} u${d.onca.leaving ? ' (se afastando)' : ''}`,
		`Iara: ${iara.gesture}${iara.talkWeight > 0 ? ' · falando' : ''}${iara.engaged ? ' · olhando a criança' : ''}`,
		`cena: ${renderer.info.render.calls} draws · ${renderer.info.render.triangles} tri · ${gpu}`
	].join('\n');
}

/** The layer's own draws and triangles: the scene rendered with and without it. */
function measure() {
	life.object3d.visible = false;
	renderer.render(scene, camera);
	const without = { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles };
	life.object3d.visible = true;
	renderer.render(scene, camera);
	const all = { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles };
	return {
		scene: all,
		layer: { calls: all.calls - without.calls, triangles: all.triangles - without.triangles },
		debug: life.debug()
	};
}

const nav = document.getElementById('shots') as HTMLElement;
for (const name of Object.keys(SHOTS)) {
	const button = document.createElement('button');
	button.textContent = name;
	button.onclick = () => useShot(name);
	nav.append(button);
}
addEventListener('resize', () => {
	renderer.setSize(innerWidth, innerHeight);
	camera.aspect = innerWidth / innerHeight;
	camera.updateProjectionMatrix();
});

useShot(query.get('shot') ?? 'micos');
// Settle: a few seconds of life before the first picture.
for (let i = 0; i < 120; i++) step(1 / 60);
shotTime = 0;
render();

declare global {
	var __life:
		| {
				ready: boolean;
				shots: string[];
				shot(name: string, warm?: number): void;
				step(frames: number): void;
				measure(): ReturnType<typeof measure>;
				debug(): ReturnType<LivingWorldRuntime['debug']>;
				gpu: string;
		  }
		| undefined;
}

globalThis.__life = {
	ready: true,
	shots: Object.keys(SHOTS),
	gpu,
	shot(name, warm = 2) {
		useShot(name);
		for (let i = 0; i < Math.round(warm * 60); i++) step(1 / 60);
		shotTime = 0;
		render();
	},
	step(frames) {
		for (let i = 0; i < frames; i++) step(1 / 60);
		render();
	},
	measure,
	debug: () => life.debug()
};

if (!manual) {
	let last = performance.now();
	const loop = (now: number) => {
		const dt = Math.min(0.1, (now - last) / 1000);
		last = now;
		step(dt);
		render();
		requestAnimationFrame(loop);
	};
	requestAnimationFrame(loop);
}
