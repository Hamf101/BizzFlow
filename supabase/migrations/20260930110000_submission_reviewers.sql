-- Several reviewers on one submission, each with a decision of their own.
--
-- Until now one person, assigned_to, decided a submission. Now the people who
-- review it are rows in submission_reviewers. A reviewer approves, or requests
-- changes with a note. A change request blocks approval until the person who
-- assigned the reviewers dismisses it (with a note) or the submitter resubmits.
-- Approval comes when everyone has approved, or the number the assigner asked
-- for (required_approvals) has. assigned_to stays as the lead reviewer.
--
-- Only owners and managers decide, as before; external reviewers never had the
-- submissions:review permission, so they are not reviewers here.

alter table public.submissions
  add column required_approvals integer
    constraint submissions_required_approvals_positive
    check (required_approvals is null or required_approvals >= 1);

comment on column public.submissions.required_approvals is
  'How many reviewers must approve before the submission is approved; null means all of them.';

create table public.submission_reviewers (
  submission_id uuid not null,
  org_id uuid not null,
  user_id uuid not null,
  assigned_by uuid,
  assigned_at timestamptz not null default now(),
  decision text not null default 'pending',
  note text,
  decided_at timestamptz,
  primary key (submission_id, user_id),
  constraint submission_reviewers_submission_org_fkey
    foreign key (submission_id, org_id)
    references public.submissions (id, org_id)
    on delete cascade,
  constraint submission_reviewers_user_membership_fkey
    foreign key (org_id, user_id)
    references public.organization_memberships (org_id, user_id)
    on delete cascade,
  constraint submission_reviewers_decision_check
    check (decision in ('pending', 'approved', 'changes_requested', 'dismissed')),
  constraint submission_reviewers_note_check
    check (note is null or (note = btrim(note) and char_length(note) between 1 and 2000)),
  constraint submission_reviewers_decided_check
    check ((decision = 'pending') = (decided_at is null))
);

create index submission_reviewers_org_user_idx
  on public.submission_reviewers (org_id, user_id);

alter table public.submission_reviewers enable row level security;
alter table public.submission_reviewers force row level security;

-- Closed to signed-in users like the other tenant tables: the service reads and
-- writes them, and decides what each viewer may see.
revoke all on table public.submission_reviewers
  from public, anon, authenticated, service_role;
grant select, insert, update, delete on table public.submission_reviewers
  to service_role;

-- Whoever is the lead reviewer is a reviewer, however they were assigned.
create function private.sync_lead_reviewer()
returns trigger
language plpgsql
set search_path = ''
as $$
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
        and membership.role in ('owner_admin', 'manager')
    )
    on conflict (submission_id, user_id) do nothing;
  end if;

  return null;
end;
$$;

create trigger submissions_sync_lead_reviewer
  after insert or update of assigned_to on public.submissions
  for each row execute function private.sync_lead_reviewer();

-- A resubmitted submission is looked at afresh: every decision starts over.
create function private.reset_submission_reviews()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status = 'needs_changes' and new.status = 'submitted' then
    update public.submission_reviewers reviewer
    set decision = 'pending', note = null, decided_at = null
    where reviewer.submission_id = new.id
      and reviewer.org_id = new.org_id
      and reviewer.decision <> 'pending';
  end if;

  return null;
end;
$$;

create trigger submissions_reset_reviews
  after update of status on public.submissions
  for each row execute function private.reset_submission_reviews();

-- The submissions already being reviewed keep their reviewer, with what they decided.
insert into public.submission_reviewers (
  submission_id, org_id, user_id, assigned_by, assigned_at, decision, decided_at
)
select submission.id,
       submission.org_id,
       submission.assigned_to,
       submission.assigned_by,
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
 and membership.role in ('owner_admin', 'manager')
where submission.assigned_to is not null
on conflict (submission_id, user_id) do nothing;

-- New kinds of activity: an approval that did not finish the review, a change
-- request the assigner set aside, and a reviewer taken off.
alter table public.submission_activity_events
  drop constraint submission_activity_event_type_check,
  drop constraint submission_activity_event_shape_check;

alter table public.submission_activity_events
  add constraint submission_activity_event_type_check
    check (event_type = any (array[
      'submitted', 'resubmitted', 'assigned', 'commented', 'changes_requested',
      'approved', 'rejected', 'completed',
      'review_approved', 'changes_dismissed', 'reviewer_removed'
    ])),
  add constraint submission_activity_event_shape_check
    check (
      event_type = 'submitted' and from_status = 'draft' and to_status = 'submitted' and comment_id is null
      or event_type = 'resubmitted' and from_status = 'needs_changes' and to_status = 'submitted' and comment_id is null
      or event_type = 'assigned' and (
        from_status = 'submitted' and to_status = 'in_review'
        or from_status = 'in_review' and to_status = 'in_review'
        or from_status = 'needs_changes' and to_status = 'needs_changes'
      ) and comment_id is null
      or event_type = 'commented' and from_status = to_status and comment_id is not null
      or event_type = 'changes_requested' and from_status = 'in_review' and to_status = 'needs_changes' and comment_id is not null
      or event_type = 'approved' and from_status = 'in_review' and to_status = 'approved'
      or event_type = 'rejected' and from_status = 'in_review' and to_status = 'rejected' and comment_id is not null
      or event_type = 'completed' and from_status = 'approved' and to_status = 'completed'
      or event_type = 'review_approved' and from_status = 'in_review' and to_status = 'in_review'
      or event_type = 'changes_dismissed' and from_status = 'needs_changes'
        and to_status in ('needs_changes', 'in_review') and comment_id is not null
      or event_type = 'reviewer_removed' and from_status = to_status
        and from_status in ('submitted', 'in_review', 'needs_changes') and comment_id is null
    );

-- A dismissed change request sends the submission back into review.
CREATE OR REPLACE FUNCTION public.enforce_submission_update()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  created_by_cleanup boolean;
  updated_by_cleanup boolean;
  submitted_by_cleanup boolean;
  assigned_to_cleanup boolean;
  assigned_by_cleanup boolean;
  substantive_change boolean;
begin
  created_by_cleanup :=
    new.created_by is not distinct from old.created_by
    or (old.created_by is not null and new.created_by is null);
  updated_by_cleanup :=
    new.updated_by is not distinct from old.updated_by
    or (old.updated_by is not null and new.updated_by is null);
  submitted_by_cleanup :=
    new.submitted_by is not distinct from old.submitted_by
    or (old.submitted_by is not null and new.submitted_by is null);
  assigned_to_cleanup :=
    new.assigned_to is not distinct from old.assigned_to
    or (old.assigned_to is not null and new.assigned_to is null);
  assigned_by_cleanup :=
    new.assigned_by is not distinct from old.assigned_by
    or (old.assigned_by is not null and new.assigned_by is null);

  if new.id is distinct from old.id
      or new.org_id is distinct from old.org_id
      or new.title is distinct from old.title
      or new.template_id is distinct from old.template_id
      or new.template_revision is distinct from old.template_revision
      or new.template_snapshot is distinct from old.template_snapshot
      or new.public_form_link_id is distinct from old.public_form_link_id
      or not created_by_cleanup
      or new.created_at is distinct from old.created_at then
    raise exception 'Template snapshot identity is immutable.'
      using errcode = '23514';
  end if;

  if new.status is distinct from old.status
      and not (
        (old.status = 'draft' and new.status = 'submitted')
        or (old.status = 'submitted' and new.status = 'in_review')
        or (
          old.status = 'in_review'
          and new.status in ('needs_changes', 'approved', 'rejected')
        )
        or (old.status = 'needs_changes' and new.status in ('submitted', 'in_review'))
        or (old.status = 'approved' and new.status = 'completed')
      ) then
    raise exception 'Submission status transition is invalid.'
      using errcode = '23514';
  end if;

  if new.values is distinct from old.values
      and not (
        old.status in ('draft', 'needs_changes')
        and new.status in (old.status, 'submitted')
      ) then
    raise exception 'Submission values cannot change in this status.'
      using errcode = '23514';
  end if;

  if new.submitted_at is distinct from old.submitted_at
      and not (
        old.status in ('draft', 'needs_changes')
        and new.status = 'submitted'
        and new.submitted_at is not null
      ) then
    raise exception 'Submission timestamp transition is invalid.'
      using errcode = '23514';
  end if;

  if old.status in ('draft', 'needs_changes')
      and new.status = 'submitted'
      and new.submitted_by is null
      and new.public_form_link_id is null then
    raise exception 'Submission actor is required when submitting.'
      using errcode = '23514';
  end if;

  if not submitted_by_cleanup
      and not (
        old.status in ('draft', 'needs_changes')
        and new.status = 'submitted'
        and new.submitted_by is not null
      ) then
    raise exception 'Submission actor cannot change outside submission.'
      using errcode = '23514';
  end if;

  if (
      not assigned_to_cleanup
      or not assigned_by_cleanup
      or new.assigned_at is distinct from old.assigned_at
    )
    and not (
      old.status = 'submitted' and new.status = 'in_review'
      or old.status = 'in_review' and new.status = 'in_review'
      or old.status = 'needs_changes' and new.status = 'needs_changes'
    ) then
    raise exception 'Submission assignment cannot change in this status.'
      using errcode = '23514';
  end if;

  if (
      not assigned_to_cleanup
      or not assigned_by_cleanup
      or new.assigned_at is distinct from old.assigned_at
    )
    and (
      new.assigned_to is null
      or new.assigned_by is null
      or new.assigned_at is null
    ) then
    raise exception 'Submission assignment requires complete actor metadata.'
      using errcode = '23514';
  end if;

  if new.public_draft_token is distinct from old.public_draft_token
      and new.public_draft_token is not null then
    raise exception 'Public draft token cannot be reassigned.'
      using errcode = '23514';
  end if;

  substantive_change :=
    new.values is distinct from old.values
    or new.status is distinct from old.status
    or new.updated_at is distinct from old.updated_at
    or new.submitted_at is distinct from old.submitted_at
    or new.assigned_at is distinct from old.assigned_at
    or not updated_by_cleanup
    or not submitted_by_cleanup
    or not assigned_to_cleanup
    or not assigned_by_cleanup;

  if substantive_change and new.revision <> old.revision + 1 then
    raise exception 'Submission revision must advance exactly once.'
      using errcode = '23514';
  end if;

  if not substantive_change and new.revision <> old.revision then
    raise exception 'Submission revision cannot change without content.'
      using errcode = '23514';
  end if;

  return new;
end;
$function$;

-- A decision by a reviewer counts toward the whole: a change request blocks,
-- and approval waits for enough approvals.
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
  approvals integer;
  open_changes integer;
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

  perform public.assert_internal_submission_review_manager(
    target_org_id,
    target_actor_user_id
  );

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
    select count(*) filter (where reviewer.decision = 'approved'),
           count(*) filter (where reviewer.decision = 'changes_requested')
    into approvals, open_changes
    from public.submission_reviewers reviewer
    where reviewer.submission_id = target_submission_id
      and reviewer.org_id = target_org_id;

    advances := open_changes = 0
      and approvals >= coalesce(
        locked_submission.required_approvals,
        (
          select count(*)
          from public.submission_reviewers reviewer
          where reviewer.submission_id = target_submission_id
            and reviewer.org_id = target_org_id
        )
      );
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

-- Names who reviews a submission, how many of them must approve, and starts the
-- review when it has not started (or has to start again after a resubmission).
create or replace function public.set_submission_reviewers(
  target_org_id uuid,
  target_submission_id uuid,
  target_expected_revision integer,
  target_reviewer_ids uuid[],
  target_required_approvals integer,
  target_actor_user_id uuid
)
returns public.submissions
language plpgsql
set search_path = ''
as $$
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
      and membership.role in ('owner_admin', 'manager')
  ) <> cardinality(wanted) then
    raise exception 'Reviewers must be active owners or managers.'
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
$$;

-- The person who assigned the reviewers sets one reviewer's change request
-- aside, with a note, and may approve in the same step. The submission goes
-- back into review once no change request is left.
create or replace function public.dismiss_submission_changes_request(
  target_org_id uuid,
  target_submission_id uuid,
  target_expected_revision integer,
  target_reviewer_user_id uuid,
  target_comment text,
  target_also_approve boolean,
  target_actor_user_id uuid
)
returns public.submissions
language plpgsql
set search_path = ''
as $$
declare
  locked_submission public.submissions%rowtype;
  normalized_comment text;
  created_comment_id uuid;
  remaining integer;
  approvals integer;
  total integer;
begin
  normalized_comment := nullif(btrim(target_comment), '');

  if target_org_id is null
      or target_submission_id is null
      or target_expected_revision is null
      or target_expected_revision < 1
      or target_reviewer_user_id is null
      or target_actor_user_id is null then
    raise exception 'Change request identifiers and revision are required.'
      using errcode = '22023';
  end if;

  if normalized_comment is null or char_length(normalized_comment) > 2000 then
    raise exception 'A note of up to 2000 characters is required to set a change request aside.'
      using errcode = '22023';
  end if;

  perform public.assert_internal_submission_review_manager(target_org_id, target_actor_user_id);

  select submission.* into locked_submission
  from public.submissions submission
  where submission.id = target_submission_id and submission.org_id = target_org_id
  for update;

  if not found then
    raise exception 'Submission was not found.' using errcode = 'P0002';
  end if;

  if locked_submission.revision <> target_expected_revision then
    if locked_submission.updated_by = target_actor_user_id
        and locked_submission.revision > target_expected_revision
        and exists (
          select 1 from public.submission_reviewers reviewer
          where reviewer.submission_id = target_submission_id
            and reviewer.user_id = target_reviewer_user_id
            and reviewer.decision = 'dismissed'
            and reviewer.note = normalized_comment
        ) then
      return locked_submission;
    end if;

    raise exception 'Submission review has changed. Reload and try again.'
      using errcode = '40001';
  end if;

  if locked_submission.assigned_by is distinct from target_actor_user_id then
    raise exception 'Only the person who assigned the reviewers may set a change request aside.'
      using errcode = '42501';
  end if;

  if locked_submission.status <> 'needs_changes' then
    raise exception 'There is no change request to set aside.'
      using errcode = 'P0001';
  end if;

  update public.submission_reviewers reviewer
  set decision = 'dismissed', note = normalized_comment, decided_at = now()
  where reviewer.submission_id = target_submission_id
    and reviewer.org_id = target_org_id
    and reviewer.user_id = target_reviewer_user_id
    and reviewer.decision = 'changes_requested';

  if not found then
    raise exception 'That reviewer has no change request to set aside.'
      using errcode = 'P0001';
  end if;

  created_comment_id := gen_random_uuid();
  insert into public.submission_comments (id, org_id, submission_id, body, created_by)
  values (created_comment_id, target_org_id, target_submission_id, normalized_comment, target_actor_user_id);

  select count(*) into remaining
  from public.submission_reviewers reviewer
  where reviewer.submission_id = target_submission_id and reviewer.decision = 'changes_requested';

  update public.submissions submission
  set status = case when remaining = 0 then 'in_review' else 'needs_changes' end,
      revision = submission.revision + 1,
      updated_by = target_actor_user_id,
      updated_at = clock_timestamp()
  where submission.id = target_submission_id and submission.org_id = target_org_id
  returning submission.* into locked_submission;

  insert into public.submission_activity_events (
    id, org_id, submission_id, actor_user_id, event_type, from_status, to_status,
    assignee_user_id, comment_id, submission_revision
  )
  values (
    gen_random_uuid(), target_org_id, target_submission_id, target_actor_user_id,
    'changes_dismissed', 'needs_changes', locked_submission.status,
    target_reviewer_user_id, created_comment_id, locked_submission.revision
  );

  insert into public.audit_logs (id, org_id, actor_user_id, action, target_type, target_id, metadata)
  values (
    gen_random_uuid(), target_org_id, target_actor_user_id, 'submission.changes_dismissed',
    'submission', target_submission_id,
    jsonb_build_object(
      'reviewerUserId', target_reviewer_user_id,
      'commentId', created_comment_id,
      'submissionRevision', locked_submission.revision
    )
  );

  if coalesce(target_also_approve, false) and remaining = 0 then
    -- The assigner approves too, as a reviewer, and the usual rule then decides.
    insert into public.submission_reviewers (submission_id, org_id, user_id, assigned_by, decision, decided_at)
    values (target_submission_id, target_org_id, target_actor_user_id, target_actor_user_id, 'approved', now())
    on conflict (submission_id, user_id)
    do update set decision = 'approved', note = null, decided_at = now();

    select count(*) filter (where reviewer.decision = 'approved'), count(*)
    into approvals, total
    from public.submission_reviewers reviewer
    where reviewer.submission_id = target_submission_id;

    if approvals >= coalesce(locked_submission.required_approvals, total) then
      update public.submissions submission
      set status = 'approved',
          revision = submission.revision + 1,
          updated_by = target_actor_user_id,
          updated_at = clock_timestamp()
      where submission.id = target_submission_id and submission.org_id = target_org_id
      returning submission.* into locked_submission;

      insert into public.submission_activity_events (
        id, org_id, submission_id, actor_user_id, event_type, from_status, to_status, submission_revision
      )
      values (
        gen_random_uuid(), target_org_id, target_submission_id, target_actor_user_id,
        'approved', 'in_review', 'approved', locked_submission.revision
      );

      insert into public.audit_logs (id, org_id, actor_user_id, action, target_type, target_id, metadata)
      values (
        gen_random_uuid(), target_org_id, target_actor_user_id, 'submission.approved',
        'submission', target_submission_id,
        jsonb_build_object('fromStatus', 'in_review', 'toStatus', 'approved', 'submissionRevision', locked_submission.revision)
      );
    end if;
  end if;

  return locked_submission;
end;
$$;

revoke all on function public.set_submission_reviewers(uuid, uuid, integer, uuid[], integer, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.dismiss_submission_changes_request(uuid, uuid, integer, uuid, text, boolean, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.set_submission_reviewers(uuid, uuid, integer, uuid[], integer, uuid)
  to service_role;
grant execute on function public.dismiss_submission_changes_request(uuid, uuid, integer, uuid, text, boolean, uuid)
  to service_role;

notify pgrst, 'reload schema';
