import { expect, it, vi } from 'vitest';

const fake = vi.hoisted(() => {
	let getSession!: (value: unknown) => void, signOut!: (value: unknown) => void;
	const initial = new Promise((resolve) => {
		getSession = resolve;
	});
	const logout = new Promise((resolve) => {
		signOut = resolve;
	});
	return { getSession, signOut, initial, logout, listener: (_event: string, _session: unknown) => {} };
});
vi.mock('#lib/supabase/client.ts', () => ({
	supabase: {
		auth: {
			onAuthStateChange: (listener: typeof fake.listener) => {
				fake.listener = listener;
			},
			getSession: () => fake.initial,
			signOut: () => fake.logout
		}
	}
}));

it('a sign-out during initialization rejects stale restoration and refresh callbacks', async () => {
	const { auth } = await import('./auth.svelte.ts');
	const initialization = auth.init(),
		logout = auth.signOut();
	const session = { user: { id: '11111111-1111-4111-8111-111111111111' } };
	fake.listener('TOKEN_REFRESHED', session);
	fake.getSession({ data: { session }, error: null });
	await initialization;
	expect(auth.user).toBeNull();
	expect(auth.generation).toBeGreaterThan(0);
	fake.signOut({ error: null });
	await logout;
	expect(auth.user).toBeNull();
});
