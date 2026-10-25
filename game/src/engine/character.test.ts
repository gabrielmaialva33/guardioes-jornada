import { Group, Vector3 } from 'three';
import { expect, it } from 'vitest';
import { Character, type CharacterInput, cameraRelativeMove, placeObject } from './character.ts';
import { CAPSULE_RADIUS, JUMP_AIRTIME, JUMP_HEIGHT, STEP_HEIGHT, WALK_SPEED } from './constants.ts';
import {
	buildCollisionWorld,
	createGraybox,
	LOW_CEILING_BOTTOM,
	STEP_HIGH,
	THIN_WALL_THICKNESS,
	type V3
} from './graybox.ts';

const DT = 1 / 60;
const level = createGraybox();
const world = buildCollisionWorld(level);
const at = ([x, y, z]: V3) => ({ x, y, z });
const idle: CharacterInput = { moveX: 0, moveZ: 0, jumpHeld: false, faceYaw: null };
const forward: CharacterInput = { ...idle, moveZ: 1 };

/** Steps `ticks` times; `input` may change per tick, `each` observes after every tick. */
function run(
	character: Character,
	ticks: number,
	input: CharacterInput | ((tick: number) => CharacterInput),
	each?: (tick: number) => void
) {
	for (let tick = 0; tick < ticks; tick++) {
		character.step(DT, typeof input === 'function' ? input(tick) : input);
		each?.(tick);
	}
}

it.each([
	['flat ground', at(level.marks.spawn)],
	['the 30° ramp', { x: -26, y: 3 * Math.tan(Math.PI / 6) + 0.1, z: 9 }],
	['the log', { x: -8, y: 0.9, z: 8 }],
	['a ledge edge', { x: -20, y: 0.5, z: 6 - 0.2 }]
])('stands still on %s for 10 s without drifting', (_, spawn) => {
	const character = new Character(world, spawn);
	expect(character.grounded).toBe(true);
	const start = character.position.clone();
	run(character, 600, idle, () => expect(character.grounded).toBe(true));
	expect(character.position.distanceTo(start)).toBeLessThan(1e-9);
});

it('jumps the Roblox height and airtime', () => {
	const character = new Character(world, at(level.marks.spawn));
	character.pressJump();
	let top = 0;
	let airborne = 0;
	run(character, 60, idle, () => {
		top = Math.max(top, character.position.y);
		if (!character.grounded) airborne++;
	});
	expect(Math.abs(top - JUMP_HEIGHT)).toBeLessThan(0.01);
	expect(Math.abs(airborne * DT - JUMP_AIRTIME)).toBeLessThanOrEqual(DT);
});

it('reaches full speed in one tick, stops in one, and steers fully in the air', () => {
	const character = new Character(world, at(level.marks.spawn));
	run(character, 1, forward);
	expect(character.position.z).toBeCloseTo(WALK_SPEED * DT, 12);
	expect(character.planarSpeed).toBeCloseTo(WALK_SPEED, 9);
	run(character, 1, idle);
	expect(character.planarSpeed).toBe(0);

	character.pressJump();
	run(character, 5, forward);
	expect(character.grounded).toBe(false);
	const before = character.position.clone();
	run(character, 1, { ...idle, moveX: 1 });
	expect(character.position.x - before.x).toBeCloseTo(WALK_SPEED * DT, 12);
	expect(character.position.z - before.z).toBeCloseTo(0, 12);
});

it('re-jumps a held jump only after each new landing', () => {
	const character = new Character(world, at(level.marks.spawn));
	const log: string[] = [];
	let lastVy = Number.POSITIVE_INFINITY;
	run(character, 180, { ...idle, jumpHeld: true }, () => {
		if (character.events.jumped) log.push('jump');
		if (character.events.landed) log.push('land');
		if (!character.grounded && !character.events.jumped) {
			// One impulse per contact: in the air the vertical speed only ever falls.
			expect(character.velocity.y).toBeLessThan(lastVy);
		}
		lastVy = character.velocity.y;
	});
	expect(log.length).toBeGreaterThanOrEqual(6);
	for (const [i, event] of log.entries()) expect(event).toBe(i % 2 === 0 ? 'jump' : 'land');
});

it('gives a short coyote time that one jump consumes', () => {
	const jumpAt = (airTick: number) => {
		const character = new Character(world, at(level.marks.rampTop));
		let air = -1;
		let jumps = 0;
		run(character, 90, forward, () => {
			if (character.events.jumped) jumps++;
			if (air >= 0) air++;
			if (character.events.leftGround) air = 0;
			if (air === airTick) {
				character.pressJump();
				character.step(DT, forward);
				if (character.events.jumped) jumps++;
				// The coyote is spent: a second press in the air does nothing.
				character.pressJump();
				character.step(DT, forward);
				if (character.events.jumped) jumps++;
			}
		});
		return jumps;
	};
	expect(jumpAt(3)).toBe(1);
	expect(jumpAt(7)).toBe(0);
});

it('buffers a jump pressed just before landing', () => {
	const landingTick = () => {
		const character = new Character(world, { x: 0, y: 3, z: 0 });
		let landed = -1;
		run(character, 60, idle, (tick) => {
			if (character.events.landed && landed < 0) landed = tick;
		});
		return landed;
	};
	const land = landingTick();
	const jumpsWhenPressedBefore = (ticksBefore: number) => {
		const character = new Character(world, { x: 0, y: 3, z: 0 });
		let jumped = -1;
		run(character, land + 3, idle, (tick) => {
			if (character.events.jumped && jumped < 0) jumped = tick;
			if (tick === land - ticksBefore) character.pressJump();
		});
		return jumped;
	};
	expect(jumpsWhenPressedBefore(5)).toBe(land + 1);
	expect(jumpsWhenPressedBefore(9)).toBe(-1);
});

it('walks up and down the walkable ramp without leaving the ground', () => {
	const character = new Character(world, at(level.marks.walkableRamp));
	run(character, 70, forward, () => expect(character.grounded).toBe(true));
	expect(character.position.y).toBeCloseTo(level.marks.rampTop[1], 6);
	run(character, 90, { ...idle, moveZ: -1 }, () => expect(character.grounded).toBe(true));
	expect(character.position.y).toBeCloseTo(0, 9);
});

it('is blocked by the ramp above the slope limit', () => {
	const character = new Character(world, at(level.marks.steepRamp));
	run(character, 120, forward, () => {
		expect(character.position.y).toBeLessThan(1e-9);
		expect(character.grounded).toBe(true);
	});
	expect(character.position.z).toBeGreaterThan(5.5);
	expect(character.position.z).toBeLessThan(6);
});

it('steps up to the step height and is blocked just above it', () => {
	const low = new Character(world, at(level.marks.stepLimit));
	run(low, 30, forward, () => expect(low.grounded).toBe(true));
	expect(low.position.y).toBeCloseTo(STEP_HEIGHT, 6);
	expect(low.position.z).toBeGreaterThan(7);
	// And back down the far side without leaving the ground.
	run(low, 30, forward, () => expect(low.grounded).toBe(true));
	expect(low.position.y).toBeCloseTo(0, 9);

	const high = new Character(world, at(level.marks.stepHigh));
	run(high, 60, forward, () => expect(high.position.y).toBeLessThan(1e-9));
	// Held off by the box's top edge, 0.05 below the bottom sphere's centre.
	expect(high.position.z).toBeCloseTo(
		6 - Math.sqrt(CAPSULE_RADIUS ** 2 - (CAPSULE_RADIUS - STEP_HIGH) ** 2),
		6
	);
	expect(STEP_HIGH).toBeGreaterThan(STEP_HEIGHT);
});

it('needs a jump to cross the fallen log', () => {
	const walker = new Character(world, at(level.marks.log));
	run(walker, 90, forward);
	expect(walker.position.z).toBeLessThan(8);
	const jumper = new Character(world, at(level.marks.log));
	run(jumper, 90, (tick) => ({ ...forward, jumpHeld: tick === 15 }));
	expect(jumper.position.z).toBeGreaterThan(9);
	expect(jumper.grounded).toBe(true);
});

it('cancels the rise when the head hits the low ceiling', () => {
	const character = new Character(world, at(level.marks.lowCeiling));
	character.pressJump();
	let top = 0;
	let airborne = 0;
	run(character, 60, idle, () => {
		top = Math.max(top, character.position.y);
		if (!character.grounded) airborne++;
	});
	expect(top).toBeLessThanOrEqual(LOW_CEILING_BOTTOM - character.options.height + 1e-6);
	expect(airborne * DT).toBeLessThan(0.2);
	expect(character.grounded).toBe(true);
});

it('settles into an inner corner without jitter or penetration', () => {
	const character = new Character(world, at(level.marks.corner));
	const diagonal = { ...idle, moveX: Math.SQRT1_2, moveZ: Math.SQRT1_2 };
	run(character, 120, diagonal, () => {
		expect(character.position.x).toBeLessThanOrEqual(24 - CAPSULE_RADIUS + 1e-6);
		expect(character.position.z).toBeLessThanOrEqual(12 - CAPSULE_RADIUS + 1e-6);
	});
	const settled = character.position.clone();
	run(character, 30, diagonal);
	expect(character.position.distanceTo(settled)).toBeLessThan(1e-9);
	expect(settled.x).toBeCloseTo(24 - CAPSULE_RADIUS, 6);
	expect(settled.z).toBeCloseTo(12 - CAPSULE_RADIUS, 6);
});

it('never passes through the thin wall or the thin bridge deck', () => {
	const runner = new Character(world, at(level.marks.thinWall));
	const face = 10 - THIN_WALL_THICKNESS / 2;
	run(runner, 180, forward, () =>
		expect(runner.position.z).toBeLessThanOrEqual(face - CAPSULE_RADIUS + 1e-6)
	);
	expect(runner.position.z).toBeCloseTo(face - CAPSULE_RADIUS, 6);

	// Dropped from 40 u it hits the deck near terminal speed, over a metre per tick.
	const faller = new Character(world, { x: 8, y: 40, z: 11 });
	let fastest = 0;
	run(faller, 120, idle, () => (fastest = Math.max(fastest, -faller.velocity.y)));
	expect(fastest * DT).toBeGreaterThan(1);
	expect(faller.grounded).toBe(true);
	expect(faller.position.y).toBeCloseTo(1.2, 5);
});

it('crosses the bridge without sinking into the deck', () => {
	const character = new Character(world, at(level.marks.bridge));
	let top = 0;
	run(character, 150, forward, () => {
		const { y, z } = character.position;
		top = Math.max(top, y);
		if (z > 8 && z < 14) expect(y).toBeGreaterThan(1.2 - 1e-6);
		expect(character.grounded).toBe(true);
	});
	expect(top).toBeCloseTo(1.2, 5);
	expect(character.position.y).toBeCloseTo(0, 9);
});

it('stands on a ledge it lands on with its middle over the edge, and slides off one too far out', () => {
	const near = new Character(world, { x: -20, y: 3, z: 6 - 0.2 });
	run(near, 90, idle);
	expect(near.grounded).toBe(true);
	expect(near.position.y).toBeGreaterThan(0.3);
	expect(near.position.z).toBeCloseTo(6 - 0.2, 9);

	const far = new Character(world, { x: -20, y: 3, z: 6 - 0.45 });
	run(far, 90, idle);
	expect(far.grounded).toBe(true);
	expect(far.position.y).toBeCloseTo(0, 9);
	// Its bottom sphere rests against the box's top edge, 0.1 below its centre.
	const clearance = Math.sqrt(CAPSULE_RADIUS ** 2 - (CAPSULE_RADIUS - STEP_HEIGHT) ** 2);
	expect(far.position.z).toBeCloseTo(6 - clearance, 6);
});

it('turns toward the movement, or to the yaw it is told to face', () => {
	const character = new Character(world, at(level.marks.spawn));
	run(character, 30, { ...idle, moveX: 1 });
	expect(character.yaw).toBeCloseTo(Math.PI / 2, 3);
	run(character, 1, { ...forward, faceYaw: Math.PI });
	expect(Math.abs(character.yaw)).toBeCloseTo(Math.PI, 9);
});

it('moves relative to the camera', () => {
	// Camera yaw 0 sits on +z looking toward -z: forward is -z, right is +x.
	expect(cameraRelativeMove(0, 1, 0)).toEqual({ x: 0, z: -1 });
	expect(cameraRelativeMove(1, 0, 0).x).toBeCloseTo(1, 12);
	const turned = cameraRelativeMove(0, 1, Math.PI / 2);
	expect(turned.x).toBeCloseTo(-1, 12);
	expect(turned.z).toBeCloseTo(0, 12);
});

it.each([
	['no parent', null],
	['a moved parent', { position: [5, 2, -3], rotation: 0, scale: 1 }],
	['a rotated and scaled parent', { position: [-4, 1, 7], rotation: 1.1, scale: 2.5 }]
] as const)('places the avatar at the world position with %s', (_, parentTransform) => {
	const avatar = new Group();
	if (parentTransform) {
		const parent = new Group();
		parent.position.fromArray(parentTransform.position);
		parent.rotation.y = parentTransform.rotation;
		parent.scale.setScalar(parentTransform.scale);
		parent.add(avatar);
	}
	placeObject(avatar, { x: 1.5, y: 0.25, z: -2 }, 0.7);
	avatar.updateWorldMatrix(true, false);
	const world = avatar.getWorldPosition(new Vector3());
	expect(world.distanceTo(new Vector3(1.5, 0.25, -2))).toBeLessThan(1e-9);
	const facing = new Vector3(0, 0, 1).transformDirection(avatar.matrixWorld);
	expect(Math.atan2(facing.x, facing.z)).toBeCloseTo(0.7, 9);
});
