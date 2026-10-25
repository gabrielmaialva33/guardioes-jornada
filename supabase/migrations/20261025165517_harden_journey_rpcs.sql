-- Harden journey session CAS RPCs and lock down public helper execution.
--
-- 1. Default omitted/null school, class_name, and non-array standings in push_journey_session.
-- 2. Validate non-null session UUID before acquiring the transaction advisory lock.
-- 3. Key the advisory lock on the session UUID alone so concurrent first pushes serialize across callers.
-- 4. Catch certificate_code unique_violation on first insert and return reason = 'certificate_code_taken'.
-- 5. Revoke execute on public.rls_auto_enable() from public, anon, and authenticated if present.

create or replace function public.push_journey_session(p_row jsonb, p_base_rev integer, p_mutation_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
	current_row public.journey_sessions%rowtype;
	session_id uuid := (p_row->>'id')::uuid;
	caller uuid := auth.uid();
	v_school text := coalesce(p_row->>'school', '');
	v_class_name text := coalesce(p_row->>'class_name', '');
	v_standings jsonb := case
		when jsonb_typeof(p_row->'standings') = 'array' then p_row->'standings'
		else '[]'::jsonb
	end;
begin
	if caller is null or p_row->>'owner_id' is distinct from caller::text then
		raise exception 'Owner mismatch' using errcode = '42501';
	end if;
	if session_id is null
		or p_base_rev is null
		or p_base_rev < 0
		or p_mutation_id is null
		or jsonb_typeof(p_row->'doc') is distinct from 'object'
	then
		raise exception 'Invalid session' using errcode = '22023';
	end if;

	-- Serialize concurrent writes for this session UUID (including the absent-row case).
	perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(session_id::text, 0));

	select * into current_row from public.journey_sessions where id = session_id for update;
	if not found then
		if p_base_rev <> 0 then
			return jsonb_build_object('status', 'conflict', 'rev', 0, 'server_doc', null);
		end if;
		begin
			insert into public.journey_sessions (
				id, owner_id, journey_id, school, class_name, visit_date,
				certificate_code, standings, finished_at, doc, client_updated_at, last_mutation_id
			)
			values (
				session_id,
				caller,
				p_row->>'journey_id',
				v_school,
				v_class_name,
				(p_row->>'visit_date')::date,
				p_row->>'certificate_code',
				v_standings,
				(p_row->>'finished_at')::timestamptz,
				(p_row->'doc') || jsonb_build_object('id', session_id, 'ownerId', caller),
				(p_row->>'client_updated_at')::timestamptz,
				p_mutation_id
			)
			on conflict (id) do nothing returning * into current_row;
		exception
			when unique_violation then
				return jsonb_build_object(
					'status', 'conflict',
					'rev', 0,
					'server_doc', null,
					'reason', 'certificate_code_taken'
				);
		end;
		if not found then
			return jsonb_build_object('status', 'conflict', 'rev', 0, 'server_doc', null);
		end if;
	else
		if current_row.last_mutation_id = p_mutation_id then
			return jsonb_build_object('status', 'ok', 'rev', current_row.rev, 'server_doc', to_jsonb(current_row));
		end if;
		if current_row.rev <> p_base_rev or current_row.deleted_at is not null then
			return jsonb_build_object('status', 'conflict', 'rev', current_row.rev, 'server_doc', to_jsonb(current_row));
		end if;
		update public.journey_sessions set
			journey_id = p_row->>'journey_id',
			school = v_school,
			class_name = v_class_name,
			visit_date = (p_row->>'visit_date')::date,
			standings = v_standings,
			finished_at = (p_row->>'finished_at')::timestamptz,
			doc = (p_row->'doc') || jsonb_build_object('id', session_id, 'ownerId', caller),
			client_updated_at = (p_row->>'client_updated_at')::timestamptz,
			rev = current_row.rev + 1,
			last_mutation_id = p_mutation_id
		where id = session_id returning * into current_row;
	end if;
	return jsonb_build_object('status', 'ok', 'rev', current_row.rev, 'server_doc', to_jsonb(current_row));
end;
$$;

create or replace function public.delete_journey_session(p_id uuid, p_base_rev integer, p_mutation_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
	current_row public.journey_sessions%rowtype;
	caller uuid := auth.uid();
begin
	if caller is null then
		raise exception 'Sign in required' using errcode = '42501';
	end if;
	if p_id is null or p_base_rev is null or p_base_rev < 0 or p_mutation_id is null then
		raise exception 'Invalid revision' using errcode = '22023';
	end if;

	perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_id::text, 0));

	select * into current_row from public.journey_sessions where id = p_id for update;
	if not found then
		return jsonb_build_object('status', 'ok', 'rev', 0, 'server_doc', null);
	end if;
	if current_row.last_mutation_id = p_mutation_id or current_row.deleted_at is not null then
		return jsonb_build_object('status', 'ok', 'rev', current_row.rev, 'server_doc', to_jsonb(current_row));
	end if;
	if current_row.rev <> p_base_rev then
		return jsonb_build_object('status', 'conflict', 'rev', current_row.rev, 'server_doc', to_jsonb(current_row));
	end if;
	update public.journey_sessions
	set deleted_at = now(), rev = current_row.rev + 1, last_mutation_id = p_mutation_id
	where id = p_id returning * into current_row;
	return jsonb_build_object('status', 'ok', 'rev', current_row.rev, 'server_doc', to_jsonb(current_row));
end;
$$;

revoke all on function public.push_journey_session(jsonb, integer, uuid) from public, anon, authenticated;
revoke all on function public.delete_journey_session(uuid, integer, uuid) from public, anon, authenticated;
grant execute on function public.push_journey_session(jsonb, integer, uuid) to authenticated;
grant execute on function public.delete_journey_session(uuid, integer, uuid) to authenticated;

do $$
begin
	if pg_catalog.to_regprocedure('public.rls_auto_enable()') is not null then
		revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
	end if;
end;
$$;
