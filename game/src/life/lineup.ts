/**
 * Dev-only lineup of the animals at one scale and in the game's light (ART.md §9.1):
 * the P23 species next to the avatar, the mico, the onça and the tucano and a 3 u scale
 * bar, all baked and lit exactly as the living world draws them (bakePet, the species
 * palettes, the house Lambert with the character rim, the daylight hemisphere and sun).
 * The camera is orthographic, so every animal is drawn at exactly one scale. ?part=small
 * frames the small species (with the mico and the tucano for reference) four times larger.
 * With ?strip=<species>, a gait strip instead: its walk and its run, four phases each,
 * from the side (a bird without a ground gait shows its wingbeat).
 *
 *   ./node_modules/.bin/vite --config game/vite.config.ts --port 5197
 *   http://localhost:5197/src/life/lineup.html
 *   http://localhost:5197/src/life/lineup.html?strip=capivara
 *
 * window.__lineup.ready turns true once the frame is drawn. Nothing here ships: the
 * game build's only input is src/ui/loading/entry.ts.
 */
import {
	BoxGeometry,
	Color,
	type Group,
	Mesh,
	NoToneMapping,
	type Object3D,
	OrthographicCamera,
	Scene,
	SRGBColorSpace,
	Vector3,
	WebGLRenderer
} from 'three';
import {
	AnimalAnimator,
	AnimalMotion,
	availablePostures,
	MODELS,
	P23_SPECIES,
	PERCHERS,
	type PercherSpecies,
	SPECIES,
	type SpeciesId
} from '../animation/animals/index.ts';
import { applyToRig } from '../animation/rig.ts';
import { createHemisphere, ShadowRig } from '../render/index.ts';
import { lighting } from '../render/stylized.ts';
import { loadAvatar, loadModel } from '../scene/avatar.ts';
import { ensureVertexColors, paletteMaterial } from '../scene/materials.ts';
import { LIFE_ASSETS } from './assets.ts';
import { loadPaletteTexture } from './create.ts';
import { bakePet, createPet, type PetInstance, type PetTemplate } from './pets.ts';

const query = new URLSearchParams(location.search);
const strip = query.get('strip') as SpeciesId | null;
const small = query.get('part') === 'small';
const width = Number(query.get('w') ?? (strip ? 1600 : 1900));
const height = Number(query.get('h') ?? (strip ? 420 : 620));
const abort = new AbortController();

const renderer = new WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.outputColorSpace = SRGBColorSpace;
renderer.toneMapping = NoToneMapping;
renderer.setPixelRatio(1);
renderer.setSize(width, height);
// The daylight hemisphere's sky colour behind everything.
renderer.setClearColor(new Color('#cfe8f2'));
document.body.prepend(renderer.domElement);
const scene = new Scene();
const camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 400);

/** Frames a world box `span` wide centred on (cx, cy) at the page's aspect, from a little above the front. */
function frame(cx: number, cy: number, span: number, from: Vector3) {
	const aspect = width / height;
	const halfW = span / 2;
	const halfH = halfW / aspect;
	camera.left = -halfW;
	camera.right = halfW;
	camera.top = halfH;
	camera.bottom = -halfH;
	camera.position.set(cx + from.x, cy + from.y, from.z);
	camera.lookAt(cx, cy, 0);
	camera.updateProjectionMatrix();
}
scene.add(createHemisphere('daylight'));
const shadows = new ShadowRig(renderer, { blobs: 64 });
shadows.setTier('low', scene);
scene.add(shadows.object);
// The lineup light of scene/lineup.ts: no canopy shade.
lighting.uShadeEnabled.value = 0;

// Ground and the 3 u scale bar (the avatar's height).
const ground = new BoxGeometry(400, 0.2, 60).translate(0, -0.1, 0);
ensureVertexColors(ground);
scene.add(new Mesh(ground, paletteMaterial('#86bf7c')));
shadows.addReceiver(scene.children[scene.children.length - 1]);

const templates = new Map<SpeciesId, PetTemplate>();
const models = new Map<string, Object3D>();
async function template(species: SpeciesId): Promise<PetTemplate> {
	const known = templates.get(species);
	if (known) return known;
	const urls = [LIFE_ASSETS.models[SPECIES[species].model], LIFE_ASSETS.attachments[species]];
	for (const url of urls) if (url && !models.has(url)) models.set(url, await loadModel(url, abort.signal));
	const palette = await loadPaletteTexture(LIFE_ASSETS.palettes[species], abort.signal);
	const attachment = LIFE_ASSETS.attachments[species];
	const baked = bakePet(
		species,
		models.get(urls[0] as string) as Object3D,
		attachment ? (models.get(attachment) ?? null) : null,
		palette
	);
	templates.set(species, baked);
	return baked;
}

/** An animator settled in its first posture (stand, or perch for the perching birds). */
function rest(species: SpeciesId) {
	const animator = new AnimalAnimator(species);
	const motion = new AnimalMotion();
	motion.posture = availablePostures(animator)[0];
	for (let i = 0; i < 90; i++) {
		motion.beginUpdate();
		animator.update(1 / 60, motion);
	}
	return animator;
}

/** An animator at gait phase `phase` of its walk (or run) after a second of steady walking. */
function gait(species: SpeciesId, run: boolean, phase: number) {
	const params = SPECIES[species];
	const animator = new AnimalAnimator(species);
	const motion = new AnimalMotion();
	motion.posture = 'stand';
	const speed = run ? params.stride.fastSpeed : params.stride.slowSpeed;
	for (let i = 0; i < 120; i++) {
		motion.beginUpdate();
		motion.speed = speed;
		motion.distance = speed / 60;
		animator.update(1 / 60, motion);
	}
	const delta = (((phase - animator.phase) % 1) + 1) % 1;
	motion.beginUpdate();
	motion.speed = speed;
	motion.distance = delta * animator.stride;
	motion.cycles = delta;
	animator.update(1e-4, motion);
	return animator;
}

const flapRate = (species: SpeciesId) => PERCHERS[species as PercherSpecies]?.flapRate ?? 6;

/** A bird's wingbeat at `phase` of a beat, in flight. */
function wingbeat(species: SpeciesId, phase: number) {
	const animator = new AnimalAnimator(species);
	const motion = new AnimalMotion();
	const rate = flapRate(species);
	motion.posture = 'fly';
	motion.flap = 1;
	motion.flapRate = rate;
	for (let i = 0; i < 60; i++) {
		motion.beginUpdate();
		animator.update(1 / 60, motion);
	}
	const delta = (((phase - animator.wingPhase) % 1) + 1) % 1;
	motion.beginUpdate();
	animator.update(delta / rate, motion);
	return animator;
}

function pose(pet: PetInstance, animator: AnimalAnimator, x: number, z: number, yaw: number) {
	const group = pet.group;
	group.position.set(x, 0, z);
	group.rotation.set(0, yaw, 0);
	group.scale.setScalar(SPECIES[animator.species.id].scale);
	applyToRig(animator.pose, pet.rig.binding);
	group.updateMatrix();
	for (const bone of pet.bones) bone.updateMatrix();
	scene.add(group);
	const blob = shadows.blobs.add('actor');
	shadows.blobs.set(blob, x, 0, z, SPECIES[animator.species.id].size * 0.42, 0);
}

const labels: { text: string; sub: string; at: Vector3; row: number }[] = [];
const label = (text: string, sub: string, x: number, z: number) =>
	labels.push({ text, sub, at: new Vector3(x, -0.05, z), row: labels.length % 2 });

async function lineup() {
	const all: SpeciesId[] = ['mico-leao-dourado', 'onca-pintada', 'tucano-de-bico-verde', ...P23_SPECIES];
	const species = small ? all.filter((id) => SPECIES[id].size < 1 || id === 'onca-pintada') : all;
	(document.getElementById('title') as HTMLElement).textContent = small
		? 'Bichos da Mata: os pequenos, 4× mais perto (mesma escala entre si; avatar e onça como referência)'
		: 'Bichos da Mata: lineup na escala de ART.md §3 (avatar 3 u, barra 3 u), câmera ortográfica, luz do jogo';
	const avatar = await loadAvatar(abort.signal, {
		style: 'classic',
		hairStyle: 'bone',
		face: 'smile',
		kenneySkin: 'a',
		colors: { skin: '#8d5a3b', hair: '#2b1d14', shirt: '#2d6a4f', pants: '#4f5c55', shoes: '#5e4330' }
	});
	let x = 0;
	const bar = new BoxGeometry(0.15, 3, 0.15).translate(x, 1.5, 0);
	ensureVertexColors(bar);
	scene.add(new Mesh(bar, paletteMaterial('#5e4330')));
	label('3 u', 'barra', x, 0);
	x += 1.4;
	avatar.model.position.set(x, 0, 0);
	avatar.model.rotation.y = -0.35;
	scene.add(avatar.model as Group);
	label('Avatar', '3,0 u', x, 0);
	x += 1.6;
	for (const id of species) {
		const params = SPECIES[id];
		const model = MODELS[params.model];
		const half = (Math.max(model.totalLength, 1.3) * params.scale) / 2;
		// Room for the label under each animal too (it is about 1.1 u wide at this scale).
		const room = Math.max(half * 0.8 + 0.25, small ? 0.3 : 0.75);
		x += room;
		const pet = createPet(await template(id));
		pose(pet, rest(id), x, 0, -0.55);
		label(params.name, `${params.size.toFixed(2)} u`, x, 0);
		x += room;
	}
	const span = x + 0.6;
	frame(span / 2 - 0.6, small ? 0.9 : 1.3, span, new Vector3(0, 2.2, 30));
}

async function gaitStrip(id: SpeciesId) {
	const params = SPECIES[id];
	const phases = [0, 0.25, 0.5, 0.75];
	const tpl = await template(id);
	const length = MODELS[params.model].totalLength * params.scale;
	const step = Math.max(length, MODELS[params.model].top * params.scale) * 1.25 + 0.3;
	const rows: { name: string; make: (phase: number) => AnimalAnimator }[] = [];
	if (params.walk) rows.push({ name: 'anda', make: (p) => gait(id, false, p) });
	if (params.run) rows.push({ name: 'corre', make: (p) => gait(id, true, p) });
	if (!params.walk) rows.push({ name: 'voa', make: (p) => wingbeat(id, p) });
	// Seen from its sunlit side (the camera behind the row, ?side=shade for the other side): the
	// row runs along −x so it reads left to right, each animal walking to the frame's left; a
	// crab walks sideways, so it is seen from the front and its legs swing across; a bird's
	// wingbeat reads from the front too.
	const sun = query.get('side') !== 'shade';
	const dir = sun ? -1 : 1;
	const walkYaw = sun ? Math.PI / 2 : -Math.PI / 2;
	const frontYaw = sun ? Math.PI : 0;
	let x = 0;
	let last = 0;
	for (const row of rows) {
		for (const phase of phases) {
			last = x;
			const yaw = row.name === 'voa' || params.walk?.sideways ? frontYaw : walkYaw;
			pose(createPet(tpl), row.make(phase), dir * x, 0, yaw);
			const g = row.name === 'voa' ? null : row.name === 'anda' ? 'walk' : 'run';
			const speed = g === 'run' ? params.stride.fastSpeed : params.stride.slowSpeed;
			label(
				`${row.name} ${Math.round(phase * 100)}%`,
				g ? `${speed.toFixed(2)} u/s` : `${flapRate(id)} batidas/s`,
				dir * x,
				0
			);
			x += step;
		}
		x += step * 0.4;
	}
	(document.getElementById('title') as HTMLElement).textContent =
		`${params.name} (${params.scientific}): ${rows.map((r) => r.name).join(' e ')}, 4 fases por ciclo`;
	frame(
		(dir * last) / 2,
		params.size * 0.45,
		last + step * 1.2,
		new Vector3(0, params.size * 0.35, sun ? -30 : 30)
	);
}

function render() {
	camera.updateMatrixWorld();
	scene.updateMatrixWorld(true);
	shadows.blobs.sync();
	shadows.update(camera.position.x, 0, 0);
	renderer.render(scene, camera);
	const box = document.getElementById('labels') as HTMLElement;
	box.textContent = '';
	const v = new Vector3();
	for (const l of labels) {
		v.copy(l.at).project(camera);
		const div = document.createElement('div');
		div.style.left = `${((v.x + 1) / 2) * width}px`;
		div.style.top = `${((1 - v.y) / 2) * height + 4 + l.row * 26}px`;
		div.textContent = l.text;
		const sub = document.createElement('i');
		sub.textContent = l.sub;
		div.append(sub);
		box.append(div);
	}
}

declare global {
	var __lineup: { ready: boolean; error?: string } | undefined;
}
globalThis.__lineup = { ready: false };
try {
	if (strip) await gaitStrip(strip);
	else await lineup();
	render();
	globalThis.__lineup.ready = true;
} catch (error) {
	globalThis.__lineup.error = String(error);
	throw error;
}
