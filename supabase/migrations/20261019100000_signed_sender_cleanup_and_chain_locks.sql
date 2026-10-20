-- Two fixes to the release's own migrations, before any of them reaches production.
--
-- 1. prevent_retention_evidence_mutation (latest: 20261014221631_cancel_signing)
--    also lets a signed row lose its sender once that sender's profile is gone.
--    20261016150000_signing_consent_and_decline added `sent_by ... on delete set
--    null`, which the trigger refused, so deleting a sender rolled back.
-- 2. refuse_org_unit_cycle and refuse_manager_cycle
--    (20261017140000_org_hierarchy) take a per-workspace lock before walking
--    the tree, so two changes made at once cannot each pass against the other's
--    old value and together close a loop. Each check runs after the lock, under
--    read committed, so it sees what the other committed.
--
-- `create or replace` keeps each function's grants and triggers.

create or replace function private.prevent_retention_evidence_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  old_retention_state text;
  new_retention_state text;
  signed_user_cleanup boolean := false;
  signed_sender_cleanup boolean := false;
begin
  if new.org_id is distinct from old.org_id
      or new.document_id is distinct from old.document_id then
    raise exception 'Document retention evidence identity is immutable.'
      using errcode = '23514';
  end if;

  old_retention_state := case tg_table_name
    when 'document_answers' then to_jsonb(old) ->> 'workflow_status'
    else to_jsonb(old) ->> 'status'
  end;
  new_retention_state := case tg_table_name
    when 'document_answers' then to_jsonb(new) ->> 'workflow_status'
    else to_jsonb(new) ->> 'status'
  end;

  if tg_table_name = 'document_signing_recipients'
      and old_retention_state = 'signed' then
    signed_user_cleanup :=
      old.user_id is not null
      and new.user_id is null
      and not exists (
        select 1
        from public.profiles old_profile
        where old_profile.id = old.user_id
      );
    signed_sender_cleanup :=
      old.sent_by is not null
      and new.sent_by is null
      and not exists (
        select 1
        from public.profiles old_profile
        where old_profile.id = old.sent_by
      );

    -- Revoking a signer, once, is the only other change: their signature
    -- stays as evidence of what they signed before the sender cancelled.
    if (
      to_jsonb(new) - 'user_id' - 'revoked_at' - 'sent_by'
    ) is distinct from (
      to_jsonb(old) - 'user_id' - 'revoked_at' - 'sent_by'
    ) or (
      new.revoked_at is distinct from old.revoked_at
      and (old.revoked_at is not null or new.revoked_at is null)
    ) or (
      new.user_id is distinct from old.user_id
      and not signed_user_cleanup
    ) or (
      new.sent_by is distinct from old.sent_by
      and not signed_sender_cleanup
    ) then
      raise exception 'Signed recipient evidence is immutable.'
        using errcode = '23514';
    end if;
  elsif old_retention_state in ('completed', 'finalized')
      and new_retention_state is distinct from old_retention_state then
    raise exception 'Completed and finalized evidence state is immutable.'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

create or replace function private.refuse_org_unit_cycle()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.parent_id is null then
    return new;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('org_units:' || new.org_id::text, 0));

  if exists (
    with recursive ancestors as (
      select unit.id, unit.parent_id, 1 as depth
      from public.org_units unit
      where unit.id = new.parent_id and unit.org_id = new.org_id
      union all
      select parent.id, parent.parent_id, ancestors.depth + 1
      from ancestors
      join public.org_units parent on parent.id = ancestors.parent_id and parent.org_id = new.org_id
      where ancestors.depth < 64
    )
    select 1 from ancestors where ancestors.id = new.id
  ) then
    raise exception 'A team cannot sit inside itself.' using errcode = '23514';
  end if;

  return new;
end;
$$;

create or replace function private.refuse_manager_cycle()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.manager_user_id is null then
    return new;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('reporting_lines:' || new.org_id::text, 0));

  if exists (
    with recursive chain as (
      select membership.user_id, membership.manager_user_id, 1 as depth
      from public.organization_memberships membership
      where membership.org_id = new.org_id and membership.user_id = new.manager_user_id
      union all
      select above.user_id, above.manager_user_id, chain.depth + 1
      from chain
      join public.organization_memberships above
        on above.org_id = new.org_id and above.user_id = chain.manager_user_id
      where chain.depth < 64
    )
    select 1 from chain where chain.user_id = new.user_id
  ) then
    raise exception 'Someone cannot report to a person who reports to them.' using errcode = '23514';
  end if;

  return new;
end;
$$;
