do $$
<<submission_workflow_test>>
declare
  actor_id uuid := gen_random_uuid();
  manager_id uuid := gen_random_uuid();
  reviewer_id uuid := gen_random_uuid();
  organization_id uuid := gen_random_uuid();
  template_id uuid := gen_random_uuid();
  submission_id uuid := gen_random_uuid();
  first_file_id uuid := gen_random_uuid();
  second_file_id uuid := gen_random_uuid();
  cleanup_file_id uuid := gen_random_uuid();
  comment_id uuid := gen_random_uuid();
  checksum_sha256 text := repeat('a', 64);
  evidence_count integer;
  template_snapshot jsonb;
  submission_record public.submissions%rowtype;
  file_record public.submission_files%rowtype;
  comment_record public.submission_comments%rowtype;
begin
  template_snapshot := jsonb_build_object(
    'schemaVersion', 1,
    'branding', jsonb_build_object(
      'organizationName', 'RPC verification',
      'logoDataUrl', null,
      'primaryColor', '#111827',
      'accentColor', '#2563EB'
    ),
    'repeat', jsonb_build_object('header', false, 'footer', false),
    'sections', jsonb_build_object(
      'header', jsonb_build_object('blocks', '[]'::jsonb),
      'body', jsonb_build_object(
        'blocks', jsonb_build_array(
          jsonb_build_object(
            'id', gen_random_uuid(),
            'type', 'text_field',
            'fieldKey', 'vendor_name',
            'label', 'Vendor name',
            'required', true,
            'helpText', null,
            'placeholder', null,
            'multiline', false
          ),
          jsonb_build_object(
            'id', gen_random_uuid(),
            'type', 'file_field',
            'fieldKey', 'evidence',
            'label', 'Evidence',
            'required', true,
            'helpText', null
          )
        )
      ),
      'footer', jsonb_build_object('blocks', '[]'::jsonb)
    )
  );

  insert into auth.users (id, email, created_at, updated_at)
  values
    (
      actor_id,
      'rpc-' || replace(actor_id::text, '-', '') || '@example.invalid',
      now(),
      now()
    ),
    (
      manager_id,
      'rpc-' || replace(manager_id::text, '-', '') || '@example.invalid',
      now(),
      now()
    ),
    (
      reviewer_id,
      'rpc-' || replace(reviewer_id::text, '-', '') || '@example.invalid',
      now(),
      now()
    );

  insert into public.profiles (id, email, full_name)
  values
    (
      actor_id,
      'rpc-' || replace(actor_id::text, '-', '') || '@example.invalid',
      'Submission RPC verification creator'
    ),
    (
      manager_id,
      'rpc-' || replace(manager_id::text, '-', '') || '@example.invalid',
      'Submission RPC verification manager'
    ),
    (
      reviewer_id,
      'rpc-' || replace(reviewer_id::text, '-', '') || '@example.invalid',
      'Submission RPC verification reviewer'
    );

  insert into public.organizations (id, name, slug, created_by)
  values (
    organization_id,
    'Submission RPC verification',
    'submission-rpc-' || replace(organization_id::text, '-', ''),
    actor_id
  );

  insert into public.organization_memberships (
    org_id,
    user_id,
    role,
    status
  )
  values
    (organization_id, actor_id, 'staff', 'active'),
    (organization_id, manager_id, 'manager', 'active'),
    (organization_id, reviewer_id, 'external_reviewer', 'active');

  insert into public.document_templates (
    id,
    org_id,
    title,
    status,
    revision,
    content,
    created_by,
    updated_by,
    published_by,
    published_at
  )
  values (
    template_id,
    organization_id,
    'Submission RPC verification',
    'published',
    1,
    template_snapshot,
    actor_id,
    actor_id,
    actor_id,
    now()
  );

  select *
  into submission_record
  from public.create_internal_submission_draft(
    organization_id,
    template_id,
    submission_id,
    'Submission RPC verification',
    actor_id
  );

  if submission_record.status <> 'draft' or submission_record.revision <> 1 then
    raise exception 'Valid create RPC did not return revision-one draft.';
  end if;

  select *
  into submission_record
  from public.save_internal_submission_draft(
    organization_id,
    submission_id,
    1,
    '{"vendor_name":"Northstar"}'::jsonb,
    actor_id
  );

  if submission_record.revision <> 2 then
    raise exception 'Valid save RPC did not advance the draft revision.';
  end if;

  select *
  into file_record
  from public.allocate_internal_submission_file(
    organization_id,
    submission_id,
    2,
    first_file_id,
    'evidence',
    'evidence.pdf',
    'evidence.pdf',
    'application/pdf',
    128,
    'organizations/' || organization_id::text ||
      '/submissions/' || submission_id::text ||
      '/files/evidence/' || first_file_id::text || '/evidence.pdf',
    checksum_sha256,
    actor_id
  );

  if file_record.status <> 'upload_pending'
      or file_record.expected_checksum_sha256 <> checksum_sha256 then
    raise exception 'Valid allocation RPC did not bind the expected checksum.';
  end if;

  select *
  into file_record
  from public.record_internal_submission_file_upload_window(
    organization_id,
    submission_id,
    first_file_id,
    now() + interval '10 minutes',
    actor_id
  );

  if file_record.cleanup_after <= now() then
    raise exception 'Valid upload-window RPC did not retain a future cleanup deadline.';
  end if;

  select *
  into file_record
  from public.complete_internal_submission_file(
    organization_id,
    submission_id,
    first_file_id,
    file_record.storage_key,
    'application/pdf',
    128,
    checksum_sha256,
    actor_id
  );

  if file_record.status <> 'available'
      or file_record.checksum_sha256 <> checksum_sha256 then
    raise exception 'Valid completion RPC did not persist the verified checksum.';
  end if;

  select *
  into file_record
  from public.supersede_internal_submission_file(
    organization_id,
    submission_id,
    first_file_id,
    actor_id
  );

  if file_record.status <> 'superseded' then
    raise exception 'Valid supersede RPC did not create a tombstone.';
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
    uploaded_by,
    superseded_by,
    superseded_at,
    cleanup_after
  )
  values (
    cleanup_file_id,
    organization_id,
    submission_id,
    'evidence',
    'superseded',
    'organizations/' || organization_id::text ||
      '/submissions/' || submission_id::text ||
      '/files/evidence/' || cleanup_file_id::text || '/expired.pdf',
    'expired.pdf',
    'expired.pdf',
    'application/pdf',
    64,
    checksum_sha256,
    actor_id,
    actor_id,
    now() - interval '2 minutes',
    now() - interval '1 minute'
  );

  select *
  into file_record
  from public.mark_internal_submission_file_storage_cleaned(
    cleanup_file_id,
    'organizations/' || organization_id::text ||
      '/submissions/' || submission_id::text ||
      '/files/evidence/' || cleanup_file_id::text || '/expired.pdf'
  );

  if file_record.storage_cleaned_at is null then
    raise exception 'Valid cleanup marker RPC did not persist completion.';
  end if;

  select *
  into file_record
  from public.allocate_internal_submission_file(
    organization_id,
    submission_id,
    2,
    second_file_id,
    'evidence',
    'replacement.pdf',
    'replacement.pdf',
    'application/pdf',
    256,
    'organizations/' || organization_id::text ||
      '/submissions/' || submission_id::text ||
      '/files/evidence/' || second_file_id::text || '/replacement.pdf',
    checksum_sha256,
    actor_id
  );

  select *
  into file_record
  from public.complete_internal_submission_file(
    organization_id,
    submission_id,
    second_file_id,
    file_record.storage_key,
    'application/pdf',
    256,
    checksum_sha256,
    actor_id
  );

  select *
  into submission_record
  from public.submit_internal_submission(
    organization_id,
    submission_id,
    2,
    '{"vendor_name":"Northstar"}'::jsonb,
    actor_id
  );

  if submission_record.status <> 'submitted' or submission_record.revision <> 3 then
    raise exception 'Valid submit RPC did not atomically finalize the draft.';
  end if;

  select *
  into file_record
  from public.supersede_internal_submission_file(
    organization_id,
    submission_id,
    first_file_id,
    actor_id
  );

  if file_record.status <> 'superseded' then
    raise exception 'Superseded cleanup retry was not idempotent after submit.';
  end if;

  if (
    select count(*)
    from public.submission_activity_events activity
    where activity.org_id = organization_id
      and activity.submission_id = submission_workflow_test.submission_id
      and activity.event_type = 'submitted'
      and activity.from_status = 'draft'
      and activity.to_status = 'submitted'
      and activity.submission_revision = 3
  ) <> 1 then
    raise exception 'Initial submit did not produce one revision-bound activity event.';
  end if;

  if (
    select count(*)
    from public.audit_logs audit
    where audit.org_id = organization_id
      and audit.target_id = submission_workflow_test.submission_id
      and audit.action in ('submission.created', 'submission.submitted')
  ) <> 2 then
    raise exception 'Valid lifecycle did not produce both submission audits.';
  end if;

  begin
    perform public.assign_internal_submission(
      organization_id,
      submission_id,
      3,
      actor_id,
      manager_id
    );
    raise exception 'Staff assignee unexpectedly passed the eligibility guard.';
  exception
    when sqlstate '22023' then
      null;
  end;

  begin
    perform public.assign_internal_submission(
      organization_id,
      submission_id,
      2,
      reviewer_id,
      manager_id
    );
    raise exception 'Stale assignment unexpectedly changed the submission.';
  exception
    when sqlstate '40001' then
      null;
  end;

  if exists (
    select 1
    from public.submission_activity_events activity
    where activity.org_id = organization_id
      and activity.submission_id = submission_workflow_test.submission_id
      and activity.event_type = 'assigned'
  ) then
    raise exception 'Rejected assignment attempts left activity evidence.';
  end if;

  select *
  into submission_record
  from public.assign_internal_submission(
    organization_id,
    submission_id,
    3,
    manager_id,
    manager_id
  );

  if submission_record.status <> 'in_review'
      or submission_record.revision <> 4
      or submission_record.assigned_to <> manager_id
      or submission_record.assigned_by <> manager_id
      or submission_record.assigned_at is null then
    raise exception 'Valid assignment did not atomically start manager review.';
  end if;

  perform public.assign_internal_submission(
    organization_id,
    submission_id,
    3,
    manager_id,
    manager_id
  );

  if (
    select count(*)
    from public.submission_activity_events activity
    where activity.org_id = organization_id
      and activity.submission_id = submission_workflow_test.submission_id
      and activity.event_type = 'assigned'
      and activity.submission_revision = 4
  ) <> 1 then
    raise exception 'Assignment retry did not remain idempotent.';
  end if;

  begin
    perform public.transition_internal_submission(
      organization_id,
      submission_id,
      4,
      'needs_changes',
      null,
      manager_id
    );
    raise exception 'Change request unexpectedly accepted a missing note.';
  exception
    when sqlstate '22023' then
      null;
  end;

  begin
    perform public.transition_internal_submission(
      organization_id,
      submission_id,
      4,
      'completed',
      null,
      manager_id
    );
    raise exception 'Forbidden in-review completion unexpectedly succeeded.';
  exception
    when sqlstate 'P0001' then
      null;
  end;

  begin
    perform public.transition_internal_submission(
      organization_id,
      submission_id,
      3,
      'approved',
      null,
      manager_id
    );
    raise exception 'Stale review transition unexpectedly succeeded.';
  exception
    when sqlstate '40001' then
      null;
  end;

  select
    (
      select count(*)
      from public.submission_comments comment
      where comment.org_id = organization_id
        and comment.submission_id = submission_workflow_test.submission_id
    )
    + (
      select count(*)
      from public.submission_activity_events activity
      where activity.org_id = organization_id
        and activity.submission_id = submission_workflow_test.submission_id
    )
    + (
      select count(*)
      from public.audit_logs audit
      where audit.org_id = organization_id
        and audit.target_id = submission_workflow_test.submission_id
    )
  into evidence_count;

  if evidence_count <> 5 then
    raise exception 'Rejected review operations left partial comments, activity, or audits.';
  end if;

  select *
  into submission_record
  from public.transition_internal_submission(
    organization_id,
    submission_id,
    4,
    'needs_changes',
    '  Please provide a newer receipt.  ',
    manager_id
  );

  if submission_record.status <> 'needs_changes'
      or submission_record.revision <> 5 then
    raise exception 'Valid change request did not advance the review state.';
  end if;

  if not exists (
    select 1
    from public.submission_comments comment
    join public.submission_activity_events activity
      on activity.comment_id = comment.id
      and activity.org_id = comment.org_id
      and activity.submission_id = comment.submission_id
    join public.audit_logs audit
      on audit.org_id = comment.org_id
      and audit.target_id = comment.submission_id
      and audit.metadata ->> 'commentId' = comment.id::text
    where comment.org_id = organization_id
      and comment.submission_id = submission_workflow_test.submission_id
      and comment.body = 'Please provide a newer receipt.'
      and comment.created_by = manager_id
      and activity.event_type = 'changes_requested'
      and activity.from_status = 'in_review'
      and activity.to_status = 'needs_changes'
      and activity.submission_revision = 5
      and audit.action = 'submission.changes_requested'
  ) then
    raise exception 'Change request did not atomically link comment, activity, and audit evidence.';
  end if;

  perform public.transition_internal_submission(
    organization_id,
    submission_id,
    4,
    'needs_changes',
    'Please provide a newer receipt.',
    manager_id
  );

  begin
    perform public.transition_internal_submission(
      organization_id,
      submission_id,
      4,
      'needs_changes',
      'Use a different receipt instead.',
      manager_id
    );
    raise exception 'Transition retry unexpectedly discarded a different review note.';
  exception
    when sqlstate '40001' then
      null;
  end;

  if (
    select count(*)
    from public.submission_activity_events activity
    where activity.org_id = organization_id
      and activity.submission_id = submission_workflow_test.submission_id
      and activity.event_type = 'changes_requested'
      and activity.submission_revision = 5
  ) <> 1 then
    raise exception 'Exact transition retries produced duplicate activity.';
  end if;

  select *
  into submission_record
  from public.save_internal_submission_draft(
    organization_id,
    submission_id,
    5,
    '{"vendor_name":"Northstar revised"}'::jsonb,
    actor_id
  );

  if submission_record.status <> 'needs_changes'
      or submission_record.revision <> 6 then
    raise exception 'Creator could not edit a requested-change submission.';
  end if;

  select *
  into submission_record
  from public.submit_internal_submission(
    organization_id,
    submission_id,
    6,
    '{"vendor_name":"Northstar revised"}'::jsonb,
    actor_id
  );

  if submission_record.status <> 'submitted'
      or submission_record.revision <> 7
      or submission_record.assigned_to <> manager_id then
    raise exception 'Valid resubmission did not retain assignment and advance revision.';
  end if;

  if not exists (
    select 1
    from public.submission_activity_events activity
    join public.audit_logs audit
      on audit.org_id = activity.org_id
      and audit.target_id = activity.submission_id
      and audit.action = 'submission.resubmitted'
      and (audit.metadata ->> 'submissionRevision')::integer = activity.submission_revision
    where activity.org_id = organization_id
      and activity.submission_id = submission_workflow_test.submission_id
      and activity.event_type = 'resubmitted'
      and activity.from_status = 'needs_changes'
      and activity.to_status = 'submitted'
      and activity.submission_revision = 7
  ) then
    raise exception 'Resubmission did not atomically create activity and audit evidence.';
  end if;

  select *
  into submission_record
  from public.assign_internal_submission(
    organization_id,
    submission_id,
    7,
    manager_id,
    manager_id
  );

  if submission_record.status <> 'in_review'
      or submission_record.revision <> 8 then
    raise exception 'Resubmission assignment did not restart review.';
  end if;

  select *
  into submission_record
  from public.assign_internal_submission(
    organization_id,
    submission_id,
    8,
    reviewer_id,
    manager_id
  );

  if submission_record.status <> 'in_review'
      or submission_record.revision <> 9
      or submission_record.assigned_to <> reviewer_id then
    raise exception 'External-reviewer reassignment did not retain review state.';
  end if;

  begin
    perform public.create_internal_submission_comment(
      organization_id,
      submission_id,
      gen_random_uuid(),
      '   ',
      reviewer_id
    );
    raise exception 'Blank submission comment unexpectedly succeeded.';
  exception
    when sqlstate '22023' then
      null;
  end;

  select *
  into comment_record
  from public.create_internal_submission_comment(
    organization_id,
    submission_id,
    comment_id,
    '  The updated receipt is clear.  ',
    reviewer_id
  );

  if comment_record.body <> 'The updated receipt is clear.'
      or comment_record.created_by <> reviewer_id then
    raise exception 'Assigned reviewer comment was not normalized and persisted.';
  end if;

  perform public.create_internal_submission_comment(
    organization_id,
    submission_id,
    comment_id,
    'The updated receipt is clear.',
    reviewer_id
  );

  if (
    select count(*)
    from public.submission_activity_events activity
    where activity.org_id = organization_id
      and activity.submission_id = submission_workflow_test.submission_id
      and activity.event_type = 'commented'
      and activity.comment_id = submission_workflow_test.comment_id
      and activity.submission_revision = 9
  ) <> 1 then
    raise exception 'Comment retry did not remain idempotent.';
  end if;

  begin
    perform public.transition_internal_submission(
      organization_id,
      submission_id,
      9,
      'approved',
      null,
      reviewer_id
    );
    raise exception 'External reviewer unexpectedly made a binding decision.';
  exception
    when sqlstate '42501' then
      null;
  end;

  select
    (
      select count(*)
      from public.submission_comments comment
      where comment.org_id = organization_id
        and comment.submission_id = submission_workflow_test.submission_id
    )
    + (
      select count(*)
      from public.submission_activity_events activity
      where activity.org_id = organization_id
        and activity.submission_id = submission_workflow_test.submission_id
    )
    + (
      select count(*)
      from public.audit_logs audit
      where audit.org_id = organization_id
        and audit.target_id = submission_workflow_test.submission_id
    )
  into evidence_count;

  if evidence_count <> 17 then
    raise exception 'Rejected comments or reviewer decisions left partial evidence.';
  end if;

  select *
  into submission_record
  from public.assign_internal_submission(
    organization_id,
    submission_id,
    9,
    manager_id,
    manager_id
  );

  if submission_record.revision <> 10
      or submission_record.assigned_to <> manager_id then
    raise exception 'Manager reassignment did not restore decision ownership.';
  end if;

  select *
  into submission_record
  from public.transition_internal_submission(
    organization_id,
    submission_id,
    10,
    'approved',
    null,
    manager_id
  );

  if submission_record.status <> 'approved'
      or submission_record.revision <> 11 then
    raise exception 'Valid approval did not advance the review state.';
  end if;

  select *
  into submission_record
  from public.transition_internal_submission(
    organization_id,
    submission_id,
    11,
    'completed',
    null,
    manager_id
  );

  if submission_record.status <> 'completed'
      or submission_record.revision <> 12 then
    raise exception 'Valid completion did not advance the approved submission.';
  end if;

  perform public.transition_internal_submission(
    organization_id,
    submission_id,
    11,
    'completed',
    null,
    manager_id
  );

  if (
    select count(*)
    from public.submission_comments comment
    where comment.org_id = organization_id
      and comment.submission_id = submission_workflow_test.submission_id
  ) <> 2 then
    raise exception 'Review lifecycle produced an unexpected comment count.';
  end if;

  if (
    select count(*)
    from public.submission_activity_events activity
    where activity.org_id = organization_id
      and activity.submission_id = submission_workflow_test.submission_id
  ) <> 10 then
    raise exception 'Review lifecycle produced an unexpected activity count.';
  end if;

  if (
    select count(*)
    from public.audit_logs audit
    where audit.org_id = organization_id
      and audit.target_id = submission_workflow_test.submission_id
  ) <> 11 then
    raise exception 'Review lifecycle produced an unexpected audit count.';
  end if;

  if (
    select count(*)
    from public.submission_activity_events activity
    where activity.org_id = organization_id
      and activity.submission_id = submission_workflow_test.submission_id
      and (
        (activity.event_type = 'submitted' and activity.submission_revision = 3)
        or (activity.event_type = 'changes_requested' and activity.submission_revision = 5)
        or (activity.event_type = 'resubmitted' and activity.submission_revision = 7)
        or (activity.event_type = 'commented' and activity.submission_revision = 9)
        or (activity.event_type = 'approved' and activity.submission_revision = 11)
        or (activity.event_type = 'completed' and activity.submission_revision = 12)
      )
  ) <> 6 then
    raise exception 'Review activity was not bound to the expected submission revisions.';
  end if;

  if (
    select count(*)
    from public.submission_activity_events activity
    where activity.org_id = organization_id
      and activity.submission_id = submission_workflow_test.submission_id
      and activity.event_type = 'assigned'
      and activity.submission_revision in (4, 8, 9, 10)
  ) <> 4 then
    raise exception 'Review assignment activity did not match the expected revisions.';
  end if;

  delete from public.organizations
  where id = organization_id;

  delete from auth.users
  where id in (actor_id, manager_id, reviewer_id);
end;
$$;
