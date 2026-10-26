/** Standalone original park fixture; never imports the live maps, story, or renderer. */
import { CylinderGeometry, Group, SphereGeometry } from 'three';
import { CompoundWorld } from '../engine/compound-world.ts';
import { Boardwalk } from './boardwalk.ts';
import { SuspensionBridge } from './bridge.ts';
import { CameraTrap } from './camera-trap.ts';
import { Canoe } from './canoe.ts';
import { Ladder } from './ladder.ts';
import {
	createBoardwalkMesh,
	createBridgeMesh,
	createCameraTrapMesh,
	createCanoeMesh,
	createLadderMesh,
	createPhotoCameraMesh,
	createZiplineMesh,
	MechanicMesh
} from './meshes.ts';
import { PhotoCamera } from './photo.ts';
import { ParkTraversal } from './traversal.ts';
import { Zipline } from './zipline.ts';
export function createMechanicsFixture() {
	const ladder = new Ladder({
		id: 'treehouse',
		base: { x: 0, y: 0, z: 0 },
		top: { x: 0, y: 6, z: 0 },
		exit: { x: 0, y: 6, z: 2 },
		radius: 0.85
	});
	const zipline = new Zipline({ id: 'home', start: { x: 8, y: 10, z: 0 }, end: { x: 8, y: 1, z: 82 } });
	const bridge = new SuspensionBridge({
		id: 'bridge',
		start: { x: -12, y: 3, z: 0 },
		end: { x: -12, y: 3, z: 16 },
		width: 2,
		planks: 20
	});
	const canoe = new Canoe({
		id: 'river',
		channel: [
			{ x: 20, y: 0.3, z: 0 },
			{ x: 20, y: 0.3, z: 18 },
			{ x: 25, y: 0.3, z: 30 }
		],
		halfWidth: 3,
		landings: [
			{ id: 'near', water: { x: 20, y: 0.3, z: 0 }, exit: { x: 17.5, y: 0.3, z: 0 } },
			{ id: 'far', water: { x: 25, y: 0.3, z: 30 }, exit: { x: 27.5, y: 0.3, z: 30 } }
		]
	});
	const boardwalk = new Boardwalk({
		id: 'canopy',
		start: { x: -24, y: 4, z: 0 },
		end: { x: -24, y: 4, z: 24 },
		width: 2,
		lookouts: [
			{
				id: 'view',
				position: { x: -24, y: 4, z: 12 },
				camera: { x: -28, y: 8, z: 14 },
				target: { x: 0, y: 5, z: 15 }
			}
		]
	});
	const photo = new PhotoCamera([
		{ id: 'bird-a', species: 'tucano', position: { x: 31.3, y: 3, z: 10 } },
		{ id: 'bird-b', species: 'saira', position: { x: 32.7, y: 3.2, z: 10 } }
	]);
	const trap = new CameraTrap('muriqui', 'trap');
	const trapPosition = { x: 39, y: 1.6, z: 1 };
	const root = new Group(),
		ground = new MechanicMesh();
	ground.box(5, -0.55, 35, 110, 1, 130, 0x72964b, true);
	// Clear visual river channel; circular caps match the canoe's swept polyline boundary.
	for (let i = 1; i < canoe.spec.channel.length; i++) {
		const a = canoe.spec.channel[i - 1],
			b = canoe.spec.channel[i],
			len = Math.hypot(b.x - a.x, b.z - a.z);
		const river = ground.box((a.x + b.x) / 2, 0.04, (a.z + b.z) / 2, 6, 0.08, len, 0x4babb2);
		river.rotation.y = Math.atan2(b.x - a.x, b.z - a.z);
	}
	for (const p of canoe.spec.channel)
		ground.add(new CylinderGeometry(3, 3, 0.08, 16), 0x4babb2, p.x, 0.04, p.z);
	for (const l of canoe.spec.landings)
		ground.box(l.exit.x, l.exit.y - 0.15, l.exit.z, 2, 0.3, 3, 0xb57a4b, true);
	for (const p of [bridge.spec.start, bridge.spec.end])
		ground.box(p.x, p.y - 0.2, p.z + (p.z === 0 ? -1.5 : 1.5), 4, 0.4, 3, 0xb57a4b, true);
	// Small fixture trees, all authored here; decorative trunks never enter photo occlusion.
	for (const p of [
		{ x: 3, z: 4 },
		{ x: 38.8, z: 1.5 },
		{ x: -27, z: 17 },
		{ x: 35, z: 13 }
	]) {
		ground.add(new CylinderGeometry(0.5, 0.7, 8, 6), 0x72503c, p.x, 4, p.z);
		ground.add(new SphereGeometry(3.5, 7, 5), 0x326c45, p.x, 9, p.z);
	}
	for (const s of photo.subjects) {
		ground.box(
			s.position.x,
			s.position.y,
			s.position.z,
			0.65,
			0.65,
			1,
			s.species === 'tucano' ? 0x263f36 : 0x39a3bf
		);
		ground.box(s.position.x, s.position.y + 0.15, s.position.z - 0.7, 0.4, 0.27, 0.65, 0xf2c94c);
	}
	ground.box(trapPosition.x, trapPosition.y + 0.7, trapPosition.z, 1.1, 0.15, 0.1, 0xf3d75c);
	const ladderMesh = createLadderMesh(ladder),
		ziplineMesh = createZiplineMesh(zipline),
		bridgeMesh = createBridgeMesh(bridge),
		canoeMesh = createCanoeMesh(canoe),
		boardwalkMesh = createBoardwalkMesh(boardwalk),
		photoMesh = createPhotoCameraMesh(),
		trapMesh = createCameraTrapMesh(trap, trapPosition);
	const visuals = [
		ground.bake(),
		ladderMesh,
		ziplineMesh,
		bridgeMesh,
		canoeMesh,
		boardwalkMesh,
		photoMesh,
		trapMesh
	];
	for (const v of visuals) root.add(v.root);
	const sources = [
		...ground.colliders,
		...ladderMesh.colliders,
		...ziplineMesh.colliders,
		...boardwalkMesh.colliders
	];
	const world = new CompoundWorld(sources, [bridgeMesh.world]);
	let reducedMotion = false,
		serial = 0;
	const completed = new Set<string>();
	function complete(id: string) {
		if (completed.has(id)) return;
		completed.add(id);
		trap.missionCompleted(id, ++serial);
	}
	const traversal = new ParkTraversal({
		ladders: [ladder],
		ziplines: [zipline],
		canoes: [canoe],
		beforeStep(dt, c) {
			bridge.step(dt, c.position, c.planarSpeed, reducedMotion);
			bridgeMesh.update();
			boardwalk.step(dt, reducedMotion);
			if (c.position.z > 15 && Math.abs(c.position.x + 12) < 1 && c.position.y > 2) complete('bridge');
		}
	});
	return {
		root,
		world,
		ladder,
		zipline,
		bridge,
		canoe,
		boardwalk,
		photo,
		trap,
		traversal,
		photoMesh,
		trapPosition,
		complete,
		set reducedMotion(value: boolean) {
			reducedMotion = value;
		},
		get reducedMotion() {
			return reducedMotion;
		},
		get serial() {
			return serial;
		},
		update() {
			ziplineMesh.update();
			canoeMesh.update(reducedMotion);
			trapMesh.update();
		},
		dispose() {
			world.dispose();
			for (const v of visuals) v.dispose();
			root.removeFromParent();
		}
	};
}
export type MechanicsFixture = ReturnType<typeof createMechanicsFixture>;
