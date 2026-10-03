-- Signing and document guards.
--
-- 1. complete_document_recipient_signature, from its latest version in
--    20261001120000_structured_answer_kinds, now requires an active document,
--    refuses a drawn box (signature or initials) or any unknown field as an
--    answer, checks each answer's shape, and keeps an answer someone else has
--    signed as they signed it, all under the answer row's existing lock. A
--    signer's drawing lives only on their own recipient row, so no one can
--    sign another's box.
-- 2. A generated document's versions are its finalized PDF alone:
--    create_pending_document_version (latest in
--    20260803160319_document_upload_authorization_barrier) takes uploads only,
--    a trigger refuses any other version of a generated document, and once a
--    document is finalized its current version cannot move off that PDF.
-- 3. Audit evidence is append-only for the service role too: it keeps select
--    and insert on audit_logs, document_comments and document_activity_events,
--    and loses truncate, references and trigger (update and delete it already
--    lacks). A statement trigger refuses truncate for every role.
--
-- `create or replace` keeps each redefined function's grants.

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
  patch_entry record;
  answer_values jsonb;
  persisted_answer_values jsonb;
  answer_status text;
  document_snapshot jsonb;
  document_lifecycle_state public.resource_lifecycle_state;
  matching_block jsonb;
  others_signed boolean;
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

  select document.template_snapshot, document.lifecycle_state
  into document_snapshot, document_lifecycle_state
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

  if document_lifecycle_state <> 'active' then
    raise exception 'Only active documents may be modified.'
      using errcode = 'P0001';
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

  persisted_answer_values := answer_values;
  answer_values := private.prune_template_scalar_values(
    document_snapshot,
    answer_values
  );

  if answer_values is distinct from persisted_answer_values then
    update public.document_answers answer
    set values = answer_values
    where answer.document_id = target_document_id
      and answer.org_id = target_org_id;
  end if;

  -- Under the answer row's lock: once someone else has signed, an answer that
  -- had a value stays as they signed it. A drawn box is never an answer; each
  -- signer's drawing is kept on their own recipient row.
  others_signed := exists (
    select 1
    from public.document_signing_recipients recipient
    where recipient.document_id = target_document_id
      and recipient.org_id = target_org_id
      and recipient.id <> target_recipient_id
      and recipient.status = 'signed'
  );

  for patch_entry in
    select entry.key, entry.value
    from jsonb_each(target_values) entry
  loop
    select block
    into matching_block
    from jsonb_array_elements(
      coalesce(document_snapshot -> 'blocks', '[]'::jsonb)
    ) blocks(block)
    where block ->> 'fieldKey' = patch_entry.key
    limit 1;

    if matching_block is null
        or matching_block ->> 'type' in ('file_field', 'signature_field', 'initials_field') then
      raise exception 'Document answer % is not an answerable field.', patch_entry.key
        using errcode = '22023';
    end if;

    if not private.template_answer_has_valid_shape(matching_block, patch_entry.value) then
      raise exception 'Document answer % does not fit its field.', patch_entry.key
        using errcode = '22023';
    end if;

    if others_signed
        and coalesce(answer_values -> patch_entry.key, 'null'::jsonb) not in ('null'::jsonb, '""'::jsonb)
        and answer_values -> patch_entry.key is distinct from patch_entry.value then
      raise exception 'Someone has already signed. Send it again to change the answers.'
        using errcode = '23514';
    end if;
  end loop;

  merged_values := private.prune_template_scalar_values(
    document_snapshot,
    answer_values || target_values
  );

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
        and private.template_block_is_visible(
          document_snapshot,
          block ->> 'id',
          merged_values
        )
    loop
      required_field_key := required_block ->> 'fieldKey';

      if required_field_key is null or required_field_key = '' then
        raise exception 'Generated document snapshot contains an invalid required field.'
          using errcode = '23514';
      end if;

      if not private.template_answer_is_complete(
        required_block,
        merged_values -> required_field_key
      ) then
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

create or replace function public.create_pending_document_version(
  target_org_id uuid,
  target_document_id uuid,
  target_version_id uuid,
  target_storage_key text,
  target_original_filename text,
  target_content_type text,
  target_byte_size bigint,
  target_checksum_sha256 text,
  target_uploaded_by uuid,
  target_upload_authorization_expires_at timestamptz default null
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  document_lifecycle_state public.resource_lifecycle_state;
  document_source_kind text;
  next_version_number integer;
  created_version_id uuid;
begin
  if target_upload_authorization_expires_at is not null
      and target_upload_authorization_expires_at <= clock_timestamp() then
    raise exception 'Upload authorization expiry must be in the future.'
      using errcode = '22023';
  end if;

  select document.lifecycle_state, document.source_kind
  into document_lifecycle_state, document_source_kind
  from public.documents document
  where document.id = target_document_id
    and document.org_id = target_org_id
  for update;

  if not found then
    raise exception 'Document not found.'
      using errcode = 'P0002';
  end if;

  if document_lifecycle_state <> 'active' then
    raise exception 'Only active documents can receive new versions.'
      using errcode = 'P0001';
  end if;

  if document_source_kind <> 'upload' then
    raise exception 'Only uploaded documents can receive uploaded versions.'
      using errcode = 'P0001';
  end if;

  select coalesce(max(version.version_number), 0) + 1
  into next_version_number
  from public.document_versions version
  where version.document_id = target_document_id
    and version.org_id = target_org_id;

  insert into public.document_versions (
    id,
    org_id,
    document_id,
    version_number,
    status,
    storage_key,
    original_filename,
    content_type,
    byte_size,
    checksum_sha256,
    uploaded_by,
    upload_authorization_expires_at
  )
  values (
    target_version_id,
    target_org_id,
    target_document_id,
    next_version_number,
    'upload_pending',
    target_storage_key,
    target_original_filename,
    target_content_type,
    target_byte_size,
    target_checksum_sha256,
    target_uploaded_by,
    coalesce(
      target_upload_authorization_expires_at,
      clock_timestamp() + interval '7 days'
    )
  )
  returning id into created_version_id;

  return created_version_id;
end;
$$;

-- Promotion inserts the finalized PDF's version while its finalization is
-- still pending and holds that finalization's storage key; nothing else may
-- add a version to a generated document.
create or replace function private.refuse_generated_document_upload_version()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
      select 1
      from public.documents document
      where document.id = new.document_id
        and document.org_id = new.org_id
        and document.source_kind = 'generated'
    )
    and not exists (
      select 1
      from public.generated_document_finalizations finalization
      where finalization.document_id = new.document_id
        and finalization.org_id = new.org_id
        and finalization.status = 'pending'
        and finalization.storage_key = new.storage_key
    ) then
    raise exception 'A generated document takes only its finalized PDF as a version.'
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

revoke all on function private.refuse_generated_document_upload_version()
  from public, anon, authenticated, service_role;

drop trigger if exists document_versions_refuse_generated_uploads
  on public.document_versions;
create trigger document_versions_refuse_generated_uploads
  before insert on public.document_versions
  for each row execute function private.refuse_generated_document_upload_version();

-- Promotion moves current_version_id before it marks the finalization
-- finalized, so only a later change is refused.
create or replace function private.keep_finalized_document_version()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  finalized_version_id uuid;
begin
  select finalization.document_version_id
  into finalized_version_id
  from public.generated_document_finalizations finalization
  where finalization.document_id = new.id
    and finalization.org_id = new.org_id
    and finalization.status = 'finalized';

  if found and new.current_version_id is distinct from finalized_version_id then
    raise exception 'A finalized document keeps its finalized version.'
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

revoke all on function private.keep_finalized_document_version()
  from public, anon, authenticated, service_role;

drop trigger if exists documents_keep_finalized_version
  on public.documents;
create trigger documents_keep_finalized_version
  before update of current_version_id on public.documents
  for each row execute function private.keep_finalized_document_version();

-- Services read and append evidence; nothing rewrites or empties it.
revoke truncate, update, delete, references, trigger
  on public.audit_logs, public.document_comments, public.document_activity_events
  from service_role;

create or replace function private.refuse_evidence_truncate()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception '% is append-only evidence and cannot be truncated.', tg_table_name
    using errcode = '42501';
end;
$$;

revoke all on function private.refuse_evidence_truncate()
  from public, anon, authenticated, service_role;

drop trigger if exists audit_logs_refuse_truncate on public.audit_logs;
create trigger audit_logs_refuse_truncate
  before truncate on public.audit_logs
  for each statement execute function private.refuse_evidence_truncate();

drop trigger if exists document_comments_refuse_truncate on public.document_comments;
create trigger document_comments_refuse_truncate
  before truncate on public.document_comments
  for each statement execute function private.refuse_evidence_truncate();

drop trigger if exists document_activity_events_refuse_truncate on public.document_activity_events;
create trigger document_activity_events_refuse_truncate
  before truncate on public.document_activity_events
  for each statement execute function private.refuse_evidence_truncate();

notify pgrst, 'reload schema';
