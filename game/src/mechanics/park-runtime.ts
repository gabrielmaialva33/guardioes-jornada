import { type Box3, BoxGeometry, Matrix4, type PerspectiveCamera, type Ray } from 'three';
import type { ExtendedTriangle } from 'three-mesh-bvh';
import type { Character } from '../engine/character.ts';
import { CompoundWorld } from '../engine/compound-world.ts';
import { type ColliderSource, type CollisionQuery, CollisionWorld } from '../engine/world.ts';
import type { CaptureFrame } from '../guia/capture.ts';
import type { Deck, StoryLevel } from '../level/types.ts';
import { type LifeActor, type LivingWorld, planLife } from '../life/index.ts';
import type { StoryAction, StoryGame } from '../missions/story.ts';
import { heightAt } from '../survival/terrain.ts';
import type { Point, SurvivalWorld } from '../survival/types.ts';
import type { GuideMechanicsBridge } from './guide-bridge.ts';
import { Ladder } from './ladder.ts';
import { PhotoCamera, type PhotoSubject } from './photo.ts';
import { PhotoProjection } from './photo-three.ts';
import { ParkTraversal } from './traversal.ts';
import { Zipline } from './zipline.ts';

class GateWorld extends CollisionWorld {
	enabled = true;
	override raycast(ray: Ray, far: number) {
		return this.enabled ? super.raycast(ray, far) : null;
	}
	override shapecast(bounds: Box3, visit: (t: ExtendedTriangle) => void) {
		if (this.enabled) super.shapecast(bounds, visit);
	}
}
class OwnedWorld extends CompoundWorld {
	override dispose() {
		super.dispose();
		for (const child of this.children) child.dispose?.();
	}
}
/** Authored geometry, shared by the physics tests and prop placement. */
export function parkBoxes(level: StoryLevel, world: SurvivalWorld) {
	const boxes: { x: number; y: number; z: number; sx: number; sy: number; sz: number; yaw: number }[] = [];
	const box = (x: number, y: number, z: number, sx: number, sy: number, sz: number, yaw = 0) =>
		boxes.push({ x, y, z, sx, sy, sz, yaw });
	const deck = (d: Deck) => {
		box((d.x0 + d.x1) / 2, d.y - 0.15, (d.z0 + d.z1) / 2, d.x1 - d.x0, 0.3, d.z1 - d.z0);
		for (const r of d.rails)
			box(
				(r.x0 + r.x1) / 2,
				r.y + r.height / 2,
				(r.z0 + r.z1) / 2,
				0.16,
				r.height,
				Math.hypot(r.x1 - r.x0, r.z1 - r.z0),
				Math.atan2(r.x1 - r.x0, r.z1 - r.z0)
			);
	};
	if (level.act1) {
		for (const d of level.act1.decks) deck(d);
		// Shallow steps connect the raised arrival deck to the existing base path.
		const p = level.act1.zipline.end,
			ground = heightAt(world.heights, p.x - 5, p.z);
		const count = Math.ceil((p.y - ground) / 0.32);
		for (let i = 0; i < count; i++) {
			const top = ground + ((p.y - ground) * (i + 1)) / count;
			box(p.x - 2 - (count - i) * 0.5, top - 0.16, p.z, 0.55, 0.32, 1.8);
		}
	}
	for (const portal of level.portals ?? [level.portal])
		for (const p of portal.posts) box(p.x, p.y + p.height / 2, p.z, p.radius * 2, p.height, p.radius * 2);
	return boxes;
}
function source(b: {
	x: number;
	y: number;
	z: number;
	sx: number;
	sy: number;
	sz: number;
	yaw: number;
}): ColliderSource {
	const matrix = new Matrix4().makeRotationY(b.yaw);
	matrix.setPosition(b.x, b.y, b.z);
	return { geometry: new BoxGeometry(b.sx, b.sy, b.sz), matrix };
}
/** Owns traversal and the combined collision world. Updates use stable objects only. */
export class ParkRuntime {
	readonly ladder: Ladder;
	readonly zipline: Zipline;
	readonly traversal: ParkTraversal;
	readonly collision: CollisionWorld;
	readonly gates: readonly GateWorld[];
	readonly projection: PhotoProjection;
	photo: PhotoCamera;
	guide: GuideMechanicsBridge | undefined;
	pendingCapture = false;
	readonly eye = { x: 0, y: 0, z: 0 };
	unlocked = false;
	#revision = -1;
	readonly #life: { actor: LifeActor; subject: PhotoSubject }[] = [];
	readonly #zipAction: StoryAction;
	readonly #photoAction: StoryAction;
	constructor(
		readonly level: StoryLevel,
		readonly world: SurvivalWorld,
		readonly story: StoryGame,
		base: CollisionQuery
	) {
		const act = level.act1;
		if (!act) throw Error('park-needs-act1');
		const l = act.treehouse.ladder;
		this.ladder = new Ladder({
			id: l.id,
			base: l.bottom,
			top: { ...l.bottom, y: l.top.y },
			exit: l.top,
			radius: 0.8
		});
		this.zipline = new Zipline(act.zipline);
		const boxes = parkBoxes(level, world).map(source);
		this.gates = (level.portals ?? [level.portal]).map((p) => {
			const { from: a, to: b } = p.gate;
			const bottom = Math.min(a.y, b.y) - 1,
				top = Math.max(a.y, b.y) + 6.5;
			const s = source({
				x: (a.x + b.x) / 2,
				y: (bottom + top) / 2,
				z: (a.z + b.z) / 2,
				sx: 0.3,
				sy: top - bottom,
				sz: Math.hypot(b.x - a.x, b.z - a.z),
				yaw: Math.atan2(b.x - a.x, b.z - a.z)
			});
			const gate = new GateWorld([s]);
			s.geometry.dispose();
			return gate;
		});
		this.collision = new OwnedWorld(boxes, [base, ...this.gates]);
		for (const b of boxes) b.geometry.dispose();
		this.projection = new PhotoProjection(this.collision);
		this.photo = new PhotoCamera(
			act.birds.map((b) => ({ id: b.id, species: b.species, position: { ...b } }))
		);
		const park = this;
		this.traversal = new (class extends ParkTraversal {
			override step(dt: number, c: Character) {
				const result = super.step(dt, c);
				if (this.mode === 'zipline') {
					const p = park.zipline.position;
					// P21's departure cable dips 0.13 u under the plateau lip. Keep feet clear.
					p.y = Math.max(p.y, heightAt(world.heights, p.x, p.z) + 0.03);
					c.constrain(p, c.yaw, false);
				}
				return result;
			}
		})({
			ladders: [this.ladder],
			ziplines: [this.zipline],
			ziplineUnlocked: () => this.unlocked,
			beforeStep: () => this.sync()
		});
		this.#zipAction = { id: 'park-zipline', label: 'Descer de tirolesa', point: act.zipline.start };
		this.#photoAction = { id: 'park-photo', label: 'Fotografar', point: story.position };
		this.sync();
	}
	sync() {
		if (this.#revision === this.story.revision) return;
		this.#revision = this.story.revision;
		this.unlocked = this.story.completed(this.level.act1?.zipline.mission ?? 6);
		const portals = this.level.portals ?? [this.level.portal];
		for (let i = 0; i < this.gates.length; i++)
			this.gates[i].enabled = !this.story.completed(portals[i].mission);
	}
	setLife(life: LivingWorld) {
		const plan = planLife(this.world, this.level),
			subjects = [...this.photo.subjects];
		for (const actor of life.actors) {
			const species = plan.animals[actor.id]?.species;
			if (!species) continue;
			const subject: PhotoSubject = { id: `life-${actor.id}`, species, position: { ...actor.position } };
			subjects.push(subject);
			this.#life.push({ actor, subject });
		}
		this.photo = new PhotoCamera(subjects);
	}
	evaluate(camera: PerspectiveCamera) {
		for (const { actor, subject } of this.#life) {
			subject.enabled = actor.active;
			subject.position.x = actor.position.x;
			subject.position.y = actor.position.y + actor.eyeHeight;
			subject.position.z = actor.position.z;
		}
		this.projection.evaluate(this.photo, camera);
	}
	togglePhoto() {
		if (this.photo.phase === 'framing') this.photo.cancel();
		else if (this.traversal.mode === 'walk') this.photo.phase = 'framing';
	}
	context(p: Point): StoryAction | null {
		if (this.photo.phase === 'framing') {
			this.#photoAction.disabled = this.photo.validCount === 0;
			return this.#photoAction;
		}
		if (this.traversal.mode !== 'walk') return null;
		const s = this.zipline.spec.start;
		if (Math.hypot(p.x - s.x, p.y - s.y, p.z - s.z) <= 2.5) {
			this.#zipAction.disabled = !this.unlocked;
			this.#zipAction.label = this.#zipAction.disabled
				? 'Conclua a missão do mirante para usar a tirolesa'
				: 'Descer de tirolesa';
			return this.#zipAction;
		}
		return null;
	}
	shutter() {
		if (this.photo.action() === 'saved') this.pendingCapture = true;
	}
	capture(frame: CaptureFrame) {
		if (!this.pendingCapture) return;
		this.pendingCapture = false;
		const ids: string[] = [];
		for (let i = 0; i < this.photo.savedCount; i++) {
			const id = this.photo.saved[i]?.species;
			if (id) ids.push(id);
		}
		this.story.recordPhotos(ids);
		void this.guide?.photoSaved(this.photo, frame);
	}
}
