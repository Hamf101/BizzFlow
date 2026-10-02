-- Sharing a submission with people who are not its reviewers, and reviewers
-- suggesting changes to the answers.
--
-- Someone a submission is shared with gets a row in submission_reviewers that
-- cannot approve: they see it, comment on it and may ask for changes, which
-- holds it up like any reviewer's request, but their approval never counts.
-- The person who submitted it, the person who assigned its reviewers and owner
-- admins may share it.
--
-- An owner or manager reviewing a submission may suggest new answers. Nothing
-- changes until the person who submitted it accepts a suggestion; every
-- suggestion stays, with what became of it, as the submission's change trail.

alter table public.submission_reviewers
  add column can_approve boolean not null default true,
  add constraint submission_reviewers_approver_check
    check (can_approve or decision <> 'approved');

comment on column public.submission_reviewers.can_approve is
  'False for someone the submission was shared with: they comment and may ask for changes, but never approve.';

-- Only reviewers who can approve count toward approval; a change request from
-- anyone holds it up.
create or replace function private.submission_approvals_met(
  target_submission_id uuid,
  target_required_approvals integer
)
returns boolean
language sql
stable
set search_path = ''
as $$
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
  where reviewer.submission_id = target_submission_id;
$$;

create table public.submission_answer_suggestions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  submission_id uuid not null,
  field_key text not null,
  previous_value jsonb,
  proposed_value jsonb not null,
  suggested_by uuid references public.profiles (id) on delete set null,
  suggested_at timestamptz not null default now(),
  status text not null default 'pending',
  decided_by uuid references public.profiles (id) on delete set null,
  decided_at timestamptz,
  constraint submission_answer_suggestions_submission_org_fkey
    foreign key (submission_id, org_id)
    references public.submissions (id, org_id)
    on delete cascade,
  constraint submission_answer_suggestions_field_key_check
    check (char_length(field_key) between 1 and 200),
  constraint submission_answer_suggestions_value_check
    check (jsonb_typeof(proposed_value) in ('string', 'boolean')),
  constraint submission_answer_suggestions_status_check
    check (status in ('pending', 'accepted', 'declined')),
  constraint submission_answer_suggestions_decided_check
    check ((status = 'pending') = (decided_at is null))
);

-- One open suggestion per reviewer per answer; a new one replaces it.
create unique index submission_answer_suggestions_open_idx
  on public.submission_answer_suggestions (submission_id, field_key, suggested_by)
  where status = 'pending';

create index submission_answer_suggestions_submission_idx
  on public.submission_answer_suggestions (org_id, submission_id, suggested_at);

alter table public.submission_answer_suggestions enable row level security;
alter table public.submission_answer_suggestions force row level security;

revoke all on table public.submission_answer_suggestions
  from public, anon, authenticated, service_role;
grant select, insert, update on table public.submission_answer_suggestions to service_role;

alter table public.submission_activity_events
  drop constraint submission_activity_event_type_check,
  drop constraint submission_activity_event_shape_check;

alter table public.submission_activity_events
  add constraint submission_activity_event_type_check
    check (event_type = any (array[
      'submitted', 'resubmitted', 'assigned', 'commented', 'changes_requested',
      'approved', 'rejected', 'completed',
      'review_approved', 'changes_dismissed', 'reviewer_removed',
      'shared', 'unshared', 'answers_suggested', 'suggestion_accepted', 'suggestion_declined'
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
      or event_type in ('shared', 'unshared') and from_status = to_status
        and from_status <> 'draft' and comment_id is null
      or event_type in ('answers_suggested', 'suggestion_accepted', 'suggestion_declined')
        and from_status = to_status
        and from_status in ('submitted', 'in_review', 'needs_changes') and comment_id is null
    );

-- Answers change only while a draft is written or changes are made, or when the
-- person who submitted it accepts a reviewer's suggestion.
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
      )
      and not (
        current_setting('bizflow.accepting_suggestion', true) = 'on'
        and old.status in ('submitted', 'in_review', 'needs_changes')
        and new.status = old.status
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

-- Anyone named on a submission, as reviewer or because it was shared with
-- them, may comment on it.
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

  -- Null-safe throughout: a public form's submission has no author, and an
  -- unassigned one no lead, and neither may let a comment through.
  if locked_submission.status = 'draft'
      or not (
        actor_role in ('owner_admin', 'manager')
        or (
          actor_role = 'staff'
          and locked_submission.created_by is not distinct from target_actor_user_id
        )
        or (
          actor_role = 'external_reviewer'
          and locked_submission.assigned_to is not distinct from target_actor_user_id
        )
        or exists (
          select 1
          from public.submission_reviewers reviewer
          where reviewer.submission_id = locked_submission.id
            and reviewer.user_id = target_actor_user_id
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

-- Choosing reviewers leaves the people it was shared with alone; naming one of
-- them a reviewer lets them approve.
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

-- Sets who a submission is shared with, beyond its reviewers. Returns the
-- people newly added, so they can be told.
create or replace function public.set_submission_sharing(
  target_org_id uuid,
  target_submission_id uuid,
  target_user_ids uuid[],
  target_actor_user_id uuid
)
returns uuid[]
language plpgsql
set search_path = ''
as $$
declare
  locked_submission public.submissions%rowtype;
  actor_role public.organization_role;
  wanted uuid[];
  added uuid[];
  removed uuid[];
  person uuid;
begin
  if target_org_id is null
      or target_submission_id is null
      or target_user_ids is null
      or target_actor_user_id is null then
    raise exception 'Submission sharing identifiers are required.'
      using errcode = '22023';
  end if;

  select membership.role into actor_role
  from public.organization_memberships membership
  where membership.org_id = target_org_id
    and membership.user_id = target_actor_user_id
    and membership.status = 'active';

  if not found then
    raise exception 'Sharing a submission requires an active membership.'
      using errcode = '42501';
  end if;

  select submission.* into locked_submission
  from public.submissions submission
  where submission.id = target_submission_id and submission.org_id = target_org_id
  for update;

  if not found then
    raise exception 'Submission was not found.' using errcode = 'P0002';
  end if;

  if not (
    actor_role = 'owner_admin'
    or locked_submission.created_by is not distinct from target_actor_user_id
    or locked_submission.assigned_by is not distinct from target_actor_user_id
  ) then
    raise exception 'Only the person who submitted it, whoever chose its reviewers, or an owner can share a submission.'
      using errcode = '42501';
  end if;

  if locked_submission.status = 'draft' then
    raise exception 'A draft cannot be shared.' using errcode = 'P0001';
  end if;

  -- The person who submitted it and its reviewers already see it.
  select coalesce(array_agg(distinct id), '{}') into wanted
  from unnest(target_user_ids) id
  where id is distinct from locked_submission.created_by
    and not exists (
      select 1 from public.submission_reviewers existing
      where existing.submission_id = target_submission_id
        and existing.user_id = id
        and existing.can_approve
    );

  if cardinality(wanted) > 50 then
    raise exception 'Share with at most 50 people.' using errcode = '22023';
  end if;

  if (
    select count(*)
    from public.organization_memberships membership
    where membership.org_id = target_org_id
      and membership.user_id = any(wanted)
      and membership.status = 'active'
  ) <> cardinality(wanted) then
    raise exception 'Share only with active members of this workspace.'
      using errcode = '22023';
  end if;

  select coalesce(array_agg(existing.user_id), '{}') into removed
  from public.submission_reviewers existing
  where existing.submission_id = target_submission_id
    and not existing.can_approve
    and not (existing.user_id = any(wanted));

  if exists (
    select 1 from public.submission_reviewers existing
    where existing.submission_id = target_submission_id
      and existing.user_id = any(removed)
      and existing.decision = 'changes_requested'
  ) then
    raise exception 'Someone whose change request is still open cannot be taken off. Set it aside first.'
      using errcode = 'P0001';
  end if;

  select coalesce(array_agg(w), '{}') into added
  from unnest(wanted) w
  where not exists (
    select 1 from public.submission_reviewers existing
    where existing.submission_id = target_submission_id and existing.user_id = w
  );

  delete from public.submission_reviewers existing
  where existing.submission_id = target_submission_id
    and existing.user_id = any(removed);

  insert into public.submission_reviewers (submission_id, org_id, user_id, assigned_by, can_approve)
  select target_submission_id, target_org_id, w, target_actor_user_id, false
  from unnest(added) w;

  foreach person in array added || removed
  loop
    insert into public.submission_activity_events (
      id, org_id, submission_id, actor_user_id, event_type,
      from_status, to_status, assignee_user_id, submission_revision
    )
    values (
      gen_random_uuid(), target_org_id, target_submission_id, target_actor_user_id,
      case when person = any(added) then 'shared' else 'unshared' end,
      locked_submission.status, locked_submission.status, person, locked_submission.revision
    );

    insert into public.audit_logs (id, org_id, actor_user_id, action, target_type, target_id, metadata)
    values (
      gen_random_uuid(), target_org_id, target_actor_user_id,
      case when person = any(added) then 'submission.shared' else 'submission.unshared' end,
      'submission', target_submission_id,
      jsonb_build_object('userId', person, 'submissionRevision', locked_submission.revision)
    );
  end loop;

  return added;
end;
$$;

-- An owner or manager reviewing a submission suggests new answers. The values
-- were checked against the form by the service; here only the answers that
-- differ from what is there now are kept. Returns how many were suggested.
create or replace function public.suggest_submission_answers(
  target_org_id uuid,
  target_submission_id uuid,
  target_values jsonb,
  target_actor_user_id uuid
)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  locked_submission public.submissions%rowtype;
  field text;
  proposed jsonb;
  suggested integer := 0;
begin
  if target_org_id is null
      or target_submission_id is null
      or target_values is null
      or jsonb_typeof(target_values) <> 'object'
      or target_actor_user_id is null then
    raise exception 'Suggested answers and identifiers are required.'
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

  if not exists (
    select 1 from public.submission_reviewers reviewer
    where reviewer.submission_id = target_submission_id
      and reviewer.user_id = target_actor_user_id
      and reviewer.can_approve
  ) then
    raise exception 'Only a reviewer can suggest changes.' using errcode = '42501';
  end if;

  if locked_submission.status not in ('in_review', 'needs_changes') then
    raise exception 'Changes can be suggested only while it is being reviewed.'
      using errcode = 'P0001';
  end if;

  for field, proposed in select key, value from jsonb_each(target_values)
  loop
    continue when proposed is not distinct from locked_submission.values -> field;

    insert into public.submission_answer_suggestions (
      org_id, submission_id, field_key, previous_value, proposed_value, suggested_by
    )
    values (
      target_org_id, target_submission_id, field, locked_submission.values -> field, proposed, target_actor_user_id
    )
    on conflict (submission_id, field_key, suggested_by) where status = 'pending'
    do update set previous_value = excluded.previous_value,
                  proposed_value = excluded.proposed_value,
                  suggested_at = now();

    suggested := suggested + 1;
  end loop;

  if suggested > 0 then
    insert into public.submission_activity_events (
      id, org_id, submission_id, actor_user_id, event_type,
      from_status, to_status, submission_revision
    )
    values (
      gen_random_uuid(), target_org_id, target_submission_id, target_actor_user_id,
      'answers_suggested', locked_submission.status, locked_submission.status, locked_submission.revision
    );

    insert into public.audit_logs (id, org_id, actor_user_id, action, target_type, target_id, metadata)
    values (
      gen_random_uuid(), target_org_id, target_actor_user_id, 'submission.answers_suggested',
      'submission', target_submission_id,
      jsonb_build_object('count', suggested, 'submissionRevision', locked_submission.revision)
    );
  end if;

  return suggested;
end;
$$;

-- The person who submitted it accepts a suggestion, which changes the answer,
-- or declines it. Either way the suggestion stays in the trail.
create or replace function public.decide_submission_suggestion(
  target_org_id uuid,
  target_submission_id uuid,
  target_suggestion_id uuid,
  target_accept boolean,
  target_actor_user_id uuid
)
returns public.submissions
language plpgsql
set search_path = ''
as $$
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
    perform set_config('bizflow.accepting_suggestion', 'on', true);

    update public.submissions submission
    set values = jsonb_set(submission.values, array[suggestion.field_key], suggestion.proposed_value, true),
        revision = submission.revision + 1,
        updated_by = target_actor_user_id,
        updated_at = clock_timestamp()
    where submission.id = target_submission_id and submission.org_id = target_org_id
    returning submission.* into locked_submission;

    perform set_config('bizflow.accepting_suggestion', 'off', true);
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
$$;

revoke all on function public.set_submission_sharing(uuid, uuid, uuid[], uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.suggest_submission_answers(uuid, uuid, jsonb, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.decide_submission_suggestion(uuid, uuid, uuid, boolean, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.set_submission_sharing(uuid, uuid, uuid[], uuid) to service_role;
grant execute on function public.suggest_submission_answers(uuid, uuid, jsonb, uuid) to service_role;
grant execute on function public.decide_submission_suggestion(uuid, uuid, uuid, boolean, uuid) to service_role;

notify pgrst, 'reload schema';
