// Temporary v1 fixture while the asset producer replaces its earlier region-map format.

import type { AvatarProfile } from '../data/local-save.ts';
import regions from './atlas.fixture.json';
import { decodeAvatarAtlas } from './atlas.ts';
export const ATLAS_SOURCE = 'fixture';
export const AVATAR_ATLAS = decodeAvatarAtlas(regions);
export const AVATAR_PRESETS = AVATAR_ATLAS.presets;
export const DEFAULT_AVATAR: AvatarProfile = {
	style: 'classic',
	kenneySkin: 'a',
	colors: { ...AVATAR_PRESETS[0].colors },
	face: AVATAR_PRESETS[0].face
};
const urls = import.meta.glob<string>('../assets/skins/skin-*.webp', {
	eager: true,
	query: '?url',
	import: 'default'
});
export const KENNEY_SKINS: Readonly<Record<string, string>> = Object.fromEntries(
	Object.entries(urls)
		.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
		.map(([path, url]) => {
			const match = /skin-([a-r])\.webp$/.exec(path);
			if (!match) throw new Error('kenney-skin-invalid');
			return [match[1], url];
		})
);
if (Object.keys(KENNEY_SKINS).length !== 18) throw new Error('kenney-skins-incomplete');
