import { expect, it } from 'vitest';
import { buildStoryWorld } from '../level/build.ts';
import { StoryGame } from './story.ts';

const { level } = buildStoryWorld();
function act1() {
	const a = level.act1;
	if (!a) throw Error('act1');
	return a;
}
function fresh(value?: unknown) {
	return new StoryGame(level, { value, persist: () => true, badge() {} });
}
function begin(g: StoryGame) {
	const iara = level.triggers.find((t) => t.id === 'iara');
	if (!iara) throw Error('iara');
	g.act(iara);
	g.choose('start', iara);
	g.closeDialogue();
}
it('merges Act 1 without mutating level data and requires the actual treehouse visit before mission 1', () => {
	const g = fresh();
	begin(g);
	expect(g.available(0)).toBe(true);
	expect(g.available(1)).toBe(false);
	expect(g.data.selected).toBe(0);
	expect(level.missions).toHaveLength(6);
	const deck = act1().treehouse.deck;
	g.visit({ x: (deck.x0 + deck.x1) / 2, y: deck.y - 2, z: (deck.z0 + deck.z1) / 2 }, true);
	expect(g.completed(0)).toBe(false);
	g.visit({ x: (deck.x0 + deck.x1) / 2, y: deck.y, z: (deck.z0 + deck.z1) / 2 }, true);
	expect(g.completed(0)).toBe(true);
	expect(g.available(1)).toBe(true);
	expect(g.level.missions.map((m) => m.id)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
});
it('grandfathers earlier started saves without removing progress, but does not bypass mission 0 in new saves', () => {
	expect(fresh({ version: 1, levelVersion: 2, started: true }).completed(0)).toBe(true);
	expect(fresh({ version: 1, levelVersion: level.version, started: true }).completed(0)).toBe(false);
});
it('accepts Ana seeds once, requires delivery, and records distinct authored birds from photo saves', () => {
	const g = fresh({ version: 1, levelVersion: 2, started: true });
	for (const c of level.collectibles.filter((c) => c.kind === 'jucara-fruit')) g.act(c);
	for (const p of level.planting.filter((p) => p.mission === 1)) g.act(p);
	g.closeDialogue();
	const act = act1();
	const ana = act.npcs.find((n) => n.id === 'ana');
	if (!ana) throw Error('Ana');
	g.act(ana);
	g.closeDialogue();
	for (const seed of act.seeds) {
		g.act(seed);
		g.act(seed);
	}
	expect(g.progress(7)).toBe(6);
	expect(g.completed(7)).toBe(false);
	g.act(ana);
	expect(g.completed(7)).toBe(true);
	g.closeDialogue();
	const ze = act.npcs.find((n) => n.id === 'ze');
	if (!ze) throw Error('Ze');
	g.act(ze);
	g.closeDialogue();
	g.recordPhotos(['tucano', 'tucano', 'saira', 'unknown']);
	expect(g.progress(8)).toBe(2);
	g.recordPhotos(['sabia']);
	expect(g.completed(8)).toBe(true);
});
