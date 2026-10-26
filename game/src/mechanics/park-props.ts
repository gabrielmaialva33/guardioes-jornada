import {
	BufferGeometry,
	CanvasTexture,
	Float32BufferAttribute,
	Group,
	type Material,
	Mesh,
	MeshLambertMaterial,
	type Object3D,
	Sprite,
	SpriteMaterial,
	SRGBColorSpace
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { AnimalAnimator, AnimalMotion, SPECIES, type SpeciesId } from '../animation/animals/index.ts';
import { applyToRig } from '../animation/rig.ts';
import { DEFAULT_AVATAR } from '../avatar/catalog.ts';
import { LIFE_ASSETS } from '../life/assets.ts';
import { loadPaletteTexture } from '../life/create.ts';
import { bakePet, createPet } from '../life/pets.ts';
import { houseMaterial } from '../render/index.ts';
import { disposeModel, loadAvatar, loadModel } from '../scene/avatar.ts';
import { MechanicMesh } from './meshes.ts';
import { type ParkRuntime, parkBoxes } from './park-runtime.ts';

const files = import.meta.glob<string>(
	[
		'../assets/models/custom-casa-iara.glb',
		'../assets/models/custom-polia-tirolesa.glb',
		'../assets/models/custom-passarela-deck-livre.glb',
		'../assets/models/custom-passarela-guarda.glb',
		'../assets/models/custom-marco-trilha.glb',
		'../assets/models/custom-marco-trilha-tronco.glb',
		'../assets/models/custom-semente-jequitiba.glb',
		'../assets/models/custom-semente-paubrasil.glb'
	],
	{ eager: true, query: '?url', import: 'default' }
);
/** Bake the small opaque prop set into one draw: no material group per source mesh. */
function batch(root: Object3D, material: MeshLambertMaterial) {
	root.updateWorldMatrix(true, true);
	const cells = new Map<string, BufferGeometry[]>();
	root.traverse((o) => {
		if (!(o instanceof Mesh)) return;
		const p = o.geometry.getAttribute('position'),
			n = o.geometry.getAttribute('normal'),
			c = o.geometry.getAttribute('color');
		const g = new BufferGeometry(),
			positions = [],
			normals = [],
			colors = [];
		const m = Array.isArray(o.material) ? o.material[0] : o.material;
		const color = 'color' in m ? (m as MeshLambertMaterial).color : material.color;
		const idx = o.geometry.index;
		for (let i = 0; i < (idx?.count ?? p.count); i++) {
			const j = idx ? idx.getX(i) : i;
			positions.push(p.getX(j), p.getY(j), p.getZ(j));
			normals.push(n?.getX(j) ?? 0, n?.getY(j) ?? 1, n?.getZ(j) ?? 0);
			colors.push((c?.getX(j) ?? 1) * color.r, (c?.getY(j) ?? 1) * color.g, (c?.getZ(j) ?? 1) * color.b);
		}
		g.setAttribute('position', new Float32BufferAttribute(positions, 3));
		g.setAttribute('normal', new Float32BufferAttribute(normals, 3));
		g.setAttribute('color', new Float32BufferAttribute(colors, 3));
		g.applyMatrix4(o.matrixWorld);
		g.computeBoundingBox();
		const key = 'park';
		const list = cells.get(key) ?? [];
		list.push(g);
		cells.set(key, list);
	});
	const result = new Group();
	for (const list of cells.values()) {
		const geometry = mergeGeometries(list);
		for (const g of list) g.dispose();
		if (!geometry) continue;
		const mesh = new Mesh(geometry, material);
		mesh.castShadow = mesh.receiveShadow = true;
		result.add(mesh);
	}
	return result;
}
/** The two stationary NPCs share the avatar atlas, with one draw per material instead of per limb. */
function staticAvatar(model: Group) {
	const parts = new Map<Material, BufferGeometry[]>();
	model.updateWorldMatrix(true, true);
	model.traverse((o) => {
		if (!(o instanceof Mesh)) return;
		for (let a: Object3D | null = o; a; a = a.parent) if (!a.visible) return;
		const mat = Array.isArray(o.material) ? o.material[0] : o.material;
		const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
		g.applyMatrix4(o.matrixWorld);
		for (const key of Object.keys(g.attributes))
			if (!['position', 'normal', 'uv', 'color'].includes(key)) g.deleteAttribute(key);
		const list = parts.get(mat) ?? [];
		list.push(g);
		parts.set(mat, list);
	});
	const group = new Group();
	for (const [mat, list] of parts) {
		const geometry = mergeGeometries(list);
		for (const g of list) g.dispose();
		if (geometry) {
			const mesh = new Mesh(geometry, mat);
			mesh.castShadow = mesh.receiveShadow = true;
			group.add(mesh);
		}
	}
	return group;
}
export async function loadParkProps(park: ParkRuntime, signal: AbortSignal) {
	const object = new Group(),
		statics = new Group(),
		sources = new Group(),
		models = new Map<string, Group>(),
		procedural = new MechanicMesh();
	const npcMeshes: Group[] = [];
	const birdDisposers: (() => void)[] = [];
	const owned: Group[] = [],
		npcs: Awaited<ReturnType<typeof loadAvatar>>[] = [],
		sprites: Sprite[] = [];
	const material = houseMaterial(new MeshLambertMaterial({ vertexColors: true })) as MeshLambertMaterial;
	const actData = park.level.act1;
	if (!actData) throw Error('act1');
	const act = actData;
	function dispose() {
		for (const dispose of birdDisposers) dispose();
		for (const g of owned)
			g.traverse((o) => {
				if (o instanceof Mesh) o.geometry.dispose();
			});
		for (const s of sprites) {
			s.material.map?.dispose();
			s.material.dispose();
		}
		for (const n of npcs) n.dispose();
		disposeModel(sources);
		procedural.dispose();
		material.dispose();
		object.removeFromParent();
	}
	function label(text: string, x: number, y: number, z: number) {
		const canvas = document.createElement('canvas');
		canvas.width = 512;
		canvas.height = 96;
		const ctx = canvas.getContext('2d');
		if (!ctx) return;
		ctx.fillStyle = '#f7ebc7';
		ctx.fillRect(0, 0, 512, 96);
		ctx.strokeStyle = '#4a613b';
		ctx.lineWidth = 8;
		ctx.strokeRect(4, 4, 504, 88);
		ctx.fillStyle = '#293d2c';
		ctx.font = 'bold 29px sans-serif';
		ctx.textAlign = 'center';
		ctx.fillText(text, 256, 59, 480);
		const map = new CanvasTexture(canvas);
		map.colorSpace = SRGBColorSpace;
		const s = new Sprite(new SpriteMaterial({ map, depthTest: true }));
		s.position.set(x, y, z);
		s.scale.set(4.5, 0.84, 1);
		object.add(s);
		sprites.push(s);
	}
	try {
		const loads = await Promise.allSettled(
			Object.entries(files).map(async ([path, url]) => {
				const model = await loadModel(url, signal);
				sources.add(model);
				models.set(path.split('/').at(-1)?.replace('custom-', '').replace('.glb', '') ?? '', model);
			})
		);
		for (const r of loads) if (r.status === 'rejected') throw r.reason;
		const place = (name: string, x: number, y: number, z: number, yaw = 0, parent = statics) => {
			const template = models.get(name);
			if (!template) throw Error(name);
			const model = template.clone(true);
			model.position.set(x, y, z);
			model.rotation.y = yaw;
			parent.add(model);
			return model;
		};
		// Position the P26 ladder-base node on the authored bottom; the model faces out.
		const l = act.treehouse.ladder,
			yaw = l.yaw + Math.PI;
		place(
			'casa-iara',
			l.bottom.x - Math.sin(yaw) * 2.65,
			l.top.y - 6,
			l.bottom.z - Math.cos(yaw) * 2.65,
			yaw
		);
		// Keep authored deck extents/rails exact. P26 tiles supply the visible plank surfaces.
		for (const d of act.decks)
			if (d.id !== act.treehouse.deck.id) {
				for (let x = d.x0 + 1; x < d.x1; x += 2)
					for (let z = d.z0 + 1; z < d.z1; z += 2) place('passarela-deck-livre', x, d.y - 4, z);
			}
		for (const d of act.decks)
			if (d.id !== act.treehouse.deck.id)
				for (const r of d.rails) {
					const length = Math.hypot(r.x1 - r.x0, r.z1 - r.z0),
						yaw = Math.atan2(r.x1 - r.x0, r.z1 - r.z0),
						scale = Math.min(r.height / 1.4, length / 2),
						size = 2 * scale;
					const count = Math.ceil(length / size);
					for (let i = 0; i < count; i++) {
						const along = Math.min(length - size / 2, size * (i + 0.5)),
							x = r.x0 + Math.sin(yaw) * along,
							z = r.z0 + Math.cos(yaw) * along;
						const model = place(
							'passarela-guarda',
							x - Math.cos(yaw) * scale * 0.9,
							r.y - 4 * scale,
							z + Math.sin(yaw) * scale * 0.9,
							yaw
						);
						model.scale.setScalar(scale);
					}
				}
		for (const b of parkBoxes(park.level, park.world)) {
			if (
				act.decks.some((d) =>
					d.rails.some(
						(r) =>
							Math.abs(b.x - (r.x0 + r.x1) / 2) < 0.001 &&
							Math.abs(b.z - (r.z0 + r.z1) / 2) < 0.001 &&
							Math.abs(b.sy - r.height) < 0.001
					)
				)
			)
				continue;
			// The treehouse GLB already has its full deck and rails; physics extends .3 u past it.
			if (Math.abs(b.x - act.treehouse.tree.x) < 3 && Math.abs(b.z - act.treehouse.tree.z) < 3) continue;
			const m = procedural.box(b.x, b.y, b.z, b.sx, b.sy, b.sz, 0x9a6e46);
			m.rotation.y = b.yaw;
		}
		const zip = act.zipline;
		procedural.beam(
			{ ...zip.start, y: zip.start.y + zip.cableAbove },
			{ ...zip.end, y: zip.end.y + zip.cableAbove },
			0.045,
			0x42504b
		);
		for (const p of [zip.start, zip.end]) {
			procedural.box(p.x, p.y + 2, p.z + 1.7, 0.25, 4, 0.25);
			procedural.box(p.x, p.y + 3.8, p.z, 0.2, 0.2, 3.6);
		}
		for (const m of act.marks)
			place(
				m.on === 'post' ? 'marco-trilha' : 'marco-trilha-tronco',
				m.x,
				m.y + (m.on === 'trunk' ? m.height - 0.35 : 0),
				m.z,
				Math.atan2(m.yawS, m.yawC)
			);
		const birdIds: Record<string, SpeciesId> = {
			tucano: 'tucano-de-bico-verde',
			saira: 'saira-sete-cores',
			sabia: 'sabia-laranjeira'
		};
		for (const b of act.birds) {
			const id = birdIds[b.species];
			if (!id) continue;
			const model = await loadModel(LIFE_ASSETS.models[SPECIES[id].model], signal);
			sources.add(model);
			const url = LIFE_ASSETS.attachments[id];
			const attachment = url ? await loadModel(url, signal) : null;
			if (attachment) sources.add(attachment);
			const palette = await loadPaletteTexture(LIFE_ASSETS.palettes[id], signal);
			birdDisposers.push(() => {
				palette.dispose();
				const image = palette.image;
				if (image instanceof ImageBitmap) image.close();
			});
			const template = bakePet(id, model, attachment, palette),
				pet = createPet(template);
			birdDisposers.push(() => {
				pet.dispose();
				template.geometry.dispose();
				template.material.dispose();
			});
			const animator = new AnimalAnimator(id),
				motion = new AnimalMotion();
			motion.posture = 'perch';
			for (let i = 0; i < 90; i++) {
				motion.beginUpdate();
				animator.update(1 / 60, motion);
			}
			applyToRig(animator.pose, pet.rig.binding);
			pet.group.position.set(b.x, b.y, b.z);
			pet.group.scale.setScalar(SPECIES[id].scale);
			pet.group.updateMatrix();
			for (const bone of pet.bones) bone.updateMatrix();
			object.add(pet.group);
			procedural.box(b.x, b.y - 0.08, b.z, 2, 0.12, 0.16, 0x795133);
		}
		statics.add(procedural.root);
		const fixed = batch(statics, material);
		owned.push(fixed);
		object.add(fixed);
		const seedMeshes = act.seeds.map((s) => {
			const raw = new Group();
			place(s.species === 'pau-brasil' ? 'semente-paubrasil' : 'semente-jequitiba', s.x, s.y, s.z, 0, raw);
			const baked = batch(raw, material);
			owned.push(baked);
			object.add(baked);
			return baked;
		});
		const gateMeshes = (park.level.portals ?? [park.level.portal]).map((p) => {
			const m = new MechanicMesh();
			const a = p.gate.from,
				b = p.gate.to;
			for (const y of [0.6, 1.4, 2.2]) m.beam({ ...a, y: a.y + y }, { ...b, y: b.y + y }, 0.1, 0xc0a06c);
			const baked = batch(m.root, material);
			m.dispose();
			owned.push(baked);
			object.add(baked);
			label(`${p.sign.label} · missão ${p.mission}`, p.sign.x, p.sign.y + 2.5, p.sign.z);
			return baked;
		});
		const pulleyRaw = new Group();
		place('polia-tirolesa', 0, 0, 0, 0, pulleyRaw).scale.setScalar(0.7);
		const grip = new MechanicMesh();
		grip.box(0, 0.042, 0, 1.6, 0.08, 0.08, 0x42504b);
		pulleyRaw.add(grip.root);
		const pulley = batch(pulleyRaw, material);
		grip.dispose();
		owned.push(pulley);
		object.add(pulley);
		for (const n of act.npcs) {
			const npc = await loadAvatar(signal, {
				...DEFAULT_AVATAR,
				colors: { ...DEFAULT_AVATAR.colors, shirt: n.id === 'ana' ? '#397658' : '#c4934f' }
			});
			npcs.push(npc);
			const mesh = staticAvatar(npc.model);
			owned.push(mesh);
			npcMeshes.push(mesh);
			mesh.position.set(n.x, n.y, n.z);
			mesh.rotation.y = Math.atan2(n.yawS, n.yawC);
			object.add(mesh);
			label(n.name, n.x, n.y + 3.5, n.z);
		}
		label('Casa da Iara · suba pela escada', l.bottom.x - 3, l.bottom.y + 2.5, l.bottom.z + 1);
		signal.throwIfAborted();
		function update() {
			park.sync();
			for (let i = 0; i < seedMeshes.length; i++)
				seedMeshes[i].visible =
					!park.story.data.gatheredSeeds.includes(act.seeds[i].id) &&
					Math.hypot(act.seeds[i].x - park.eye.x, act.seeds[i].z - park.eye.z) < 38;
			for (let i = 0; i < gateMeshes.length; i++) gateMeshes[i].visible = park.gates[i].enabled;
			const p = park.zipline.position;
			pulley.position.set(p.x, p.y + zip.cableAbove - 1.11 * 0.7, p.z);
			pulley.rotation.y = Math.atan2(zip.end.x - zip.start.x, zip.end.z - zip.start.z);
			// Cull NPCs and labels by distance; static geometry keeps spatial frustum culling.
			const eye = park.eye;
			for (const n of npcMeshes) n.visible = n.position.distanceToSquared(eye) < 65 * 65;
			for (const s of sprites) s.visible = s.position.distanceToSquared(eye) < 35 * 35;
		}
		update();
		return { object, update, sync: update, dispose };
	} catch (error) {
		dispose();
		throw error;
	}
}
