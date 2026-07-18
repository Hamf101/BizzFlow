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

  perform public.lock_editable_internal_submission(
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

  perform public.lock_editable_internal_submission(
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

revoke all on function public.transition_internal_submission(
  uuid,
  uuid,
  integer,
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

revoke all on function public.record_internal_submission_file_upload_window(
  uuid,
  uuid,
  uuid,
  timestamptz,
  uuid
) from public, anon, authenticated, service_role;

grant execute on function public.transition_internal_submission(
  uuid,
  uuid,
  integer,
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

grant execute on function public.record_internal_submission_file_upload_window(
  uuid,
  uuid,
  uuid,
  timestamptz,
  uuid
) to service_role;

notify pgrst, 'reload schema';
