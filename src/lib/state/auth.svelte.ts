import type { AuthError, SupabaseClient, User } from '@supabase/supabase-js';
import { AUTH_STORAGE_KEY, clearStoredAuth, cloudAvailable, getSupabase, readStoredUser } from '#lib/supabase/client.ts';
import type { Database } from '#lib/supabase/database.types.ts';
import { sessions } from './sessions.svelte.ts';

/**
 * The guide's cloud account. Students never sign in. Sign-in uses a 6-digit
 * code typed inside the app: email links would open a separate browser tab
 * that does not share the installed PWA's storage.
 */
export class GuideAuth {
	user = $state<User | null>(null);
	ready = $state(false);
	generation = $state(0);
	readonly available = cloudAvailable;
	#listeners = new Set<() => void>();
	#initializing: Promise<void> | null = null;
	#signingOut: Promise<void> | null = null;
	#connection: Promise<SupabaseClient<Database> | null> | null = null;
	onChange(listener: () => void) {
		this.#listeners.add(listener);
		return () => {
			this.#listeners.delete(listener);
		};
	}
	#apply(user: User | null) {
		const changed = this.user?.id !== user?.id;
		this.user = user;
		sessions.setOwner(user?.id ?? null);
		if (changed) {
			this.generation++;
			for (const listener of this.#listeners) listener();
		}
	}

	init(): Promise<void> {
		this.#initializing ??= this.#init();
		return this.#initializing;
	}
	async #init() {
		this.#apply(this.available ? readStoredUser() : null);
		if (typeof window !== 'undefined') {
			window.addEventListener('storage', (event) => {
				if (event.key !== AUTH_STORAGE_KEY && event.key !== null) return;
				this.#apply(this.available ? readStoredUser() : null);
				if (this.user && navigator.onLine) void this.#restore();
			});
			window.addEventListener('online', () => {
				if (this.user) void this.#restore();
			});
		}
		try {
			if (this.user && (typeof navigator === 'undefined' || navigator.onLine !== false))
				await this.#restore();
		} finally {
			this.ready = true;
		}
	}
	#connect(): Promise<SupabaseClient<Database> | null> {
		if (!this.#connection) {
			const generation = this.generation;
			this.#connection = getSupabase()
				.then((client) => {
					// Keep callbacks synchronous: awaited SDK calls here can deadlock.
					client?.auth.onAuthStateChange((event, session) => {
						if (this.#signingOut && session?.user) return;
						if (event === 'INITIAL_SESSION' && generation !== this.generation) return;
						this.#apply(session?.user ?? null);
					});
					return client;
				})
				.catch((error) => {
					this.#connection = null;
					throw error;
				});
		}
		return this.#connection;
	}
	async #restore() {
		const generation = this.generation;
		try {
			const client = await this.#connect();
			if (!client || generation !== this.generation) return;
			const { data, error } = await client.auth.getSession();
			if (generation === this.generation) {
				const retryable = error?.name === 'AuthRetryableFetchError';
				this.#apply(retryable ? readStoredUser() : error ? null : (data.session?.user ?? null));
			}
		} catch {
			// A new SDK chunk may be unavailable after an offline update. Keep the
			// cached owner visible; the queue cannot send without a real SDK session.
			if (generation === this.generation) this.#apply(readStoredUser());
		}
	}

	async sendCode(email: string) {
		if (!this.available) throw new Error('cloud-unavailable');
		await this.#signingOut;
		const client = await this.#connect();
		if (!client) throw new Error('cloud-unavailable');
		const { error } = await client.auth.signInWithOtp({
			email: email.trim().toLowerCase(),
			options: { shouldCreateUser: true }
		});
		if (error) throw error;
	}

	async verifyCode(email: string, code: string) {
		if (!this.available) throw new Error('cloud-unavailable');
		await this.#signingOut;
		const client = await this.#connect();
		if (!client) throw new Error('cloud-unavailable');
		const { error } = await client.auth.verifyOtp({
			email: email.trim().toLowerCase(),
			token: code.replace(/\D/g, ''),
			type: 'email'
		});
		if (error) throw error;
	}

	signOut(): Promise<void> {
		if (this.#signingOut) return this.#signingOut;
		// Invalidate requests and hide this owner's records before any network await.
		const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
		const needsClient = this.#connection !== null || (!offline && readStoredUser() !== null);
		if (offline) clearStoredAuth();
		this.#apply(null);
		// Also invalidate initialization when the previous user was not known yet.
		this.generation++;
		// Local scope: sign out on this phone without touching the guide's other devices.
		this.#signingOut = Promise.resolve()
			.then(async () => {
				const client = needsClient ? await this.#connect() : null;
				const result = await client?.auth.signOut({ scope: 'local' });
				if (result?.error) throw result.error;
			})
			.finally(() => {
				clearStoredAuth();
				this.#signingOut = null;
			});
		return this.#signingOut;
	}
}

export const auth = new GuideAuth();

/** Turns Supabase auth errors into instructions the guide can act on. */
export function describeAuthError(error: unknown): string {
	if (!navigator.onLine) return 'Sem internet agora. Conecte-se e tente de novo.';
	const e = error as Partial<AuthError>;
	switch (e.code) {
		case 'otp_expired':
			return 'Código expirado ou incorreto. Peça um novo código.';
		case 'over_email_send_rate_limit':
		case 'over_request_rate_limit':
			return 'Muitas tentativas seguidas. Espere alguns minutos e tente de novo.';
		case 'email_address_invalid':
		case 'validation_failed':
			return 'Confira o e-mail digitado.';
		default:
			return 'Não foi possível entrar agora. Tente de novo em instantes.';
	}
}
