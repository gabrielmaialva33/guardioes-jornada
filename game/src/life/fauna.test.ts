import { describe, expect, it } from 'vitest';
import { type MicoBehaviour, OncaBehaviour } from '../animation/animals/index.ts';
import { heightAt } from '../survival/terrain.ts';
import { Fauna, LIFE_TIERS } from './fauna.ts';
import { cameraAt, storyMap } from './fixtures.test-helper.ts';
import { LIFE_SEED, planLife } from './homes.ts';

const { world, level } = storyMap();
const plan = planLife(world, level);
const ground = (x: number, z: number) => heightAt(world.heights, x, z);

function setPlayer(fauna: Fauna, x: number, z: number, vx = 0, vz = 0) {
	const f = fauna.frame;
	f.playerX = x;
	f.playerZ = z;
	f.playerY = ground(x, z);
	f.playerVx = vx;
	f.playerVz = vz;
}

function run(fauna: Fauna, seconds: number, hz = 60, each?: (t: number) => void) {
	fauna.frame.dt = 1 / hz;
	for (let i = 0; i < Math.round(seconds * hz); i++) {
		fauna.update();
		each?.((i + 1) / hz);
	}
}

const snapshot = (fauna: Fauna) =>
	fauna.animals.map((a) => [a.motion.x, a.motion.y, a.motion.z, a.motion.yaw, a.state] as const);

describe('fauna: spawning', () => {
	it('starts every animal at its home, on the ground or up in its tree', () => {
		const fauna = new Fauna(plan, world.heights);
		fauna.animals.forEach((animal, i) => {
			const p = plan.animals[i];
			const m = animal.motion;
			for (const v of [m.x, m.y, m.z, m.yaw]) expect(Number.isFinite(v), p.key).toBe(true);
			expect(Math.hypot(m.x - p.homeX, m.z - p.homeZ), p.key).toBeLessThan(26);
			if (p.arboreal) {
				// The sabiá's lawn perches are on the ground; every other perch is up a tree.
				if (!p.perches?.some((perch) => perch.ground))
					expect(m.y - ground(m.x, m.z), p.key).toBeGreaterThan(3);
			} else if (p.water) {
				// Bank animals start on land or afloat, never under the bed.
				expect(m.y - ground(m.x, m.z), p.key).toBeGreaterThan(-0.06);
			} else if (p.species === 'onca-pintada') expect(m.y, p.key).toBeCloseTo(ground(m.x, m.z), 2);
			// P23 routes follow the ground in straight pieces of up to 1 u: within a few centimetres.
			else expect(Math.abs(m.y - ground(m.x, m.z)), p.key).toBeLessThan(0.06);
		});
	});
});

describe('fauna: the companion', () => {
	it('stays wild before mission 1 and follows the player on the ground after it', () => {
		const fauna = new Fauna(plan, world.heights);
		const index = plan.companion;
		const mico = fauna.animals[index];
		const behaviour = mico.behaviour as MicoBehaviour;
		// The child stands in the corridor gap they just planted.
		setPlayer(fauna, 58, 47);
		run(fauna, 2);
		expect(behaviour.companion).toBe(false);
		expect(fauna.companionActive).toBe(false);
		const canopyY = mico.motion.y;
		expect(canopyY - ground(mico.motion.x, mico.motion.z)).toBeGreaterThan(5);

		fauna.setCompanion(true);
		run(fauna, 1 / 60);
		expect(behaviour.companion).toBe(true);
		expect(mico.lod.keepAlive).toBe(true);
		// It climbs down over DESCENT seconds instead of dropping in one frame.
		expect(mico.motion.y).toBeGreaterThan(ground(mico.motion.x, mico.motion.z) + 4);
		run(fauna, 4);
		expect(mico.motion.y).toBeCloseTo(ground(mico.motion.x, mico.motion.z), 1);
		expect(Math.hypot(mico.motion.x - 58, mico.motion.z - 47)).toBeLessThan(3);

		// The child walks south along the corridor; the mico keeps up, on the ground, at every frame.
		let worst = 0;
		run(fauna, 8, 60, (t) => {
			const z = 47 + 3 * t;
			setPlayer(fauna, 58, z, 0, 3);
			worst = Math.max(worst, Math.abs(mico.motion.y - ground(mico.motion.x, mico.motion.z)));
		});
		expect(worst).toBeLessThan(0.6); // hops on jumps aside, it is on the ground
		expect(Math.hypot(mico.motion.x - fauna.frame.playerX, mico.motion.z - fauna.frame.playerZ)).toBeLessThan(
			4
		);
		expect(mico.state).toMatch(/follow|idle|hop/);
	});

	it('is never frozen, even with every animal out of view', () => {
		const fauna = new Fauna(plan, world.heights);
		setPlayer(fauna, 58, 47);
		fauna.setCompanion(true);
		// A camera at a map corner looking out of the map: no animal in its frustum.
		fauna.frame.camera = cameraAt([1, 40, 1], [-80, 40, -80]);
		let companionUpdates = 0;
		run(fauna, 2, 60, () => {
			if (fauna.animals[plan.companion].lod.tier !== 'frozen') companionUpdates++;
			for (let i = 0; i < fauna.animals.length; i++)
				if (i !== plan.companion) expect(fauna.animals[i].lod.tier).toBe('frozen');
		});
		expect(companionUpdates).toBe(120);
	});

	it('goes back to the canopy when the story restarts', () => {
		const fauna = new Fauna(plan, world.heights);
		setPlayer(fauna, 58, 47);
		fauna.setCompanion(true);
		run(fauna, 3);
		fauna.setCompanion(false);
		run(fauna, 1);
		const mico = fauna.animals[plan.companion];
		expect((mico.behaviour as MicoBehaviour).companion).toBe(false);
		expect(mico.lod.keepAlive).toBe(false);
		expect(mico.motion.y - ground(mico.motion.x, mico.motion.z)).toBeGreaterThan(5);
	});
});

describe('fauna: the onça keeps its distance', () => {
	const oncaOf = (fauna: Fauna) => {
		const animal = fauna.animals.find((a) => a.behaviour instanceof OncaBehaviour);
		if (!animal) throw new Error('no onça');
		return animal;
	};
	/** A point `d` u from the onça, outward from its loop's centre. */
	function outside(fauna: Fauna, d: number) {
		const route = plan.animals.find((a) => a.species === 'onca-pintada')?.route ?? [];
		let cx = 0;
		let cz = 0;
		for (let k = 0; k < route.length; k += 3) {
			cx += route[k] / (route.length / 3);
			cz += route[k + 2] / (route.length / 3);
		}
		const m = oncaOf(fauna).motion;
		const len = Math.hypot(m.x - cx, m.z - cz) || 1;
		return [m.x + ((m.x - cx) / len) * d, m.z + ((m.z - cz) / len) * d] as const;
	}

	/**
	 * Inside its 15 u it turns and walks off; outside it may walk its loop back
	 * toward the child, and then it notices again (0.8 s) and turns away. So:
	 * after a second inside the radius, its own steps never close the gap.
	 */
	function watch(fauna: Fauna, px: () => number, pz: () => number) {
		const onca = oncaOf(fauna);
		let previous = Number.NaN;
		let inside = 0;
		let worst = 0;
		let closest = Number.POSITIVE_INFINITY;
		let farthest = 0;
		return {
			step(dt: number) {
				const d = Math.hypot(onca.motion.x - px(), onca.motion.z - pz());
				if (inside > 1 && Number.isFinite(previous)) worst = Math.min(worst, d - previous);
				inside = d < 15 ? inside + dt : 0;
				closest = Math.min(closest, d);
				farthest = Math.max(farthest, d);
				previous = d;
			},
			get worst() {
				return worst;
			},
			get closest() {
				return closest;
			},
			get farthest() {
				return farthest;
			}
		};
	}

	it('walks away from a child standing inside 15 u and gets beyond it, never stepping toward them', () => {
		const fauna = new Fauna(plan, world.heights);
		const onca = oncaOf(fauna);
		const [px, pz] = outside(fauna, 12);
		setPlayer(fauna, px, pz);
		const start = Math.hypot(onca.motion.x - px, onca.motion.z - pz);
		const seen = watch(
			fauna,
			() => px,
			() => pz
		);
		let leaving = false;
		run(fauna, 40, 60, () => {
			seen.step(1 / 60);
			leaving ||= (onca.behaviour as OncaBehaviour).leaving;
		});
		expect(leaving).toBe(true);
		expect(seen.closest).toBeGreaterThan(start - 1.9); // at most the 0.8 s it takes to notice
		expect(seen.worst).toBeGreaterThan(-0.02);
		expect(seen.farthest).toBeGreaterThan(15);
	});

	it('moves off when a child walks straight at it, and its own steps never close the gap', () => {
		const fauna = new Fauna(plan, world.heights);
		const onca = oncaOf(fauna);
		const [sx, sz] = outside(fauna, 30);
		const tx = onca.motion.x;
		const tz = onca.motion.z;
		const len = Math.hypot(tx - sx, tz - sz);
		const speed = 3;
		let px = sx;
		let pz = sz;
		const seen = watch(
			fauna,
			() => px,
			() => pz
		);
		let leaving = false;
		let walked = 0;
		run(fauna, 30, 60, (t) => {
			// Walk at it until 10 u from where it stood, then stand still.
			walked = Math.min(len - 10, speed * t);
			const moving = walked < len - 10;
			px = sx + ((tx - sx) / len) * walked;
			pz = sz + ((tz - sz) / len) * walked;
			setPlayer(
				fauna,
				px,
				pz,
				moving ? ((tx - sx) / len) * speed : 0,
				moving ? ((tz - sz) / len) * speed : 0
			);
			// Only its own steps count: measure once the child stands still.
			if (!moving) seen.step(1 / 60);
			leaving ||= (onca.behaviour as OncaBehaviour).leaving;
		});
		expect(leaving).toBe(true);
		expect(seen.worst).toBeGreaterThan(-0.02);
		expect(seen.farthest).toBeGreaterThan(15);
	});
});

describe('fauna: LOD, freezing and the tier cap', () => {
	it('freezes animals out of view and leaves their pose exactly where it was', () => {
		const fauna = new Fauna(plan, world.heights);
		setPlayer(fauna, 34, 92);
		fauna.frame.camera = cameraAt([1, 40, 1], [-80, 40, -80]);
		run(fauna, 0.1);
		const before = snapshot(fauna);
		run(fauna, 3);
		expect(fauna.animated).toBe(0);
		expect(fauna.frozen).toBe(fauna.animals.length);
		expect(snapshot(fauna)).toEqual(before);
	});

	it('animates near animals every frame and far ones every third frame', () => {
		const fauna = new Fauna(plan, world.heights);
		const mico = plan.animals.findIndex((a) => a.species === 'mico-leao-dourado');
		const m = fauna.animals[mico].motion;
		const bugio = plan.animals.findIndex((a) => a.species === 'bugio-ruivo');
		const b = fauna.animals[bugio].motion;
		// Behind a mico on the line to the bugios, about 45 u away: the mico near, the bugio far.
		const len = Math.hypot(m.x - b.x, m.z - b.z);
		const cx = m.x + ((m.x - b.x) / len) * 6;
		const cz = m.z + ((m.z - b.z) / len) * 6;
		fauna.frame.camera = cameraAt([cx, m.y + 1, cz], [b.x, b.y, b.z], 120);
		setPlayer(fauna, cx, cz);
		let micoUpdates = 0;
		let bugioUpdates = 0;
		const micoLod = fauna.animals[mico].lod;
		const bugioLod = fauna.animals[bugio].lod;
		run(fauna, 2, 60, () => {
			if (micoLod.tier === 'near' && micoLod.dt > 0) micoUpdates++;
			if (bugioLod.tier === 'far' && bugioLod.dt > 0) bugioUpdates++;
		});
		expect(micoLod.tier).toBe('near');
		expect(bugioLod.tier).toBe('far');
		expect(micoUpdates).toBe(120);
		expect(bugioUpdates).toBeGreaterThanOrEqual(39);
		expect(bugioUpdates).toBeLessThanOrEqual(41);
	});

	it('never animates more animals than the tier allows, nearest first', () => {
		for (const quality of ['low', 'medium', 'high'] as const) {
			const fauna = new Fauna(plan, world.heights, quality);
			// High above the map looking down at all of it, so every animal is in view and within reach.
			fauna.frame.camera = cameraAt([80, 140, 80], [80, 0, 80.01], 400);
			setPlayer(fauna, 80, 80);
			fauna.cap = Math.min(fauna.cap, 3);
			run(fauna, 1, 60, () => {
				expect(fauna.animated).toBeLessThanOrEqual(3);
			});
			expect(LIFE_TIERS[quality].animated).toBeGreaterThanOrEqual(7);
		}
		// Within the cull distance, the nearest ones win.
		const fauna = new Fauna(plan, world.heights, 'low');
		fauna.cap = 2;
		const muriqui = fauna.animals.findIndex((a) => a.species.id === 'muriqui');
		const m = fauna.animals[muriqui].motion;
		fauna.frame.camera = cameraAt([m.x - 8, m.y, m.z + 8], [m.x, m.y, m.z], 120);
		setPlayer(fauna, m.x - 8, m.z + 8);
		run(fauna, 0.5);
		expect(fauna.animals[muriqui].lod.tier).not.toBe('frozen');
		expect(fauna.animated).toBeLessThanOrEqual(2);
	});
});

describe('fauna: howls for the audio landmark', () => {
	it('reports each howl start and the chorus, with the bugios position', () => {
		const fauna = new Fauna(plan, world.heights);
		const events: { x: number; z: number; chorus: boolean }[] = [];
		fauna.onHowl = (e) => events.push({ x: e.x, z: e.z, chorus: e.chorus });
		setPlayer(fauna, 20, 30);
		fauna.chorus();
		expect(events).toHaveLength(1);
		expect(events[0].chorus).toBe(true);
		expect(Math.hypot(events[0].x - 18, events[0].z - 20)).toBeLessThan(20);
		run(fauna, 200, 30);
		expect(events.length).toBeGreaterThan(2);
		expect(fauna.choruses).toBeGreaterThanOrEqual(2);
	});
});

describe('fauna: determinism', () => {
	function replay(seed: number) {
		const fauna = new Fauna(planLife(world, level, seed), world.heights, 'medium');
		fauna.frame.camera = cameraAt([80, 140, 80], [80, 0, 80.01], 400);
		const howls: number[] = [];
		fauna.onHowl = (e) => howls.push(e.index);
		setPlayer(fauna, 58, 47);
		run(fauna, 5);
		fauna.setCompanion(true);
		run(fauna, 25, 60, (t) => setPlayer(fauna, 58, 47 + t, 0, 1));
		return { state: snapshot(fauna), howls };
	}

	it('replays the same world from the same seed, and another from another seed', () => {
		const a = replay(LIFE_SEED);
		const b = replay(LIFE_SEED);
		expect(b).toEqual(a);
		expect(replay(LIFE_SEED + 1).state).not.toEqual(a.state);
	});
});

describe('fauna: the P23 species on the map', () => {
	it('the veado-mateiro flees a child inside 15 u and not before', () => {
		const at = (d: number) => {
			const fauna = new Fauna(plan, world.heights);
			const i = plan.animals.findIndex((a) => a.species === 'veado-mateiro');
			const deer = fauna.animals[i];
			const m = deer.motion;
			setPlayer(fauna, m.x + d, m.z);
			let fled = false;
			run(fauna, 3, 60, () => {
				// The child keeps its distance from where the deer is.
				setPlayer(fauna, deer.motion.x + d, deer.motion.z);
				fled ||= deer.state === 'flee';
			});
			return fled;
		};
		expect(at(16)).toBe(false);
		expect(at(14)).toBe(true);
	});

	it('the cateto band stays together on its loop', () => {
		const fauna = new Fauna(plan, world.heights);
		const band = plan.animals.flatMap((a, i) => (a.species === 'cateto' ? [i] : []));
		// The child watches from 20 u, outside the band's 12 u alert radius but near enough to be animated.
		const home = plan.animals[band[0]];
		setPlayer(fauna, home.homeX + 20, home.homeZ);
		const start = band.map((i) => ({ x: fauna.animals[i].motion.x, z: fauna.animals[i].motion.z }));
		let worst = 0;
		run(fauna, 90, 30, () => {
			const xs = band.map((i) => fauna.animals[i].motion);
			for (const a of xs) for (const b of xs) worst = Math.max(worst, Math.hypot(a.x - b.x, a.z - b.z));
		});
		// They moved along the loop (the leader's walks), and stayed a tight band: five animals on
		// concentric loops 0.8 u apart, 1.4 u apart along them.
		const moved = band.map((i, k) =>
			Math.hypot(fauna.animals[i].motion.x - start[k].x, fauna.animals[i].motion.z - start[k].z)
		);
		expect(Math.max(...moved)).toBeGreaterThan(1);
		expect(fauna.animals[band[0]].lod.tier).not.toBe('frozen');
		expect(worst).toBeLessThan(12);
	});
});
