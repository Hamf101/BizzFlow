-- Exercises several reviewers on one submission against a real database: who
-- may name reviewers, that each decision counts toward the whole, that a change
-- request blocks approval until the assigner sets it aside, that "at least N"
-- works, that a resubmission starts the decisions over, and that a reviewer who
-- has decided cannot be removed. Creates isolated synthetic rows inside one
-- statement; any failed check rolls everything back.
do $$
<<submission_reviewers_test>>
declare
  owner_id uuid := gen_random_uuid();
  first_id uuid := gen_random_uuid();
  second_id uuid := gen_random_uuid();
  third_id uuid := gen_random_uuid();
  staff_id uuid := gen_random_uuid();
  external_id uuid := gen_random_uuid();
  organization_id uuid := gen_random_uuid();
  template_id uuid := gen_random_uuid();
  all_submission uuid := gen_random_uuid();
  some_submission uuid := gen_random_uuid();
  again_submission uuid := gen_random_uuid();
  outside_submission uuid := gen_random_uuid();
  settle_submission uuid := gen_random_uuid();
  settle_again uuid := gen_random_uuid();
  blank constant jsonb := '{"schemaVersion":3,"branding":{},"blocks":[],"layout":{},"sections":[],"fieldGroups":[],"blockRules":[]}';
  snapshot constant jsonb := '{"schemaVersion":3,"branding":{},"blocks":[],"layout":{},"sections":[],"fieldGroups":[],"blockRules":[]}';
  result public.submissions%rowtype;
begin
  insert into auth.users (id, email, created_at, updated_at)
  select member.id, 'rev-' || replace(member.id::text, '-', '') || '@example.invalid', now(), now()
  from unnest(array[owner_id, first_id, second_id, third_id, staff_id, external_id]) as member(id);

  insert into public.profiles (id, email, full_name)
  select member.id, 'rev-' || replace(member.id::text, '-', '') || '@example.invalid', 'Reviewer verification'
  from unnest(array[owner_id, first_id, second_id, third_id, staff_id, external_id]) as member(id);

  insert into public.organizations (id, name, slug, created_by)
  values (organization_id, 'Reviewer verification', 'rev-' || replace(organization_id::text, '-', ''), owner_id);

  insert into public.organization_memberships (org_id, user_id, role, status)
  select organization_id, owner_id, 'owner_admin', 'active'
  where not exists (
    select 1 from public.organization_memberships membership
    where membership.org_id = organization_id and membership.user_id = owner_id
  );

  insert into public.organization_memberships (org_id, user_id, role, status)
  values
    (organization_id, first_id, 'manager', 'active'),
    (organization_id, second_id, 'manager', 'active'),
    (organization_id, third_id, 'manager', 'active'),
    (organization_id, staff_id, 'staff', 'active'),
    (organization_id, external_id, 'external_reviewer', 'active');

  insert into public.document_templates (id, org_id, title, status, revision, content, created_by, updated_by, published_by, published_at)
  values (template_id, organization_id, 'Reviewer verification', 'published', 1, blank, owner_id, owner_id, owner_id, now());

  insert into public.submissions (
    id, org_id, title, template_id, template_revision, template_snapshot, values, status,
    created_by, updated_by, submitted_by, submitted_at
  )
  select submission_id, organization_id, 'Under review ' || position, template_id, 1, snapshot, '{}', 'submitted',
         staff_id, staff_id, staff_id, now()
  from (values (all_submission, 1), (some_submission, 2), (again_submission, 3), (outside_submission, 4), (settle_submission, 5), (settle_again, 6)) as made(submission_id, position);

  -- Everything from here runs as the app does: as the service role, not a superuser.
  set local role service_role;

  -- Only owners and managers name reviewers, and only owners and managers can be named.
  begin
    perform public.set_submission_reviewers(organization_id, all_submission, 1, array[first_id], null, staff_id);
    raise exception 'Staff named a reviewer.';
  exception when sqlstate '42501' then null;
  end;

  begin
    perform public.set_submission_reviewers(organization_id, all_submission, 1, array[first_id, staff_id], null, first_id);
    raise exception 'A staff member was named as a reviewer.';
  exception when sqlstate '22023' then null;
  end;

  begin
    perform public.set_submission_reviewers(organization_id, all_submission, 1, array[first_id, second_id], 3, first_id);
    raise exception 'More approvals than reviewers were asked for.';
  exception when sqlstate '22023' then null;
  end;

  begin
    perform public.set_submission_reviewers(organization_id, all_submission, 7, array[first_id], null, first_id);
    raise exception 'A stale revision named reviewers.';
  exception when sqlstate '40001' then null;
  end;

  -- Naming three reviewers starts the review; the first named leads; everyone must approve.
  select * into result from public.set_submission_reviewers(
    organization_id, all_submission, 1, array[first_id, second_id, third_id], null, first_id);

  if result.status <> 'in_review' or result.revision <> 2 or result.assigned_to <> first_id
      or result.assigned_by <> first_id or result.required_approvals is not null then
    raise exception 'Naming reviewers did not start the review with the first as lead.';
  end if;

  if (select count(*) from public.submission_reviewers where submission_id = all_submission) <> 3 then
    raise exception 'Three reviewers were not recorded.';
  end if;

  select * into result from public.set_submission_reviewers(
    organization_id, all_submission, 1, array[first_id, second_id, third_id], null, first_id);
  if result.revision <> 2 then
    raise exception 'Naming the same reviewers again changed the submission.';
  end if;

  -- Someone who is not a reviewer cannot decide, even a manager.
  begin
    perform public.transition_internal_submission(organization_id, all_submission, 2, 'approved', null, owner_id);
    raise exception 'A manager who is not a reviewer decided.';
  exception when sqlstate '42501' then null;
  end;

  -- One approval of three does not approve it. It counts once, and the retry changes nothing.
  select * into result from public.transition_internal_submission(
    organization_id, all_submission, 2, 'approved', null, second_id);
  if result.status <> 'in_review' or result.revision <> 3 then
    raise exception 'One of three approvals moved the submission.';
  end if;
  select * into result from public.transition_internal_submission(
    organization_id, all_submission, 2, 'approved', null, second_id);
  if result.revision <> 3 then
    raise exception 'The approval retry changed the submission.';
  end if;

  -- Someone who approved cannot be removed.
  begin
    perform public.set_submission_reviewers(organization_id, all_submission, 3, array[first_id, third_id], null, first_id);
    raise exception 'A reviewer who approved was removed.' using errcode = 'XX001';
  exception when sqlstate 'P0001' then null;
  end;

  -- A change request blocks: the submission goes back to be fixed and cannot be approved.
  select * into result from public.transition_internal_submission(
    organization_id, all_submission, 3, 'needs_changes', 'Missing the signed copy', third_id);
  if result.status <> 'needs_changes' or result.revision <> 4 then
    raise exception 'A change request did not block the submission.';
  end if;

  begin
    perform public.transition_internal_submission(organization_id, all_submission, 4, 'approved', null, first_id);
    raise exception 'Approval got past a change request.' using errcode = 'XX001';
  exception when sqlstate 'P0001' then null;
  end;

  -- Only whoever assigned the reviewers may set it aside, and with a note.
  begin
    perform public.dismiss_submission_changes_request(organization_id, all_submission, 4, third_id, 'Fine', false, second_id);
    raise exception 'A reviewer who did not assign the others set a change request aside.';
  exception when sqlstate '42501' then null;
  end;

  begin
    perform public.dismiss_submission_changes_request(organization_id, all_submission, 4, third_id, '  ', false, first_id);
    raise exception 'A change request was set aside without a note.';
  exception when sqlstate '22023' then null;
  end;

  -- Setting it aside, without approving, puts it back in review. The reviewer
  -- set aside no longer counts, so the assigner's own approval is the last one needed.
  select * into result from public.dismiss_submission_changes_request(
    organization_id, all_submission, 4, third_id, 'Seen the signed copy, it is attached', false, first_id);
  if result.status <> 'in_review' then
    raise exception 'Setting the change request aside did not put the submission back in review.';
  end if;

  if (select decision from public.submission_reviewers where submission_id = all_submission and user_id = third_id) <> 'dismissed' then
    raise exception 'The dismissal was not recorded.';
  end if;

  select * into result from public.transition_internal_submission(
    organization_id, all_submission, result.revision, 'approved', null, first_id);
  if result.status <> 'approved' then
    raise exception 'Everyone still counting approved, yet the submission was not approved.';
  end if;

  -- The record of who did what.
  if not exists (
    select 1 from public.submission_activity_events activity
    where activity.submission_id = all_submission and activity.event_type = 'changes_dismissed'
      and activity.assignee_user_id = third_id and activity.comment_id is not null
  ) or not exists (
    select 1 from public.submission_activity_events activity
    where activity.submission_id = all_submission and activity.event_type = 'review_approved'
      and activity.actor_user_id = second_id
  ) then
    raise exception 'The decisions left no activity evidence.';
  end if;

  -- "At least two of three": two approvals are enough, and a reviewer may be taken off before deciding.
  select * into result from public.set_submission_reviewers(
    organization_id, some_submission, 1, array[first_id, second_id, third_id], 2, second_id);
  if result.assigned_to <> first_id or result.required_approvals <> 2 then
    raise exception 'The lead or the number of approvals needed was not kept.';
  end if;

  select * into result from public.transition_internal_submission(
    organization_id, some_submission, result.revision, 'approved', null, first_id);
  if result.status <> 'in_review' then
    raise exception 'One of two needed approvals approved the submission.';
  end if;
  select * into result from public.transition_internal_submission(
    organization_id, some_submission, result.revision, 'approved', null, third_id);
  if result.status <> 'approved' then
    raise exception 'Two approvals of "at least two" did not approve the submission.';
  end if;

  -- Sent back and resubmitted, every decision starts over, and naming the same
  -- reviewers again starts the review again. A reviewer who has not decided can be taken off, and the lead passes on.
  select * into result from public.set_submission_reviewers(
    organization_id, again_submission, 1, array[first_id, second_id], null, first_id);
  select * into result from public.transition_internal_submission(
    organization_id, again_submission, result.revision, 'approved', null, first_id);
  select * into result from public.transition_internal_submission(
    organization_id, again_submission, result.revision, 'needs_changes', 'Please redo page two', second_id);

  -- The submitter resubmits (a direct write, which only the superuser may make).
  reset role;
  update public.submissions
  set status = 'submitted', submitted_by = staff_id, submitted_at = now(),
      revision = revision + 1, updated_by = staff_id, updated_at = now()
  where id = again_submission
  returning * into result;
  set local role service_role;

  if exists (select 1 from public.submission_reviewers where submission_id = again_submission and decision <> 'pending') then
    raise exception 'A resubmission kept the earlier decisions.';
  end if;

  select * into result from public.set_submission_reviewers(
    organization_id, again_submission, result.revision, array[first_id, second_id], null, first_id);
  if result.status <> 'in_review' then
    raise exception 'Naming the reviewers again did not restart the review.';
  end if;

  select * into result from public.set_submission_reviewers(
    organization_id, again_submission, result.revision, array[second_id], null, first_id);
  if result.assigned_to <> second_id
      or exists (select 1 from public.submission_reviewers where submission_id = again_submission and user_id = first_id) then
    raise exception 'Taking the lead off did not pass the lead on.';
  end if;

  -- An external reviewer is a reviewer like any other: named, counted, able to
  -- comment and to approve, but not to reject.
  select * into result from public.set_submission_reviewers(
    organization_id, outside_submission, 1, array[first_id, external_id], null, first_id);
  if not exists (select 1 from public.submission_reviewers where submission_id = outside_submission and user_id = external_id) then
    raise exception 'An external reviewer could not be named.';
  end if;

  perform public.create_internal_submission_comment(
    organization_id, outside_submission, gen_random_uuid(), 'Looks fine from outside', external_id);

  begin
    perform public.transition_internal_submission(organization_id, outside_submission, result.revision, 'rejected', 'No', external_id);
    raise exception 'An external reviewer rejected a submission.' using errcode = 'XX001';
  exception when sqlstate '42501' then null;
  end;

  select * into result from public.transition_internal_submission(
    organization_id, outside_submission, result.revision, 'approved', null, external_id);
  if result.status <> 'in_review' then
    raise exception 'The external reviewer''s approval finished the review alone.';
  end if;

  select * into result from public.transition_internal_submission(
    organization_id, outside_submission, result.revision, 'approved', null, first_id);
  if result.status <> 'approved' then
    raise exception 'Both reviewers approving did not approve the submission.';
  end if;

  -- Everyone must approve, one reviewer asks for changes, and the person who
  -- assigned them sets it aside and approves: that settles it without them.
  select * into result from public.set_submission_reviewers(
    organization_id, settle_submission, 1, array[first_id, second_id], null, first_id);
  select * into result from public.transition_internal_submission(
    organization_id, settle_submission, result.revision, 'needs_changes', 'Not convinced', second_id);
  select * into result from public.dismiss_submission_changes_request(
    organization_id, settle_submission, result.revision, second_id, 'Checked it myself', true, first_id);
  if result.status <> 'approved' then
    raise exception 'Setting the only change request aside and approving did not approve (status %).', result.status;
  end if;

  -- When everyone still counting has already approved, setting the change
  -- request aside is enough on its own.
  select * into result from public.set_submission_reviewers(
    organization_id, settle_again, 1, array[first_id, second_id], null, first_id);
  select * into result from public.transition_internal_submission(
    organization_id, settle_again, result.revision, 'approved', null, first_id);
  select * into result from public.transition_internal_submission(
    organization_id, settle_again, result.revision, 'needs_changes', 'Not convinced', second_id);
  select * into result from public.dismiss_submission_changes_request(
    organization_id, settle_again, result.revision, second_id, 'Checked it myself', false, first_id);
  if result.status <> 'approved' then
    raise exception 'Nothing was left to wait for, yet the submission stayed %.', result.status;
  end if;

  -- Signed-in users reach none of it directly.
  if has_table_privilege('authenticated', 'public.submission_reviewers', 'select') then
    raise exception 'Signed-in users can read the reviewers table directly.';
  end if;

  -- Removing a submission removes its reviewers.
  reset role;
  delete from public.submissions where id = again_submission;
  if exists (select 1 from public.submission_reviewers where submission_id = again_submission) then
    raise exception 'Reviewers outlived their submission.';
  end if;

  delete from public.organizations where id = organization_id;
  delete from auth.users where id in (owner_id, first_id, second_id, third_id, staff_id, external_id);
end;
$$;
