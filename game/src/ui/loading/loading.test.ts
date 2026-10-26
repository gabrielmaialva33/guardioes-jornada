import { describe, expect, it, vi } from 'vitest';
import { FACT_MS, FACTS, factIndex } from './facts.ts';
import { LOADING, LoadingProgress, type LoadingSnapshot, STAGES } from './loading.ts';

function setup() {
	let now = 1000;
	const model = new LoadingProgress({ clock: () => now });
	/** Advances the clock in 16 ms frames and returns every snapshot. */
	const run = (ms: number) => {
		const frames: LoadingSnapshot[] = [];
		for (let t = 0; t < ms; t += 16) {
			now += 16;
			frames.push(model.update());
		}
		return frames;
	};
	return { model, run, at: () => now };
}

function deferred() {
	let resolve!: () => void;
	let reject!: (error: unknown) => void;
	const promise = new Promise<void>((yes, no) => {
		resolve = yes;
		reject = no;
	});
	return { promise, resolve, reject };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function expectMonotone(frames: LoadingSnapshot[], from = 0) {
	let last = from;
	for (const frame of frames) {
		expect(frame.fraction).toBeGreaterThanOrEqual(last);
		last = frame.fraction;
	}
	return last;
}

describe('LoadingProgress', () => {
	it('creeps while idle, but stays low', () => {
		const { model, run } = setup();
		const frames = run(5000);
		expectMonotone(frames);
		expect(frames.at(-1)?.fraction).toBeGreaterThan(0);
		expect(frames.at(-1)?.fraction).toBeLessThanOrEqual(LOADING.idleShare);
		expect(model.update().label).toBe(LOADING.idleLabel);
	});

	it('follows finished weight, never backwards, never full before ready', async () => {
		const { model, run } = setup();
		const a = deferred();
		const b = deferred();
		model.track('placements', a.promise, 3);
		model.track('life', b.promise, 1);
		let last = expectMonotone(run(500));
		a.resolve();
		b.resolve();
		await flush();
		const settled = run(4000);
		last = expectMonotone(settled, last);
		expect(last).toBeLessThanOrEqual(LOADING.ceiling);
		expect(last).toBeGreaterThan(LOADING.ceiling - 0.01);
		// A late task raises the total weight: the bar holds instead of dropping.
		const late = deferred();
		model.reserve('compile', 4);
		model.track('compile', late.promise);
		last = expectMonotone(run(2000), last);
		expect(model.update().phase).toBe('loading');
		expect(model.update().label).toBe('Preparando as cores');
		model.ready();
		const finish = run(1000);
		expectMonotone(finish, last);
		expect(finish.at(-1)?.fraction).toBe(1);
	});

	it('labels the first unfinished stage in display order', async () => {
		const { model } = setup();
		const story = deferred();
		const life = deferred();
		const placements = deferred();
		model.track('story', story.promise);
		model.track('life', life.promise);
		model.track('placements', placements.promise);
		model.track('sound', undefined);
		expect(model.update().label).toBe('Plantando as árvores');
		placements.resolve();
		await flush();
		expect(model.update().label).toBe('Acordando os bichos');
		life.resolve();
		await flush();
		expect(model.update().label).toBe('Chamando a Iara');
		story.resolve();
		await flush();
		expect(model.update().label).toBe(LOADING.idleLabel);
		model.ready();
		expect(model.update().label).toBe(LOADING.readyLabel);
	});

	it('lists every stage the brief names, kid-friendly verbs first', () => {
		const labels = STAGES.map((stage) => stage.label);
		for (const label of [
			'Plantando as árvores',
			'Acordando os bichos',
			'Afinando os sons da mata',
			'Chamando a Iara',
			'Preparando as cores'
		])
			expect(labels).toContain(label);
	});

	it('shows for at least the minimum time, then fades and finishes', () => {
		const { model, run, at } = setup();
		const start = at();
		model.ready();
		const frames = run(LOADING.minVisibleMs + LOADING.fadeMs + 200);
		const leaving = frames.findIndex((frame) => frame.phase === 'leaving');
		const done = frames.findIndex((frame) => frame.phase === 'done');
		expect(leaving).toBeGreaterThan(0);
		expect(start + (leaving + 1) * 16 - start).toBeGreaterThanOrEqual(LOADING.minVisibleMs);
		expect(frames[leaving].fraction).toBe(1);
		expect((done - leaving) * 16).toBeGreaterThanOrEqual(LOADING.fadeMs);
		expect((done - leaving) * 16).toBeLessThan(LOADING.fadeMs + 32);
		for (const frame of frames.slice(0, leaving)) expect(frame.phase).toBe('loading');
	});

	it('finishes quickly once ready after a long load', async () => {
		const { model, run } = setup();
		const task = deferred();
		model.track('placements', task.promise);
		run(5000);
		task.resolve();
		await flush();
		model.ready();
		const frames = run(1200);
		const leaving = frames.findIndex((frame) => frame.phase === 'leaving');
		expect(leaving).toBeGreaterThan(-1);
		expect(leaving * 16).toBeLessThan(700);
	});

	it('switches to the error state on a failure, ignoring aborts', async () => {
		const { model, run } = setup();
		const aborted = deferred();
		model.track('avatar', aborted.promise);
		aborted.reject(new DOMException('stop', 'AbortError'));
		await flush();
		expect(model.update().phase).toBe('loading');
		const broken = deferred();
		model.track('life', broken.promise);
		broken.reject(new Error('network'));
		await flush();
		const snapshot = model.update();
		expect(snapshot.phase).toBe('error');
		expect(snapshot.error).toBe('failed');
		// ready() after a failure does not hide the error.
		model.ready();
		expect(run(2000).every((frame) => frame.phase === 'error')).toBe(true);
	});

	it('retries from the error state, keeping the bar where it was', async () => {
		const { model, run } = setup();
		const onretry = vi.fn();
		model.onretry = onretry;
		const ok = deferred();
		model.track('placements', ok.promise, 2);
		ok.resolve();
		const broken = deferred();
		model.track('life', broken.promise);
		broken.reject(new Error('x'));
		await flush();
		const before = run(1000).at(-1)?.fraction ?? 0;
		expect(model.phase).toBe('error');
		model.retry();
		expect(onretry).toHaveBeenCalledOnce();
		expect(model.phase).toBe('loading');
		expect(model.tracksWorld).toBe(false);
		const fresh = deferred();
		model.track('life', fresh.promise);
		expectMonotone(run(1000), before);
		// A rejection from the abandoned attempt does not fail the new one.
		expect(model.update().error).toBeNull();
	});

	it('reports a device without 3D as unsupported, with no retry', async () => {
		const { model } = setup();
		const onretry = vi.fn();
		model.onretry = onretry;
		model.fail(new Error('game-webgl-unavailable'));
		expect(model.update().error).toBe('unsupported');
		model.retry();
		expect(onretry).not.toHaveBeenCalled();
		expect(model.phase).toBe('error');
	});

	it('keeps a reserved weight and treats a missing loader as done', async () => {
		const { model, run } = setup();
		model.reserve('compile', 9);
		model.track('sound', undefined, 1);
		const frames = run(3000);
		// Only 1 of 10 weight is done and compile has not started: well under 20%.
		expect(frames.at(-1)?.fraction).toBeLessThan(0.15);
		expect(model.tracksWorld).toBe(true);
		model.track('compile', Promise.resolve());
		await flush();
		expect(run(3000).at(-1)?.fraction).toBeGreaterThan(0.9);
	});

	it('survives a long hidden tab (one huge frame)', () => {
		const { model, run } = setup();
		model.ready();
		run(16);
		const frames = run(60_000);
		expect(frames.at(-1)?.phase).toBe('done');
		expect(Number.isFinite(frames.at(-1)?.fraction)).toBe(true);
	});
});

describe('facts', () => {
	it('has ten short facts, one per subject the game shows', () => {
		expect(FACTS).toHaveLength(10);
		expect(new Set(FACTS.map((fact) => fact.about)).size).toBe(10);
		for (const subject of [
			'muriqui',
			'mico-leão-dourado',
			'bugio',
			'onça-pintada',
			'tucano',
			'preguiça',
			'jequitibá',
			'pau-brasil',
			'juçara',
			'araucária'
		])
			expect(FACTS.some((fact) => fact.about === subject)).toBe(true);
		for (const fact of FACTS) expect(fact.text.length).toBeLessThanOrEqual(120);
	});

	it('rotates every FACT_MS and wraps', () => {
		expect(factIndex(0)).toBe(0);
		expect(factIndex(FACT_MS - 1)).toBe(0);
		expect(factIndex(FACT_MS)).toBe(1);
		expect(factIndex(FACT_MS * 10)).toBe(0);
		expect(factIndex(FACT_MS * 2, 9)).toBe(1);
		expect(factIndex(-5, -1)).toBe(9);
	});
});
