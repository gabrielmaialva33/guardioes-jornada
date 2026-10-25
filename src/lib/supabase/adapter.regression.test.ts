import type { SupabaseClient } from '@supabase/supabase-js';
import { expect, it } from 'vitest';
import { normalizeSession } from '#lib/session.ts';
import { createCloudAdapter } from './adapter.ts';
import type { Database } from './database.types.ts';

it.each(['certificate_code_taken', 'future_reason', undefined])(
	'preserves the optional RPC reason %s while validating a conflict',
	async (reason) => {
		const reply = {
			status: 'conflict',
			rev: 0,
			server_doc: null,
			...(reason === undefined ? {} : { reason })
		};
		const client = {
			rpc: () => ({ abortSignal: async () => ({ data: reply, error: null }) })
		} as unknown as SupabaseClient<Database>;
		const session = normalizeSession({
			id: crypto.randomUUID(),
			ownerId: '11111111-1111-4111-8111-111111111111'
		});
		const result = await createCloudAdapter(client).push(
			session,
			0,
			crypto.randomUUID(),
			new AbortController().signal
		);
		expect(result.status).toBe('conflict');
		expect(result.server_doc).toBeNull();
		expect(result.reason).toBe(reason);
	}
);
it('sends participant details only inside doc and leaves optional public school columns empty', async () => {
	let sent: Record<string, unknown> | undefined;
	const client = {
		rpc: (_name: string, { p_row }: { p_row: unknown }) => {
			sent = p_row as Record<string, unknown>;
			return {
				abortSignal: async () => ({ data: { status: 'conflict', rev: 0, server_doc: null }, error: null })
			};
		}
	} as unknown as SupabaseClient<Database>;
	const session = normalizeSession({
		id: crypto.randomUUID(),
		ownerId: '11111111-1111-4111-8111-111111111111',
		participant: 'Ana',
		myGroupId: 'canela',
		groups: [{ id: 'canela', name: 'Canela', color: '#123456' }]
	});
	await createCloudAdapter(client).push(session, 0, crypto.randomUUID(), new AbortController().signal);
	expect(sent).not.toHaveProperty('participant');
	expect(sent).not.toHaveProperty('myGroupId');
	expect(sent?.doc).toMatchObject({ participant: 'Ana', myGroupId: 'canela' });
	expect(sent?.school).toBe('');
	expect(sent?.class_name).toBe('');
});
