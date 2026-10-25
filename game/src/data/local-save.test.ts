import { expect, it } from 'vitest';
import { type AvatarProfile, createLocalSave, decodeAvatarProfile, GAME_SAVE_KEY } from './local-save.ts';

const profile: AvatarProfile = {
	hairStyle: 'curto',
	style: 'classic',
	face: 'smile',
	kenneySkin: 'a',
	colors: { skin: '#b87850', hair: '#35291f', shirt: '#2d6a4f', pants: '#4f5c55', shoes: '#4f5c55' }
};
function storage() {
	const values = new Map<string, string>();
	return {
		values,
		getItem: (key: string) => values.get(key) ?? null,
		setItem: (key: string, value: string) => {
			values.set(key, value);
		}
	};
}
it('persists the chosen style/colours and keeps unrelated/new game sections', () => {
	const disk = storage();
	const save = createLocalSave(profile, disk);
	expect(save.avatar()).toEqual(profile);
	disk.setItem(GAME_SAVE_KEY, JSON.stringify({ format: 1, survival: { seed: 42 }, future: { level: 2 } }));
	const changed = { ...profile, style: 'kenney' as const, kenneySkin: 'r' };
	expect(save.setAvatar(changed)).toBe(true);
	expect(createLocalSave(profile, disk).avatar()).toEqual(changed);
	expect(JSON.parse(disk.getItem(GAME_SAVE_KEY) ?? '{}').survival).toEqual({ seed: 42 });
	expect(JSON.parse(disk.getItem(GAME_SAVE_KEY) ?? '{}').future).toEqual({ level: 2 });
});
it('validates disk colours/style/skin and returns independent defaults', () => {
	const disk = storage();
	disk.setItem(GAME_SAVE_KEY, JSON.stringify({ format: 1, avatar: { ...profile, kenneySkin: 'z' } }));
	const save = createLocalSave(profile, disk);
	const loaded = save.avatar();
	loaded.colors.skin = '#ffffff';
	expect(save.avatar()).toEqual(profile);
	expect(decodeAvatarProfile({ ...profile, colors: { ...profile.colors, skin: 'url(secret)' } })).toBeNull();
	expect(decodeAvatarProfile({ ...profile, style: 'invalid' })).toBeNull();
});
it('does not overwrite a future format or corrupted game save', () => {
	for (const value of ['{broken', JSON.stringify({ format: 2, avatar: profile, survival: { day: 4 } })]) {
		const disk = storage();
		disk.setItem(GAME_SAVE_KEY, value);
		const save = createLocalSave(profile, disk);
		expect(save.avatar()).toEqual(profile);
		expect(save.setAvatar(profile)).toBe(false);
		expect(disk.getItem(GAME_SAVE_KEY)).toBe(value);
	}
});
it('degrades gracefully when storage is unavailable or full', () => {
	const save = createLocalSave(profile, {
		getItem() {
			throw new Error('unavailable');
		},
		setItem() {
			throw new Error('quota');
		}
	});
	expect(save.avatar()).toEqual(profile);
	expect(save.setAvatar(profile)).toBe(false);
});
it('saves checkpoints per map checksum without replacing avatar or other sections', () => {
	const disk = storage(),
		save = createLocalSave(profile, disk);
	save.setAvatar(profile);
	expect(save.setCheckpoint('story:1:123', 'stones-east')).toBe(true);
	expect(createLocalSave(profile, disk).checkpoint('story:1:123')).toBe('stones-east');
	expect(save.checkpoint('story:2:234')).toBeNull();
	expect(save.avatar()).toEqual(profile);
	expect(save.setCheckpoint('story:1:123', 'x'.repeat(200))).toBe(false);
});
