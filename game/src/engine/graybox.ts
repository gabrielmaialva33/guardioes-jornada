/**
 * The graybox test level, as data plus proxy geometry. Every collider is a
 * simple proxy (box, ramp wedge, log cylinder) whose world-space geometry is
 * both what the BVH collides with and what the scene may draw, so the two can
 * never disagree.
 *
 * Layout, looking down with +z ahead of the spawn: a row of feature lanes
 * starting at z = 6, from x = -32 to x = 32, and the obby straight ahead past
 * the end of the ground at z = 40. Gaps are sized from the jump numbers.
 */
import {
	BoxGeometry,
	BufferAttribute,
	BufferGeometry,
	CylinderGeometry,
	Euler,
	Matrix4,
	Quaternion,
	Vector3
} from 'three';
import type { Checkpoint } from './checkpoints.ts';
import { GRAVITY, JUMP_SPEED, STEP_HEIGHT, WALK_SPEED } from './constants.ts';
import { CollisionWorld } from './world.ts';

export type V3 = readonly [number, number, number];

export type ColliderProxy =
	| { kind: 'box'; name: string; center: V3; size: V3; rotation?: V3 }
	/** A wedge rising toward its local +z; `base` is the middle of its low edge. */
	| { kind: 'ramp'; name: string; base: V3; width: number; length: number; angle: number; yaw: number }
	/** A cylinder lying on its side; yaw 0 puts its axis along x. */
	| { kind: 'log'; name: string; center: V3; radius: number; length: number; yaw: number };

export type GrayboxMark =
	| 'spawn'
	| 'steepRamp'
	| 'walkableRamp'
	| 'rampTop'
	| 'stepLimit'
	| 'stepHigh'
	| 'log'
	| 'bridge'
	| 'lowCeiling'
	| 'corner'
	| 'thinWall'
	| 'trailhead';

export interface Graybox {
	proxies: ColliderProxy[];
	start: Checkpoint;
	checkpoints: Checkpoint[];
	killY: number;
	/** Where each feature's test run starts (feet, on the ground), facing +z unless noted. */
	marks: Record<GrayboxMark, V3>;
	/** Obby facts derived from the jump numbers. */
	obby: {
		edgeZ: number;
		gaps: number[];
		rises: number[];
		platforms: { from: number; to: number; top: number }[];
	};
}

const DEG = Math.PI / 180;

/** Ramp angles on either side of MAX_SLOPE (50°). */
export const WALKABLE_RAMP_ANGLE = 30 * DEG;
export const STEEP_RAMP_ANGLE = 60 * DEG;
/** Step boxes: exactly the step height, and just above it. */
export const STEP_LIMIT = STEP_HEIGHT;
export const STEP_HIGH = STEP_HEIGHT + 0.05;
/** Low ceiling: 0.6 u of headroom over the 3 u capsule. */
export const LOW_CEILING_BOTTOM = 3.6;
export const THIN_WALL_THICKNESS = 0.05;
export const KILL_Y = -20;
/** Obby gaps as fractions of the jump's reach to each platform: easy, medium, hard. */
const GAP_FRACTIONS = [0.5, 0.65, 0.8];
const PLATFORM_RISES = [0, 1, 1];

/**
 * Horizontal distance a full-speed jump covers before it comes back down to
 * `rise` above the take-off height (0 if that height is out of reach).
 */
export function jumpReach(rise = 0, speed = WALK_SPEED, jumpSpeed = JUMP_SPEED, gravity = GRAVITY): number {
	const discriminant = jumpSpeed * jumpSpeed - 2 * gravity * rise;
	return discriminant < 0 ? 0 : (speed * (jumpSpeed + Math.sqrt(discriminant))) / gravity;
}

export function createGraybox(): Graybox {
	const proxies: ColliderProxy[] = [
		// x ∈ [-40, 40], z ∈ [-30, 40], top at y = 0.
		{ kind: 'box', name: 'ground', center: [0, -0.5, 5], size: [80, 1, 70] }
	];

	// Ramps: 60° blocks, 30° walks up to a platform.
	proxies.push({
		kind: 'ramp',
		name: 'steep-ramp',
		base: [-32, 0, 6],
		width: 3,
		length: 2.5,
		angle: STEEP_RAMP_ANGLE,
		yaw: 0
	});
	const rampLength = 6;
	const rampTop = rampLength * Math.tan(WALKABLE_RAMP_ANGLE);
	proxies.push(
		{
			kind: 'ramp',
			name: 'walkable-ramp',
			base: [-26, 0, 6],
			width: 3,
			length: rampLength,
			angle: WALKABLE_RAMP_ANGLE,
			yaw: 0
		},
		{ kind: 'box', name: 'ramp-platform', center: [-26, rampTop / 2, 14], size: [3, rampTop, 4] }
	);

	// Steps.
	proxies.push(
		{ kind: 'box', name: 'step-limit', center: [-20, STEP_LIMIT / 2, 7.5], size: [3, STEP_LIMIT, 3] },
		{ kind: 'box', name: 'step-high', center: [-14, STEP_HIGH / 2, 7.5], size: [3, STEP_HIGH, 3] }
	);

	// A fallen log, too tall to step over.
	proxies.push({ kind: 'log', name: 'log', center: [-8, 0.4, 8], radius: 0.4, length: 3, yaw: 0 });

	// Bridge: 20° ramps up to a thin deck with railings.
	const deckTop = 1.2;
	const bridgeRamp = deckTop / Math.tan(20 * DEG);
	const deckFrom = 4 + bridgeRamp;
	const deckLength = 8;
	const deckTo = deckFrom + deckLength;
	const deckZ = (deckFrom + deckTo) / 2;
	proxies.push(
		{
			kind: 'ramp',
			name: 'bridge-up',
			base: [8, 0, 4],
			width: 3,
			length: bridgeRamp,
			angle: 20 * DEG,
			yaw: 0
		},
		{ kind: 'box', name: 'bridge-deck', center: [8, deckTop - 0.1, deckZ], size: [3, 0.2, deckLength] },
		{
			kind: 'ramp',
			name: 'bridge-down',
			base: [8, 0, deckTo + bridgeRamp],
			width: 3,
			length: bridgeRamp,
			angle: 20 * DEG,
			yaw: Math.PI
		},
		{ kind: 'box', name: 'rail-left', center: [6.55, deckTop + 0.4, deckZ], size: [0.1, 0.8, deckLength] },
		{ kind: 'box', name: 'rail-right', center: [9.45, deckTop + 0.4, deckZ], size: [0.1, 0.8, deckLength] }
	);

	// Low ceiling slab.
	proxies.push({
		kind: 'box',
		name: 'low-ceiling',
		center: [14, LOW_CEILING_BOTTOM + 0.25, 9],
		size: [5, 0.5, 6]
	});

	// Inner corner at (24, 12): one wall facing -x, one facing -z.
	proxies.push(
		{ kind: 'box', name: 'corner-east', center: [24.25, 2, 9], size: [0.5, 4, 6] },
		{ kind: 'box', name: 'corner-north', center: [21.25, 2, 12.25], size: [6.5, 4, 0.5] }
	);

	// Thin wall across the lane at z = 10.
	proxies.push({ kind: 'box', name: 'thin-wall', center: [32, 2, 10], size: [6, 4, THIN_WALL_THICKNESS] });

	// Trailhead checkpoint pad, then the obby past the ground's edge at z = 40.
	proxies.push({ kind: 'box', name: 'trailhead-pad', center: [0, 0.05, 34], size: [4, 0.1, 4] });
	const edgeZ = 40;
	const platformDepths = [4, 4, 6];
	const gaps: number[] = [];
	const platforms: { from: number; to: number; top: number }[] = [];
	let z = edgeZ;
	let top = 0;
	for (let i = 0; i < GAP_FRACTIONS.length; i++) {
		const gap = GAP_FRACTIONS[i] * jumpReach(PLATFORM_RISES[i]);
		top += PLATFORM_RISES[i];
		const from = z + gap;
		const to = from + platformDepths[i];
		gaps.push(gap);
		platforms.push({ from, to, top });
		proxies.push({
			kind: 'box',
			name: `obby-${i + 1}`,
			center: [0, top - 0.5, (from + to) / 2],
			size: [4, 1, to - from]
		});
		z = to;
	}
	const summit = platforms[platforms.length - 1];
	const summitZ = summit.to - 2;
	proxies.push({
		kind: 'box',
		name: 'summit-pad',
		center: [0, summit.top + 0.05, summitZ],
		size: [4, 0.1, 3]
	});

	const start: Checkpoint = {
		id: 'start',
		min: { x: -2, y: -1, z: -2 },
		max: { x: 2, y: 3, z: 2 },
		spawn: { x: 0, y: 0, z: 0 },
		yaw: 0
	};
	const checkpoints: Checkpoint[] = [
		{
			id: 'trailhead',
			min: { x: -2, y: -0.5, z: 32 },
			max: { x: 2, y: 3, z: 36 },
			spawn: { x: 0, y: 0.1, z: 34 },
			yaw: 0
		},
		{
			id: 'summit',
			min: { x: -2, y: summit.top - 0.5, z: summitZ - 1.5 },
			max: { x: 2, y: summit.top + 3, z: summitZ + 1.5 },
			spawn: { x: 0, y: summit.top + 0.1, z: summitZ },
			yaw: 0
		}
	];

	return {
		proxies,
		start,
		checkpoints,
		killY: KILL_Y,
		marks: {
			spawn: [0, 0, 0],
			steepRamp: [-32, 0, 3],
			walkableRamp: [-26, 0, 3],
			rampTop: [-26, rampTop, 14],
			stepLimit: [-20, 0, 3],
			stepHigh: [-14, 0, 3],
			log: [-8, 0, 4],
			bridge: [8, 0, 1],
			lowCeiling: [14, 0, 9],
			corner: [20, 0, 7],
			thinWall: [32, 0, 5],
			trailhead: [0, 0.1, 34]
		},
		obby: { edgeZ, gaps, rises: PLATFORM_RISES, platforms }
	};
}

const matrix = new Matrix4();
const rotation = new Quaternion();
const euler = new Euler();
const position = new Vector3();
const unit = new Vector3(1, 1, 1);

/** World-space geometry of one proxy, flat-shaded; the same triangles collide and render. */
export function proxyGeometry(proxy: ColliderProxy): BufferGeometry {
	let geometry: BufferGeometry;
	switch (proxy.kind) {
		case 'box':
			geometry = new BoxGeometry(...proxy.size);
			euler.set(...(proxy.rotation ?? [0, 0, 0]));
			matrix.compose(position.set(...proxy.center), rotation.setFromEuler(euler), unit);
			break;
		case 'ramp':
			geometry = wedge(proxy.width, proxy.length, proxy.length * Math.tan(proxy.angle));
			matrix.compose(position.set(...proxy.base), rotation.setFromAxisAngle(Y, proxy.yaw), unit);
			break;
		case 'log':
			// Eight sides with a flat on top, axis turned from y to x, then yawed.
			geometry = new CylinderGeometry(proxy.radius, proxy.radius, proxy.length, 8, 1, false, Math.PI / 8);
			geometry.rotateZ(Math.PI / 2);
			matrix.compose(position.set(...proxy.center), rotation.setFromAxisAngle(Y, proxy.yaw), unit);
			break;
	}
	geometry.applyMatrix4(matrix);
	return geometry;
}

/** The BVH over every proxy of a level. */
export function buildCollisionWorld(level: Pick<Graybox, 'proxies'>): CollisionWorld {
	const geometries = level.proxies.map(proxyGeometry);
	const world = new CollisionWorld(geometries.map((geometry) => ({ geometry })));
	for (const geometry of geometries) geometry.dispose();
	return world;
}

const Y = new Vector3(0, 1, 0);

/** A ramp wedge: low edge along local x at z = 0, rising to `height` at z = `length`; no bottom face. */
function wedge(width: number, length: number, height: number): BufferGeometry {
	const w = width / 2;
	const corners = {
		frontLeft: [-w, 0, 0],
		frontRight: [w, 0, 0],
		backLeft: [-w, 0, length],
		backRight: [w, 0, length],
		topLeft: [-w, height, length],
		topRight: [w, height, length]
	};
	const { frontLeft, frontRight, backLeft, backRight, topLeft, topRight } = corners;
	// Counter-clockwise seen from outside.
	const triangles = [
		[frontLeft, topRight, frontRight],
		[frontLeft, topLeft, topRight],
		[backLeft, backRight, topRight],
		[backLeft, topRight, topLeft],
		[frontLeft, backLeft, topLeft],
		[frontRight, topRight, backRight]
	];
	const geometry = new BufferGeometry();
	geometry.setAttribute('position', new BufferAttribute(new Float32Array(triangles.flat(2)), 3));
	geometry.computeVertexNormals();
	return geometry;
}
