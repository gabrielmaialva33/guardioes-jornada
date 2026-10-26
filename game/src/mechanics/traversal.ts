import type { Character } from '../engine/character.ts';
import type { InputFrame } from '../engine/input.ts';
import type { TraversalDriver } from '../engine/traversal.ts';
import type { Canoe } from './canoe.ts';
import { distance } from './common.ts';
import type { Ladder } from './ladder.ts';
import type { Zipline } from './zipline.ts';
export interface TraversalOptions {
	ladders?: readonly Ladder[];
	ziplines?: readonly Zipline[];
	canoes?: readonly Canoe[];
	ziplineUnlocked?: (
		id: string
	) => boolean /** Update dynamic decks/colliders before character collision, at 60 Hz. */;
	beforeStep?: (dt: number, character: Character) => void;
}
const NO_LADDERS: readonly Ladder[] = [];
const NO_ZIPLINES: readonly Zipline[] = [];
const NO_CANOES: readonly Canoe[] = [];
export class ParkTraversal implements TraversalDriver {
	mode: 'walk' | 'ladder' | 'zipline' | 'canoe' = 'walk';
	active: Ladder | Zipline | Canoe | null = null;
	cameraLift = 0;
	cameraBehind: number | null = null;
	#action = false;
	#jump = false;
	#jumpHeld = false;
	#forward = 0;
	#turn = 0;
	constructor(readonly options: TraversalOptions) {}
	capture(input: InputFrame) {
		this.#action ||= input.actionPressed;
		this.#jump ||= input.jumpPressed;
		this.#jumpHeld = input.jumpHeld;
		this.#forward = input.moveY;
		this.#turn = input.moveX;
	}
	reset() {
		if (this.mode === 'ladder' && this.active) (this.active as Ladder).phase = 'idle';
		if (this.mode === 'zipline' && this.active) (this.active as Zipline).phase = 'idle';
		if (this.mode === 'canoe' && this.active) {
			const c = this.active as Canoe;
			c.phase = 'moored';
			c.position.x = c.spec.landings[0].water.x;
			c.position.y = c.spec.landings[0].water.y;
			c.position.z = c.spec.landings[0].water.z;
			c.speed = 0;
		}
		this.active = null;
		this.mode = 'walk';
		this.cameraLift = 0;
		this.cameraBehind = null;
		this.#action = this.#jump = false;
	}
	step(dt: number, c: Character) {
		this.options.beforeStep?.(dt, c);
		const action = this.#action,
			jump = this.#jump || this.#jumpHeld;
		this.#action = this.#jump = false;
		for (const l of this.options.ladders ?? NO_LADDERS)
			if (l !== this.active) l.step(dt, 0, false, c.options.walkSpeed);
		if (this.mode === 'walk') {
			if (action) {
				for (const z of this.options.ziplines ?? NO_ZIPLINES)
					if (
						distance(c.position, z.spec.start) <= 2.5 &&
						z.start(this.options.ziplineUnlocked?.(z.spec.id) ?? true)
					) {
						this.active = z;
						this.mode = 'zipline';
						break;
					}
				if (this.mode === 'walk')
					for (const boat of this.options.canoes ?? NO_CANOES)
						if (boat.board(c.position)) {
							this.active = boat;
							this.mode = 'canoe';
							break;
						}
			}
			if (this.mode === 'walk' && !jump)
				for (const l of this.options.ladders ?? NO_LADDERS)
					if ((action || l.contains(c.position)) && l.enter(c.position)) {
						this.active = l;
						this.mode = 'ladder';
						break;
					}
		}
		if (this.mode === 'ladder') {
			const l = this.active as Ladder;
			l.step(dt, this.#forward, jump, c.options.walkSpeed);
			c.constrain(
				l.position,
				Math.atan2(l.spec.exit.x - l.spec.base.x, l.spec.exit.z - l.spec.base.z),
				l.phase === 'top' || l.phase === 'bottom'
			);
			if (l.phase !== 'climbing') {
				if (l.phase === 'detached') {
					c.velocity.y = c.options.jumpSpeed;
					c.events.jumped = true;
				}
				this.active = null;
				this.mode = 'walk';
			}
			return true;
		}
		if (this.mode === 'zipline') {
			const z = this.active as Zipline;
			z.step(dt);
			const yaw = Math.atan2(z.spec.end.x - z.spec.start.x, z.spec.end.z - z.spec.start.z);
			c.constrain(z.position, yaw, z.phase === 'arrived');
			this.cameraBehind = yaw;
			if (z.phase === 'arrived') {
				this.active = null;
				this.mode = 'walk';
				this.cameraBehind = null;
			}
			return true;
		}
		if (this.mode === 'canoe') {
			const boat = this.active as Canoe;
			// The boarding action is consumed by boarding, never by disembarking in the same tick.
			if (action && this.cameraLift > 0 && boat.leave()) {
				c.constrain(boat.position, boat.yaw, true);
				boat.moor();
				this.active = null;
				this.mode = 'walk';
				this.cameraLift = 0;
				return true;
			}
			boat.step(dt, this.#forward, this.#turn);
			c.constrain(boat.position, boat.yaw);
			this.cameraLift = 1.5;
			return true;
		}
		return false;
	}
}
