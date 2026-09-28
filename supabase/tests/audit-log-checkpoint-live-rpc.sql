-- Exercises verify_audit_log_chain's checkpoint against a real database: each
-- check starts from the entry the last one vouched for, a history rewritten
-- behind that entry is caught even when every hash in it is consistent, an
-- old entry changed in place waits for the daily full pass, and a failed
-- check never moves the checkpoint. Tampering has to lift the immutability
-- trigger, as only someone able to bypass it could. Creates isolated
-- synthetic rows inside one statement and removes them before returning; any
-- failed check rolls everything back.
do $$
<<checkpoint_test>>
declare
  owner_id uuid := gen_random_uuid();
  organization_id uuid := gen_random_uuid();
  empty_organization_id uuid := gen_random_uuid();
  base bigint;
  verdict record;
  checkpoint record;
  entry record;
  previous_hash text;
begin
  insert into auth.users (id, email, created_at, updated_at)
  values (owner_id, 'rpc-' || replace(owner_id::text, '-', '') || '@example.invalid', now(), now());

  insert into public.profiles (id, email, full_name)
  values (owner_id, 'rpc-' || replace(owner_id::text, '-', '') || '@example.invalid', 'Audit checkpoint verification');

  insert into public.organizations (id, name, slug, created_by)
  values
    (organization_id, 'Audit checkpoint verification', 'audit-rpc-' || replace(organization_id::text, '-', ''), owner_id),
    (empty_organization_id, 'Audit checkpoint, no entries', 'audit-rpc-' || replace(empty_organization_id::text, '-', ''), owner_id);

  -- Whatever creating an organization recorded, then three entries of our own.
  delete from public.audit_logs where org_id = empty_organization_id;
  select coalesce(max(seq), 0) into base from public.audit_logs where org_id = organization_id;

  insert into public.audit_logs (org_id, action, target_type, metadata)
  select organization_id, 'test.recorded', 'test', jsonb_build_object('n', n)
  from generate_series(1, 3) as n;

  select * into verdict from public.verify_audit_log_chain(organization_id);
  if not verdict.valid or verdict.checked_count <> base + 3 then
    raise exception 'An intact chain did not verify: %', verdict;
  end if;

  -- History behind the checkpoint rewritten with every hash recomputed: a
  -- pass from the first entry finds nothing wrong, the checkpoint does.
  alter table public.audit_logs disable trigger audit_logs_enforce_immutability;

  update public.audit_logs set metadata = '{"n": "forged"}'
  where org_id = organization_id and seq = base + 2;

  select entry_hash into previous_hash from public.audit_logs where org_id = organization_id and seq = base + 1;
  for entry in
    select * from public.audit_logs where org_id = organization_id and seq >= base + 2 order by seq
  loop
    previous_hash := public.audit_log_entry_digest(
      previous_hash, entry.seq, entry.id, entry.org_id, entry.action,
      entry.target_type, entry.target_id, entry.metadata, entry.created_at
    );
    update public.audit_logs
    set prev_hash = (select entry_hash from public.audit_logs where org_id = organization_id and seq = entry.seq - 1),
        entry_hash = previous_hash
    where id = entry.id;
  end loop;

  alter table public.audit_logs enable trigger audit_logs_enforce_immutability;

  select * into verdict from public.verify_audit_log_chain(organization_id);
  if verdict.valid
    or verdict.first_invalid_seq <> base + 3
    or verdict.failure_reason <> 'checkpoint_mismatch'
    or verdict.checked_count <> base + 2
  then
    raise exception 'A rewritten history passed the check: %', verdict;
  end if;

  -- Starting over from a fresh checkpoint, new entries are verified from it.
  delete from public.audit_log_checkpoints where org_id = organization_id;

  select * into verdict from public.verify_audit_log_chain(organization_id);
  if not verdict.valid or verdict.checked_count <> base + 3 then
    raise exception 'A consistent chain did not verify from the start: %', verdict;
  end if;

  insert into public.audit_logs (org_id, action, target_type, metadata)
  select organization_id, 'test.recorded', 'test', jsonb_build_object('n', n)
  from generate_series(4, 5) as n;

  select * into verdict from public.verify_audit_log_chain(organization_id);
  select * into checkpoint from public.audit_log_checkpoints where org_id = organization_id;
  if not verdict.valid
    or verdict.checked_count <> base + 5
    or checkpoint.seq <> base + 5
    or checkpoint.entry_hash <> (select entry_hash from public.audit_logs where org_id = organization_id and seq = base + 5)
  then
    raise exception 'New entries did not move the checkpoint: % %', verdict, checkpoint;
  end if;

  -- An old entry changed in place is not re-hashed until the daily full pass.
  alter table public.audit_logs disable trigger audit_logs_enforce_immutability;
  update public.audit_logs set metadata = '{"n": "edited"}'
  where org_id = organization_id and seq = base + 2;
  alter table public.audit_logs enable trigger audit_logs_enforce_immutability;

  select * into verdict from public.verify_audit_log_chain(organization_id);
  if not verdict.valid or verdict.checked_count <> base + 5 then
    raise exception 'A check within the day re-hashed old entries: %', verdict;
  end if;

  update public.audit_log_checkpoints
  set full_check_at = now() - interval '2 days'
  where org_id = organization_id;

  select * into verdict from public.verify_audit_log_chain(organization_id);
  if verdict.valid
    or verdict.first_invalid_seq <> base + 2
    or verdict.failure_reason <> 'entry_hash_mismatch'
    or verdict.checked_count <> base + 1
  then
    raise exception 'The daily full pass missed an edited entry: %', verdict;
  end if;

  select * into checkpoint from public.audit_log_checkpoints where org_id = organization_id;
  if checkpoint.seq <> base + 5 or checkpoint.full_check_at > now() - interval '1 day' then
    raise exception 'A failed check moved the checkpoint: %', checkpoint;
  end if;

  -- A chain with no entries verifies, and leaves nothing to vouch for.
  select * into verdict from public.verify_audit_log_chain(empty_organization_id);
  if not verdict.valid or verdict.checked_count <> 0
    or exists (select 1 from public.audit_log_checkpoints where org_id = empty_organization_id)
  then
    raise exception 'An empty chain did not verify cleanly: %', verdict;
  end if;

  delete from public.organizations
  where id in (organization_id, empty_organization_id);

  delete from auth.users
  where id = owner_id;
end;
$$;
