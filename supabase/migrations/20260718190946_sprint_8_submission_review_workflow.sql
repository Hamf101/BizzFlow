alter table public.submissions
  add column assigned_to uuid,
  add column assigned_by uuid,
  add column assigned_at timestamptz;

alter table public.submissions
  add constraint submissions_assigned_to_fkey
    foreign key (assigned_to)
    references public.profiles (id)
    on delete set null,
  add constraint submissions_assigned_by_fkey
    foreign key (assigned_by)
    references public.profiles (id)
    on delete set null;

alter table public.submissions
  drop constraint submissions_status_check,
  drop constraint submissions_state_check;

alter table public.submissions
  add constraint submissions_status_check
    check (
      status in (
        'draft',
        'submitted',
        'in_review',
        'needs_changes',
        'approved',
        'rejected',
        'completed'
      )
    ),
  add constraint submissions_state_check
    check (
      (
        status = 'draft'
        and submitted_by is null
        and submitted_at is null
        and assigned_to is null
        and assigned_by is null
        and assigned_at is null
      )
      or
      (
        status = 'submitted'
        and submitted_at is not null
        and (
          assigned_at is not null
          or (
            assigned_to is null
            and assigned_by is null
          )
        )
      )
      or
      (
        status in (
          'in_review',
          'needs_changes',
          'approved',
          'rejected',
          'completed'
        )
        and submitted_at is not null
        and assigned_at is not null
      )
    );

create index submissions_org_assignee_status_idx
  on public.submissions (org_id, assigned_to, status, updated_at desc, id)
  where assigned_at is not null;

create index submissions_assigned_to_idx
  on public.submissions (assigned_to)
  where assigned_to is not null;

create index submissions_assigned_by_idx
  on public.submissions (assigned_by)
  where assigned_by is not null;

create table public.submission_comments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  submission_id uuid not null,
  body text not null,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (id, org_id, submission_id),
  constraint submission_comments_submission_id_org_id_fkey
    foreign key (submission_id, org_id)
    references public.submissions (id, org_id)
    on delete cascade,
  constraint submission_comments_body_trimmed_length
    check (
      body = btrim(body)
      and char_length(body) between 1 and 2000
    )
);

create table public.submission_activity_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  submission_id uuid not null,
  actor_user_id uuid references public.profiles (id) on delete set null,
  event_type text not null,
  from_status text not null,
  to_status text not null,
  assignee_user_id uuid references public.profiles (id) on delete set null,
  comment_id uuid,
  submission_revision integer not null,
  created_at timestamptz not null default now(),
  constraint submission_activity_submission_id_org_id_fkey
    foreign key (submission_id, org_id)
    references public.submissions (id, org_id)
    on delete cascade,
  constraint submission_activity_comment_id_fkey
    foreign key (comment_id, org_id, submission_id)
    references public.submission_comments (id, org_id, submission_id),
  constraint submission_activity_event_type_check
    check (
      event_type in (
        'submitted',
        'resubmitted',
        'assigned',
        'commented',
        'changes_requested',
        'approved',
        'rejected',
        'completed'
      )
    ),
  constraint submission_activity_status_check
    check (
      from_status in (
        'draft',
        'submitted',
        'in_review',
        'needs_changes',
        'approved',
        'rejected',
        'completed'
      )
      and to_status in (
        'draft',
        'submitted',
        'in_review',
        'needs_changes',
        'approved',
        'rejected',
        'completed'
      )
    ),
  constraint submission_activity_revision_positive
    check (submission_revision > 0),
  constraint submission_activity_event_shape_check
    check (
      (
        event_type = 'submitted'
        and from_status = 'draft'
        and to_status = 'submitted'
        and comment_id is null
      )
      or
      (
        event_type = 'resubmitted'
        and from_status = 'needs_changes'
        and to_status = 'submitted'
        and comment_id is null
      )
      or
      (
        event_type = 'assigned'
        and (
          (from_status = 'submitted' and to_status = 'in_review')
          or (from_status = 'in_review' and to_status = 'in_review')
          or (from_status = 'needs_changes' and to_status = 'needs_changes')
        )
        and comment_id is null
      )
      or
      (
        event_type = 'commented'
        and from_status = to_status
        and comment_id is not null
      )
      or
      (
        event_type = 'changes_requested'
        and from_status = 'in_review'
        and to_status = 'needs_changes'
        and comment_id is not null
      )
      or
      (
        event_type = 'approved'
        and from_status = 'in_review'
        and to_status = 'approved'
      )
      or
      (
        event_type = 'rejected'
        and from_status = 'in_review'
        and to_status = 'rejected'
        and comment_id is not null
      )
      or
      (
        event_type = 'completed'
        and from_status = 'approved'
        and to_status = 'completed'
      )
    )
);

create index submission_comments_submission_created_idx
  on public.submission_comments (submission_id, created_at, id);

create index submission_comments_org_created_idx
  on public.submission_comments (org_id, created_at desc, id);

create index submission_comments_created_by_idx
  on public.submission_comments (created_by)
  where created_by is not null;

create index submission_activity_submission_created_idx
  on public.submission_activity_events (submission_id, created_at, id);

create index submission_activity_org_created_idx
  on public.submission_activity_events (org_id, created_at desc, id);

create index submission_activity_actor_idx
  on public.submission_activity_events (actor_user_id)
  where actor_user_id is not null;

create index submission_activity_assignee_idx
  on public.submission_activity_events (assignee_user_id)
  where assignee_user_id is not null;

create index submission_activity_comment_idx
  on public.submission_activity_events (comment_id)
  where comment_id is not null;

create or replace function public.enforce_submission_update()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
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
        or (old.status = 'needs_changes' and new.status = 'submitted')
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
      and new.submitted_by is null then
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
$$;

revoke all on function public.enforce_submission_update()
  from public, anon, authenticated, service_role;

alter table public.submission_comments enable row level security;
alter table public.submission_comments force row level security;
alter table public.submission_activity_events enable row level security;
alter table public.submission_activity_events force row level security;

revoke all on table public.submission_comments
  from anon, authenticated, service_role;
revoke all on table public.submission_activity_events
  from anon, authenticated, service_role;

grant select on table public.submission_comments to authenticated;
grant select on table public.submission_activity_events to authenticated;
grant select, insert on table public.submission_comments to service_role;
grant select, insert on table public.submission_activity_events to service_role;

drop policy submissions_select_internal_member on public.submissions;
drop policy submission_files_select_internal_member on public.submission_files;

create policy submissions_select_internal_member
  on public.submissions
  for select
  to authenticated
  using (
    (select public.organization_role_for(org_id)) in ('owner_admin', 'manager')
    or (
      (select public.organization_role_for(org_id)) = 'staff'
      and created_by = (select auth.uid())
    )
    or (
      (select public.organization_role_for(org_id)) = 'external_reviewer'
      and assigned_to = (select auth.uid())
      and status <> 'draft'
    )
  );

create policy submission_files_select_internal_member
  on public.submission_files
  for select
  to authenticated
  using (
    (select public.organization_role_for(org_id)) in ('owner_admin', 'manager')
    or (
      (select public.organization_role_for(org_id)) = 'staff'
      and exists (
        select 1
        from public.submissions submission
        where submission.id = submission_files.submission_id
          and submission.org_id = submission_files.org_id
          and submission.created_by = (select auth.uid())
      )
    )
    or (
      status = 'available'
      and (select public.organization_role_for(org_id)) = 'external_reviewer'
      and exists (
        select 1
        from public.submissions submission
        where submission.id = submission_files.submission_id
          and submission.org_id = submission_files.org_id
          and submission.assigned_to = (select auth.uid())
          and submission.status <> 'draft'
      )
    )
  );

create policy submission_comments_select_visible_submission
  on public.submission_comments
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.submissions submission
      where submission.id = submission_comments.submission_id
        and submission.org_id = submission_comments.org_id
        and (
          (select public.organization_role_for(submission.org_id))
            in ('owner_admin', 'manager')
          or (
            (select public.organization_role_for(submission.org_id)) = 'staff'
            and submission.created_by = (select auth.uid())
          )
          or (
            (select public.organization_role_for(submission.org_id))
              = 'external_reviewer'
            and submission.assigned_to = (select auth.uid())
            and submission.status <> 'draft'
          )
        )
    )
  );

create policy submission_activity_select_visible_submission
  on public.submission_activity_events
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.submissions submission
      where submission.id = submission_activity_events.submission_id
        and submission.org_id = submission_activity_events.org_id
        and (
          (select public.organization_role_for(submission.org_id))
            in ('owner_admin', 'manager')
          or (
            (select public.organization_role_for(submission.org_id)) = 'staff'
            and submission.created_by = (select auth.uid())
          )
          or (
            (select public.organization_role_for(submission.org_id))
              = 'external_reviewer'
            and submission.assigned_to = (select auth.uid())
            and submission.status <> 'draft'
          )
        )
    )
  );

create or replace function public.assert_internal_submission_actor(
  target_org_id uuid,
  target_actor_user_id uuid
)
returns public.organization_role
language plpgsql
security invoker
set search_path = ''
as $$
declare
  actor_role public.organization_role;
begin
  select membership.role
  into actor_role
  from public.organization_memberships membership
  where membership.org_id = target_org_id
    and membership.user_id = target_actor_user_id
    and membership.status = 'active'
  for share;

  if not found
      or actor_role not in ('owner_admin', 'manager', 'staff') then
    raise exception 'An active internal organization membership is required.'
      using errcode = '42501';
  end if;

  return actor_role;
end;
$$;

revoke all on function public.assert_internal_submission_actor(uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.assert_internal_submission_actor(uuid, uuid)
  to service_role;

create or replace function public.assert_internal_submission_review_manager(
  target_org_id uuid,
  target_actor_user_id uuid
)
returns public.organization_role
language plpgsql
security invoker
set search_path = ''
as $$
declare
  actor_role public.organization_role;
begin
  select membership.role
  into actor_role
  from public.organization_memberships membership
  where membership.org_id = target_org_id
    and membership.user_id = target_actor_user_id
    and membership.status = 'active'
  for share;

  if not found or actor_role not in ('owner_admin', 'manager') then
    raise exception 'Submission review requires an active manager membership.'
      using errcode = '42501';
  end if;

  return actor_role;
end;
$$;

revoke all on function public.assert_internal_submission_review_manager(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.assert_internal_submission_review_manager(uuid, uuid)
  to service_role;

create or replace function public.assign_internal_submission(
  target_org_id uuid,
  target_submission_id uuid,
  target_expected_revision integer,
  target_assignee_user_id uuid,
  target_actor_user_id uuid
)
returns public.submissions
language plpgsql
security invoker
set search_path = ''
as $$
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
$$;

create or replace function public.transition_internal_submission(
  target_org_id uuid,
  target_submission_id uuid,
  target_expected_revision integer,
  target_transition text,
  target_comment text,
  target_actor_user_id uuid
)
returns public.submissions
language plpgsql
security invoker
set search_path = ''
as $$
declare
  locked_submission public.submissions%rowtype;
  previous_status text;
  normalized_comment text;
  created_comment_id uuid;
  activity_event_type text;
  audit_action text;
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
    return locked_submission;
  end if;

  if locked_submission.revision <> target_expected_revision then
    raise exception 'Submission review has changed. Reload and try again.'
      using errcode = '40001';
  end if;

  if locked_submission.assigned_to is null
      or locked_submission.assigned_to <> target_actor_user_id then
    raise exception 'Only the assigned reviewer may make this decision.'
      using errcode = '42501';
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
  set status = target_transition,
      revision = submission.revision + 1,
      updated_by = target_actor_user_id,
      updated_at = now()
  where submission.id = target_submission_id
    and submission.org_id = target_org_id
  returning submission.* into locked_submission;

  activity_event_type := case target_transition
    when 'needs_changes' then 'changes_requested'
    else target_transition
  end;
  audit_action := case target_transition
    when 'needs_changes' then 'submission.changes_requested'
    else 'submission.' || target_transition
  end;

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
    activity_event_type,
    previous_status,
    target_transition,
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
    audit_action,
    'submission',
    target_submission_id,
    jsonb_strip_nulls(
      jsonb_build_object(
        'fromStatus', previous_status,
        'toStatus', target_transition,
        'commentId', created_comment_id,
        'submissionRevision', locked_submission.revision
      )
    )
  );

  return locked_submission;
end;
$$;

create or replace function public.create_internal_submission_comment(
  target_org_id uuid,
  target_submission_id uuid,
  target_comment_id uuid,
  target_body text,
  target_actor_user_id uuid
)
returns public.submission_comments
language plpgsql
security invoker
set search_path = ''
as $$
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
          and locked_submission.assigned_to = target_actor_user_id
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
$$;

create or replace function public.save_internal_submission_draft(
  target_org_id uuid,
  target_submission_id uuid,
  target_expected_revision integer,
  target_values jsonb,
  target_actor_user_id uuid
)
returns public.submissions
language plpgsql
security invoker
set search_path = ''
as $$
declare
  locked_submission public.submissions%rowtype;
begin
  if target_org_id is null
      or target_submission_id is null
      or target_actor_user_id is null
      or target_expected_revision is null
      or target_expected_revision < 1
      or target_values is null
      or jsonb_typeof(target_values) <> 'object' then
    raise exception 'Valid draft values and revision are required.'
      using errcode = '22023';
  end if;

  perform public.assert_internal_submission_actor(
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
    raise exception 'Submission draft was not found.'
      using errcode = 'P0002';
  end if;

  if locked_submission.created_by is null
      or locked_submission.created_by <> target_actor_user_id then
    raise exception 'Only the submission creator may edit this draft.'
      using errcode = '42501';
  end if;

  if locked_submission.status not in ('draft', 'needs_changes') then
    raise exception 'Submission status is not editable.'
      using errcode = 'P0001';
  end if;

  if locked_submission.revision <> target_expected_revision then
    if locked_submission.revision = target_expected_revision + 1
        and locked_submission.values = target_values
        and locked_submission.updated_by = target_actor_user_id then
      return locked_submission;
    end if;

    raise exception 'Submission draft has changed. Reload and try again.'
      using errcode = '40001';
  end if;

  perform public.validate_internal_submission_values(
    locked_submission.template_snapshot,
    target_values
  );

  update public.submissions submission
  set values = target_values,
      revision = submission.revision + 1,
      updated_by = target_actor_user_id,
      updated_at = now()
  where submission.id = target_submission_id
    and submission.org_id = target_org_id
  returning submission.* into locked_submission;

  return locked_submission;
end;
$$;

create or replace function public.submit_internal_submission(
  target_org_id uuid,
  target_submission_id uuid,
  target_expected_revision integer,
  target_values jsonb,
  target_actor_user_id uuid
)
returns public.submissions
language plpgsql
security invoker
set search_path = ''
as $$
declare
  locked_submission public.submissions%rowtype;
  previous_status text;
  submission_event_type text;
  audit_action text;
  required_block jsonb;
  required_value jsonb;
begin
  if target_org_id is null
      or target_submission_id is null
      or target_actor_user_id is null
      or target_expected_revision is null
      or target_expected_revision < 1
      or target_values is null
      or jsonb_typeof(target_values) <> 'object' then
    raise exception 'Valid submission values and revision are required.'
      using errcode = '22023';
  end if;

  perform public.assert_internal_submission_actor(
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

  if locked_submission.created_by is null
      or locked_submission.created_by <> target_actor_user_id then
    raise exception 'Only the submission creator may submit this draft.'
      using errcode = '42501';
  end if;

  if locked_submission.status = 'submitted' then
    if locked_submission.values = target_values
        and locked_submission.submitted_by = target_actor_user_id then
      return locked_submission;
    end if;

    raise exception 'Submission status cannot be submitted again.'
      using errcode = 'P0001';
  end if;

  if locked_submission.status not in ('draft', 'needs_changes') then
    raise exception 'Submission status cannot be submitted.'
      using errcode = 'P0001';
  end if;

  if locked_submission.revision <> target_expected_revision then
    raise exception 'Submission draft has changed. Reload and try again.'
      using errcode = '40001';
  end if;

  perform public.validate_internal_submission_values(
    locked_submission.template_snapshot,
    target_values
  );

  if exists (
    select 1
    from public.submission_files submission_file
    where submission_file.submission_id = target_submission_id
      and submission_file.org_id = target_org_id
      and submission_file.status = 'upload_pending'
  ) then
    raise exception 'Wait for pending file uploads before submitting.'
      using errcode = 'P0001';
  end if;

  for required_block in
    select block
    from (
      select jsonb_array_elements(
        coalesce(locked_submission.template_snapshot #> '{sections,header,blocks}', '[]'::jsonb)
      ) as block
      union all
      select jsonb_array_elements(
        coalesce(locked_submission.template_snapshot #> '{sections,body,blocks}', '[]'::jsonb)
      ) as block
      union all
      select jsonb_array_elements(
        coalesce(locked_submission.template_snapshot #> '{sections,footer,blocks}', '[]'::jsonb)
      ) as block
    ) blocks
    where coalesce((block ->> 'required')::boolean, false)
  loop
    if required_block ->> 'type' = 'file_field' then
      if not exists (
        select 1
        from public.submission_files submission_file
        where submission_file.submission_id = target_submission_id
          and submission_file.org_id = target_org_id
          and submission_file.field_key = required_block ->> 'fieldKey'
          and submission_file.status = 'available'
      ) then
        raise exception 'Required submission file % is missing.', required_block ->> 'label'
          using errcode = '22023';
      end if;

      continue;
    end if;

    required_value := target_values -> (required_block ->> 'fieldKey');

    if required_block ->> 'type' = 'checkbox_field' then
      if required_value is null
          or jsonb_typeof(required_value) <> 'boolean'
          or required_value <> 'true'::jsonb then
        raise exception 'Required submission field % is incomplete.', required_block ->> 'label'
          using errcode = '22023';
      end if;
    elsif required_value is null
        or jsonb_typeof(required_value) <> 'string'
        or btrim(required_value #>> '{}') = '' then
      raise exception 'Required submission field % is incomplete.', required_block ->> 'label'
        using errcode = '22023';
    end if;
  end loop;

  previous_status := locked_submission.status;
  submission_event_type := case
    when previous_status = 'draft' then 'submitted'
    else 'resubmitted'
  end;
  audit_action := case
    when previous_status = 'draft' then 'submission.submitted'
    else 'submission.resubmitted'
  end;

  update public.submissions submission
  set values = target_values,
      status = 'submitted',
      revision = submission.revision + 1,
      updated_by = target_actor_user_id,
      submitted_by = target_actor_user_id,
      updated_at = now(),
      submitted_at = now()
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
    submission_event_type,
    previous_status,
    'submitted',
    locked_submission.assigned_to,
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
    audit_action,
    'submission',
    target_submission_id,
    jsonb_build_object(
      'templateId', locked_submission.template_id,
      'templateRevision', locked_submission.template_revision,
      'submissionRevision', locked_submission.revision
    )
  );

  return locked_submission;
end;
$$;

create or replace function public.lock_editable_internal_submission(
  target_org_id uuid,
  target_submission_id uuid,
  target_actor_user_id uuid
)
returns public.submissions
language plpgsql
security invoker
set search_path = ''
as $$
declare
  locked_submission public.submissions%rowtype;
begin
  perform public.assert_internal_submission_actor(
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
    raise exception 'Submission draft was not found.'
      using errcode = 'P0002';
  end if;

  if locked_submission.created_by is null
      or locked_submission.created_by <> target_actor_user_id then
    raise exception 'Only the submission creator may change draft files.'
      using errcode = '42501';
  end if;

  if locked_submission.status not in ('draft', 'needs_changes') then
    raise exception 'Files cannot be changed in this submission status.'
      using errcode = 'P0001';
  end if;

  return locked_submission;
end;
$$;

revoke all on function public.lock_editable_internal_submission(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.lock_editable_internal_submission(uuid, uuid, uuid)
  to service_role;

create or replace function public.allocate_internal_submission_file(
  target_org_id uuid,
  target_submission_id uuid,
  target_expected_revision integer,
  target_file_id uuid,
  target_field_key text,
  target_original_filename text,
  target_safe_filename text,
  target_content_type text,
  target_byte_size bigint,
  target_storage_key text,
  target_expected_checksum_sha256 text,
  target_actor_user_id uuid
)
returns public.submission_files
language plpgsql
security invoker
set search_path = ''
as $$
declare
  locked_submission public.submissions%rowtype;
  prepared_file public.submission_files%rowtype;
  expected_storage_key text;
  file_block jsonb;
begin
  if target_org_id is null
      or target_submission_id is null
      or target_expected_revision is null
      or target_expected_revision < 1
      or target_file_id is null
      or target_field_key is null
      or target_original_filename is null
      or target_safe_filename is null
      or target_content_type is null
      or target_byte_size is null
      or target_storage_key is null
      or target_expected_checksum_sha256 is null
      or target_expected_checksum_sha256 !~ '^[0-9a-f]{64}$'
      or target_actor_user_id is null then
    raise exception 'Complete submission file metadata is required.'
      using errcode = '22023';
  end if;

  locked_submission := public.lock_editable_internal_submission(
    target_org_id,
    target_submission_id,
    target_actor_user_id
  );

  if locked_submission.revision <> target_expected_revision then
    raise exception 'Submission draft has changed. Reload and try again.'
      using errcode = '40001';
  end if;

  select block
  into file_block
  from (
    select jsonb_array_elements(
      coalesce(locked_submission.template_snapshot #> '{sections,header,blocks}', '[]'::jsonb)
    ) as block
    union all
    select jsonb_array_elements(
      coalesce(locked_submission.template_snapshot #> '{sections,body,blocks}', '[]'::jsonb)
    ) as block
    union all
    select jsonb_array_elements(
      coalesce(locked_submission.template_snapshot #> '{sections,footer,blocks}', '[]'::jsonb)
    ) as block
  ) blocks
  where block ->> 'type' = 'file_field'
    and block ->> 'fieldKey' = target_field_key
  limit 1;

  if file_block is null then
    raise exception 'Submission file field was not found.'
      using errcode = '22023';
  end if;

  if target_original_filename <> btrim(target_original_filename)
      or char_length(target_original_filename) not between 1 and 240
      or char_length(target_safe_filename) not between 1 and 180
      or target_safe_filename !~ '^[A-Za-z0-9][A-Za-z0-9._-]*$'
      or target_content_type not in (
        'application/pdf',
        'image/jpeg',
        'image/png',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'text/csv'
      )
      or target_byte_size not between 1 and 20971520
      or not (case target_content_type
        when 'application/pdf' then lower(target_safe_filename) ~ '\.pdf$'
        when 'image/jpeg' then lower(target_safe_filename) ~ '\.(jpg|jpeg)$'
        when 'image/png' then lower(target_safe_filename) ~ '\.png$'
        when 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
          then lower(target_safe_filename) ~ '\.docx$'
        when 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
          then lower(target_safe_filename) ~ '\.xlsx$'
        when 'text/csv' then lower(target_safe_filename) ~ '\.csv$'
        else false
      end) then
    raise exception 'Submission file metadata is invalid.'
      using errcode = '22023';
  end if;

  expected_storage_key :=
    'organizations/' || target_org_id::text ||
    '/submissions/' || target_submission_id::text ||
    '/files/' || target_field_key ||
    '/' || target_file_id::text ||
    '/' || target_safe_filename;

  if target_storage_key is distinct from expected_storage_key then
    raise exception 'Submission file storage key is invalid.'
      using errcode = '22023';
  end if;

  select submission_file.*
  into prepared_file
  from public.submission_files submission_file
  where submission_file.submission_id = target_submission_id
    and submission_file.org_id = target_org_id
    and submission_file.field_key = target_field_key
    and submission_file.status in ('upload_pending', 'available')
  for update;

  if found then
    if prepared_file.id = target_file_id
        and prepared_file.status = 'upload_pending'
        and prepared_file.storage_key = target_storage_key
        and prepared_file.original_filename = target_original_filename
        and prepared_file.safe_filename = target_safe_filename
        and prepared_file.content_type = target_content_type
        and prepared_file.byte_size = target_byte_size
        and prepared_file.expected_checksum_sha256 = target_expected_checksum_sha256
        and prepared_file.uploaded_by = target_actor_user_id then
      return prepared_file;
    end if;

    raise exception 'This submission field already has an active file allocation.'
      using errcode = '23505';
  end if;

  insert into public.submission_files (
    id,
    org_id,
    submission_id,
    field_key,
    status,
    storage_key,
    original_filename,
    safe_filename,
    content_type,
    byte_size,
    expected_checksum_sha256,
    uploaded_by
  )
  values (
    target_file_id,
    target_org_id,
    target_submission_id,
    target_field_key,
    'upload_pending',
    target_storage_key,
    target_original_filename,
    target_safe_filename,
    target_content_type,
    target_byte_size,
    target_expected_checksum_sha256,
    target_actor_user_id
  )
  returning * into prepared_file;

  return prepared_file;
end;
$$;

create or replace function public.complete_internal_submission_file(
  target_org_id uuid,
  target_submission_id uuid,
  target_file_id uuid,
  target_storage_key text,
  target_content_type text,
  target_byte_size bigint,
  target_checksum_sha256 text,
  target_actor_user_id uuid
)
returns public.submission_files
language plpgsql
security invoker
set search_path = ''
as $$
declare
  locked_submission public.submissions%rowtype;
  locked_file public.submission_files%rowtype;
begin
  if target_org_id is null
      or target_submission_id is null
      or target_file_id is null
      or target_storage_key is null
      or target_content_type is null
      or target_byte_size is null
      or target_checksum_sha256 is null
      or target_checksum_sha256 !~ '^[0-9a-f]{64}$'
      or target_actor_user_id is null then
    raise exception 'Verified submission file metadata is required.'
      using errcode = '22023';
  end if;

  locked_submission := public.lock_editable_internal_submission(
    target_org_id,
    target_submission_id,
    target_actor_user_id
  );

  select submission_file.*
  into locked_file
  from public.submission_files submission_file
  where submission_file.id = target_file_id
    and submission_file.submission_id = target_submission_id
    and submission_file.org_id = target_org_id
  for update;

  if not found then
    raise exception 'Submission file allocation was not found.'
      using errcode = 'P0002';
  end if;

  if locked_file.storage_key <> target_storage_key
      or locked_file.content_type <> target_content_type
      or locked_file.byte_size <> target_byte_size then
    raise exception 'Uploaded object metadata does not match its allocation.'
      using errcode = '22023';
  end if;

  if locked_file.status = 'available' then
    if locked_file.checksum_sha256 = target_checksum_sha256 then
      return locked_file;
    end if;

    raise exception 'Completed submission file metadata cannot change.'
      using errcode = 'P0001';
  end if;

  if locked_file.status <> 'upload_pending' then
    raise exception 'Superseded submission files cannot be completed.'
      using errcode = 'P0001';
  end if;

  if locked_file.expected_checksum_sha256 is null
      or locked_file.expected_checksum_sha256 <> target_checksum_sha256 then
    raise exception 'Uploaded object checksum does not match its allocation.'
      using errcode = '22023';
  end if;

  update public.submission_files submission_file
  set status = 'available',
      checksum_sha256 = target_checksum_sha256,
      updated_at = now(),
      available_at = now()
  where submission_file.id = target_file_id
    and submission_file.submission_id = target_submission_id
    and submission_file.org_id = target_org_id
  returning submission_file.* into locked_file;

  return locked_file;
end;
$$;

create or replace function public.supersede_internal_submission_file(
  target_org_id uuid,
  target_submission_id uuid,
  target_file_id uuid,
  target_actor_user_id uuid
)
returns public.submission_files
language plpgsql
security invoker
set search_path = ''
as $$
declare
  locked_submission public.submissions%rowtype;
  locked_file public.submission_files%rowtype;
begin
  if target_org_id is null
      or target_submission_id is null
      or target_file_id is null
      or target_actor_user_id is null then
    raise exception 'Valid submission file identifiers are required.'
      using errcode = '22023';
  end if;

  perform public.assert_internal_submission_actor(
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
    raise exception 'Submission draft was not found.'
      using errcode = 'P0002';
  end if;

  if locked_submission.created_by is null
      or locked_submission.created_by <> target_actor_user_id then
    raise exception 'Only the submission creator may replace draft files.'
      using errcode = '42501';
  end if;

  select submission_file.*
  into locked_file
  from public.submission_files submission_file
  where submission_file.id = target_file_id
    and submission_file.submission_id = target_submission_id
    and submission_file.org_id = target_org_id
  for update;

  if not found then
    raise exception 'Submission file allocation was not found.'
      using errcode = 'P0002';
  end if;

  if locked_file.status = 'superseded' then
    return locked_file;
  end if;

  if locked_submission.status not in ('draft', 'needs_changes') then
    raise exception 'Files cannot be replaced in this submission status.'
      using errcode = 'P0001';
  end if;

  update public.submission_files submission_file
  set status = 'superseded',
      superseded_by = target_actor_user_id,
      superseded_at = now(),
      updated_at = now()
  where submission_file.id = target_file_id
    and submission_file.submission_id = target_submission_id
    and submission_file.org_id = target_org_id
  returning submission_file.* into locked_file;

  return locked_file;
end;
$$;

create or replace function public.record_internal_submission_file_upload_window(
  target_org_id uuid,
  target_submission_id uuid,
  target_file_id uuid,
  target_cleanup_after timestamptz,
  target_actor_user_id uuid
)
returns public.submission_files
language plpgsql
security invoker
set search_path = ''
as $$
declare
  locked_submission public.submissions%rowtype;
  locked_file public.submission_files%rowtype;
begin
  if target_org_id is null
      or target_submission_id is null
      or target_file_id is null
      or target_cleanup_after is null
      or target_cleanup_after <= now()
      or target_cleanup_after > now() + interval '25 minutes'
      or target_actor_user_id is null then
    raise exception 'Valid submission upload window metadata is required.'
      using errcode = '22023';
  end if;

  locked_submission := public.lock_editable_internal_submission(
    target_org_id,
    target_submission_id,
    target_actor_user_id
  );

  select submission_file.*
  into locked_file
  from public.submission_files submission_file
  where submission_file.id = target_file_id
    and submission_file.submission_id = target_submission_id
    and submission_file.org_id = target_org_id
  for update;

  if not found then
    raise exception 'Submission file allocation was not found.'
      using errcode = 'P0002';
  end if;

  if locked_file.status <> 'upload_pending' then
    raise exception 'Only pending submission uploads may be renewed.'
      using errcode = 'P0001';
  end if;

  if target_cleanup_after > locked_file.cleanup_after then
    update public.submission_files submission_file
    set cleanup_after = target_cleanup_after,
        updated_at = now()
    where submission_file.id = target_file_id
      and submission_file.submission_id = target_submission_id
      and submission_file.org_id = target_org_id
    returning submission_file.* into locked_file;
  end if;

  return locked_file;
end;
$$;

insert into public.submission_activity_events (
  id,
  org_id,
  submission_id,
  actor_user_id,
  event_type,
  from_status,
  to_status,
  submission_revision,
  created_at
)
select
  gen_random_uuid(),
  submission.org_id,
  submission.id,
  submission.submitted_by,
  'submitted',
  'draft',
  'submitted',
  submission.revision,
  submission.submitted_at
from public.submissions submission
where submission.status = 'submitted';

revoke all on function public.assign_internal_submission(
  uuid,
  uuid,
  integer,
  uuid,
  uuid
) from public, anon, authenticated, service_role;

revoke all on function public.transition_internal_submission(
  uuid,
  uuid,
  integer,
  text,
  text,
  uuid
) from public, anon, authenticated, service_role;

revoke all on function public.create_internal_submission_comment(
  uuid,
  uuid,
  uuid,
  text,
  uuid
) from public, anon, authenticated, service_role;

revoke all on function public.save_internal_submission_draft(
  uuid,
  uuid,
  integer,
  jsonb,
  uuid
) from public, anon, authenticated, service_role;

revoke all on function public.submit_internal_submission(
  uuid,
  uuid,
  integer,
  jsonb,
  uuid
) from public, anon, authenticated, service_role;

revoke all on function public.allocate_internal_submission_file(
  uuid,
  uuid,
  integer,
  uuid,
  text,
  text,
  text,
  text,
  bigint,
  text,
  text,
  uuid
) from public, anon, authenticated, service_role;

revoke all on function public.complete_internal_submission_file(
  uuid,
  uuid,
  uuid,
  text,
  text,
  bigint,
  text,
  uuid
) from public, anon, authenticated, service_role;

revoke all on function public.supersede_internal_submission_file(
  uuid,
  uuid,
  uuid,
  uuid
) from public, anon, authenticated, service_role;

revoke all on function public.record_internal_submission_file_upload_window(
  uuid,
  uuid,
  uuid,
  timestamptz,
  uuid
) from public, anon, authenticated, service_role;

grant execute on function public.assign_internal_submission(
  uuid,
  uuid,
  integer,
  uuid,
  uuid
) to service_role;

grant execute on function public.transition_internal_submission(
  uuid,
  uuid,
  integer,
  text,
  text,
  uuid
) to service_role;

grant execute on function public.create_internal_submission_comment(
  uuid,
  uuid,
  uuid,
  text,
  uuid
) to service_role;

grant execute on function public.save_internal_submission_draft(
  uuid,
  uuid,
  integer,
  jsonb,
  uuid
) to service_role;

grant execute on function public.submit_internal_submission(
  uuid,
  uuid,
  integer,
  jsonb,
  uuid
) to service_role;

grant execute on function public.allocate_internal_submission_file(
  uuid,
  uuid,
  integer,
  uuid,
  text,
  text,
  text,
  text,
  bigint,
  text,
  text,
  uuid
) to service_role;

grant execute on function public.complete_internal_submission_file(
  uuid,
  uuid,
  uuid,
  text,
  text,
  bigint,
  text,
  uuid
) to service_role;

grant execute on function public.supersede_internal_submission_file(
  uuid,
  uuid,
  uuid,
  uuid
) to service_role;

grant execute on function public.record_internal_submission_file_upload_window(
  uuid,
  uuid,
  uuid,
  timestamptz,
  uuid
) to service_role;

comment on column public.submissions.assigned_to is
  'Current active review assignee. The id may become null if the profile is deleted.';

comment on column public.submissions.assigned_by is
  'Manager who most recently assigned the submission. The id may become null if deleted.';

comment on column public.submissions.assigned_at is
  'Timestamp of the most recent assignment. Retained across requested-change cycles.';

comment on table public.submission_comments is
  'Immutable tenant-scoped discussion and required review-decision comments.';

comment on table public.submission_activity_events is
  'Immutable submission workflow history written in the same transaction as each mutation.';

notify pgrst, 'reload schema';
