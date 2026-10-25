/**
 * One player's frame in a fixed order: input turns the camera, the fixed ticks
 * move the character and check the checkpoints, then the camera follows the
 * interpolated pose (Roblox Classic: no positional lag). The scene calls
 * update() once per rendered frame, then copies `position`/`yaw` to the avatar
 * (placeObject) and `pose` to the three camera (applyCameraPose).
 */
import { Vector3 } from 'three';
import { type CameraLens, type CameraPose, DEFAULT_LENS, OrbitCamera } from './camera.ts';
import {
	Character,
	type CharacterInput,
	type CharacterOptions,
	cameraRelativeMove,
	type Vec3
} from './character.ts';
import type { Checkpoint, CheckpointEvent, CheckpointTracker } from './checkpoints.ts';
import type { InputFrame } from './input.ts';
import { wrapAngle } from './math.ts';
import { FixedTimestep } from './timestep.ts';
import type { CollisionWorld } from './world.ts';

export interface PlayerFrame {
	/** Fixed ticks run this frame (0 to MAX_STEPS_PER_FRAME). */
	ticks: number;
	alpha: number;
	/** Interpolated feet position and body yaw for the avatar. */
	readonly position: Vector3;
	yaw: number;
	pose: CameraPose;
	grounded: boolean;
	/** Horizontal speed over the last tick, for the walk/run blend. */
	speed: number;
	/** Some tick of this frame jumped or landed; the hardest landing speed. */
	jumped: boolean;
	landed: boolean;
	landingSpeed: number;
	/** Checkpoint, fall and respawn events of this frame's ticks, oldest first. */
	readonly events: CheckpointEvent[];
}

export interface PlayerControllerOptions {
	yaw?: number;
	checkpoints?: CheckpointTracker | null;
	camera?: OrbitCamera;
	character?: Partial<CharacterOptions>;
	clock?: FixedTimestep;
}

export class PlayerController {
	readonly world: CollisionWorld;
	readonly character: Character;
	readonly camera: OrbitCamera;
	readonly clock: FixedTimestep;
	readonly checkpoints: CheckpointTracker | null;
	readonly frame: PlayerFrame;
	readonly #move = { x: 0, z: 0 };
	readonly #input: CharacterInput = { moveX: 0, moveZ: 0, jumpHeld: false, faceYaw: null };

	constructor(world: CollisionWorld, spawn: Vec3, options: PlayerControllerOptions = {}) {
		const yaw = options.yaw ?? 0;
		this.world = world;
		this.character = new Character(world, spawn, yaw, options.character);
		this.camera = options.camera ?? new OrbitCamera();
		this.clock = options.clock ?? new FixedTimestep();
		this.checkpoints = options.checkpoints ?? null;
		this.camera.snapBehind(yaw);
		this.frame = {
			ticks: 0,
			alpha: 0,
			position: this.character.position.clone(),
			yaw,
			pose: this.camera.pose,
			grounded: this.character.grounded,
			speed: 0,
			jumped: false,
			landed: false,
			landingSpeed: 0,
			events: []
		};
	}

	update(frameSeconds: number, input: InputFrame, lens: CameraLens = DEFAULT_LENS): PlayerFrame {
		const { camera, character, frame } = this;
		camera.shiftLock = input.shiftLock;
		camera.look(input.mouseLookX, input.mouseLookY, 'mouse');
		camera.look(input.touchLookX, input.touchLookY, 'touch');
		camera.zoom(input.zoomDelta);
		if (input.jumpPressed) character.pressJump();

		const move = cameraRelativeMove(input.moveX, input.moveY, camera.yaw, this.#move);
		const tickInput = this.#input;
		tickInput.moveX = move.x;
		tickInput.moveZ = move.z;
		tickInput.jumpHeld = input.jumpHeld;
		tickInput.faceYaw = camera.firstPerson || camera.shiftLock ? wrapAngle(camera.yaw + Math.PI) : null;

		frame.jumped = frame.landed = false;
		frame.landingSpeed = 0;
		frame.events.length = 0;
		frame.ticks = this.clock.advance(frameSeconds, this.#tick);
		frame.alpha = this.clock.alpha;
		character.interpolate(frame.alpha, frame.position);
		frame.yaw = character.interpolateYaw(frame.alpha);
		frame.grounded = character.grounded;
		frame.speed = character.planarSpeed;
		frame.pose = camera.update(frameSeconds, frame.position, this.world, lens);
		return frame;
	}

	/** Puts the character on a checkpoint at once, with the camera behind it. */
	respawnAt(checkpoint: Checkpoint) {
		this.character.teleport(checkpoint.spawn, checkpoint.yaw);
		this.camera.snapBehind(checkpoint.yaw);
	}

	/** After a pause (hidden page, modal): the next frame does not replay the gap. */
	resume() {
		this.clock.reset();
	}

	readonly #tick = (dt: number) => {
		const { character, frame } = this;
		character.step(dt, this.#input);
		const events = character.events;
		if (events.jumped) frame.jumped = true;
		if (events.landed) {
			frame.landed = true;
			frame.landingSpeed = Math.max(frame.landingSpeed, events.landingSpeed);
		}
		const event = this.checkpoints?.update(dt, character.position);
		if (!event) return;
		frame.events.push(event);
		if (event.type === 'respawn') this.respawnAt(event.checkpoint);
	};
}
