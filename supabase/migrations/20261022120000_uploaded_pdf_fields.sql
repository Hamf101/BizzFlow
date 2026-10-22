-- Fields people place on an uploaded PDF for signers to fill: who signs, by
-- role, and where each of their fields sits on the pages as shown. A signed
-- copy is stamped from the upload, which itself never changes. As elsewhere,
-- signed-in users hold no privilege; the app checks each person first.

-- One set of fields per uploaded document, on the version they were placed
-- on. Its pages' sizes and turns are read from that PDF once and kept here.
create table public.document_pdf_layouts (
  document_id uuid primary key,
  org_id uuid not null,
  version_id uuid not null,
  pages jsonb not null check (jsonb_typeof(pages) = 'array' and jsonb_array_length(pages) between 1 and 2000),
  layout jsonb not null check (jsonb_typeof(layout) = 'object' and octet_length(layout::text) <= 1048576),
  revision integer not null default 1 check (revision > 0),
  updated_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (document_id, org_id),
  foreign key (document_id, org_id)
    references public.documents (id, org_id) on delete cascade,
  foreign key (version_id, document_id)
    references public.document_versions (id, document_id)
);

create index document_pdf_layouts_org_idx on public.document_pdf_layouts (org_id);
create index document_pdf_layouts_version_idx on public.document_pdf_layouts (version_id, document_id);
create index document_pdf_layouts_updated_by_idx on public.document_pdf_layouts (updated_by)
  where updated_by is not null;

-- Fields are what signers were sent: they stop changing once anyone is invited.
create function private.enforce_document_pdf_layout_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if exists (
    select 1
    from public.document_signing_recipients recipient
    where recipient.document_id = old.document_id
      and recipient.org_id = old.org_id
  ) or exists (
    select 1
    from public.document_answers answer
    where answer.document_id = old.document_id
      and answer.org_id = old.org_id
      and answer.workflow_status <> 'draft'
  ) then
    raise exception 'Fields cannot change once the PDF has been sent.'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

revoke all on function private.enforce_document_pdf_layout_update()
  from public, anon, authenticated, service_role;

create trigger document_pdf_layouts_enforce_update
  before update on public.document_pdf_layouts
  for each row execute function private.enforce_document_pdf_layout_update();

-- The role each invited signer fills on an uploaded PDF.
alter table public.document_signing_recipients
  add column signer_id uuid;

create unique index document_signing_recipients_signer_idx
  on public.document_signing_recipients (document_id, signer_id)
  where signer_id is not null;

-- What a signer attaches for an attachment field: a PDF or picture, kept
-- privately beside the document.
create table public.document_signing_attachments (
  id uuid primary key,
  org_id uuid not null,
  document_id uuid not null,
  recipient_id uuid not null,
  field_id uuid not null,
  storage_key text not null unique check (
    storage_key =
      'organizations/' || org_id::text ||
      '/documents/' || document_id::text ||
      '/attachments/' || id::text
  ),
  original_filename text not null check (
    original_filename = btrim(original_filename) and char_length(original_filename) between 1 and 255
  ),
  content_type text not null check (content_type in ('application/pdf', 'image/png', 'image/jpeg')),
  byte_size bigint not null check (byte_size between 1 and 10485760),
  status text not null default 'upload_pending' check (status in ('upload_pending', 'available')),
  created_at timestamptz not null default now(),
  unique (id, org_id),
  foreign key (document_id, org_id)
    references public.documents (id, org_id) on delete cascade,
  foreign key (recipient_id, org_id)
    references public.document_signing_recipients (id, org_id) on delete cascade
);

create index document_signing_attachments_org_idx on public.document_signing_attachments (org_id);
create index document_signing_attachments_document_idx on public.document_signing_attachments (document_id, org_id);
create index document_signing_attachments_recipient_idx on public.document_signing_attachments (recipient_id, org_id);

alter table public.document_pdf_layouts enable row level security;
alter table public.document_pdf_layouts force row level security;
alter table public.document_signing_attachments enable row level security;
alter table public.document_signing_attachments force row level security;

revoke all on table public.document_pdf_layouts from anon, authenticated, service_role;
revoke all on table public.document_signing_attachments from anon, authenticated, service_role;
grant select, insert, update on table public.document_pdf_layouts to service_role;
grant select, insert, update (status) on table public.document_signing_attachments to service_role;

-- Answers belong to a generated document, or hold an uploaded PDF's field values.
create or replace function public.enforce_generated_document_answer()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.documents document
    where document.id = new.document_id
      and document.org_id = new.org_id
      and document.source_kind in ('generated', 'upload')
  ) then
    raise exception 'Document answers require a generated document or an uploaded PDF''s fields.'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_generated_document_answer()
  from public, anon, authenticated;

-- An uploaded PDF's field values skip template visibility, which only a generated document has.
create or replace function private.enforce_document_answer_visibility()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  document_snapshot jsonb;
  pre_patch_values jsonb;
  changed_values jsonb;
  removed_key text;
begin
  if new.values is null or jsonb_typeof(new.values) <> 'object' then
    raise exception 'Document answer values must be a JSON object.'
      using errcode = '22023';
  end if;

  -- An upload's answers are its fields' values, checked as each signer signs.
  if exists (
    select 1
    from public.documents document
    where document.id = new.document_id
      and document.org_id = new.org_id
      and document.source_kind = 'upload'
  ) then
    return new;
  end if;

  select document.template_snapshot
  into document_snapshot
  from public.documents document
  where document.id = new.document_id
    and document.org_id = new.org_id
    and document.source_kind = 'generated';

  if not found then
    raise exception 'Generated document snapshot was not found.'
      using errcode = 'P0002';
  end if;

  if tg_op = 'INSERT' then
    new.values := private.prune_template_scalar_values(
      document_snapshot,
      new.values
    );
    return new;
  end if;

  -- First remove answers that were already hidden in the persisted state. Then
  -- apply only the caller's changed/new keys and prune again under the resulting
  -- controller values. This prevents an unchanged stale answer from reappearing
  -- when a controller changes from hidden to visible.
  pre_patch_values := private.prune_template_scalar_values(
    document_snapshot,
    old.values
  );

  for removed_key in
    select old_entry.key
    from jsonb_each(old.values) old_entry
    where not new.values ? old_entry.key
  loop
    pre_patch_values := pre_patch_values - removed_key;
  end loop;

  select coalesce(jsonb_object_agg(entry.key, entry.value), '{}'::jsonb)
  into changed_values
  from jsonb_each(new.values) entry
  where not old.values ? entry.key
    or old.values -> entry.key is distinct from entry.value;

  new.values := private.prune_template_scalar_values(
    document_snapshot,
    pre_patch_values || changed_values
  );

  return new;
end;
$$;

revoke all on function private.enforce_document_answer_visibility()
  from public, anon, authenticated, service_role;

-- Keeps one signer's values for the fields that are theirs, with their drawn
-- signature and initials, and completes the document once everyone has
-- signed. A value for anyone else's field, or a required field left empty,
-- turns the whole signing away.
create function public.complete_pdf_recipient_signature(
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
  fields jsonb;
  field jsonb;
  given text;
  recipient_requires_signature boolean;
  recipient_signer uuid;
  recipient_status text;
  recipient_token_expires_at timestamptz;
begin
  if target_values is null or jsonb_typeof(target_values) <> 'object' then
    raise exception 'Field values must be a JSON object.'
      using errcode = '22023';
  end if;

  select answer.values, answer.workflow_status
  into answer_values, answer_status
  from public.document_answers answer
  where answer.document_id = target_document_id
    and answer.org_id = target_org_id
  for update;

  if not found then
    raise exception 'Document answers were not found.'
      using errcode = 'P0002';
  end if;

  select layout.layout -> 'fields'
  into fields
  from public.document_pdf_layouts layout
  join public.documents document
    on document.id = layout.document_id
    and document.org_id = layout.org_id
  where layout.document_id = target_document_id
    and layout.org_id = target_org_id
    and document.source_kind = 'upload';

  if not found or fields is null or jsonb_typeof(fields) <> 'array' then
    raise exception 'This document has no fields to fill.'
      using errcode = 'P0002';
  end if;

  select recipient.signer_id, recipient.requires_signature, recipient.status, recipient.token_expires_at
  into recipient_signer, recipient_requires_signature, recipient_status, recipient_token_expires_at
  from public.document_signing_recipients recipient
  where recipient.id = target_recipient_id
    and recipient.document_id = target_document_id
    and recipient.org_id = target_org_id
    and recipient.token_hash = target_token_hash
  for update;

  if not found or recipient_signer is null then
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

  if answer_status <> 'awaiting_signatures' then
    raise exception 'This document is not waiting for signatures.'
      using errcode = '23514';
  end if;

  if recipient_requires_signature and target_signature_data is null then
    raise exception 'A drawn signature is required.'
      using errcode = '22023';
  end if;

  for given in select jsonb_object_keys(target_values) loop
    if not exists (
      select 1
      from jsonb_array_elements(fields) candidate
      where candidate ->> 'id' = given
        and candidate ->> 'signerId' = recipient_signer::text
        and candidate ->> 'kind' in ('text', 'date', 'checkbox', 'attachment')
    ) then
      raise exception 'A value was given for a field that is not this signer''s.'
        using errcode = '22023';
    end if;
  end loop;

  for field in
    select candidate
    from jsonb_array_elements(fields) candidate
    where candidate ->> 'signerId' = recipient_signer::text
  loop
    if field ->> 'kind' = 'attachment' and target_values ? (field ->> 'id') and not exists (
      select 1
      from public.document_signing_attachments attachment
      where attachment.id::text = target_values ->> (field ->> 'id')
        and attachment.org_id = target_org_id
        and attachment.document_id = target_document_id
        and attachment.recipient_id = target_recipient_id
        and attachment.field_id::text = field ->> 'id'
        and attachment.status = 'available'
    ) then
      raise exception 'An attachment is missing.'
        using errcode = '22023';
    end if;

    continue when coalesce((field ->> 'required')::boolean, true) is false;

    if field ->> 'kind' = 'signature' and target_signature_data is null then
      raise exception 'A drawn signature is required.'
        using errcode = '22023';
    elsif field ->> 'kind' = 'initials' and target_initials_data is null then
      raise exception 'Drawn initials are required.'
        using errcode = '22023';
    elsif field ->> 'kind' in ('text', 'date', 'attachment')
        and coalesce(btrim(target_values ->> (field ->> 'id')), '') = '' then
      raise exception 'Fill in every required field.'
        using errcode = '22023';
    elsif field ->> 'kind' = 'checkbox'
        and (target_values -> (field ->> 'id')) is distinct from 'true'::jsonb then
      raise exception 'Tick every required box.'
        using errcode = '22023';
    end if;
  end loop;

  update public.document_answers answer
  set values = answer_values || target_values,
      updated_at = now()
  where answer.document_id = target_document_id
    and answer.org_id = target_org_id;

  update public.document_signing_recipients recipient
  set status = 'signed',
      signed_at = now(),
      viewed_at = coalesce(recipient.viewed_at, now()),
      signature_data = target_signature_data,
      initials_data = target_initials_data
  where recipient.id = target_recipient_id
    and recipient.org_id = target_org_id;

  if exists (
    select 1
    from public.document_signing_recipients recipient
    where recipient.document_id = target_document_id
      and recipient.org_id = target_org_id
      and recipient.status <> 'signed'
  ) then
    return answer_status;
  end if;

  update public.document_answers answer
  set workflow_status = 'completed',
      updated_at = now()
  where answer.document_id = target_document_id
    and answer.org_id = target_org_id;

  return 'completed';
end;
$$;

revoke all on function public.complete_pdf_recipient_signature(uuid, uuid, uuid, text, jsonb, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.complete_pdf_recipient_signature(uuid, uuid, uuid, text, jsonb, jsonb, jsonb)
  to service_role;

-- A signed upload finalizes the way a generated document does: a stamped copy,
-- stored once and never changed, becomes the document's newest version.
create or replace function public.prepare_generated_document_finalization(
  target_org_id uuid,
  target_document_id uuid,
  target_finalization_id uuid,
  target_storage_key text,
  target_render_input_sha256 text,
  target_created_by uuid
)
returns table (
  id uuid,
  status text,
  storage_key text,
  render_input_sha256 text,
  pdf_sha256 text,
  byte_size bigint,
  document_version_id uuid,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  answer_status text;
  document_source_kind text;
  document_archived_at timestamptz;
  expected_storage_key text;
  prepared_finalization public.generated_document_finalizations%rowtype;
begin
  if target_org_id is null
      or target_document_id is null
      or target_finalization_id is null
      or target_created_by is null then
    raise exception 'Finalization identifiers are required.'
      using errcode = '22023';
  end if;

  if target_render_input_sha256 is null
      or target_render_input_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'Finalization input hash is invalid.'
      using errcode = '22023';
  end if;

  expected_storage_key :=
    'organizations/' || target_org_id::text ||
    '/documents/' || target_document_id::text ||
    '/finalizations/' || target_finalization_id::text ||
    '/final.pdf';

  if target_storage_key is distinct from expected_storage_key then
    raise exception 'Finalization storage key is invalid.'
      using errcode = '22023';
  end if;

  select answer.workflow_status
  into answer_status
  from public.document_answers answer
  where answer.document_id = target_document_id
    and answer.org_id = target_org_id
  for update;

  if not found then
    raise exception 'Generated document answers were not found.'
      using errcode = 'P0002';
  end if;

  if answer_status <> 'completed' then
    raise exception 'Generated document is not ready to finalize.'
      using errcode = 'P0001';
  end if;

  select document.source_kind, document.archived_at
  into document_source_kind, document_archived_at
  from public.documents document
  where document.id = target_document_id
    and document.org_id = target_org_id
  for update;

  if not found or document_source_kind not in ('generated', 'upload') then
    raise exception 'Generated document was not found.'
      using errcode = 'P0002';
  end if;

  if document_archived_at is not null then
    raise exception 'Archived documents cannot be finalized.'
      using errcode = 'P0001';
  end if;

  -- A pending attempt prepared from other input never completes: its hash
  -- check fails on every retry. Only a pending one is discarded; a finalized
  -- row is immutable and is joined or refused below as before.
  delete from public.generated_document_finalizations finalization
  where finalization.document_id = target_document_id
    and finalization.org_id = target_org_id
    and finalization.status = 'pending'
    and finalization.render_input_sha256 <> target_render_input_sha256;

  insert into public.generated_document_finalizations (
    id,
    org_id,
    document_id,
    status,
    storage_key,
    render_input_sha256,
    created_by
  )
  values (
    target_finalization_id,
    target_org_id,
    target_document_id,
    'pending',
    target_storage_key,
    target_render_input_sha256,
    target_created_by
  )
  on conflict (document_id) do nothing;

  select finalization.*
  into prepared_finalization
  from public.generated_document_finalizations finalization
  where finalization.document_id = target_document_id
    and finalization.org_id = target_org_id
  for update;

  if not found then
    raise exception 'Generated document finalization could not be prepared.'
      using errcode = 'P0002';
  end if;

  -- A concurrent request may have won the one-row-per-document insert with a
  -- different candidate id. Join that row when the immutable render input is
  -- identical; its storage key is already enforced by the table constraint.
  if prepared_finalization.render_input_sha256 <> target_render_input_sha256 then
    raise exception 'Finalization input does not match the prepared record.'
      using errcode = '23514';
  end if;

  return query
  select
    prepared_finalization.id,
    prepared_finalization.status,
    prepared_finalization.storage_key,
    prepared_finalization.render_input_sha256,
    prepared_finalization.pdf_sha256,
    prepared_finalization.byte_size,
    prepared_finalization.document_version_id,
    prepared_finalization.created_at;
end;
$$;

revoke all on function public.prepare_generated_document_finalization(
  uuid,
  uuid,
  uuid,
  text,
  text,
  uuid
) from public, anon, authenticated;

grant execute on function public.prepare_generated_document_finalization(
  uuid,
  uuid,
  uuid,
  text,
  text,
  uuid
) to service_role;

create or replace function public.promote_generated_document_finalization(
  target_org_id uuid,
  target_document_id uuid,
  target_finalization_id uuid,
  target_pdf_sha256 text,
  target_byte_size bigint,
  target_original_filename text,
  target_finalized_by uuid
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  answer_status text;
  document_source_kind text;
  document_archived_at timestamptz;
  locked_finalization public.generated_document_finalizations%rowtype;
  next_version_number integer;
  created_version_id uuid;
begin
  if target_org_id is null
      or target_document_id is null
      or target_finalization_id is null
      or target_finalized_by is null then
    raise exception 'Finalization identifiers are required.'
      using errcode = '22023';
  end if;

  if target_pdf_sha256 is null or target_pdf_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'Final PDF hash is invalid.'
      using errcode = '22023';
  end if;

  if target_byte_size is null or target_byte_size <= 0 then
    raise exception 'Final PDF byte size is invalid.'
      using errcode = '22023';
  end if;

  if target_original_filename is null
      or target_original_filename <> btrim(target_original_filename)
      or char_length(target_original_filename) not between 1 and 255 then
    raise exception 'Final PDF filename is invalid.'
      using errcode = '22023';
  end if;

  select answer.workflow_status
  into answer_status
  from public.document_answers answer
  where answer.document_id = target_document_id
    and answer.org_id = target_org_id
  for update;

  if not found then
    raise exception 'Generated document answers were not found.'
      using errcode = 'P0002';
  end if;

  if answer_status <> 'completed' then
    raise exception 'Generated document is not ready to finalize.'
      using errcode = 'P0001';
  end if;

  select document.source_kind, document.archived_at
  into document_source_kind, document_archived_at
  from public.documents document
  where document.id = target_document_id
    and document.org_id = target_org_id
  for update;

  if not found or document_source_kind not in ('generated', 'upload') then
    raise exception 'Generated document was not found.'
      using errcode = 'P0002';
  end if;

  select finalization.*
  into locked_finalization
  from public.generated_document_finalizations finalization
  where finalization.id = target_finalization_id
    and finalization.document_id = target_document_id
    and finalization.org_id = target_org_id
  for update;

  if not found then
    raise exception 'Generated document finalization was not found.'
      using errcode = 'P0002';
  end if;

  if locked_finalization.status = 'finalized' then
    if locked_finalization.pdf_sha256 <> target_pdf_sha256
        or locked_finalization.byte_size <> target_byte_size then
      raise exception 'Final PDF evidence does not match the finalized record.'
        using errcode = '23514';
    end if;

    return locked_finalization.document_version_id;
  end if;

  -- A lost response may be retried after the document is archived. Exact
  -- finalized replays above remain idempotent; only new promotion is blocked.
  if document_archived_at is not null then
    raise exception 'Archived documents cannot be finalized.'
      using errcode = 'P0001';
  end if;

  if locked_finalization.status <> 'pending' then
    raise exception 'Generated document finalization has an invalid state.'
      using errcode = '23514';
  end if;

  select coalesce(max(version.version_number), 0) + 1
  into next_version_number
  from public.document_versions version
  where version.document_id = target_document_id
    and version.org_id = target_org_id;

  created_version_id := gen_random_uuid();

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
    uploaded_by
  )
  values (
    created_version_id,
    target_org_id,
    target_document_id,
    next_version_number,
    'available',
    locked_finalization.storage_key,
    target_original_filename,
    'application/pdf',
    target_byte_size,
    target_pdf_sha256,
    target_finalized_by
  );

  update public.documents document
  set current_version_id = created_version_id,
      updated_by = target_finalized_by
  where document.id = target_document_id
    and document.org_id = target_org_id;

  update public.generated_document_finalizations finalization
  set status = 'finalized',
      pdf_sha256 = target_pdf_sha256,
      byte_size = target_byte_size,
      document_version_id = created_version_id,
      finalized_by = target_finalized_by,
      finalized_at = now()
  where finalization.id = target_finalization_id
    and finalization.document_id = target_document_id
    and finalization.org_id = target_org_id;

  insert into public.document_activity_events (
    id,
    org_id,
    document_id,
    actor_user_id,
    event_type,
    metadata
  )
  values (
    gen_random_uuid(),
    target_org_id,
    target_document_id,
    target_finalized_by,
    'document.finalized',
    jsonb_build_object(
      'finalizationId', target_finalization_id,
      'versionId', created_version_id,
      'versionNumber', next_version_number,
      'pdfSha256', target_pdf_sha256,
      'byteSize', target_byte_size
    )
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
    target_finalized_by,
    'document.finalized',
    'document',
    target_document_id,
    jsonb_build_object(
      'finalizationId', target_finalization_id,
      'versionId', created_version_id,
      'versionNumber', next_version_number,
      'pdfSha256', target_pdf_sha256,
      'byteSize', target_byte_size
    )
  );

  return created_version_id;
end;
$$;

revoke all on function public.promote_generated_document_finalization(
  uuid,
  uuid,
  uuid,
  text,
  bigint,
  text,
  uuid
) from public, anon, authenticated;

grant execute on function public.promote_generated_document_finalization(
  uuid,
  uuid,
  uuid,
  text,
  bigint,
  text,
  uuid
) to service_role;
