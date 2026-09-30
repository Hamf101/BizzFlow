-- External reviewers are reviewers like any other: they can be named, they
-- see the submission, comment on it, and approve or ask for changes. Rejecting
-- and completing stay with owners and managers.

-- Anyone already assigned as lead reviewer, whatever their role, is a reviewer.
insert into public.submission_reviewers (
  submission_id, org_id, user_id, assigned_by, assigned_at, decision, decided_at
)
select submission.id, submission.org_id, submission.assigned_to, submission.assigned_by,
       coalesce(submission.assigned_at, submission.updated_at),
       case
         when submission.status in ('approved', 'completed') then 'approved'
         when submission.status = 'needs_changes' then 'changes_requested'
         else 'pending'
       end,
       case
         when submission.status in ('approved', 'completed', 'needs_changes') then submission.updated_at
         else null
       end
from public.submissions submission
join public.organization_memberships membership
  on membership.org_id = submission.org_id
 and membership.user_id = submission.assigned_to
 and membership.status = 'active'
 and membership.role = 'external_reviewer'
where submission.assigned_to is not null
on conflict (submission_id, user_id) do nothing;

CREATE OR REPLACE FUNCTION private.sync_lead_reviewer()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  if new.assigned_to is not null then
    insert into public.submission_reviewers (submission_id, org_id, user_id, assigned_by, assigned_at)
    select new.id, new.org_id, new.assigned_to, new.assigned_by, coalesce(new.assigned_at, now())
    where exists (
      select 1
      from public.organization_memberships membership
      where membership.org_id = new.org_id
        and membership.user_id = new.assigned_to
        and membership.status = 'active'
        and membership.role in ('owner_admin', 'manager', 'external_reviewer')
    )
    on conflict (submission_id, user_id) do nothing;
  end if;

  return null;
end;
$function$;

CREATE OR REPLACE FUNCTION public.transition_internal_submission(target_org_id uuid, target_submission_id uuid, target_expected_revision integer, target_transition text, target_comment text, target_actor_user_id uuid)
 RETURNS submissions
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  locked_submission public.submissions%rowtype;
  previous_status text;
  normalized_comment text;
  created_comment_id uuid;
  activity_event_type text;
  audit_action text;
  reviewer_decision text;
  advances boolean := true;
  new_status text;
begin
  if target_org_id is null
      or target_submission_id is null
      or target_expected_revision is null
      or target_expected_revision < 1
      or target_transition is null
      or target_transition not in (
        'needs_changes',
        'approved',
        'rejected',
        'completed'
      )
      or target_actor_user_id is null then
    raise exception 'Submission transition identifiers and revision are invalid.'
      using errcode = '22023';
  end if;

  normalized_comment := nullif(btrim(target_comment), '');

  if normalized_comment is not null
      and char_length(normalized_comment) > 2000 then
    raise exception 'Review comment must be at most 2000 characters.'
      using errcode = '22023';
  end if;

  if target_transition in ('needs_changes', 'rejected')
      and normalized_comment is null then
    raise exception 'Review comment is required for this transition.'
      using errcode = '22023';
  end if;

  activity_event_type := case target_transition
    when 'needs_changes' then 'changes_requested'
    else target_transition
  end;
  audit_action := case target_transition
    when 'needs_changes' then 'submission.changes_requested'
    else 'submission.' || target_transition
  end;

  -- Rejecting and completing stay with owners and managers. Approving or
  -- asking for changes is for whoever was named a reviewer, whatever their role.
  if target_transition in ('rejected', 'completed') then
    perform public.assert_internal_submission_review_manager(
      target_org_id,
      target_actor_user_id
    );
  elsif not exists (
    select 1
    from public.organization_memberships membership
    where membership.org_id = target_org_id
      and membership.user_id = target_actor_user_id
      and membership.status = 'active'
  ) then
    raise exception 'Only an assigned reviewer may make this decision.'
      using errcode = '42501';
  end if;

  select submission.*
  into locked_submission
  from public.submissions submission
  where submission.id = target_submission_id
    and submission.org_id = target_org_id
  for update;

  if not found then
    raise exception 'Submission was not found.'
      using errcode = 'P0002';
  end if;

  if locked_submission.revision = target_expected_revision + 1
      and locked_submission.status = target_transition
      and locked_submission.updated_by = target_actor_user_id then
    if exists (
      select 1
      from public.submission_activity_events activity
      left join public.submission_comments review_comment
        on review_comment.id = activity.comment_id
        and review_comment.org_id = activity.org_id
        and review_comment.submission_id = activity.submission_id
      where activity.org_id = target_org_id
        and activity.submission_id = target_submission_id
        and activity.actor_user_id = target_actor_user_id
        and activity.event_type = activity_event_type
        and activity.to_status = target_transition
        and activity.submission_revision = locked_submission.revision
        and review_comment.body is not distinct from normalized_comment
    ) then
      return locked_submission;
    end if;

    raise exception 'Submission review has changed. Reload and try again.'
      using errcode = '40001';
  end if;

  if target_transition = 'approved'
      and locked_submission.status = 'in_review'
      and locked_submission.revision = target_expected_revision + 1
      and locked_submission.updated_by = target_actor_user_id
      and exists (
        select 1
        from public.submission_reviewers reviewer
        where reviewer.submission_id = target_submission_id
          and reviewer.user_id = target_actor_user_id
          and reviewer.decision = 'approved'
          and reviewer.note is not distinct from normalized_comment
      ) then
    return locked_submission;
  end if;

  if locked_submission.revision <> target_expected_revision then
    raise exception 'Submission review has changed. Reload and try again.'
      using errcode = '40001';
  end if;

  select reviewer.decision
  into reviewer_decision
  from public.submission_reviewers reviewer
  where reviewer.submission_id = target_submission_id
    and reviewer.org_id = target_org_id
    and reviewer.user_id = target_actor_user_id
  for update;

  if not found then
    raise exception 'Only an assigned reviewer may make this decision.'
      using errcode = '42501';
  end if;

  if target_transition = 'approved' and reviewer_decision = 'changes_requested' then
    raise exception 'Your change request has to be dismissed before you can approve.'
      using errcode = 'P0001';
  end if;

  if not (
    locked_submission.status = 'in_review'
      and target_transition in ('needs_changes', 'approved', 'rejected')
    or locked_submission.status = 'approved'
      and target_transition = 'completed'
  ) then
    raise exception 'Submission transition is not available from the current status.'
      using errcode = 'P0001';
  end if;

  previous_status := locked_submission.status;

  -- What each reviewer decided decides the submission: a change request blocks,
  -- and approval waits until enough reviewers have approved.
  if target_transition in ('needs_changes', 'approved') then
    update public.submission_reviewers reviewer
    set decision = case target_transition when 'approved' then 'approved' else 'changes_requested' end,
        note = normalized_comment,
        decided_at = now()
    where reviewer.submission_id = target_submission_id
      and reviewer.org_id = target_org_id
      and reviewer.user_id = target_actor_user_id;
  end if;

  if target_transition = 'approved' then
    advances := private.submission_approvals_met(target_submission_id, locked_submission.required_approvals);
  end if;

  new_status := case when advances then target_transition else previous_status end;

  if normalized_comment is not null then
    created_comment_id := gen_random_uuid();

    insert into public.submission_comments (
      id,
      org_id,
      submission_id,
      body,
      created_by
    )
    values (
      created_comment_id,
      target_org_id,
      target_submission_id,
      normalized_comment,
      target_actor_user_id
    );
  end if;

  update public.submissions submission
  set status = new_status,
      revision = submission.revision + 1,
      updated_by = target_actor_user_id,
      updated_at = clock_timestamp()
  where submission.id = target_submission_id
    and submission.org_id = target_org_id
  returning submission.* into locked_submission;

  insert into public.submission_activity_events (
    id,
    org_id,
    submission_id,
    actor_user_id,
    event_type,
    from_status,
    to_status,
    assignee_user_id,
    comment_id,
    submission_revision
  )
  values (
    gen_random_uuid(),
    target_org_id,
    target_submission_id,
    target_actor_user_id,
    case when advances then activity_event_type else 'review_approved' end,
    previous_status,
    new_status,
    locked_submission.assigned_to,
    created_comment_id,
    locked_submission.revision
  );

  insert into public.audit_logs (
    id,
    org_id,
    actor_user_id,
    action,
    target_type,
    target_id,
    metadata
  )
  values (
    gen_random_uuid(),
    target_org_id,
    target_actor_user_id,
    case when advances then audit_action else 'submission.review_approved' end,
    'submission',
    target_submission_id,
    jsonb_strip_nulls(
      jsonb_build_object(
        'fromStatus', previous_status,
        'toStatus', new_status,
        'commentId', created_comment_id,
        'submissionRevision', locked_submission.revision
      )
    )
  );

  return locked_submission;
end;
$function$;

CREATE OR REPLACE FUNCTION public.create_internal_submission_comment(target_org_id uuid, target_submission_id uuid, target_comment_id uuid, target_body text, target_actor_user_id uuid)
 RETURNS submission_comments
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  locked_submission public.submissions%rowtype;
  prepared_comment public.submission_comments%rowtype;
  actor_role public.organization_role;
  normalized_body text;
begin
  normalized_body := btrim(target_body);

  if target_org_id is null
      or target_submission_id is null
      or target_comment_id is null
      or target_body is null
      or normalized_body = ''
      or char_length(normalized_body) > 2000
      or target_actor_user_id is null then
    raise exception 'Submission comment must be between 1 and 2000 characters.'
      using errcode = '22023';
  end if;

  select membership.role
  into actor_role
  from public.organization_memberships membership
  where membership.org_id = target_org_id
    and membership.user_id = target_actor_user_id
    and membership.status = 'active'
  for share;

  if not found then
    raise exception 'Submission comment requires an active organization membership.'
      using errcode = '42501';
  end if;

  select submission.*
  into locked_submission
  from public.submissions submission
  where submission.id = target_submission_id
    and submission.org_id = target_org_id
  for update;

  if not found then
    raise exception 'Submission was not found.'
      using errcode = 'P0002';
  end if;

  if locked_submission.status = 'draft'
      or not (
        actor_role in ('owner_admin', 'manager')
        or (
          actor_role = 'staff'
          and locked_submission.created_by = target_actor_user_id
        )
        or (
          actor_role = 'external_reviewer'
          and (
            locked_submission.assigned_to = target_actor_user_id
            or exists (
              select 1
              from public.submission_reviewers reviewer
              where reviewer.submission_id = locked_submission.id
                and reviewer.user_id = target_actor_user_id
            )
          )
        )
      ) then
    raise exception 'Submission comment is not available to this member.'
      using errcode = '42501';
  end if;

  select submission_comment.*
  into prepared_comment
  from public.submission_comments submission_comment
  where submission_comment.id = target_comment_id;

  if found then
    if prepared_comment.org_id = target_org_id
        and prepared_comment.submission_id = target_submission_id
        and prepared_comment.body = normalized_body
        and prepared_comment.created_by = target_actor_user_id then
      return prepared_comment;
    end if;

    raise exception 'Submission comment identifier is already in use.'
      using errcode = '23505';
  end if;

  insert into public.submission_comments (
    id,
    org_id,
    submission_id,
    body,
    created_by
  )
  values (
    target_comment_id,
    target_org_id,
    target_submission_id,
    normalized_body,
    target_actor_user_id
  )
  returning * into prepared_comment;

  insert into public.submission_activity_events (
    id,
    org_id,
    submission_id,
    actor_user_id,
    event_type,
    from_status,
    to_status,
    comment_id,
    submission_revision
  )
  values (
    gen_random_uuid(),
    target_org_id,
    target_submission_id,
    target_actor_user_id,
    'commented',
    locked_submission.status,
    locked_submission.status,
    target_comment_id,
    locked_submission.revision
  );

  insert into public.audit_logs (
    id,
    org_id,
    actor_user_id,
    action,
    target_type,
    target_id,
    metadata
  )
  values (
    gen_random_uuid(),
    target_org_id,
    target_actor_user_id,
    'submission.commented',
    'submission',
    target_submission_id,
    jsonb_build_object(
      'commentId', target_comment_id,
      'submissionRevision', locked_submission.revision
    )
  );

  return prepared_comment;
end;
$function$;

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

  select coalesce(array_agg(existing.user_id), '{}') into removed
  from public.submission_reviewers existing
  where existing.submission_id = target_submission_id
    and existing.org_id = target_org_id
    and not (existing.user_id = any(wanted));

  select coalesce(array_agg(w), '{}') into added
  from unnest(wanted) w
  where not exists (
    select 1 from public.submission_reviewers existing
    where existing.submission_id = target_submission_id and existing.user_id = w
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
  from unnest(added) w;

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

notify pgrst, 'reload schema';
