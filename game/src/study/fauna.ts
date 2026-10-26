/**
 * The study fauna of the LOCAL-ONLY Green Hell study mode: the curated picks
 * of catalog.ts at their homes (herds.ts), each a skinned clone with its own
 * AnimationMixer playing its own clips (idle, walk, eat, alerted, run), and a
 * small behaviour that keeps it on its habitat and reacts to the child.
 *
 * - Loading: the served catalog (data.ts) gives each pick's GLB; it comes from
 *   the dev middleware (studyUrl), one template per species, stylized once
 *   (stylize.ts) and cloned with SkeletonUtils.
 * - Scale (ART.md §3): each species is scaled by HEIGHT, feet to the top of the
 *   silhouette measured on its idle pose, to the pick's `height` (×1.5 life
 *   size against the 3.0 u avatar), as our animals in animation/animals/species.ts.
 * - Root motion: the clips are made in-place (the linear drift of every position
 *   track removed); the drift measured first gives the clip's natural speed,
 *   so the walk plays at the rate that matches the ground speed.
 * - Facing: our convention is local +z forward. The forward of a model is the
 *   walk clip's drift, or head minus tail when the clip is in place.
 * - Budget: an animal is hidden beyond its `far` distance from the camera and
 *   its mixer runs at half rate beyond 45 u. update() allocates nothing.
 *
 * DEV only, behind the study gate (gate.ts; index.ts startStudy is the entry).
 */
import {
	type AnimationAction,
	type AnimationClip,
	AnimationMixer,
	type Bone,
	Box3,
	type Camera,
	Group,
	LoopOnce,
	LoopRepeat,
	type Material,
	Matrix4,
	type Object3D,
	type SkinnedMesh,
	Sphere,
	Texture,
	Vector3
} from 'three';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import type { StoryLevel } from '../level/types.ts';
import { GroundSampler } from '../life/ground.ts';
import type { Quality } from '../render/quality.ts';
import type { SurvivalWorld } from '../survival/types.ts';
import { STUDY_PICKS, type StudyPick } from './catalog.ts';
import { clipKey, loadStudyCatalog, type StudyAssetAnimal } from './data.ts';
import { type StudyLook, studyLook, studyUrl } from './gate.ts';
import {
	habitatAt,
	PUMA_AVOID,
	perchMember,
	planStudyHerds,
	type StudyMember,
	type StudyPlan,
	studyRandom
} from './herds.ts';
import { type StylizedModel, stylizeModel } from './stylize.ts';

export interface StudyFrame {
	dt: number;
	camera: Camera;
	playerPosition: { x: number; y: number; z: number };
	reducedMotion: boolean;
}

/** The scene's blob shadows (structural: life/fauna.ts LifeBlobs). */
export interface StudyBlobs {
	add(kind: 'actor' | 'item'): number;
	set(id: number, x: number, groundY: number, z: number, radius: number, height?: number): void;
	hide(id: number): void;
	remove(id: number): void;
}

export interface StudyFaunaHost {
	/** The living world's group: the study animals join it when loaded. */
	parent: Group;
	world: SurvivalWorld;
	level?: StoryLevel;
	quality: Quality;
	/** Our tucano's first perch, for the toucan A/B (omit to skip it). */
	tucanoPerch?: { x: number; y: number; z: number; yaw: number } | null;
	blobs?: StudyBlobs | null;
	/** Override `&look=` (tests, captures). */
	look?: StudyLook;
}

export interface StudyMemberDebug {
	key: string;
	species: string;
	state: string;
	clip: string;
	x: number;
	y: number;
	z: number;
	yaw: number;
	distance: number;
	visible: boolean;
}

export interface StudyFaunaDebug {
	look: StudyLook;
	/** Every species loaded (or failed). */
	loaded: boolean;
	species: number;
	failed: string[];
	animals: number;
	visible: number;
	animated: number;
	/** Estimated draws and triangles of the visible study animals. */
	draws: number;
	triangles: number;
	/** Painted albedos (GPU bytes); raw keeps the source textures, counted by the scene. */
	paintedBytes: number;
	cpu: { mean: number; p95: number; samples: number };
	members: StudyMemberDebug[];
	/** Per species: scale applied, natural walk and run speed (u/s), forward source. */
	templates: Record<string, { scale: number; height: number; walk: number; run: number; forward: string }>;
}

export interface StudyFauna {
	update(frame: StudyFrame): void;
	debug(): StudyFaunaDebug | null;
	dispose(): void;
}

/** Per-species behaviour numbers (u, u/s, s). Speeds at ART.md §3 scale. */
interface Tuning {
	walk: number;
	run: number;
	/** rad/s */
	turn: number;
	/** Watches the child inside this. */
	alert: number;
	/** Runs (or hides) inside this. */
	flee: number;
	/** Hidden beyond this camera distance. */
	far: number;
	idle: [number, number];
	graze: [number, number];
	/** Body yaw relative to the travel direction (the crab walks sideways). */
	sideways?: number;
	/** Hides in its shell instead of running (the jabuti). */
	hides?: boolean;
}

const TUNING: Record<string, Tuning> = {
	Capybara: { walk: 1.0, run: 4.2, turn: 2.6, alert: 13, flee: 7, far: 120, idle: [3, 7], graze: [4, 9] },
	Tapir: { walk: 1.2, run: 3.4, turn: 1.6, alert: 13, flee: 7.5, far: 140, idle: [3, 6], graze: [5, 10] },
	Tapir_baby: { walk: 1.2, run: 3.4, turn: 2.6, alert: 13, flee: 7.5, far: 120, idle: [2, 4], graze: [3, 6] },
	Peccary: { walk: 1.1, run: 3.8, turn: 2.8, alert: 12, flee: 7, far: 120, idle: [2, 5], graze: [3, 7] },
	ArmadilloThreeBanded: {
		walk: 0.7,
		run: 1.6,
		turn: 3.0,
		alert: 7,
		flee: 4,
		far: 70,
		idle: [2, 4],
		graze: [3, 6],
		hides: true
	},
	CaneToad: { walk: 0.6, run: 1.2, turn: 3.0, alert: 5, flee: 3, far: 55, idle: [4, 9], graze: [3, 6] },
	Crab: {
		walk: 0.9,
		run: 2.6,
		turn: 3.5,
		alert: 6,
		flee: 4,
		far: 55,
		idle: [2, 5],
		graze: [2, 4],
		sideways: Math.PI / 2
	},
	Puma: {
		walk: 1.5,
		run: 2.3,
		turn: 1.8,
		alert: 24,
		flee: PUMA_AVOID,
		far: 160,
		idle: [4, 9],
		graze: [4, 8]
	},
	RedFootedTortoise: {
		walk: 0.22,
		run: 0.22,
		turn: 0.7,
		alert: 5,
		flee: 4,
		far: 60,
		idle: [4, 8],
		graze: [6, 12],
		hides: true
	},
	GiantAnteater: {
		walk: 0.9,
		run: 3.0,
		turn: 1.8,
		alert: 12,
		flee: 7,
		far: 130,
		idle: [3, 6],
		graze: [5, 9]
	},
	Toucan: { walk: 0, run: 0, turn: 0, alert: 7, flee: 0, far: 110, idle: [6, 12], graze: [1, 2] },
	ParrotMacaw: { walk: 0, run: 0, turn: 0, alert: 7, flee: 0, far: 110, idle: [7, 14], graze: [1, 2] }
};

/** Mixers beyond this camera distance step at half rate. */
const HALF_RATE = 45;
/** Outline shells beyond this camera distance are hidden (a 1.5 px rim no longer reads there). */
const OUTLINE_FAR = 60;
/** The fastest flight, u/s (the avatar runs 9.6 u/s). */
const MAX_RUN = 12;
/** The puma leaves at a brisk walk, this much over its natural walk (our onça: 2.3 vs 1.8). */
const LEAVE_PACE = 1.3;
/** Warm-up: 5 s at 30 Hz, with the player out of the map. */
const WARM_STEPS = 150;
const FAR_AWAY = -1e4;
/** The cohesion lineup (`&estudo-lineup`), left to right. */
const LINEUP = ['capivara-0', 'anta', 'cateto-0', 'onca-parda'];
const FADE = 0.35;
const CPU_WINDOW = 120;

type Role = 'idle' | 'walk' | 'run' | 'eat' | 'alerted' | 'extra' | 'show';
type State = 'idle' | 'graze' | 'walk' | 'trail' | 'alert' | 'flee' | 'hide' | 'leave' | 'perch';

type Roles = Record<Role, string | null>;

interface Template {
	id: string;
	pick: StudyPick;
	asset: StudyAssetAnimal;
	/** The clip key each role plays (null: none in the file). */
	roles: Roles;
	tuning: Tuning;
	scene: Group;
	clips: Map<string, AnimationClip>;
	scale: number;
	offset: Vector3;
	yawOffset: number;
	/** Natural ground speed of the walk and run clips at this scale, u/s (0: in place). */
	naturalWalk: number;
	naturalRun: number;
	/** Ground speeds the behaviours use: the natural ones when the clips travel (no foot slide). */
	walkSpeed: number;
	runSpeed: number;
	forward: string;
	spheres: Sphere[];
	triangles: number;
	draws: number;
	blobRadius: number;
	styled: StylizedModel;
	/** The GLB's own materials and textures: kept for the raw look, freed at once for painted. */
	sources: { materials: Set<Material>; textures: Set<Texture> };
}

const _box = new Box3();
const _a = new Vector3();
const _b = new Vector3();

function boneDepth(object: Object3D): number {
	let depth = 0;
	for (let o = object.parent; o; o = o.parent) depth++;
	return depth;
}

/** The highest bone a position track of `clip` drives: where root motion lives. */
function motionBone(scene: Object3D, clip: AnimationClip | undefined): Object3D | null {
	if (!clip) return null;
	let best: Object3D | null = null;
	let bestDepth = Number.POSITIVE_INFINITY;
	for (const track of clip.tracks) {
		if (!track.name.endsWith('.position')) continue;
		const node = scene.getObjectByName(track.name.slice(0, -'.position'.length));
		if (!node) continue;
		const depth = boneDepth(node);
		if (depth < bestDepth) {
			best = node;
			bestDepth = depth;
		}
	}
	return best;
}

/** World drift of `bone` over one play of `clip`, before the clip is made in place. */
function measureDrift(
	mixer: AnimationMixer,
	scene: Object3D,
	bone: Object3D,
	clip: AnimationClip,
	out: Vector3
) {
	mixer.stopAllAction();
	const action = mixer.clipAction(clip);
	action.reset();
	action.setLoop(LoopOnce, 1);
	action.clampWhenFinished = true;
	action.play();
	mixer.setTime(0);
	scene.updateMatrixWorld(true);
	bone.getWorldPosition(_a);
	mixer.setTime(clip.duration * 0.999);
	scene.updateMatrixWorld(true);
	bone.getWorldPosition(_b);
	action.stop();
	mixer.uncacheAction(clip);
	return out.subVectors(_b, _a);
}

/** Remove the linear drift of every position track: the clip plays in place, its bob kept. */
export function makeInPlace(clip: AnimationClip) {
	for (const track of clip.tracks) {
		if (!track.name.endsWith('.position')) continue;
		const times = track.times;
		const values = track.values;
		const n = times.length;
		if (n < 2) continue;
		const t0 = times[0];
		const span = times[n - 1] - t0;
		if (span <= 0) continue;
		const last = (n - 1) * 3;
		const dx = values[last] - values[0];
		const dy = values[last + 1] - values[1];
		const dz = values[last + 2] - values[2];
		for (let i = 0; i < n; i++) {
			const k = (times[i] - t0) / span;
			values[i * 3] -= dx * k;
			values[i * 3 + 1] -= dy * k;
			values[i * 3 + 2] -= dz * k;
		}
	}
}

/**
 * Some conversions (the cururu, the crab, the tatu-galinha) bake the armature
 * root's offset into the inverse bind matrices once more, so at the rest pose
 * the skin sits a root offset away from its bones. Measured at the rest pose
 * (as loaded, before any clip): shift every inverse bind matrix so the skin's
 * centre lands on the skeleton's. Returns whether it had to.
 */
export function fixSkinOffset(scene: Object3D): boolean {
	scene.updateMatrixWorld(true);
	const bones = new Box3();
	scene.traverse((o) => {
		if ((o as Bone).isBone) bones.expandByPoint(o.getWorldPosition(_a));
	});
	if (bones.isEmpty()) return false;
	const skin = new Box3().setFromObject(scene, true);
	const offset = bones.getCenter(new Vector3()).sub(skin.getCenter(_b));
	if (offset.length() <= bones.getSize(_a).length()) return false;
	const shift = new Matrix4().makeTranslation(offset.x, offset.y, offset.z);
	const done = new Set<Matrix4>();
	scene.traverse((o) => {
		const mesh = o as SkinnedMesh;
		if (!mesh.isSkinnedMesh) return;
		mesh.skeleton.bones.forEach((bone, i) => {
			const inverse = mesh.skeleton.boneInverses[i];
			if (done.has(inverse)) return;
			done.add(inverse);
			// B⁻¹ · T · B · IBM: the same skin, moved by T at the rest pose.
			const fixed = bone.matrixWorld
				.clone()
				.invert()
				.multiply(shift)
				.multiply(bone.matrixWorld)
				.multiply(inverse);
			inverse.copy(fixed);
		});
	});
	return true;
}

function findBone(scene: Object3D, test: RegExp, reject?: RegExp): Object3D | null {
	let found: Object3D | null = null;
	scene.traverse((o) => {
		if (found || !(o as Bone).isBone) return;
		if (test.test(o.name) && !reject?.test(o.name)) found = o;
	});
	return found;
}

/** Each role's clip key from the pick's names (`extra`: the first match). */
export function resolveRoles(pick: StudyPick, keys: readonly string[]): Roles {
	const has = (key: string | undefined) => (key !== undefined && keys.includes(key) ? key : null);
	return {
		idle: has(pick.idle),
		walk: has(pick.walk),
		run: has(pick.run) ?? has(pick.walk),
		eat: has(pick.eat) ?? has(pick.idle),
		alerted: has(pick.alerted) ?? has(pick.idle),
		extra: keys.find((k) => pick.extra?.test(k)) ?? null,
		show: has(pick.show)
	};
}

async function loadTemplate(
	id: string,
	pick: StudyPick,
	asset: StudyAssetAnimal,
	look: StudyLook,
	signal: AbortSignal
): Promise<Template> {
	const tuning = TUNING[id];
	if (!tuning) throw new Error(`study: no tuning for ${id}`);
	const response = await fetch(studyUrl(asset.path), { signal });
	if (!response.ok) throw new Error(`study: ${id} ${response.status}`);
	const buffer = await response.arrayBuffer();
	await MeshoptDecoder.ready;
	const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(buffer, '');
	signal.throwIfAborted();
	const scene = gltf.scene;
	const clips = new Map<string, AnimationClip>();
	for (const clip of gltf.animations) {
		const key = clipKey(clip.name);
		if (!clips.has(key)) clips.set(key, clip);
	}
	const roles = resolveRoles(pick, [...clips.keys()]);
	fixSkinOffset(scene);
	const wrapper = new Group();
	wrapper.add(scene);
	wrapper.updateMatrixWorld(true);
	const mixer = new AnimationMixer(scene);

	// Root motion: measure on the raw clips, then make every used clip in place.
	const walkClip = roles.walk ? clips.get(roles.walk) : undefined;
	const runClip = roles.run ? clips.get(roles.run) : undefined;
	const mover = motionBone(scene, walkClip);
	const walkDrift = new Vector3();
	const runDrift = new Vector3();
	if (mover && walkClip) measureDrift(mixer, scene, mover, walkClip, walkDrift);
	if (mover && runClip) measureDrift(mixer, scene, mover, runClip, runDrift);
	for (const key of new Set(Object.values(roles))) {
		const clip = key ? clips.get(key) : undefined;
		if (clip) makeInPlace(clip);
	}

	// Pose on the idle clip's first frame and measure the silhouette.
	mixer.stopAllAction();
	const idleClip = roles.idle ? clips.get(roles.idle) : undefined;
	if (idleClip) {
		mixer.clipAction(idleClip).reset().play();
		mixer.setTime(0);
	}
	wrapper.updateMatrixWorld(true);
	_box.makeEmpty();
	_box.setFromObject(scene, true);
	const height = Math.max(1e-6, _box.max.y - _box.min.y);
	const scale = pick.height / height;
	const offset = new Vector3(-(_box.min.x + _box.max.x) / 2, -_box.min.y, -(_box.min.z + _box.max.z) / 2);

	// Forward: the walk's drift if it travels, else head minus tail.
	let forward = 'default';
	let fx = 0;
	let fz = 1;
	const walkTravel = Math.hypot(walkDrift.x, walkDrift.z);
	if (walkTravel > height * 0.2) {
		fx = walkDrift.x / walkTravel;
		fz = walkDrift.z / walkTravel;
		forward = 'walk-drift';
	} else {
		const head = findBone(scene, /head/i, /end|dummy/i);
		const tail = findBone(scene, /(^|_)(ass|pelvis|tail|hip)/i) ?? findBone(scene, /root/i);
		if (head && tail) {
			head.getWorldPosition(_a);
			tail.getWorldPosition(_b);
			const dx = _a.x - _b.x;
			const dz = _a.z - _b.z;
			const d = Math.hypot(dx, dz);
			if (d > 1e-6) {
				fx = dx / d;
				fz = dz / d;
				forward = 'head-tail';
			}
		}
	}
	const yawOffset = -Math.atan2(fx, fz);
	const duration = (clip: AnimationClip | undefined) => (clip && clip.duration > 0 ? clip.duration : 1);
	const naturalWalk = (Math.hypot(walkDrift.x, walkDrift.z) * scale) / duration(walkClip);
	const naturalRun = (Math.hypot(runDrift.x, runDrift.z) * scale) / duration(runClip);

	// Bounding spheres on the idle pose (mesh space), shared by the clones.
	const spheres: Sphere[] = [];
	scene.traverse((o) => {
		const mesh = o as SkinnedMesh;
		if (!mesh.isSkinnedMesh) return;
		mesh.computeBoundingSphere();
		const sphere = (mesh.boundingSphere ?? new Sphere()).clone();
		sphere.radius *= 1.3;
		spheres.push(sphere);
	});
	mixer.stopAllAction();
	mixer.uncacheRoot(scene);
	wrapper.remove(scene);

	const sources = { materials: new Set<Material>(), textures: new Set<Texture>() };
	scene.traverse((o) => {
		const mesh = o as SkinnedMesh;
		if (!mesh.isMesh) return;
		for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
			sources.materials.add(material);
			for (const value of Object.values(material)) if (value instanceof Texture) sources.textures.add(value);
		}
	});
	const styled = stylizeModel(scene, look);
	// Draws and triangles as drawn: the painted look adds an outline shell per skinned mesh.
	let triangles = 0;
	let draws = 0;
	scene.traverse((o) => {
		const mesh = o as SkinnedMesh;
		if (!mesh.isMesh) return;
		const index = mesh.geometry.index;
		triangles += (index ? index.count : mesh.geometry.attributes.position.count) / 3;
		draws += Array.isArray(mesh.material) ? mesh.material.length : 1;
	});
	// The painted canvases are copies: the source images were never uploaded and can go now.
	if (look === 'painted') releaseSources(sources);
	const footprint = Math.max(_box.max.x - _box.min.x, _box.max.z - _box.min.z) * scale;
	return {
		id,
		pick,
		asset,
		roles,
		tuning,
		scene,
		clips,
		scale,
		offset,
		yawOffset,
		naturalWalk,
		naturalRun,
		walkSpeed: naturalWalk > 0.05 ? naturalWalk : tuning.walk,
		runSpeed: naturalRun > 0.05 ? Math.min(naturalRun, MAX_RUN) : tuning.run,
		forward,
		spheres,
		triangles,
		draws,
		blobRadius: Math.max(0.25, footprint * 0.38),
		styled,
		sources
	};
}

function releaseSources(sources: Template['sources']) {
	for (const material of sources.materials) material.dispose();
	for (const texture of sources.textures) {
		texture.dispose();
		if (typeof ImageBitmap !== 'undefined' && texture.image instanceof ImageBitmap) texture.image.close();
	}
	sources.materials.clear();
	sources.textures.clear();
}

function disposeTemplate(template: Template) {
	template.styled.dispose();
	releaseSources(template.sources);
	template.scene.traverse((o) => {
		const mesh = o as SkinnedMesh;
		if (mesh.isMesh) mesh.geometry.dispose();
	});
}

const wrapAngle = (a: number) => {
	let v = a;
	while (v > Math.PI) v -= Math.PI * 2;
	while (v < -Math.PI) v += Math.PI * 2;
	return v;
};

/** One study animal: its clone, mixer, actions and behaviour state. */
class StudyActor {
	readonly holder = new Group();
	readonly mixer: AnimationMixer;
	readonly actions = new Map<Role, AnimationAction>();
	readonly random: () => number;
	state: State = 'idle';
	clip: Role | null = null;
	x: number;
	y = 0;
	z: number;
	yaw: number;
	speed = 0;
	targetX: number;
	targetZ: number;
	timer = 0;
	/** Seconds since the group's last alarm this actor already answered. */
	alarmSeen = 0;
	visible = true;
	animated = false;
	distance = 0;
	halfStep = 0;
	blob = -1;
	/** The painted look's outline shells, hidden beyond OUTLINE_FAR. */
	readonly shells: Object3D[] = [];
	shellsShown = true;
	endIndex = 0;

	constructor(
		readonly member: StudyMember,
		readonly template: Template
	) {
		this.random = studyRandom(member.seed);
		this.x = member.x;
		this.z = member.z;
		this.yaw = member.yaw;
		this.targetX = member.x;
		this.targetZ = member.z;
		const model = cloneSkinned(template.scene);
		let s = 0;
		model.traverse((o) => {
			const mesh = o as SkinnedMesh;
			if (mesh.userData.studyOutline) this.shells.push(mesh);
			if (!mesh.isSkinnedMesh || mesh.userData.studyOutline) return;
			const sphere = template.spheres[s++];
			if (sphere) mesh.boundingSphere = sphere.clone();
		});
		const offset = new Group();
		offset.position.copy(template.offset);
		offset.add(model);
		const pivot = new Group();
		pivot.scale.setScalar(template.scale * member.size);
		pivot.rotation.y = template.yawOffset;
		pivot.add(offset);
		this.holder.add(pivot);
		this.holder.name = `study:${member.key}`;
		this.mixer = new AnimationMixer(model);
		for (const [role, key] of Object.entries(template.roles) as [Role, string | null][]) {
			const clip = key ? template.clips.get(key) : undefined;
			if (!clip) continue;
			// One action per clip and mixer: roles sharing a clip share it.
			const action = this.mixer.clipAction(clip);
			const once = template.pick.show !== undefined && (role === 'alerted' || role === 'show');
			action.setLoop(once ? LoopOnce : LoopRepeat, once ? 1 : Number.POSITIVE_INFINITY);
			action.clampWhenFinished = once;
			this.actions.set(role, action);
		}
		this.state = member.behaviour === 'perch' ? 'perch' : 'idle';
		this.timer = 1 + this.random() * 4;
		this.play('idle', 0);
		// Desynchronise the herd: each starts at its own point of the clip.
		this.mixer.update(this.random() * 3);
	}

	play(role: Role, fade = FADE) {
		let next = this.actions.get(role);
		if (!next && role === 'extra') next = this.actions.get('idle');
		if (!next && role === 'show') next = this.actions.get('idle');
		if (!next) return;
		const current = this.clip ? this.actions.get(this.clip) : undefined;
		this.clip = role;
		if (current === next) return;
		next.reset();
		next.setEffectiveTimeScale(1);
		next.setEffectiveWeight(1);
		next.play();
		if (current && fade > 0) {
			next.fadeIn(fade);
			current.fadeOut(fade);
		} else current?.stop();
	}

	dispose() {
		this.mixer.stopAllAction();
		this.mixer.uncacheRoot(this.mixer.getRoot());
		this.holder.removeFromParent();
	}
}

/**
 * "Modo estudo (local)" as the last line of the debug overlay (`output.debug`,
 * Root.svelte) while the mode is on; re-attached if the overlay is rebuilt.
 */
function studyBadge(): () => void {
	if (typeof document === 'undefined') return () => {};
	const attach = () => {
		const overlay = document.querySelector('output.debug');
		if (!overlay || overlay.querySelector('[data-study-badge]')) return;
		const line = document.createElement('span');
		line.dataset.studyBadge = '';
		line.textContent = 'Modo estudo (local)';
		overlay.append(document.createElement('br'), line);
	};
	attach();
	const timer = setInterval(attach, 1000);
	return () => {
		clearInterval(timer);
		for (const line of document.querySelectorAll('[data-study-badge]')) {
			line.previousElementSibling?.remove();
			line.remove();
		}
	};
}

export class StudyFaunaRuntime implements StudyFauna {
	readonly root = new Group();
	readonly plan: StudyPlan;
	readonly look: StudyLook;
	readonly actors: StudyActor[] = [];
	readonly templates = new Map<string, Template>();
	readonly failed: string[] = [];
	readonly #host: StudyFaunaHost;
	readonly #abort = new AbortController();
	readonly #ground: GroundSampler;
	readonly #members: StudyMember[];
	readonly #alarms = new Map<string, number>();
	readonly #cpu = new Float64Array(CPU_WINDOW);
	readonly #sorted = new Float64Array(CPU_WINDOW);
	#cpuCount = 0;
	#cpuAt = 0;
	#clock = 0;
	#pending = 0;
	#started = false;
	readonly #species: string[];
	#disposed = false;
	readonly #unbadge: () => void;
	readonly #still = typeof location !== 'undefined' && new URLSearchParams(location.search).has('golden');

	constructor(host: StudyFaunaHost) {
		this.#host = host;
		this.look = host.look ?? studyLook();
		this.root.name = 'study-fauna';
		this.plan = planStudyHerds(host.world, host.level);
		this.#members = [...this.plan.members];
		if (host.tucanoPerch) {
			this.#members.push(perchMember('tucano-estudo', 'Toucan', host.tucanoPerch, 1));
			this.#members.push(perchMember('arara-estudo', 'ParrotMacaw', host.tucanoPerch, -1));
		}
		this.#ground = new GroundSampler(host.world.heights, host.world.size);
		host.parent.add(this.root);
		this.#species = [...new Set(this.#members.map((m) => m.species))];
		this.#pending = this.#species.length;
		// Stills load at once; the game streams the study in after its first frame (update()).
		if (this.#still) this.#start(Number.NaN, Number.NaN);
		(globalThis as { __estudo?: StudyFaunaRuntime }).__estudo = this;
		this.#unbadge = studyBadge();
	}

	get loaded() {
		return this.#started && this.#pending === 0;
	}

	/**
	 * Stream the species in, one at a time with a frame between them, nearest to
	 * the player first, so the study never delays the game's first frame.
	 */
	#start(px: number, pz: number) {
		if (this.#started) return;
		this.#started = true;
		const near = (id: string) => {
			let best = Number.POSITIVE_INFINITY;
			for (const m of this.#members)
				if (m.species === id) best = Math.min(best, Math.hypot(m.x - px, m.z - pz) || 0);
			return Number.isFinite(best) ? best : 0;
		};
		const order = Number.isFinite(px) ? [...this.#species].sort((a, b) => near(a) - near(b)) : this.#species;
		void (async () => {
			for (const id of order) {
				if (this.#disposed) return;
				await this.#load(id);
				await new Promise((resolve) =>
					typeof requestAnimationFrame === 'function'
						? requestAnimationFrame(resolve)
						: setTimeout(resolve, 0)
				);
			}
		})();
	}

	async #load(id: string) {
		try {
			const pick = STUDY_PICKS[id];
			const catalog = await loadStudyCatalog(this.#abort.signal);
			const asset = catalog.animals.find((a) => a.id === id);
			if (!pick || !asset) throw new Error(`study: ${id} is not in the served catalog`);
			const template = await loadTemplate(id, pick, asset, this.look, this.#abort.signal);
			if (this.#disposed) {
				disposeTemplate(template);
				return;
			}
			this.templates.set(id, template);
			const fresh: StudyActor[] = [];
			this.#members.forEach((member, i) => {
				if (member.species !== id) return;
				const actor = new StudyActor(member, template);
				this.#placeStart(actor);
				this.actors.push(actor);
				fresh.push(actor);
				this.root.add(actor.holder);
				if (this.#host.blobs && member.behaviour !== 'perch') actor.blob = this.#host.blobs.add('actor');
				actor.halfStep = i & 1;
			});
			// In the game each species wakes up on its own; stills warm everyone together below.
			if (!this.#still) this.#warm(fresh);
		} catch (error) {
			if (!this.#disposed) {
				this.failed.push(id);
				console.warn(`[estudo] ${id} failed to load`, error);
			}
		} finally {
			// Stills: once everything is in, the whole population warms up together (followers find
			// their leaders), the same way every run, then the optional lineup.
			if (--this.#pending === 0 && !this.#disposed && this.#still) {
				this.#warm(this.actors);
				this.#lineup();
			}
		}
	}

	/** Ground height and the holder's transform from the actor's state. */
	#pose(actor: StudyActor) {
		if (actor.member.y === null) {
			this.#ground.x = actor.x;
			this.#ground.z = actor.z;
			this.#ground.sample();
			actor.y = this.#ground.y;
		}
		actor.holder.position.set(actor.x, actor.y, actor.z);
		actor.holder.rotation.y = actor.yaw + (actor.template.tuning.sideways ?? 0);
		const radius = actor.template.blobRadius * actor.member.size;
		if (actor.blob >= 0) this.#host.blobs?.set(actor.blob, actor.x, actor.y, actor.z, radius, 0);
	}

	/**
	 * A few seconds of life, with the child far away, before the first frame:
	 * golden captures freeze the clock once the scene is ready, and the study
	 * loads after that, so this is what they show.
	 */
	#warm(actors: readonly StudyActor[]) {
		const step = 1 / 30;
		for (let i = 0; i < WARM_STEPS; i++)
			for (const actor of actors) this.#step(actor, step, FAR_AWAY, FAR_AWAY);
		for (const actor of actors) {
			actor.mixer.update(FADE * 2);
			this.#pose(actor);
		}
	}

	/**
	 * `&estudo-lineup=x,z,yaw` (stills only): the capivara, the anta, a cateto and
	 * the onça-parda nose to tail from (x, z), all facing `yaw`, 5 u apart, so a
	 * camera square to the row sees their profiles: the cohesion A/B next to the
	 * avatar and our mico (golden `&life=companion`).
	 */
	#lineup() {
		const value =
			typeof location === 'undefined' ? null : new URLSearchParams(location.search).get('estudo-lineup');
		const [x, z, yaw] = (value ?? '').split(',').map(Number);
		if (![x, z, yaw].every(Number.isFinite)) return;
		const forward = { x: Math.sin(yaw), z: Math.cos(yaw) };
		LINEUP.forEach((key, i) => {
			const actor = this.actors.find((a) => a.member.key === key);
			if (!actor) return;
			actor.x = x + forward.x * 5 * i;
			actor.z = z + forward.z * 5 * i;
			actor.yaw = yaw;
			actor.play('idle', 0);
			actor.mixer.update(FADE * 2);
			this.#pose(actor);
		});
	}

	#placeStart(actor: StudyActor) {
		if (actor.member.y !== null) actor.y = actor.member.y;
		this.#pose(actor);
	}

	#valid(actor: StudyActor, x: number, z: number) {
		const habitat = actor.member.behaviour === 'follow' ? 'any' : actor.member.habitat;
		return habitatAt(this.#host.world, this.plan.riverDistance, habitat, x, z);
	}

	/** A random reachable point around home; false when none of a few tries is valid. */
	#pickWander(actor: StudyActor) {
		const m = actor.member;
		for (let i = 0; i < 10; i++) {
			const a = actor.random() * Math.PI * 2;
			const r = m.radius * Math.sqrt(actor.random());
			const x = m.homeX + Math.sin(a) * r;
			const z = m.homeZ + Math.cos(a) * r;
			if (this.#valid(actor, x, z)) {
				actor.targetX = x;
				actor.targetZ = z;
				return true;
			}
		}
		return false;
	}

	/** A point `reach` u away from the player, trying rotations of the away direction. */
	#pickAway(actor: StudyActor, px: number, pz: number, reach: number) {
		const base = Math.atan2(actor.x - px, actor.z - pz);
		for (const turn of [0, 0.5, -0.5, 1, -1, 1.5, -1.5]) {
			const a = base + turn;
			const x = actor.x + Math.sin(a) * reach;
			const z = actor.z + Math.cos(a) * reach;
			if (this.#valid(actor, x, z)) {
				actor.targetX = x;
				actor.targetZ = z;
				return true;
			}
		}
		return false;
	}

	#enter(actor: StudyActor, state: State, px: number, pz: number) {
		const t = actor.template.tuning;
		actor.state = state;
		switch (state) {
			case 'idle':
				actor.timer = t.idle[0] + actor.random() * (t.idle[1] - t.idle[0]);
				actor.play(actor.random() < 0.3 ? 'extra' : 'idle');
				break;
			case 'graze':
				actor.timer = t.graze[0] + actor.random() * (t.graze[1] - t.graze[0]);
				actor.play('eat');
				break;
			case 'walk':
				actor.timer = 20;
				actor.play('walk');
				break;
			case 'alert':
				actor.timer = 1.6 + actor.random() * 1.2;
				actor.play('alerted', 0.2);
				break;
			case 'hide':
				actor.timer = 2;
				actor.play('alerted', 0.15);
				break;
			case 'flee':
				actor.timer = 6;
				this.#pickAway(actor, px, pz, 14 + actor.random() * 4);
				actor.play('run', 0.2);
				break;
			case 'leave':
				// The caller picked the target already.
				actor.timer = 30;
				actor.play('walk', 0.4);
				break;
			case 'perch':
				actor.timer = t.idle[0] + actor.random() * (t.idle[1] - t.idle[0]);
				actor.play('idle');
				break;
		}
	}

	/** Steer toward the target at `cruise`; returns the remaining distance. Stops at the habitat's edge. */
	#move(actor: StudyActor, dt: number, cruise: number) {
		const t = actor.template.tuning;
		const dx = actor.targetX - actor.x;
		const dz = actor.targetZ - actor.z;
		const distance = Math.hypot(dx, dz);
		if (distance < 0.05) {
			actor.speed = 0;
			return 0;
		}
		const want = Math.atan2(dx, dz);
		const delta = wrapAngle(want - actor.yaw);
		const step = t.turn * dt;
		actor.yaw = wrapAngle(actor.yaw + Math.max(-step, Math.min(step, delta)));
		// Slow down for sharp turns and on arrival, accelerate otherwise.
		const facing = Math.max(0, Math.cos(delta));
		const goal = cruise * facing * Math.min(1, distance / 0.8 + 0.25);
		actor.speed += (goal - actor.speed) * Math.min(1, dt * 3);
		const travel = Math.min(distance, actor.speed * dt);
		const nx = actor.x + Math.sin(actor.yaw) * travel;
		const nz = actor.z + Math.cos(actor.yaw) * travel;
		if (!this.#valid(actor, nx, nz)) {
			actor.speed = 0;
			return -1;
		}
		actor.x = nx;
		actor.z = nz;
		return distance - travel;
	}

	#face(actor: StudyActor, dt: number, px: number, pz: number) {
		const want = Math.atan2(px - actor.x, pz - actor.z);
		const delta = wrapAngle(want - actor.yaw);
		const step = actor.template.tuning.turn * dt;
		actor.yaw = wrapAngle(actor.yaw + Math.max(-step, Math.min(step, delta)));
	}

	#rate(actor: StudyActor, role: 'walk' | 'run') {
		const action = actor.actions.get(role);
		if (!action) return;
		const natural = role === 'walk' ? actor.template.naturalWalk : actor.template.naturalRun;
		const cruise = Math.max(0.05, Math.abs(actor.speed));
		const rate =
			natural > 0.05
				? cruise / natural
				: cruise / Math.max(0.05, role === 'walk' ? actor.template.walkSpeed : actor.template.runSpeed);
		action.setEffectiveTimeScale(Math.max(0.4, Math.min(2, rate)));
	}

	#step(actor: StudyActor, dt: number, px: number, pz: number) {
		const t = actor.template.tuning;
		const m = actor.member;
		const d = Math.hypot(px - actor.x, pz - actor.z);
		actor.timer -= dt;

		if (m.behaviour === 'perch') {
			if (actor.timer <= 0) {
				// A short wing stretch now and then, then back to the idle.
				if (actor.clip === 'idle') {
					actor.play('run', 0.2);
					actor.timer = 0.9;
				} else this.#enter(actor, 'perch', px, pz);
			}
			return;
		}

		// The group's alarm reaches everyone who has not answered it yet.
		const alarm = this.#alarms.get(m.group) ?? -1;
		if (
			alarm > actor.alarmSeen &&
			m.behaviour !== 'shy' &&
			!t.hides &&
			actor.state !== 'flee' &&
			this.#clock - alarm < 4
		) {
			actor.alarmSeen = alarm;
			this.#enter(actor, 'flee', px, pz);
		}

		if (m.behaviour === 'shy') {
			// Like our onça: inside `flee` it walks (never runs) away, and stops leaving at 1.5×.
			if (actor.state !== 'leave' && actor.state !== 'alert' && d < t.flee) {
				if (this.#pickAway(actor, px, pz, 22)) this.#enter(actor, 'leave', px, pz);
				else this.#enter(actor, 'alert', px, pz);
			}
			if (actor.state === 'leave') {
				const left = this.#move(actor, dt, actor.template.walkSpeed * LEAVE_PACE);
				this.#rate(actor, 'walk');
				if (d > t.flee * 1.5) this.#enter(actor, 'idle', px, pz);
				else if ((left === -1 || left < 0.5 || actor.timer <= 0) && !this.#pickAway(actor, px, pz, 22))
					this.#enter(actor, 'alert', px, pz);
				return;
			}
		} else if (t.hides) {
			if (actor.state !== 'hide' && d < t.flee) this.#enter(actor, 'hide', px, pz);
			if (actor.state === 'hide') {
				if (d > t.alert && actor.timer <= 0) {
					actor.play('show', 0.15);
					actor.state = 'idle';
					actor.timer = 2.5;
				}
				return;
			}
		} else if (actor.state !== 'flee') {
			if (d < t.flee) {
				this.#alarms.set(m.group, this.#clock);
				actor.alarmSeen = this.#clock;
				this.#enter(actor, 'flee', px, pz);
			} else if (d < t.alert && actor.state !== 'alert') this.#enter(actor, 'alert', px, pz);
		}

		switch (actor.state) {
			case 'alert':
				actor.speed = 0;
				this.#face(actor, dt, px, pz);
				if (actor.timer <= 0) {
					if (d < t.alert) actor.timer = 1.5;
					else this.#enter(actor, 'idle', px, pz);
				}
				return;
			case 'flee': {
				const left = this.#move(actor, dt, actor.template.runSpeed);
				this.#rate(actor, 'run');
				if (left === -1 && !this.#pickAway(actor, px, pz, 10)) this.#enter(actor, 'alert', px, pz);
				else if (left >= 0 && left < 0.4) this.#enter(actor, d < t.alert ? 'alert' : 'idle', px, pz);
				else if (actor.timer <= 0) this.#enter(actor, 'alert', px, pz);
				return;
			}
			default:
				break;
		}

		if (m.behaviour === 'follow' && m.leader >= 0) {
			this.#follow(actor, dt, px, pz);
			return;
		}

		switch (actor.state) {
			case 'idle':
			case 'graze':
				actor.speed = 0;
				if (actor.timer <= 0) {
					if (m.behaviour === 'cross') {
						const e = m.ends;
						if (e) {
							actor.endIndex = 1 - actor.endIndex;
							actor.targetX = actor.endIndex ? e[2] : e[0];
							actor.targetZ = actor.endIndex ? e[3] : e[1];
							this.#enter(actor, 'walk', px, pz);
						}
					} else if (actor.state === 'idle' && actor.random() < 0.45) this.#enter(actor, 'graze', px, pz);
					else if (this.#pickWander(actor)) this.#enter(actor, 'walk', px, pz);
					else this.#enter(actor, 'idle', px, pz);
				}
				return;
			case 'walk': {
				const left = this.#move(actor, dt, actor.template.walkSpeed);
				this.#rate(actor, 'walk');
				if (left === -1 || left < 0.3 || actor.timer <= 0)
					this.#enter(actor, m.behaviour === 'cross' || actor.random() < 0.6 ? 'graze' : 'idle', px, pz);
				return;
			}
			default:
				this.#enter(actor, 'idle', px, pz);
		}
	}

	#leaderOf(actor: StudyActor): StudyActor | null {
		const key = this.#members[actor.member.leader]?.key;
		for (const other of this.actors) if (other.member.key === key) return other;
		return null;
	}

	#follow(actor: StudyActor, dt: number, px: number, pz: number) {
		const leader = this.#leaderOf(actor);
		if (!leader) return;
		const m = actor.member;
		const c = Math.cos(leader.yaw);
		const s = Math.sin(leader.yaw);
		// Leader frame: right = (cos, -sin), forward = (sin, cos).
		actor.targetX = leader.x + c * m.offsetX + s * m.offsetZ;
		actor.targetZ = leader.z - s * m.offsetX + c * m.offsetZ;
		const gap = Math.hypot(actor.targetX - actor.x, actor.targetZ - actor.z);
		const hurry = leader.state === 'flee' || leader.state === 'trail' || gap > 4;
		if (gap > (actor.state === 'trail' ? 0.4 : 0.9)) {
			const role = hurry ? 'run' : 'walk';
			if (actor.state !== 'trail' || actor.clip !== role) {
				actor.state = 'trail';
				actor.play(role, 0.25);
			}
			const tpl = actor.template;
			const left = this.#move(actor, dt, hurry ? tpl.runSpeed : Math.max(tpl.walkSpeed, leader.speed * 1.15));
			this.#rate(actor, role);
			if (left === -1) this.#enter(actor, 'idle', px, pz);
			return;
		}
		actor.speed = 0;
		if (actor.state === 'trail' || actor.state === 'walk') {
			this.#enter(actor, leader.state === 'graze' ? 'graze' : 'idle', px, pz);
			return;
		}
		if (actor.timer <= 0) this.#enter(actor, actor.random() < 0.5 ? 'graze' : 'idle', px, pz);
		if (leader.state === 'alert') this.#face(actor, dt, px, pz);
	}

	update(frame: StudyFrame) {
		// Golden captures are stills: the warm-up alone places the animals, the same way every run.
		if (this.#disposed || this.#still) return;
		if (!this.#started) this.#start(frame.playerPosition.x, frame.playerPosition.z);
		const start = performance.now();
		const dt = frame.dt > 0 ? Math.min(frame.dt, 0.1) : 0;
		this.#clock += dt;
		const p = frame.playerPosition;
		const eye = frame.camera.position;
		const blobs = this.#host.blobs;
		for (const actor of this.actors) {
			if (dt > 0) this.#step(actor, dt, p.x, p.z);
			this.#pose(actor);
			const h = actor.holder;
			const distance = Math.hypot(eye.x - actor.x, eye.y - actor.y, eye.z - actor.z);
			actor.distance = distance;
			actor.visible = distance < actor.template.tuning.far;
			const shells = distance < OUTLINE_FAR;
			if (shells !== actor.shellsShown) {
				actor.shellsShown = shells;
				for (const shell of actor.shells) shell.visible = shells;
			}
			h.visible = actor.visible;
			actor.animated = false;
			if (actor.visible && dt > 0 && !frame.reducedMotion) {
				if (distance < HALF_RATE) {
					actor.mixer.update(dt);
					actor.animated = true;
				} else {
					actor.halfStep ^= 1;
					if (actor.halfStep) {
						actor.mixer.update(dt * 2);
						actor.animated = true;
					}
				}
			} else if (actor.visible && dt > 0 && frame.reducedMotion && actor.speed > 0.05) {
				// Reduced motion keeps travel readable but drops idle fidgets.
				actor.mixer.update(dt);
				actor.animated = true;
			}
			if (blobs && actor.blob >= 0 && !actor.visible) blobs.hide(actor.blob);
		}
		this.#cpu[this.#cpuAt] = performance.now() - start;
		this.#cpuAt = (this.#cpuAt + 1) % CPU_WINDOW;
		if (this.#cpuCount < CPU_WINDOW) this.#cpuCount++;
	}

	debug(): StudyFaunaDebug {
		let visible = 0;
		let animated = 0;
		let draws = 0;
		let triangles = 0;
		let paintedBytes = 0;
		for (const template of this.templates.values()) paintedBytes += template.styled.textureBytes;
		for (const actor of this.actors) {
			if (actor.animated) animated++;
			if (!actor.visible) continue;
			visible++;
			draws += actor.template.draws;
			triangles += actor.template.triangles;
		}
		const n = this.#cpuCount;
		this.#sorted.set(this.#cpu);
		const window = this.#sorted.subarray(0, n).sort();
		let sum = 0;
		for (let i = 0; i < n; i++) sum += window[i];
		const templates: StudyFaunaDebug['templates'] = {};
		for (const [id, t] of this.templates)
			templates[id] = {
				scale: Number(t.scale.toFixed(5)),
				height: t.pick.height,
				walk: Number(t.naturalWalk.toFixed(3)),
				run: Number(t.naturalRun.toFixed(3)),
				forward: t.forward
			};
		return {
			look: this.look,
			loaded: this.loaded,
			species: this.templates.size,
			failed: [...this.failed],
			animals: this.actors.length,
			visible,
			animated,
			draws,
			triangles,
			paintedBytes,
			cpu: {
				mean: n ? sum / n : 0,
				p95: n ? window[Math.min(n - 1, Math.floor(n * 0.95))] : 0,
				samples: n
			},
			members: this.actors.map((a) => ({
				key: a.member.key,
				species: a.member.species,
				state: a.state,
				clip: a.clip ?? '',
				x: Number(a.x.toFixed(2)),
				y: Number(a.y.toFixed(2)),
				z: Number(a.z.toFixed(2)),
				yaw: Number(a.yaw.toFixed(3)),
				distance: Number(a.distance.toFixed(1)),
				visible: a.visible
			})),
			templates
		};
	}

	dispose() {
		if (this.#disposed) return;
		this.#disposed = true;
		this.#abort.abort();
		for (const actor of this.actors) {
			if (actor.blob >= 0) this.#host.blobs?.remove(actor.blob);
			actor.dispose();
		}
		this.actors.length = 0;
		for (const template of this.templates.values()) disposeTemplate(template);
		this.templates.clear();
		this.root.removeFromParent();
		const global = globalThis as { __estudo?: StudyFaunaRuntime };
		if (global.__estudo === this) delete global.__estudo;
		this.#unbadge();
	}
}
