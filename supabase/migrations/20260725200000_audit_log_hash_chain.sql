-- Hash-chains public.audit_logs for tamper evidence.
--
-- Every row gains a per-organization sequence and a SHA-256 hash linking it
-- to the previous row. A BEFORE INSERT trigger computes the chain for BOTH
-- write paths (the six in-transaction plpgsql RPCs and out-of-band PostgREST
-- inserts) without editing any function body, and unconditionally overwrites
-- client-supplied chain columns.
--
-- Trust anchor: hashes backfilled below prove nothing about rows written
-- before this migration ran; tamper evidence holds from this point forward.
--
-- Lock ordering contract: the chain trigger takes a per-organization
-- advisory lock. It must remain the LAST lock any transaction acquires, so
-- future RPCs must keep their audit_logs insert as the final write.

-- pgcrypto provides digest(); hosted Supabase preinstalls it in the
-- extensions schema. Relocate or install it there when a local database
-- differs, so extensions.digest() resolves everywhere.
create schema if not exists extensions;

do $$
declare
  pgcrypto_schema text;
begin
  select ns.nspname
    into pgcrypto_schema
  from pg_extension ext
  join pg_namespace ns on ns.oid = ext.extnamespace
  where ext.extname = 'pgcrypto';

  if pgcrypto_schema is null then
    execute 'create extension pgcrypto with schema extensions';
  elsif pgcrypto_schema <> 'extensions' then
    execute 'alter extension pgcrypto set schema extensions';
  end if;
end $$;

-- Canonical digest shared by the trigger, the backfill, and verification.
-- The input is a jsonb array rendered to text: Postgres canonicalizes jsonb
-- (duplicate keys deduped, keys sorted) and array rendering removes any
-- field-boundary ambiguity. created_at uses a fixed UTC format, never
-- GUC-dependent ::text. actor_user_id is EXCLUDED: its foreign key is
-- ON DELETE SET NULL, so profile deletion may redact the actor without
-- invalidating the chain (the immutability trigger permits exactly that
-- transition and nothing else).
create or replace function public.audit_log_entry_digest(
  chain_prev_hash text,
  entry_seq bigint,
  entry_id uuid,
  entry_org_id uuid,
  entry_action text,
  entry_target_type text,
  entry_target_id uuid,
  entry_metadata jsonb,
  entry_created_at timestamptz
)
returns text
language sql
stable
security invoker
set search_path = ''
as $$
  select encode(
    extensions.digest(
      convert_to(
        (
          jsonb_build_array(
            coalesce(chain_prev_hash, ''),
            entry_seq,
            entry_id,
            entry_org_id,
            entry_action,
            entry_target_type,
            entry_target_id,
            entry_metadata,
            to_char(
              entry_created_at at time zone 'utc',
              'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
            )
          )
        )::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  )
$$;

revoke all on function public.audit_log_entry_digest(
  text, bigint, uuid, uuid, text, text, uuid, jsonb, timestamptz
) from public, anon, authenticated;

grant execute on function public.audit_log_entry_digest(
  text, bigint, uuid, uuid, text, text, uuid, jsonb, timestamptz
) to service_role;

-- Chain columns, nullable until the backfill completes. The leading ALTER
-- takes ACCESS EXCLUSIVE for the whole transaction, making the backfill
-- race-free by construction.
alter table public.audit_logs
  add column seq bigint,
  add column prev_hash text,
  add column entry_hash text;

-- Deterministic pre-chain ordering: created_at ties are real (every RPC
-- writes rows at identical transaction-start timestamps), so id breaks them.
with ordered as (
  select
    id,
    row_number() over (
      partition by org_id
      order by created_at, id
    ) as position
  from public.audit_logs
)
update public.audit_logs audit_log
set seq = ordered.position
from ordered
where ordered.id = audit_log.id;

do $$
declare
  audit_row record;
  previous_org uuid;
  previous_hash text;
  current_hash text;
begin
  for audit_row in
    select id, seq, org_id, action, target_type, target_id, metadata, created_at
    from public.audit_logs
    order by org_id, seq
  loop
    if previous_org is distinct from audit_row.org_id then
      previous_hash := null;
      previous_org := audit_row.org_id;
    end if;

    current_hash := public.audit_log_entry_digest(
      previous_hash,
      audit_row.seq,
      audit_row.id,
      audit_row.org_id,
      audit_row.action,
      audit_row.target_type,
      audit_row.target_id,
      audit_row.metadata,
      audit_row.created_at
    );

    update public.audit_logs
    set prev_hash = previous_hash,
        entry_hash = current_hash
    where id = audit_row.id;

    previous_hash := current_hash;
  end loop;
end $$;

alter table public.audit_logs
  alter column seq set not null,
  alter column entry_hash set not null,
  add constraint audit_logs_seq_positive check (seq >= 1),
  add constraint audit_logs_genesis_prev_hash check ((seq = 1) = (prev_hash is null)),
  add constraint audit_logs_prev_hash_format
    check (prev_hash is null or prev_hash ~ '^[0-9a-f]{64}$'),
  add constraint audit_logs_entry_hash_format
    check (entry_hash ~ '^[0-9a-f]{64}$');

-- Integrity backstop and the prev-row lookup index.
create unique index audit_logs_org_seq_idx on public.audit_logs (org_id, seq);

-- Assigns seq/prev_hash/entry_hash on every insert. The advisory lock
-- serializes per organization and BLOCKS rather than erroring, so chain
-- contention adds latency but never a new failure class. Verified lock
-- ordering: every existing RPC writes audit_logs as its final statement,
-- so row locks always precede this advisory lock and nothing follows it.
create or replace function public.audit_logs_chain_link()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  previous_seq bigint;
  previous_hash text;
begin
  perform pg_advisory_xact_lock(
    pg_catalog.hashtextextended('audit_logs:' || new.org_id::text, 0)
  );

  select audit_log.seq, audit_log.entry_hash
    into previous_seq, previous_hash
  from public.audit_logs audit_log
  where audit_log.org_id = new.org_id
  order by audit_log.seq desc
  limit 1;

  new.seq := coalesce(previous_seq, 0) + 1;
  new.prev_hash := previous_hash;
  new.entry_hash := public.audit_log_entry_digest(
    previous_hash,
    new.seq,
    new.id,
    new.org_id,
    new.action,
    new.target_type,
    new.target_id,
    new.metadata,
    new.created_at
  );

  return new;
end;
$$;

revoke all on function public.audit_logs_chain_link()
  from public, anon, authenticated, service_role;

create trigger audit_logs_chain_link
  before insert on public.audit_logs
  for each row execute function public.audit_logs_chain_link();

-- Append-only was previously enforced by grants alone; tamper evidence
-- needs an explicit block with two deliberate carve-outs.
create or replace function public.enforce_audit_log_immutability()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    -- Carve-out 1: organization cascade. When the owning organizations row
    -- is already gone (audit_logs.org_id is ON DELETE CASCADE), the whole
    -- tenant chain is being destroyed; the rollback path in
    -- deleteOrganizationRecord depends on this.
    if not exists (
      select 1
      from public.organizations organization
      where organization.id = old.org_id
    ) then
      return old;
    end if;

    raise exception 'Audit log entries cannot be deleted.'
      using errcode = '23514';
  end if;

  -- Carve-out 2: profile deletion may redact the actor to null and change
  -- nothing else (actor_user_id is excluded from the digest).
  if old.actor_user_id is not null
    and new.actor_user_id is null
    and row(
      new.id, new.org_id, new.action, new.target_type, new.target_id,
      new.metadata, new.created_at, new.seq, new.prev_hash, new.entry_hash
    ) is not distinct from row(
      old.id, old.org_id, old.action, old.target_type, old.target_id,
      old.metadata, old.created_at, old.seq, old.prev_hash, old.entry_hash
    )
  then
    return new;
  end if;

  raise exception 'Audit log entries are immutable.'
    using errcode = '23514';
end;
$$;

revoke all on function public.enforce_audit_log_immutability()
  from public, anon, authenticated, service_role;

create trigger audit_logs_enforce_immutability
  before update or delete on public.audit_logs
  for each row execute function public.enforce_audit_log_immutability();

-- Server-side chain verification: recomputing in SQL sidesteps every
-- cross-language jsonb canonicalization question.
create or replace function public.verify_audit_log_chain(target_org_id uuid)
returns table (
  valid boolean,
  checked_count bigint,
  first_invalid_seq bigint,
  failure_reason text
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  audit_row record;
  expected_seq bigint := 1;
  previous_hash text := null;
  checked bigint := 0;
begin
  if target_org_id is null then
    raise exception 'target_org_id is required.'
      using errcode = '22023';
  end if;

  for audit_row in
    select
      audit_log.id,
      audit_log.seq,
      audit_log.org_id,
      audit_log.action,
      audit_log.target_type,
      audit_log.target_id,
      audit_log.metadata,
      audit_log.created_at,
      audit_log.prev_hash,
      audit_log.entry_hash
    from public.audit_logs audit_log
    where audit_log.org_id = target_org_id
    order by audit_log.seq
  loop
    if audit_row.seq is distinct from expected_seq then
      return query select false, checked, audit_row.seq, 'sequence_gap'::text;
      return;
    end if;

    if audit_row.prev_hash is distinct from previous_hash then
      return query
        select false, checked, audit_row.seq, 'previous_hash_mismatch'::text;
      return;
    end if;

    if audit_row.entry_hash is distinct from public.audit_log_entry_digest(
      previous_hash,
      audit_row.seq,
      audit_row.id,
      audit_row.org_id,
      audit_row.action,
      audit_row.target_type,
      audit_row.target_id,
      audit_row.metadata,
      audit_row.created_at
    ) then
      return query
        select false, checked, audit_row.seq, 'entry_hash_mismatch'::text;
      return;
    end if;

    previous_hash := audit_row.entry_hash;
    expected_seq := expected_seq + 1;
    checked := checked + 1;
  end loop;

  return query select true, checked, null::bigint, null::text;
end;
$$;

revoke all on function public.verify_audit_log_chain(uuid)
  from public, anon, authenticated;

grant execute on function public.verify_audit_log_chain(uuid) to service_role;

notify pgrst, 'reload schema';
