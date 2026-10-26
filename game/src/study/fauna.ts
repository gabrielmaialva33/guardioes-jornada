/**
 * The study fauna of the LOCAL-ONLY Green Hell study mode: the curated picks
 * of catalog.ts at their homes (herds.ts), each a skinned clone with its own
 * AnimationMixer playing its own clips (idle, walk, eat, alerted, run), and a
 * small behaviour that keeps it on its habitat and reacts to the child.
 *
 * - Loading: GLBs come from the dev middleware (studyUrl), one template per
 *   species, stylized once (stylize.ts) and cloned with SkeletonUtils.
 * - Scale (ART.md §3): each species is scaled by HEIGHT, feet to the top of the
 *   silhouette measured on its idle pose, to `height` of catalog.ts (×1.5 life
 *   size against the 3.0 u avatar), as our animals in animation/animals/species.ts.
 * - Root motion: the clips are made in-place (the linear drift of every position
 *   track removed); the drift measured first gives the clip's natural speed,
 *   so the walk plays at the rate that matches the ground speed.
 * - Facing: our convention is local +z forward. The forward of a model is the
 *   walk clip's drift, or head minus tail when the clip is in place.
 * - Budget: an animal is hidden beyond its `far` distance from the camera and
 *   its mixer runs at half rate beyond 45 u. update() allocates nothing.
 *
 * DEV + `?estudo=greenhell` only (index.ts startStudy is the entry).
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
import { clipKey, type StudyAnimal, type StudyClipRoles, studyAnimal } from './catalog.ts';
import { type StudyLook, studyLook, studyUrl } from './gate.ts';
import {
	habitatAt,
	PUMA_AVOID,
	planStudyHerds,
	type StudyMember,
	type StudyPlan,
	studyRandom,
	toucanMember
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
	Armadillo: { walk: 0.8, run: 3.0, turn: 3.0, alert: 8, flee: 5, far: 70, idle: [2, 4], graze: [3, 6] },
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
	Toucan: { walk: 0, run: 0, turn: 0, alert: 7, flee: 0, far: 110, idle: [6, 12], graze: [1, 2] }
};

/** Mixers beyond this camera distance step at half rate. */
const HALF_RATE = 45;
const FADE = 0.35;
const CPU_WINDOW = 120;

type Role = 'idle' | 'walk' | 'run' | 'eat' | 'alerted' | 'extra' | 'show';
type State = 'idle' | 'graze' | 'walk' | 'trail' | 'alert' | 'flee' | 'hide' | 'leave' | 'perch';

interface Template {
	entry: StudyAnimal;
	roles: StudyClipRoles;
	tuning: Tuning;
	scene: Group;
	clips: Map<string, AnimationClip>;
	scale: number;
	offset: Vector3;
	yawOffset: number;
	/** Natural ground speed of the walk and run clips at this scale, u/s (0: in place). */
	naturalWalk: number;
	naturalRun: number;
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

function findBone(scene: Object3D, test: RegExp, reject?: RegExp): Object3D | null {
	let found: Object3D | null = null;
	scene.traverse((o) => {
		if (found || !(o as Bone).isBone) return;
		if (test.test(o.name) && !reject?.test(o.name)) found = o;
	});
	return found;
}

async function loadTemplate(entry: StudyAnimal, look: StudyLook, signal: AbortSignal): Promise<Template> {
	const roles = entry.roles;
	const tuning = TUNING[entry.id];
	if (!roles || !tuning || !entry.height) throw new Error(`study: ${entry.id} is not a placed pick`);
	const response = await fetch(studyUrl(entry.path), { signal });
	if (!response.ok) throw new Error(`study: ${entry.path} ${response.status}`);
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
	const wrapper = new Group();
	wrapper.add(scene);
	wrapper.updateMatrixWorld(true);
	const mixer = new AnimationMixer(scene);

	// Root motion: measure on the raw clips, then make every used clip in place.
	const walkClip = clips.get(roles.walk);
	const runClip = clips.get(roles.run);
	const mover = motionBone(scene, walkClip);
	const walkDrift = new Vector3();
	const runDrift = new Vector3();
	if (mover && walkClip) measureDrift(mixer, scene, mover, walkClip, walkDrift);
	if (mover && runClip) measureDrift(mixer, scene, mover, runClip, runDrift);
	const used = new Set<string>([
		roles.idle,
		roles.walk,
		roles.run,
		roles.eat,
		roles.alerted,
		...(roles.extra ?? [])
	]);
	if (tuning.hides) used.add('show');
	for (const key of used) {
		const clip = clips.get(key);
		if (clip) makeInPlace(clip);
	}

	// Pose on the idle clip's first frame and measure the silhouette.
	mixer.stopAllAction();
	const idleClip = clips.get(roles.idle);
	if (idleClip) {
		mixer.clipAction(idleClip).reset().play();
		mixer.setTime(0);
	}
	wrapper.updateMatrixWorld(true);
	_box.makeEmpty();
	_box.setFromObject(scene, true);
	const height = Math.max(1e-6, _box.max.y - _box.min.y);
	const scale = entry.height / height;
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
	let triangles = 0;
	let draws = 0;
	scene.traverse((o) => {
		const mesh = o as SkinnedMesh;
		if (!mesh.isMesh) return;
		if (mesh.isSkinnedMesh) {
			mesh.computeBoundingSphere();
			const sphere = (mesh.boundingSphere ?? new Sphere()).clone();
			sphere.radius *= 1.3;
			spheres.push(sphere);
		}
		const index = mesh.geometry.index;
		triangles += (index ? index.count : mesh.geometry.attributes.position.count) / 3;
		draws += Array.isArray(mesh.material) ? mesh.material.length : 1;
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
	// The painted canvases are copies: the source images were never uploaded and can go now.
	if (look === 'painted') releaseSources(sources);
	const footprint = Math.max(_box.max.x - _box.min.x, _box.max.z - _box.min.z) * scale;
	return {
		entry,
		roles,
		tuning,
		scene,
		clips,
		scale,
		offset,
		yawOffset,
		naturalWalk,
		naturalRun,
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
			if (!mesh.isSkinnedMesh) return;
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
		const roles = template.roles;
		const bind = (role: Role, key: string | undefined) => {
			const clip = key ? template.clips.get(key) : undefined;
			if (!clip) return;
			const action = this.mixer.clipAction(clip);
			action.setLoop(LoopRepeat, Number.POSITIVE_INFINITY);
			this.actions.set(role, action);
		};
		bind('idle', roles.idle);
		bind('walk', roles.walk);
		bind('run', roles.run);
		bind('eat', roles.eat);
		bind('alerted', roles.alerted);
		const extra = roles.extra?.[Math.floor(this.random() * roles.extra.length)];
		bind('extra', extra);
		if (template.tuning.hides) {
			for (const role of ['alerted', 'show'] as const) {
				bind(role, role === 'show' ? 'show' : roles.alerted);
				const action = this.actions.get(role);
				if (action) {
					action.setLoop(LoopOnce, 1);
					action.clampWhenFinished = true;
				}
			}
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
	#disposed = false;

	constructor(host: StudyFaunaHost) {
		this.#host = host;
		this.look = host.look ?? studyLook();
		this.root.name = 'study-fauna';
		this.plan = planStudyHerds(host.world, host.level);
		this.#members = [...this.plan.members];
		if (host.tucanoPerch) this.#members.push(toucanMember(host.tucanoPerch));
		this.#ground = new GroundSampler(host.world.heights, host.world.size);
		host.parent.add(this.root);
		const species = [...new Set(this.#members.map((m) => m.species))];
		this.#pending = species.length;
		for (const id of species) void this.#load(id);
		(globalThis as { __estudo?: StudyFaunaRuntime }).__estudo = this;
	}

	get loaded() {
		return this.#pending === 0;
	}

	async #load(id: string) {
		const entry = studyAnimal(id);
		try {
			if (!entry) throw new Error(`study: ${id} not in the catalog`);
			const template = await loadTemplate(entry, this.look, this.#abort.signal);
			if (this.#disposed) {
				disposeTemplate(template);
				return;
			}
			this.templates.set(id, template);
			this.#members.forEach((member, i) => {
				if (member.species !== id) return;
				const actor = new StudyActor(member, template);
				this.#placeStart(actor);
				this.actors.push(actor);
				this.root.add(actor.holder);
				if (this.#host.blobs && member.behaviour !== 'perch') actor.blob = this.#host.blobs.add('actor');
				actor.halfStep = i & 1;
			});
		} catch (error) {
			if (!this.#disposed) {
				this.failed.push(id);
				console.warn(`[estudo] ${id} failed to load`, error);
			}
		} finally {
			this.#pending--;
		}
	}

	#placeStart(actor: StudyActor) {
		const m = actor.member;
		if (m.y !== null) actor.y = m.y;
		else {
			this.#ground.x = actor.x;
			this.#ground.z = actor.z;
			this.#ground.sample();
			actor.y = this.#ground.y;
		}
		actor.holder.position.set(actor.x, actor.y, actor.z);
		actor.holder.rotation.y = actor.yaw + (actor.template.tuning.sideways ?? 0);
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
				: cruise / Math.max(0.05, role === 'walk' ? actor.template.tuning.walk : actor.template.tuning.run);
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
				const left = this.#move(actor, dt, t.run);
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
				const left = this.#move(actor, dt, t.run);
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
				const left = this.#move(actor, dt, t.walk);
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
		const t = actor.template.tuning;
		if (gap > (actor.state === 'trail' ? 0.4 : 0.9)) {
			const role = hurry ? 'run' : 'walk';
			if (actor.state !== 'trail' || actor.clip !== role) {
				actor.state = 'trail';
				actor.play(role, 0.25);
			}
			const left = this.#move(actor, dt, hurry ? t.run : Math.max(t.walk, leader.speed * 1.15));
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
		if (this.#disposed) return;
		const start = performance.now();
		const dt = frame.dt > 0 ? Math.min(frame.dt, 0.1) : 0;
		this.#clock += dt;
		const p = frame.playerPosition;
		const eye = frame.camera.position;
		const blobs = this.#host.blobs;
		for (const actor of this.actors) {
			if (dt > 0) this.#step(actor, dt, p.x, p.z);
			if (actor.member.y === null) {
				this.#ground.x = actor.x;
				this.#ground.z = actor.z;
				this.#ground.sample();
				actor.y = this.#ground.y;
			}
			const h = actor.holder;
			h.position.set(actor.x, actor.y, actor.z);
			h.rotation.y = actor.yaw + (actor.template.tuning.sideways ?? 0);
			const distance = Math.hypot(eye.x - actor.x, eye.y - actor.y, eye.z - actor.z);
			actor.distance = distance;
			actor.visible = distance < actor.template.tuning.far;
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
			if (blobs && actor.blob >= 0) {
				if (actor.visible)
					blobs.set(actor.blob, actor.x, actor.y, actor.z, actor.template.blobRadius * actor.member.size, 0);
				else blobs.hide(actor.blob);
			}
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
				height: t.entry.height ?? 0,
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
	}
}
