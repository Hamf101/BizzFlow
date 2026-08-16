-- Durable document and folder purge state machine.
--
-- R2 deletion is executed by the application between the leasing and
-- completion RPCs. Database resources remain purge_pending until every
-- deduplicated object is confirmed absent and finalization succeeds.

create table public.resource_purge_jobs (
  id uuid primary key,
  org_id uuid not null
    references public.organizations (id) on delete cascade,
  root_resource_kind text not null,
  root_resource_id uuid not null,
  request_kind text not null,
  requested_by uuid
    references public.profiles (id) on delete set null,
  status text not null default 'queued',
  attempt_count smallint not null default 0,
  max_attempts smallint not null default 5,
  available_at timestamptz not null default now(),
  lease_token uuid,
  lease_expires_at timestamptz,
  last_error_code text,
  requested_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  failed_at timestamptz,
  unique (id, org_id),
  unique (org_id, root_resource_kind, root_resource_id),
  constraint resource_purge_jobs_root_kind_check
    check (root_resource_kind in ('document', 'folder')),
  constraint resource_purge_jobs_request_kind_check
    check (request_kind in ('automatic', 'manual')),
  constraint resource_purge_jobs_status_check
    check (
      status in (
        'queued',
        'processing',
        'retry_wait',
        'completed',
        'failed'
      )
    ),
  constraint resource_purge_jobs_attempts_check
    check (
      attempt_count between 0 and max_attempts
      and max_attempts between 1 and 10
    ),
  constraint resource_purge_jobs_error_code_check
    check (
      last_error_code is null
      or (
        last_error_code ~ '^[a-z][a-z0-9_]{2,63}$'
        and char_length(last_error_code) between 3 and 64
      )
    ),
  constraint resource_purge_jobs_lease_shape
    check (
      (lease_token is null and lease_expires_at is null)
      or (
        status = 'processing'
        and lease_token is not null
        and lease_expires_at is not null
      )
    )
);

create table public.resource_purge_members (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null
    references public.resource_purge_jobs (id) on delete cascade,
  org_id uuid not null,
  resource_kind text not null,
  resource_id uuid not null,
  depth integer not null default 0,
  unique (job_id, resource_kind, resource_id),
  unique (org_id, resource_kind, resource_id),
  constraint resource_purge_members_kind_check
    check (resource_kind in ('document', 'folder')),
  constraint resource_purge_members_depth_check
    check (depth between 0 and 1024),
  constraint resource_purge_members_job_org_fkey
    foreign key (job_id, org_id)
    references public.resource_purge_jobs (id, org_id)
    on delete cascade
);

create table public.resource_purge_objects (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null,
  org_id uuid not null,
  object_kind text not null default 'document_storage',
  storage_key text not null,
  status text not null default 'pending',
  attempt_count smallint not null default 0,
  max_attempts smallint not null default 5,
  available_at timestamptz not null default now(),
  lease_token uuid,
  lease_expires_at timestamptz,
  last_error_code text,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (job_id, storage_key),
  constraint resource_purge_objects_job_org_fkey
    foreign key (job_id, org_id)
    references public.resource_purge_jobs (id, org_id)
    on delete cascade,
  constraint resource_purge_objects_kind_check
    check (object_kind = 'document_storage'),
  constraint resource_purge_objects_storage_key_check
    check (char_length(storage_key) between 1 and 1024),
  constraint resource_purge_objects_status_check
    check (
      status in (
        'pending',
        'processing',
        'retry_wait',
        'deleted',
        'failed'
      )
    ),
  constraint resource_purge_objects_attempts_check
    check (
      attempt_count between 0 and max_attempts
      and max_attempts between 1 and 10
    ),
  constraint resource_purge_objects_error_code_check
    check (
      last_error_code is null
      or (
        last_error_code ~ '^[a-z][a-z0-9_]{2,63}$'
        and char_length(last_error_code) between 3 and 64
      )
    ),
  constraint resource_purge_objects_state_shape
    check (
      (
        status = 'processing'
        and lease_token is not null
        and lease_expires_at is not null
        and deleted_at is null
      )
      or (
        status = 'deleted'
        and lease_token is null
        and lease_expires_at is null
        and deleted_at is not null
      )
      or (
        status in ('pending', 'retry_wait', 'failed')
        and lease_token is null
        and lease_expires_at is null
        and deleted_at is null
      )
    )
);

create table public.resource_purge_tombstones (
  org_id uuid not null
    references public.organizations (id) on delete cascade,
  resource_kind text not null,
  resource_id uuid not null,
  root_job_id uuid not null,
  purged_at timestamptz not null,
  primary key (org_id, resource_kind, resource_id),
  constraint resource_purge_tombstones_kind_check
    check (resource_kind in ('document', 'folder'))
);

create table public.resource_purge_receipts (
  id uuid primary key,
  job_id uuid not null unique,
  org_id uuid not null
    references public.organizations (id) on delete cascade,
  root_resource_kind text not null,
  root_resource_id uuid not null,
  request_kind text not null,
  requested_by uuid
    references public.profiles (id) on delete set null,
  object_count integer not null,
  document_count integer not null,
  folder_count integer not null,
  purged_at timestamptz not null,
  constraint resource_purge_receipts_root_kind_check
    check (root_resource_kind in ('document', 'folder')),
  constraint resource_purge_receipts_request_kind_check
    check (request_kind in ('automatic', 'manual')),
  constraint resource_purge_receipts_counts_check
    check (
      object_count >= 0
      and document_count >= 0
      and folder_count >= 0
    )
);

create index resource_purge_jobs_ready_idx
  on public.resource_purge_jobs (status, available_at, requested_at)
  where status in ('queued', 'processing', 'retry_wait');

create index resource_purge_jobs_org_status_idx
  on public.resource_purge_jobs (org_id, status, requested_at desc);

create index resource_purge_members_job_depth_idx
  on public.resource_purge_members (job_id, resource_kind, depth desc);

create index resource_purge_objects_ready_idx
  on public.resource_purge_objects (status, available_at, created_at)
  where status in ('pending', 'processing', 'retry_wait');

create index resource_purge_objects_job_status_idx
  on public.resource_purge_objects (job_id, status);

create trigger resource_purge_objects_set_updated_at
  before update on public.resource_purge_objects
  for each row execute function public.set_updated_at();

alter table public.resource_purge_jobs enable row level security;
alter table public.resource_purge_jobs force row level security;
alter table public.resource_purge_members enable row level security;
alter table public.resource_purge_members force row level security;
alter table public.resource_purge_objects enable row level security;
alter table public.resource_purge_objects force row level security;
alter table public.resource_purge_tombstones enable row level security;
alter table public.resource_purge_tombstones force row level security;
alter table public.resource_purge_receipts enable row level security;
alter table public.resource_purge_receipts force row level security;

revoke all on table public.resource_purge_jobs
  from public, anon, authenticated, service_role;
revoke all on table public.resource_purge_members
  from public, anon, authenticated, service_role;
revoke all on table public.resource_purge_objects
  from public, anon, authenticated, service_role;
revoke all on table public.resource_purge_tombstones
  from public, anon, authenticated, service_role;
revoke all on table public.resource_purge_receipts
  from public, anon, authenticated, service_role;

grant select, insert, update, delete
  on table public.resource_purge_jobs to service_role;
grant select, insert, update, delete
  on table public.resource_purge_members to service_role;
grant select, insert, update, delete
  on table public.resource_purge_objects to service_role;
grant select, insert, update, delete
  on table public.resource_purge_tombstones to service_role;
grant select, insert, update, delete
  on table public.resource_purge_receipts to service_role;

grant select on table public.resource_purge_jobs to authenticated;
grant select on table public.resource_purge_tombstones to authenticated;
grant select on table public.resource_purge_receipts to authenticated;

create policy resource_purge_jobs_select_owner
  on public.resource_purge_jobs
  for select
  to authenticated
  using (
    (select public.organization_role_for(org_id)) = 'owner_admin'
  );

create policy resource_purge_tombstones_select_owner
  on public.resource_purge_tombstones
  for select
  to authenticated
  using (
    (select public.organization_role_for(org_id)) = 'owner_admin'
  );

create policy resource_purge_receipts_select_owner
  on public.resource_purge_receipts
  for select
  to authenticated
  using (
    (select public.organization_role_for(org_id)) = 'owner_admin'
  );

create or replace function private.prevent_resource_purge_evidence_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE'
      and not exists (
        select 1
        from public.organizations organization
        where organization.id = old.org_id
      ) then
    return old;
  end if;

  raise exception 'Resource purge evidence is immutable.'
    using errcode = '23514';
end;
$$;

revoke all on function private.prevent_resource_purge_evidence_mutation()
  from public, anon, authenticated, service_role;

create trigger resource_purge_tombstones_immutable
  before update or delete on public.resource_purge_tombstones
  for each row
  execute function private.prevent_resource_purge_evidence_mutation();

create trigger resource_purge_receipts_immutable
  before update or delete on public.resource_purge_receipts
  for each row
  execute function private.prevent_resource_purge_evidence_mutation();

create or replace function private.validate_resource_purge_storage_keys(
  target_job_id uuid,
  target_org_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1
    from public.resource_purge_members member
    join public.document_versions version
      on version.document_id = member.resource_id
     and version.org_id = member.org_id
    where member.job_id = target_job_id
      and member.org_id = target_org_id
      and member.resource_kind = 'document'
      and not (
        version.storage_key = (
          'organizations/' || version.org_id::text ||
          '/documents/' || version.document_id::text ||
          '/versions/' || version.id::text ||
          '/original' ||
          case version.content_type
            when 'application/pdf' then '.pdf'
            when 'image/png' then '.png'
            when 'image/jpeg' then '.jpg'
            when 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
              then '.docx'
            when 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
              then '.xlsx'
            when 'text/csv' then '.csv'
            else ''
          end
        )
        or exists (
          select 1
          from public.generated_document_finalizations finalization
          where finalization.org_id = version.org_id
            and finalization.document_id = version.document_id
            and finalization.storage_key = version.storage_key
            and finalization.storage_key = (
              'organizations/' || finalization.org_id::text ||
              '/documents/' || finalization.document_id::text ||
              '/finalizations/' || finalization.id::text ||
              '/final.pdf'
            )
        )
      )
  ) then
    raise exception 'A document version has an invalid purge object locator.'
      using errcode = '23514';
  end if;

  if exists (
    select 1
    from public.resource_purge_members member
    join public.generated_document_finalizations finalization
      on finalization.document_id = member.resource_id
     and finalization.org_id = member.org_id
    where member.job_id = target_job_id
      and member.org_id = target_org_id
      and member.resource_kind = 'document'
      and finalization.storage_key is distinct from (
        'organizations/' || finalization.org_id::text ||
        '/documents/' || finalization.document_id::text ||
        '/finalizations/' || finalization.id::text ||
        '/final.pdf'
      )
  ) then
    raise exception 'A finalized document has an invalid purge object locator.'
      using errcode = '23514';
  end if;
end;
$$;

create or replace function private.populate_resource_purge_objects(
  target_job_id uuid,
  target_org_id uuid
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  inserted_count integer;
begin
  perform private.validate_resource_purge_storage_keys(
    target_job_id,
    target_org_id
  );

  insert into public.resource_purge_objects (
    job_id,
    org_id,
    object_kind,
    storage_key
  )
  select distinct
    target_job_id,
    target_org_id,
    'document_storage',
    manifest.storage_key
  from (
    select version.storage_key
    from public.resource_purge_members member
    join public.document_versions version
      on version.document_id = member.resource_id
     and version.org_id = member.org_id
    where member.job_id = target_job_id
      and member.org_id = target_org_id
      and member.resource_kind = 'document'

    union

    select finalization.storage_key
    from public.resource_purge_members member
    join public.generated_document_finalizations finalization
      on finalization.document_id = member.resource_id
     and finalization.org_id = member.org_id
    where member.job_id = target_job_id
      and member.org_id = target_org_id
      and member.resource_kind = 'document'
  ) manifest
  on conflict (job_id, storage_key) do nothing;

  get diagnostics inserted_count = row_count;
  return inserted_count;
end;
$$;

create or replace function private.queue_document_purge(
  target_job_id uuid,
  target_org_id uuid,
  target_document_id uuid,
  target_request_kind text,
  target_actor_user_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_lifecycle_state public.resource_lifecycle_state;
begin
  select document.lifecycle_state
  into current_lifecycle_state
  from public.documents document
  where document.id = target_document_id
    and document.org_id = target_org_id
  for update;

  if not found then
    raise exception 'Document not found.'
      using errcode = 'P0002';
  end if;

  if current_lifecycle_state <> 'trashed' then
    raise exception 'Only trashed documents may be queued for purge.'
      using errcode = 'P0001';
  end if;

  insert into public.resource_purge_jobs (
    id,
    org_id,
    root_resource_kind,
    root_resource_id,
    request_kind,
    requested_by
  )
  values (
    target_job_id,
    target_org_id,
    'document',
    target_document_id,
    target_request_kind,
    target_actor_user_id
  );

  insert into public.resource_purge_members (
    job_id,
    org_id,
    resource_kind,
    resource_id,
    depth
  )
  values (
    target_job_id,
    target_org_id,
    'document',
    target_document_id,
    0
  );

  perform private.populate_resource_purge_objects(
    target_job_id,
    target_org_id
  );

  update public.documents document
  set lifecycle_state = 'purge_pending',
      updated_by = coalesce(target_actor_user_id, document.updated_by)
  where document.id = target_document_id
    and document.org_id = target_org_id;

  return target_job_id;
end;
$$;

create or replace function private.queue_folder_purge(
  target_job_id uuid,
  target_org_id uuid,
  target_folder_id uuid,
  target_request_kind text,
  target_actor_user_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  folder_ids uuid[] := '{}'::uuid[];
  document_ids uuid[] := '{}'::uuid[];
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('folder-tree:' || target_org_id::text, 0)
  );

  with recursive physical_subtree as (
    select folder.id, 0 as folder_depth
    from public.folders folder
    where folder.id = target_folder_id
      and folder.org_id = target_org_id

    union all

    select child.id, parent.folder_depth + 1
    from physical_subtree parent
    join public.folders child
      on child.parent_folder_id = parent.id
     and child.org_id = target_org_id
  )
  select coalesce(
    array_agg(subtree.id order by subtree.id),
    '{}'::uuid[]
  )
  into folder_ids
  from physical_subtree subtree;

  if cardinality(folder_ids) = 0 then
    raise exception 'Folder not found.'
      using errcode = 'P0002';
  end if;

  perform folder.id
  from public.folders folder
  where folder.org_id = target_org_id
    and folder.id = any(folder_ids)
  order by folder.id
  for update;

  if exists (
    select 1
    from public.folders folder
    where folder.org_id = target_org_id
      and folder.id = any(folder_ids)
      and folder.lifecycle_state <> 'trashed'
  ) then
    raise exception 'Every folder in the purge subtree must be trashed.'
      using errcode = 'P0001';
  end if;

  select coalesce(
    array_agg(document.id order by document.id),
    '{}'::uuid[]
  )
  into document_ids
  from public.documents document
  where document.org_id = target_org_id
    and document.folder_id = any(folder_ids);

  perform document.id
  from public.documents document
  where document.org_id = target_org_id
    and document.id = any(document_ids)
  order by document.id
  for update;

  if exists (
    select 1
    from public.documents document
    where document.org_id = target_org_id
      and document.id = any(document_ids)
      and document.lifecycle_state <> 'trashed'
  ) then
    raise exception 'Every document in the purge subtree must be trashed.'
      using errcode = 'P0001';
  end if;

  if exists (
    select 1
    from public.documents document
    where document.org_id = target_org_id
      and document.id = any(document_ids)
      and private.document_requires_retention(
        document.org_id,
        document.id
      )
  ) then
    raise exception 'Folder subtree contains a document that requires retention; purge protected documents directly with exact title confirmation.'
      using errcode = '23514';
  end if;

  insert into public.resource_purge_jobs (
    id,
    org_id,
    root_resource_kind,
    root_resource_id,
    request_kind,
    requested_by
  )
  values (
    target_job_id,
    target_org_id,
    'folder',
    target_folder_id,
    target_request_kind,
    target_actor_user_id
  );

  with recursive physical_subtree as (
    select folder.id, 0 as folder_depth
    from public.folders folder
    where folder.id = target_folder_id
      and folder.org_id = target_org_id

    union all

    select child.id, parent.folder_depth + 1
    from physical_subtree parent
    join public.folders child
      on child.parent_folder_id = parent.id
     and child.org_id = target_org_id
  )
  insert into public.resource_purge_members (
    job_id,
    org_id,
    resource_kind,
    resource_id,
    depth
  )
  select
    target_job_id,
    target_org_id,
    'folder',
    subtree.id,
    subtree.folder_depth
  from physical_subtree subtree;

  insert into public.resource_purge_members (
    job_id,
    org_id,
    resource_kind,
    resource_id,
    depth
  )
  select
    target_job_id,
    target_org_id,
    'document',
    document.id,
    folder_member.depth + 1
  from public.documents document
  join public.resource_purge_members folder_member
    on folder_member.job_id = target_job_id
   and folder_member.org_id = target_org_id
   and folder_member.resource_kind = 'folder'
   and folder_member.resource_id = document.folder_id
  where document.org_id = target_org_id;

  perform private.populate_resource_purge_objects(
    target_job_id,
    target_org_id
  );

  update public.documents document
  set lifecycle_state = 'purge_pending',
      updated_by = coalesce(target_actor_user_id, document.updated_by)
  where document.org_id = target_org_id
    and document.id = any(document_ids);

  update public.folders folder
  set lifecycle_state = 'purge_pending',
      updated_by = coalesce(target_actor_user_id, folder.updated_by)
  where folder.org_id = target_org_id
    and folder.id = any(folder_ids);

  return target_job_id;
end;
$$;

revoke all on function private.validate_resource_purge_storage_keys(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.populate_resource_purge_objects(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.queue_document_purge(uuid, uuid, uuid, text, uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.queue_folder_purge(uuid, uuid, uuid, text, uuid)
  from public, anon, authenticated, service_role;
grant execute on function private.queue_document_purge(uuid, uuid, uuid, text, uuid)
  to service_role;
grant execute on function private.queue_folder_purge(uuid, uuid, uuid, text, uuid)
  to service_role;

create or replace function public.request_document_purge(
  target_org_id uuid,
  target_document_id uuid,
  target_actor_user_id uuid,
  target_confirmation_title text,
  target_job_id uuid
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  actor_role public.organization_role;
  locked_document public.documents%rowtype;
  existing_job_id uuid;
begin
  if target_org_id is null
      or target_document_id is null
      or target_actor_user_id is null
      or target_confirmation_title is null
      or target_job_id is null then
    raise exception 'Document purge arguments are required.'
      using errcode = '22023';
  end if;

  actor_role := private.require_active_lifecycle_actor(
    target_org_id,
    target_actor_user_id
  );

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('folder-tree:' || target_org_id::text, 0)
  );

  select document.*
  into locked_document
  from public.documents document
  where document.id = target_document_id
    and document.org_id = target_org_id
  for update;

  if not found then
    raise exception 'Document not found.'
      using errcode = 'P0002';
  end if;

  if target_confirmation_title is distinct from locked_document.title then
    raise exception 'Document title confirmation does not match.'
      using errcode = '22023';
  end if;

  if actor_role <> 'owner_admin'
      and locked_document.created_by is distinct from target_actor_user_id then
    raise exception 'Only the document creator or an organization owner may purge this document.'
      using errcode = '42501';
  end if;

  if private.document_requires_retention(
      target_org_id,
      target_document_id
    ) and actor_role <> 'owner_admin' then
    raise exception 'Only an organization owner may purge a retention-protected document.'
      using errcode = '42501';
  end if;

  select job.id
  into existing_job_id
  from public.resource_purge_jobs job
  where job.org_id = target_org_id
    and job.root_resource_kind = 'document'
    and job.root_resource_id = target_document_id;

  if existing_job_id is not null then
    return existing_job_id;
  end if;

  if locked_document.lifecycle_state <> 'trashed' then
    raise exception 'Only trashed documents may be purged.'
      using errcode = 'P0001';
  end if;

  return private.queue_document_purge(
    target_job_id,
    target_org_id,
    target_document_id,
    'manual',
    target_actor_user_id
  );
end;
$$;

create or replace function public.request_folder_purge(
  target_org_id uuid,
  target_folder_id uuid,
  target_actor_user_id uuid,
  target_confirmation_name text,
  target_job_id uuid
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  actor_role public.organization_role;
  locked_folder public.folders%rowtype;
  existing_job_id uuid;
begin
  if target_org_id is null
      or target_folder_id is null
      or target_actor_user_id is null
      or target_confirmation_name is null
      or target_job_id is null then
    raise exception 'Folder purge arguments are required.'
      using errcode = '22023';
  end if;

  actor_role := private.require_active_lifecycle_actor(
    target_org_id,
    target_actor_user_id
  );

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('folder-tree:' || target_org_id::text, 0)
  );

  select folder.*
  into locked_folder
  from public.folders folder
  where folder.id = target_folder_id
    and folder.org_id = target_org_id
  for update;

  if not found then
    raise exception 'Folder not found.'
      using errcode = 'P0002';
  end if;

  if target_confirmation_name is distinct from locked_folder.name then
    raise exception 'Folder name confirmation does not match.'
      using errcode = '22023';
  end if;

  if actor_role <> 'owner_admin'
      and locked_folder.created_by is distinct from target_actor_user_id then
    raise exception 'Only the folder creator or an organization owner may purge this folder.'
      using errcode = '42501';
  end if;

  select job.id
  into existing_job_id
  from public.resource_purge_jobs job
  where job.org_id = target_org_id
    and job.root_resource_kind = 'folder'
    and job.root_resource_id = target_folder_id;

  if existing_job_id is not null then
    return existing_job_id;
  end if;

  if locked_folder.lifecycle_state <> 'trashed' then
    raise exception 'Only trashed folders may be purged.'
      using errcode = 'P0001';
  end if;

  return private.queue_folder_purge(
    target_job_id,
    target_org_id,
    target_folder_id,
    'manual',
    target_actor_user_id
  );
end;
$$;

create or replace function public.enqueue_due_resource_purges(
  target_limit integer
)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  folder_candidate record;
  document_candidate record;
  enqueued_count integer := 0;
begin
  if target_limit is null
      or not (target_limit between 1 and 100) then
    raise exception 'Purge enqueue limit must be between 1 and 100.'
      using errcode = '22023';
  end if;

  for folder_candidate in
    select folder.id, folder.org_id
    from public.folders folder
    where folder.lifecycle_state = 'trashed'
      and folder.purge_after is not null
      and folder.purge_after <= now()
      and folder.trashed_at is not null
      and folder.purge_after >= folder.trashed_at + interval '30 days'
    order by folder.purge_after, folder.id
    for update skip locked
    limit target_limit
  loop
    if exists (
      with recursive physical_subtree as (
        select candidate.id
        from public.folders candidate
        where candidate.id = folder_candidate.id
          and candidate.org_id = folder_candidate.org_id

        union all

        select child.id
        from physical_subtree parent
        join public.folders child
          on child.parent_folder_id = parent.id
         and child.org_id = folder_candidate.org_id
      )
      select 1
      from public.documents document
      where document.org_id = folder_candidate.org_id
        and document.folder_id in (
          select subtree.id from physical_subtree subtree
        )
        and private.document_requires_retention(
          document.org_id,
          document.id
        )
    ) then
      continue;
    end if;

    begin
      perform private.queue_folder_purge(
        gen_random_uuid(),
        folder_candidate.org_id,
        folder_candidate.id,
        'automatic',
        null
      );
      enqueued_count := enqueued_count + 1;
    exception
      when unique_violation then
        null;
      when check_violation then
        null;
    end;

    exit when enqueued_count >= target_limit;
  end loop;

  if enqueued_count >= target_limit then
    return enqueued_count;
  end if;

  for document_candidate in
    select document.id, document.org_id
    from public.documents document
    where document.lifecycle_state = 'trashed'
      and document.purge_after is not null
      and document.purge_after <= now()
      and document.trashed_at is not null
      and document.purge_after >= document.trashed_at + interval '30 days'
      and not private.document_requires_retention(
        document.org_id,
        document.id
      )
      and not exists (
        select 1
        from public.document_answers answer
        where answer.org_id = document.org_id
          and answer.document_id = document.id
          and answer.workflow_status = 'completed'
      )
      and not exists (
        select 1
        from public.document_signing_recipients recipient
        where recipient.org_id = document.org_id
          and recipient.document_id = document.id
          and recipient.status = 'signed'
      )
      and not exists (
        select 1
        from public.generated_document_finalizations finalization
        where finalization.org_id = document.org_id
          and finalization.document_id = document.id
          and finalization.status = 'finalized'
      )
    order by document.purge_after, document.id
    for update skip locked
    limit (target_limit - enqueued_count)
  loop
    begin
      perform private.queue_document_purge(
        gen_random_uuid(),
        document_candidate.org_id,
        document_candidate.id,
        'automatic',
        null
      );
      enqueued_count := enqueued_count + 1;
    exception
      when unique_violation then
        null;
      when check_violation then
        null;
    end;
  end loop;

  return enqueued_count;
end;
$$;

create or replace function public.lease_resource_purge_objects(
  target_limit integer,
  target_lease_seconds integer
)
returns table (
  object_id uuid,
  job_id uuid,
  storage_key text,
  lease_token uuid,
  attempt_count integer
)
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if target_limit is null
      or not (target_limit between 1 and 100) then
    raise exception 'Purge object lease limit must be between 1 and 100.'
      using errcode = '22023';
  end if;

  if target_lease_seconds is null
      or not (target_lease_seconds between 15 and 600) then
    raise exception 'Purge object lease duration must be between 15 and 600 seconds.'
      using errcode = '22023';
  end if;

  update public.resource_purge_objects object_row
  set status = case
        when object_row.attempt_count >= object_row.max_attempts
          then 'failed'
        else 'retry_wait'
      end,
      available_at = case
        when object_row.attempt_count >= object_row.max_attempts
          then object_row.available_at
        else now()
      end,
      lease_token = null,
      lease_expires_at = null,
      last_error_code = 'lease_expired'
  where object_row.status = 'processing'
    and object_row.lease_expires_at <= now();

  update public.resource_purge_jobs job
  set status = 'failed',
      failed_at = coalesce(job.failed_at, now()),
      last_error_code = 'object_retry_exhausted',
      lease_token = null,
      lease_expires_at = null
  where job.status not in ('completed', 'failed')
    and exists (
      select 1
      from public.resource_purge_objects object_row
      where object_row.job_id = job.id
        and object_row.status = 'failed'
    );

  update public.resource_purge_jobs job
  set status = 'retry_wait',
      available_at = now(),
      lease_token = null,
      lease_expires_at = null
  where job.status = 'processing'
    and not exists (
      select 1
      from public.resource_purge_objects object_row
      where object_row.job_id = job.id
        and object_row.status = 'processing'
    )
    and exists (
      select 1
      from public.resource_purge_objects object_row
      where object_row.job_id = job.id
        and object_row.status in ('pending', 'retry_wait')
    );

  return query
  with lease_candidates as (
    select object_row.id
    from public.resource_purge_objects object_row
    join public.resource_purge_jobs job
      on job.id = object_row.job_id
     and job.org_id = object_row.org_id
    where object_row.status in ('pending', 'retry_wait')
      and object_row.available_at <= now()
      and object_row.attempt_count < object_row.max_attempts
      and job.status in ('queued', 'processing', 'retry_wait')
    order by object_row.available_at, object_row.created_at, object_row.id
    for update of object_row skip locked
    limit target_limit
  ),
  leased as (
    update public.resource_purge_objects object_row
    set status = 'processing',
        attempt_count = object_row.attempt_count + 1,
        lease_token = gen_random_uuid(),
        lease_expires_at =
          now() + make_interval(secs => target_lease_seconds),
        last_error_code = null
    from lease_candidates candidate
    where object_row.id = candidate.id
    returning
      object_row.id,
      object_row.job_id,
      object_row.storage_key,
      object_row.lease_token,
      object_row.attempt_count
  ),
  started_jobs as (
    update public.resource_purge_jobs job
    set status = 'processing',
        started_at = coalesce(job.started_at, now()),
        last_error_code = null
    where job.id in (select leased.job_id from leased)
    returning job.id
  )
  select
    leased.id,
    leased.job_id,
    leased.storage_key,
    leased.lease_token,
    leased.attempt_count::integer
  from leased
  cross join lateral (
    select count(*) from started_jobs
  ) started_job_count
  order by leased.id;
end;
$$;

create or replace function public.complete_resource_purge_object(
  target_object_id uuid,
  target_lease_token uuid
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  object_row public.resource_purge_objects%rowtype;
begin
  if target_object_id is null or target_lease_token is null then
    raise exception 'Purge object completion arguments are required.'
      using errcode = '22023';
  end if;

  select object_record.*
  into object_row
  from public.resource_purge_objects object_record
  where object_record.id = target_object_id
  for update;

  if not found then
    raise exception 'Purge object not found.'
      using errcode = 'P0002';
  end if;

  if object_row.status = 'deleted' then
    return true;
  end if;

  if object_row.status <> 'processing'
      or object_row.lease_token is distinct from target_lease_token
      or object_row.lease_expires_at <= now() then
    raise exception 'Purge object lease is invalid or expired.'
      using errcode = 'P0001';
  end if;

  update public.resource_purge_objects object_record
  set status = 'deleted',
      lease_token = null,
      lease_expires_at = null,
      last_error_code = null,
      deleted_at = now()
  where object_record.id = target_object_id;

  return true;
end;
$$;

create or replace function public.fail_resource_purge_object(
  target_object_id uuid,
  target_lease_token uuid,
  target_error_code text
)
returns text
language plpgsql
security invoker
set search_path = ''
as $$
declare
  object_row public.resource_purge_objects%rowtype;
  retry_at timestamptz;
begin
  if target_object_id is null
      or target_lease_token is null
      or target_error_code is null
      or target_error_code !~ '^[a-z][a-z0-9_]{2,63}$' then
    raise exception 'Valid purge object failure arguments are required.'
      using errcode = '22023';
  end if;

  select object_record.*
  into object_row
  from public.resource_purge_objects object_record
  where object_record.id = target_object_id
  for update;

  if not found then
    raise exception 'Purge object not found.'
      using errcode = 'P0002';
  end if;

  if object_row.status in ('retry_wait', 'failed')
      and object_row.last_error_code = target_error_code then
    return object_row.status;
  end if;

  if object_row.status <> 'processing'
      or object_row.lease_token is distinct from target_lease_token
      or object_row.lease_expires_at <= now() then
    raise exception 'Purge object lease is invalid or expired.'
      using errcode = 'P0001';
  end if;

  if object_row.attempt_count >= object_row.max_attempts then
    update public.resource_purge_objects object_record
    set status = 'failed',
        lease_token = null,
        lease_expires_at = null,
        last_error_code = target_error_code
    where object_record.id = target_object_id;

    update public.resource_purge_jobs job
    set status = 'failed',
        failed_at = coalesce(job.failed_at, now()),
        last_error_code = 'object_retry_exhausted',
        lease_token = null,
        lease_expires_at = null
    where job.id = object_row.job_id;

    return 'failed';
  end if;

  retry_at := now() + least(
    interval '6 hours',
    power(
      2::numeric,
      greatest(object_row.attempt_count - 1, 0)
    )::double precision * interval '1 minute'
  );

  update public.resource_purge_objects object_record
  set status = 'retry_wait',
      available_at = retry_at,
      lease_token = null,
      lease_expires_at = null,
      last_error_code = target_error_code
  where object_record.id = target_object_id;

  update public.resource_purge_jobs job
  set status = 'retry_wait',
      available_at = retry_at,
      last_error_code = target_error_code,
      lease_token = null,
      lease_expires_at = null
  where job.id = object_row.job_id
    and job.status <> 'failed';

  return 'retry_wait';
end;
$$;

create or replace function public.finalize_ready_resource_purges(
  target_limit integer
)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  locked_job public.resource_purge_jobs%rowtype;
  folder_member record;
  receipt_id uuid;
  receipt_ids uuid[] := '{}'::uuid[];
  folder_count integer;
  document_count integer;
  object_count integer;
  scope_valid boolean;
  finalized_count integer := 0;
  finalized_at timestamptz;
begin
  if target_limit is null
      or not (target_limit between 1 and 100) then
    raise exception 'Purge finalization limit must be between 1 and 100.'
      using errcode = '22023';
  end if;

  for locked_job in
    select job.*
    from public.resource_purge_jobs job
    where job.status in ('queued', 'processing', 'retry_wait')
      and not exists (
        select 1
        from public.resource_purge_objects object
        where object.job_id = job.id
          and object.status <> 'deleted'
      )
    order by job.org_id, job.requested_at, job.id
    for update skip locked
    limit target_limit
  loop
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(
        'folder-tree:' || locked_job.org_id::text,
        0
      )
    );

    select count(*)::integer
    into folder_count
    from public.resource_purge_members member
    where member.job_id = locked_job.id
      and member.resource_kind = 'folder';

    select count(*)::integer
    into document_count
    from public.resource_purge_members member
    where member.job_id = locked_job.id
      and member.resource_kind = 'document';

    select count(*)::integer
    into object_count
    from public.resource_purge_objects object
    where object.job_id = locked_job.id;

    scope_valid := true;

    if locked_job.root_resource_kind = 'document' then
      scope_valid :=
        folder_count = 0
        and document_count = 1
        and exists (
          select 1
          from public.resource_purge_members member
          join public.documents document
            on document.id = member.resource_id
           and document.org_id = member.org_id
          where member.job_id = locked_job.id
            and member.org_id = locked_job.org_id
            and member.resource_kind = 'document'
            and member.resource_id = locked_job.root_resource_id
            and document.lifecycle_state = 'purge_pending'
        );

      if scope_valid
          and locked_job.request_kind = 'automatic'
          and private.document_requires_retention(
            locked_job.org_id,
            locked_job.root_resource_id
          ) then
        scope_valid := false;
      end if;
    else
      with recursive physical_subtree as (
        select folder.id
        from public.folders folder
        where folder.id = locked_job.root_resource_id
          and folder.org_id = locked_job.org_id

        union all

        select child.id
        from physical_subtree parent
        join public.folders child
          on child.parent_folder_id = parent.id
         and child.org_id = locked_job.org_id
      ),
      captured_folders as (
        select member.resource_id as id
        from public.resource_purge_members member
        where member.job_id = locked_job.id
          and member.org_id = locked_job.org_id
          and member.resource_kind = 'folder'
      )
      select
        not exists (
          select id from physical_subtree
          except
          select id from captured_folders
        )
        and not exists (
          select id from captured_folders
          except
          select id from physical_subtree
        )
      into scope_valid;

      scope_valid := coalesce(scope_valid, false)
        and not exists (
          select 1
          from public.resource_purge_members member
          join public.folders folder
            on folder.id = member.resource_id
           and folder.org_id = member.org_id
          where member.job_id = locked_job.id
            and member.resource_kind = 'folder'
            and folder.lifecycle_state <> 'purge_pending'
        )
        and not exists (
          select 1
          from public.resource_purge_members member
          where member.job_id = locked_job.id
            and member.resource_kind = 'folder'
            and not exists (
              select 1
              from public.folders folder
              where folder.id = member.resource_id
                and folder.org_id = member.org_id
            )
        )
        and not exists (
          select document.id
          from public.documents document
          join public.resource_purge_members folder_member
            on folder_member.job_id = locked_job.id
           and folder_member.org_id = document.org_id
           and folder_member.resource_kind = 'folder'
           and folder_member.resource_id = document.folder_id
          where document.org_id = locked_job.org_id
          except
          select member.resource_id
          from public.resource_purge_members member
          where member.job_id = locked_job.id
            and member.org_id = locked_job.org_id
            and member.resource_kind = 'document'
        )
        and not exists (
          select member.resource_id
          from public.resource_purge_members member
          where member.job_id = locked_job.id
            and member.org_id = locked_job.org_id
            and member.resource_kind = 'document'
          except
          select document.id
          from public.documents document
          join public.resource_purge_members folder_member
            on folder_member.job_id = locked_job.id
           and folder_member.org_id = document.org_id
           and folder_member.resource_kind = 'folder'
           and folder_member.resource_id = document.folder_id
          where document.org_id = locked_job.org_id
        )
        and not exists (
          select 1
          from public.resource_purge_members member
          join public.documents document
            on document.id = member.resource_id
           and document.org_id = member.org_id
          where member.job_id = locked_job.id
            and member.resource_kind = 'document'
            and (
              document.lifecycle_state <> 'purge_pending'
              or private.document_requires_retention(
                document.org_id,
                document.id
              )
            )
        );
    end if;

    if not scope_valid then
      update public.resource_purge_jobs job
      set status = 'failed',
          failed_at = coalesce(job.failed_at, now()),
          last_error_code = 'scope_validation_failed',
          lease_token = null,
          lease_expires_at = null
      where job.id = locked_job.id;
      continue;
    end if;

    delete from public.documents document
    using public.resource_purge_members member
    where member.job_id = locked_job.id
      and member.org_id = locked_job.org_id
      and member.resource_kind = 'document'
      and document.id = member.resource_id
      and document.org_id = member.org_id;

    for folder_member in
      select member.resource_id
      from public.resource_purge_members member
      where member.job_id = locked_job.id
        and member.org_id = locked_job.org_id
        and member.resource_kind = 'folder'
      order by member.depth desc, member.resource_id
    loop
      delete from public.folders folder
      where folder.id = folder_member.resource_id
        and folder.org_id = locked_job.org_id;

      if not found then
        raise exception 'Captured purge folder disappeared during finalization.'
          using errcode = '23514';
      end if;
    end loop;

    finalized_at := now();
    receipt_id := gen_random_uuid();

    insert into public.resource_purge_tombstones (
      org_id,
      resource_kind,
      resource_id,
      root_job_id,
      purged_at
    )
    select
      member.org_id,
      member.resource_kind,
      member.resource_id,
      locked_job.id,
      finalized_at
    from public.resource_purge_members member
    where member.job_id = locked_job.id;

    delete from public.resource_purge_objects object
    where object.job_id = locked_job.id;

    update public.resource_purge_jobs job
    set status = 'completed',
        completed_at = finalized_at,
        failed_at = null,
        last_error_code = null,
        lease_token = null,
        lease_expires_at = null
    where job.id = locked_job.id;

    insert into public.resource_purge_receipts (
      id,
      job_id,
      org_id,
      root_resource_kind,
      root_resource_id,
      request_kind,
      requested_by,
      object_count,
      document_count,
      folder_count,
      purged_at
    )
    values (
      receipt_id,
      locked_job.id,
      locked_job.org_id,
      locked_job.root_resource_kind,
      locked_job.root_resource_id,
      locked_job.request_kind,
      locked_job.requested_by,
      object_count,
      document_count,
      folder_count,
      finalized_at
    );

    receipt_ids := array_append(receipt_ids, receipt_id);
    finalized_count := finalized_count + 1;
  end loop;

  -- Audit insertion is deliberately the final write in this transaction. The
  -- audit-chain trigger acquires the tenant's final advisory lock.
  insert into public.audit_logs (
    id,
    org_id,
    actor_user_id,
    action,
    target_type,
    target_id,
    metadata,
    created_at
  )
  select
    gen_random_uuid(),
    receipt.org_id,
    receipt.requested_by,
    case receipt.root_resource_kind
      when 'document' then 'document.purged'
      else 'folder.purged'
    end,
    receipt.root_resource_kind,
    receipt.root_resource_id,
    jsonb_build_object(
      'receiptId',
      receipt.id,
      'jobId',
      receipt.job_id,
      'requestKind',
      receipt.request_kind,
      'objectCount',
      receipt.object_count,
      'documentCount',
      receipt.document_count,
      'folderCount',
      receipt.folder_count
    ),
    receipt.purged_at
  from public.resource_purge_receipts receipt
  where receipt.id = any(receipt_ids)
  order by receipt.org_id, receipt.id;

  return finalized_count;
end;
$$;

create or replace function public.get_resource_purge_schema_contract()
returns table (
  object_kind text,
  object_name text,
  present boolean,
  rls_enabled boolean,
  rls_forced boolean
)
language sql
stable
set search_path = ''
as $$
  with expected_tables (object_name) as (
    values
      ('resource_purge_jobs'),
      ('resource_purge_members'),
      ('resource_purge_objects'),
      ('resource_purge_tombstones'),
      ('resource_purge_receipts')
  ),
  expected_functions (object_name, function_signature) as (
    values
      (
        'request_document_purge',
        'public.request_document_purge(uuid,uuid,uuid,text,uuid)'
      ),
      (
        'request_folder_purge',
        'public.request_folder_purge(uuid,uuid,uuid,text,uuid)'
      ),
      (
        'enqueue_due_resource_purges',
        'public.enqueue_due_resource_purges(integer)'
      ),
      (
        'lease_resource_purge_objects',
        'public.lease_resource_purge_objects(integer,integer)'
      ),
      (
        'complete_resource_purge_object',
        'public.complete_resource_purge_object(uuid,uuid)'
      ),
      (
        'fail_resource_purge_object',
        'public.fail_resource_purge_object(uuid,uuid,text)'
      ),
      (
        'finalize_ready_resource_purges',
        'public.finalize_ready_resource_purges(integer)'
      )
  )
  select
    contract.object_kind,
    contract.object_name,
    contract.present,
    contract.rls_enabled,
    contract.rls_forced
  from (
    select
      'table'::text as object_kind,
      expected_table.object_name::text as object_name,
      relation.oid is not null as present,
      coalesce(relation.relrowsecurity, false) as rls_enabled,
      coalesce(relation.relforcerowsecurity, false) as rls_forced
    from expected_tables expected_table
    left join pg_catalog.pg_namespace namespace
      on namespace.nspname = 'public'
    left join pg_catalog.pg_class relation
      on relation.relnamespace = namespace.oid
     and relation.relname = expected_table.object_name
     and relation.relkind in ('r', 'p')

    union all

    select
      'function'::text as object_kind,
      expected_function.object_name::text as object_name,
      pg_catalog.to_regprocedure(expected_function.function_signature) is not null as present,
      null::boolean as rls_enabled,
      null::boolean as rls_forced
    from expected_functions expected_function
  ) contract
  order by contract.object_kind, contract.object_name;
$$;

revoke execute on function public.request_document_purge(uuid, uuid, uuid, text, uuid) from public, anon, authenticated, service_role;
revoke execute on function public.request_folder_purge(uuid, uuid, uuid, text, uuid) from public, anon, authenticated, service_role;
revoke execute on function public.enqueue_due_resource_purges(integer) from public, anon, authenticated, service_role;
revoke execute on function public.lease_resource_purge_objects(integer, integer) from public, anon, authenticated, service_role;
revoke execute on function public.complete_resource_purge_object(uuid, uuid) from public, anon, authenticated, service_role;
revoke execute on function public.fail_resource_purge_object(uuid, uuid, text) from public, anon, authenticated, service_role;
revoke execute on function public.finalize_ready_resource_purges(integer) from public, anon, authenticated, service_role;
revoke execute on function public.get_resource_purge_schema_contract() from public, anon, authenticated, service_role;

grant execute on function public.request_document_purge(uuid, uuid, uuid, text, uuid) to service_role;
grant execute on function public.request_folder_purge(uuid, uuid, uuid, text, uuid) to service_role;
grant execute on function public.enqueue_due_resource_purges(integer) to service_role;
grant execute on function public.lease_resource_purge_objects(integer, integer) to service_role;
grant execute on function public.complete_resource_purge_object(uuid, uuid) to service_role;
grant execute on function public.fail_resource_purge_object(uuid, uuid, text) to service_role;
grant execute on function public.finalize_ready_resource_purges(integer) to service_role;
grant execute on function public.get_resource_purge_schema_contract() to service_role;

notify pgrst, 'reload schema';
