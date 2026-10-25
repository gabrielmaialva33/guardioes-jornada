import { describe, expect, it, vi } from 'vitest';
import { beginGamePresentation, type PresentationEnvironment } from './game-presentation.ts';

function setup() {
	let current: unknown = null;
	const root = {
		requestFullscreen: vi.fn(async () => {
			current = root;
		})
	};
	const environment = {
		fullscreenElement: () => current,
		exitFullscreen: vi.fn(async () => {
			current = null;
		}),
		orientation: { lock: vi.fn(async () => {}), unlock: vi.fn() }
	} satisfies PresentationEnvironment;
	return {
		root,
		environment,
		setCurrent: (value: unknown) => {
			current = value;
		}
	};
}
describe('game presentation lease', () => {
	it('requests fullscreen in the gesture, then landscape; releases to the manifest default once', async () => {
		const { root, environment } = setup();
		const lease = beginGamePresentation(root, environment);
		expect(root.requestFullscreen).toHaveBeenCalledOnce();
		expect(environment.orientation?.lock).not.toHaveBeenCalled();
		expect(await lease.ready).toBe(true);
		expect(environment.orientation?.lock).toHaveBeenCalledWith('landscape');
		await lease.release();
		await lease.release();
		expect(environment.orientation?.unlock).toHaveBeenCalledOnce();
		expect(environment.exitFullscreen).toHaveBeenCalledOnce();
	});
	it('supports standalone orientation lock even if fullscreen is denied, and degrades on rejection', async () => {
		const { root, environment } = setup();
		root.requestFullscreen.mockRejectedValue(new Error('denied'));
		const lease = beginGamePresentation(root, environment);
		expect(await lease.ready).toBe(true);
		await lease.release();
		expect(environment.orientation?.unlock).toHaveBeenCalledOnce();
		expect(environment.exitFullscreen).not.toHaveBeenCalled();
		vi.mocked(environment.orientation?.lock).mockRejectedValue(new Error('not supported'));
		const failed = beginGamePresentation(root, environment);
		expect(await failed.ready).toBe(false);
		await expect(failed.release()).resolves.toBeUndefined();
	});
	it('handles missing APIs without throwing', async () => {
		const lease = beginGamePresentation({}, { fullscreenElement: () => null });
		expect(await lease.ready).toBe(false);
		await lease.release();
	});
	it('cleans a late fullscreen resolution without locking after cancellation', async () => {
		const { root, environment, setCurrent } = setup();
		let finish = () => {};
		root.requestFullscreen.mockImplementation(
			() =>
				new Promise<void>((resolve) => {
					finish = () => {
						setCurrent(root);
						resolve();
					};
				})
		);
		const lease = beginGamePresentation(root, environment);
		const released = lease.release();
		finish();
		await released;
		expect(environment.orientation?.lock).not.toHaveBeenCalled();
		expect(environment.exitFullscreen).toHaveBeenCalledOnce();
	});
	it('releases an orientation lock which resolves after cancellation', async () => {
		const { root, environment } = setup();
		let finish = () => {};
		vi.mocked(environment.orientation?.lock).mockImplementation(
			() =>
				new Promise<void>((resolve) => {
					finish = resolve;
				})
		);
		const lease = beginGamePresentation(root, environment);
		await Promise.resolve();
		const released = lease.release();
		finish();
		await released;
		expect(environment.orientation?.unlock).toHaveBeenCalledOnce();
		expect(environment.exitFullscreen).toHaveBeenCalledOnce();
	});
	it('preserves fullscreen that the caller already owned', async () => {
		const { root, environment, setCurrent } = setup();
		setCurrent(root);
		const lease = beginGamePresentation(root, environment);
		await lease.ready;
		await lease.release();
		expect(root.requestFullscreen).not.toHaveBeenCalled();
		expect(environment.exitFullscreen).not.toHaveBeenCalled();
	});
});
