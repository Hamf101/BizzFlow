alter table public.document_templates
  drop constraint document_templates_content_object;

alter table public.documents
  drop constraint documents_generated_snapshot_check;

alter table public.submissions
  drop constraint submissions_template_snapshot_object;

alter table public.document_templates
  disable trigger document_templates_enforce_revision;

alter table public.documents
  disable trigger documents_prevent_snapshot_mutation;

alter table public.submissions
  disable trigger submissions_enforce_update;

update public.document_templates
set content = jsonb_build_object(
  'schemaVersion', 2,
  'branding', coalesce(content -> 'branding', '{}'::jsonb),
  'blocks',
    coalesce(content #> '{sections,header,blocks}', '[]'::jsonb)
    || coalesce(content #> '{sections,body,blocks}', '[]'::jsonb)
    || coalesce(content #> '{sections,footer,blocks}', '[]'::jsonb)
)
where content ->> 'schemaVersion' = '1';

update public.documents
set template_snapshot = jsonb_build_object(
  'schemaVersion', 2,
  'branding', coalesce(template_snapshot -> 'branding', '{}'::jsonb),
  'blocks',
    coalesce(template_snapshot #> '{sections,header,blocks}', '[]'::jsonb)
    || coalesce(template_snapshot #> '{sections,body,blocks}', '[]'::jsonb)
    || coalesce(template_snapshot #> '{sections,footer,blocks}', '[]'::jsonb)
)
where source_kind = 'generated'
  and template_snapshot ->> 'schemaVersion' = '1';

update public.submissions
set template_snapshot = jsonb_build_object(
  'schemaVersion', 2,
  'branding', coalesce(template_snapshot -> 'branding', '{}'::jsonb),
  'blocks',
    coalesce(template_snapshot #> '{sections,header,blocks}', '[]'::jsonb)
    || coalesce(template_snapshot #> '{sections,body,blocks}', '[]'::jsonb)
    || coalesce(template_snapshot #> '{sections,footer,blocks}', '[]'::jsonb)
)
where template_snapshot ->> 'schemaVersion' = '1';

alter table public.document_templates
  enable trigger document_templates_enforce_revision;

alter table public.documents
  enable trigger documents_prevent_snapshot_mutation;

alter table public.submissions
  enable trigger submissions_enforce_update;

alter table public.document_templates
  add constraint document_templates_content_object
  check (
    jsonb_typeof(content) = 'object'
    and content ->> 'schemaVersion' = '2'
    and jsonb_typeof(content -> 'branding') = 'object'
    and jsonb_typeof(content -> 'blocks') = 'array'
    and not content ? 'sections'
    and not content ? 'repeat'
  );

alter table public.documents
  add constraint documents_generated_snapshot_check
  check (
    (
      source_kind = 'upload'
      and template_id is null
      and template_revision is null
      and template_snapshot is null
    )
    or
    (
      source_kind = 'generated'
      and template_snapshot is not null
      and jsonb_typeof(template_snapshot) = 'object'
      and template_snapshot ->> 'schemaVersion' = '2'
      and jsonb_typeof(template_snapshot -> 'branding') = 'object'
      and jsonb_typeof(template_snapshot -> 'blocks') = 'array'
      and not template_snapshot ? 'sections'
      and not template_snapshot ? 'repeat'
      and (
        (template_id is null and template_revision is null)
        or (template_id is not null and template_revision is not null)
      )
    )
  );

alter table public.submissions
  add constraint submissions_template_snapshot_object
  check (
    jsonb_typeof(template_snapshot) = 'object'
    and template_snapshot ->> 'schemaVersion' = '2'
    and jsonb_typeof(template_snapshot -> 'branding') = 'object'
    and jsonb_typeof(template_snapshot -> 'blocks') = 'array'
    and not template_snapshot ? 'sections'
    and not template_snapshot ? 'repeat'
  );

create or replace function public.complete_document_recipient_signature(
  target_org_id uuid,
  target_document_id uuid,
  target_recipient_id uuid,
  target_token_hash text,
  target_values jsonb,
  target_signature_data jsonb,
  target_initials_data jsonb
)
returns text
language plpgsql
security invoker
set search_path = ''
as $$
declare
  answer_values jsonb;
  answer_status text;
  document_snapshot jsonb;
  merged_values jsonb;
  required_block jsonb;
  required_field_key text;
  recipient_requires_signature boolean;
  recipient_status text;
  recipient_token_expires_at timestamptz;
begin
  select answer.values, answer.workflow_status
  into answer_values, answer_status
  from public.document_answers answer
  where answer.document_id = target_document_id
    and answer.org_id = target_org_id
  for update;

  if not found then
    raise exception 'Generated document answers were not found.'
      using errcode = 'P0002';
  end if;

  if target_values is null or jsonb_typeof(target_values) <> 'object' then
    raise exception 'Document answer values must be a JSON object.'
      using errcode = '22023';
  end if;

  select document.template_snapshot
  into document_snapshot
  from public.documents document
  where document.id = target_document_id
    and document.org_id = target_org_id
    and document.source_kind = 'generated';

  if not found then
    raise exception 'Generated document snapshot was not found.'
      using errcode = 'P0002';
  end if;

  select recipient.requires_signature, recipient.status, recipient.token_expires_at
  into recipient_requires_signature, recipient_status, recipient_token_expires_at
  from public.document_signing_recipients recipient
  where recipient.id = target_recipient_id
    and recipient.document_id = target_document_id
    and recipient.org_id = target_org_id
    and recipient.token_hash = target_token_hash
  for update;

  if not found then
    raise exception 'Document signing recipient was not found.'
      using errcode = 'P0002';
  end if;

  if recipient_status = 'signed' then
    return answer_status;
  end if;

  if recipient_token_expires_at <= now() then
    raise exception 'Document signing token has expired.'
      using errcode = 'P0001';
  end if;

  if answer_status = 'completed' then
    raise exception 'Completed document answers are immutable.'
      using errcode = '23514';
  end if;

  if recipient_requires_signature and target_signature_data is null then
    raise exception 'A drawn signature is required.'
      using errcode = '22023';
  end if;

  merged_values := answer_values || target_values;

  if not exists (
    select 1
    from public.document_signing_recipients recipient
    where recipient.document_id = target_document_id
      and recipient.org_id = target_org_id
      and recipient.id <> target_recipient_id
      and recipient.requires_signature
      and recipient.status <> 'signed'
  ) then
    for required_block in
      select block
      from jsonb_array_elements(
        coalesce(document_snapshot -> 'blocks', '[]'::jsonb)
      ) as required_blocks(block)
      where coalesce((block ->> 'required')::boolean, false)
        and block ->> 'type' not in ('signature_field', 'initials_field')
    loop
      required_field_key := required_block ->> 'fieldKey';

      if required_field_key is null or required_field_key = '' then
        raise exception 'Generated document snapshot contains an invalid required field.'
          using errcode = '23514';
      end if;

      if required_block ->> 'type' = 'checkbox_field' then
        if merged_values -> required_field_key is distinct from 'true'::jsonb then
          raise exception 'Required document fields must be completed before the final signature.'
            using errcode = '22023';
        end if;
      elsif jsonb_typeof(merged_values -> required_field_key) is distinct from 'string'
          or btrim(merged_values ->> required_field_key) = '' then
        raise exception 'Required document fields must be completed before the final signature.'
          using errcode = '22023';
      end if;
    end loop;
  end if;

  update public.document_signing_recipients recipient
  set status = 'signed',
      viewed_at = coalesce(recipient.viewed_at, now()),
      signed_at = now(),
      signature_data = target_signature_data,
      initials_data = target_initials_data
  where recipient.id = target_recipient_id
    and recipient.document_id = target_document_id
    and recipient.org_id = target_org_id;

  if exists (
    select 1
    from public.document_signing_recipients recipient
    where recipient.document_id = target_document_id
      and recipient.org_id = target_org_id
      and recipient.requires_signature
      and recipient.status <> 'signed'
  ) then
    answer_status := 'awaiting_signatures';
  else
    answer_status := 'completed';
  end if;

  update public.document_answers answer
  set values = merged_values,
      workflow_status = answer_status
  where answer.document_id = target_document_id
    and answer.org_id = target_org_id;

  return answer_status;
end;
$$;

create or replace function public.validate_internal_submission_values(
  target_template_snapshot jsonb,
  target_values jsonb
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  answer record;
  matching_block jsonb;
  answer_text text;
begin
  if target_values is null or jsonb_typeof(target_values) <> 'object' then
    raise exception 'Submission values must be a JSON object.'
      using errcode = '22023';
  end if;

  for answer in
    select entry.key, entry.value
    from jsonb_each(target_values) entry
  loop
    select block
    into matching_block
    from jsonb_array_elements(
      coalesce(target_template_snapshot -> 'blocks', '[]'::jsonb)
    ) blocks(block)
    where block ->> 'fieldKey' = answer.key
    limit 1;

    if matching_block is null
        or matching_block ->> 'type' = 'file_field' then
      raise exception 'Submission value % is not a scalar field in this snapshot.', answer.key
        using errcode = '22023';
    end if;

    if matching_block ->> 'type' = 'checkbox_field' then
      if jsonb_typeof(answer.value) <> 'boolean' then
        raise exception 'Submission field % must be a boolean.', answer.key
          using errcode = '22023';
      end if;

      continue;
    end if;

    if jsonb_typeof(answer.value) <> 'string' then
      raise exception 'Submission field % must be text.', answer.key
        using errcode = '22023';
    end if;

    answer_text := answer.value #>> '{}';

    if matching_block ->> 'type' in ('signature_field', 'initials_field') then
      if char_length(answer_text) > 2800000
          or (
            answer_text <> ''
            and answer_text !~ '^data:image/(png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$'
          ) then
        raise exception 'Submission drawing field % is invalid.', answer.key
          using errcode = '22023';
      end if;

      continue;
    end if;

    if char_length(answer_text) > 20000 then
      raise exception 'Submission field % is too long.', answer.key
        using errcode = '22023';
    end if;

    if matching_block ->> 'type' = 'date_field'
        and answer_text <> ''
        and (
          answer_text !~ '^\d{4}-\d{2}-\d{2}$'
          or to_char(to_date(answer_text, 'YYYY-MM-DD'), 'YYYY-MM-DD') <> answer_text
        ) then
      raise exception 'Submission field % must be a valid date.', answer.key
        using errcode = '22023';
    end if;

    if matching_block ->> 'type' = 'dropdown_field'
        and answer_text <> ''
        and not coalesce((matching_block -> 'options') ? answer_text, false) then
      raise exception 'Submission field % must use an available option.', answer.key
        using errcode = '22023';
    end if;
  end loop;
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
    from jsonb_array_elements(
      coalesce(locked_submission.template_snapshot -> 'blocks', '[]'::jsonb)
    ) blocks(block)
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
  from jsonb_array_elements(
    coalesce(locked_submission.template_snapshot -> 'blocks', '[]'::jsonb)
  ) blocks(block)
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

revoke all on function public.complete_document_recipient_signature(
  uuid,
  uuid,
  uuid,
  text,
  jsonb,
  jsonb,
  jsonb
) from public, anon, authenticated;

revoke all on function public.validate_internal_submission_values(jsonb, jsonb)
  from public, anon, authenticated;

revoke all on function public.submit_internal_submission(
  uuid,
  uuid,
  integer,
  jsonb,
  uuid
) from public, anon, authenticated;

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
) from public, anon, authenticated;

grant execute on function public.complete_document_recipient_signature(
  uuid,
  uuid,
  uuid,
  text,
  jsonb,
  jsonb,
  jsonb
) to service_role;

grant execute on function public.validate_internal_submission_values(jsonb, jsonb)
  to service_role;

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

notify pgrst, 'reload schema';
