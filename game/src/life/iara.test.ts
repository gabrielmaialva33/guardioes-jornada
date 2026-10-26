import { describe, expect, it } from 'vitest';
import { AVATAR_LAYOUT } from '../animation/joints.ts';
import { JOINT_STRIDE, Pose } from '../animation/skeleton.ts';
import { IARA, IaraLife } from './iara.ts';

const HEAD = AVATAR_LAYOUT.index.head * JOINT_STRIDE;
const ARM_L = AVATAR_LAYOUT.index.armL * JOINT_STRIDE;
const ARM_R = AVATAR_LAYOUT.index.armR * JOINT_STRIDE;

/** Iara's post on the story map: (38, 80), facing south toward the spawn. */
const make = (seed = 3) => new IaraLife({ x: 38, y: 1.9, z: 80, yaw: 0, trail: { x: 42, z: 70 }, seed });

function run(life: IaraLife, seconds: number, each?: (t: number) => void, base?: Pose) {
	life.frame.dt = 1 / 60;
	for (let i = 0; i < Math.round(seconds * 60); i++) {
		life.update(base);
		each?.((i + 1) / 60);
	}
}

function player(life: IaraLife, x: number, z: number) {
	life.frame.playerX = x;
	life.frame.playerY = 1.9;
	life.frame.playerZ = z;
}

const wrap = (a: number) => a - Math.PI * 2 * Math.round(a / (Math.PI * 2));

describe('Iara: facing the player', () => {
	it('turns to face a child inside 8 u and back to her post after they leave', () => {
		const life = make();
		player(life, 38 + 6, 80 - 2);
		run(life, 1.5);
		expect(life.engaged).toBe(true);
		const bearing = Math.atan2(6, -2);
		expect(Math.abs(wrap(life.yaw - bearing))).toBeLessThan(0.03);
		// Beyond 10 u she lets go, waits, then turns back.
		player(life, 38 + 30, 80);
		run(life, IARA.homeDelay - 0.5);
		expect(Math.abs(wrap(life.yaw - bearing))).toBeLessThan(0.1);
		run(life, 3);
		expect(Math.abs(wrap(life.yaw - life.homeYaw))).toBeLessThan(0.03);
	});

	it('turns smoothly (a damped turn, never a snap) and looks at the child with her head', () => {
		const life = make();
		player(life, 38 - 5, 80 - 3);
		let largest = 0;
		let previous = life.yaw;
		run(life, 1, () => {
			largest = Math.max(largest, Math.abs(wrap(life.yaw - previous)));
			previous = life.yaw;
		});
		expect(largest).toBeLessThan(0.2);
		expect(life.pose.data[HEAD + 1]).not.toBe(0);
	});
});

describe('Iara: idle variations', () => {
	it('looks around, checks the radio and points down the trail when left alone', () => {
		const life = make(11);
		player(life, 38 + 40, 80);
		const seen = new Set<string>();
		let maxArmR = 0;
		let maxArmL = 0;
		run(life, 120, () => {
			if (life.gesture !== 'none') seen.add(life.gesture);
			maxArmR = Math.max(maxArmR, -life.pose.data[ARM_R]);
			maxArmL = Math.max(maxArmL, -life.pose.data[ARM_L]);
		});
		expect(seen).toEqual(new Set(['look-around', 'radio', 'point']));
		expect(life.variations).toBeGreaterThanOrEqual(10);
		// The point raises the right arm to about horizontal; the radio the left arm past it.
		expect(maxArmR).toBeGreaterThan(80 * (Math.PI / 180));
		expect(maxArmL).toBeGreaterThan(100 * (Math.PI / 180));
	});

	it('is the same for the same seed', () => {
		const trace = (seed: number) => {
			const life = make(seed);
			player(life, 70, 80);
			const out: string[] = [];
			run(life, 60, () => out.push(life.gesture));
			return out.join();
		};
		expect(trace(5)).toBe(trace(5));
		expect(trace(5)).not.toBe(trace(6));
	});

	it('stops with reduced motion, but still faces the child', () => {
		const life = make();
		life.frame.reducedMotion = true;
		player(life, 38 + 40, 80);
		run(life, 60);
		expect(life.variations).toBe(0);
		player(life, 38 + 4, 80 + 4);
		run(life, 2);
		expect(Math.abs(wrap(life.yaw - Math.atan2(4, 4)))).toBeLessThan(0.05);
	});
});

describe('Iara: talking', () => {
	it('beats her hands while the dialogue is open and stops after it closes', () => {
		const life = make();
		player(life, 38, 80 - 2.5);
		life.frame.talking = true;
		let low = Number.POSITIVE_INFINITY;
		let high = Number.NEGATIVE_INFINITY;
		run(life, 3, () => {
			low = Math.min(low, life.pose.data[ARM_R]);
			high = Math.max(high, life.pose.data[ARM_R]);
		});
		expect(life.talkWeight).toBe(1);
		expect(high - low).toBeGreaterThan(20 * (Math.PI / 180));
		expect(life.gesture).toBe('none');
		life.frame.talking = false;
		run(life, 1);
		expect(life.talkWeight).toBe(0);
	});

	it('adds onto the base pose and lets an emote play alone', () => {
		const life = make();
		const base = new Pose(AVATAR_LAYOUT.joints.length);
		base.data[ARM_R] = -2.5; // a wave in the base animator
		player(life, 38 + 40, 80);
		run(life, 0.5, undefined, base);
		expect(life.pose.data[ARM_R]).toBeCloseTo(-2.5, 6);
		life.frame.busy = true;
		life.frame.talking = true;
		player(life, 38, 78);
		run(life, 1, undefined, base);
		expect(life.talkWeight).toBe(0);
		expect(life.pose.data[ARM_R]).toBeCloseTo(-2.5, 6);
	});

	it('stays finite whatever it is fed', () => {
		const life = make();
		for (const dt of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, 5]) {
			life.frame.dt = dt;
			player(life, Number.NaN, 80);
			life.update();
			player(life, 38, 80);
			life.update();
		}
		for (const v of life.pose.data) expect(Number.isFinite(v)).toBe(true);
		expect(Number.isFinite(life.yaw)).toBe(true);
	});
});
