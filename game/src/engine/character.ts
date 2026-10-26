/**
 * Kinematic capsule character over the collision BVH, tuned to feel like the
 * Roblox Humanoid: instant acceleration and full air control, one jump impulse
 * per ground contact (a held jump re-jumps only after a new landing), consumable
 * coyote time, a jump buffer, ground snap on slopes and steps, an explicit step
 * height and a maximum walkable slope.
 *
 * The character owns its world-space feet position; the scene copies the
 * interpolated pose to the avatar with placeObject(), which handles a parent.
 *
 * Adapted from BvhCharacterPhysics in @pmndrs/viverse 0.2.29 (src/physics/index.ts,
 * npm tarball of 2026-10-16): the segment-vs-triangle push-out over a BVH
 * shapecast. Changes, with the reasons in p2-engine.md:
 * - the position is world space, never read from model.position (the original
 *   skipped the read without a parent and fell through the floor);
 * - grounded (contact now) is separate from canJump (grounded or unspent coyote);
 * - coyote 0.08 s, consumed by a jump; a 0.1 s jump buffer;
 * - walkable contacts resolve vertically and steep ones horizontally, so standing
 *   never drifts and steep slopes block instead of being climbed;
 * - ground snap, an explicit step-up attempt and max slope;
 * - velocity into walls and ceilings is removed (a ceiling cancels the rise);
 * - exact constant-gravity integration, no damping, Roblox constants;
 * - one external fixed clock: substeps here are spatial, there is no catch-up loop.
 *
 * Copyright 2024 Bela Bohlender
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy of this software and
 * associated documentation files (the "Software"), to deal in the Software without restriction, including
 * without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the
 * following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all copies or substantial
 * portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT
 * LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO
 * EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER
 * IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR
 * THE USE OR OTHER DEALINGS IN THE SOFTWARE.
 */
import { Box3, Line3, Matrix4, type Object3D, Quaternion, Vector3 } from 'three';
import type { ExtendedTriangle } from 'three-mesh-bvh';
import {
	CAPSULE_HEIGHT,
	CAPSULE_RADIUS,
	COYOTE_TIME,
	FACING_RATE,
	GRAVITY,
	JUMP_BUFFER,
	JUMP_SPEED,
	MAX_FALL_SPEED,
	MAX_SLOPE,
	STEP_HEIGHT,
	WALK_SPEED
} from './constants.ts';
import { damp, lerpAngle, wrapAngle } from './math.ts';
import type { CollisionQuery } from './world.ts';

export interface Vec3 {
	x: number;
	y: number;
	z: number;
}

/** One tick of intent, already in world space (see cameraRelativeMove). */
export interface CharacterInput {
	/** Horizontal direction; a length below 1 walks slower (analog stick). */
	moveX: number;
	moveZ: number;
	/** Held jump re-jumps on every new landing, like holding Space in Roblox. */
	jumpHeld: boolean;
	/** Yaw the body must face (shift-lock, first person); null turns toward the movement. */
	faceYaw: number | null;
}

export interface CharacterOptions {
	radius: number;
	height: number;
	walkSpeed: number;
	gravity: number;
	jumpSpeed: number;
	stepHeight: number;
	/** Steepest walkable ground, in radians. */
	maxSlope: number;
	coyoteTime: number;
	jumpBuffer: number;
	maxFallSpeed: number;
	facingRate: number;
}

export const CHARACTER_DEFAULTS: Readonly<CharacterOptions> = {
	radius: CAPSULE_RADIUS,
	height: CAPSULE_HEIGHT,
	walkSpeed: WALK_SPEED,
	gravity: GRAVITY,
	jumpSpeed: JUMP_SPEED,
	stepHeight: STEP_HEIGHT,
	maxSlope: MAX_SLOPE,
	coyoteTime: COYOTE_TIME,
	jumpBuffer: JUMP_BUFFER,
	maxFallSpeed: MAX_FALL_SPEED,
	facingRate: FACING_RATE
};

/** What happened during the last tick, for animation, sound and dust. */
export interface CharacterEvents {
	jumped: boolean;
	landed: boolean;
	/** Downward speed at landing, in u/s. */
	landingSpeed: number;
	/** Walked off a ledge (coyote time starts). */
	leftGround: boolean;
}

/** Contacts resolved per position, deepest first; an inner corner takes two. */
const MAX_ITERATIONS = 6;
/** Spatial substeps per move; each moves at most half a radius so thin walls cannot be skipped. */
const MAX_SUBSTEPS = 8;
/** Contact normals kept per move for velocity projection. */
const MAX_BLOCKERS = 8;
/** A contact whose direction is this close to the triangle normal is a face, not an edge or vertex. */
const FACE_DOT = 0.9999;
/** Extra drop when the step attempt comes back down, so the landing registers as a contact. */
const STEP_PROBE = 0.02;
/** A step attempt must beat the plain move by this much. */
const PROGRESS_EPSILON = 1e-4;
const TIMER_EPSILON = 1e-6;

class Contacts {
	ground = false;
	readonly groundNormal = new Vector3(0, 1, 0);
	/** Highest walkable contact point: the top of a step even when standing on its rounded edge. */
	groundHeight = Number.NEGATIVE_INFINITY;
	readonly blockers = Array.from({ length: MAX_BLOCKERS }, () => new Vector3());
	blockerCount = 0;

	reset() {
		this.ground = false;
		this.groundNormal.set(0, 1, 0);
		this.groundHeight = Number.NEGATIVE_INFINITY;
		this.blockerCount = 0;
	}
}

const segment = new Line3();
const bounds = new Box3();
const trianglePoint = new Vector3();
const capsulePoint = new Vector3();
const deepTriangle = new Vector3();
const deepCapsule = new Vector3();
const faceNormal = new Vector3();
const normal = new Vector3();
const direction = new Vector3();
const middle = new Vector3();

export class Character {
	readonly options: CharacterOptions;
	/** Feet (bottom of the capsule), world space, at the latest tick. */
	readonly position = new Vector3();
	readonly previousPosition = new Vector3();
	/** Velocity the body keeps by itself (jump, gravity, sliding). Walking is not stored: it is instant. */
	readonly velocity = new Vector3();
	/** Normal of the ground under the feet while grounded; rounded on ledges. */
	readonly groundNormal = new Vector3(0, 1, 0);
	readonly events: CharacterEvents = { jumped: false, landed: false, landingSpeed: 0, leftGround: false };
	/** Body yaw: 0 faces +z, like the POC's atan2(x, z). */
	yaw = 0;
	previousYaw = 0;
	/** Touching walkable ground now. */
	grounded = false;
	/** Horizontal distance actually covered in the last tick, per second (animation speed). */
	planarSpeed = 0;
	readonly #world: CollisionQuery;
	readonly #cosMaxSlope: number;
	#coyote = 0;
	#jumpBuffer = 0;
	/** Distance from the capsule axis to the closest triangle found by the current query. */
	#deepest = 0;
	/** Direction of the current sweep, used to judge edge contacts. */
	readonly #motion = new Vector3();
	#moving = false;
	readonly #moveContacts = new Contacts();
	readonly #stepContacts = new Contacts();
	readonly #snapContacts = new Contacts();
	readonly #plain = new Vector3();
	readonly #stepped = new Vector3();
	readonly #probe = new Vector3();

	constructor(world: CollisionQuery, feet: Vec3, yaw = 0, options: Partial<CharacterOptions> = {}) {
		this.#world = world;
		this.options = { ...CHARACTER_DEFAULTS, ...options };
		this.#cosMaxSlope = Math.cos(this.options.maxSlope);
		this.teleport(feet, yaw);
	}

	/** Grounded, or airborne after walking off a ledge with coyote time left. */
	get canJump(): boolean {
		return this.grounded || this.#coyote > TIMER_EPSILON;
	}

	/** Registers a jump press; it stays valid for the jump buffer. */
	pressJump() {
		this.#jumpBuffer = this.options.jumpBuffer;
	}

	/** Moves without sweeping (spawn, respawn) and settles on the ground below, if any. */
	teleport(feet: Vec3, yaw = this.yaw) {
		this.position.set(feet.x, feet.y, feet.z);
		this.velocity.set(0, 0, 0);
		this.yaw = wrapAngle(yaw);
		this.#coyote = 0;
		this.#jumpBuffer = 0;
		this.#snapContacts.reset();
		this.#resolve(this.position, this.#snapContacts);
		this.grounded = this.#snap(this.position);
		this.previousPosition.copy(this.position);
		this.previousYaw = this.yaw;
		this.planarSpeed = 0;
	}

	/** One constrained fixed tick, owned by a traversal driver; keeps interpolation and clears jump debt. */
	constrain(feet: Vec3, yaw: number, grounded = false) {
		this.previousPosition.copy(this.position);
		this.previousYaw = this.yaw;
		this.position.copy(feet);
		this.yaw = yaw;
		this.velocity.set(0, 0, 0);
		this.grounded = grounded;
		this.groundNormal.set(0, 1, 0);
		this.#coyote = this.#jumpBuffer = 0;
		this.events.jumped = this.events.landed = this.events.leftGround = false;
		this.events.landingSpeed = 0;
		this.planarSpeed = 0;
	}

	/** Advances one fixed tick. */
	step(dt: number, input: CharacterInput) {
		const options = this.options;
		const events = this.events;
		events.jumped = events.landed = events.leftGround = false;
		events.landingSpeed = 0;
		this.previousPosition.copy(this.position);
		this.previousYaw = this.yaw;

		let moveX = Number.isFinite(input.moveX) ? input.moveX : 0;
		let moveZ = Number.isFinite(input.moveZ) ? input.moveZ : 0;
		const amount = Math.hypot(moveX, moveZ);
		if (amount > 1) {
			moveX /= amount;
			moveZ /= amount;
		}

		if (input.faceYaw !== null && Number.isFinite(input.faceYaw)) this.yaw = wrapAngle(input.faceYaw);
		else if (amount > 1e-3)
			this.yaw = lerpAngle(this.yaw, Math.atan2(moveX, moveZ), damp(options.facingRate, dt));

		if ((this.#jumpBuffer > TIMER_EPSILON || input.jumpHeld) && this.canJump) {
			this.velocity.y = options.jumpSpeed;
			this.grounded = false;
			this.#coyote = 0;
			this.#jumpBuffer = 0;
			events.jumped = true;
		}

		if (this.grounded) this.#walk(dt, moveX * options.walkSpeed, moveZ * options.walkSpeed);
		else this.#fly(dt, moveX * options.walkSpeed, moveZ * options.walkSpeed);

		this.#jumpBuffer = Math.max(0, this.#jumpBuffer - dt);
		if (!this.grounded) this.#coyote = Math.max(0, this.#coyote - dt);
		this.planarSpeed =
			Math.hypot(this.position.x - this.previousPosition.x, this.position.z - this.previousPosition.z) / dt;
	}

	/** Render position between the last two ticks (alpha from FixedTimestep). */
	interpolate(alpha: number, target = new Vector3()): Vector3 {
		return target.lerpVectors(this.previousPosition, this.position, alpha);
	}

	interpolateYaw(alpha: number): number {
		return lerpAngle(this.previousYaw, this.yaw, alpha);
	}

	/** Grounded move: walk, try a step if blocked, then snap to the ground below. */
	#walk(dt: number, walkX: number, walkZ: number) {
		const start = this.position;
		const dx = walkX * dt;
		const dz = walkZ * dt;
		const wanted = Math.hypot(dx, dz);
		const plain = this.#plain.copy(start);
		this.#moveContacts.reset();
		this.#sweep(plain, dx, 0, dz, this.#moveContacts);
		let result = plain;
		if (wanted > 1e-9) {
			const plainProgress = progressAlong(start, plain, dx, dz, wanted);
			if (plainProgress < wanted - PROGRESS_EPSILON) {
				// Blocked: try again lifted by the step height, then come back down.
				const height = this.options.stepHeight;
				const stepped = this.#stepped.copy(start);
				const contacts = this.#stepContacts;
				contacts.reset();
				this.#sweep(stepped, 0, height, 0, contacts);
				this.#sweep(stepped, dx, 0, dz, contacts);
				contacts.reset();
				this.#sweep(stepped, 0, -(height + STEP_PROBE), 0, contacts);
				// The rise is measured between support points: standing on a step's rounded edge
				// puts the feet lower than its top.
				const support = start.y + this.options.radius * (1 - this.groundNormal.y);
				if (
					contacts.ground &&
					contacts.groundHeight - support <= height + PROGRESS_EPSILON &&
					progressAlong(start, stepped, dx, dz, wanted) > plainProgress + PROGRESS_EPSILON
				)
					result = stepped;
			}
		}
		this.position.copy(result);
		this.velocity.set(0, 0, 0);
		if (!this.#snap(this.position)) {
			this.grounded = false;
			this.#coyote = this.options.coyoteTime;
			this.events.leftGround = true;
		}
	}

	/** Airborne move: exact constant-gravity integration, then velocity response to contacts. */
	#fly(dt: number, walkX: number, walkZ: number) {
		const { gravity, maxFallSpeed } = this.options;
		const velocity = this.velocity;
		const dy = velocity.y * dt - 0.5 * gravity * dt * dt;
		velocity.y = Math.max(velocity.y - gravity * dt, -maxFallSpeed);
		const contacts = this.#moveContacts;
		contacts.reset();
		this.#sweep(this.position, (walkX + velocity.x) * dt, dy, (walkZ + velocity.z) * dt, contacts);
		for (let i = 0; i < contacts.blockerCount; i++) {
			const blocker = contacts.blockers[i];
			const into = velocity.dot(blocker);
			if (into < 0) velocity.addScaledVector(blocker, -into);
		}
		if (contacts.ground && velocity.y <= 0) {
			this.grounded = true;
			this.groundNormal.copy(contacts.groundNormal);
			this.events.landed = true;
			this.events.landingSpeed = -velocity.y;
			velocity.set(0, 0, 0);
		}
	}

	/** Drops `feet` by up to the step height onto walkable ground; leaves it untouched if there is none. */
	#snap(feet: Vector3): boolean {
		const probe = this.#probe.copy(feet);
		const contacts = this.#snapContacts;
		contacts.reset();
		this.#sweep(probe, 0, -this.options.stepHeight, 0, contacts);
		if (!contacts.ground) return false;
		feet.copy(probe);
		this.groundNormal.copy(contacts.groundNormal);
		return true;
	}

	/** Moves in substeps of at most half a radius, resolving penetration after each. */
	#sweep(feet: Vector3, dx: number, dy: number, dz: number, contacts: Contacts) {
		const limit = this.options.radius * 0.5;
		let length = Math.hypot(dx, dy, dz);
		if (!(length > 0)) {
			this.#moving = false;
			this.#resolve(feet, contacts);
			return;
		}
		if (length > limit * MAX_SUBSTEPS) {
			const scale = (limit * MAX_SUBSTEPS) / length;
			dx *= scale;
			dy *= scale;
			dz *= scale;
			length = limit * MAX_SUBSTEPS;
		}
		const steps = Math.max(1, Math.ceil(length / limit - 1e-9));
		this.#motion.set(dx, dy, dz).divideScalar(length);
		this.#moving = true;
		for (let i = 0; i < steps; i++) {
			feet.x += dx / steps;
			feet.y += dy / steps;
			feet.z += dz / steps;
			this.#resolve(feet, contacts);
		}
	}

	/**
	 * Pushes the capsule out of the world one contact at a time, deepest first.
	 * At the seam of two coplanar triangles the neighbour reports the shared edge
	 * with a tilted normal, but the face under the capsule is always at least as
	 * deep, and once it is resolved the edge is out of reach. (The original pushed
	 * per triangle in visit order, so a ramp's diagonal could shove it sideways.)
	 */
	#resolve(feet: Vector3, contacts: Contacts) {
		const { radius, height } = this.options;
		for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
			segment.start.set(feet.x, feet.y + radius, feet.z);
			segment.end.set(feet.x, feet.y + height - radius, feet.z);
			bounds.min.set(feet.x - radius, feet.y, feet.z - radius);
			bounds.max.set(feet.x + radius, feet.y + height, feet.z + radius);
			this.#deepest = radius;
			this.#world.shapecast(bounds, this.#visit);
			if (this.#deepest >= radius || !this.#push(feet, contacts)) return;
		}
	}

	/** Keeps the triangle closest to the capsule axis; the triangle object is reused by the BVH. */
	readonly #visit = (triangle: ExtendedTriangle) => {
		const distance = triangle.closestPointToSegment(segment, trianglePoint, capsulePoint);
		if (distance >= this.#deepest) return;
		this.#deepest = distance;
		deepTriangle.copy(trianglePoint);
		deepCapsule.copy(capsulePoint);
		triangle.getNormal(faceNormal);
	};

	/**
	 * Resolves the deepest contact. Walkable contacts lift the capsule straight up,
	 * steep up-facing ones push it horizontally (a wall to walk into, a slide when
	 * falling), walls and ceilings push along their normal. Faces use the plane
	 * distance and edges or vertices the exact point distance, so a resolved pose
	 * resolves to itself and standing never drifts.
	 */
	#push(feet: Vector3, contacts: Contacts): boolean {
		const radius = this.options.radius;
		let distance = this.#deepest;
		let face = true;
		const offset = deepCapsule.sub(deepTriangle);
		if (distance > 1e-9) {
			normal.copy(offset).divideScalar(distance);
			face = Math.abs(normal.dot(faceNormal)) > FACE_DOT;
			if (!face && this.#moving) {
				// Judge an edge or vertex by the normal where the capsule first touched it on
				// the way in, so the verdict does not depend on how deep this substep went.
				const along = offset.dot(this.#motion);
				const back = along + Math.sqrt(along * along - distance * distance + radius * radius);
				normal.copy(offset).addScaledVector(this.#motion, -back).divideScalar(radius);
			}
		} else {
			// The axis touches the triangle: leave through the face on the side of the capsule's middle.
			normal.copy(faceNormal);
			middle.addVectors(segment.start, segment.end).multiplyScalar(0.5).sub(deepTriangle);
			const side = middle.dot(normal);
			if (side < 0 || (side === 0 && normal.y < 0)) normal.negate();
			distance = Math.min(
				direction.subVectors(segment.start, deepTriangle).dot(normal),
				direction.subVectors(segment.end, deepTriangle).dot(normal)
			);
		}

		if (normal.y >= this.#cosMaxSlope) {
			direction.set(0, 1, 0);
			if (!contacts.ground || normal.y > contacts.groundNormal.y) contacts.groundNormal.copy(normal);
			contacts.ground = true;
			contacts.groundHeight = Math.max(contacts.groundHeight, deepTriangle.y);
		} else {
			if (normal.y > 0) direction.set(normal.x, 0, normal.z).normalize();
			else direction.copy(normal);
			if (contacts.blockerCount < MAX_BLOCKERS) contacts.blockers[contacts.blockerCount++].copy(normal);
		}
		let push: number;
		if (face) push = (radius - distance) / normal.dot(direction);
		else {
			// Exact: the move along `direction` that puts the touched point back at one radius.
			const along = offset.dot(direction);
			push = -along + Math.sqrt(Math.max(0, along * along - distance * distance + radius * radius));
		}
		if (!(push > 0) || !Number.isFinite(push)) return false;
		feet.addScaledVector(direction, push);
		return true;
	}
}

/** Horizontal distance from `from` to `to` along the wanted move (dx, dz) of length `wanted`. */
function progressAlong(from: Vector3, to: Vector3, dx: number, dz: number, wanted: number): number {
	return ((to.x - from.x) * dx + (to.z - from.z) * dz) / wanted;
}

const inverseParent = new Matrix4();
const parentRotation = new Quaternion();
const UP = new Vector3(0, 1, 0);

/**
 * Places an avatar at a world-space feet position and yaw, whatever its parent's
 * transform (the viverse port read model.position only when it had a parent).
 */
export function placeObject(object: Object3D, feet: Vec3, yaw: number) {
	object.position.set(feet.x, feet.y, feet.z);
	object.quaternion.setFromAxisAngle(UP, yaw);
	const parent = object.parent;
	if (parent) {
		parent.updateWorldMatrix(true, false);
		inverseParent.copy(parent.matrixWorld).invert();
		object.position.applyMatrix4(inverseParent);
		parent.getWorldQuaternion(parentRotation);
		object.quaternion.premultiply(parentRotation.invert());
	}
}

/**
 * Turns stick or keyboard intent (x right, y forward, relative to the camera)
 * into a world direction for a camera with the given orbit yaw.
 */
export function cameraRelativeMove(x: number, y: number, cameraYaw: number, target = { x: 0, z: 0 }) {
	const sin = Math.sin(cameraYaw);
	const cos = Math.cos(cameraYaw);
	target.x = x * cos - y * sin;
	target.z = -x * sin - y * cos;
	return target;
}
