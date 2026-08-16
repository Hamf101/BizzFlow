alter table public.document_versions
  add column upload_authorization_expires_at timestamptz;

-- Existing browser-uploaded versions may still have a previously issued SigV4
-- PUT URL. Seven days is the protocol maximum, so one fixed migration timestamp
-- safely covers every URL that could have been issued before this column
-- existed. Server-generated final PDFs never receive a browser PUT URL and are
-- deliberately excluded from the conservative delay.
do $migration_backfill$
declare
  migration_time timestamptz := clock_timestamp();
begin
  update public.document_versions version
  set upload_authorization_expires_at = migration_time + interval '7 days'
  where version.upload_authorization_expires_at is null
    and not exists (
      select 1
      from public.generated_document_finalizations finalization
      where finalization.document_version_id = version.id
        and finalization.org_id = version.org_id
        and finalization.document_id = version.document_id
    );
end;
$migration_backfill$;

comment on column public.document_versions.upload_authorization_expires_at is
  'Latest time at which an issued signed PUT may still create this version object.';

-- Operational precondition: drain old application instances that can refresh a
-- pending upload without registering its new expiry, and pause purge workers
-- while this migration is applied. The locks below serialize the data rewrite;
-- revoking an in-flight lease ensures a worker that already deleted an object
-- cannot finalize the job before the upload-authorization barrier has elapsed.
lock table public.resource_purge_jobs in share row exclusive mode;
lock table public.resource_purge_objects in share row exclusive mode;

with version_barriers as (
  select
    version.storage_key,
    max(version.upload_authorization_expires_at) as available_at
  from public.document_versions version
  where version.upload_authorization_expires_at is not null
  group by version.storage_key
),
updated_objects as (
  update public.resource_purge_objects object_row
  set available_at = greatest(object_row.available_at, barrier.available_at),
      status = case
        when object_row.status in ('processing', 'deleted') then 'retry_wait'
        else object_row.status
      end,
      attempt_count = case
        when object_row.status in ('processing', 'deleted')
          then least(
            object_row.attempt_count,
            greatest(object_row.max_attempts - 1, 0)
          )
        else object_row.attempt_count
      end,
      lease_token = case
        when object_row.status = 'processing' then null
        else object_row.lease_token
      end,
      lease_expires_at = case
        when object_row.status = 'processing' then null
        else object_row.lease_expires_at
      end,
      deleted_at = case
        when object_row.status = 'deleted' then null
        else object_row.deleted_at
      end,
      last_error_code = case
        when object_row.status in ('processing', 'deleted')
          then 'upload_barrier_raised'
        else object_row.last_error_code
      end
  from version_barriers barrier
  where object_row.storage_key = barrier.storage_key
    and object_row.object_kind = 'document_storage'
  returning object_row.job_id, object_row.available_at, object_row.status
),
updated_jobs as (
  select
    updated_object.job_id,
    max(updated_object.available_at) as available_at
  from updated_objects updated_object
  where updated_object.status = 'retry_wait'
  group by updated_object.job_id
)
update public.resource_purge_jobs job
set status = case
      when job.status in ('queued', 'processing', 'retry_wait')
        then 'retry_wait'
      else job.status
    end,
    available_at = greatest(job.available_at, updated_job.available_at),
    lease_token = case
      when job.status in ('queued', 'processing', 'retry_wait') then null
      else job.lease_token
    end,
    lease_expires_at = case
      when job.status in ('queued', 'processing', 'retry_wait') then null
      else job.lease_expires_at
    end
from updated_jobs updated_job
where job.id = updated_job.job_id;

alter table public.resource_purge_objects
  add constraint resource_purge_objects_upload_barrier_check
  check (
    status <> 'deleted'
    or deleted_at >= available_at
  );

create or replace function private.enforce_resource_purge_object_delete_barrier()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if old.available_at > clock_timestamp() then
    raise exception 'Purge object cannot be finalized before its upload barrier.'
      using errcode = 'P0001';
  end if;

  return old;
end;
$$;

create trigger enforce_resource_purge_object_delete_barrier
before delete on public.resource_purge_objects
for each row
execute function private.enforce_resource_purge_object_delete_barrier();

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
  populated_at timestamptz := clock_timestamp();
begin
  perform private.validate_resource_purge_storage_keys(
    target_job_id,
    target_org_id
  );

  insert into public.resource_purge_objects as existing_object (
    job_id,
    org_id,
    object_kind,
    storage_key,
    available_at
  )
  select
    target_job_id,
    target_org_id,
    'document_storage',
    manifest.storage_key,
    max(manifest.available_at)
  from (
    select
      version.storage_key,
      coalesce(
        version.upload_authorization_expires_at,
        populated_at
      ) as available_at
    from public.resource_purge_members member
    join public.document_versions version
      on version.document_id = member.resource_id
     and version.org_id = member.org_id
    where member.job_id = target_job_id
      and member.org_id = target_org_id
      and member.resource_kind = 'document'

    union all

    select
      finalization.storage_key,
      populated_at as available_at
    from public.resource_purge_members member
    join public.generated_document_finalizations finalization
      on finalization.document_id = member.resource_id
     and finalization.org_id = member.org_id
    where member.job_id = target_job_id
      and member.org_id = target_org_id
      and member.resource_kind = 'document'
  ) manifest
  group by manifest.storage_key
  on conflict (job_id, storage_key) do update
  set available_at = greatest(
    existing_object.available_at,
    excluded.available_at
  );

  get diagnostics inserted_count = row_count;
  return inserted_count;
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
        else greatest(object_row.available_at, now())
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
      available_at = greatest(job.available_at, now()),
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

  if object_row.available_at > clock_timestamp() then
    raise exception 'Purge object upload barrier is still active.'
      using errcode = 'P0001';
  end if;

  update public.resource_purge_objects object_record
  set status = 'deleted',
      lease_token = null,
      lease_expires_at = null,
      last_error_code = null,
      deleted_at = clock_timestamp()
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
  next_available_at timestamptz;
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
  next_available_at := greatest(object_row.available_at, retry_at);

  update public.resource_purge_objects object_record
  set status = 'retry_wait',
      available_at = next_available_at,
      lease_token = null,
      lease_expires_at = null,
      last_error_code = target_error_code
  where object_record.id = target_object_id;

  update public.resource_purge_jobs job
  set status = 'retry_wait',
      available_at = greatest(job.available_at, next_available_at),
      last_error_code = target_error_code,
      lease_token = null,
      lease_expires_at = null
  where job.id = object_row.job_id
    and job.status <> 'failed';

  return 'retry_wait';
end;
$$;

create or replace function public.reconcile_document_upload_authorization_barriers(
  target_conservative_until timestamptz
)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  updated_version_count integer;
begin
  if target_conservative_until is null
      or target_conservative_until <= clock_timestamp()
      or target_conservative_until > clock_timestamp() + interval '7 days' then
    raise exception 'Conservative upload barrier must be within the next seven days.'
      using errcode = '22023';
  end if;

  -- Operators call this once after the last legacy application instance has
  -- drained and while purge workers remain paused. The locks make the barrier
  -- raise and lease revocation one atomic operational step.
  lock table public.document_versions in share row exclusive mode;
  lock table public.resource_purge_jobs in share row exclusive mode;
  lock table public.resource_purge_objects in share row exclusive mode;

  update public.document_versions version
  set upload_authorization_expires_at = case
    when version.upload_authorization_expires_at is null
      then target_conservative_until
    else greatest(
      version.upload_authorization_expires_at,
      target_conservative_until
    )
  end
  where not exists (
    select 1
    from public.generated_document_finalizations finalization
    where finalization.document_version_id = version.id
      and finalization.org_id = version.org_id
      and finalization.document_id = version.document_id
  );

  get diagnostics updated_version_count = row_count;

  with version_barriers as (
    select
      version.storage_key,
      max(version.upload_authorization_expires_at) as available_at
    from public.document_versions version
    where version.upload_authorization_expires_at is not null
    group by version.storage_key
  ),
  updated_objects as (
    update public.resource_purge_objects object_row
    set available_at = greatest(object_row.available_at, barrier.available_at),
        status = case
          when object_row.status in ('processing', 'deleted') then 'retry_wait'
          else object_row.status
        end,
        attempt_count = case
          when object_row.status in ('processing', 'deleted')
            then least(
              object_row.attempt_count,
              greatest(object_row.max_attempts - 1, 0)
            )
          else object_row.attempt_count
        end,
        lease_token = case
          when object_row.status = 'processing' then null
          else object_row.lease_token
        end,
        lease_expires_at = case
          when object_row.status = 'processing' then null
          else object_row.lease_expires_at
        end,
        deleted_at = case
          when object_row.status = 'deleted' then null
          else object_row.deleted_at
        end,
        last_error_code = case
          when object_row.status in ('processing', 'deleted')
            then 'upload_barrier_raised'
          else object_row.last_error_code
        end
    from version_barriers barrier
    where object_row.storage_key = barrier.storage_key
      and object_row.object_kind = 'document_storage'
    returning object_row.job_id, object_row.available_at, object_row.status
  ),
  updated_jobs as (
    select
      updated_object.job_id,
      max(updated_object.available_at) as available_at
    from updated_objects updated_object
    where updated_object.status = 'retry_wait'
    group by updated_object.job_id
  )
  update public.resource_purge_jobs job
  set status = case
        when job.status in ('queued', 'processing', 'retry_wait')
          then 'retry_wait'
        else job.status
      end,
      available_at = greatest(job.available_at, updated_job.available_at),
      lease_token = case
        when job.status in ('queued', 'processing', 'retry_wait') then null
        else job.lease_token
      end,
      lease_expires_at = case
        when job.status in ('queued', 'processing', 'retry_wait') then null
        else job.lease_expires_at
      end
  from updated_jobs updated_job
  where job.id = updated_job.job_id;

  return updated_version_count;
end;
$$;

create or replace function public.register_document_version_upload_authorization(
  target_org_id uuid,
  target_document_id uuid,
  target_version_id uuid,
  target_uploaded_by uuid,
  target_expires_at timestamptz
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  document_lifecycle_state public.resource_lifecycle_state;
  version_status text;
  version_uploaded_by uuid;
begin
  if target_org_id is null
      or target_document_id is null
      or target_version_id is null
      or target_uploaded_by is null
      or target_expires_at is null then
    raise exception 'Upload authorization arguments are required.'
      using errcode = '22023';
  end if;

  if target_expires_at <= clock_timestamp() then
    raise exception 'Upload authorization expiry must be in the future.'
      using errcode = '22023';
  end if;

  -- The document lock serializes authorization with trash and purge requests.
  select document.lifecycle_state
  into document_lifecycle_state
  from public.documents document
  where document.id = target_document_id
    and document.org_id = target_org_id
  for update;

  if not found then
    raise exception 'Document not found.'
      using errcode = 'P0002';
  end if;

  if document_lifecycle_state <> 'active' then
    raise exception 'Only active documents can authorize uploads.'
      using errcode = 'P0001';
  end if;

  select version.status, version.uploaded_by
  into version_status, version_uploaded_by
  from public.document_versions version
  where version.id = target_version_id
    and version.document_id = target_document_id
    and version.org_id = target_org_id
  for update;

  if not found then
    raise exception 'Document version not found.'
      using errcode = 'P0002';
  end if;

  if version_status <> 'upload_pending' then
    raise exception 'Only pending document versions can authorize uploads.'
      using errcode = 'P0001';
  end if;

  if version_uploaded_by is distinct from target_uploaded_by then
    raise exception 'Only the pending version owner can authorize uploads.'
      using errcode = 'P0001';
  end if;

  update public.document_versions version
  set upload_authorization_expires_at = case
    when version.upload_authorization_expires_at is null
      then target_expires_at
    else greatest(
      version.upload_authorization_expires_at,
      target_expires_at
    )
  end
  where version.id = target_version_id
    and version.document_id = target_document_id
    and version.org_id = target_org_id;

  return true;
end;
$$;

-- Replace rather than overload the RPC: Supabase does not support overloaded
-- function names. The trailing default keeps older callers compatible, while
-- newer callers can persist the exact expiry during allocation.
drop function public.create_pending_document_version(
  uuid,
  uuid,
  uuid,
  text,
  text,
  text,
  bigint,
  text,
  uuid
);

create function public.create_pending_document_version(
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
  next_version_number integer;
  created_version_id uuid;
begin
  if target_upload_authorization_expires_at is not null
      and target_upload_authorization_expires_at <= clock_timestamp() then
    raise exception 'Upload authorization expiry must be in the future.'
      using errcode = '22023';
  end if;

  select document.lifecycle_state
  into document_lifecycle_state
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

revoke all on function private.populate_resource_purge_objects(uuid, uuid)
  from public, anon, authenticated, service_role;

revoke all on function private.enforce_resource_purge_object_delete_barrier()
  from public, anon, authenticated, service_role;

revoke execute on function public.lease_resource_purge_objects(
  integer,
  integer
) from public, anon, authenticated, service_role;

grant execute on function public.lease_resource_purge_objects(
  integer,
  integer
) to service_role;

revoke execute on function public.complete_resource_purge_object(
  uuid,
  uuid
) from public, anon, authenticated, service_role;

grant execute on function public.complete_resource_purge_object(
  uuid,
  uuid
) to service_role;

revoke execute on function public.fail_resource_purge_object(
  uuid,
  uuid,
  text
) from public, anon, authenticated, service_role;

grant execute on function public.fail_resource_purge_object(
  uuid,
  uuid,
  text
) to service_role;

revoke execute on function public.reconcile_document_upload_authorization_barriers(
  timestamptz
) from public, anon, authenticated, service_role;

grant execute on function public.reconcile_document_upload_authorization_barriers(
  timestamptz
) to service_role;

revoke execute on function public.register_document_version_upload_authorization(
  uuid,
  uuid,
  uuid,
  uuid,
  timestamptz
) from public, anon, authenticated, service_role;

grant execute on function public.register_document_version_upload_authorization(
  uuid,
  uuid,
  uuid,
  uuid,
  timestamptz
) to service_role;

revoke execute on function public.create_pending_document_version(
  uuid,
  uuid,
  uuid,
  text,
  text,
  text,
  bigint,
  text,
  uuid,
  timestamptz
) from public, anon, authenticated, service_role;

grant execute on function public.create_pending_document_version(
  uuid,
  uuid,
  uuid,
  text,
  text,
  text,
  bigint,
  text,
  uuid,
  timestamptz
) to service_role;

notify pgrst, 'reload schema';
