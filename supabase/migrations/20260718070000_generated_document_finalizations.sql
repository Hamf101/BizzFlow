create table public.generated_document_finalizations (
  id uuid primary key,
  org_id uuid not null references public.organizations (id) on delete cascade,
  document_id uuid not null,
  status text not null default 'pending',
  storage_key text not null unique,
  render_input_sha256 text not null,
  pdf_sha256 text,
  byte_size bigint,
  document_version_id uuid unique,
  created_by uuid references public.profiles (id) on delete set null,
  finalized_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  finalized_at timestamptz,
  unique (document_id),
  constraint generated_document_finalizations_document_id_org_id_fkey
    foreign key (document_id, org_id)
    references public.documents (id, org_id)
    on delete cascade,
  constraint generated_document_finalizations_version_document_fkey
    foreign key (document_version_id, document_id)
    references public.document_versions (id, document_id),
  constraint generated_document_finalizations_status_check
    check (status in ('pending', 'finalized')),
  constraint generated_document_finalizations_storage_key_check
    check (
      char_length(storage_key) between 1 and 1024
      and storage_key =
        'organizations/' || org_id::text ||
        '/documents/' || document_id::text ||
        '/finalizations/' || id::text ||
        '/final.pdf'
    ),
  constraint generated_document_finalizations_render_hash_check
    check (render_input_sha256 ~ '^[0-9a-f]{64}$'),
  constraint generated_document_finalizations_pdf_hash_check
    check (pdf_sha256 is null or pdf_sha256 ~ '^[0-9a-f]{64}$'),
  constraint generated_document_finalizations_byte_size_check
    check (byte_size is null or byte_size > 0),
  constraint generated_document_finalizations_state_check
    check (
      (
        status = 'pending'
        and pdf_sha256 is null
        and byte_size is null
        and document_version_id is null
        and finalized_by is null
        and finalized_at is null
      )
      or
      (
        status = 'finalized'
        and pdf_sha256 is not null
        and byte_size is not null
        and document_version_id is not null
        and finalized_at is not null
      )
    )
);

create index generated_document_finalizations_org_status_created_idx
  on public.generated_document_finalizations (org_id, status, created_at desc);

create index generated_document_finalizations_created_by_idx
  on public.generated_document_finalizations (created_by)
  where created_by is not null;

create index generated_document_finalizations_finalized_by_idx
  on public.generated_document_finalizations (finalized_by)
  where finalized_by is not null;

create or replace function public.enforce_generated_document_finalization_update()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  created_by_cleanup boolean;
  finalized_by_cleanup boolean;
begin
  -- Actor references follow the project's audit convention: deleting a profile
  -- may redact its UUID, but cannot replace it with a different identity.
  created_by_cleanup :=
    new.created_by is not distinct from old.created_by
    or (old.created_by is not null and new.created_by is null);
  finalized_by_cleanup :=
    new.finalized_by is not distinct from old.finalized_by
    or (old.finalized_by is not null and new.finalized_by is null);

  if old.status = 'finalized' then
    if row(
        new.id,
        new.org_id,
        new.document_id,
        new.status,
        new.storage_key,
        new.render_input_sha256,
        new.pdf_sha256,
        new.byte_size,
        new.document_version_id,
        new.created_at,
        new.finalized_at
      ) is distinct from row(
        old.id,
        old.org_id,
        old.document_id,
        old.status,
        old.storage_key,
        old.render_input_sha256,
        old.pdf_sha256,
        old.byte_size,
        old.document_version_id,
        old.created_at,
        old.finalized_at
      )
      or not created_by_cleanup
      or not finalized_by_cleanup then
      raise exception 'Finalized generated documents are immutable.'
        using errcode = '23514';
    end if;

    return new;
  end if;

  if new.id is distinct from old.id
      or new.org_id is distinct from old.org_id
      or new.document_id is distinct from old.document_id
      or new.storage_key is distinct from old.storage_key
      or new.render_input_sha256 is distinct from old.render_input_sha256
      or not created_by_cleanup
      or new.created_at is distinct from old.created_at then
    raise exception 'Generated document finalization identity is immutable.'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_generated_document_finalization_update()
  from public, anon, authenticated, service_role;

create trigger generated_document_finalizations_enforce_update
  before update on public.generated_document_finalizations
  for each row execute function public.enforce_generated_document_finalization_update();

alter table public.document_activity_events
  drop constraint document_activity_events_type_check;

alter table public.document_activity_events
  add constraint document_activity_events_type_check
  check (
    event_type in (
      'document.uploaded',
      'document.replaced',
      'document.commented',
      'document.archived',
      'document.finalized'
    )
  );

alter table public.generated_document_finalizations enable row level security;
alter table public.generated_document_finalizations force row level security;

grant usage on schema public to authenticated, service_role;

revoke all on table public.generated_document_finalizations
  from anon, authenticated, service_role;

grant select on table public.generated_document_finalizations to authenticated;
grant select, insert, update on table public.generated_document_finalizations
  to service_role;

create policy generated_document_finalizations_select_member
  on public.generated_document_finalizations
  for select
  to authenticated
  using ((select public.is_organization_member(org_id)));

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
security invoker
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

  if not found or document_source_kind <> 'generated' then
    raise exception 'Generated document was not found.'
      using errcode = 'P0002';
  end if;

  if document_archived_at is not null then
    raise exception 'Archived documents cannot be finalized.'
      using errcode = 'P0001';
  end if;

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

  if not found or document_source_kind <> 'generated' then
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

revoke all on function public.prepare_generated_document_finalization(
  uuid,
  uuid,
  uuid,
  text,
  text,
  uuid
) from public, anon, authenticated;

revoke all on function public.promote_generated_document_finalization(
  uuid,
  uuid,
  uuid,
  text,
  bigint,
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

grant execute on function public.promote_generated_document_finalization(
  uuid,
  uuid,
  uuid,
  text,
  bigint,
  text,
  uuid
) to service_role;

notify pgrst, 'reload schema';
