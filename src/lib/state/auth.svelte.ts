import type { AuthError, User } from '@supabase/supabase-js';
import { supabase } from '#lib/supabase/client.ts';
import { sessions } from './sessions.svelte.ts';

/**
 * The guide's cloud account. Students never sign in. Sign-in uses a 6-digit
 * code typed inside the app: email links would open a separate browser tab
 * that does not share the installed PWA's storage.
 */
class GuideAuth {
	user = $state<User | null>(null);
	ready = $state(false);
	generation = $state(0);
	readonly available = supabase !== null;
	#listeners = new Set<() => void>();
	#initializing: Promise<void> | null = null;
	#signingOut: Promise<void> | null = null;
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
		return (this.#initializing ??= this.#init());
	}
	async #init() {
		if (!supabase) {
			this.#apply(null);
			this.ready = true;
			return;
		}
		// getSession reads local storage, so the guide stays signed in offline.
		// Keep this callback synchronous: awaiting other Supabase calls here can deadlock.
		supabase.auth.onAuthStateChange((_event, session) => {
			if (this.#signingOut && session?.user) return;
			this.#apply(session?.user ?? null);
		});
		const generation = this.generation;
		try {
			const { data, error } = await supabase.auth.getSession();
			if (generation === this.generation) this.#apply(error ? null : (data.session?.user ?? null));
		} catch {
			if (generation === this.generation) this.#apply(null);
		} finally {
			this.ready = true;
		}
	}

	async sendCode(email: string) {
		if (!supabase) throw new Error('cloud-unavailable');
		await this.#signingOut;
		const { error } = await supabase.auth.signInWithOtp({
			email: email.trim().toLowerCase(),
			options: { shouldCreateUser: true }
		});
		if (error) throw error;
	}

	async verifyCode(email: string, code: string) {
		if (!supabase) throw new Error('cloud-unavailable');
		await this.#signingOut;
		const { error } = await supabase.auth.verifyOtp({
			email: email.trim().toLowerCase(),
			token: code.replace(/\D/g, ''),
			type: 'email'
		});
		if (error) throw error;
	}

	signOut(): Promise<void> {
		if (this.#signingOut) return this.#signingOut;
		// Invalidate requests and hide this owner's records before any network await.
		this.#apply(null);
		// Also invalidate initialization when the previous user was not known yet.
		this.generation++;
		// Local scope: sign out on this phone without touching the guide's other devices.
		return (this.#signingOut = Promise.resolve()
			.then(async () => {
				const result = await supabase?.auth.signOut({ scope: 'local' });
				if (result?.error) throw result.error;
			})
			.finally(() => {
				this.#signingOut = null;
			}));
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
