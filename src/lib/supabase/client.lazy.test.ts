import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const sdk = vi.hoisted(() => ({ imports: 0, create: vi.fn(() => ({ synthetic: true })) }));
vi.mock('$app/env/public', () => ({ PUBLIC_SUPABASE_URL: 'https://synthetic.supabase.co', PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_synthetic' }));
vi.mock('@supabase/supabase-js', () => { sdk.imports++; return { createClient: sdk.create }; });
beforeEach(() => { vi.resetModules(); sdk.imports = 0; sdk.create.mockClear(); vi.stubGlobal('window', { localStorage: { getItem: () => null } }); });
afterEach(() => vi.unstubAllGlobals());
it('does not load the SDK until requested and shares concurrent client creation', async () => {
	const cloud = await import('./client.ts'); expect(cloud.cloudAvailable).toBe(true); expect(sdk.imports).toBe(0); expect(sdk.create).not.toHaveBeenCalled();
	const [a, b] = await Promise.all([cloud.getSupabase(), cloud.getSupabase()]); expect(a).toBe(b); expect(sdk.create).toHaveBeenCalledOnce();
});
it('can restore the local identity without loading the SDK or exposing tokens', async () => {
	const cloud = await import('./client.ts');
	vi.stubGlobal('window', { localStorage: { getItem: () => JSON.stringify({ access_token: 'synthetic', refresh_token: 'synthetic', user: { id: '11111111-1111-4111-8111-111111111111', email: 'synthetic@example.test' } }) } });
	expect(cloud.readStoredUser()?.id).toBe('11111111-1111-4111-8111-111111111111'); expect(cloud.readStoredUser()).not.toHaveProperty('access_token'); expect(sdk.create).not.toHaveBeenCalled();
});
it('treats unavailable/corrupt local credentials as signed out', async () => {
	const cloud = await import('./client.ts'); vi.stubGlobal('window', { localStorage: { getItem: () => '{bad' } }); expect(cloud.readStoredUser()).toBeNull();
	vi.stubGlobal('window', { get localStorage() { throw new Error('Unavailable'); } }); expect(cloud.readStoredUser()).toBeNull();
});
it('allows a failed lazy initialization to be retried', async () => {
	const cloud = await import('./client.ts'); sdk.create.mockImplementationOnce(() => { throw new Error('Transient module initialization'); });
	await expect(cloud.getSupabase()).rejects.toThrow(); await expect(cloud.getSupabase()).resolves.toBeTruthy();
});
