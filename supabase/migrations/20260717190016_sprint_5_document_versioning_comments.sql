create table public.document_comments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  document_id uuid not null,
  created_by uuid references public.profiles (id) on delete set null,
  body text not null,
  created_at timestamptz not null default now(),
  constraint document_comments_document_id_org_id_fkey
    foreign key (document_id, org_id) references public.documents (id, org_id) on delete cascade,
  constraint document_comments_body_trimmed_length
    check (body = btrim(body) and char_length(btrim(body)) between 1 and 2000)
);

create table public.document_activity_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  document_id uuid not null,
  actor_user_id uuid references public.profiles (id) on delete set null,
  event_type text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint document_activity_events_document_id_org_id_fkey
    foreign key (document_id, org_id) references public.documents (id, org_id) on delete cascade,
  constraint document_activity_events_type_check
    check (
      event_type in (
        'document.uploaded',
        'document.replaced',
        'document.commented',
        'document.archived'
      )
    ),
  constraint document_activity_events_metadata_object
    check (jsonb_typeof(metadata) = 'object')
);

create index document_comments_document_created_idx
  on public.document_comments (document_id, created_at desc);

create index document_comments_org_created_idx
  on public.document_comments (org_id, created_at desc);

create index document_comments_created_by_idx
  on public.document_comments (created_by);

create index document_activity_events_document_created_idx
  on public.document_activity_events (document_id, created_at desc);

create index document_activity_events_org_created_idx
  on public.document_activity_events (org_id, created_at desc);

create index document_activity_events_actor_user_idx
  on public.document_activity_events (actor_user_id);

insert into public.document_activity_events (
  id,
  org_id,
  document_id,
  actor_user_id,
  event_type,
  metadata,
  created_at
)
select
  gen_random_uuid(),
  version.org_id,
  version.document_id,
  version.uploaded_by,
  case
    when version.version_number = 1 then 'document.uploaded'
    else 'document.replaced'
  end,
  jsonb_build_object(
    'versionId', version.id,
    'versionNumber', version.version_number,
    'originalFilename', version.original_filename
  ),
  version.updated_at
from public.document_versions version
where version.status = 'available';

insert into public.document_activity_events (
  id,
  org_id,
  document_id,
  actor_user_id,
  event_type,
  metadata,
  created_at
)
select
  gen_random_uuid(),
  document.org_id,
  document.id,
  document.archived_by,
  'document.archived',
  jsonb_build_object('archivedAt', document.archived_at),
  document.archived_at
from public.documents document
where document.archived_at is not null;

alter table public.document_comments enable row level security;
alter table public.document_activity_events enable row level security;

alter table public.document_comments force row level security;
alter table public.document_activity_events force row level security;

grant usage on schema public to authenticated, service_role;

revoke all on table public.document_comments from anon;
revoke all on table public.document_activity_events from anon;

revoke insert, update, delete on table public.document_comments from authenticated;
revoke insert, update, delete on table public.document_activity_events from authenticated;

revoke update, delete on table public.document_comments from service_role;
revoke update, delete on table public.document_activity_events from service_role;

grant select on table public.document_comments to authenticated;
grant select on table public.document_activity_events to authenticated;

grant select, insert on table public.document_comments to service_role;
grant select, insert on table public.document_activity_events to service_role;

create policy document_comments_select_member
  on public.document_comments
  for select
  to authenticated
  using ((select public.is_organization_member(org_id)));

create policy document_activity_events_select_member
  on public.document_activity_events
  for select
  to authenticated
  using ((select public.is_organization_member(org_id)));

create or replace function public.create_pending_document_version(
  target_org_id uuid,
  target_document_id uuid,
  target_version_id uuid,
  target_storage_key text,
  target_original_filename text,
  target_content_type text,
  target_byte_size bigint,
  target_checksum_sha256 text,
  target_uploaded_by uuid
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  document_archived_at timestamptz;
  next_version_number integer;
  created_version_id uuid;
begin
  select document.archived_at
  into document_archived_at
  from public.documents document
  where document.id = target_document_id
    and document.org_id = target_org_id
  for update;

  if not found then
    raise exception 'Document not found.'
      using errcode = 'P0002';
  end if;

  if document_archived_at is not null then
    raise exception 'Archived documents cannot receive new versions.'
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
    uploaded_by
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
    target_uploaded_by
  )
  returning id into created_version_id;

  return created_version_id;
end;
$$;

create or replace function public.complete_document_version(
  target_org_id uuid,
  target_document_id uuid,
  target_version_id uuid,
  target_actor_user_id uuid
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  document_archived_at timestamptz;
  existing_current_version_id uuid;
  current_version_number integer;
  completed_version_number integer;
  completed_version_status text;
  completed_original_filename text;
begin
  select document.archived_at, document.current_version_id
  into document_archived_at, existing_current_version_id
  from public.documents document
  where document.id = target_document_id
    and document.org_id = target_org_id
  for update;

  if not found then
    raise exception 'Document not found.'
      using errcode = 'P0002';
  end if;

  if document_archived_at is not null then
    raise exception 'Archived document uploads cannot be completed.'
      using errcode = 'P0001';
  end if;

  select version.version_number, version.status, version.original_filename
  into
    completed_version_number,
    completed_version_status,
    completed_original_filename
  from public.document_versions version
  where version.id = target_version_id
    and version.document_id = target_document_id
    and version.org_id = target_org_id
  for update;

  if not found then
    raise exception 'Document version not found.'
      using errcode = 'P0002';
  end if;

  if completed_version_status <> 'upload_pending' then
    raise exception 'Document version is not pending upload.'
      using errcode = 'P0001';
  end if;

  if existing_current_version_id is not null then
    select version.version_number
    into current_version_number
    from public.document_versions version
    where version.id = existing_current_version_id
      and version.document_id = target_document_id
      and version.org_id = target_org_id;
  end if;

  update public.document_versions
  set status = 'available'
  where id = target_version_id
    and document_id = target_document_id
    and org_id = target_org_id;

  update public.documents document
  set current_version_id = case
        when completed_version_number > coalesce(current_version_number, 0)
          then target_version_id
        else document.current_version_id
      end,
      updated_by = target_actor_user_id
  where document.id = target_document_id
    and document.org_id = target_org_id;

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
    target_actor_user_id,
    case
      when completed_version_number = 1 then 'document.uploaded'
      else 'document.replaced'
    end,
    jsonb_build_object(
      'versionId', target_version_id,
      'versionNumber', completed_version_number,
      'originalFilename', completed_original_filename
    )
  );

  return true;
end;
$$;

revoke execute on function public.create_pending_document_version(
  uuid,
  uuid,
  uuid,
  text,
  text,
  text,
  bigint,
  text,
  uuid
) from public, anon, authenticated;

revoke execute on function public.complete_document_version(
  uuid,
  uuid,
  uuid,
  uuid
) from public, anon, authenticated;

grant execute on function public.create_pending_document_version(
  uuid,
  uuid,
  uuid,
  text,
  text,
  text,
  bigint,
  text,
  uuid
) to service_role;

grant execute on function public.complete_document_version(
  uuid,
  uuid,
  uuid,
  uuid
) to service_role;

notify pgrst, 'reload schema';
