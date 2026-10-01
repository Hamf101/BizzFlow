-- Exercises sharing a submission and reviewers' suggested answers against a
-- real database: who may share, that someone it was shared with can comment and
-- hold it up but never approve or count toward approval, that naming them a
-- reviewer lets them approve, and that a suggestion changes an answer only when
-- the person who submitted it accepts. Creates isolated synthetic rows inside
-- one statement; any failed check rolls everything back.
do $$
<<submission_sharing_test>>
declare
  owner_id uuid := gen_random_uuid();
  manager_id uuid := gen_random_uuid();
  staff_id uuid := gen_random_uuid();
  colleague_id uuid := gen_random_uuid();
  external_id uuid := gen_random_uuid();
  organization_id uuid := gen_random_uuid();
  template_id uuid := gen_random_uuid();
  shared_submission uuid := gen_random_uuid();
  promoted_submission uuid := gen_random_uuid();
  draft_submission uuid := gen_random_uuid();
  blank constant jsonb := '{"schemaVersion":3,"branding":{},"blocks":[],"layout":{},"sections":[],"fieldGroups":[],"blockRules":[]}';
  form constant jsonb := '{"schemaVersion":3,"branding":{},"blocks":[{"id":"b-total","type":"text_field","fieldKey":"total","label":"Total","required":false,"placeholder":null,"multiline":false},{"id":"b-signed","type":"checkbox_field","fieldKey":"signed","label":"Signed","required":false,"checkedByDefault":false}],"layout":{},"sections":[],"fieldGroups":[],"blockRules":[]}';
  result public.submissions%rowtype;
  added uuid[];
  suggested integer;
  first_suggestion uuid;
  second_suggestion uuid;
begin
  insert into auth.users (id, email, created_at, updated_at)
  select member.id, 'share-' || replace(member.id::text, '-', '') || '@example.invalid', now(), now()
  from unnest(array[owner_id, manager_id, staff_id, colleague_id, external_id]) as member(id);

  insert into public.profiles (id, email, full_name)
  select member.id, 'share-' || replace(member.id::text, '-', '') || '@example.invalid', 'Sharing verification'
  from unnest(array[owner_id, manager_id, staff_id, colleague_id, external_id]) as member(id);

  insert into public.organizations (id, name, slug, created_by)
  values (organization_id, 'Sharing verification', 'share-' || replace(organization_id::text, '-', ''), owner_id);

  insert into public.organization_memberships (org_id, user_id, role, status)
  select organization_id, owner_id, 'owner_admin', 'active'
  where not exists (
    select 1 from public.organization_memberships membership
    where membership.org_id = organization_id and membership.user_id = owner_id
  );

  insert into public.organization_memberships (org_id, user_id, role, status)
  values
    (organization_id, manager_id, 'manager', 'active'),
    (organization_id, staff_id, 'staff', 'active'),
    (organization_id, colleague_id, 'staff', 'active'),
    (organization_id, external_id, 'external_reviewer', 'active');

  insert into public.document_templates (id, org_id, title, status, revision, content, created_by, updated_by, published_by, published_at)
  values (template_id, organization_id, 'Sharing verification', 'published', 1, blank, owner_id, owner_id, owner_id, now());

  insert into public.submissions (
    id, org_id, title, template_id, template_revision, template_snapshot, values, status,
    created_by, updated_by, submitted_by, submitted_at
  )
  select submission_id, organization_id, 'Shared ' || position, template_id, 1, form,
         '{"total":"100","signed":false}', 'submitted', staff_id, staff_id, staff_id, now()
  from (values (shared_submission, 1), (promoted_submission, 2)) as made(submission_id, position);

  insert into public.submissions (
    id, org_id, title, template_id, template_revision, template_snapshot, values, status, created_by, updated_by
  )
  values (draft_submission, organization_id, 'Draft', template_id, 1, blank, '{}', 'draft', staff_id, staff_id);

  -- Everything from here runs as the app does: as the service role, not a superuser.
  set local role service_role;

  -- Before it is shared, neither a colleague nor an outside reviewer may comment,
  -- though it has no reviewers yet (and so no lead to compare with).
  begin
    perform public.create_internal_submission_comment(organization_id, shared_submission, gen_random_uuid(), 'Early', colleague_id);
    raise exception 'A colleague commented on work not shared with them.' using errcode = 'XX001';
  exception when sqlstate '42501' then null;
  end;

  begin
    perform public.create_internal_submission_comment(organization_id, shared_submission, gen_random_uuid(), 'Early', external_id);
    raise exception 'An outside reviewer commented on unassigned work.' using errcode = 'XX001';
  exception when sqlstate '42501' then null;
  end;

  -- Someone who neither submitted it nor chose its reviewers, and is not an owner, cannot share it.
  begin
    perform public.set_submission_sharing(organization_id, shared_submission, array[external_id], colleague_id);
    raise exception 'A colleague shared someone else''s submission.' using errcode = 'XX001';
  exception when sqlstate '42501' then null;
  end;

  begin
    perform public.set_submission_sharing(organization_id, draft_submission, array[colleague_id], staff_id);
    raise exception 'A draft was shared.' using errcode = 'XX001';
  exception when sqlstate 'P0001' then null;
  end;

  -- The person who submitted it shares it; naming themselves is ignored.
  added := public.set_submission_sharing(organization_id, shared_submission, array[colleague_id, external_id, staff_id], staff_id);
  if cardinality(added) <> 2 or not (colleague_id = any(added)) or not (external_id = any(added)) then
    raise exception 'Sharing did not add exactly the two people named.';
  end if;

  if public.set_submission_sharing(organization_id, shared_submission, array[colleague_id, external_id], staff_id) <> '{}' then
    raise exception 'Sharing with the same people again added someone.';
  end if;

  -- Its reviewer is a manager; everyone must approve.
  select * into result from public.set_submission_reviewers(
    organization_id, shared_submission, 1, array[manager_id], null, manager_id);
  if (select count(*) from public.submission_reviewers where submission_id = shared_submission) <> 3 then
    raise exception 'Choosing reviewers took off the people it was shared with.';
  end if;

  -- Someone it was shared with comments, but cannot approve.
  perform public.create_internal_submission_comment(
    organization_id, shared_submission, gen_random_uuid(), 'I was on that job', colleague_id);

  begin
    perform public.transition_internal_submission(organization_id, shared_submission, result.revision, 'approved', null, colleague_id);
    raise exception 'Someone it was shared with approved it.' using errcode = 'XX001';
  exception when sqlstate '23514' then null;
  end;

  -- Their change request holds it up.
  select * into result from public.transition_internal_submission(
    organization_id, shared_submission, result.revision, 'needs_changes', 'The hours are wrong', colleague_id);
  if result.status <> 'needs_changes' then
    raise exception 'A change request from someone it was shared with did not hold it up.';
  end if;

  -- And while it is open they cannot be taken off.
  begin
    perform public.set_submission_sharing(organization_id, shared_submission, array[external_id], staff_id);
    raise exception 'Someone with an open change request was unshared.' using errcode = 'XX001';
  exception when sqlstate 'P0001' then null;
  end;

  -- The assigner sets it aside; the manager's approval alone then approves it,
  -- because people it was shared with never count toward approval.
  select * into result from public.dismiss_submission_changes_request(
    organization_id, shared_submission, result.revision, colleague_id, 'Hours checked', false, manager_id);
  select * into result from public.transition_internal_submission(
    organization_id, shared_submission, result.revision, 'approved', null, manager_id);
  if result.status <> 'approved' then
    raise exception 'The only reviewer approved, yet it stayed %.', result.status;
  end if;

  -- Naming someone it was shared with as a reviewer lets them approve, and they count.
  perform public.set_submission_sharing(organization_id, promoted_submission, array[colleague_id, external_id], staff_id);
  select * into result from public.set_submission_reviewers(
    organization_id, promoted_submission, 1, array[manager_id, external_id], null, manager_id);
  if not (select can_approve from public.submission_reviewers where submission_id = promoted_submission and user_id = external_id) then
    raise exception 'Naming someone it was shared with as a reviewer did not let them approve.';
  end if;

  -- Sharing again, without them, leaves a reviewer where they are.
  perform public.set_submission_sharing(organization_id, promoted_submission, array[colleague_id], staff_id);
  if not exists (select 1 from public.submission_reviewers where submission_id = promoted_submission and user_id = external_id) then
    raise exception 'Changing who it is shared with took a reviewer off.';
  end if;

  -- Suggestions: only a reviewer who is an owner or manager may suggest.
  begin
    perform public.suggest_submission_answers(organization_id, promoted_submission, '{"total":"120"}', external_id);
    raise exception 'An external reviewer suggested answers.' using errcode = 'XX001';
  exception when sqlstate '42501' then null;
  end;

  begin
    perform public.suggest_submission_answers(organization_id, promoted_submission, '{"total":"120"}', owner_id);
    raise exception 'An owner who is not a reviewer suggested answers.' using errcode = 'XX001';
  exception when sqlstate '42501' then null;
  end;

  -- An unchanged answer is not a suggestion; a second suggestion on the same answer replaces the first.
  suggested := public.suggest_submission_answers(organization_id, promoted_submission, '{"total":"110","signed":false}', manager_id);
  suggested := public.suggest_submission_answers(organization_id, promoted_submission, '{"total":"120","signed":true}', manager_id);
  if suggested <> 2
      or (select count(*) from public.submission_answer_suggestions where submission_id = promoted_submission) <> 2 then
    raise exception 'Suggestions were not kept one per answer.';
  end if;

  select id into first_suggestion from public.submission_answer_suggestions
  where submission_id = promoted_submission and field_key = 'total';
  select id into second_suggestion from public.submission_answer_suggestions
  where submission_id = promoted_submission and field_key = 'signed';

  if (select previous_value from public.submission_answer_suggestions where id = first_suggestion) <> '"100"' then
    raise exception 'The suggestion did not keep the answer it would replace.';
  end if;

  if (select values from public.submissions where id = promoted_submission) ->> 'total' <> '100' then
    raise exception 'A suggestion changed the answer before it was accepted.';
  end if;

  -- Only the person who submitted it decides.
  begin
    perform public.decide_submission_suggestion(organization_id, promoted_submission, first_suggestion, true, manager_id);
    raise exception 'A reviewer accepted their own suggestion.' using errcode = 'XX001';
  exception when sqlstate '42501' then null;
  end;

  select * into result from public.decide_submission_suggestion(organization_id, promoted_submission, first_suggestion, true, staff_id);
  if result.values ->> 'total' <> '120' or result.status <> 'in_review' then
    raise exception 'Accepting a suggestion did not change the answer.';
  end if;

  -- The same decision again changes nothing; a different one is refused.
  if (public.decide_submission_suggestion(organization_id, promoted_submission, first_suggestion, true, staff_id)).revision <> result.revision then
    raise exception 'Accepting twice changed the submission twice.';
  end if;

  begin
    perform public.decide_submission_suggestion(organization_id, promoted_submission, first_suggestion, false, staff_id);
    raise exception 'An accepted suggestion was declined.' using errcode = 'XX001';
  exception when sqlstate 'P0001' then null;
  end;

  perform public.decide_submission_suggestion(organization_id, promoted_submission, second_suggestion, false, staff_id);
  if (select values from public.submissions where id = promoted_submission) -> 'signed' <> 'false'::jsonb
      or (select status from public.submission_answer_suggestions where id = second_suggestion) <> 'declined' then
    raise exception 'Declining a suggestion changed the answer or was not recorded.';
  end if;

  -- The trail and the activity record what happened.
  if (select count(*) from public.submission_activity_events
      where submission_id = promoted_submission
        and event_type in ('answers_suggested', 'suggestion_accepted', 'suggestion_declined')) <> 4 then
    raise exception 'Suggestions left no activity evidence.';
  end if;

  -- Answers still cannot be written directly while it is in review.
  reset role;
  begin
    update public.submissions set values = '{"total":"1"}', revision = revision + 1 where id = promoted_submission;
    raise exception 'Answers were written directly during review.' using errcode = 'XX001';
  exception when sqlstate '23514' then null;
  end;

  if has_table_privilege('authenticated', 'public.submission_answer_suggestions', 'select') then
    raise exception 'Signed-in users can read the suggestions table directly.';
  end if;

  delete from public.organizations where id = organization_id;
  delete from auth.users where id in (owner_id, manager_id, staff_id, colleague_id, external_id);
end;
$$;
