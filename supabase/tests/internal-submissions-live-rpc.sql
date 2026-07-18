do $$
declare
  actor_id uuid := gen_random_uuid();
  organization_id uuid := gen_random_uuid();
  template_id uuid := gen_random_uuid();
  submission_id uuid := gen_random_uuid();
  first_file_id uuid := gen_random_uuid();
  second_file_id uuid := gen_random_uuid();
  cleanup_file_id uuid := gen_random_uuid();
  checksum_sha256 text := repeat('a', 64);
  template_snapshot jsonb;
  submission_record public.submissions%rowtype;
  file_record public.submission_files%rowtype;
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
  values (
    actor_id,
    'rpc-' || replace(actor_id::text, '-', '') || '@example.invalid',
    now(),
    now()
  );

  insert into public.profiles (id, email, full_name)
  values (
    actor_id,
    'rpc-' || replace(actor_id::text, '-', '') || '@example.invalid',
    'Submission RPC verification'
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
  values (organization_id, actor_id, 'staff', 'active');

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
    from public.audit_logs audit
    where audit.org_id = organization_id
      and audit.target_id = submission_id
      and audit.action in ('submission.created', 'submission.submitted')
  ) <> 2 then
    raise exception 'Valid lifecycle did not produce both submission audits.';
  end if;

  delete from public.organizations
  where id = organization_id;

  delete from auth.users
  where id = actor_id;
end;
$$;
