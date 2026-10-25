import { afterEach, expect, it, vi } from 'vitest';
const fake = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock('./tier.ts', () => ({ pickTier: () => 'full', remember: vi.fn(), demote: () => 'lite' }));
vi.mock('./scene/createDiorama.ts', () => ({ createEngine: fake.create }));
afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); fake.create.mockReset(); });

it.each([true, false])('cancels a pending diorama before handing over the GPU (hidden=%s)', async (hidden) => {
	vi.stubGlobal('document', Object.assign(new EventTarget(), { hidden }));
	const host = await import('./host.svelte.ts');
	host.join();
	const pending = host.getEngine();
	const cancelled = expect(pending).rejects.toThrow();
	const release = await host.acquireGameGpu();
	await cancelled;
	expect(fake.create).not.toHaveBeenCalled();
	release();
});

it('waits for an in-flight engine disposal and holds new dioramas until the game exits', async () => {
	vi.stubGlobal('document', Object.assign(new EventTarget(), { hidden: false }));
	let finish: (value: { dispose: () => void }) => void = () => {};
	fake.create.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
	const host = await import('./host.svelte.ts');
	host.join();
	const pending = host.getEngine();
	await vi.waitFor(() => expect(fake.create).toHaveBeenCalledOnce());
	let handedOver = false;
	const acquiring = host.acquireGameGpu().then((release) => { handedOver = true; return release; });
	await Promise.resolve();
	expect(handedOver).toBe(false);
	const dispose = vi.fn();
	finish({ dispose });
	await pending;
	const release = await acquiring;
	expect(dispose).toHaveBeenCalledOnce();
	fake.create.mockResolvedValue({ dispose: vi.fn() });
	const next = host.getEngine();
	await Promise.resolve();
	expect(fake.create).toHaveBeenCalledOnce();
	release();
	await next;
	expect(fake.create).toHaveBeenCalledTimes(2);
});
