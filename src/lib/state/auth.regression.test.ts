import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const fake = vi.hoisted(() => ({
	cachedUser: { id: '11111111-1111-4111-8111-111111111111' } as { id: string } | null,
	listener: (_event: string, _session: unknown) => {},
	clear: vi.fn(),
	load: vi.fn(),
	getSession: vi.fn(),
	signOut: vi.fn(),
	sendCode: vi.fn()
}));
vi.mock('#lib/supabase/client.ts', () => ({
	AUTH_STORAGE_KEY: 'guardioes-auth',
	cloudAvailable: true,
	clearStoredAuth: () => fake.clear(),
	readStoredUser: () => fake.cachedUser,
	getSupabase: () => fake.load()
}));
const client = {
	auth: {
		onAuthStateChange: (listener: typeof fake.listener) => {
			fake.listener = listener;
		},
		getSession: () => fake.getSession(),
		signOut: () => fake.signOut(),
		signInWithOtp: (input: unknown) => fake.sendCode(input)
	}
};
beforeEach(() => {
	fake.cachedUser = { id: '11111111-1111-4111-8111-111111111111' };
	fake.clear.mockReset().mockImplementation(() => { fake.cachedUser = null; });
	fake.load.mockReset().mockResolvedValue(client);
	fake.getSession
		.mockReset()
		.mockResolvedValue({ data: { session: { user: fake.cachedUser } }, error: null });
	fake.signOut.mockReset().mockResolvedValue({ error: null });
	fake.sendCode.mockReset().mockResolvedValue({ error: null });
});
afterEach(() => vi.unstubAllGlobals());
it('a sign-out during initialization rejects stale restoration and refresh callbacks', async () => {
	const { GuideAuth } = await import('./auth.svelte.ts');
	const auth = new GuideAuth();
	let restore!: (value: unknown) => void;
	fake.getSession.mockImplementation(
		() =>
			new Promise((resolve) => {
				restore = resolve;
			})
	);
	const initialization = auth.init();
	await Promise.resolve();
	await Promise.resolve();
	await Promise.resolve();
	const logout = auth.signOut(),
		session = { user: fake.cachedUser };
	fake.listener('TOKEN_REFRESHED', session);
	restore({ data: { session }, error: null });
	await initialization;
	await logout;
	expect(auth.user).toBeNull();
	expect(auth.generation).toBeGreaterThan(0);
});
it('does not load the SDK for a guest until an explicit sign-in action', async () => {
	fake.cachedUser = null;
	const { GuideAuth } = await import('./auth.svelte.ts');
	const auth = new GuideAuth();
	await auth.init();
	expect(auth.available).toBe(true);
	expect(auth.ready).toBe(true);
	expect(fake.load).not.toHaveBeenCalled();
	await auth.sendCode(' Synthetic@Example.test ');
	expect(fake.load).toHaveBeenCalledOnce();
	expect(fake.sendCode).toHaveBeenCalledWith({
		email: 'synthetic@example.test',
		options: { shouldCreateUser: true }
	});
});
it('keeps the cached owner visible offline without needing the SDK chunk', async () => {
	vi.stubGlobal('navigator', { onLine: false });
	const { GuideAuth } = await import('./auth.svelte.ts');
	const auth = new GuideAuth();
	await auth.init();
	expect(auth.user?.id).toBe(fake.cachedUser?.id);
	expect(auth.ready).toBe(true);
	expect(fake.load).not.toHaveBeenCalled();
	await auth.signOut();
	expect(auth.user).toBeNull(); expect(fake.cachedUser).toBeNull(); expect(fake.load).not.toHaveBeenCalled();
});
it('retains the cached owner for transient refresh failures but accepts an invalidated session', async () => {
	const { GuideAuth } = await import('./auth.svelte.ts');
	fake.getSession.mockResolvedValue({ data: { session: null }, error: { name: 'AuthRetryableFetchError' } });
	const temporary = new GuideAuth(); await temporary.init(); expect(temporary.user?.id).toBe(fake.cachedUser?.id);
	fake.getSession.mockResolvedValue({ data: { session: null }, error: { name: 'AuthApiError', status: 401 } });
	const revoked = new GuideAuth(); await revoked.init(); expect(revoked.user).toBeNull();
});
it('preserves local owner access when an online SDK chunk fails to load', async () => {
	fake.load.mockRejectedValue(new Error('Chunk unavailable'));
	const { GuideAuth } = await import('./auth.svelte.ts');
	const auth = new GuideAuth();
	await auth.init();
	expect(auth.user?.id).toBe(fake.cachedUser?.id);
	expect(auth.ready).toBe(true);
});
it('tracks cross-tab sign-out and owner changes without importing the SDK offline', async () => {
	const surface = new EventTarget();
	vi.stubGlobal('window', surface);
	vi.stubGlobal('navigator', { onLine: false });
	const { GuideAuth } = await import('./auth.svelte.ts');
	const auth = new GuideAuth();
	await auth.init();
	const generation = auth.generation;
	fake.cachedUser = { id: '22222222-2222-4222-8222-222222222222' };
	surface.dispatchEvent(Object.assign(new Event('storage'), { key: 'guardioes-auth' }));
	expect(auth.user?.id).toBe(fake.cachedUser.id);
	expect(auth.generation).toBeGreaterThan(generation);
	fake.cachedUser = null;
	surface.dispatchEvent(Object.assign(new Event('storage'), { key: 'guardioes-auth' }));
	expect(auth.user).toBeNull();
	expect(fake.load).not.toHaveBeenCalled();
});
