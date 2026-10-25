import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { PUBLIC_SUPABASE_PUBLISHABLE_KEY, PUBLIC_SUPABASE_URL } from '$app/env/public';
import type { Database } from './database.types.ts';

/**
 * The cloud is optional. Without these settings `supabase` is null and the
 * app runs entirely on the device.
 *
 * Client-only on purpose (no @supabase/ssr): the app is static and has no
 * server, so the guide's session lives in localStorage and works offline.
 */
export const supabase: SupabaseClient<Database> | null =
	PUBLIC_SUPABASE_URL && PUBLIC_SUPABASE_PUBLISHABLE_KEY
		? createClient<Database>(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
				auth: {
					persistSession: true,
					autoRefreshToken: true,
					// Guides sign in with a typed code, never a redirect.
					detectSessionInUrl: false,
					storageKey: 'guardioes-auth'
				}
			})
		: null;
