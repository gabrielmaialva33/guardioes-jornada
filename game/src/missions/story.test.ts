import { expect, it, vi } from 'vitest';
import { buildStoryWorld } from '../level/build.ts';
import { StoryGame } from './story.ts';

const { level } = buildStoryWorld();
const spot = (id: string) => {
	const p = [
		...level.triggers,
		...level.collectibles,
		...level.landmarks,
		...level.checkpoints.map((c) => ({ ...c.spawn, id: c.id }))
	].find((p) => p.id === id);
	if (!p) throw new Error(id);
	return p;
};
function setup(value?: unknown) {
	const persist = vi.fn(() => true),
		badge = vi.fn();
	return { game: new StoryGame(level, { value, persist, badge }), persist, badge };
}
function start(g: StoryGame) {
	g.act(spot('iara'));
	g.choose('start', spot('iara'));
	g.closeDialogue();
}
function corridor(g: StoryGame) {
	for (const c of level.collectibles.filter((c) => c.kind === 'jucara-fruit')) g.act(c);
	for (const p of level.planting.filter((p) => p.mission === 1)) g.act(p);
	g.closeDialogue();
}
it('emits pickup and completion gestures only for accepted actions, and offers a nearby companion pet', () => {
	const { game: g, persist } = setup();
	const gesture = vi.fn();
	g.onGesture = gesture;
	start(g);
	const fruit = level.collectibles.find((c) => c.kind === 'jucara-fruit');
	if (!fruit) throw new Error('fruit');
	g.act(fruit);
	expect(gesture).toHaveBeenCalledWith('pickup', fruit);
	const count = gesture.mock.calls.length;
	g.act(fruit);
	expect(gesture.mock.calls.length).toBe(count);
	corridor(g);
	expect(gesture).toHaveBeenCalledWith('cheer', null);
	g.companion = { x: 10, y: 1.4, z: 10 };
	const feet = { x: 10, y: 1, z: 11 };
	expect(g.context(feet)?.id).toBe('pet');
	const writes = persist.mock.calls.length;
	g.act(feet);
	expect(gesture).toHaveBeenLastCalledWith('pet', g.companion);
	expect(persist.mock.calls.length).toBe(writes);
	g.companion = null;
	expect(g.context(feet)?.id).not.toBe('pet');
});
it('requires Iara, then mission1, allows 2-5 in any order and locks 6 until all five', () => {
	const { game: g, badge } = setup();
	expect(g.available(2)).toBe(false);
	g.visit(spot('mirante'), true);
	expect(g.finished).toBe(false);
	start(g);
	corridor(g);
	expect(g.completed(1)).toBe(true);
	for (const id of [2, 3, 4, 5]) expect(g.available(id)).toBe(true);
	g.visit(spot('mirante'), true);
	expect(g.completed(6)).toBe(false);
	expect(badge).not.toHaveBeenCalled();
});
it('prevents duplicate pickup/planting and spends exactly one seed per corridor cell', () => {
	const { game: g } = setup();
	start(g);
	g.act(spot('corredor-1'));
	expect(g.progress(1)).toBe(0);
	const c = spot('jucara-1');
	g.act(c);
	g.act(c);
	expect(g.seeds).toBe(1);
	g.act(spot('corredor-1'));
	g.act(spot('corredor-1'));
	expect(g.seeds).toBe(0);
	expect(g.progress(1)).toBe(1);
});
it('rejects radio completion inside logger radius, outside observation spot and for unsafe choices', () => {
	const { game: g } = setup();
	start(g);
	corridor(g);
	g.act(spot('madeireiro'));
	g.choose('report-logger', spot('madeireiro'));
	expect(g.completed(2)).toBe(false);
	g.act(spot('observacao'));
	g.choose('confront', spot('observacao'));
	expect(g.completed(2)).toBe(false);
	g.choose('report-logger', spot('madeireiro'));
	expect(g.completed(2)).toBe(false);
	g.act(spot('observacao'));
	g.choose('report-logger', spot('observacao'));
	expect(g.completed(2)).toBe(true);
});
it('takes exactly six nursery seedlings and derives growth stages from restoration events', () => {
	const { game: g } = setup();
	start(g);
	corridor(g);
	g.act(spot('viveiro'));
	g.act(spot('viveiro'));
	expect(g.seedlings).toBe(6);
	const spots = level.planting.filter((p) => p.mission === 4);
	g.act(spots[0]);
	expect(g.growthStage(spots[0].id)).toBe(1);
	for (const p of spots.slice(1)) g.act(p);
	expect(g.completed(4)).toBe(true);
	expect(g.seedlings).toBe(0);
	expect(g.growthStage(spots[0].id)).toBe(3);
});
it('marks traps from a safe distance and completes only after calling the inspector', () => {
	const { game: g } = setup();
	start(g);
	corridor(g);
	for (const t of level.triggers.filter((t) => t.kind === 'trap')) {
		g.act(t);
		expect(g.data.marked).not.toContain(t.id);
		g.act({ ...t, x: t.x + 2 });
	}
	expect(g.progress(5)).toBe(0);
	expect(g.data.marked).toHaveLength(3);
	const t = spot('armadilha-3');
	g.act({ ...t, x: t.x + 2 });
	expect(g.completed(5)).toBe(true);
});
it('finishes all six, saves before badge, restores progress and never writes on idle frames', () => {
	const { game: g, persist, badge } = setup();
	start(g);
	corridor(g);
	g.visit(spot('pedras-leste'), true);
	g.act(spot('observacao'));
	g.choose('report-logger', spot('observacao'));
	g.closeDialogue();
	g.act(spot('viveiro'));
	for (const p of level.planting.filter((p) => p.mission === 4)) g.act(p);
	for (const t of level.triggers.filter((t) => t.kind === 'trap')) {
		g.act({ ...t, x: t.x + 2 });
		g.act({ ...t, x: t.x + 2 });
	}
	g.visit(spot('mirante'), true);
	expect(g.finished).toBe(true);
	expect(badge).toHaveBeenCalledOnce();
	expect(persist.mock.invocationCallOrder.at(-1)).toBeLessThan(badge.mock.invocationCallOrder[0]);
	const writes = persist.mock.calls.length;
	for (let i = 0; i < 300; i++) g.visit(spot('mirante'), true);
	expect(persist).toHaveBeenCalledTimes(writes);
	expect(badge).toHaveBeenCalledOnce();
	const restored = setup(JSON.parse(JSON.stringify(g.data))).game;
	expect(restored.finished).toBe(true);
});
it('collects optional trash and unlocked leaves once, without bypassing mission prerequisites', () => {
	const { game: g } = setup();
	start(g);
	g.act(spot('lixo-1'));
	g.act(spot('lixo-1'));
	expect(g.trash).toBe(1);
	g.act(spot('folha-missao-6'));
	expect(g.leaves).toBe(0);
	corridor(g);
	const leaf = level.collectibles.find((c) => c.kind === 'gold-leaf' && c.mission === 1);
	if (!leaf) throw new Error('leaf-fixture');
	g.act(leaf);
	expect(g.leaves).toBe(1);
});
it('migrates absent/v0 saves, filters unknown ids, and refuses to overwrite a future save', () => {
	expect(setup().game.data.version).toBe(1);
	expect(setup({ version: 0 }).game.data.version).toBe(1);
	const future = setup({ version: 99, unknown: { valuable: true } });
	start(future.game);
	expect(future.persist).not.toHaveBeenCalled();
	expect(future.game.readOnlySave).toBe(true);
	const valid = setup({
		version: 1,
		started: true,
		fruits: ['jucara-1', 'jucara-1', 'missing'],
		future: { valuable: true }
	}).game;
	expect(valid.seeds).toBe(1);
	expect(valid.data.future).toEqual({ valuable: true });
});
it('a future level save is read-only and a full storage device keeps the current run playable', () => {
	const future = setup({ version: 1, levelVersion: level.version + 1 });
	start(future.game);
	expect(future.persist).not.toHaveBeenCalled();
	const persist = vi.fn(() => false),
		g = new StoryGame(level, { persist, badge: () => {} });
	start(g);
	g.act(spot('jucara-1'));
	expect(g.seeds).toBe(1);
	expect(g.saveError).toBe(true);
});
it('badge storage errors cannot crash a completed saved journey', () => {
	const data = {
		version: 1,
		levelVersion: level.version,
		started: true,
		fruits: level.collectibles.filter((c) => c.kind === 'jucara-fruit').map((c) => c.id),
		planted: level.planting.map((p) => p.id),
		nurseryTaken: true,
		marked: level.triggers.filter((t) => t.kind === 'trap').map((t) => t.id),
		reported: level.triggers.filter((t) => t.kind === 'trap').map((t) => t.id),
		crossed: true,
		loggerReported: true,
		summit: true
	};
	const g = new StoryGame(level, {
		value: data,
		persist: () => true,
		badge: () => {
			throw new Error('quota');
		}
	});
	expect(() => g.repairBadge()).not.toThrow();
	expect(g.finished).toBe(true);
});
it('migrates the pre-fix corridor reward id without restoring an obsolete action namespace', () => {
	const g = setup({ version: 1, started: true, collected: ['corredor-3'] }).game;
	expect(g.data.collected).toEqual(['folha-missao-1']);
});
