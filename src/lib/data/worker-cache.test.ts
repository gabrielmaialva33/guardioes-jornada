import { describe, expect, it } from 'vitest';
import { cachePrefix, obsoleteCaches, previousAsset } from './worker-cache.ts';

describe('service worker cache ownership', () => {
	it('does not delete other apps or base paths and retains the previous build', () => {
		const prefix = cachePrefix('/park/'),
			current = prefix + '3';
		expect(
			obsoleteCaches(
				['other-app', cachePrefix('/other/') + '1', prefix + '1', prefix + '2', current],
				prefix,
				current
			)
		).toEqual([prefix + '1']);
	});
	it('serves immutable assets still needed by an old open window', async () => {
		const prefix = cachePrefix('/park/'),
			path = '/park/_app/immutable/old.js';
		const storage = {
			keys: async () => ['other-app', prefix + '1', prefix + '2'],
			open: async (name: string) => ({
				match: async (request: string) =>
					name === prefix + '1' && request === path ? new Response('previous build') : undefined
			})
		} as unknown as CacheStorage;
		expect(await (await previousAsset(storage, prefix, prefix + '2', path))?.text()).toBe('previous build');
	});
});
