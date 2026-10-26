/** Dev-only playable fixture: /src/mechanics/preview.html?manual&shot=ladder.
 * window.__mechanics is deterministic capture instrumentation, excluded from the production entry.
 */
import {
	AmbientLight,
	Color,
	DirectionalLight,
	PerspectiveCamera,
	Scene,
	SRGBColorSpace,
	Vector3,
	WebGLRenderer
} from 'three';
import { applyCameraPose } from '../engine/camera.ts';
import { PlayerController } from '../engine/controller.ts';
import { attachInput, InputModel } from '../engine/input.ts';
import { distance } from './common.ts';
import { createMechanicsFixture } from './fixture.ts';
import { MechanicMesh } from './meshes.ts';
import { PhotoProjection } from './photo-three.ts';

type Shot = 'ladder' | 'zipline' | 'photo' | 'bridge' | 'canoe' | 'trap' | 'boardwalk';
const shots: readonly Shot[] = ['ladder', 'zipline', 'photo', 'bridge', 'canoe', 'trap', 'boardwalk'];
const labels: Record<Shot, string> = {
	ladder: 'Escada da casa na árvore',
	zipline: 'Tirolesa de volta',
	photo: 'Fotografia de aves',
	bridge: 'Ponte pênsil',
	canoe: 'Canoa no mangue',
	trap: 'Armadilha fotográfica',
	boardwalk: 'Mirante nas copas'
};
const hints: Record<Shot, string> = {
	ladder: 'Encoste na escada e mova para cima. Pule para soltar.',
	zipline: 'Use a ação na estação. A chegada é automática.',
	photo: 'Enquadre as aves e use a ação duas vezes para salvar.',
	bridge: 'Atravesse até o outro lado. As cordas protegem o caminho.',
	canoe: 'Embarque com a ação. Reme com o stick; desembarque só nos píeres.',
	trap: 'Instale a câmera. Depois conclua a ponte ou a foto e volte.',
	boardwalk: 'Use a ação no mirante para observar a floresta.'
};
const query = new URLSearchParams(location.search),
	manual = query.has('manual');
function element<T extends HTMLElement>(id: string) {
	const e = document.getElementById(id);
	if (!e) throw new Error(`Missing preview element: ${id}`);
	return e as T;
}
const app = element('app'),
	title = element('title'),
	hint = element('hint'),
	status = element('status'),
	action = element<HTMLButtonElement>('action'),
	reticle = element('reticle'),
	guide = element('guide'),
	nav = element('nav');
const renderer = new WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.outputColorSpace = SRGBColorSpace;
app.prepend(renderer.domElement);
const scene = new Scene();
scene.background = new Color(0xbadbe0);
scene.add(new AmbientLight(0xffffff, 1.8));
const sun = new DirectionalLight(0xffe2b0, 3);
sun.position.set(-30, 70, -20);
scene.add(sun);
const fixture = createMechanicsFixture();
scene.add(fixture.root);
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
fixture.reducedMotion = query.has('reduced') || reduced.matches;
const player = new PlayerController(fixture.world, fixture.ladder.spec.base, {
	traversal: fixture.traversal
});
const camera = new PerspectiveCamera(60, 1, 0.1, 250),
	lens = { fov: 60, aspect: 1, near: 0.1 };
const input = new InputModel();
const detach = attachInput(app, input);
const avatar = new MechanicMesh();
avatar.box(0, 1.65, 0, 1.1, 1.15, 0.6, 0xf1c058);
avatar.box(0, 2.65, 0, 0.85, 0.85, 0.85, 0xb67e59);
const armLeft = avatar.box(-0.72, 1.65, 0, 0.3, 1.05, 0.35, 0xb67e59),
	armRight = avatar.box(0.72, 1.65, 0, 0.3, 1.05, 0.35, 0xb67e59),
	legLeft = avatar.box(-0.3, 0.6, 0, 0.4, 1.15, 0.4, 0x325b70),
	legRight = avatar.box(0.3, 0.6, 0, 0.4, 1.15, 0.4, 0x325b70);
scene.add(avatar.root);
const projection = new PhotoProjection(fixture.world);
const rings = fixture.photo.subjects.map(() => {
	const ring = document.createElement('div');
	ring.className = 'ring';
	ring.hidden = true;
	app.append(ring);
	return ring;
});
const speciesLabels: Record<string, string> = { tucano: 'tucano', saira: 'saíra', muriqui: 'muriqui' };
const discoveries = new Set<string>();
let shot: Shot = 'ladder',
	last = performance.now(),
	raf = 0,
	elapsed = 0,
	notice = '',
	lastStatus = '',
	lastAction = '';
const lookTarget = new Vector3(),
	photoPosition = new Vector3();
const buttons = new Map<Shot, HTMLButtonElement>();
for (const name of shots) {
	const b = document.createElement('button');
	b.type = 'button';
	b.textContent = labels[name];
	b.addEventListener('click', () => select(name));
	nav.append(b);
	buttons.set(name, b);
}
for (const role of ['action', 'jump'] as const)
	element(role).addEventListener('click', (e) => {
		if (e.detail === 0) input.tapButton(role);
	});
function select(name: Shot) {
	shot = name;
	fixture.traversal.reset();
	fixture.photo.cancel();
	fixture.boardwalk.cancel();
	input.releaseAll();
	notice = '';
	player.camera.pitch = -0.18;
	player.camera.zoomGoal = 8;
	let spawn = fixture.ladder.spec.base;
	if (name === 'ladder') {
		fixture.ladder.cooldown = 0;
		spawn = { x: 0, y: 0, z: -0.45 };
	}
	if (name === 'zipline') spawn = fixture.zipline.spec.start;
	if (name === 'photo') {
		spawn = { x: 32, y: 0, z: -3 };
		player.camera.pitch = 0;
	}
	if (name === 'bridge') spawn = { x: -12, y: 3, z: -0.6 };
	if (name === 'canoe') spawn = fixture.canoe.spec.landings[0].exit;
	if (name === 'trap') spawn = { x: 39, y: 0, z: -1 };
	if (name === 'boardwalk') spawn = { x: -24, y: 4, z: 11 };
	player.character.teleport(spawn);
	player.camera.snapBehind(0);
	player.clock.reset();
	title.textContent = labels[name];
	hint.textContent = hints[name];
	for (const [key, b] of buttons) b.setAttribute('aria-pressed', String(key === name));
}
function contextualAction() {
	const p = player.character.position;
	if (distance(p, fixture.trapPosition) < 3) {
		if (fixture.trap.phase === 'unplaced') {
			fixture.trap.place(fixture.serial);
			notice = 'Câmera instalada · conclua outra missão.';
		} else if (fixture.trap.collect()) {
			discoveries.add(fixture.trap.species);
			notice = 'Foto dos muriquis revelada!';
		} else notice = 'A câmera aguarda outra missão.';
	} else if (fixture.boardwalk.action(p, fixture.reducedMotion)) {
		fixture.complete('lookout');
		notice = 'Olhe a floresta do alto.';
	} else if (fixture.photo.validCount > 0 || fixture.photo.phase === 'framing') {
		const phase = fixture.photo.action();
		if (phase === 'saved') {
			for (let i = 0; i < fixture.photo.savedCount; i++) {
				const s = fixture.photo.saved[i];
				if (s) discoveries.add(s.species);
			}
			fixture.complete('photo');
			notice = `${fixture.photo.savedCount} espécies registradas no Guia da Mata.`;
		} else notice = 'Enquadre os anéis e use a ação para fotografar.';
	}
	guide.textContent = `Guia da Mata · ${discoveries.size ? Array.from(discoveries, (id) => speciesLabels[id] ?? id).join(' · ') : 'nenhuma descoberta ainda'}`;
}
function renderFrame(dt: number) {
	const frameInput = input.sample(dt);
	if (frameInput.actionPressed) contextualAction();
	const frame = player.update(dt, frameInput, lens);
	elapsed += dt;
	fixture.update();
	avatar.root.position.copy(frame.position);
	avatar.root.rotation.y = frame.yaw;
	const mode = fixture.traversal.mode;
	// Neutral block proxy only; production climb/sit/hang/row belongs to animation/.
	armLeft.rotation.x = armRight.rotation.x = mode === 'zipline' ? Math.PI : mode === 'ladder' ? -1.8 : 0;
	legLeft.rotation.x = legRight.rotation.x = mode === 'canoe' ? -Math.PI / 2 : 0;
	avatar.root.visible = fixture.photo.phase !== 'framing';
	applyCameraPose(camera, frame.pose);
	if (fixture.photo.phase === 'framing') {
		photoPosition.copy(frame.position);
		photoPosition.y += 2.7;
		camera.position.copy(photoPosition);
	}
	const lookout = fixture.boardwalk.lookout;
	if (lookout) {
		camera.position.lerp(lookout.camera, fixture.boardwalk.blend);
		lookTarget.copy(frame.pose.focus).lerp(lookout.target, fixture.boardwalk.blend);
		camera.lookAt(lookTarget);
	}
	fixture.photoMesh.root.visible = fixture.photo.phase === 'framing';
	fixture.photoMesh.root.position.copy(frame.position);
	fixture.photoMesh.root.position.y += 2.3;
	projection.evaluate(fixture.photo, camera);
	reticle.style.display = fixture.photo.phase === 'framing' ? 'block' : 'none';
	for (let i = 0; i < rings.length; i++) {
		const r = rings[i];
		r.hidden = fixture.photo.phase !== 'framing' || !fixture.photo.valid[i];
		if (!r.hidden) {
			r.style.left = `${(fixture.photo.screenX[i] + 1) * 50}%`;
			r.style.top = `${(1 - fixture.photo.screenY[i]) * 50}%`;
		}
	}
	let label = 'Interagir · E';
	if (mode === 'ladder') label = 'Subir / descer';
	else if (mode === 'zipline') label = 'Aproveite a vista';
	else if (mode === 'canoe') label = 'Desembarcar · E';
	else if (shot === 'canoe') label = 'Embarcar · E';
	else if (shot === 'zipline') label = 'Deslizar · E';
	else if (shot === 'trap')
		label =
			fixture.trap.phase === 'unplaced'
				? 'Instalar câmera · E'
				: fixture.trap.phase === 'ready'
					? 'Revelar foto · E'
					: 'Aguardando missão';
	else if (shot === 'boardwalk') label = 'Observar · E';
	else if (shot === 'photo') label = fixture.photo.phase === 'framing' ? 'Fotografar · E' : 'Enquadrar · E';
	if (label !== lastAction) {
		action.textContent = label;
		lastAction = label;
	}
	const text =
		notice ||
		`${mode === 'walk' ? 'Caminhando' : mode === 'ladder' ? 'Subindo' : mode === 'zipline' ? 'Deslizando' : 'Remando'}${fixture.reducedMotion ? ' · movimento reduzido' : ''}`;
	if (text !== lastStatus) {
		status.textContent = text;
		lastStatus = text;
	}
	if (player.character.position.y < -5) {
		select(shot);
	}
	renderer.render(scene, camera);
}
function resize() {
	renderer.setSize(app.clientWidth, app.clientHeight);
	camera.aspect = app.clientWidth / app.clientHeight;
	lens.aspect = camera.aspect;
	camera.updateProjectionMatrix();
}
function animate(now: number) {
	const dt = Math.min(0.1, (now - last) / 1000);
	last = now;
	renderFrame(dt);
	raf = requestAnimationFrame(animate);
}
function motion() {
	fixture.reducedMotion = query.has('reduced') || reduced.matches;
}
function visibility() {
	player.resume();
	last = performance.now();
}
resize();
window.addEventListener('resize', resize);
reduced.addEventListener('change', motion);
document.addEventListener('visibilitychange', visibility);
select(shots.includes(query.get('shot') as Shot) ? (query.get('shot') as Shot) : 'ladder');
renderFrame(0);
if (!manual) raf = requestAnimationFrame(animate);
const api = {
	select,
	step(frames = 1) {
		for (let i = 0; i < frames; i++) renderFrame(1 / 60);
	},
	action() {
		input.tapButton('action');
	},
	state() {
		return {
			shot,
			mode: fixture.traversal.mode,
			position: player.character.position.toArray(),
			ladder: fixture.ladder.phase,
			zipline: fixture.zipline.phase,
			zipSpeed: fixture.zipline.speed,
			bridgeSway: Array.from(fixture.bridge.offsets),
			canoe: fixture.canoe.phase,
			photo: fixture.photo.phase,
			valid: fixture.photo.validCount,
			saved: fixture.photo.savedCount,
			trap: fixture.trap.phase,
			lookout: fixture.boardwalk.phase,
			reduced: fixture.reducedMotion,
			discoveries: Array.from(discoveries),
			draws: renderer.info.render.calls,
			triangles: renderer.info.render.triangles,
			elapsed
		};
	},
	render: renderFrame
};
Object.assign(window, { __mechanics: api });
window.addEventListener(
	'pagehide',
	() => {
		cancelAnimationFrame(raf);
		detach();
		fixture.dispose();
		avatar.dispose();
		renderer.dispose();
		window.removeEventListener('resize', resize);
		reduced.removeEventListener('change', motion);
		document.removeEventListener('visibilitychange', visibility);
	},
	{ once: true }
);
