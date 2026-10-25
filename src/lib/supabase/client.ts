import type { SupabaseClient, User } from '@supabase/supabase-js';
import { PUBLIC_SUPABASE_PUBLISHABLE_KEY, PUBLIC_SUPABASE_URL } from '$app/env/public';
import type { Database } from './database.types.ts';

export const AUTH_STORAGE_KEY = 'guardioes-auth';
export const cloudAvailable = Boolean(PUBLIC_SUPABASE_URL && PUBLIC_SUPABASE_PUBLISHABLE_KEY);
let client: Promise<SupabaseClient<Database> | null> | null = null;

/** Loading this small module never loads the SDK. Guests work entirely locally. */
export function getSupabase(): Promise<SupabaseClient<Database> | null> {
	const url = PUBLIC_SUPABASE_URL;
	const key = PUBLIC_SUPABASE_PUBLISHABLE_KEY;
	if (!url || !key) return Promise.resolve(null);
	if (!client) {
		client = import('@supabase/supabase-js')
			.then(({ createClient }) =>
				createClient<Database>(url, key, {
					auth: {
						persistSession: true,
						autoRefreshToken: true,
						detectSessionInUrl: false,
						storageKey: AUTH_STORAGE_KEY
					}
				})
			)
			.catch((error) => {
				client = null;
				throw error;
			});
	}
	return client;
}

/** Local identity only. Requests still use the SDK's token and server RLS. */
export function readStoredUser(): User | null {
	try {
		if (typeof window === 'undefined') return null;
		const raw = window.localStorage.getItem(AUTH_STORAGE_KEY);
		if (!raw) return null;
		const session = JSON.parse(raw);
		const user = session?.user;
		if (
			typeof session?.access_token !== 'string' ||
			typeof session.refresh_token !== 'string' ||
			typeof user?.id !== 'string' ||
			!/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(user.id)
		)
			return null;
		return {
			id: user.id,
			aud: 'authenticated',
			app_metadata: {},
			user_metadata: {},
			created_at: typeof user.created_at === 'string' ? user.created_at : '',
			...(typeof user.email === 'string' ? { email: user.email } : {})
		};
	} catch {
		return null;
	}
}

/** Local sign-out still works when an optional SDK chunk is unavailable offline. */
export function clearStoredAuth(): void {
	try {
		if (typeof window === 'undefined') return;
		for (const key of [AUTH_STORAGE_KEY, `${AUTH_STORAGE_KEY}-code-verifier`, `${AUTH_STORAGE_KEY}-user`])
			window.localStorage.removeItem(key);
	} catch {
		/* Restricted storage must not crash the local app. */
	}
}
