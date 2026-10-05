-- Submission review and sharing fixes.

-- A reviewer who has left the workspace no longer counts toward approval, nor
-- holds it up.
create or replace function private.submission_approvals_met(target_submission_id uuid, target_required_approvals integer)
 returns boolean
 language sql
 stable
 set search_path to ''
as $function$
  select count(*) filter (where reviewer.decision = 'changes_requested') = 0
     and count(*) filter (where reviewer.can_approve and reviewer.decision = 'approved') >= greatest(
       1,
       least(
         coalesce(
           target_required_approvals,
           count(*) filter (where reviewer.can_approve and reviewer.decision <> 'dismissed')
         ),
         count(*) filter (where reviewer.can_approve and reviewer.decision <> 'dismissed')
       )
     )
  from public.submission_reviewers reviewer
  where reviewer.submission_id = target_submission_id
    and exists (
      select 1
      from public.organization_memberships membership
      where membership.org_id = reviewer.org_id
        and membership.user_id = reviewer.user_id
        and membership.status = 'active'
    );
$function$;

-- A manager rejects or completes even when only outside reviewers were named.
create or replace function public.transition_internal_submission(target_org_id uuid, target_submission_id uuid, target_expected_revision integer, target_transition text, target_comment text, target_actor_user_id uuid)
 returns public.submissions
 language plpgsql
 set search_path to ''
as $function$
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

  -- Rejecting and completing are a manager's call, checked above, whether or
  -- not they were named: only outside reviewers may have been.
  if not found and target_transition not in ('rejected', 'completed') then
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

-- Reassigning the lead takes the old lead off the reviewers.
create or replace function public.assign_internal_submission(target_org_id uuid, target_submission_id uuid, target_expected_revision integer, target_assignee_user_id uuid, target_actor_user_id uuid)
 returns public.submissions
 language plpgsql
 set search_path to ''
as $function$
declare
  locked_submission public.submissions%rowtype;
  previous_status text;
  next_status text;
  assignee_role public.organization_role;
begin
  if target_org_id is null
      or target_submission_id is null
      or target_expected_revision is null
      or target_expected_revision < 1
      or target_assignee_user_id is null
      or target_actor_user_id is null then
    raise exception 'Submission assignee, identifiers, and revision are required.'
      using errcode = '22023';
  end if;

  perform public.assert_internal_submission_review_manager(
    target_org_id,
    target_actor_user_id
  );

  select membership.role
  into assignee_role
  from public.organization_memberships membership
  where membership.org_id = target_org_id
    and membership.user_id = target_assignee_user_id
    and membership.status = 'active'
  for share;

  if not found
      or assignee_role not in ('owner_admin', 'manager', 'external_reviewer') then
    raise exception 'Submission assignee must be an active eligible organization member.'
      using errcode = '22023';
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
      and locked_submission.assigned_to = target_assignee_user_id
      and locked_submission.assigned_by = target_actor_user_id
      and locked_submission.status in ('in_review', 'needs_changes') then
    return locked_submission;
  end if;

  if locked_submission.revision <> target_expected_revision then
    raise exception 'Submission review has changed. Reload and try again.'
      using errcode = '40001';
  end if;

  if locked_submission.status not in ('submitted', 'in_review', 'needs_changes') then
    raise exception 'Submission assignment is not available in this status.'
      using errcode = 'P0001';
  end if;

  if locked_submission.status <> 'submitted'
      and locked_submission.assigned_to = target_assignee_user_id then
    return locked_submission;
  end if;

  previous_status := locked_submission.status;
  next_status := case
    when previous_status = 'submitted' then 'in_review'
    else previous_status
  end;

  -- The new lead replaces the old one, who would otherwise stay a reviewer
  -- whose approval is still awaited.
  if locked_submission.assigned_to <> target_assignee_user_id then
    delete from public.submission_reviewers reviewer
    where reviewer.submission_id = target_submission_id
      and reviewer.org_id = target_org_id
      and reviewer.user_id = locked_submission.assigned_to;
  end if;

  update public.submissions submission
  set status = next_status,
      assigned_to = target_assignee_user_id,
      assigned_by = target_actor_user_id,
      assigned_at = now(),
      revision = submission.revision + 1,
      updated_by = target_actor_user_id,
      updated_at = now()
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
    submission_revision
  )
  values (
    gen_random_uuid(),
    target_org_id,
    target_submission_id,
    target_actor_user_id,
    'assigned',
    previous_status,
    next_status,
    target_assignee_user_id,
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
    'submission.assigned',
    'submission',
    target_submission_id,
    jsonb_build_object(
      'assigneeUserId', target_assignee_user_id,
      'fromStatus', previous_status,
      'toStatus', next_status,
      'submissionRevision', locked_submission.revision
    )
  );

  return locked_submission;
end;
$function$;

-- Accepting a suggestion checks the answer it replaces and the shape of the new
-- one, and sends approvals given before it back to pending.
create or replace function public.decide_submission_suggestion(target_org_id uuid, target_submission_id uuid, target_suggestion_id uuid, target_accept boolean, target_actor_user_id uuid)
 returns public.submissions
 language plpgsql
 set search_path to ''
as $function$
declare
  locked_submission public.submissions%rowtype;
  suggestion public.submission_answer_suggestions%rowtype;
begin
  if target_org_id is null
      or target_submission_id is null
      or target_suggestion_id is null
      or target_accept is null
      or target_actor_user_id is null then
    raise exception 'Suggestion identifiers and a decision are required.'
      using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.organization_memberships membership
    where membership.org_id = target_org_id
      and membership.user_id = target_actor_user_id
      and membership.status = 'active'
  ) then
    raise exception 'Deciding on a suggestion requires an active membership.'
      using errcode = '42501';
  end if;

  select submission.* into locked_submission
  from public.submissions submission
  where submission.id = target_submission_id and submission.org_id = target_org_id
  for update;

  if not found then
    raise exception 'Submission was not found.' using errcode = 'P0002';
  end if;

  if locked_submission.created_by is distinct from target_actor_user_id then
    raise exception 'Only the person who submitted it can accept or decline a suggestion.'
      using errcode = '42501';
  end if;

  select candidate.* into suggestion
  from public.submission_answer_suggestions candidate
  where candidate.id = target_suggestion_id
    and candidate.submission_id = target_submission_id
    and candidate.org_id = target_org_id
  for update;

  if not found then
    raise exception 'Suggestion was not found.' using errcode = 'P0002';
  end if;

  if suggestion.status <> 'pending' then
    -- The same decision again, after it was applied.
    if suggestion.status = (case when target_accept then 'accepted' else 'declined' end) then
      return locked_submission;
    end if;

    raise exception 'That suggestion has already been decided.' using errcode = 'P0001';
  end if;

  if locked_submission.status not in ('submitted', 'in_review', 'needs_changes') then
    raise exception 'Suggestions can be decided only while it is being reviewed.'
      using errcode = 'P0001';
  end if;

  update public.submission_answer_suggestions candidate
  set status = case when target_accept then 'accepted' else 'declined' end,
      decided_by = target_actor_user_id,
      decided_at = now()
  where candidate.id = target_suggestion_id;

  if target_accept then
    -- The answer it would replace must still be there, and the result must
    -- fit the form as a submission would.
    if (locked_submission.values -> suggestion.field_key) is distinct from suggestion.previous_value then
      raise exception 'Submission review has changed. Reload and try again.'
        using errcode = '40001';
    end if;

    perform public.validate_internal_submission_values(
      locked_submission.template_snapshot,
      jsonb_set(locked_submission.values, array[suggestion.field_key], suggestion.proposed_value, true)
    );

    perform set_config('bizflow.accepting_suggestion', 'on', true);

    update public.submissions submission
    set values = jsonb_set(submission.values, array[suggestion.field_key], suggestion.proposed_value, true),
        revision = submission.revision + 1,
        updated_by = target_actor_user_id,
        updated_at = clock_timestamp()
    where submission.id = target_submission_id and submission.org_id = target_org_id
    returning submission.* into locked_submission;

    perform set_config('bizflow.accepting_suggestion', 'off', true);

    -- Approvals were given to the answers as they were.
    update public.submission_reviewers reviewer
    set decision = 'pending', note = null, decided_at = null
    where reviewer.submission_id = target_submission_id
      and reviewer.org_id = target_org_id
      and reviewer.decision = 'approved';
  end if;

  insert into public.submission_activity_events (
    id, org_id, submission_id, actor_user_id, event_type,
    from_status, to_status, assignee_user_id, submission_revision
  )
  values (
    gen_random_uuid(), target_org_id, target_submission_id, target_actor_user_id,
    case when target_accept then 'suggestion_accepted' else 'suggestion_declined' end,
    locked_submission.status, locked_submission.status, suggestion.suggested_by, locked_submission.revision
  );

  insert into public.audit_logs (id, org_id, actor_user_id, action, target_type, target_id, metadata)
  values (
    gen_random_uuid(), target_org_id, target_actor_user_id,
    case when target_accept then 'submission.suggestion_accepted' else 'submission.suggestion_declined' end,
    'submission', target_submission_id,
    jsonb_build_object(
      'suggestionId', target_suggestion_id,
      'fieldKey', suggestion.field_key,
      'submissionRevision', locked_submission.revision
    )
  );

  return locked_submission;
end;
$function$;
