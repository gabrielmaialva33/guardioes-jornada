import { expect, it, vi } from 'vitest';
import type { AvatarProfile } from '../data/local-save.ts';
import { SkinUpdates } from './updates.ts';

const profile: AvatarProfile = {
	style: 'classic',
	kenneySkin: 'a',
	face: 'smile',
	colors: { skin: '#a87855', hair: '#35291f', shirt: '#2d6a4f', pants: '#4f5c55', shoes: '#5e4330' }
};
function setup() {
	const sink = { classic: vi.fn(), kenney: vi.fn(), commit: vi.fn() };
	const pending = new Map<string, (image: { close: () => void }) => void>();
	const loader = vi.fn(
		(id: string) => new Promise<{ close: () => void }>((resolve) => pending.set(id, resolve))
	);
	return { sink, pending, updates: new SkinUpdates(sink, loader) };
}
it('does not repaint an unchanged choice, even with new profile objects each frame', async () => {
	const { sink, updates } = setup();
	for (let i = 0; i < 60; i++) await updates.apply({ ...profile, colors: { ...profile.colors } });
	expect(sink.commit).toHaveBeenCalledTimes(1);
	expect(sink.classic).toHaveBeenCalledTimes(1);
	await updates.apply({ ...profile, face: 'neutral' });
	expect(sink.commit).toHaveBeenCalledTimes(2);
	updates.dispose();
});
it('a late Kenney download never replaces a newer classic choice and always closes its bitmap', async () => {
	const { sink, pending, updates } = setup();
	const old = updates.apply({ ...profile, style: 'kenney' });
	await updates.apply(profile);
	const image = { close: vi.fn() };
	pending.get('a')?.(image);
	expect(await old).toBe(false);
	expect(sink.kenney).not.toHaveBeenCalled();
	expect(image.close).toHaveBeenCalledOnce();
	updates.dispose();
});
it('disposal cancels pending painting, including a loader which resolves after abort', async () => {
	const { sink, pending, updates } = setup();
	const old = updates.apply({ ...profile, style: 'kenney' });
	updates.dispose();
	const image = { close: vi.fn() };
	pending.get('a')?.(image);
	expect(await old).toBe(false);
	expect(sink.commit).not.toHaveBeenCalled();
	expect(image.close).toHaveBeenCalledOnce();
});
it('returning to the committed skin cancels a pending change without repainting', async () => {
	const { sink, pending, updates } = setup();
	await updates.apply(profile);
	const old = updates.apply({ ...profile, style: 'kenney' });
	await updates.apply(profile);
	pending.get('a')?.({ close: vi.fn() });
	await old;
	expect(sink.commit).toHaveBeenCalledTimes(1);
	updates.dispose();
});
