/**
 * Browser half of avatar-sheet.ts: loads avatar.glb (and the v3 hair nodes of
 * avatar-hair.glb), drives an AvatarAnimator through every P10 state and
 * gesture, and draws 4 phases of each into one labelled 2D canvas.
 *
 * The hair rows use avatar-hair.glb's v3 dangling nodes (tail, braids, bun
 * knot), rotated by HairSway's angles as the runtime would after applyToRig.
 */
import {
	AmbientLight,
	BoxGeometry,
	DirectionalLight,
	type Group,
	Mesh,
	MeshLambertMaterial,
	type Object3D,
	PerspectiveCamera,
	Scene,
	WebGLRenderer
} from 'three';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import {
	AvatarAnimator,
	type AvatarInput,
	CONTEXT,
	createAvatarInput
} from '../src/animation/avatar-animator.ts';
import { EMOTES, type EmoteId } from '../src/animation/avatar-poses.ts';
import { AVATAR_LAYOUT, BLOCKY_RIG } from '../src/animation/joints.ts';
import { applyToRig, bindRig } from '../src/animation/rig.ts';
import { AVATAR_HEIGHT, WALK_SPEED } from '../src/engine/constants.ts';

declare global {
	interface Window {
		sheet?: { png: string; rows: number } | { error: string };
	}
}

const TILE_W = 220;
const TILE_H = 260;
const LABEL_W = 210;
const HEADER_H = 30;
const DT = 1 / 240;
const DEG = Math.PI / 180;

type HairRow = 'rabo' | 'trancas' | 'coque';
const HAIR_NODES: Record<HairRow, string> = {
	rabo: 'hair-ponytail',
	trancas: 'hair-braids',
	coque: 'hair-bun'
};

interface Row {
	label: string;
	note: string;
	/** Camera yaw around the avatar (0: in front). */
	view: number;
	/** The hair style shown (its real GLB node and dangling children), if any. */
	hair?: HairRow;
	/** Sets up the animator and returns the 4 captures as functions that advance it. */
	run(animator: AvatarAnimator, capture: (caption: string) => void): void;
}

const advance = (animator: AvatarAnimator, input: AvatarInput, seconds: number) => {
	for (let t = 0; t < seconds; t += DT) animator.update(DT, input);
};

/** Captures at the 4 quarter points of the walk cycle. */
function cycle(input: AvatarInput) {
	return (animator: AvatarAnimator, capture: (caption: string) => void) => {
		advance(animator, input, 2);
		for (const quarter of [0, 0.25, 0.5, 0.75]) {
			let guard = 0;
			const distance = () => (animator.phase - quarter + 1) % 1;
			while (distance() > 0.02 && guard++ < 2000) animator.update(DT, input);
			capture(`fase ${quarter.toFixed(2)}`);
		}
	};
}

/** Captures at 4 moments of a gesture, from its start. */
function gesture(
	id: EmoteId,
	times: readonly number[],
	point: { x: number; y: number; z: number } | null = null,
	overrides: Partial<AvatarInput> = {}
) {
	return (animator: AvatarAnimator, capture: (caption: string) => void) => {
		const input = Object.assign(createAvatarInput(), overrides);
		advance(animator, input, 1);
		animator.playGesture(id, point);
		let elapsed = 0;
		for (const time of times) {
			advance(animator, input, time - elapsed);
			elapsed = time;
			capture(`t ${time.toFixed(2)} s`);
		}
	};
}

/** Captures every `step` seconds after settling. */
function still(input: AvatarInput, step: number, settle = 1.5) {
	return (animator: AvatarAnimator, capture: (caption: string) => void) => {
		advance(animator, input, settle);
		for (let i = 0; i < 4; i++) {
			if (i > 0) advance(animator, input, step);
			capture(`t ${(settle + i * step).toFixed(2)} s`);
		}
	};
}

const walk = (overrides: Partial<AvatarInput>) =>
	Object.assign(createAvatarInput(), { speed: WALK_SPEED, intent: 1 }, overrides);

const ROWS: Row[] = [
	{
		label: 'narrow: walk',
		note: 'pedras/ponte: braços abertos, passo curto',
		view: 0.5,
		run: cycle(walk({ surface: 'narrow' }))
	},
	{
		label: 'narrow: still',
		note: 'parado na pedra: balanço',
		view: 0,
		run: still(Object.assign(createAvatarInput(), { surface: 'narrow' }), 1 / (4 * CONTEXT.wobbleHz))
	},
	{ label: 'water: wade', note: 'água rasa: joelho alto', view: 1.4, run: cycle(walk({ surface: 'water' })) },
	{
		label: 'slope: uphill',
		note: 'subida 20°: inclina à frente',
		view: 1.5,
		run: cycle(walk({ slope: 20 * DEG }))
	},
	{ label: 'slope: downhill', note: 'descida 20°: freia', view: 1.5, run: cycle(walk({ slope: -20 * DEG })) },
	{
		label: 'teeter',
		note: 'borda a 0,3 u: gira os braços',
		view: 1.2,
		run: still(Object.assign(createAvatarInput(), { edgeAhead: 0.3 }), 1 / (4 * CONTEXT.teeterHz), 1)
	},
	{
		label: 'pickup',
		note: 'pega o item em (0,4; 0,2; 0,8): afundo R6, vista de lado',
		view: 1.57,
		run: gesture('pickup', [0.12, 0.22, 0.4, 0.55], { x: 0.4, y: 0.2, z: 0.8 })
	},
	{
		label: 'talk',
		note: 'diálogo aberto com a Iara (talking): um gesto a cada 1,2 s, mãos alternadas',
		view: 0.4,
		run: gesture('talk', [0.3, 0.75, 1.5, 1.95], null, { talking: true })
	},
	{ label: 'binoculars', note: 'mirante', view: 0.5, run: gesture('binoculars', [0.45, 1.3, 2.4, 3.0]) },
	{
		label: 'pet',
		note: 'carinho no mico em (0,1; 0,45; 1,05)',
		view: 1.2,
		run: gesture('pet', [0.4, 0.9, 1.3, 1.7], { x: 0.1, y: 0.45, z: 1.05 })
	},
	{
		label: 'cheer',
		note: 'missão completa',
		view: 0.3,
		run: gesture('cheer', [0.15, 0.4, 0.7, EMOTES.cheer.period - 0.3])
	},
	...(['rabo', 'trancas', 'coque'] as const).map(
		(style): Row => ({
			label: `hair: ${style}`,
			note: 'para de correr: a parte solta balança (nós v3 reais)',
			view: 1.5,
			hair: style,
			run: (animator, capture) => {
				animator.hairStyle = style;
				// Really moving (the head's acceleration comes from the feet too), then a sudden stop.
				const running = walk({ speed: WALK_SPEED * 2.2 });
				for (let t = 0; t < 2; t += DT) {
					running.z += running.speed * DT;
					animator.update(DT, running);
				}
				const stop = Object.assign(createAvatarInput(), { z: running.z });
				for (const time of [0, 0.12, 0.3, 0.55]) {
					advance(animator, stop, time === 0 ? 0 : time === 0.12 ? 0.12 : time === 0.3 ? 0.18 : 0.25);
					capture(`parada +${time.toFixed(2)} s · ${(animator.hair.pitch / DEG).toFixed(0)}°`);
				}
			}
		})
	)
];

async function main() {
	const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
	const [avatar, hair] = await Promise.all([
		loader.loadAsync('/avatar.glb'),
		loader.loadAsync('/avatar-hair.glb')
	]);
	const renderer = new WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
	renderer.setPixelRatio(1);
	renderer.setSize(TILE_W, TILE_H);
	renderer.setClearColor(0x1d3328);
	const scene = new Scene();
	scene.add(new AmbientLight(0xffffff, 1.6));
	const sun = new DirectionalLight(0xffffff, 2.2);
	sun.position.set(3, 6, 4);
	scene.add(sun);
	const ground = new Mesh(new BoxGeometry(3, 0.04, 3), new MeshLambertMaterial({ color: 0x4f6b46 }));
	ground.position.y = -0.02;
	scene.add(ground);

	const model: Group = avatar.scene;
	model.scale.setScalar(AVATAR_HEIGHT / (BLOCKY_RIG.height ?? 2.7));
	scene.add(model);
	const rig = bindRig(model, AVATAR_LAYOUT, BLOCKY_RIG);
	const head = model.getObjectByName('head');
	// The v3 hair nodes on the head, tinted like the runtime does; the dangles are their children.
	const hairMaterial = new MeshLambertMaterial({ color: 0x5e4330, vertexColors: true, flatShading: true });
	const hairNodes = new Map<HairRow, { node: Object3D; dangles: Object3D[] }>();
	for (const [style, name] of Object.entries(HAIR_NODES) as [HairRow, string][]) {
		const node = hair.scene.getObjectByName(name);
		if (!node || !head) throw new Error(`missing ${name} or head`);
		head.add(node);
		node.position.set(0, 0, 0);
		node.traverse((child) => {
			if (child instanceof Mesh) child.material = hairMaterial;
		});
		node.visible = false;
		const dangles = node.children.filter((child) => child instanceof Mesh);
		for (const dangle of dangles) dangle.rotation.order = 'YXZ';
		hairNodes.set(style, { node, dangles });
	}

	const camera = new PerspectiveCamera(30, TILE_W / TILE_H, 0.1, 50);
	const sheet = document.createElement('canvas');
	sheet.width = LABEL_W + TILE_W * 4;
	sheet.height = HEADER_H + TILE_H * ROWS.length;
	const ink = sheet.getContext('2d');
	if (!ink) throw new Error('no 2d context');
	ink.fillStyle = '#12201a';
	ink.fillRect(0, 0, sheet.width, sheet.height);
	ink.fillStyle = '#e8f2ea';
	ink.font = '600 15px sans-serif';
	ink.fillText('P10b avatar animation: every new state/gesture at 4 phases', 10, 20);

	ROWS.forEach((row, index) => {
		const animator = new AvatarAnimator({ seed: 7 });
		for (const [style, { node }] of hairNodes) node.visible = style === row.hair;
		const dangles = row.hair ? (hairNodes.get(row.hair)?.dangles ?? []) : [];
		const distance = 8.6;
		camera.position.set(Math.sin(row.view) * distance, 2.4, Math.cos(row.view) * distance);
		camera.lookAt(0, 1.25, 0);
		const top = HEADER_H + index * TILE_H;
		ink.fillStyle = '#e8f2ea';
		ink.font = '600 16px sans-serif';
		ink.fillText(row.label, 10, top + 30);
		ink.font = '13px sans-serif';
		ink.fillStyle = '#b9c9bf';
		wrap(ink, row.note, 10, top + 52, LABEL_W - 20);
		let column = 0;
		row.run(animator, (caption) => {
			applyToRig(animator.pose, rig);
			model.position.set(0, 0, 0);
			model.rotation.set(0, 0, 0);
			for (const dangle of dangles) dangle.rotation.set(animator.hair.pitch, 0, animator.hair.roll, 'YXZ');
			renderer.render(scene, camera);
			const left = LABEL_W + column * TILE_W;
			ink.drawImage(renderer.domElement, left, top);
			ink.strokeStyle = '#12201a';
			ink.strokeRect(left + 0.5, top + 0.5, TILE_W - 1, TILE_H - 1);
			ink.fillStyle = '#e8f2ea';
			ink.font = '12px sans-serif';
			ink.fillText(caption, left + 8, top + TILE_H - 10);
			column++;
		});
	});
	window.sheet = { png: sheet.toDataURL('image/png'), rows: ROWS.length };
}

function wrap(ink: CanvasRenderingContext2D, text: string, x: number, y: number, width: number) {
	let line = '';
	for (const word of text.split(' ')) {
		const next = line ? `${line} ${word}` : word;
		if (ink.measureText(next).width > width && line) {
			ink.fillText(line, x, y);
			line = word;
			y += 17;
		} else line = next;
	}
	ink.fillText(line, x, y);
}

main().catch((error: unknown) => {
	window.sheet = { error: error instanceof Error ? (error.stack ?? error.message) : String(error) };
});
