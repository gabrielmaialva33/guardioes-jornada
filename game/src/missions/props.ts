import {
	type BufferGeometry,
	Group,
	type Material,
	Mesh,
	MeshLambertMaterial,
	RingGeometry,
	Shape,
	ShapeGeometry
} from 'three';
import { AvatarAnimator, createAvatarInput } from '../animation/avatar-animator.ts';
import { AVATAR_LAYOUT, BLOCKY_RIG } from '../animation/joints.ts';
import { applyToRig, bindRig } from '../animation/rig.ts';
import iaraPalette from '../assets/skins/palette-iara.png?url';
import type { StoryLevel } from '../level/types.ts';
import { IaraLife } from '../life/index.ts';
import { houseMaterial } from '../render/index.ts';
import { stylize } from '../render/stylized.ts';
import { disposeModel, loadAvatar, loadModel } from '../scene/avatar.ts';
import { ensureVertexColors } from '../scene/materials.ts';
import type { Crossing } from '../survival/types.ts';
import type { StoryGame } from './story.ts';

const files = import.meta.glob<string>(
	[
		'../assets/models/custom-viveiro.glb',
		'../assets/models/custom-placa-trilha-da-reserva.glb',
		'../assets/models/custom-radio.glb',
		'../assets/models/custom-cacho-jucara.glb',
		'../assets/models/custom-muda-etapa-1.glb',
		'../assets/models/custom-muda-etapa-2.glb',
		'../assets/models/custom-muda-etapa-3.glb',
		'../assets/models/custom-bandeira-marcacao.glb',
		'../assets/models/custom-lixo-garrafa.glb',
		'../assets/models/custom-lixo-lata.glb',
		'../assets/models/custom-lixo-saco.glb',
		'../assets/models/custom-pedra-observacao.glb',
		'../assets/models/custom-toco-cortado.glb',
		'../assets/models/custom-pedra-rio-1.glb',
		'../assets/models/custom-pedra-rio-2.glb',
		'../assets/models/custom-pedra-rio-3.glb',
		'../assets/models/custom-degrau-rocha.glb',
		'../assets/models/custom-degrau-raiz.glb',
		'../assets/models/custom-degrau-tronco.glb',
		'../assets/models/custom-ponte-madeira.glb',
		'../assets/models/custom-arapuca.glb',
		'../assets/models/custom-laco.glb'
	],
	{ eager: true, query: '?url', import: 'default' }
);
/** Dynamic mission objects own visibility/growth; no gameplay rule depends on drawn meshes or materials. */
export async function loadStoryProps(
	level: StoryLevel,
	game: StoryGame,
	signal: AbortSignal,
	crossings: readonly Crossing[] = []
) {
	const object = new Group(),
		source = new Group(),
		models = new Map<string, Group>();
	let npc: Awaited<ReturnType<typeof loadAvatar>> | undefined;
	const ownGeometry: BufferGeometry[] = [];
	const ownMaterial: MeshLambertMaterial[] = [];
	try {
		const loads = await Promise.allSettled(
			Object.entries(files).map(async ([path, url]) => {
				const name = path.split('/').at(-1)?.replace('custom-', '').replace('.glb', '');
				if (!name) throw new Error('story-model-name');
				const model = await loadModel(url, signal);
				const converted = new Map<Material, Material>();
				model.traverse((node) => {
					if (node instanceof Mesh) {
						const convert = (old: Material) => {
							let m = converted.get(old);
							if (!m) {
								m = houseMaterial(old);
								converted.set(old, m);
							}
							return m;
						};
						node.material = Array.isArray(node.material)
							? node.material.map(convert)
							: convert(node.material);
					}
				});
				for (const material of converted.keys()) material.dispose();
				source.add(model);
				models.set(name, model);
			})
		);
		for (const load of loads) if (load.status === 'rejected') throw load.reason;
		const place = (kind: string, x: number, y: number, z: number, yaw = 0) => {
			const template = models.get(kind);
			if (!template) throw new Error(`story-model-missing:${kind}`);
			const model = template.clone(true);
			model.position.set(x, y, z);
			model.rotation.y = yaw;
			object.add(model);
			return model;
		};
		for (const landmark of level.landmarks) {
			const yaw = Math.atan2(landmark.yawS, landmark.yawC);
			const kind =
				landmark.kind === 'viveiro'
					? 'viveiro'
					: landmark.kind === 'trail-sign'
						? 'placa-trilha-da-reserva'
						: landmark.kind === 'observation-rock'
							? 'pedra-observacao'
							: landmark.kind === 'cutting'
								? 'toco-cortado'
								: null;
			if (kind) place(kind, landmark.x, landmark.y, landmark.z, yaw);
			if (landmark.kind === 'npc-iara') place('radio', landmark.x + 1.2, landmark.y + 0.6, landmark.z);
		}
		// Authored tops stay fixed; the visual asset is offset by its actual walkable top.
		for (const obby of level.obbies)
			for (const p of obby.pieces) {
				const kind =
					p.piece === 'stone'
						? `pedra-rio-${+p.variant + 1}`
						: p.variant === 'rock'
							? 'degrau-rocha'
							: p.variant === 'root'
								? 'degrau-raiz'
								: 'degrau-tronco';
				place(kind, p.x, p.y - (p.piece === 'stone' ? 0.6 : 0.9), p.z, Math.atan2(p.yawS, p.yawC));
			}
		const bridge = level.landmarks.find((l) => l.kind === 'bridge');
		if (bridge) {
			const model = place('ponte-madeira', 0, -0.96, 0);
			object.remove(model);
			const holder = new Group();
			holder.add(model);
			object.add(holder);
			// LEVEL's bridge endpoints; the data's heading already follows its longitudinal +z.
			holder.position.set(bridge.x, bridge.y, bridge.z);
			holder.rotation.y = Math.atan2(bridge.yawS, bridge.yawC);
			const crossing = crossings.find((c) => c.kind === 'bridge');
			if (crossing) {
				const length = Math.hypot(crossing.to.x - crossing.from.x, crossing.to.z - crossing.from.z);
				holder.scale.setScalar(length / 15.6);
				holder.rotation.set(
					-Math.atan2(crossing.to.y - crossing.from.y, length),
					Math.atan2(bridge.yawS, bridge.yawC),
					0,
					'YXZ'
				);
			}
		}
		const dynamic = new Map<string, Group>();
		const leafShape = new Shape();
		leafShape.moveTo(0, 0.55);
		leafShape.quadraticCurveTo(-0.5, 0.1, 0, -0.45);
		leafShape.quadraticCurveTo(0.5, 0.1, 0, 0.55);
		const leafGeometry = new ShapeGeometry(leafShape);
		ensureVertexColors(leafGeometry);
		ownGeometry.push(leafGeometry);
		const gold = stylize(
			new MeshLambertMaterial({ color: '#ffd166', vertexColors: true, flatShading: true })
		);
		ownMaterial.push(gold);
		for (const c of level.collectibles) {
			let model: Group;
			if (c.kind === 'gold-leaf') {
				model = new Group();
				const mesh = new Mesh(leafGeometry, gold);
				model.add(mesh);
				model.position.set(c.x, c.y + 0.7, c.z);
				object.add(model);
			} else
				model = place(
					c.kind === 'jucara-fruit'
						? 'cacho-jucara'
						: c.variant === 'bottle'
							? 'lixo-garrafa'
							: c.variant === 'can'
								? 'lixo-lata'
								: 'lixo-saco',
					c.x,
					c.y,
					c.z
				);
			dynamic.set(c.id, model);
		}
		const seedlings = new Map<string, Group[]>();
		const markerGeometry = new RingGeometry(0.5, 0.65, 12);
		ensureVertexColors(markerGeometry);
		ownGeometry.push(markerGeometry);
		for (const p of level.planting) {
			const stages = [1, 2, 3].map((stage) => place(`muda-etapa-${stage}`, p.x, p.y, p.z));
			seedlings.set(p.id, stages);
			const marker = new Mesh(markerGeometry, gold);
			marker.rotation.x = -Math.PI / 2;
			marker.position.set(p.x, p.y + 0.03, p.z);
			object.add(marker);
			const holder = new Group();
			holder.add(marker);
			dynamic.set(`plant:${p.id}`, holder);
			object.add(holder);
		}
		for (const [i, t] of level.triggers.filter((t) => t.kind === 'trap').entries()) {
			dynamic.set(`trap:${t.id}`, place(i % 2 ? 'laco' : 'arapuca', t.x, t.y, t.z));
			dynamic.set(`flag:${t.id}`, place('bandeira-marcacao', t.x + 1.5, t.y, t.z + 0.8));
		}
		npc = await loadAvatar(signal, {
			style: 'classic',
			hairStyle: 'bone',
			face: 'smile',
			kenneySkin: 'a',
			colors: { skin: '#8d5a3b', hair: '#2b1d14', shirt: '#2d6a4f', pants: '#4f5c55', shoes: '#5e4330' }
		});
		const response = await fetch(iaraPalette, { signal });
		if (!response.ok) throw new Error('iara-palette');
		const image = await createImageBitmap(await response.blob(), {
			imageOrientation: 'none',
			premultiplyAlpha: 'none'
		});
		if (signal.aborted) {
			image.close();
			signal.throwIfAborted();
		}
		const canvas = npc.appearance.texture.image;
		const context = canvas.getContext('2d');
		if (!context) {
			image.close();
			throw new Error('iara-palette-canvas');
		}
		context.clearRect(0, 0, 64, 64);
		context.drawImage(image, 0, 0, 64, 64);
		image.close();
		npc.appearance.texture.needsUpdate = true;
		const iara = level.landmarks.find((l) => l.kind === 'npc-iara');
		if (!iara) throw new Error('iara-missing');
		const actor = new Group();
		actor.position.set(iara.x, iara.y, iara.z);
		actor.rotation.y = Math.atan2(iara.yawS, iara.yawC);
		actor.add(npc.model);
		object.add(actor);
		const rig = bindRig(npc.model, AVATAR_LAYOUT, BLOCKY_RIG),
			animator = new AvatarAnimator(),
			input = createAvatarInput();
		const motion = matchMedia('(prefers-reduced-motion: reduce)');
		const iaraLife = new IaraLife({
			x: iara.x,
			y: iara.y,
			z: iara.z,
			yaw: actor.rotation.y,
			trail: { x: 42, z: 70 }
		});
		input.yaw = actor.rotation.y;
		input.x = iara.x;
		input.y = iara.y;
		input.z = iara.z;
		let lastRevision = -1,
			lastDialogue = '';
		function sync() {
			if (lastRevision === game.revision) return;
			lastRevision = game.revision;
			for (const c of level.collectibles) {
				const model = dynamic.get(c.id);
				if (model)
					model.visible =
						c.kind === 'jucara-fruit'
							? !game.data.fruits.includes(c.id)
							: !game.data.collected.includes(c.id) &&
								(c.kind !== 'gold-leaf' || (c.on !== '' ? game.available(3) : game.completed(c.mission)));
			}
			for (const [id, stages] of seedlings) {
				const stage = game.growthStage(id);
				stages.forEach((model, i) => {
					model.visible = i + 1 === stage;
				});
				const marker = dynamic.get(`plant:${id}`);
				if (marker) marker.visible = stage === 0;
			}
			for (const t of level.triggers.filter((t) => t.kind === 'trap')) {
				const trap = dynamic.get(`trap:${t.id}`),
					flag = dynamic.get(`flag:${t.id}`);
				if (trap) trap.visible = !game.data.reported.includes(t.id);
				if (flag) flag.visible = game.data.marked.includes(t.id);
			}
			const dialogue = game.dialogue?.id ?? '';
			if (dialogue && dialogue !== lastDialogue && game.dialogue?.speaker === 'Iara')
				animator.playEmote('wave');
			lastDialogue = dialogue;
		}
		sync();
		signal.throwIfAborted();
		const ownedNpc = npc;
		return {
			object,
			sync,
			update(dt: number) {
				sync();
				input.reducedMotion = motion.matches;
				const f = iaraLife.frame;
				f.dt = dt;
				f.playerX = game.position.x;
				f.playerY = game.position.y;
				f.playerZ = game.position.z;
				f.talking = game.dialogue?.speaker === 'Iara';
				f.busy = animator.state === 'emote';
				f.reducedMotion = input.reducedMotion;
				input.yaw = actor.rotation.y = iaraLife.yaw;
				applyToRig(iaraLife.update(animator.update(dt, input)), rig);
				actor.rotation.y = iaraLife.yaw;
			},
			dispose() {
				ownedNpc.dispose();
				disposeModel(source);
				for (const g of ownGeometry) g.dispose();
				for (const m of ownMaterial) m.dispose();
				object.removeFromParent();
				object.clear();
			}
		};
	} catch (error) {
		npc?.dispose();
		disposeModel(source);
		for (const g of ownGeometry) g.dispose();
		for (const m of ownMaterial) m.dispose();
		throw error;
	}
}
