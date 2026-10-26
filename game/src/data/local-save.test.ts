import { expect, it } from 'vitest';
import {
	type AvatarProfile,
	createLocalSave,
	decodeAudioPreferences,
	decodeAvatarProfile,
	GAME_SAVE_KEY
} from './local-save.ts';

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
it('v1 avatar saves acquire short painted hair, while v2 stores the accessory id', () => {
	const { hairStyle: _, ...legacy } = profile;
	expect(decodeAvatarProfile(legacy)?.hairStyle).toBe('curto');
	const disk = storage(),
		save = createLocalSave(profile, disk);
	expect(save.setAvatar({ ...profile, hairStyle: 'black-power' })).toBe(true);
	expect(createLocalSave(profile, disk).avatar().hairStyle).toBe('black-power');
});
it('persists story events beside avatar/checkpoints and protects future story formats', () => {
	const disk = storage(),
		save = createLocalSave(profile, disk);
	save.setAvatar(profile);
	save.setCheckpoint('story:1:123', 'bank');
	expect(save.setStory({ version: 1, levelVersion: 1, started: true, extra: { future: true } })).toBe(true);
	expect(createLocalSave(profile, disk).story()).toEqual({
		version: 1,
		levelVersion: 1,
		started: true,
		extra: { future: true }
	});
	expect(save.avatar()).toEqual(profile);
	expect(save.checkpoint('story:1:123')).toBe('bank');
	disk.setItem(GAME_SAVE_KEY, JSON.stringify({ format: 1, story: { version: 2, valuable: true } }));
	expect(save.setStory({ version: 1 })).toBe(false);
	expect(save.story()).toEqual({ version: 2, valuable: true });
});
it('an older open pack cannot overwrite a newer level save written by another window', () => {
	const disk = storage(),
		save = createLocalSave(profile, disk);
	disk.setItem(
		GAME_SAVE_KEY,
		JSON.stringify({ format: 1, story: { version: 1, levelVersion: 2, valuable: true } })
	);
	expect(save.setStory({ version: 1, levelVersion: 1 })).toBe(false);
	expect(save.story()).toEqual({ version: 1, levelVersion: 2, valuable: true });
});
it('keeps the sound settings in their own section, cleaned, next to the other sections', () => {
	const disk = storage();
	const save = createLocalSave(profile, disk);
	expect(save.audio()).toBeNull();
	disk.setItem(GAME_SAVE_KEY, JSON.stringify({ format: 1, story: { version: 1 }, future: { level: 2 } }));
	expect(save.setAudio({ volume: { master: 0.4, ambience: 0 }, muted: { master: true } })).toBe(true);
	expect(createLocalSave(profile, disk).audio()).toEqual({
		version: 1,
		volume: { master: 0.4, ambience: 0 },
		muted: { master: true }
	});
	const doc = JSON.parse(disk.getItem(GAME_SAVE_KEY) ?? '{}');
	expect(doc.story).toEqual({ version: 1 });
	expect(doc.future).toEqual({ level: 2 });
	// Unknown buses, out-of-range volumes and non-boolean mutes never reach the engine.
	expect(
		decodeAudioPreferences({
			version: 1,
			volume: { master: 3, sfx: -1, music: 'loud', radio: 0.5 },
			muted: { ui: 'yes', music: false }
		})
	).toEqual({ version: 1, volume: { master: 1, sfx: 0 }, muted: { music: false } });
	expect(decodeAudioPreferences({ version: 2, volume: { master: 0.5 } })).toBeNull();
	disk.setItem(GAME_SAVE_KEY, '{broken');
	expect(createLocalSave(profile, disk).setAudio({ volume: { master: 1 }, muted: {} })).toBe(false);
});
it('persists handedness, large controls and one-time hints while preserving future sections', () => {
	const disk = storage(),
		save = createLocalSave(profile, disk);
	disk.setItem(GAME_SAVE_KEY, JSON.stringify({ format: 1, future: { value: 7 } }));
	expect(save.controls().leftHanded).toBe(false);
	expect(save.setControls({ version: 1, leftHanded: true, largeButtons: true, hintsSeen: ['lock'] })).toBe(
		true
	);
	expect(createLocalSave(profile, disk).controls()).toMatchObject({
		leftHanded: true,
		largeButtons: true,
		hintsSeen: ['lock']
	});
	expect(JSON.parse(disk.getItem(GAME_SAVE_KEY) ?? '{}').future).toEqual({ value: 7 });
	disk.setItem(GAME_SAVE_KEY, JSON.stringify({ format: 1, controls: { version: 99, valuable: true } }));
	expect(save.setControls({ version: 1, leftHanded: false, largeButtons: false, hintsSeen: [] })).toBe(false);
});
