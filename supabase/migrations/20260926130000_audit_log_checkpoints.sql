-- The audit-log page re-hashed an organization's whole chain on every view:
-- instant at a few hundred entries, seconds at ten thousand. Each check now
-- starts from the entry the last one vouched for, so a view hashes only what
-- was recorded since. Once a day the check starts from the first entry again,
-- since only a full pass notices an old entry changed in place by someone able
-- to lift the immutability trigger. Every check also confirms the vouched-for
-- entry still carries its hash, which catches what no pass from the first
-- entry can: a history rewritten with every hash recomputed.
create table public.audit_log_checkpoints (
  org_id uuid primary key references public.organizations (id) on delete cascade,
  seq bigint not null check (seq >= 1),
  entry_hash text not null check (entry_hash ~ '^[0-9a-f]{64}$'),
  full_check_at timestamptz not null
);

alter table public.audit_log_checkpoints enable row level security;
alter table public.audit_log_checkpoints force row level security;

revoke all privileges on table public.audit_log_checkpoints from anon, authenticated;
grant select, insert, update, delete on table public.audit_log_checkpoints to service_role;

-- Volatile now: a passing check records how far it reached.
create or replace function public.verify_audit_log_chain(target_org_id uuid)
returns table (
  valid boolean,
  checked_count bigint,
  first_invalid_seq bigint,
  failure_reason text
)
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  audit_row record;
  checkpoint public.audit_log_checkpoints%rowtype;
  full_check boolean;
  expected_seq bigint := 1;
  previous_hash text := null;
begin
  if target_org_id is null then
    raise exception 'target_org_id is required.'
      using errcode = '22023';
  end if;

  select * into checkpoint
  from public.audit_log_checkpoints
  where org_id = target_org_id;

  if found then
    if not exists (
      select 1
      from public.audit_logs audit_log
      where audit_log.org_id = target_org_id
        and audit_log.seq = checkpoint.seq
        and audit_log.entry_hash = checkpoint.entry_hash
    ) then
      return query
        select false, checkpoint.seq - 1, checkpoint.seq, 'checkpoint_mismatch'::text;
      return;
    end if;

    full_check := checkpoint.full_check_at < now() - interval '1 day';

    if not full_check then
      expected_seq := checkpoint.seq + 1;
      previous_hash := checkpoint.entry_hash;
    end if;
  else
    full_check := true;
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
      and audit_log.seq >= expected_seq
    order by audit_log.seq
  loop
    if audit_row.seq is distinct from expected_seq then
      return query select false, expected_seq - 1, audit_row.seq, 'sequence_gap'::text;
      return;
    end if;

    if audit_row.prev_hash is distinct from previous_hash then
      return query
        select false, expected_seq - 1, audit_row.seq, 'previous_hash_mismatch'::text;
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
        select false, expected_seq - 1, audit_row.seq, 'entry_hash_mismatch'::text;
      return;
    end if;

    previous_hash := audit_row.entry_hash;
    expected_seq := expected_seq + 1;
  end loop;

  -- An empty chain has nothing to vouch for, and a view with nothing new
  -- writes nothing. A concurrent check that reached further is never moved
  -- back.
  if previous_hash is not null and (full_check or expected_seq - 1 > checkpoint.seq) then
    insert into public.audit_log_checkpoints as saved (org_id, seq, entry_hash, full_check_at)
    values (
      target_org_id,
      expected_seq - 1,
      previous_hash,
      case when full_check then now() else checkpoint.full_check_at end
    )
    on conflict (org_id) do update
      set seq = excluded.seq,
          entry_hash = excluded.entry_hash,
          full_check_at = greatest(saved.full_check_at, excluded.full_check_at)
      where excluded.seq >= saved.seq;
  end if;

  return query select true, expected_seq - 1, null::bigint, null::text;
end;
$$;

revoke all on function public.verify_audit_log_chain(uuid)
  from public, anon, authenticated;

grant execute on function public.verify_audit_log_chain(uuid) to service_role;

notify pgrst, 'reload schema';
