-- Journey sessions backed up from the guide's phone.
--
-- The phone (IndexedDB) is the source of truth during the trail; this table is
-- a backup that lets the guide restore sessions on another device and lets
-- anyone verify a printed certificate. Server revisions and compare-and-swap
-- prevent one device from silently replacing another device's changes.
--
-- No student personal data is stored: groups are named after trees.

create table public.journey_sessions (
	id uuid primary key,
	owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
	journey_id text not null,
	school text not null default '',
	class_name text not null default '',
	visit_date date not null,
	certificate_code text not null unique,
	-- Final group scores, kept apart from the document for certificate lookups.
	standings jsonb not null default '[]',
	finished_at timestamptz,
	doc jsonb not null,
	-- Audit timestamp only; CAS uses the server revision, never the phone clock.
	client_updated_at timestamptz not null,
	rev integer not null default 1 check (rev > 0),
	last_mutation_id uuid,
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now(),
	deleted_at timestamptz,

	constraint journey_sessions_doc_is_object check (jsonb_typeof(doc) = 'object'),
	constraint journey_sessions_standings_is_array check (jsonb_typeof(standings) = 'array'),
	constraint journey_sessions_certificate_code_format check (certificate_code ~ '^[0-9A-HJKMNP-TV-Z]{8}$')
);

comment on table public.journey_sessions is
	'One row per class visit, synced from the guide''s phone. doc holds the full app session.';

create index journey_sessions_owner_id_idx on public.journey_sessions (owner_id);

-- RPCs serialize CAS writes; the trigger enforces consecutive server revisions,
-- server timestamps, immutable ownership and irreversible tombstones as well.
create function public.journey_sessions_before_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
	if tg_op = 'INSERT' then
		new.created_at := now();
		new.rev := 1;
	else
		if new.rev <> old.rev + 1 then
			raise exception 'Invalid server revision' using errcode = '40001';
		end if;
		new.owner_id := old.owner_id;
		new.created_at := old.created_at;
		new.certificate_code := old.certificate_code;
		-- Deletion is final: a late upload cannot bring a session back.
		new.deleted_at := coalesce(old.deleted_at, new.deleted_at);
	end if;
	new.updated_at := now();

	-- A deleted session keeps only its id, so the deletion reaches other devices.
	if new.deleted_at is not null then
		new.school := '';
		new.class_name := '';
		new.standings := '[]';
		new.finished_at := null;
		new.doc := '{}';
	end if;

	return new;
end;
$$;

create trigger journey_sessions_before_write
	before insert or update on public.journey_sessions
	for each row
	execute function public.journey_sessions_before_write();

-- Access: signed-in guides see and change only their own rows. Nothing for anon.
-- Invoker RPCs need select + insert + update. Deletions are soft (deleted_at).
alter table public.journey_sessions enable row level security;

revoke all on table public.journey_sessions from anon, authenticated;
grant select, insert, update on table public.journey_sessions to authenticated;

create policy "Guides read their own sessions"
	on public.journey_sessions for select
	to authenticated
	using ((select auth.uid()) = owner_id);

create policy "Guides create their own sessions"
	on public.journey_sessions for insert
	to authenticated
	with check ((select auth.uid()) = owner_id);

create policy "Guides update their own sessions"
	on public.journey_sessions for update
	to authenticated
	using ((select auth.uid()) = owner_id)
	with check ((select auth.uid()) = owner_id);

-- Public certificate check: given the code printed on a certificate, returns
-- only what the certificate already shows. Runs as definer because anon has
-- no access to the table itself.
create function public.verify_certificate(code text)
returns table (
	journey_id text,
	school text,
	class_name text,
	visit_date date,
	finished_at timestamptz,
	standings jsonb
)
language sql
stable
security definer
set search_path = ''
as $$
	select s.journey_id, s.school, s.class_name, s.visit_date, s.finished_at, s.standings
	from public.journey_sessions s
	-- Same normalization as the app: Crockford base32 reads O as 0 and I/L as 1.
	where length(code) <= 64 -- anon can call this; keep the work bounded
		and s.certificate_code = translate(upper(regexp_replace(code, '[\s-]', '', 'g')), 'OIL', '011')
		and s.finished_at is not null
		and s.deleted_at is null
	limit 1;
$$;

revoke all on function public.verify_certificate(text) from public, anon, authenticated;
grant execute on function public.verify_certificate(text) to anon, authenticated;

revoke all on function public.journey_sessions_before_write() from public, anon, authenticated;


-- SECURITY INVOKER: the caller's grants and owner policies apply to every query.
-- The mutation ID makes a retry after a lost response idempotent.
create function public.push_journey_session(p_row jsonb, p_base_rev integer, p_mutation_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
    current_row public.journey_sessions%rowtype;
    session_id uuid := (p_row->>'id')::uuid;
    caller uuid := auth.uid();
begin
    if caller is null or p_row->>'owner_id' is distinct from caller::text then
        raise exception 'Owner mismatch' using errcode = '42501';
    end if;
    if p_base_rev is null or p_base_rev < 0 or p_mutation_id is null or jsonb_typeof(p_row->'doc') is distinct from 'object' then
        raise exception 'Invalid session' using errcode = '22023';
    end if;
    -- Also serialize the absent-row case. A hash collision only serializes extra work.
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(caller::text || ':' || session_id::text, 0));
    select * into current_row from public.journey_sessions where id = session_id for update;
    if not found then
        if p_base_rev <> 0 then
            return jsonb_build_object('status', 'conflict', 'rev', 0, 'server_doc', null);
        end if;
        insert into public.journey_sessions (id, owner_id, journey_id, school, class_name, visit_date, certificate_code, standings, finished_at, doc, client_updated_at, last_mutation_id)
        values (session_id, caller, p_row->>'journey_id', p_row->>'school', p_row->>'class_name', (p_row->>'visit_date')::date,
            p_row->>'certificate_code', p_row->'standings', (p_row->>'finished_at')::timestamptz,
            (p_row->'doc') || jsonb_build_object('id', session_id, 'ownerId', caller),
            (p_row->>'client_updated_at')::timestamptz, p_mutation_id)
        on conflict (id) do nothing returning * into current_row;
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
            journey_id = p_row->>'journey_id', school = p_row->>'school', class_name = p_row->>'class_name',
            visit_date = (p_row->>'visit_date')::date, standings = p_row->'standings',
            finished_at = (p_row->>'finished_at')::timestamptz,
            doc = (p_row->'doc') || jsonb_build_object('id', session_id, 'ownerId', caller),
            client_updated_at = (p_row->>'client_updated_at')::timestamptz,
            rev = current_row.rev + 1, last_mutation_id = p_mutation_id
        where id = session_id returning * into current_row;
    end if;
    return jsonb_build_object('status', 'ok', 'rev', current_row.rev, 'server_doc', to_jsonb(current_row));
end;
$$;

create function public.delete_journey_session(p_id uuid, p_base_rev integer, p_mutation_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
    current_row public.journey_sessions%rowtype;
    caller uuid := auth.uid();
begin
    if caller is null then raise exception 'Sign in required' using errcode = '42501'; end if;
    if p_base_rev is null or p_base_rev < 0 or p_mutation_id is null then raise exception 'Invalid revision' using errcode = '22023'; end if;
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(caller::text || ':' || p_id::text, 0));
    select * into current_row from public.journey_sessions where id = p_id for update;
    if not found then return jsonb_build_object('status', 'ok', 'rev', 0, 'server_doc', null); end if;
    if current_row.last_mutation_id = p_mutation_id or current_row.deleted_at is not null then
        return jsonb_build_object('status', 'ok', 'rev', current_row.rev, 'server_doc', to_jsonb(current_row));
    end if;
    if current_row.rev <> p_base_rev then
        return jsonb_build_object('status', 'conflict', 'rev', current_row.rev, 'server_doc', to_jsonb(current_row));
    end if;
    update public.journey_sessions set deleted_at = now(), rev = current_row.rev + 1, last_mutation_id = p_mutation_id
    where id = p_id returning * into current_row;
    return jsonb_build_object('status', 'ok', 'rev', current_row.rev, 'server_doc', to_jsonb(current_row));
end;
$$;

revoke all on function public.push_journey_session(jsonb, integer, uuid) from public, anon, authenticated;
revoke all on function public.delete_journey_session(uuid, integer, uuid) from public, anon, authenticated;
grant execute on function public.push_journey_session(jsonb, integer, uuid) to authenticated;
grant execute on function public.delete_journey_session(uuid, integer, uuid) to authenticated;
