-- Hardening from the dev-1 release audit: public links, invites, reviewers
-- and owners.

-- 1. Invite links are kept only as their SHA-256, like every other emailed
-- link. The secret is never stored again, so whoever holds a link got it from
-- the invitee's inbox.
alter table public.invites
  add column token_hash text,
  alter column token drop not null;

update public.invites
set token_hash = encode(sha256(convert_to(token, 'UTF8')), 'hex'),
    token = null;

drop index if exists public.invites_pending_token_idx;

alter table public.invites
  alter column token_hash set not null,
  add constraint invites_token_not_kept check (token is null),
  add constraint invites_token_hash_format check (token_hash ~ '^[0-9a-f]{64}$'),
  add constraint invites_token_hash_key unique (token_hash);

-- Accepting looks the invite up by the hash of the token it is given, and
-- never lowers an owner who accepts an invite to their own workspace.
create or replace function public.accept_organization_invite(
  target_invite_id uuid,
  target_token text,
  target_user_id uuid,
  target_user_email text
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  locked_invite_org_id uuid;
  locked_invite_email text;
  locked_invite_role public.organization_role;
  locked_invite_role_definition_id uuid;
  locked_invite_status public.invite_status;
  locked_invite_expires_at timestamptz;
  normalized_user_email text;
  accepted_membership_id uuid;
begin
  normalized_user_email := lower(btrim(target_user_email));

  if normalized_user_email is null
      or char_length(normalized_user_email) < 3
      or char_length(normalized_user_email) > 320
      or position('@' in normalized_user_email) <= 1 then
    raise exception 'Invite email is invalid.'
      using errcode = '22023';
  end if;

  select
    invite.org_id,
    invite.email,
    invite.role,
    invite.role_definition_id,
    invite.status,
    invite.expires_at
  into
    locked_invite_org_id,
    locked_invite_email,
    locked_invite_role,
    locked_invite_role_definition_id,
    locked_invite_status,
    locked_invite_expires_at
  from public.invites invite
  where invite.id = target_invite_id
    and invite.token_hash = encode(sha256(convert_to(coalesce(target_token, ''), 'UTF8')), 'hex')
  for update;

  if not found
      or locked_invite_status <> 'pending'
      or locked_invite_expires_at <= now()
      or locked_invite_email <> normalized_user_email then
    raise exception 'Invite is invalid or expired.'
      using errcode = 'P0002';
  end if;

  insert into public.profiles (id, email)
  values (target_user_id, normalized_user_email)
  on conflict (id)
  do update set email = excluded.email;

  insert into public.organization_memberships (
    org_id,
    user_id,
    role,
    role_definition_id,
    status
  )
  values (
    locked_invite_org_id,
    target_user_id,
    locked_invite_role,
    locked_invite_role_definition_id,
    'active'
  )
  on conflict (org_id, user_id)
  do update
  set role = excluded.role,
      role_definition_id = excluded.role_definition_id,
      status = 'active'
  where organization_memberships.role <> 'owner_admin'
  returning id into accepted_membership_id;

  if accepted_membership_id is null then
    raise exception 'Owner access is permanent.'
      using errcode = '23514';
  end if;

  update public.invites invite
  set status = 'accepted',
      accepted_by = target_user_id,
      accepted_at = now()
  where invite.id = target_invite_id;

  return accepted_membership_id;
end;
$$;

-- 2. Whether a junior may change the reviewers someone more senior chose is
-- decided under the submission's lock, not before it.
CREATE OR REPLACE FUNCTION public.set_submission_reviewers(target_org_id uuid, target_submission_id uuid, target_expected_revision integer, target_reviewer_ids uuid[], target_required_approvals integer, target_actor_user_id uuid)
 RETURNS submissions
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  locked_submission public.submissions%rowtype;
  wanted uuid[];
  added uuid[];
  removed uuid[];
  lead uuid;
  reviewer uuid;
  previous_status text;
  next_status text;
  lead_changes boolean;
  actor_rank integer;
  assigner_rank integer;
begin
  if target_org_id is null
      or target_submission_id is null
      or target_expected_revision is null
      or target_expected_revision < 1
      or target_reviewer_ids is null
      or target_actor_user_id is null then
    raise exception 'Submission reviewers, identifiers, and revision are required.'
      using errcode = '22023';
  end if;

  select coalesce(array_agg(distinct id), '{}') into wanted from unnest(target_reviewer_ids) id;

  if cardinality(wanted) < 1 or cardinality(wanted) > 20 then
    raise exception 'Choose between 1 and 20 reviewers.'
      using errcode = '22023';
  end if;

  if target_required_approvals is not null
      and (target_required_approvals < 1 or target_required_approvals > cardinality(wanted)) then
    raise exception 'The approvals needed must be between 1 and the number of reviewers.'
      using errcode = '22023';
  end if;

  perform public.assert_internal_submission_review_manager(target_org_id, target_actor_user_id);

  if (
    select count(*)
    from public.organization_memberships membership
    where membership.org_id = target_org_id
      and membership.user_id = any(wanted)
      and membership.status = 'active'
      and membership.role in ('owner_admin', 'manager', 'external_reviewer')
  ) <> cardinality(wanted) then
    raise exception 'Reviewers must be active members of this workspace.'
      using errcode = '22023';
  end if;

  select submission.* into locked_submission
  from public.submissions submission
  where submission.id = target_submission_id and submission.org_id = target_org_id
  for update;

  if not found then
    raise exception 'Submission was not found.' using errcode = 'P0002';
  end if;

  -- Reviewers someone more senior chose are for them or an owner to change.
  -- Owners rank highest; whoever assigned them and has since left, lowest.
  select
    coalesce(max(seniority) filter (where membership.user_id = target_actor_user_id), 0),
    coalesce(max(seniority) filter (where membership.user_id = locked_submission.assigned_by), 0)
  into actor_rank, assigner_rank
  from public.organization_memberships membership,
    lateral (select case membership.role
      when 'owner_admin' then 3 when 'manager' then 2 when 'staff' then 1 else 0 end as seniority) ranked
  where membership.org_id = target_org_id
    and membership.status = 'active'
    and membership.user_id in (target_actor_user_id, locked_submission.assigned_by);

  if locked_submission.assigned_by is not null
      and locked_submission.assigned_by <> target_actor_user_id
      and actor_rank < assigner_rank then
    raise exception 'The reviewers were chosen by someone more senior, so only they or an owner can change them.'
      using errcode = '42501';
  end if;

  select coalesce(array_agg(existing.user_id), '{}') into removed
  from public.submission_reviewers existing
  where existing.submission_id = target_submission_id
    and existing.org_id = target_org_id
    and existing.can_approve
    and not (existing.user_id = any(wanted));

  select coalesce(array_agg(w), '{}') into added
  from unnest(wanted) w
  where not exists (
    select 1 from public.submission_reviewers existing
    where existing.submission_id = target_submission_id
      and existing.user_id = w
      and existing.can_approve
  );

  if locked_submission.revision <> target_expected_revision then
    -- The same request again, after it was applied.
    if locked_submission.revision = target_expected_revision + 1
        and locked_submission.updated_by = target_actor_user_id
        and locked_submission.required_approvals is not distinct from target_required_approvals
        and cardinality(added) = 0
        and cardinality(removed) = 0 then
      return locked_submission;
    end if;

    raise exception 'Submission review has changed. Reload and try again.'
      using errcode = '40001';
  end if;

  if locked_submission.status not in ('submitted', 'in_review', 'needs_changes') then
    raise exception 'Submission reviewers cannot change in this status.'
      using errcode = 'P0001';
  end if;

  if exists (
    select 1 from public.submission_reviewers existing
    where existing.submission_id = target_submission_id
      and existing.user_id = any(removed)
      and existing.decision <> 'pending'
  ) then
    raise exception 'A reviewer who has already decided cannot be removed.'
      using errcode = 'P0001';
  end if;

  previous_status := locked_submission.status;
  next_status := case when previous_status = 'submitted' then 'in_review' else previous_status end;

  if cardinality(added) = 0 and cardinality(removed) = 0
      and next_status = previous_status
      and locked_submission.required_approvals is not distinct from target_required_approvals then
    return locked_submission;
  end if;

  delete from public.submission_reviewers existing
  where existing.submission_id = target_submission_id
    and existing.org_id = target_org_id
    and existing.user_id = any(removed);

  insert into public.submission_reviewers (submission_id, org_id, user_id, assigned_by)
  select target_submission_id, target_org_id, w, target_actor_user_id
  from unnest(added) w
  on conflict (submission_id, user_id)
  do update set can_approve = true, assigned_by = excluded.assigned_by, assigned_at = now();

  -- The first of the reviewers named stays the lead unless they were taken off.
  lead := case
    when locked_submission.assigned_to = any(wanted) then locked_submission.assigned_to
    else (select id from unnest(target_reviewer_ids) with ordinality as chosen(id, position)
          where id = any(wanted) order by position limit 1)
  end;
  lead_changes := lead is distinct from locked_submission.assigned_to;

  update public.submissions submission
  set status = next_status,
      required_approvals = target_required_approvals,
      assigned_to = lead,
      assigned_by = coalesce(locked_submission.assigned_by, target_actor_user_id),
      assigned_at = case
        when lead_changes or locked_submission.assigned_at is null then now()
        else locked_submission.assigned_at
      end,
      revision = submission.revision + 1,
      updated_by = target_actor_user_id,
      updated_at = clock_timestamp()
  where submission.id = target_submission_id and submission.org_id = target_org_id
  returning submission.* into locked_submission;

  for reviewer in
    select w from unnest(case when cardinality(added) > 0 then added else array[lead] end) w
  loop
    insert into public.submission_activity_events (
      id, org_id, submission_id, actor_user_id, event_type,
      from_status, to_status, assignee_user_id, submission_revision
    )
    values (
      gen_random_uuid(), target_org_id, target_submission_id, target_actor_user_id,
      'assigned', previous_status, next_status, reviewer, locked_submission.revision
    );

    insert into public.audit_logs (id, org_id, actor_user_id, action, target_type, target_id, metadata)
    values (
      gen_random_uuid(), target_org_id, target_actor_user_id, 'submission.assigned',
      'submission', target_submission_id,
      jsonb_build_object(
        'assigneeUserId', reviewer,
        'fromStatus', previous_status,
        'toStatus', next_status,
        'submissionRevision', locked_submission.revision
      )
    );
  end loop;

  foreach reviewer in array removed
  loop
    insert into public.submission_activity_events (
      id, org_id, submission_id, actor_user_id, event_type,
      from_status, to_status, assignee_user_id, submission_revision
    )
    values (
      gen_random_uuid(), target_org_id, target_submission_id, target_actor_user_id,
      'reviewer_removed', next_status, next_status, reviewer, locked_submission.revision
    );

    insert into public.audit_logs (id, org_id, actor_user_id, action, target_type, target_id, metadata)
    values (
      gen_random_uuid(), target_org_id, target_actor_user_id, 'submission.reviewer_removed',
      'submission', target_submission_id,
      jsonb_build_object('reviewerUserId', reviewer, 'submissionRevision', locked_submission.revision)
    );
  end loop;

  return locked_submission;
end;
$function$;

-- 3. An owner's membership is permanent while the workspace exists: its role,
-- role definition and status never change and it is never deleted. Deleting
-- the workspace still takes it, as protect_owner_organization_role allows.
create or replace function public.protect_owner_membership()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE'
      and old.role = 'owner_admin'
      and exists (
        select 1
        from public.organizations organization
        where organization.id = old.org_id
      ) then
    raise exception 'Owner access is permanent.'
      using errcode = '23514';
  end if;

  if tg_op = 'UPDATE'
      and old.role = 'owner_admin'
      and (
        new.org_id is distinct from old.org_id
        or new.role is distinct from old.role
        or new.role_definition_id is distinct from old.role_definition_id
        or new.status is distinct from old.status
      ) then
    raise exception 'Owner access is permanent.'
      using errcode = '23514';
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create trigger organization_memberships_protect_owner
  before update or delete on public.organization_memberships
  for each row execute function public.protect_owner_membership();

revoke all on function public.protect_owner_membership() from public, anon, authenticated;

-- 4. Nothing calls this any more; member access goes through
-- update_organization_member_access.
drop function if exists public.update_organization_member_role(uuid, uuid, uuid, public.organization_role);
