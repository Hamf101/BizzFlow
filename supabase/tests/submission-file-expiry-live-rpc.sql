-- Exercises expire_abandoned_submission_files against a real database:
-- abandoned public drafts lose their handle and files, dead upload allocations
-- are released, and everything still in use is left alone. The expiry runs
-- across the whole database, as the nightly cleanup does, so use a local or
-- disposable database. Creates isolated synthetic rows inside one statement and
-- removes them before returning; any failed check rolls everything back.
do $$
<<expiry_test>>
declare
  owner_id uuid := gen_random_uuid();
  member_id uuid := gen_random_uuid();
  organization_id uuid := gen_random_uuid();
  template_id uuid := gen_random_uuid();
  link_id uuid := gen_random_uuid();
  abandoned_draft_id uuid := gen_random_uuid();
  saved_draft_id uuid := gen_random_uuid();
  uploading_draft_id uuid := gen_random_uuid();
  internal_draft_id uuid := gen_random_uuid();
  abandoned_file_id uuid := gen_random_uuid();
  abandoned_pending_id uuid := gen_random_uuid();
  saved_file_id uuid := gen_random_uuid();
  uploading_file_id uuid := gen_random_uuid();
  dead_pending_id uuid := gen_random_uuid();
  member_file_id uuid := gen_random_uuid();
  live_pending_id uuid := gen_random_uuid();
  checksum text := repeat('a', 64);
  template_snapshot jsonb;
  result jsonb;
begin
  template_snapshot := jsonb_build_object(
    'schemaVersion', 3,
    'branding', '{}'::jsonb,
    'blocks', jsonb_build_array(
      jsonb_build_object(
        'id', gen_random_uuid(), 'type', 'file_field', 'fieldKey', 'evidence',
        'label', 'Evidence', 'required', false, 'helpText', null
      ),
      jsonb_build_object(
        'id', gen_random_uuid(), 'type', 'file_field', 'fieldKey', 'photo',
        'label', 'Photo', 'required', false, 'helpText', null
      ),
      jsonb_build_object(
        'id', gen_random_uuid(), 'type', 'file_field', 'fieldKey', 'contract',
        'label', 'Contract', 'required', false, 'helpText', null
      )
    ),
    'layout', '{}'::jsonb,
    'sections', '[]'::jsonb,
    'fieldGroups', '[]'::jsonb,
    'blockRules', '[]'::jsonb
  );

  insert into auth.users (id, email, created_at, updated_at)
  values
    (owner_id, 'rpc-' || replace(owner_id::text, '-', '') || '@example.invalid', now(), now()),
    (member_id, 'rpc-' || replace(member_id::text, '-', '') || '@example.invalid', now(), now());

  insert into public.profiles (id, email, full_name)
  values
    (owner_id, 'rpc-' || replace(owner_id::text, '-', '') || '@example.invalid', 'Submission file expiry verification owner'),
    (member_id, 'rpc-' || replace(member_id::text, '-', '') || '@example.invalid', 'Submission file expiry verification member');

  insert into public.organizations (id, name, slug, created_by)
  values (
    organization_id,
    'Submission file expiry verification',
    'expiry-rpc-' || replace(organization_id::text, '-', ''),
    owner_id
  );

  insert into public.organization_memberships (org_id, user_id, role, status)
  values (organization_id, member_id, 'staff', 'active');

  insert into public.document_templates (
    id, org_id, title, status, revision, content,
    created_by, updated_by, published_by, published_at
  )
  values (
    template_id, organization_id, 'Submission file expiry verification',
    'published', 1, template_snapshot, owner_id, owner_id, owner_id, now()
  );

  insert into public.public_form_links (id, org_id, template_id, token, status, created_by)
  values (
    link_id, organization_id, template_id,
    'expiry-rpc-' || replace(gen_random_uuid()::text, '-', ''), 'active', owner_id
  );

  insert into public.submissions (
    id, org_id, title, template_id, template_revision, template_snapshot,
    "values", status, revision, created_by, updated_by, public_form_link_id,
    public_draft_token, created_at, updated_at
  )
  values
    (abandoned_draft_id, organization_id, 'Abandoned public draft', template_id, 1,
     template_snapshot, '{}'::jsonb, 'draft', 1, null, null, link_id,
     md5(random()::text) || md5(random()::text), now() - interval '3 days', now() - interval '2 days'),
    (saved_draft_id, organization_id, 'Recently saved public draft', template_id, 1,
     template_snapshot, '{}'::jsonb, 'draft', 1, null, null, link_id,
     md5(random()::text) || md5(random()::text), now() - interval '3 days', now() - interval '1 hour'),
    (uploading_draft_id, organization_id, 'Public draft with a fresh upload', template_id, 1,
     template_snapshot, '{}'::jsonb, 'draft', 1, null, null, link_id,
     md5(random()::text) || md5(random()::text), now() - interval '3 days', now() - interval '2 days'),
    (internal_draft_id, organization_id, 'Internal draft', template_id, 1,
     template_snapshot, '{}'::jsonb, 'draft', 1, member_id, member_id, null,
     null, now() - interval '3 days', now() - interval '2 days');

  insert into public.submission_files (
    id, org_id, submission_id, field_key, status, storage_key,
    original_filename, safe_filename, content_type, byte_size,
    expected_checksum_sha256, checksum_sha256, uploaded_by,
    created_at, updated_at, available_at, cleanup_after
  )
  select
    file.id, organization_id, file.submission_id, file.field_key, file.status,
    'organizations/' || organization_id::text || '/submissions/'
      || file.submission_id::text || '/files/' || file.field_key || '/'
      || file.id::text || '/evidence.pdf',
    'evidence.pdf', 'evidence.pdf', 'application/pdf', 1024,
    checksum,
    case when file.status = 'available' then checksum end,
    file.uploaded_by, file.started_at, file.started_at,
    case when file.status = 'available' then file.started_at end,
    file.cleanup_after
  from (
    values
      (abandoned_file_id, abandoned_draft_id, 'evidence', 'available', null::uuid,
       now() - interval '3 days', now() - interval '2 days'),
      (abandoned_pending_id, abandoned_draft_id, 'photo', 'upload_pending', null::uuid,
       now() - interval '3 days', now() - interval '2 days'),
      (saved_file_id, saved_draft_id, 'evidence', 'available', null::uuid,
       now() - interval '3 days', now() - interval '2 days'),
      (uploading_file_id, uploading_draft_id, 'evidence', 'upload_pending', null::uuid,
       now() - interval '4 hours', now() + interval '20 hours'),
      (dead_pending_id, internal_draft_id, 'evidence', 'upload_pending', member_id,
       now() - interval '2 hours', now() - interval '1 hour'),
      (member_file_id, internal_draft_id, 'photo', 'available', member_id,
       now() - interval '3 days', now() - interval '2 days'),
      (live_pending_id, internal_draft_id, 'contract', 'upload_pending', member_id,
       now() - interval '5 minutes', now() + interval '20 minutes')
  ) as file(id, submission_id, field_key, status, uploaded_by, started_at, cleanup_after);

  -- The file guard still refuses actor-less supersedes that expiry does not cover.
  begin
    update public.submission_files
    set status = 'superseded', superseded_at = now(), updated_at = now()
    where id = live_pending_id;
    raise exception 'An open upload window was closed without an actor.';
  exception when sqlstate '23514' then
    null;
  end;

  begin
    update public.submission_files
    set status = 'superseded', superseded_at = now(), updated_at = now()
    where id = member_file_id;
    raise exception 'A member''s file was superseded without an actor.';
  exception when sqlstate '23514' then
    null;
  end;

  begin
    update public.submission_files
    set status = 'superseded', superseded_at = now(), updated_at = now()
    where id = saved_file_id;
    raise exception 'A resumable public draft lost a file without an actor.';
  exception when sqlstate '23514' then
    null;
  end;

  result := public.expire_abandoned_submission_files(1000);

  if coalesce((result ->> 'expired_drafts')::integer, 0) < 1
      or coalesce((result ->> 'expired_files')::integer, 0) < 3 then
    raise exception 'The expiry pass reported too little: %', result;
  end if;

  -- The abandoned draft can no longer be resumed or submitted, and keeps its
  -- revision and last-saved time.
  if exists (
    select 1
    from public.submissions submission
    where submission.id = abandoned_draft_id
      and (
        submission.public_draft_token is not null
        or submission.status <> 'draft'
        or submission.revision <> 1
        or submission.updated_at > now() - interval '1 day'
      )
  ) then
    raise exception 'The abandoned draft was not expired as expected.';
  end if;

  -- Its files and the dead allocation wait for the existing cleanup.
  if (
    select count(*)
    from public.submission_files submission_file
    where submission_file.id in (abandoned_file_id, abandoned_pending_id, dead_pending_id)
      and submission_file.status = 'superseded'
      and submission_file.superseded_by is null
      and submission_file.superseded_at is not null
      and submission_file.storage_cleaned_at is null
  ) <> 3 then
    raise exception 'Expired files were not handed to the cleanup.';
  end if;

  -- Everything still in use is untouched.
  if (
    select count(*)
    from public.submission_files submission_file
    where submission_file.id in (saved_file_id, uploading_file_id, member_file_id, live_pending_id)
      and submission_file.status <> 'superseded'
  ) <> 4 then
    raise exception 'A file still in use was expired.';
  end if;

  if (
    select count(*)
    from public.submissions submission
    where submission.id in (saved_draft_id, uploading_draft_id)
      and submission.public_draft_token is not null
  ) <> 2 then
    raise exception 'A public draft still in use was expired.';
  end if;

  -- The cleanup accepts an expired file right away.
  perform public.mark_internal_submission_file_storage_cleaned(
    abandoned_file_id,
    (
      select submission_file.storage_key
      from public.submission_files submission_file
      where submission_file.id = abandoned_file_id
    )
  );

  -- A second pass leaves these rows as they are.
  perform public.expire_abandoned_submission_files(1000);

  if (
    select count(*)
    from public.submission_files submission_file
    where submission_file.id in (saved_file_id, uploading_file_id, member_file_id, live_pending_id)
      and submission_file.status <> 'superseded'
  ) <> 4 then
    raise exception 'A second pass expired a file still in use.';
  end if;

  -- Each pass is bounded.
  begin
    perform public.expire_abandoned_submission_files(null);
    raise exception 'A pass without a batch size was accepted.';
  exception when sqlstate '22023' then
    null;
  end;

  begin
    perform public.expire_abandoned_submission_files(1001);
    raise exception 'An oversized batch was accepted.';
  exception when sqlstate '22023' then
    null;
  end;

  delete from public.organizations
  where id = organization_id;

  delete from auth.users
  where id in (owner_id, member_id);
end;
$$;
