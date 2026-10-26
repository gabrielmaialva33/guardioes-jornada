import { BoxGeometry, Ray, Vector3 } from 'three';
import { expect, it, vi } from 'vitest';
import { CollisionWorld } from '../engine/world.ts';
import { buildStoryWorld } from '../level/build.ts';
import { StoryGame } from '../missions/story.ts';
import { ParkRuntime } from './park-runtime.ts';

const { world, level } = buildStoryWorld();
const act = level.act1,
	portals = level.portals;
if (!act || !portals) throw Error('act1');
it('blocks all portal openings until mission 6; walking floors and treehouse use authored heights', () => {
	const story = new StoryGame(level, { persist: () => true, badge() {} });
	const geometry = new BoxGeometry(0.1, 0.1, 0.1);
	const park = new ParkRuntime(story.level, world, story, new CollisionWorld([{ geometry }]));
	geometry.dispose();
	for (const [i, p] of (portals ?? []).entries()) {
		const mid = new Vector3(
			(p.gate.from.x + p.gate.to.x) / 2,
			p.gap.y + 1,
			(p.gate.from.z + p.gate.to.z) / 2
		);
		const direction = p.side === 'east' ? new Vector3(1, 0, 0) : new Vector3(0, 0, 1);
		const ray = new Ray(mid.clone().addScaledVector(direction, -2), direction);
		expect(park.gates[i].raycast(ray, 4)).not.toBeNull();
	}
	const deck = act?.treehouse.deck;
	if (!deck || !act) throw Error('deck');
	const ray = new Ray(new Vector3(deck.x0 + 1, deck.y + 1, deck.z0 + 1), new Vector3(0, -1, 0));
	expect(park.collision.raycast(ray, 1.2)).toBeCloseTo(1);
	expect(park.ladder.spec.top.y).toBe(deck.y);
	expect(park.context(act.zipline.start)?.disabled).toBe(true);
	expect(park.zipline.start(false)).toBe(false);
	vi.spyOn(story, 'completed').mockImplementation((id) => id === 6);
	story.revision++;
	park.sync();
	expect(park.gates.every((g) => !g.enabled)).toBe(true);
	expect(park.context(act.zipline.start)?.disabled).toBe(false);
	park.collision.dispose();
});

it('mounts every authored deck and rail while preserving the 2 u west zipline opening at z 84', () => {
	const story = new StoryGame(level, { persist: () => true, badge() {} });
	const geometry = new BoxGeometry(0.1, 0.1, 0.1);
	const park = new ParkRuntime(story.level, world, story, new CollisionWorld([{ geometry }]));
	geometry.dispose();
	if (!act) throw Error('act1');
	try {
		for (const deck of act.decks) {
			const down = new Ray(
				new Vector3((deck.x0 + deck.x1) / 2, deck.y + 0.5, (deck.z0 + deck.z1) / 2),
				new Vector3(0, -1, 0)
			);
			expect(park.collision.raycast(down, 0.75), deck.id).toBeCloseTo(0.5);
			for (const rail of deck.rails) {
				const direction = new Vector3(rail.z1 - rail.z0, 0, rail.x0 - rail.x1).normalize();
				const middle = new Vector3(
					(rail.x0 + rail.x1) / 2,
					rail.y + rail.height / 2,
					(rail.z0 + rail.z1) / 2
				);
				const across = new Ray(middle.addScaledVector(direction, -0.5), direction);
				expect(park.collision.raycast(across, 0.75), deck.id).not.toBeNull();
			}
		}
		// Traverse the west edge inside both sides of the authored 2 u opening.
		for (const z of [83.2, 84, 84.8])
			expect(park.collision.raycast(new Ray(new Vector3(127, 15.55, z), new Vector3(1, 0, 0)), 2)).toBeNull();
		for (const z of [82.5, 85.5])
			expect(
				park.collision.raycast(new Ray(new Vector3(127, 15.55, z), new Vector3(1, 0, 0)), 2)
			).not.toBeNull();
	} finally {
		park.collision.dispose();
	}
});
