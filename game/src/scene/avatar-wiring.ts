import type { AvatarAnimator, AvatarInput } from '../animation/avatar-animator.ts';
import { type LookCandidate, pickLookTarget } from '../animation/look-target.ts';
import type { LivingWorld } from '../life/index.ts';
import type { StoryGame, StoryGesture } from '../missions/story.ts';
import type { Point } from '../survival/types.ts';

interface Candidate {
	id: number;
	kind: LookCandidate['kind'];
	x: number;
	y: number;
	z: number;
}
/** Event queue and cached look candidates. All hot-path objects are created once, not every frame. */
export class AvatarWiring {
	readonly candidates: Candidate[] = [];
	readonly #pet: Point = { x: 0, y: 0, z: 0 };
	readonly #queue = Array.from({ length: 8 }, () => ({
		id: 'cheer' as StoryGesture,
		point: { x: 0, y: 0, z: 0 },
		targeted: false
	}));
	#head = 0;
	#count = 0;
	#wait = 0;
	#revision = -1;
	#lastId: number | null = null;
	#life: LivingWorld | undefined;
	#animalStart = 0;
	lastGesture: StoryGesture | null = null;
	started = false;
	constructor(
		readonly animator: AvatarAnimator,
		readonly story?: StoryGame
	) {
		const iara = story?.level.landmarks.find((l) => l.kind === 'npc-iara');
		if (iara) this.candidates.push({ id: 0, kind: 'iara', x: iara.x, y: iara.y + 2.6, z: iara.z });
		for (const [i, c] of (story?.level.collectibles ?? []).entries())
			this.candidates.push({ id: 1000 + i, kind: 'collectible', x: c.x, y: c.y + 0.4, z: c.z });
		this.#animalStart = this.candidates.length;
	}
	setLife(life: LivingWorld) {
		this.#life = life;
		this.candidates.length = this.#animalStart;
		for (const a of life.actors)
			this.candidates.push({
				id: 100 + a.id,
				kind: 'animal',
				x: a.position.x,
				y: a.position.y + a.eyeHeight,
				z: a.position.z
			});
	}
	readonly enqueue = (id: StoryGesture, point: Point | null) => {
		if (this.#count === this.#queue.length) return;
		const slot = this.#queue[(this.#head + this.#count) % this.#queue.length];
		slot.id = id;
		slot.targeted = point !== null;
		if (point) {
			slot.point.x = point.x;
			slot.point.y = point.y;
			slot.point.z = point.z;
		}
		this.#count++;
	};
	update(input: AvatarInput, dt: number) {
		const story = this.story;
		if (story && this.#revision !== story.revision) {
			this.#revision = story.revision;
			let offset = this.candidates[0]?.kind === 'iara' ? 1 : 0;
			for (const c of story.level.collectibles) {
				const candidate = this.candidates[offset++];
				const visible =
					c.kind === 'jucara-fruit'
						? !story.data.fruits.includes(c.id)
						: !story.data.collected.includes(c.id) &&
							(c.kind !== 'gold-leaf' || (c.on !== '' ? story.available(3) : story.completed(c.mission)));
				candidate.x = visible ? c.x : Infinity;
			}
		}
		if (story) story.companion = null;
		if (this.#life)
			for (let i = 0; i < this.#life.actors.length; i++) {
				const a = this.#life.actors[i],
					c = this.candidates[this.#animalStart + i];
				c.x = a.active ? a.position.x : Infinity;
				c.y = a.position.y + a.eyeHeight;
				c.z = a.position.z;
				if (a.companion && story) {
					this.#pet.x = a.position.x;
					this.#pet.y = a.position.y + 0.4;
					this.#pet.z = a.position.z;
					story.companion = this.#pet;
				}
			}
		const look = pickLookTarget(this.candidates, input, this.#lastId);
		input.lookTarget = look;
		this.#lastId = look?.id ?? null;
		this.started = false;
		if (!this.#count) return;
		this.#wait += dt;
		const slot = this.#queue[this.#head];
		if (
			input.grounded &&
			input.speed < 0.05 &&
			input.intent < 0.05 &&
			!this.animator.states.emoting &&
			this.animator.playGesture(slot.id, slot.targeted ? slot.point : null)
		) {
			this.lastGesture = slot.id;
			this.started = true;
		} else if (this.#wait < 8) return;
		this.#head = (this.#head + 1) % this.#queue.length;
		this.#count--;
		this.#wait = 0;
		if (this.started) input.talking = false;
	}
	dispose() {
		if (this.story) {
			this.story.companion = null;
			if (this.story.onGesture === this.enqueue) this.story.onGesture = null;
		}
	}
}
