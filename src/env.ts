import { defineEnvVars } from '@sveltejs/kit/env';

/**
 * Supabase is optional: without these values the app still runs fully
 * offline, it just cannot back sessions up or verify certificates.
 * Both values are public by design (Project Settings > API in Supabase).
 */
export const variables = defineEnvVars({
	PUBLIC_SUPABASE_URL: {
		public: true,
		static: true,
		description: 'Supabase project URL, e.g. https://<ref>.supabase.co',
		schema: (value) => {
			if (!value) return undefined;
			const url = new URL(value);
			if (url.protocol !== 'https:') throw new Error('PUBLIC_SUPABASE_URL must use https');
			return url.origin;
		}
	},
	PUBLIC_SUPABASE_PUBLISHABLE_KEY: {
		public: true,
		static: true,
		description: 'Supabase publishable key (sb_publishable_...). Never put a secret key here.',
		schema: (value) => {
			if (!value) return undefined;
			if (!value.startsWith('sb_publishable_')) {
				throw new Error('PUBLIC_SUPABASE_PUBLISHABLE_KEY must be a publishable key (sb_publishable_...)');
			}
			return value;
		}
	}
});
