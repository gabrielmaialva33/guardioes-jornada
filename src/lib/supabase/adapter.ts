import * as v from 'valibot';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Session } from '#lib/session.ts';
import { standings } from '#lib/session.ts';
import type { RemoteSession } from '#lib/state/sessions.svelte.ts';
import type { Database, Json, JourneyMutationReply } from './database.types.ts';

export interface PushReply extends Omit<JourneyMutationReply, 'server_doc'> {
	server_doc: RemoteSession | null;
}
export interface CloudAdapter {
	push(session: Session, baseRev: number, mutationId: string, signal: AbortSignal): Promise<PushReply>;
	delete(id: string, baseRev: number, mutationId: string, signal: AbortSignal): Promise<PushReply>;
	pull(ownerId: string, signal: AbortSignal): Promise<RemoteSession[]>;
}
const rev = v.pipe(v.number(), v.safeInteger(), v.minValue(0));
const remoteSchema = v.object({
	id: v.pipe(v.string(), v.uuid()),
	owner_id: v.pipe(v.string(), v.uuid()),
	rev,
	doc: v.unknown(),
	deleted_at: v.nullable(v.string()),
	last_mutation_id: v.optional(v.nullable(v.string()))
});
const replySchema = v.object({
	status: v.picklist(['ok', 'conflict']),
	rev,
	server_doc: v.nullable(remoteSchema),
	reason: v.optional(v.string())
});

export function createCloudAdapter(client: SupabaseClient<Database>): CloudAdapter {
	return {
		async push(session, baseRev, mutationId, signal) {
			const row = {
				id: session.id,
				owner_id: session.ownerId,
				journey_id: session.journeyId,
				school: session.school,
				class_name: session.className,
				visit_date: session.date,
				certificate_code: session.certificateCode,
				standings: standings(session).map(({ group, score }) => ({
					name: group.name,
					color: group.color,
					score
				})),
				finished_at: session.oathAt ? new Date(session.oathAt).toISOString() : null,
				doc: session as unknown as Json,
				client_updated_at: new Date(session.updatedAt).toISOString()
			};
			const { data, error } = await client
				.rpc('push_journey_session', { p_row: row, p_base_rev: baseRev, p_mutation_id: mutationId })
				.abortSignal(signal);
			if (error) throw error;
			return v.parse(replySchema, data);
		},
		async delete(id, baseRev, mutationId, signal) {
			const { data, error } = await client
				.rpc('delete_journey_session', { p_id: id, p_base_rev: baseRev, p_mutation_id: mutationId })
				.abortSignal(signal);
			if (error) throw error;
			return v.parse(replySchema, data);
		},
		async pull(ownerId, signal) {
			const { data, error } = await client
				.from('journey_sessions')
				.select('id, owner_id, rev, doc, deleted_at, last_mutation_id')
				.eq('owner_id', ownerId)
				.abortSignal(signal);
			if (error) throw error;
			return v.parse(v.array(remoteSchema), data);
		}
	};
}
